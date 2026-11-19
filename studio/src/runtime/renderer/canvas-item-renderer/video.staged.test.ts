// @vitest-environment node

// A staged clip on the canvas path (design 3.6 section 2.11, finding R1): a clip under a mask or a canvas effect is
// drawn by `renderVideoItem`, and what it draws is the clip's staged picture, copied into a canvas at the staged size,
// never the decoded raw frame. Before this, a D-Log M or stabilized clip under a mask was exported as flat log or
// unstabilized. The stages are faked; the copy runs against a recording device.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { RendererStages } from '@/studio/render/stages/renderer'
import { StageError } from '@/studio/render/stages/types'
import type { VideoItem } from '@/types/timeline'
import {
  createItemRenderContext,
  createItemTransform,
  createMockCanvasContext,
} from '../canvas-item-renderer-test-helpers'
import { renderVideoItem } from './video'

const FPS = 30

function video(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    label: 'clip',
    mediaId: 'media-1',
    src: 'blob:clip',
    from: 0,
    durationInFrames: 30,
    sourceFps: FPS,
    sourceStart: 0,
    sourceEnd: 30,
    sourceDuration: 30,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    sourceWidth: 320,
    sourceHeight: 180,
    inputColor: 'dlog-m',
    ...overrides,
  } as VideoItem
}

/** The canvases the copy made, and the device that recorded it */
const canvases: Array<{ width: number; height: number }> = []
const submit = vi.fn()
const device = {
  lost: new Promise(() => undefined),
  createShaderModule: vi.fn(() => ({})),
  createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
  createBindGroup: vi.fn(() => ({})),
  createCommandEncoder: vi.fn(() => ({
    beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
    finish: () => ({}),
  })),
  queue: { submit },
} as unknown as GPUDevice

class FakeOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    canvases.push(this)
  }

  getContext() {
    return { configure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) }
  }
}

beforeEach(() => {
  canvases.length = 0
  submit.mockClear()
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function rig(renderMode: 'export' | 'preview') {
  const texture = { width: 300, height: 170, createView: () => ({}) } as unknown as GPUTexture
  const render = vi.fn(async () => ({ texture, width: 300, height: 170, kind: 'fresh' as const }))
  const stages: RendererStages = {
    mode: renderMode,
    device: async () => device,
    prepare: async () => undefined,
    render,
    stageImage: vi.fn(),
    destroy: () => undefined,
  }
  const rawFrame = { width: 320, height: 180, close: () => undefined }
  const captureFrame = vi.fn(async () => ({ success: true, frame: rawFrame, sourceTime: 0 }))
  const drawFrame = vi.fn(async () => true)
  const rctx = createItemRenderContext({
    fps: FPS,
    renderMode,
    canvasSettings: { width: 320, height: 180, fps: FPS },
    useMediabunny: new Set(['clip-1']),
    domVideoElementProvider: () => ({ videoWidth: 320, videoHeight: 180 }) as HTMLVideoElement,
    stages,
  })
  rctx.videoExtractors.set('clip-1', {
    captureFrame,
    drawFrame,
    getDimensions: () => ({ width: 320, height: 180 }),
    getDuration: () => 1,
    init: async () => true,
  } as unknown as Parameters<typeof rctx.videoExtractors.set>[1])
  const ctx = createMockCanvasContext()
  return { rctx, ctx, render, captureFrame, drawFrame }
}

describe('a staged clip on the canvas path', () => {
  it('draws the staged picture in an export, not the decoded raw frame (R1)', async () => {
    const { rctx, ctx, render, captureFrame, drawFrame } = rig('export')
    const item = video()

    const drawn = await renderVideoItem(ctx, item, createItemTransform({ width: 320, height: 180 }), 7, rctx)

    expect(drawn).toBe(true)
    expect(render).toHaveBeenCalledWith(item, 7)
    expect(captureFrame).not.toHaveBeenCalled()
    expect(drawFrame).not.toHaveBeenCalled()
    // One copy into a canvas at the staged size, submitted, then drawn with the clip's layout
    expect(canvases).toEqual([expect.objectContaining({ width: 300, height: 170 })])
    expect(submit).toHaveBeenCalledTimes(1)
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    expect((ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(canvases[0])
  })

  it('throws an export’s StageError instead of drawing the raw frame', async () => {
    const { rctx, ctx, render, captureFrame } = rig('export')
    const error = new StageError({ clip: 'clip', stage: 'input-colour', reason: 'no pass' })
    render.mockRejectedValueOnce(error)

    await expect(
      renderVideoItem(ctx, video(), createItemTransform({ width: 320, height: 180 }), 7, rctx),
    ).rejects.toBe(error)
    expect(captureFrame).not.toHaveBeenCalled()
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('draws nothing in a preview that cannot stage the clip: the last picture stays (never the raw frame)', async () => {
    const { rctx, ctx, render, captureFrame } = rig('preview')
    render.mockRejectedValueOnce(new Error('decoder gone'))

    const drawn = await renderVideoItem(
      ctx,
      video({ stabilization: { enabled: true } as VideoItem['stabilization'] }),
      createItemTransform({ width: 320, height: 180 }),
      7,
      rctx,
    )

    expect(drawn).toBe(false)
    expect(captureFrame).not.toHaveBeenCalled()
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})
