// The stages of one renderer instance (design 3.6 sections 2.4, 2.9 and 2.10): what FreeCut's renderer
// (`client-render-engine.ts`) creates once, hands to its item renderers on the render context, and destroys at the end.
// It owns the renderer's source-frame provider and stage pipeline, both on the renderer's device, and it is how the
// renderer talks to the session's preparer:
//
//   export   `prepare` runs `prepareAll` before frame 0: every staged clip's engine is open, its size known and its
//            passes built, or the export stops with the first `StageError`;
//   preview  `prepare` starts the preparations in the background (`ensure`), the page's preparer follows the timeline
//            from then on, and a held frame that becomes drawable asks the preview to draw again.
//
// The WebCodecs backend decodes the frames (mediabunny, the decoder FreeCut uses). While a native 10-bit export runs in
// this realm (`precise/native-session.ts`), an export's provider reads every clip from its file on disk through the
// desktop's FFmpeg instead (`frames/backends/native.ts`, design 3.6 section 2.16).

import { createMediabunnySampleReader } from '@/studio/render/frames/backends/mediabunny-reader'
import { nativeProviderOptions } from '@/studio/render/frames/backends/native'
import { rawTestBackendFor } from '@/studio/render/frames/backends/raw-test'
import { createWebCodecsBackend } from '@/studio/render/frames/backends/webcodecs'
import { createSourceFrameProvider } from '@/studio/render/frames/provider'
import type { FrameBackend, SourceFrameProvider } from '@/studio/render/frames/types'
import { sourceFrameTextureDescriptor } from '@/studio/render/frames/blit'
import { timedStage } from '@/studio/render/timings'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { notifyStagedFrameReady, setClipStageState } from './failure'
import type { SourceFramePlan } from './plan'
import { createStagePipeline, type StagedFrame, type StagePipeline } from './pipeline'
import type { Preparer } from './preparer'
import type { StageRegistry } from './registry'
import { MAX_SAMPLES_PER_PASS } from '@/studio/motion-blur/stage'
import { setProjectRate } from './predicates'
import { pagePreparer, setPreparerDevice, SOURCE_STAGES } from './session'

/** `GPUTextureUsage.COPY_DST`, as the spec numbers it (the module loads where there is no GPU) */
const COPY_DST = 0x02

/**
 * The provider's `maxSamples`: its default capacity is this plus one; the capacity below is set explicitly. A blurred
 * output frame has more samples than that, but the pipeline gathers them in groups (design 7.2 B) and gives a group's
 * frames back right after its submit, so at most `MAX_SAMPLES_PER_PASS` are held for a blurred clip.
 */
const MAX_SAMPLES = 1

/**
 * Frames the provider keeps: the group of a blurred clip being gathered (the gathers take turns), one frame for another
 * clip a frame can show at once (a transition's), and one more for the overlap with the next frame.
 */
const PROVIDER_CAPACITY = MAX_SAMPLES_PER_PASS + 2

export interface RendererStagesOptions {
  readonly mode: 'export' | 'preview'
  /** The project's rate: a clip with no `sourceFps` counts its frames at it */
  readonly projectFps: number
  /** The renderer's device (FreeCut's effects pipeline owns it); `null` when there is no GPU */
  readonly getDevice: () => Promise<GPUDevice | null>
  /** The tests' replacements */
  readonly registry?: StageRegistry
  readonly preparer?: Preparer
  readonly backend?: (device: GPUDevice) => FrameBackend
}

/** What the renderer's item renderers use */
export interface RendererStages {
  readonly mode: 'export' | 'preview'
  /** The device the staged pictures live on; `null` when there is no GPU */
  device(): Promise<GPUDevice | null>
  /**
   * Prepares the staged clips among `items` (sub-compositions' included). An export awaits every one and rejects with
   * the first `StageError`; a preview starts them and resolves at once.
   */
  prepare(items: readonly TimelineItem[]): Promise<void>
  /**
   * The clip's staged picture for source frame `sourceIndex` (the pipeline's `render`).
   *
   * @throws StageError in an export, when an active stage cannot draw the frame.
   */
  render(item: VideoItem, source: number | SourceFramePlan): Promise<StagedFrame>
  /**
   * The preview's staged picture of a frame FreeCut's own fast source decoded (its `<video>` or its decoder), for a
   * clip whose stages need no exact frame (input colour, a look): the image is copied into an `rgba16float` texture and
   * goes through the stages. Preview only: an export stages every clip
   * from the provider's exact frame.
   */
  stageImage(item: VideoItem, sourceIndex: number, image: StageableImage): Promise<StagedFrame>
  /** Destroys the pipeline and the provider */
  destroy(): void
}

