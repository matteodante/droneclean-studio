// The stage pipeline's meeting point (design 3.6 section 2.1, slice 0). Every later slice builds on these shapes:
// the stage adapters implement `SourceStage`, the frame provider fills `FrameArena`'s neighbours, the hooks in
// FreeCut's renderer call the pipeline that walks the registry. Nothing here touches a GPU: the types name
// `GPUDevice` and friends, and the only value is `StageError`.

import type { VideoItem } from '@/types/timeline'
import type { FrameArena } from './arena'

/** The three stages, in the order the pipeline runs them (PLAN section 4): the registry's array fixes it. */
export type StageId = 'stabilize' | 'input-colour' | 'look'

/** What a `StageError` can name: a stage, or the motion-blur gather, which is a step of the pipeline and no stage. */
export type StageErrorStage = StageId | 'motion-blur'

/** When a stage runs: once per source frame (before the gather), or once per output frame (after it). */
export type StageScope = 'source-frame' | 'output-frame'

/** A picture's size in pixels. */
export interface Size {
  readonly width: number
  readonly height: number
}

/** What a stage needs at record time: the device, whether the frame is for the export or the preview, the arena. */
export interface StageEnv {
  readonly device: GPUDevice
  readonly mode: 'export' | 'preview'
  readonly arena: FrameArena
}

/** "Not yet": the stage's data for a frame is still arriving; `ready` resolves when it is worth asking again. */
export interface StageNotReady {
  readonly kind: 'not-ready'
  readonly stage: StageId
  readonly ready: Promise<void>
}

/** Whether a stage answer is the "not yet" one rather than a value. */
export function isNotReady(value: unknown): value is StageNotReady {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'not-ready'
  )
}

/**
 * One step of the pipeline. `encode` records synchronously: the pipeline has awaited every `ready` before the first
 * `encode`, and nothing awaits between the first `encode` and the submit, so one encoder holds any number of warps
 * and colour passes without interleaving (design 3.6 section 2.1).
 */
export interface SourceStage {
  readonly id: StageId
  readonly scope: StageScope
  /** Whether the stage changes this clip's pixels; pure, from the item alone. */
  active(item: VideoItem): boolean
  /** The (media, settings fingerprint) key engines and derived sizes are stored under. */
  key(item: VideoItem): string
  /** The size the stage's output has for an input of `input`; reads the derived-size store, synchronously. */
  outputSize(item: VideoItem, input: Size): Size | StageNotReady
  /** Opens engines, builds pipelines and fills the derived-size store: outside the render, never during it. */
  prepare(item: VideoItem, device: GPUDevice): Promise<void>
  /** Whether the stage's per-frame data for `sourceIndex` is present. */
  ready(item: VideoItem, sourceIndex: number): true | StageNotReady
  /** Records the stage's work for source frame `sourceIndex` into `encoder`, from `input` to `output`; synchronous. */
  encode(
    env: StageEnv,
    encoder: GPUCommandEncoder,
    item: VideoItem,
    sourceIndex: number,
    input: GPUTexture,
    output: GPUTexture,
  ): void
  /** Lets go of what the stage holds for a key no clip wants any more (an engine); the preparer calls it. */
  release?(key: string): Promise<void> | void
}

/** What a failed stage reports: the clip, the stage, the source frame when there is one, and why. */
export interface StageErrorInit {
  /** The clip's name as the pilot sees it (its label, or its id). */
  readonly clip: string
  readonly stage: StageErrorStage
  readonly sourceIndex?: number
  readonly reason: string
  readonly cause?: unknown
}

/**
 * A stage could not do its work. An export stops with this message; the preview shows it as the clip's state
 * (design 3.6 section 2.10). The message names what the pilot can act on: the clip, the stage, the frame.
 */
export class StageError extends Error {
  readonly clip: string
  readonly stage: StageErrorStage
  readonly sourceIndex: number | undefined

  constructor(init: StageErrorInit) {
    const frame = init.sourceIndex === undefined ? '' : `, source frame ${init.sourceIndex}`
    super(`Clip '${init.clip}', ${stageLabel(init.stage)}${frame}: ${init.reason}`, {
      cause: init.cause,
    })
    this.name = 'StageError'
    this.clip = init.clip
    this.stage = init.stage
    this.sourceIndex = init.sourceIndex
  }
}

/** The stage's name as a message says it. */
function stageLabel(stage: StageErrorStage): string {
  switch (stage) {
    case 'motion-blur':
      return 'motion blur'
    case 'stabilize':
      return 'stabilization'
    case 'input-colour':
      return 'input colour'
    case 'look':
      return 'look'
  }
}
