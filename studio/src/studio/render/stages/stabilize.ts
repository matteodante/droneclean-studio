// The stabilization stage (design 3.6 section 2.2): an adapter over Gyroflow's warp (`stabilization/stage.ts`) and the
// engine host (`stabilization/seat.ts`). It runs once per source frame, `rgba16float` in and out (section 2.6), at the
// size the engine reported for the clip.
//
// The three questions of the contract, answered from state and never by awaiting inside the render:
//   outputSize  the session's derived-size store, which only `prepare` writes (S5: the render never writes the project);
//   ready       whether the engine's data for the source frame is in the host; if not, the fetch is started and its
//               promise is the "not yet"; an engine that failed to open, or a frame it could not answer, is thrown as a
//               `StageError` (S3: a failure is a named state, never a silent raw frame);
//   encode      records the warp, the frame's bytes going into the frame arena, so N warps in one encoder each keep
//               their own (S8).
// Everything is keyed by (media, settings fingerprint): `stabilizationEngineKey`. A frame interpolated between two
// source frames (optical-flow slow motion, task 11.12) comes with its fractional source position, and gets the engine's
// correction at that moment (`StabilizationClient.getFrameData`), not a neighbour's.

import { stabilizationEngineKey } from '@/studio/stabilization/engine-key'
import { stabilizationSeat, type StabilizationSeat } from '@/studio/stabilization/seat'
import { builtStabilizationStage, stabilizationStageFor } from '@/studio/stabilization/stage-cache'
import { framingOf } from '@/studio/stabilization/reframe'
import type { StabilizationFormats } from '@/studio/stabilization/stage'
import type { VideoItem } from '@/types/timeline'
import { derivedSizeKey, type DerivedSizeStore } from './derived-sizes'
import { isStabilized } from './predicates'
import { StageError, type SourceStage } from './types'

/** The formats every stage intermediate has (design 3.6 section 2.6) */
const FLOAT_FORMATS: StabilizationFormats = { input: 'rgba16float', output: 'rgba16float' }

/**
 * What the stage is built with: the session's size store and the host (the page's by default). The frames a clip reads
 * first are asked for ahead of the playhead by the page's look-ahead (`stabilize-ahead.ts`), not by this stage: a frame
 * drawn here says nothing about how soon the next clip starts (20 Nov 2026: at the 4x end of a smooth edit the last 30
 * source frames are 7 timeline frames, which a 4K preview with motion blur passed without drawing one).
 */
export interface StabilizeStageDeps {
  sizes: DerivedSizeStore
  host?: () => StabilizationSeat
}

function clipName(item: VideoItem): string {
  return item.label ?? item.id
}

/** The stabilization stage. */
export function createStabilizeStage(deps: StabilizeStageDeps): SourceStage & {
  /** Closes the engine of a key no clip wants any more (the preparer calls it) */
  release(key: string): Promise<void>
  /** Resolves when the key's engine and the assets its warp was built on are gone (the host closed or moved it) */
  lost(key: string): Promise<void>
} {
  const host = (): StabilizationSeat => (deps.host ?? stabilizationSeat)()

  const keyOf = (item: VideoItem): string => {
    const key = stabilizationEngineKey(item)
    if (key === null) {
      throw new StageError({
        clip: clipName(item),
        stage: 'stabilize',
        reason: 'the clip has no source file or no stabilization settings',
      })
    }
    return key
  }

  return {
    id: 'stabilize',
    scope: 'source-frame',
    active: isStabilized,
    key: keyOf,

    outputSize(item) {
      const key = keyOf(item)
      const size = deps.sizes.get(derivedSizeKey('stabilize', key))
      if (size !== undefined) return size
      const state = host().engineState(key)
      if (state.status === 'failed') {
        throw new StageError({
          clip: clipName(item),
          stage: 'stabilize',
          reason: state.error.message,
          cause: state.error,
        })
      }
      return { kind: 'not-ready', stage: 'stabilize', ready: host().whenSettled(key) }
    },

    async prepare(item, device) {
      const key = keyOf(item)
      const seat = host()
      const sizeKey = derivedSizeKey('stabilize', key)
      const fail = (reason: string, cause?: unknown): never => {
        throw new StageError({ clip: clipName(item), stage: 'stabilize', reason, cause })
      }
      // Everything up to the first await is synchronous: an engine that moved to these settings in place already
      // knows its size, so the size is set before `open` resolves and the layout does not jump during a slider drag.
      // The preparer calls `prepare` only for an attempt it wants (a new key, an export, Retry), so a key whose last
      // open failed is opened again rather than answered with the old failure.
      const opening = seat.open(item, { retry: true })
      const known = seat.outputSizeOf(key)
      if (known) deps.sizes.set(sizeKey, known)
      const result = await opening
      if (result.kind === 'no-motion-data' || result.kind === 'failed') {
        return fail(result.error.message, result.error)
      }
      const size = seat.outputSizeOf(key)
      if (size === null) return fail('the engine reported no usable output size')
      deps.sizes.set(sizeKey, size)
      try {
        await stabilizationStageFor(device, await seat.stageAssets(key), FLOAT_FORMATS)
      } catch (error) {
        return fail(
          `the warp could not be built: ${error instanceof Error ? error.message : String(error)}`,
          error,
        )
      }
    },

    ready(item, sourceIndex) {
      const key = keyOf(item)
      const seat = host()
      const state = seat.engineState(key)
      if (state.status === 'absent') {
        return { kind: 'not-ready', stage: 'stabilize', ready: seat.whenSettled(key) }
      }
      if (state.status === 'opening') {
        return { kind: 'not-ready', stage: 'stabilize', ready: state.settled }
      }
      if (state.status === 'failed') {
        throw new StageError({
          clip: clipName(item),
          stage: 'stabilize',
          sourceIndex,
          reason: state.error.message,
          cause: state.error,
        })
      }
      if (seat.frame(key, sourceIndex) !== undefined) return true
      const failure = seat.takeFrameFailure(key, sourceIndex)
      if (failure !== undefined) {
        throw new StageError({
          clip: clipName(item),
          stage: 'stabilize',
          sourceIndex,
          reason: failure.message,
          cause: failure,
        })
      }
      return { kind: 'not-ready', stage: 'stabilize', ready: seat.requestFrame(key, sourceIndex), arriving: true }
    },

    encode(env, encoder, item, sourceIndex, input, output) {
      const fail = (reason: string, cause?: unknown): never => {
        throw new StageError({
          clip: clipName(item),
          stage: 'stabilize',
          sourceIndex,
          reason,
          cause,
        })
      }
      const key = keyOf(item)
      const frame = host().frame(key, sourceIndex)
      if (frame === undefined) return fail('its data was not ready when the frame was recorded')
      const assets = host().loadedAssets(key)
      const stage = assets && builtStabilizationStage(env.device, assets, FLOAT_FORMATS)
      if (!stage) return fail('the warp was not prepared on this device')
      try {
        stage.warp(encoder, input, output, frame, env.arena, framingOf(item.stabilization))
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error), error)
      }
    },

    release: (key) => host().release(key),
    // What `prepare` made is the engine's assets and the warp built on them; a key's new engine has none, so a key whose
    // engine the host closed on its own (its last clip went, it moved to other settings) is prepared again.
    lost: (key) => host().whenAssetsGone(key),
  }
}
