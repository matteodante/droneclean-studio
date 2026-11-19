import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { FrameCompositionScene } from '@/runtime/composition-runtime/utils/frame-scene'
import { setPreciseOutputSink } from '@/studio/render/precise/contract'
import type { MaskCanvasSettings } from './canvas-masks'
import type { CanvasPool } from './canvas-pool'
import type { CanvasSettings, ItemRenderContext } from './canvas-item-renderer'
import type { GpuPipelineManager } from './gpu-pipeline-manager'
import { FrameRenderPass, type FrameRenderDeps } from './frame-render-pass'
import { compositeFrameResults } from './frame-compositing'
import { frameNeedsRenderSeat, renderItemWithEffects } from './frame-render-tasks'
import { resolveFrameRenderOptimization } from './render-path-optimizer'
import { resolveFrameRenderScene } from '@/runtime/renderer/deps/composition-runtime-contract'

vi.mock('./frame-compositing', () => ({ compositeFrameResults: vi.fn() }))
vi.mock('./frame-render-tasks', () => ({
  renderItemWithEffects: vi.fn(async () => null),
  renderTransitionFallbackCanvas: vi.fn(),
  frameNeedsRenderSeat: vi.fn(() => false),
}))
vi.mock('./render-path-optimizer', () => ({ resolveFrameRenderOptimization: vi.fn() }))
vi.mock('@/runtime/renderer/deps/composition-runtime-contract', () => ({
  hasCornerPin: vi.fn(() => false),
  resolveFrameRenderScene: vi.fn(),
}))
vi.mock('./render-engine-predicates', () => ({ shouldRenderResolvedItemAtFrame: vi.fn(() => true) }))
vi.mock('./frame-occlusion', () => ({ isItemFullyOccluding: vi.fn(() => false) }))
vi.mock('./canvas-item-renderer', () => ({ renderTransitionToGpuTexture: vi.fn() }))

function item(id: string): TimelineItem {
  return {
    id,
    type: 'video',
    trackId: `track-${id}`,
    from: 0,
    durationInFrames: 30,
    label: id,
    mediaId: `media-${id}`,
    src: `blob:${id}`,
    sourceWidth: 320,
    sourceHeight: 180,
    sourceFps: 30,
    sourceStart: 0,
    sourceEnd: 30,
    sourceDuration: 30,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    volume: 0,
    transform: { x: 0, y: 0, width: 320, height: 180, rotation: 0, opacity: 1 },
  }
}

function createPass(options: {
  renderMode?: 'export' | 'preview'
  tasks?: TimelineItem[]
}): {
  pass: FrameRenderPass
  outputCtx: OffscreenCanvasRenderingContext2D
  contentCanvas: OffscreenCanvas
  compositeCanvas: OffscreenCanvas
  frameTexture: GPUTexture
  cacheRenderedFrame: ReturnType<typeof vi.fn>
  setupGpuCompositor: ReturnType<typeof vi.fn>
  ensureFrameGpuPipelines: ReturnType<typeof vi.fn>
} {
  const tasks = options.tasks ?? [item('clip')]
  const outputCtx = { drawImage: vi.fn(), fillStyle: '', fillRect: vi.fn() } as unknown as OffscreenCanvasRenderingContext2D
  const outputCanvas = { width: 320, height: 180 } as OffscreenCanvas
  const contentCanvas = { tag: 'content' } as unknown as OffscreenCanvas
  const contentCtx = {} as OffscreenCanvasRenderingContext2D
  const compositeCanvas = { tag: 'composite' } as unknown as OffscreenCanvas
  const frameTexture = { format: 'rgba16float', width: 320, height: 180 } as unknown as GPUTexture
  const cacheRenderedFrame = vi.fn()
  const setupGpuCompositor = vi.fn(async () => ({
    useGpuCompositor: true,
    gpuCompositeOutput: { canvas: compositeCanvas, ctx: {} as GPUCanvasContext },
  }))
  const ensureFrameGpuPipelines = vi.fn(async () => undefined)

  const resolveScene = vi.mocked(resolveFrameRenderScene)
  resolveScene.mockReturnValue({
    occlusionCutoffOrder: null,
    transitionsByTrackOrder: new Map(),
    renderTasks: tasks.map((task) => ({ type: 'item', item: task, trackOrder: 0 })),
  })
  vi.mocked(renderItemWithEffects).mockResolvedValue(null)
  vi.mocked(compositeFrameResults).mockResolvedValue({
    canvas: compositeCanvas,
    texture: frameTexture,
  })

  const deps: FrameRenderDeps = {
    gpu: {
      texturePool: {},
      compositor: {},
      maskManager: {},
      effects: {},
    } as unknown as GpuPipelineManager,
    canvasPool: {
      acquire: () => ({ canvas: contentCanvas, ctx: contentCtx }),
      release: vi.fn(),
    } as unknown as CanvasPool,
    canvasSettings: { width: 320, height: 180, fps: 30 } as CanvasSettings,
    backgroundColor: '#000000',
    maskSettings: { width: 320, height: 180, fps: 30 } as MaskCanvasSettings,
    itemRenderContext: {
      renderMode: options.renderMode ?? 'export',
      gpuPipeline: {} as ItemRenderContext['gpuPipeline'],
    } as unknown as ItemRenderContext,
    adjustmentLayers: [],
    lottieItems: [],
    transitionTrackOrderById: new Map(),
    videoExtractors: new Map(),
    sortedTracks: [],
    tracksTopToBottom: [],
    visibleTrackIds: new Set(),
    setupGpuCompositor,
    scrubbingCache: null,
    ctx: outputCtx,
    canvas: outputCanvas,
    renderMode: options.renderMode ?? 'export',
    scrubbingFrameCacheActive: false,
    lastRenderAborted: false,
    activePreviewFramePending: false,
    activePreviewFallbackUsed: false,
    cacheRenderedFrame,
    detectFrameGpuEffects: () => false,
    discardFrameResults: vi.fn(),
    ensureFrameGpuPipelines,
    ensureLottieOverridesFresh: async () => undefined,
    lottieOverridesAreStale: () => false,
    refreshFrameRenderContext: vi.fn(),
    resolveFrameSceneState: () => ({
      activeMasks: [],
      frameScene: {
        transitionFrameState: { activeTransitions: [], transitionClipIds: new Set<string>() },
      } as unknown as FrameCompositionScene,
    }),
    perfMarkIfEnabled: () => -1,
    getCurrentKeyframes: () => undefined,
    getCurrentItem: <TItem extends TimelineItem>(candidate: TItem) => candidate,
    getPreviewTransformOverride: undefined,
    getPreviewEffectsOverride: undefined,
    getPreviewCornerPinOverride: undefined,
    getLiveItemSnapshot: undefined,
  }

  return {
    pass: new FrameRenderPass(deps),
    outputCtx,
    contentCanvas,
    compositeCanvas,
    frameTexture,
    cacheRenderedFrame,
    setupGpuCompositor,
    ensureFrameGpuPipelines,
  }
}

