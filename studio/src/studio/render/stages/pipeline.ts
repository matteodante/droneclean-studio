// The stage pipeline of one renderer instance (design 3.6 sections 2.1, 2.6, 2.7 and 2.10): a clip's source frame in,
// its staged picture out, every active stage applied in the registry's order, in `rgba16float` throughout.
//
//   1. every active stage is asked, synchronously, whether it is prepared (the preparer's state) and whether its data for
//      the source frame is there (`ready`); nothing is recorded until all of them answer yes;
//   2. the source frame comes from the renderer's provider (`frameAt`, index asserted) and goes back right after the
//      submit (`release`);
//   3. the stages record into one encoder, their per-frame bytes in the arena, and the encoder is submitted once. No
//      stage awaits between the first `encode` and the submit, so a frame cannot see another frame's data.
//
// The failure policy is the mode's:
//   export   a stage that is preparing or whose data is arriving is awaited, for one minute at most per frame; a stage
//            that failed, or kept the frame waiting longer, throws its `StageError` and the export stops with that
//            message. No frame is ever written without its active stages.
//   preview  a clip that cannot be drawn with all its stages shows its last good staged frame and says why (`onState`);
//            when what it waited for arrives, `onReady` asks for the frame again (once). A clip with no good frame yet
//            is drawn from its source frame with the stages that can draw (`partial`), never silently: its state says
//            what is missing.

import {
  createMotionBlurStage,
  MAX_SAMPLES_PER_PASS,
  type GatherStep,
  type MotionBlurStage,
} from '@/studio/motion-blur/stage'
import { createVectorBlurStage, type VectorBlurStage, type VectorSample } from '@/studio/motion-blur/vector-stage'
import {
  createOpticalFlow,
  FlowGapCache,
  type FlowDetail,
  type GapFlow,
  type OpticalFlow,
  type OpticalFlowOptions,
} from '@/studio/optical-flow'
import type { SourceFrame, SourceFrameProvider } from '@/studio/render/frames/types'
import type { VideoItem } from '@/types/timeline'
import {
  gpuStageClock,
  stageTimingsEnabled,
  timedStage,
  timedStageAsync,
  type GpuStageClock,
} from '@/studio/render/timings'
import { FrameArena } from './arena'
import type { ClipStageState } from './failure'
import type { SourceFramePlan, SourceSample } from './plan'
import { sourceStageFingerprint } from './predicates'
import type { Preparer } from './preparer'
import type { StageRegistry } from './registry'
import {
  isNotReady,
  StageError,
  type Size,
  type SourceStage,
  type StageEnv,
  type StageErrorStage,
} from './types'

// The WebGPU usage flags, as the spec numbers them (spelled out so the module loads where there is no GPU).
const COPY_SRC = 0x01
const COPY_DST = 0x02
const TEXTURE_BINDING = 0x04
const RENDER_ATTACHMENT = 0x10

/** Every texture the pipeline renders into: a stage writes it, the next stage or FreeCut's draw samples it. */
const STAGED_USAGE = TEXTURE_BINDING | RENDER_ATTACHMENT | COPY_SRC | COPY_DST

/** The format of every intermediate and of the staged picture (design 3.6 section 2.6). */
const STAGED_FORMAT: GPUTextureFormat = 'rgba16float'

/** How many clips keep a staged picture (the preview's last good frames); the least recently drawn goes first. */
const HELD_CLIPS = 8

/** How many times an export waits for a stage's data for one frame before it calls the stage stuck. */
const EXPORT_WAITS = 64

/**
 * How long one frame of an export waits for its stages' data before it calls the stage stuck. The longest wait that
 * comes is an engine opening (3.0-6.5 s for clip 0020's 1.9 GB); a promise still pending after a minute is one nobody
 * will settle, and the export (or the agent's frame, which main gives up on after 120 s) stops with the stage's name
 * instead of holding the renderer for good.
 */
const EXPORT_WAIT_MS = 60_000

/**
 * How long the preview waits for a stage's data before it holds the clip's last good frame. The stabilization engine
 * answers a window of frames in 3 ms (median) to 30 ms (95th percentile), at most 99 ms, while the reel plays (clip
 * 0023 at 1.6x, 20 Nov 2026); without the wait, every frame the playback skipped to past the window held a stale
 * picture and flashed "waiting for stabilization" for 100-300 ms although its data came a few milliseconds later.
 */
const PREVIEW_WAIT_MS = 50

/**
 * How many source gaps' optical flows a pipeline keeps (task 11.12): an export frees a clip's gaps once it is past them
 * and needs one per clip on screen (two through a transition); a preview keeps a few for scrubbing back and forth.
 */
const EXPORT_FLOW_GAPS = 2
const PREVIEW_FLOW_GAPS = 4

/**
 * How many gaps between staged frames the vector blur keeps (design 9.2, section 5.4): an export needs the gap before
 * and the gap after the frame it draws (one more through a transition), a preview a few more for scrubbing.
 */
const EXPORT_STAGED_GAPS = 4
const PREVIEW_STAGED_GAPS = 8

/** How many staged neighbour frames the vector blur keeps for the next output frame (one per clip on screen) */
const HELD_STAGED_FRAMES = 2

/** One clip's staged picture */
export interface StagedFrame {
  readonly texture: GPUTexture
  readonly width: number
  readonly height: number
  /**
   * `fresh`: every active stage drew this frame. `held`: the clip's last good staged frame (preview only).
   * `partial`: the source frame with the stages that could draw, for a clip with no good frame yet (preview only).
   */
  readonly kind: 'fresh' | 'held' | 'partial'
}

export interface StagePipelineOptions {
  readonly device: GPUDevice
  readonly mode: 'export' | 'preview'
  readonly registry: StageRegistry
  readonly preparer: Pick<Preparer, 'statusOf' | 'ensure' | 'prepareAll' | 'subscribe'>
  readonly provider: SourceFrameProvider
  /** A preview clip's visible state changed (`null`: drawn with all its stages again) */
  readonly onState?: (item: VideoItem, state: ClipStageState | null) => void
  /** What a held or partial preview frame waited for has arrived: draw it again */
  readonly onReady?: (item: VideoItem) => void
  /** The motion-blur gather's constructor (the tests' replacement); `createMotionBlurStage` by default */
  readonly gather?: (device: GPUDevice, format: GPUTextureFormat, size: Size) => Promise<MotionBlurStage>
  /** The optical flow's constructor (the tests' replacement); `createOpticalFlow` by default */
  readonly flow?: (
    device: GPUDevice,
    format: GPUTextureFormat,
    size: Size,
    options?: OpticalFlowOptions,
  ) => Promise<OpticalFlow>
  /** The vector motion blur's constructor (the tests' replacement); `createVectorBlurStage` by default */
  readonly vector?: (device: GPUDevice, format: GPUTextureFormat, size: Size, flowSize: Size) => Promise<VectorBlurStage>
}

export interface StagePipeline {
  /**
   * The staged picture of source frame `sourceIndex` of the clip. The texture belongs to the pipeline and stays as it
   * is until the clip's next frame is staged: draw it before asking for the clip's next one.
   *
   * `source` is one source frame's index, or a plan (`sourceFramePlan`): with more than one sample, each sample goes
   * through the per-source-frame stages and the gather averages them in linear light (design 7.2 B) before the
   * per-output-frame stages. A plan with one sample is that frame, exactly as the index alone. A plan with `flow`
   * (optical-flow slow motion, task 11.12) is the frame interpolated between its two source frames at that phase, from
   * the decoded frames before any stage; it then goes through every stage as a source frame would, at its fractional
   * source position (`first + phase`: the stabilization's data at that moment). A plan whose samples carry an `extent`
   * (motion blur on, design 9.2) blurs each sample along each pixel's motion, measured by the optical flow between the
   * staged frames around it, over its extent, and adds them with their weights.
   *
   * @throws StageError in an export, when an active stage cannot draw the frame.
   * @throws RangeError when a plan has no sample or a weight that is not in (0, 1], an extent that is not above 0, or
   *   a flow plan is not two consecutive frames with a phase in (0, 1).
   */
  render(item: VideoItem, source: number | SourceFramePlan): Promise<StagedFrame>
  /**
   * The preview's staged picture of a frame the caller decoded (FreeCut's own fast preview source, already in an
   * `rgba16float` texture): for a clip whose stages need no exact frame (input colour, a look). Same failure policy as
   * `render` in a preview; the frame stays the caller's.
   */
  renderFrame(item: VideoItem, frame: SourceFrame): Promise<StagedFrame>
  /** Destroys every texture the pipeline made and its arena (the provider is its owner's to destroy). */
  destroy(): void
}