/** A decoded picture FreeCut hands over, with its size */
export interface StageableImage {
  readonly source: GPUCopyExternalImageSource
  readonly width: number
  readonly height: number
}

/** The page's preparer follows the timeline once, from the first preview renderer on */
let followingTimeline = false

/** An item the engine can open in a worker, which has no timeline to read the project's rate from */
function withRate(item: TimelineItem, projectFps: number): TimelineItem {
  return item.type === 'video' && item.sourceFps === undefined
    ? { ...item, sourceFps: projectFps }
    : item
}

/** Creates the stages of one renderer instance. Nothing is built until the first staged clip needs it. */
export function createRendererStages(options: RendererStagesOptions): RendererStages {
  const { mode, projectFps } = options
  // The predicates ask about a clip alone: its source rate against this project's decides its blur's span
  setProjectRate(projectFps)
  const registry = options.registry ?? SOURCE_STAGES
  const preparer = options.preparer ?? pagePreparer()
  const deviceOf = async (): Promise<GPUDevice | null> => (await options.getDevice()) ?? null
  let built: Promise<{ provider: SourceFrameProvider; pipeline: StagePipeline }> | undefined
  let destroyed = false

  if (mode === 'preview' && options.preparer === undefined) {
    setPreparerDevice(async () => (await deviceOf()) ?? undefined)
    if (!followingTimeline) {
      followingTimeline = true
      void preparer.start()
    }
  }

  const requireDevice = async (): Promise<GPUDevice> => {
    const device = await deviceOf()
    if (device === null)
      throw new Error('The staged clips need WebGPU, and this renderer has no GPU device')
    return device
  }

  const build = () => {
    built ??= requireDevice().then((device) => {
      const provider = createSourceFrameProvider({
        backend: (options.backend ?? defaultBackend)(device),
        ...(options.backend === undefined ? nativeProviderOptions(device, mode) : {}),
        maxSamples: MAX_SAMPLES,
        capacity: PROVIDER_CAPACITY,
        mode,
        projectRate: projectFps,
      })
      const pipeline = createStagePipeline({
        device,
        mode,
        registry,
        preparer,
        provider,
        onState: (item, state) => setClipStageState(item.id, state),
        onReady: () => notifyStagedFrameReady(),
      })
      return { provider, pipeline }
    })
    return built
  }

  /**
   * The `rgba16float` texture a preview image is copied into, one per size: each is staged before the next is copied.
   * The browser widens the 8-bit picture on the copy itself, one GPU copy where the provider's frames take a copy and
   * a pass (task 8.2: the preview's GPU time per frame is what this path is short of).
   */
  const widened = new Map<string, GPUTexture>()
  const upload = (device: GPUDevice, image: StageableImage): GPUTexture =>
    timedStage('upload', () => {
      const { width, height } = image
      const key = `${width}x${height}`
      let target = widened.get(key)
      if (target === undefined) {
        const descriptor = sourceFrameTextureDescriptor(width, height)
        target = device.createTexture({ ...descriptor, usage: descriptor.usage | COPY_DST })
        widened.set(key, target)
      }
      device.queue.copyExternalImageToTexture(
        { source: image.source },
        { texture: target },
        { width, height },
      )
      return target
    })

  return {
    mode,
    device: deviceOf,

    async prepare(items) {
      const staged = items
        .filter((item) => item.type === 'video' && registry.activeStages(item).length > 0)
        .map((item) => withRate(item, projectFps))
      if (staged.length === 0) return
      const device = await requireDevice()
      if (mode === 'export') await preparer.prepareAll(staged, device)
      else preparer.ensure(staged, device)
    },

    async render(item, source) {
      if (destroyed) throw new Error('The renderer was disposed while a staged clip was drawn')
      const { pipeline } = await build()
      return pipeline.render(withRate(item, projectFps) as VideoItem, source)
    },

    async stageImage(item, sourceIndex, image) {
      if (destroyed) throw new Error('The renderer was disposed while a staged clip was drawn')
      if (mode === 'export') throw new Error('An export stages every clip from the exact source frame')
      const device = await requireDevice()
      const { pipeline } = await build()
      const texture = upload(device, image)
      return pipeline.renderFrame(withRate(item, projectFps) as VideoItem, {
        texture,
        index: sourceIndex,
        width: image.width,
        height: image.height,
        origin: 'webcodecs',
      })
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      for (const texture of widened.values()) texture.destroy()
      widened.clear()
      void built?.then(({ provider, pipeline }) => {
        pipeline.destroy()
        provider.destroy()
      })
    },
  }
}

function defaultBackend(device: GPUDevice): FrameBackend {
  // The golden kit's raw 10-bit files, while its switch is on (never in the app)
  return rawTestBackendFor(device) ?? createWebCodecsBackend(device, createMediabunnySampleReader())
}
