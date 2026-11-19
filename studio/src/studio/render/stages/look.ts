// The look stage (design 3.6 section 2.2): an adapter over `color/gpu/look-pass.ts` and the looks library. It runs after
// the input transform, on display-referred Rec.709 in `rgba16float`, and its uniform goes through the frame arena. The
// pass is built once per device; each look's table is uploaded once per pass, when `prepare` reads it from the library.
// Whether the stage is active at all (the looks switch, an intensity above 0) is `hasLook` of `predicates.ts`.

import { perDevice } from '@/studio/render/device-cache'
import { createLookPass, type LookFormats, type LookStage } from '@/studio/color/gpu/look-pass'
import type { ParsedCube } from '@/studio/color/cube'
import { lookTable } from '@/studio/looks/registry'
import type { VideoItem } from '@/types/timeline'
import { hasLook } from './predicates'
import { StageError, type Size, type SourceStage } from './types'

const FLOAT_FORMATS: LookFormats = { input: 'rgba16float', output: 'rgba16float' }

/** What a device holds for looks: the built pass, and the table each look was last uploaded from */
interface State {
  pass: LookStage | undefined
  /** A re-read table object is uploaded again, the same one is not */
  readonly held: Map<string, ParsedCube>
}

/** What the stage reads from outside: the library's table for a look id (replaced by the tests) */
export interface LookStageDeps {
  lookTable(id: string): Promise<ParsedCube | null>
}

/** The pass, built once per device; a failed build is forgotten and built again by the next ask */
function passFor(device: GPUDevice): Promise<LookStage> {
  return perDevice(device, 'look-pass|rgba16float', () =>
    createLookPass(device, FLOAT_FORMATS).then((pass) => {
      stateOf(device).pass = pass
      return pass
    }),
  )
}

function stateOf(device: GPUDevice): State {
  return perDevice(device, 'look-state|rgba16float', (): State => ({ pass: undefined, held: new Map() }))
}

function clipName(item: VideoItem): string {
  return item.label ?? item.id
}

/** The look stage. */
export function createLookStage(deps: LookStageDeps = { lookTable }): SourceStage {
  return {
    id: 'look',
    scope: 'output-frame',
    active: hasLook,
    // The table is the look's; the intensity is a per-frame uniform, so two intensities share one prepared look
    key: (item) => item.look?.id ?? '',
    outputSize: (_item, input): Size => input,
    async prepare(item, device) {
      const look = item.look
      const fail = (reason: string, cause?: unknown): never => {
        throw new StageError({ clip: clipName(item), stage: 'look', reason, cause })
      }
      if (look === undefined) return fail('the clip has no look')
      const holder = stateOf(device)
      let pass: LookStage
      try {
        pass = await passFor(device)
      } catch (error) {
        return fail(
          `the look pass could not be built: ${error instanceof Error ? error.message : String(error)}`,
          error,
        )
      }
      const table = await deps.lookTable(look.id)
      if (table === null) {
        return fail(`the look '${look.id}' is not in the looks library, or its file cannot be read`)
      }
      if (holder.held.get(look.id) === table) return
      try {
        pass.setLook(look.id, table)
      } catch (error) {
        return fail(
          `the look '${look.id}' could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
          error,
        )
      }
      holder.held.set(look.id, table)
    },
    ready: () => true,
    encode(env, encoder, item, sourceIndex, input, output) {
      const fail = (reason: string): never => {
        throw new StageError({ clip: clipName(item), stage: 'look', sourceIndex, reason })
      }
      const holder = stateOf(env.device)
      const look = item.look
      if (look === undefined || holder.pass === undefined || !holder.held.has(look.id)) {
        return fail('the look was not prepared on this device')
      }
      if (input.format !== 'rgba16float' || output.format !== 'rgba16float') {
        return fail(`its textures must be rgba16float, got ${input.format} and ${output.format}`)
      }
      if (input.width !== output.width || input.height !== output.height) {
        return fail(
          `its output is ${output.width}x${output.height} but its input is ${input.width}x${input.height}`,
        )
      }
      holder.pass.encode(
        encoder,
        input.createView(),
        output.createView(),
        look.id,
        look.intensity,
        { width: input.width, height: input.height },
        env.arena,
      )
    },
  }
}