/** One active stage's answer for a frame */
type Check =
  | { readonly kind: 'ok' }
  | { readonly kind: 'wait'; readonly stage: StageErrorStage; readonly ready: Promise<void> }
  | { readonly kind: 'fail'; readonly stage: StageErrorStage; readonly error: StageError }

/** A clip's staged picture; `good` when every active stage drew it */
interface ClipPicture {
  texture: GPUTexture
  width: number
  height: number
  good: boolean
}

function clipName(item: VideoItem): string {
  return item.label || item.id
}

function asStageError(
  error: unknown,
  item: VideoItem,
  stage: SourceStage,
  sourceIndex: number,
): StageError {
  if (error instanceof StageError) return error
  return new StageError({
    clip: clipName(item),
    stage: stage.id,
    sourceIndex,
    reason: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}

/** The visible state of a stage that blocks a clip */
function stateOf(answer: Exclude<Check, { kind: 'ok' }>): ClipStageState {
  return answer.kind === 'fail'
    ? { kind: 'failed', stage: answer.stage, message: answer.error.message }
    : { kind: 'opening', stage: answer.stage }
}

/** The samples of what `render` was given: an index is one sample at weight 1; a plan's are checked */
function samplesOf(source: number | SourceFramePlan): readonly SourceSample[] {
  if (typeof source === 'number') return [{ index: source, weight: 1 }]
  const { samples } = source
  if (samples.length === 0) throw new RangeError('stage pipeline: a source frame plan has no sample')
  let sum = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample.weight) || sample.weight <= 0 || sample.weight > 1) {
      throw new RangeError(`stage pipeline: a sample's weight must be in (0, 1], got ${sample.weight}`)
    }
    sum += sample.weight
  }
  if (Math.abs(sum - 1) > 1e-6) {
    throw new RangeError(`stage pipeline: the weights of a plan must sum to 1, got ${sum}`)
  }
  assertExtents(samples)
  if (source.flow !== undefined) assertFlowPlan(samples, source.flow.phase)
  return samples
}

/** A blurred sample's extent is a number above 0 (design 9.2) */
function assertExtents(samples: readonly SourceSample[]): void {
  const broken = samples.find((sample) => sample.extent !== undefined && !(Number.isFinite(sample.extent) && sample.extent > 0))
  if (broken !== undefined) {
    throw new RangeError(`stage pipeline: a sample's extent must be a number > 0, got ${broken.extent}`)
  }
}

/** An optical-flow plan is two consecutive source frames and a phase in (0, 1) */
function assertFlowPlan(samples: readonly SourceSample[], phase: number): void {
  if (samples.length !== 2 || samples[1]!.index !== samples[0]!.index + 1 || !(phase > 0 && phase < 1)) {
    throw new RangeError(
      `stage pipeline: an optical-flow plan is two consecutive source frames and a phase in (0, 1), got frames ${samples.map((sample) => sample.index).join(', ')} at ${phase}`,
    )
  }
}

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height
}

/** Whether every wait settled within `ms`; a wait that rejects rejects this too */
function settledWithin(waits: readonly Promise<void>[], ms: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(false), ms)
    Promise.all(waits).then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Creates the pipeline of one renderer instance, on its device. */