beforeEach(() => {
  vi.mocked(resolveFrameRenderOptimization).mockReturnValue({
    shouldDirectRenderSingleTask: true,
    shouldUseDeferredGpuBatch: false,
  })
  vi.mocked(frameNeedsRenderSeat).mockReturnValue(false)
})

afterEach(() => {
  setPreciseOutputSink(null)
  vi.clearAllMocks()
})

describe('FrameRenderPass and the precise output', () => {
  it('composites the direct single-task frame and delivers the float texture to the sink', async () => {
    const deliver = vi.fn()
    setPreciseOutputSink({ deliver })
    const { pass, outputCtx, compositeCanvas, frameTexture } = createPass({})

    await pass.run(7)

    expect(renderItemWithEffects).toHaveBeenCalledTimes(1)
    const renderCall = vi.mocked(renderItemWithEffects).mock.calls[0]!
    expect(renderCall[2]).toBe(true)
    expect(compositeFrameResults).toHaveBeenCalledTimes(1)
    expect(deliver).toHaveBeenCalledTimes(1)
    const [deliveredTexture, deliveredFrame] = deliver.mock.calls[0] as [
      GPUTexture,
      { index: number; rate: { num: number; den: number }; durationFrames: number },
    ]
    expect(deliveredTexture).toBe(frameTexture)
    expect(deliveredTexture.format).toBe('rgba16float')
    expect(deliveredTexture.width).toBe(320)
    expect(deliveredTexture.height).toBe(180)
    expect(deliveredFrame).toEqual({
      index: 7,
      rate: { num: 30, den: 1 },
      durationFrames: 1,
    })
    expect(outputCtx.drawImage).toHaveBeenCalledWith(compositeCanvas, 0, 0)
  })

  it('delivers one frame for a multi-layer export', async () => {
    const deliver = vi.fn()
    setPreciseOutputSink({ deliver })
    const { pass } = createPass({ tasks: [item('top'), item('bottom')] })

    await pass.run(0)

    expect(renderItemWithEffects).toHaveBeenCalledTimes(2)
    expect(compositeFrameResults).toHaveBeenCalledTimes(1)
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('keeps the direct path and delivers nothing when no sink is registered', async () => {
    const { pass, outputCtx, cacheRenderedFrame } = createPass({})

    await pass.run(7)

    expect(renderItemWithEffects).toHaveBeenCalledTimes(1)
    const renderCall = vi.mocked(renderItemWithEffects).mock.calls[0]!
    expect(renderCall[2]).toBe(false)
    expect(renderCall[3]).toBe(outputCtx)
    expect(compositeFrameResults).not.toHaveBeenCalled()
    expect(outputCtx.drawImage).not.toHaveBeenCalled()
    expect(cacheRenderedFrame).toHaveBeenCalledWith(7)
  })

  it('never delivers a preview renderer’s frame, even while a sink is registered', async () => {
    const deliver = vi.fn()
    setPreciseOutputSink({ deliver })
    const { pass } = createPass({ renderMode: 'preview' })

    await pass.run(3)

    expect(compositeFrameResults).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
  })

  it('treats a frame with a seated clip as a GPU frame, so its texture can be composited', async () => {
    vi.mocked(frameNeedsRenderSeat).mockReturnValue(true)
    const { pass, setupGpuCompositor, ensureFrameGpuPipelines } = createPass({})

    await pass.run(0)

    expect(ensureFrameGpuPipelines).toHaveBeenCalledWith(true, false)
    expect(setupGpuCompositor).toHaveBeenCalledWith(true)
    expect(renderItemWithEffects).toHaveBeenCalledTimes(1)
  })

  it('fails loudly when a precise frame has no float texture', async () => {
    setPreciseOutputSink({ deliver: vi.fn() })
    const { pass } = createPass({})
    vi.mocked(compositeFrameResults).mockResolvedValue({
      canvas: {} as OffscreenCanvas,
      texture: null,
    })

    await expect(pass.run(0)).rejects.toThrow('The precise export produced no float frame')
  })
})
