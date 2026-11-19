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
//   export   a stage that is preparing or whose data is arriving is awaited; a stage that failed throws its
//            `StageError` and the export stops with that message. No frame is ever written without its active stages.
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
}

export interface StagePipeline {
  /**
   * The staged picture of source frame `sourceIndex` of the clip. The texture belongs to the pipeline and stays as it
   * is until the clip's next frame is staged: draw it before asking for the clip's next one.
   *
   * `source` is one source frame's index, or a plan (`sourceFramePlan`): with more than one sample, each sample goes
   * through the per-source-frame stages and the gather averages them in linear light (design 7.2 B) before the
   * per-output-frame stages. A plan with one sample is that frame, exactly as the index alone.
   *
   * @throws StageError in an export, when an active stage cannot draw the frame.
   * @throws RangeError when a plan has no sample or a weight that is not in (0, 1].
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
  return samples
}

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height
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

  async function renderExport(item: VideoItem, sourceIndex: number): Promise<StagedFrame> {
    const stages = registry.activeStages(item)
    if (stages.some((stage) => preparer.statusOf(item, stage.id)?.status !== 'ready')) {
      await preparer.prepareAll([item], device)
    }
    await untilReady(item, sourceIndex, () =>
      stages.map((stage) => check(item, stage, sourceIndex)),
    )
    const frame = await decoded(item, stages[0]?.id ?? 'motion-blur', sourceIndex, () =>
      provider.frameAt(item, sourceIndex),
    )
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
      provider.release(frame)
    }
  }

  /** The export's wait: asks `answers` again after each wait, throws the first failure, and gives up when stuck */
  async function untilReady(
    item: VideoItem,
    sourceIndex: number,
    answers: () => readonly Check[],
  ): Promise<void> {
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
      await Promise.all(waits.map((answer) => answer.ready))
    }
  }

  async function renderPreview(
    item: VideoItem,
    sourceIndex: number,
    source: { acquire(): Promise<SourceFrame>; release(frame: SourceFrame): void },
  ): Promise<StagedFrame> {
    const stages = registry.activeStages(item)
    const checks = stages.map((stage) => check(item, stage, sourceIndex))
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
    gather: MotionBlurStage,
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
    if (stages.some((stage) => preparer.statusOf(item, stage.id)?.status !== 'ready')) {
      await preparer.prepareAll([item], device)
    }
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
    const sourceChecks = source.map((stage) =>
      firstBlocking(samples.map((sample) => check(item, stage, sample.index))),
    )
    const outputChecks = output.map((stage) => check(item, stage, firstIndex))
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

  return {
    render(item, source) {
      if (destroyed) return Promise.reject(new Error('stage pipeline: used after destroy'))
      let samples: readonly SourceSample[]
      try {
        samples = samplesOf(source)
      } catch (error) {
        return Promise.reject(error)
      }
      if (samples.length === 1) {
        const sourceIndex = samples[0]!.index
        return mode === 'export'
          ? renderExport(item, sourceIndex)
          : renderPreview(item, sourceIndex, fromProvider(item, sourceIndex))
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
      arena.destroy()
    },
  }
}
