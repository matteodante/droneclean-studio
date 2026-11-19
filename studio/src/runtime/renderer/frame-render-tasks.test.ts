import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { setPreciseOutputSink } from '@/studio/render/precise/contract'
import {
  renderItem,
  renderItemGpuEffectsToTexture,
  renderTransitionToCanvas,
  type ItemRenderContext,
} from './canvas-item-renderer'
import type { CanvasPool } from './canvas-pool'
import type { PreparedMask } from './canvas-masks'
import type { ActiveTransition } from './canvas-transitions'
import type { GpuPipelineManager } from './gpu-pipeline-manager'
import {
  frameNeedsRenderSeat,
  renderItemWithEffects,
  renderTransitionFallbackCanvas,
  type FrameItemRenderDeps,
} from './frame-render-tasks'

vi.mock('@/shared/utils/mask-scope', () => ({ doesMaskAffectTrack: vi.fn() }))
vi.mock('./canvas-item-renderer', () => ({
  renderItem: vi.fn(async () => undefined),
  renderItemGpuEffectsToTexture: vi.fn(async () => true),
  renderPreviewVideoGpuEffectsToCanvas: vi.fn(() => null),
  renderTransitionToCanvas: vi.fn(),
}))
vi.mock('./canvas-effects', async (importOriginal) => {
  const original = await importOriginal<typeof import('./canvas-effects')>()
  return {
    ...original,
    renderEffectsFromMaskedSource: vi.fn(async () => ({
      source: { tag: 'effects-canvas' } as unknown as OffscreenCanvas,
      poolCanvases: [],
    })),
  }
})

function fakeCanvas(tag: string): OffscreenCanvas {
  return { tag } as unknown as OffscreenCanvas
}

function fakeMask(trackOrder: number): PreparedMask {
  return { inverted: false, feather: 0, opacity: 1, maskType: 'clip', trackOrder }
}

function fakePool(canvas: OffscreenCanvas): CanvasPool {
  return {
    acquire: () => ({ canvas, ctx: {} as OffscreenCanvasRenderingContext2D }),
  } as unknown as CanvasPool
}

const TASK = {
  transition: { id: 'tr1' } as unknown as ActiveTransition,
  trackOrder: 2,
}

describe('renderTransitionFallbackCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the transition to a pooled canvas and returns it', async () => {
    vi.mocked(doesMaskAffectTrack).mockReturnValue(false)
    const pooled = fakeCanvas('pooled')

    const result = await renderTransitionFallbackCanvas(TASK, {
      frame: 7,
      activeMasks: [],
      itemRenderContext: {} as ItemRenderContext,
      canvasPool: fakePool(pooled),
    })

    expect(result.source).toBe(pooled)
    expect(result.poolCanvases).toEqual([pooled])
    expect(renderTransitionToCanvas).toHaveBeenCalledTimes(1)
  })

  it('passes only the masks scoped to the transition track', async () => {
    // Affects track 2 only.
    vi.mocked(doesMaskAffectTrack).mockImplementation((maskOrder) => maskOrder === 2)
    const masks = [fakeMask(2), fakeMask(5)]

    await renderTransitionFallbackCanvas(TASK, {
      frame: 0,
      activeMasks: masks,
      itemRenderContext: {} as ItemRenderContext,
      canvasPool: fakePool(fakeCanvas('c')),
    })

    const passedMasks = vi.mocked(renderTransitionToCanvas).mock.calls[0]?.[5]
    expect(passedMasks).toEqual([fakeMask(2)])
  })

  it('forwards frame, transition, context, and track order', async () => {
    vi.mocked(doesMaskAffectTrack).mockReturnValue(false)
    const ctx = { marker: true } as unknown as ItemRenderContext

    await renderTransitionFallbackCanvas(TASK, {
      frame: 42,
      activeMasks: [],
      itemRenderContext: ctx,
      canvasPool: fakePool(fakeCanvas('c')),
    })

    const call = vi.mocked(renderTransitionToCanvas).mock.calls[0]
    expect(call?.[1]).toBe(TASK.transition)
    expect(call?.[2]).toBe(42)
    expect(call?.[3]).toBe(ctx)
    expect(call?.[4]).toBe(2)
  })
})

const videoItem = {
  id: 'clip',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 30,
  label: 'Clip',
  mediaId: 'media-1',
  src: 'blob:clip',
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
} satisfies TimelineItem