export function createStagePipeline(options: StagePipelineOptions): StagePipeline {
  const { device, mode, registry, preparer, provider } = options
  const arena = new FrameArena(device)
  const env: StageEnv = { device, mode, arena }
  const clips = new Map<string, ClipPicture>()
  const temps = new Map<string, GPUTexture[]>()
  const awaitingReady = new Set<string>()
  let destroyed = false
  let gpuClock: GpuStageClock | undefined

  const createTexture = (size: Size, label: string): GPUTexture =>
    device.createTexture({
      label,
      size: { width: size.width, height: size.height },
      format: STAGED_FORMAT,
      usage: STAGED_USAGE,
    })

  /** Resolves when the preparer's state of the clip's stage is no longer `preparing` */
  const whenPrepared = (item: VideoItem, stage: SourceStage): Promise<void> =>
    new Promise((resolve) => {
      const settled = () => preparer.statusOf(item, stage.id)?.status !== 'preparing'
      if (settled()) {
        resolve()
        return
      }
      const stop = preparer.subscribe(() => {
        if (!settled()) return
        stop()
        resolve()
      })
    })

  const check = (item: VideoItem, stage: SourceStage, sourceIndex: number): Check => {
    let status = preparer.statusOf(item, stage.id)
    if (status === undefined) {
      preparer.ensure([item], device)
      status = preparer.statusOf(item, stage.id)
    }
    if (status?.status === 'failed') return { kind: 'fail', stage: stage.id, error: status.error }
    if (status?.status !== 'ready') {
      return { kind: 'wait', stage: stage.id, ready: whenPrepared(item, stage) }
    }
    try {
      const answer = stage.ready(item, sourceIndex)
      return answer === true ? { kind: 'ok' } : { kind: 'wait', stage: stage.id, ready: answer.ready }
    } catch (error) {
      return { kind: 'fail', stage: stage.id, error: asStageError(error, item, stage, sourceIndex) }
    }
  }

  /** The output size of each stage of `run`, from the source's; a stage still waiting for its size is a `Check` */
  const chainSizes = (
    item: VideoItem,
    run: readonly SourceStage[],
    source: Size,
    sourceIndex: number,
  ): Size[] | Exclude<Check, { kind: 'ok' }> => {
    const sizes: Size[] = []
    let size = source
    for (const stage of run) {
      let out: Size | ReturnType<SourceStage['outputSize']>
      try {
        out = stage.outputSize(item, size)
      } catch (error) {
        return { kind: 'fail', stage: stage.id, error: asStageError(error, item, stage, sourceIndex) }
      }
      if (isNotReady(out)) return { kind: 'wait', stage: stage.id, ready: out.ready }
      sizes.push(out)
      size = out
    }
    return sizes
  }

  const takeTemp = (size: Size, taken: GPUTexture[]): GPUTexture => {
    const key = `${size.width}x${size.height}`
    const free = temps.get(key) ?? []
    temps.set(key, free)
    const texture =
      free.find((candidate) => !taken.includes(candidate)) ??
      createTexture(size, 'stage-intermediate')
    if (!free.includes(texture)) free.push(texture)
    taken.push(texture)
    return texture
  }

  /** The texture the clip's picture is recorded into: its own when the size still fits, a new one otherwise */
  const targetFor = (item: VideoItem, size: Size): GPUTexture => {
    const clip = clips.get(item.id)
    if (clip && sameSize(clip, size)) return clip.texture
    return createTexture(size, 'staged-picture')
  }

  const remember = (item: VideoItem, texture: GPUTexture, size: Size, good: boolean): void => {
    const previous = clips.get(item.id)
    if (previous && previous.texture !== texture) previous.texture.destroy()
    clips.delete(item.id)
    clips.set(item.id, { texture, width: size.width, height: size.height, good })
    while (clips.size > HELD_CLIPS) {
      const [oldestId, oldest] = clips.entries().next().value as [string, ClipPicture]
      oldest.texture.destroy()
      clips.delete(oldestId)
    }
  }

  /** Records `run` on the frame and submits: the clip's picture, or a thrown `StageError` with nothing submitted */
  const record = (
    item: VideoItem,
    frame: SourceFrame,
    run: readonly SourceStage[],
    sizes: readonly Size[],
    sourceIndex: number,
  ): { texture: GPUTexture; size: Size } => {
    const size = sizes.at(-1) ?? { width: frame.width, height: frame.height }
    const target = targetFor(item, size)
    const taken: GPUTexture[] = []
    const encoder = device.createCommandEncoder({ label: 'source stages' })
    // Timings on (the bench): each stage is submitted alone and timed to completion; off, one encoder, one submit.
    const timed = stageTimingsEnabled()
    if (timed) gpuClock ??= gpuStageClock(device.queue)
    arena.beginFrame()
    try {
      let input = frame.texture
      run.forEach((stage, index) => {
        const output = index === run.length - 1 ? target : takeTemp(sizes[index]!, taken)
        const stageEncoder = timed
          ? device.createCommandEncoder({ label: `stage ${stage.id}` })
          : encoder
        try {
          stage.encode(env, stageEncoder, item, sourceIndex, input, output)
          if (timed) {
            device.queue.submit([stageEncoder.finish()])
            gpuClock?.submitted(stage.id)
          }
        } catch (error) {
          throw asStageError(error, item, stage, sourceIndex)
        }
        input = output
      })
      if (run.length === 0) {
        encoder.copyTextureToTexture({ texture: frame.texture }, { texture: target }, size)
      }
      device.queue.submit([encoder.finish()])
    } catch (error) {
      if (target !== clips.get(item.id)?.texture) target.destroy()
      throw error
    } finally {
      void arena.endFrame()
    }
    return { texture: target, size }
  }

  /**
   * The clip's source frame, or a `StageError` naming the clip, its first stage and the frame when the decoder cannot
   * give it (a file the browser cannot open, a missing cleaned piece, a wrong frame): the clip is never drawn another
   * way instead (design 3.6 section 2.10).
   */
  async function decoded(
    item: VideoItem,
    stage: StageErrorStage,
    sourceIndex: number,
    acquire: () => Promise<SourceFrame>,
  ): Promise<SourceFrame> {
    try {
      return await acquire()
    } catch (error) {
      if (error instanceof StageError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new StageError({
        clip: clipName(item),
        stage,
        sourceIndex,
        reason: `its source frame could not be decoded: ${reason}`,
        cause: error,
      })
    }
  }

  /** Asks for the clip's frame again (once) when everything it waits for has arrived */
  const redrawWhenReady = (item: VideoItem, waits: readonly Promise<void>[]): void => {
    if (awaitingReady.has(item.id)) return
    awaitingReady.add(item.id)
    void Promise.all(waits)
      .catch(() => undefined)
      .then(() => {
        awaitingReady.delete(item.id)
        if (!destroyed) options.onReady?.(item)
      })
  }

  /**
   * The preview's answer for a clip that cannot be drawn with all its stages: its state (a failure first), a redraw
   * when what it waits for arrives, and its last good frame when it has one. `null` when nothing blocks it, or when it
   * has no good frame to hold.
   */
  const blocked = (item: VideoItem, checks: readonly Check[]): StagedFrame | null => {
    const failure = checks.find((answer) => answer.kind === 'fail')
    const waits = checks.flatMap((answer) => (answer.kind === 'wait' ? [answer] : []))
    const first = failure ?? waits[0]
    if (first === undefined) return null
    options.onState?.(item, stateOf(first))
    if (failure === undefined)
      redrawWhenReady(
        item,
        waits.map((answer) => answer.ready),
      )
    const held = clips.get(item.id)
    return held?.good ? { ...held, kind: 'held' } : null
  }

  async function renderExport(
    item: VideoItem,
    sourceIndex: number,
    source: { acquire(): Promise<SourceFrame>; release(frame: SourceFrame): void },
  ): Promise<StagedFrame> {
    const stages = registry.activeStages(item)
    await ensurePrepared(item, stages)
    await untilReady(item, sourceIndex, () =>
      stages.map((stage) => check(item, stage, sourceIndex)),
    )
    const frame = await decoded(item, stages[0]?.id ?? 'motion-blur', sourceIndex, () => source.acquire())
    try {
      let sizes: Size[] = []
      await untilReady(item, sourceIndex, () => {
        const answer = chainSizes(item, stages, frame, sourceIndex)
        if (!Array.isArray(answer)) return [answer]
        sizes = answer
        return []
      })
      const { texture, size } = record(item, frame, stages, sizes, sourceIndex)
      remember(item, texture, size, true)
      return { texture, width: size.width, height: size.height, kind: 'fresh' }
    } finally {
      source.release(frame)
    }
  }

  /** An export's preparation: every active stage of the clip ready, or the preparer asked to make it so */
  async function ensurePrepared(item: VideoItem, stages: readonly SourceStage[]): Promise<void> {
    if (stages.some((stage) => preparer.statusOf(item, stage.id)?.status !== 'ready')) {
      await preparer.prepareAll([item], device)
    }
  }

  /**
   * The preview's short wait, before a clip is held: up to `PREVIEW_WAIT_MS` for what `checks` wait for. Whether it
   * waited, in which case the caller asks its stages again; a failure, or nothing to wait for, answers at once.
   */
  async function waitedBriefly(checks: readonly Check[]): Promise<boolean> {
    if (checks.some((answer) => answer.kind === 'fail')) return false
    const waits = checks.flatMap((answer) => (answer.kind === 'wait' ? [answer.ready] : []))
    if (waits.length === 0) return false
    // A wait that rejects is reported by the stage's next answer
    await settledWithin(waits, PREVIEW_WAIT_MS).catch(() => false)
    return true
  }

  /** The export's wait: asks `answers` again after each wait, throws the first failure, and gives up when stuck */
  async function untilReady(
    item: VideoItem,
    sourceIndex: number,
    answers: () => readonly Check[],
  ): Promise<void> {
    const deadline = Date.now() + EXPORT_WAIT_MS
    for (let attempt = 0; ; attempt += 1) {
      const checks = answers()
      const failure = checks.find((answer) => answer.kind === 'fail')
      if (failure?.kind === 'fail') throw failure.error
      const waits = checks.flatMap((answer) => (answer.kind === 'wait' ? [answer] : []))
      if (waits.length === 0) return
      if (attempt >= EXPORT_WAITS) {
        throw new StageError({
          clip: clipName(item),
          stage: waits[0]!.stage,
          sourceIndex,
          reason: `what it needs for the frame did not arrive after ${EXPORT_WAITS} waits`,
        })
      }
      const left = deadline - Date.now()
      if (left <= 0 || !(await settledWithin(waits.map((answer) => answer.ready), left))) {
        throw new StageError({
          clip: clipName(item),
          stage: waits[0]!.stage,
          sourceIndex,
          reason: `what it needs for the frame did not arrive within ${EXPORT_WAIT_MS / 1000} s`,
        })
      }
    }
  }

  async function renderPreview(
    item: VideoItem,
    sourceIndex: number,
    source: { acquire(): Promise<SourceFrame>; release(frame: SourceFrame): void },
  ): Promise<StagedFrame> {
    const stages = registry.activeStages(item)
    const ask = () => stages.map((stage) => check(item, stage, sourceIndex))
    let checks = ask()
    if (await waitedBriefly(checks)) checks = ask()
    const held = blocked(item, checks)
    if (held) return held
    // No good frame to hold: the source with the stages that can draw
    const run = stages.filter((_stage, index) => checks[index]!.kind === 'ok')
    let frame: SourceFrame
    try {
      frame = await decoded(item, stages[0]?.id ?? 'motion-blur', sourceIndex, () => source.acquire())
    } catch (error) {
      // A decoder that cannot give the frame is the clip's failure: shown, and the last good frame held
      const heldOnFailure = blocked(item, [{ kind: 'fail', stage: stages[0]?.id ?? 'motion-blur', error: error as StageError }])
      if (heldOnFailure) return heldOnFailure
      throw error
    }
    try {
      return drawWhatCan(item, frame, run, stages.length, sourceIndex)
    } finally {
      source.release(frame)
    }
  }

  /** The provider as the preview's source of a frame */
  const fromProvider = (item: VideoItem, sourceIndex: number) => ({
    acquire: () => provider.frameAt(item, sourceIndex),
    release: (frame: SourceFrame) => provider.release(frame),
  })

  /**
   * Records the stages of `run` that can draw the frame: a stage still waiting for its size, or failing as it records,
   * leaves the run (or the clip's last good frame is held instead); an empty run copies the source.
   */
  function drawWhatCan(
    item: VideoItem,
    frame: SourceFrame,
    start: readonly SourceStage[],
    activeCount: number,
    sourceIndex: number,
  ): StagedFrame {
    let run = start
    for (;;) {
      const sizes = chainSizes(item, run, frame, sourceIndex)
      const answer = Array.isArray(sizes) ? tryRecord(item, frame, run, sizes, sourceIndex) : sizes
      if ('texture' in answer) {
        const fresh = run.length === activeCount
        remember(item, answer.texture, answer.size, fresh)
        if (fresh) options.onState?.(item, null)
        const { width, height } = answer.size
        return { texture: answer.texture, width, height, kind: fresh ? 'fresh' : 'partial' }
      }
      const heldNow = blocked(item, [answer])
      if (heldNow) return heldNow
      run = run.filter((stage) => stage.id !== answer.stage)
    }
  }

  /** `record`, with a stage's `StageError` as its failed check */
  function tryRecord(
    item: VideoItem,
    frame: SourceFrame,
    run: readonly SourceStage[],
    sizes: readonly Size[],
    sourceIndex: number,
  ): { texture: GPUTexture; size: Size } | Extract<Check, { kind: 'fail' }> {
    try {
      return record(item, frame, run, sizes, sourceIndex)
    } catch (error) {
      const stage = error instanceof StageError ? run.find((c) => c.id === error.stage) : undefined
      if (stage === undefined) throw error
      return { kind: 'fail', stage: stage.id, error: error as StageError }
    }
  }

  // --- The gather (design 7.2 B): N samples through the source-frame stages, averaged, then the output-frame stages ---

  const gathers = new Map<string, MotionBlurStage>()
  const makeGather = options.gather ?? createMotionBlurStage
  /** Gathered renders take turns: the accumulator of a size is one texture, and a render awaits between its samples */
  let gatherTail: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(run: () => Promise<T>): Promise<T> => {
    const turn = gatherTail.then(run, run)
    gatherTail = turn.catch(() => undefined)
    return turn
  }

  const gatherFor = async (size: Size): Promise<MotionBlurStage> => {
    const key = `${size.width}x${size.height}`
    const known = gathers.get(key)
    if (known !== undefined) return known
    const made = await makeGather(device, STAGED_FORMAT, size)
    if (destroyed) {
      made.destroy()
      throw new Error('stage pipeline: destroyed while the motion blur was being built')
    }
    gathers.set(key, made)
    return made
  }

  const gatherError = (item: VideoItem, sourceIndex: number, error: unknown): StageError =>
    error instanceof StageError
      ? error
      : new StageError({
          clip: clipName(item),
          stage: 'motion-blur',
          sourceIndex,
          reason: error instanceof Error ? error.message : String(error),
          cause: error,
        })

  /** Records `run` from `input`, the last stage into `last` (an intermediate when there is none); returns the output */
  const encodeRun = (
    encoder: GPUCommandEncoder,
    item: VideoItem,
    run: readonly SourceStage[],
    sizes: readonly Size[],
    sourceIndex: number,
    input: GPUTexture,
    last: GPUTexture | undefined,
    taken: GPUTexture[],
  ): GPUTexture => {
    const timed = stageTimingsEnabled()
    if (timed) gpuClock ??= gpuStageClock(device.queue)
    let current = input
    run.forEach((stage, index) => {
      const output =
        index === run.length - 1 && last !== undefined ? last : takeTemp(sizes[index]!, taken)
      const stageEncoder = timed
        ? device.createCommandEncoder({ label: `stage ${stage.id}` })
        : encoder
      try {
        stage.encode(env, stageEncoder, item, sourceIndex, current, output)
        if (timed) {
          device.queue.submit([stageEncoder.finish()])
          gpuClock?.submitted(stage.id)
        }
      } catch (error) {
        throw asStageError(error, item, stage, sourceIndex)
      }
      current = output
    })
    return current
  }

  /**
   * One group of samples (at most `MAX_SAMPLES_PER_PASS`): each one's source-frame stages, then one gather pass over
   * all of them, in one command buffer submitted on its own. `output` is the texture the pass encodes into (the
   * `only` and `last` steps).
   */
  const recordGroup = (
    item: VideoItem,
    frames: readonly SourceFrame[],
    group: readonly SourceSample[],
    run: readonly SourceStage[],
    sizes: readonly Size[],
    gather: MotionBlurStage,
    step: GatherStep,
    output?: GPUTextureView,
  ): void => {
    const encoder = device.createCommandEncoder({ label: `motion blur ${step}` })
    arena.beginFrame()
    try {
      // The pictures of one group are alive together: one list of taken temporaries keeps them apart
      const taken: GPUTexture[] = []
      const pictures = frames.map((frame, index) =>
        encodeRun(encoder, item, run, sizes, group[index]!.index, frame.texture, undefined, taken),
      )
      try {
        gather.pass(
          encoder,
          arena,
          pictures.map((picture, index) => ({ view: picture.createView(), weight: group[index]!.weight })),
          step,
          output,
        )
      } catch (error) {
        throw gatherError(item, group[0]!.index, error)
      }
      device.queue.submit([encoder.finish()])
    } finally {
      void arena.endFrame()
    }
  }

  /**
   * The clip's staged picture from the gather's last pass: `write` records that pass into the texture it is given (the
   * clip's picture, or an intermediate the output-frame stages then run on).
   */
  const recordFinal = (
    item: VideoItem,
    gather: { readonly size: Size },
    run: readonly SourceStage[],
    sizes: readonly Size[],
    sourceIndex: number,
    write: (into: GPUTextureView) => void,
  ): { texture: GPUTexture; size: Size } => {
    const size = sizes.at(-1) ?? gather.size
    const target = targetFor(item, size)
    const taken: GPUTexture[] = []
    try {
      const into = run.length === 0 ? target : takeTemp(gather.size, taken)
      write(into.createView())
      if (run.length > 0) {
        const encoder = device.createCommandEncoder({ label: 'output stages' })
        arena.beginFrame()
        try {
          encodeRun(encoder, item, run, sizes, sourceIndex, into, target, taken)
          device.queue.submit([encoder.finish()])
        } finally {
          void arena.endFrame()
        }
      }
    } catch (error) {
      if (target !== clips.get(item.id)?.texture) target.destroy()
      throw error
    }
    return { texture: target, size }
  }

  /** The samples in groups of `MAX_SAMPLES_PER_PASS`, each with its step in the gather */
  const groupsOf = (samples: readonly SourceSample[]): Array<{ group: SourceSample[]; step: GatherStep }> => {
    const count = Math.ceil(samples.length / MAX_SAMPLES_PER_PASS)
    return Array.from({ length: count }, (_, index) => ({
      group: samples.slice(index * MAX_SAMPLES_PER_PASS, (index + 1) * MAX_SAMPLES_PER_PASS),
      step: count === 1 ? 'only' : index === 0 ? 'first' : index === count - 1 ? 'last' : 'middle',
    }))
  }

  /**
   * Fills `frames` with the group's frames (`first`, the plan's first frame, is the first group's first; every frame
   * must be its size); every frame is pushed as soon as it is
   * held, so the caller gives all of them back whatever fails here.
   */
  async function fetchGroup(
    item: VideoItem,
    group: readonly SourceSample[],
    frames: SourceFrame[],
    first: SourceFrame,
    isFirstGroup: boolean,
  ): Promise<void> {
    for (const sample of group) {
      const frame =
        isFirstGroup && frames.length === 0
          ? first
          : await decoded(item, 'motion-blur', sample.index, () => provider.frameAt(item, sample.index))
      frames.push(frame)
      // Marked runs only: the queue's time to finish what decoding the frame queued (its upload and widening)
      if (stageTimingsEnabled()) {
        await timedStageAsync('gather.upload-gpu', () => device.queue.onSubmittedWorkDone())
      }
      if (frame.width !== first.width || frame.height !== first.height) {
        throw new StageError({
          clip: clipName(item),
          stage: 'motion-blur',
          sourceIndex: sample.index,
          reason: `its frames differ in size (${frame.width}x${frame.height} against ${first.width}x${first.height})`,
        })
      }
    }
  }

  /**
   * Decodes the samples in groups of `MAX_SAMPLES_PER_PASS` and gathers each group in one pass (each frame goes back
   * to the provider right after its group's submit): four samples are one pass into the output.
   */
  async function runGather(
    item: VideoItem,
    samples: readonly SourceSample[],
    sourceRun: readonly SourceStage[],
    outputRun: readonly SourceStage[],
    sizes: { source: readonly Size[]; output: readonly Size[] },
    first: SourceFrame,
    gather: MotionBlurStage,
  ): Promise<{ texture: GPUTexture; size: Size }> {
    const groups = groupsOf(samples)
    for (const [groupIndex, { group, step }] of groups.entries()) {
      const frames: SourceFrame[] = []
      try {
        await fetchGroup(item, group, frames, first, groupIndex === 0)
        const record = (into?: GPUTextureView) =>
          timedStage('gather.record', () =>
            recordGroup(item, frames, group, sourceRun, sizes.source, gather, step, into),
          )
        if (groupIndex < groups.length - 1) {
          record()
          continue
        }
        const done = recordFinal(item, gather, outputRun, sizes.output, samples[0]!.index, record)
        // Marked runs only: how long the queue takes to finish the frame's passes after the last submit
        if (stageTimingsEnabled()) {
          await timedStageAsync('gather.gpu', () => device.queue.onSubmittedWorkDone())
        }
        return done
      } finally {
        for (const frame of frames) provider.release(frame)
      }
    }
    throw new RangeError('stage pipeline: a source frame plan has no sample')
  }

  /** The stages of a plan's clip by scope */
  const byScope = (item: VideoItem) => {
    const stages = registry.activeStages(item)
    return {
      stages,
      source: stages.filter((stage) => stage.scope === 'source-frame'),
      output: stages.filter((stage) => stage.scope !== 'source-frame'),
    }
  }

  /** The sizes of both runs from the first frame's, or the check of the stage still waiting for its size */
  const gatherSizes = (
    item: VideoItem,
    sourceRun: readonly SourceStage[],
    outputRun: readonly SourceStage[],
    frame: Size,
    sourceIndex: number,
  ): { source: Size[]; output: Size[] } | Exclude<Check, { kind: 'ok' }> => {
    const source = chainSizes(item, sourceRun, frame, sourceIndex)
    if (!Array.isArray(source)) return source
    const output = chainSizes(item, outputRun, source.at(-1) ?? frame, sourceIndex)
    if (!Array.isArray(output)) return output
    return { source, output }
  }

  async function renderGatheredExport(
    item: VideoItem,
    samples: readonly SourceSample[],
  ): Promise<StagedFrame> {
    const { stages, source: sourceRun, output: outputRun } = byScope(item)
    const firstIndex = samples[0]!.index
    await ensurePrepared(item, stages)
    await untilReady(item, firstIndex, () => [
      ...sourceRun.flatMap((stage) => samples.map((sample) => check(item, stage, sample.index))),
      ...outputRun.map((stage) => check(item, stage, firstIndex)),
    ])
    const first = await decoded(item, 'motion-blur', firstIndex, () =>
      provider.frameAt(item, firstIndex),
    )
    let sizes = { source: [] as Size[], output: [] as Size[] }
    let gather: MotionBlurStage
    try {
      await untilReady(item, firstIndex, () => {
        const answer = gatherSizes(item, sourceRun, outputRun, first, firstIndex)
        if ('kind' in answer) return [answer]
        sizes = answer
        return []
      })
      gather = await gatherFor(sizes.source.at(-1) ?? first)
    } catch (error) {
      provider.release(first)
      throw error
    }
    const { texture, size } = await runGather(item, samples, sourceRun, outputRun, sizes, first, gather)
    remember(item, texture, size, true)
    return { texture, width: size.width, height: size.height, kind: 'fresh' }
  }

  /** A stage's answer over every sample it runs on: the first that is not ok */
  const firstBlocking = (answers: readonly Check[]): Check => answers.find((a) => a.kind !== 'ok') ?? { kind: 'ok' }

  async function renderGatheredPreview(
    item: VideoItem,
    samples: readonly SourceSample[],
  ): Promise<StagedFrame> {
    const { stages, source, output } = byScope(item)
    const firstIndex = samples[0]!.index
    const ask = () => ({
      sourceChecks: source.map((stage) => firstBlocking(samples.map((sample) => check(item, stage, sample.index)))),
      outputChecks: output.map((stage) => check(item, stage, firstIndex)),
    })
    let answers = ask()
    if (await waitedBriefly([...answers.sourceChecks, ...answers.outputChecks])) answers = ask()
    const { sourceChecks, outputChecks } = answers
    const held = blocked(item, [...sourceChecks, ...outputChecks])
    if (held) return held
    // No good frame to hold: the samples with the stages that can draw
    const sourceRun = source.filter((_stage, index) => sourceChecks[index]!.kind === 'ok')
    const outputRun = output.filter((_stage, index) => outputChecks[index]!.kind === 'ok')
    let first: SourceFrame
    try {
      first = await decoded(item, 'motion-blur', firstIndex, () => provider.frameAt(item, firstIndex))
    } catch (error) {
      const heldOnFailure = blocked(item, [{ kind: 'fail', stage: 'motion-blur', error: error as StageError }])
      if (heldOnFailure) return heldOnFailure
      throw error
    }
    try {
      return await drawGatheredPreview(item, samples, sourceRun, outputRun, first, stages.length)
    } catch (error) {
      if (!(error instanceof StageError)) throw error
      const heldOnFailure = blocked(item, [{ kind: 'fail', stage: error.stage, error }])
      if (heldOnFailure) return heldOnFailure
      throw error
    }
  }

  /**
   * The preview's gathered picture from the first decoded frame: the stages that cannot size their output leave the
   * run (or the clip's last good frame is held instead). Owns `first`: it goes back to the provider in every case.
   */
  async function drawGatheredPreview(
    item: VideoItem,
    samples: readonly SourceSample[],
    startSource: readonly SourceStage[],
    startOutput: readonly SourceStage[],
    first: SourceFrame,
    activeCount: number,
  ): Promise<StagedFrame> {
    let sourceRun = startSource
    let outputRun = startOutput
    const firstIndex = samples[0]!.index
    for (;;) {
      const answer = gatherSizes(item, sourceRun, outputRun, first, firstIndex)
      if (!('kind' in answer)) {
        let gather: MotionBlurStage
        try {
          gather = await gatherFor(answer.source.at(-1) ?? first)
        } catch (error) {
          provider.release(first)
          throw error
        }
        // `runGather` gives every frame back, the first included
        const { texture, size } = await runGather(item, samples, sourceRun, outputRun, answer, first, gather)
        const fresh = sourceRun.length + outputRun.length === activeCount
        remember(item, texture, size, fresh)
        if (fresh) options.onState?.(item, null)
        return { texture, width: size.width, height: size.height, kind: fresh ? 'fresh' : 'partial' }
      }
      const heldNow = blocked(item, [answer])
      if (heldNow) {
        provider.release(first)
        return heldNow
      }
      sourceRun = sourceRun.filter((stage) => stage.id !== answer.stage)
      outputRun = outputRun.filter((stage) => stage.id !== answer.stage)
    }
  }

  // --- Optical-flow slow motion (task 11.12): the frame between two source frames, then every stage on it -------------

  const flows = new Map<string, OpticalFlow>()
  const makeFlow = options.flow ?? createOpticalFlow
  const gapFlows = new FlowGapCache<GapFlow>(
    mode === 'export' ? EXPORT_FLOW_GAPS : PREVIEW_FLOW_GAPS,
    mode === 'export',
  )
  /** The interpolated frame of each size: one is enough, interpolated renders take turns (`exclusive`) */
  const interpolated = new Map<string, GPUTexture>()

  /** The flow of a frame size at a motion detail (a clip's "Motion detail", design 11.24; the vector blur's is normal) */
  const flowFor = async (size: Size, detail: FlowDetail = 'normal'): Promise<OpticalFlow> => {
    const key = `${size.width}x${size.height}|${detail}`
    const known = flows.get(key)
    if (known !== undefined) return known
    const made = await makeFlow(device, STAGED_FORMAT, size, { detail })
    if (destroyed) {
      made.destroy()
      throw new Error('stage pipeline: destroyed while the optical flow was being built')
    }
    flows.set(key, made)
    return made
  }

  const interpolatedPicture = (size: Size): GPUTexture => {
    const key = `${size.width}x${size.height}`
    const known = interpolated.get(key)
    if (known !== undefined) return known
    const made = createTexture(size, 'interpolated-frame')
    interpolated.set(key, made)
    return made
  }

  /** The clip's optical-flow settings (design 11.24); absent, today's normal detail and mixed hard edges */
  const flowSettingsOfClip = (item: VideoItem) => ({
    detail: item.motionBlur?.flowDetail ?? 'normal',
    edges: item.motionBlur?.flowEdges ?? 'mix',
  })

  /**
   * The frame at `phase` between source frames `first` and `first + 1`, as the source a render reads (`acquire`): both
   * frames decoded, the gap's flows measured once (or taken from the cache), the frame drawn into the pipeline's own
   * texture and both frames given back. Every failure is a `StageError` of the motion blur, naming the source frame.
   */
  const interpolatedSource = (item: VideoItem, first: number, phase: number) => ({
    acquire: async (): Promise<SourceFrame> => {
      const frames: SourceFrame[] = []
      let measured: GapFlow | undefined
      try {
        const a = await decoded(item, 'motion-blur', first, () => provider.frameAt(item, first))
        frames.push(a)
        const b = await decoded(item, 'motion-blur', first + 1, () => provider.frameAt(item, first + 1))
        frames.push(b)
        if (!sameSize(a, b)) {
          throw new StageError({
            clip: clipName(item),
            stage: 'motion-blur',
            sourceIndex: first + 1,
            reason: `its frames differ in size (${b.width}x${b.height} against ${a.width}x${a.height})`,
          })
        }
        const { detail, edges } = flowSettingsOfClip(item)
        const flow = await flowFor(a, detail)
        const output = interpolatedPicture(a)
        const key = `${item.id}|${item.mediaId}|${first}|${a.origin}|${b.origin}|${a.width}x${a.height}|${detail}`
        const encoder = device.createCommandEncoder({ label: 'optical flow' })
        arena.beginFrame()
        try {
          let gap = gapFlows.get(key)
          if (gap === undefined) {
            measured = flow.measure(encoder, a.texture, b.texture)
            gap = measured
          }
          flow.interpolate(encoder, arena, a.texture, b.texture, gap, phase, output.createView(), { edges })
          device.queue.submit([encoder.finish()])
        } finally {
          void arena.endFrame()
        }
        // Kept only once its commands are submitted: a gap whose recording failed holds no flow
        if (measured !== undefined) gapFlows.set(key, item.id, first, measured)
        measured = undefined
        return { texture: output, index: first + phase, width: a.width, height: a.height, origin: a.origin }
      } catch (error) {
        measured?.destroy()
        throw gatherError(item, first, error)
      } finally {
        for (const frame of frames) provider.release(frame)
      }
    },
    // The interpolated frame is the pipeline's texture: nothing goes back to the provider
    release: () => undefined,
  })

  /** The staged picture of an interpolated frame: the frame as the source, every stage at its fractional position */
  function renderInterpolated(item: VideoItem, first: number, phase: number): Promise<StagedFrame> {
    const position = first + phase
    const source = interpolatedSource(item, first, phase)
    return mode === 'export' ? renderExport(item, position, source) : renderPreview(item, position, source)
  }


  // --- The vector motion blur (design 9.2): each sample blurred along each pixel's motion, then weighted ----------------

  const vectorStages = new Map<string, VectorBlurStage>()
  const makeVector = options.vector ?? createVectorBlurStage
  /** The flows of gaps between staged frames: keyed by everything the staged frames depend on (`stagedKey`) */
  const stagedGaps = new FlowGapCache<GapFlow>(
    mode === 'export' ? EXPORT_STAGED_GAPS : PREVIEW_STAGED_GAPS,
    mode === 'export',
  )
  /** The staged neighbour of the last frame drawn, kept as the next frame's own picture: least recently used first */
  const heldStaged = new Map<string, GPUTexture>()

  const vectorFor = async (size: Size, flowSize: Size): Promise<VectorBlurStage> => {
    const key = `${size.width}x${size.height}|${flowSize.width}x${flowSize.height}`
    const known = vectorStages.get(key)
    if (known !== undefined) return known
    const made = await makeVector(device, STAGED_FORMAT, size, flowSize)
    if (destroyed) {
      made.destroy()
      throw new Error('stage pipeline: destroyed while the motion blur was being built')
    }
    vectorStages.set(key, made)
    return made
  }

  /**
   * What a staged frame is a function of: the clip, its media, the source index, the staged size, the stages that ran
   * and everything they read (`sourceStageFingerprint`, the framing at the frame being drawn included). A gap's flow is
   * keyed by its first frame's.
   */
  const stagedKey = (item: VideoItem, index: number, run: readonly SourceStage[], size: Size): string =>
    `${item.id}|${item.mediaId}|${index}|${size.width}x${size.height}|${run.map((stage) => stage.id).join(',')}|${sourceStageFingerprint(item)}`

  const holdStaged = (key: string, texture: GPUTexture): void => {
    heldStaged.get(key)?.destroy()
    heldStaged.delete(key)
    heldStaged.set(key, texture)
    while (heldStaged.size > HELD_STAGED_FRAMES) {
      const [oldestKey, oldest] = heldStaged.entries().next().value as [string, GPUTexture]
      oldest.destroy()
      heldStaged.delete(oldestKey)
    }
  }

  /** Whether source frame `index` of the clip exists (the file's frame count, when the media record knows it) */
  const inFile = (item: VideoItem, index: number): boolean =>
    index >= 0 && (item.sourceDuration === undefined || index < item.sourceDuration)

  /** The source indices a vector plan's samples read: each sample's frame and its neighbours inside the file */
  const vectorIndices = (item: VideoItem, samples: readonly SourceSample[]): number[] => {
    const wanted = new Set<number>()
    for (const sample of samples) {
      for (const index of [sample.index - 1, sample.index, sample.index + 1]) if (inFile(item, index)) wanted.add(index)
    }
    return [...wanted].sort((a, b) => a - b)
  }

  /** One sample of a vector render, its decoded frames held until its commands are submitted */
  interface PreparedSample {
    readonly sample: SourceSample
    /** The picture's staged texture when it was held from the frame before; else staged from `frames` */
    readonly held?: GPUTexture
    /** The interpolated frame of a smooth slow motion (optical flow), staged at `first + phase` */
    readonly interpolated?: { readonly frame: SourceFrame; readonly phase: number }
    /** Decoded frames by source index, to stage */
    readonly frames: Map<number, SourceFrame>
    /** The gaps found in the cache, by their first index */
    readonly cached: Map<number, GapFlow>
    /** The gaps to measure now, by their first index */
    readonly toMeasure: readonly number[]
    /** The neighbour after, staged now, to be held for the next frame */
    readonly holdNext: boolean
  }

  /** The frames' holder of one sample: decodes each index once, the plan's first frame reused, sizes checked */
  const frameTaker = (item: VideoItem, first: SourceFrame | undefined, frames: Map<number, SourceFrame>) =>
    async (index: number): Promise<SourceFrame> => {
      const known = frames.get(index)
      if (known !== undefined) return known
      const frame =
        first !== undefined && first.index === index
          ? first
          : await decoded(item, 'motion-blur', index, () => provider.frameAt(item, index))
      frames.set(index, frame)
      const reference = first ?? frames.values().next().value!
      if (!sameSize(frame, reference)) {
        throw new StageError({
          clip: clipName(item),
          stage: 'motion-blur',
          sourceIndex: index,
          reason: `its frames differ in size (${frame.width}x${frame.height} against ${reference.width}x${reference.height})`,
        })
      }
      return frame
    }

  /** The gap starting at `gapFirst` from the cache, by its staged frames' key */
  const cachedGap = (item: VideoItem, gapFirst: number, run: readonly SourceStage[], size: Size): GapFlow | undefined =>
    stagedGaps.get(`gap|${stagedKey(item, gapFirst, run, size)}`)

  /**
   * What the frame between source frames `i` and `i + 1` needs (smooth slow motion by optical flow): the interpolated
   * frame, and the gap between the two staged frames, whose motion it is blurred by.
   */
  async function prepareInterpolatedSample(
    item: VideoItem,
    sample: SourceSample,
    phase: number,
    run: readonly SourceStage[],
    size: Size,
    take: (index: number) => Promise<SourceFrame>,
    frames: Map<number, SourceFrame>,
  ): Promise<PreparedSample> {
    const i = sample.index
    const frame = await interpolatedSource(item, i, phase).acquire()
    const gap = cachedGap(item, i, run, size)
    if (gap === undefined) {
      await take(i)
      await take(i + 1)
    }
    return {
      sample,
      interpolated: { frame, phase },
      frames,
      cached: gap === undefined ? new Map() : new Map([[i, gap]]),
      toMeasure: gap === undefined ? [i] : [],
      holdNext: false,
    }
  }

  /**
   * Decodes what sample `sample` needs: its frame (unless its staged picture is held from the frame before) and the
   * frames of the gaps around it that the cache does not hold. `first`, when given, is the plan's first frame, already
   * decoded. Every frame is put in `frames` as soon as it is held, so the caller gives all of them back whatever fails.
   */
  async function prepareVectorSample(
    item: VideoItem,
    sample: SourceSample,
    flowPhase: number | undefined,
    run: readonly SourceStage[],
    size: Size,
    first: SourceFrame | undefined,
    frames: Map<number, SourceFrame>,
  ): Promise<PreparedSample> {
    const take = frameTaker(item, first, frames)
    if (flowPhase !== undefined) return prepareInterpolatedSample(item, sample, flowPhase, run, size, take, frames)
    const i = sample.index
    const key = stagedKey(item, i, run, size)
    const held = heldStaged.get(key)
    if (held !== undefined) {
      // used now: the most recently used, kept until two newer neighbours push it out
      heldStaged.delete(key)
      heldStaged.set(key, held)
    }
    const cached = new Map<number, GapFlow>()
    const toMeasure: number[] = []
    for (const gapFirst of [i - 1, i].filter((g) => inFile(item, g) && inFile(item, g + 1))) {
      const gap = cachedGap(item, gapFirst, run, size)
      if (gap !== undefined) cached.set(gapFirst, gap)
      else toMeasure.push(gapFirst)
    }
    // the gaps measured now need both their frames; a held picture stands in for frame i
    const needed = new Set(toMeasure.flatMap((gapFirst) => [gapFirst, gapFirst + 1]))
    needed.add(i)
    if (held !== undefined) needed.delete(i)
    for (const index of [...needed].sort((a, b) => a - b)) await take(index)
    // the neighbour after is staged into a texture of its own when it is measured now and the run changes the frame
    return { sample, held, frames, cached, toMeasure, holdNext: toMeasure.includes(i) && run.length > 0 }
  }

  /**
   * The blurred sample's picture and gaps: the interpolated frame staged at its fractional position with the gap it
   * lies in (from its nearer frame's side), or the staged frame with the gaps before and after it.
   */
  function vectorSampleOf(
    item: VideoItem,
    prepared: PreparedSample,
    encoder: GPUCommandEncoder,
    run: readonly SourceStage[],
    sizes: readonly Size[],
    taken: GPUTexture[],
    stage: (index: number) => GPUTexture,
    gapOf: (gapFirst: number) => GapFlow | undefined,
  ): VectorSample {
    const { sample, interpolated } = prepared
    const i = sample.index
    const base = { extent: sample.extent!, weight: sample.weight }
    if (interpolated !== undefined) {
      const picture = encodeRun(encoder, item, run, sizes, i + interpolated.phase, interpolated.frame.texture, undefined, taken)
      const gap = gapOf(i)
      if (gap === undefined) return { picture, ...base }
      return interpolated.phase <= 0.5 ? { picture, after: gap, ...base } : { picture, before: gap, ...base }
    }
    const before = gapOf(i - 1)
    const after = gapOf(i)
    return {
      picture: stage(i),
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
      ...base,
    }
  }

  /**
   * Records a prepared sample into one command buffer and submits it: the staged frames it needs, the gaps' flows it
   * measures, and the blur pass at `step` (into `output` for `only` and `last`). The measured gaps are cached and the
   * staged neighbour after is held only once the commands are submitted.
   */
  function recordVectorSample(
    item: VideoItem,
    prepared: PreparedSample,
    run: readonly SourceStage[],
    sizes: readonly Size[],
    size: Size,
    flow: OpticalFlow,
    vector: VectorBlurStage,
    step: GatherStep,
    output?: GPUTextureView,
  ): void {
    const i = prepared.sample.index
    const encoder = device.createCommandEncoder({ label: `vector blur ${step}` })
    const measured = new Map<number, GapFlow>()
    let heldNext: GPUTexture | undefined
    arena.beginFrame()
    try {
      const taken: GPUTexture[] = []
      const staged = new Map<number, GPUTexture>(prepared.held !== undefined ? [[i, prepared.held]] : [])
      const stage = (index: number): GPUTexture => {
        const known = staged.get(index)
        if (known !== undefined) return known
        const frame = prepared.frames.get(index)
        if (frame === undefined) throw new Error(`vector blur: source frame ${index} was not decoded`)
        if (prepared.holdNext && index === i + 1) heldNext = createTexture(size, 'staged-neighbour')
        const texture = encodeRun(encoder, item, run, sizes, index, frame.texture, index === i + 1 ? heldNext : undefined, taken)
        staged.set(index, texture)
        return texture
      }
      for (const gapFirst of prepared.toMeasure) measured.set(gapFirst, flow.measure(encoder, stage(gapFirst), stage(gapFirst + 1)))
      const gapOf = (gapFirst: number) => prepared.cached.get(gapFirst) ?? measured.get(gapFirst)
      vector.pass(encoder, arena, vectorSampleOf(item, prepared, encoder, run, sizes, taken, stage, gapOf), step, output)
      device.queue.submit([encoder.finish()])
    } catch (error) {
      for (const gap of measured.values()) gap.destroy()
      heldNext?.destroy()
      throw gatherError(item, i, error)
    } finally {
      void arena.endFrame()
    }
    for (const [gapFirst, gap] of measured) {
      stagedGaps.set(`gap|${stagedKey(item, gapFirst, run, size)}`, item.id, gapFirst, gap)
    }
    if (heldNext !== undefined) holdStaged(stagedKey(item, i + 1, run, size), heldNext)
  }

  /** Frees the vector blur's flows, held frames and stages */
  function destroyVectorBlur(): void {
    stagedGaps.clear()
    for (const texture of heldStaged.values()) texture.destroy()
    heldStaged.clear()
    for (const vector of vectorStages.values()) vector.destroy()
    vectorStages.clear()
  }

  /** The gather's steps for `count` samples, one sample a pass */
  const vectorSteps = (count: number): GatherStep[] =>
    Array.from({ length: count }, (_, index) =>
      count === 1 ? 'only' : index === 0 ? 'first' : index === count - 1 ? 'last' : 'middle',
    )

  /**
   * Blurs every sample in order and adds it into the output frame, then runs the per-output-frame stages: the clip's
   * staged picture. Gives every decoded frame back, `first` included.
   */
  async function runVector(
    item: VideoItem,
    samples: readonly SourceSample[],
    flowPhase: number | undefined,
    sourceRun: readonly SourceStage[],
    outputRun: readonly SourceStage[],
    sizes: { source: readonly Size[]; output: readonly Size[] },
    first: SourceFrame,
  ): Promise<{ texture: GPUTexture; size: Size }> {
    // the plan's first frame goes to the first sample's frames, which give it back; if that sample did not need it
    // (its picture held, its gaps cached) or never ran, it goes back here
    const frames = new Map<number, SourceFrame>()
    // A frame between two source frames (smooth slow motion by optical flow) is one picture, the interpolated one; its
    // two samples are only the blend the interpolation falls back to inside
    const jobs = flowPhase !== undefined ? [{ ...samples[0]!, weight: 1 }] : samples
    try {
      const size = sizes.source.at(-1) ?? first
      const flow = await flowFor(size)
      const vector = await vectorFor(size, flow.flowSize)
      const steps = vectorSteps(jobs.length)
      let done: { texture: GPUTexture; size: Size } | undefined
      for (const [index, sample] of jobs.entries()) {
        frames.clear()
        const prepared = await prepareVectorSample(item, sample, flowPhase, sourceRun, size, index === 0 ? first : undefined, frames)
        const record = (into?: GPUTextureView) =>
          timedStage('gather.record', () =>
            recordVectorSample(item, prepared, sourceRun, sizes.source, size, flow, vector, steps[index]!, into),
          )
        if (index < jobs.length - 1) record()
        else done = recordFinal(item, vector, outputRun, sizes.output, jobs[0]!.index, record)
        releaseAll(frames, index === 0 ? first : undefined)
      }
      if (stageTimingsEnabled()) await timedStageAsync('gather.gpu', () => device.queue.onSubmittedWorkDone())
      return done!
    } catch (error) {
      releaseAll(frames, first)
      throw error
    }
  }

  /**
   * Gives back `frames`, and `first` when it is not among them (each once: a frame given back is removed, and `first`
   * is forgotten once given back)
   */
  function releaseAll(frames: Map<number, SourceFrame>, first: SourceFrame | undefined): void {
    for (const frame of frames.values()) provider.release(frame)
    if (first !== undefined && frames.get(first.index) !== first && !releasedFirsts.has(first)) provider.release(first)
    if (first !== undefined) releasedFirsts.add(first)
    frames.clear()
  }
  /** The plans' first frames already given back (an error after the first sample must not give one back twice) */
  const releasedFirsts = new WeakSet<SourceFrame>()

  /** The source stages' and output stages' answers for a vector plan: every frame it reads, and its moment */
  const vectorChecks = (
    item: VideoItem,
    samples: readonly SourceSample[],
    phase: number | undefined,
    source: readonly SourceStage[],
    output: readonly SourceStage[],
  ): { source: Check[]; output: Check[] } => {
    const firstIndex = samples[0]!.index
    const indices: number[] = [...vectorIndices(item, samples), ...(phase !== undefined ? [firstIndex + phase] : [])]
    return {
      source: source.map((stage) => firstBlocking(indices.map((index) => check(item, stage, index)))),
      output: output.map((stage) => check(item, stage, firstIndex)),
    }
  }

  async function renderVectorExport(
    item: VideoItem,
    samples: readonly SourceSample[],
    flow: { readonly phase: number } | undefined,
  ): Promise<StagedFrame> {
    const { stages, source: sourceRun, output: outputRun } = byScope(item)
    const firstIndex = samples[0]!.index
    await ensurePrepared(item, stages)
    await untilReady(item, firstIndex, () => {
      const checks = vectorChecks(item, samples, flow?.phase, sourceRun, outputRun)
      return [...checks.source, ...checks.output]
    })
    const first = await decoded(item, 'motion-blur', firstIndex, () => provider.frameAt(item, firstIndex))
    let sizes = { source: [] as Size[], output: [] as Size[] }
    try {
      await untilReady(item, firstIndex, () => {
        const answer = gatherSizes(item, sourceRun, outputRun, first, firstIndex)
        if ('kind' in answer) return [answer]
        sizes = answer
        return []
      })
    } catch (error) {
      provider.release(first)
      throw error
    }
    const { texture, size } = await runVector(item, samples, flow?.phase, sourceRun, outputRun, sizes, first)
    remember(item, texture, size, true)
    return { texture, width: size.width, height: size.height, kind: 'fresh' }
  }

  async function renderVectorPreview(
    item: VideoItem,
    samples: readonly SourceSample[],
    flow: { readonly phase: number } | undefined,
  ): Promise<StagedFrame> {
    const { stages, source, output } = byScope(item)
    let checks = vectorChecks(item, samples, flow?.phase, source, output)
    if (await waitedBriefly([...checks.source, ...checks.output])) checks = vectorChecks(item, samples, flow?.phase, source, output)
    const held = blocked(item, [...checks.source, ...checks.output])
    if (held) return held
    // No good frame to hold: the samples with the stages that can draw
    const sourceRun = source.filter((_stage, index) => checks.source[index]!.kind === 'ok')
    const outputRun = output.filter((_stage, index) => checks.output[index]!.kind === 'ok')
    try {
      return await drawVectorPreview(item, samples, flow?.phase, sourceRun, outputRun, stages.length)
    } catch (error) {
      // A frame that cannot be decoded or blurred is the clip's failure: shown, and the last good frame held
      if (!(error instanceof StageError)) throw error
      const heldOnFailure = blocked(item, [{ kind: 'fail', stage: error.stage, error }])
      if (heldOnFailure) return heldOnFailure
      throw error
    }
  }

  /**
   * The preview's blurred picture: the stages that cannot size their output leave the run (or the clip's last good
   * frame is held instead).
   */
  async function drawVectorPreview(
    item: VideoItem,
    samples: readonly SourceSample[],
    phase: number | undefined,
    startSource: readonly SourceStage[],
    startOutput: readonly SourceStage[],
    activeCount: number,
  ): Promise<StagedFrame> {
    const firstIndex = samples[0]!.index
    const first = await decoded(item, 'motion-blur', firstIndex, () => provider.frameAt(item, firstIndex))
    let sourceRun = startSource
    let outputRun = startOutput
    for (;;) {
      const answer = gatherSizes(item, sourceRun, outputRun, first, firstIndex)
      if (!('kind' in answer)) {
        // `runVector` gives every frame back, the first included
        const { texture, size } = await runVector(item, samples, phase, sourceRun, outputRun, answer, first)
        const fresh = sourceRun.length + outputRun.length === activeCount
        remember(item, texture, size, fresh)
        if (fresh) options.onState?.(item, null)
        return { texture, width: size.width, height: size.height, kind: fresh ? 'fresh' : 'partial' }
      }
      const heldNow = blocked(item, [answer])
      if (heldNow) {
        provider.release(first)
        return heldNow
      }
      sourceRun = sourceRun.filter((stage) => stage.id !== answer.stage)
      outputRun = outputRun.filter((stage) => stage.id !== answer.stage)
    }
  }

  return {
    render(item, source) {
      if (destroyed) return Promise.reject(new Error('stage pipeline: used after destroy'))
      let samples: readonly SourceSample[]
      try {
        samples = samplesOf(source)
      } catch (error) {
        return Promise.reject(error)
      }
      if (typeof source !== 'number' && samples.some((sample) => sample.extent !== undefined)) {
        return exclusive(() =>
          mode === 'export' ? renderVectorExport(item, samples, source.flow) : renderVectorPreview(item, samples, source.flow),
        )
      }
      if (samples.length === 1) {
        const sourceIndex = samples[0]!.index
        return mode === 'export'
          ? renderExport(item, sourceIndex, fromProvider(item, sourceIndex))
          : renderPreview(item, sourceIndex, fromProvider(item, sourceIndex))
      }
      const flow = typeof source === 'number' ? undefined : source.flow
      if (flow !== undefined) {
        return exclusive(() => renderInterpolated(item, samples[0]!.index, flow.phase))
      }
      return exclusive(() =>
        mode === 'export' ? renderGatheredExport(item, samples) : renderGatheredPreview(item, samples),
      )
    },

    renderFrame(item, frame) {
      if (destroyed) return Promise.reject(new Error('stage pipeline: used after destroy'))
      return renderPreview(item, frame.index, {
        acquire: () => Promise.resolve(frame),
        release: () => undefined,
      })
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      for (const clip of clips.values()) clip.texture.destroy()
      clips.clear()
      for (const list of temps.values()) for (const texture of list) texture.destroy()
      temps.clear()
      for (const gather of gathers.values()) gather.destroy()
      gathers.clear()
      gapFlows.clear()
      for (const flow of flows.values()) flow.destroy()
      flows.clear()
      for (const texture of interpolated.values()) texture.destroy()
      interpolated.clear()
      destroyVectorBlur()
      arena.destroy()
    },
  }
}
