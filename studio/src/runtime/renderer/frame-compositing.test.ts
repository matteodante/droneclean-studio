// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { setPreciseOutputSink } from '@/studio/render/precise/contract'
import { compositeFrameResults, type FrameCompositingDeps } from './frame-compositing'

afterEach(() => {
  setPreciseOutputSink(null)
})

const item = {
  id: 'video-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 30,
  label: 'Video',
} as TimelineItem

function sourceCanvas(): OffscreenCanvas {
  return {} as OffscreenCanvas
}

function createCompositeDeps(options: {
  acquire: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
  compositor: Record<string, unknown>
  copyExternalImageToTexture?: ReturnType<typeof vi.fn>
  renderMode?: 'export' | 'preview'
  backgroundColor?: string
  useGpuCompositor?: boolean
}): FrameCompositingDeps {
  const device = {
    queue: {
      copyExternalImageToTexture:
        options.copyExternalImageToTexture ??
        vi.fn(() => {
          throw new Error('upload failed')
        }),
    },
  }
  const gpuCanvas = { tag: 'gpu-canvas' } as unknown as OffscreenCanvas
  return {
    useGpuCompositor: options.useGpuCompositor ?? true,
    gpu: {
      compositor: options.compositor,
      maskManager: { getFallbackView: () => 'fallback-mask-view' },
      effects: { getDevice: () => device },
      texturePool: { acquire: options.acquire, release: options.release },
    },
    gpuCompositeOutput: { canvas: gpuCanvas, ctx: {} as GPUCanvasContext },
    canvasSettings: { width: 320, height: 180, fps: 30 },
    backgroundColor: options.backgroundColor ?? '#000000',
    maskSettings: {},
    renderTasks: [{ type: 'item', item, trackOrder: 0 }],
    results: [{ source: sourceCanvas(), poolCanvases: [] }],
    activeMasks: [],
    contentCanvas: {} as OffscreenCanvas,
    contentCtx: {} as OffscreenCanvasRenderingContext2D,
    itemRenderContext: {
      renderMode: options.renderMode ?? 'export',
      gpuPipeline: { waitForSubmittedWork: vi.fn(async () => undefined) },
    } as unknown as FrameCompositingDeps['itemRenderContext'],
    canvasPool: { release: vi.fn() },
    getCurrentItem: <TItem extends TimelineItem>(candidate: TItem) => candidate,
    getEffectiveBlendMode: () => 'normal',
    applyTrackScopedMasks: (result: unknown) => result,
    renderMasksToGpuTexture: () => null,
    renderTransitionFallbackCanvas: vi.fn(),
    renderItemWithEffects: vi.fn(),
  } as unknown as FrameCompositingDeps
}

describe('compositeFrameResults resource cleanup', () => {
  it('releases acquired GPU textures and result canvases when upload throws', async () => {
    const texture = {
      width: 1920,
      height: 1080,
      format: 'rgba8unorm',
      createView: vi.fn(),
    } as unknown as GPUTexture
    const releaseTexture = vi.fn()
    const releaseCanvas = vi.fn()
    const pooledCanvas = {} as OffscreenCanvas
    const deps = createCompositeDeps({
      acquire: vi.fn(() => texture),
      release: releaseTexture,
      compositor: {},
    })
    deps.renderTasks = [{ type: 'item', item, trackOrder: 0 }]
    deps.results = [{ source: sourceCanvas(), poolCanvases: [pooledCanvas] }]
    deps.canvasPool = { release: releaseCanvas } as unknown as FrameCompositingDeps['canvasPool']

    await expect(compositeFrameResults(deps)).rejects.toThrow('upload failed')
    expect(releaseTexture).toHaveBeenCalledWith(texture)
    expect(releaseCanvas).toHaveBeenCalledWith(pooledCanvas)
  })
})

describe('compositeFrameResults on the precise path', () => {
  it('composites float layers and returns the float frame while a sink is registered', async () => {
    const deliver = vi.fn()
    setPreciseOutputSink({ deliver })
    const acquiredFormats: Array<GPUTextureFormat | undefined> = []
    const layerTexture = { createView: vi.fn(() => 'layer-view') } as unknown as GPUTexture
    const frameTexture = { format: 'rgba16float' } as unknown as GPUTexture
    const acquire = vi.fn((_w: number, _h: number, format?: GPUTextureFormat) => {
      acquiredFormats.push(format)
      return layerTexture
    })
    const compositeToCanvasAndTexture = vi.fn(() => ({
      texture: frameTexture,
      view: {} as GPUTextureView,
    }))
    const deps = createCompositeDeps({
      acquire,
      release: vi.fn(),
      compositor: { compositeToCanvasAndTexture },
      copyExternalImageToTexture: vi.fn(),
      backgroundColor: '#204060',
    })

    const result = await compositeFrameResults(deps)

    expect(acquiredFormats).toEqual(['rgba16float'])
    expect(compositeToCanvasAndTexture).toHaveBeenCalledTimes(1)
    const [, , , , packOptions] = compositeToCanvasAndTexture.mock.calls[0] as unknown as [
      unknown,
      number,
      number,
      unknown,
      { pixelFormat: GPUTextureFormat; background: { r: number; g: number; b: number } },
    ]
    expect(packOptions.pixelFormat).toBe('rgba16float')
    expect(packOptions.background.r).toBeCloseTo(0x20 / 255)
    expect(packOptions.background.g).toBeCloseTo(0x40 / 255)
    expect(packOptions.background.b).toBeCloseTo(0x60 / 255)
    expect(result.texture).toBe(frameTexture)
    expect(result.canvas).toBe(deps.gpuCompositeOutput!.canvas)
  })

  it('keeps the 8-bit path, and returns no float frame, without a sink', async () => {
    const acquiredFormats: Array<GPUTextureFormat | undefined> = []
    const layerTexture = { createView: vi.fn(() => 'layer-view') } as unknown as GPUTexture
    const acquire = vi.fn((_w: number, _h: number, format?: GPUTextureFormat) => {
      acquiredFormats.push(format)
      return layerTexture
    })
    const compositeToCanvas = vi.fn(() => true)
    const compositeToCanvasAndTexture = vi.fn()
    const deps = createCompositeDeps({
      acquire,
      release: vi.fn(),
      compositor: { compositeToCanvas, compositeToCanvasAndTexture },
      copyExternalImageToTexture: vi.fn(),
    })

    const result = await compositeFrameResults(deps)

    expect(acquiredFormats).toEqual(['rgba8unorm'])
    expect(compositeToCanvas).toHaveBeenCalledTimes(1)
    expect(compositeToCanvasAndTexture).not.toHaveBeenCalled()
    expect(result.texture).toBeNull()
    expect(result.canvas).toBe(deps.gpuCompositeOutput!.canvas)
  })

  it('fails instead of falling back to 8 bits when a precise frame cannot be composited', async () => {
    setPreciseOutputSink({ deliver: vi.fn() })
    const deps = createCompositeDeps({
      acquire: vi.fn(() => ({ createView: vi.fn() })),
      release: vi.fn(),
      compositor: { compositeToCanvasAndTexture: vi.fn(() => null) },
      copyExternalImageToTexture: vi.fn(),
    })

    await expect(compositeFrameResults(deps)).rejects.toThrow(
      'The precise export needs the GPU compositor',
    )
  })
})