function createItemDeps(options: {
  acquire: ReturnType<typeof vi.fn>
  renderMode?: 'export' | 'preview'
}): FrameItemRenderDeps & { poolCanvas: OffscreenCanvas; poolCtx: OffscreenCanvasRenderingContext2D } {
  const poolCanvas = fakeCanvas('item')
  const poolCtx = {} as OffscreenCanvasRenderingContext2D
  return {
    frame: 0,
    canvasSettings: { width: 320, height: 180, fps: 30 },
    maskSettings: { width: 320, height: 180, fps: 30 },
    renderMode: options.renderMode ?? 'export',
    activeMasks: [],
    adjustmentLayers: [],
    gpu: {
      texturePool: { acquire: options.acquire, release: vi.fn() },
    } as unknown as GpuPipelineManager,
    itemRenderContext: {
      fps: 30,
      canvasSettings: { width: 320, height: 180, fps: 30 },
      renderMode: options.renderMode ?? 'export',
      gpuPipeline: {},
      gpuMediaPipeline: {},
      keyframesMap: new Map(),
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map(),
      gifFramesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
    } as unknown as ItemRenderContext,
    canvasPool: {
      acquire: () => ({ canvas: poolCanvas, ctx: poolCtx }),
      release: vi.fn(),
    } as unknown as CanvasPool,
    getCurrentItem: <TItem extends TimelineItem>(candidate: TItem) => candidate,
    getCurrentKeyframes: () => undefined,
    poolCanvas,
    poolCtx,
  }
}

describe('renderItemWithEffects and the precise output gate', () => {
  afterEach(() => {
    setPreciseOutputSink(null)
    vi.clearAllMocks()
  })

  it('renders a plain clip through the GPU participant path while a sink is registered', async () => {
    setPreciseOutputSink({ deliver: vi.fn() })
    const poolTexture = { tag: 'float-texture' } as unknown as GPUTexture
    const acquire = vi.fn(() => poolTexture)
    const deps = createItemDeps({ acquire })

    const result = await renderItemWithEffects(
      videoItem,
      0,
      true,
      deps.poolCtx,
      deps,
      true,
      false,
    )

    expect(acquire).toHaveBeenCalledWith(320, 180, 'rgba16float')
    expect(renderItemGpuEffectsToTexture).toHaveBeenCalledTimes(1)
    const call = vi.mocked(renderItemGpuEffectsToTexture).mock.calls[0]!
    expect(call[2]).toEqual([])
    expect(call[8]).toBe(true)
    expect(renderItem).not.toHaveBeenCalled()
    expect(result).toEqual({ gpuTexture: poolTexture, poolCanvases: [] })
  })

  it('keeps the canvas path for a plain clip when no sink is registered', async () => {
    const acquire = vi.fn()
    const deps = createItemDeps({ acquire })

    const result = await renderItemWithEffects(
      videoItem,
      0,
      true,
      deps.poolCtx,
      deps,
      true,
      false,
    )

    expect(renderItemGpuEffectsToTexture).not.toHaveBeenCalled()
    expect(renderItem).toHaveBeenCalledTimes(1)
    expect(acquire).not.toHaveBeenCalled()
    expect(result).toEqual({ source: deps.poolCanvas, poolCanvases: [deps.poolCanvas] })
  })

  it('does not take the GPU path for an effect the GPU cannot run, even during a precise export', async () => {
    setPreciseOutputSink({ deliver: vi.fn() })
    const deps = createItemDeps({ acquire: vi.fn() })
    const item = {
      ...videoItem,
      effects: [{ id: 'fx-brightness', enabled: true, effect: { type: 'brightness' } }],
    } as unknown as TimelineItem

    const result = await renderItemWithEffects(item, 0, true, deps.poolCtx, deps, true, false)

    expect(renderItemGpuEffectsToTexture).not.toHaveBeenCalled()
    expect(renderItem).toHaveBeenCalledTimes(1)
    expect(result?.source).toEqual({ tag: 'effects-canvas' })
  })
})

/**
 * The source stages' gate (design 3.6 §2.3, §2.11): a stabilized or colour-transformed clip reaches
 * the GPU participant path even with no effect and no precise sink, where its staged picture is the
 * source. Under a mask it takes the canvas path, whose video stage draws the staged picture too
 * (`video.staged.test.ts`). A clip with neither keeps today's canvas path.
 */
describe('renderItemWithEffects and the source stages', () => {
  const stabilization = {
    enabled: true,
    method: 'Default',
    params: { smoothness: 0.5 },
    fov: 1,
    horizonLockPercent: 0,
    horizonLockRoll: 0,
    adaptiveZoomSeconds: 4,
  }

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders a stabilized clip with no effects through the GPU participant path', async () => {
    const poolTexture = { tag: 'seat-texture' } as unknown as GPUTexture
    const acquire = vi.fn(() => poolTexture)
    const deps = createItemDeps({ acquire })
    const item = { ...videoItem, stabilization } as TimelineItem

    const result = await renderItemWithEffects(item, 0, true, deps.poolCtx, deps, true, false)

    expect(renderItemGpuEffectsToTexture).toHaveBeenCalledTimes(1)
    const call = vi.mocked(renderItemGpuEffectsToTexture).mock.calls[0]!
    expect(call[2]).toEqual([])
    expect(call[8]).toBe(true)
    expect(acquire).toHaveBeenCalledWith(320, 180, 'rgba8unorm')
    expect(renderItem).not.toHaveBeenCalled()
    expect(result).toEqual({ gpuTexture: poolTexture, poolCanvases: [] })
  })

  it('renders a colour-transformed clip with no effects through the GPU participant path', async () => {
    const poolTexture = { tag: 'seat-texture' } as unknown as GPUTexture
    const deps = createItemDeps({ acquire: vi.fn(() => poolTexture) })
    const item = { ...videoItem, inputColor: 'dlog-m' } as TimelineItem

    await renderItemWithEffects(item, 0, true, deps.poolCtx, deps, true, false)

    expect(renderItemGpuEffectsToTexture).toHaveBeenCalledTimes(1)
    expect(renderItem).not.toHaveBeenCalled()
  })

  it('draws a staged clip under a mask on the canvas path, with the mask (R1)', async () => {
    const deps = createItemDeps({ acquire: vi.fn() })
    // A mask on the track above the clip's
    const mask = { trackOrder: 0 } as unknown as FrameItemRenderDeps['activeMasks'][number]
    deps.activeMasks = [mask]
    vi.mocked(doesMaskAffectTrack).mockReturnValueOnce(true)
    const item = { ...videoItem, inputColor: 'dlog-m' } as TimelineItem

    await renderItemWithEffects(item, 1, true, deps.poolCtx, deps, true, false)

    expect(renderItemGpuEffectsToTexture).not.toHaveBeenCalled()
    expect(renderItem).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderItem).mock.calls[0]![7]).toEqual([mask])
  })

  it('keeps the canvas path for a clip whose profile is `none`', async () => {
    const acquire = vi.fn()
    const deps = createItemDeps({ acquire })
    const item = { ...videoItem, inputColor: 'none' } as TimelineItem

    const result = await renderItemWithEffects(item, 0, true, deps.poolCtx, deps, true, false)

    expect(renderItemGpuEffectsToTexture).not.toHaveBeenCalled()
    expect(renderItem).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ source: deps.poolCanvas, poolCanvases: [deps.poolCanvas] })
  })
})

describe('frameNeedsRenderSeat', () => {
  const track = (items: TimelineItem[]): Parameters<typeof frameNeedsRenderSeat>[0] => [
    { id: 'track-1', items } as never,
  ]
  const identity = <TItem extends TimelineItem>(item: TItem): TItem => item
  const visible = new Set(['track-1'])
  const stabilized = {
    ...videoItem,
    stabilization: {
      enabled: true,
      method: 'Default',
      params: {},
      fov: 1,
      horizonLockPercent: 0,
      horizonLockRoll: 0,
      adaptiveZoomSeconds: 4,
    },
  } as TimelineItem

  it('is true for a frame a seated clip covers, and false outside its range or its track', () => {
    expect(frameNeedsRenderSeat(track([stabilized]), visible, 0, identity)).toBe(true)
    expect(frameNeedsRenderSeat(track([stabilized]), visible, 30, identity)).toBe(false)
    expect(frameNeedsRenderSeat(track([stabilized]), new Set(), 0, identity)).toBe(false)
    expect(frameNeedsRenderSeat(track([videoItem]), visible, 0, identity)).toBe(false)
  })
})
