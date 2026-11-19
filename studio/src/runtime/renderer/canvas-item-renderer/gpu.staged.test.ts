// @vitest-environment node

// A staged clip in the GPU participant path (design 3.6 sections 2.10 and 2.19): its source is the renderer's staged
// picture, by integer source frame, never the DOM `<video>` (finding S1) nor FreeCut's decoder; FreeCut's layout and
// draw work on that picture at its staged size; an export's `StageError` stops the frame. The stages themselves are
// faked here: their pixels are the golden kit's, their order and failure policy `render/stages/pipeline.test.ts`.

import { describe, expect, it, vi } from 'vite-plus/test'
import type { RendererStages } from '@/studio/render/stages/renderer'
import { StageError } from '@/studio/render/stages/types'
import type { VideoItem } from '@/types/timeline'
import { createItemRenderContext, createItemTransform } from '../canvas-item-renderer-test-helpers'
import type { ItemRenderContext, ItemTransform, PreparedGpuMediaParticipant } from './types'
import {
  prepareGpuMediaParticipant,
  renderGpuMediaParticipantToTexture,
  renderItemGpuEffectsToTexture,
  renderPreviewVideoGpuEffectsToCanvas,
} from './gpu'

const FPS = 30

const STABILIZATION: VideoItem['stabilization'] = {
  enabled: true,
  method: 'Default',
  params: {},
  fov: 1,
  horizonLockPercent: 0,
  horizonLockRoll: 0,
  adaptiveZoomSeconds: 4,
}

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
    sourceHeight: 240,
    transform: createItemTransform({ width: 320, height: 180 }),
    ...overrides,
  } as VideoItem
}

function fakeTexture(width: number, height: number): GPUTexture {
  return { width, height, format: 'rgba16float', createView: () => ({}) } as unknown as GPUTexture
}

/** The renderer's stages, answering every frame with a staged picture of `size` */
function fakeStages(size = { width: 320, height: 180 }) {
  const texture = fakeTexture(size.width, size.height)
  const render = vi.fn(async () => ({ texture, ...size, kind: 'fresh' as const }))
  const stageImage = vi.fn(async () => ({ texture, ...size, kind: 'fresh' as const }))
  const stages: RendererStages = {
    mode: 'preview',
    device: async () => ({}) as GPUDevice,
    prepare: async () => undefined,
    render,
    stageImage,
    destroy: () => undefined,
  }
  return { stages, render, stageImage, texture }
}

function participant(item: VideoItem) {
  return {
    item,
    transform: item.transform as unknown as PreparedGpuMediaParticipant['participant']['transform'],
    effects: [],
    renderSpan: { from: 0, durationInFrames: 30, sourceStart: 0 },
  }
}

/** A context whose DOM provider and decoder both answer, so a test sees which one the clip was drawn from */
function rig(renderMode: 'preview' | 'export', stages?: RendererStages) {
  const domVideo = { videoWidth: 320, videoHeight: 240, dataset: {} } as unknown as HTMLVideoElement
  const domVideoElementProvider = vi.fn(() => domVideo)
  const captureFrame = vi.fn(async () => ({
    success: true,
    frame: { width: 320, height: 240, close: () => undefined },
    sourceTime: 0,
  }))
  const rctx = createItemRenderContext({
    fps: FPS,
    renderMode,
    canvasSettings: { width: 320, height: 180, fps: FPS },
    useMediabunny: new Set(['clip-1']),
    domVideoElementProvider,
    stages,
  })
  rctx.videoExtractors.set('clip-1', { captureFrame } as unknown as Parameters<
    typeof rctx.videoExtractors.set
  >[1])
  return { rctx, domVideo, domVideoElementProvider, captureFrame }
}

describe('a staged clip’s source in the participant path', () => {
  it('is the staged picture, never the DOM video, in a preview (S1)', async () => {
    const { stages, render, texture } = fakeStages()
    const item = video({ stabilization: STABILIZATION })
    const { rctx, domVideo, domVideoElementProvider, captureFrame } = rig('preview', stages)

    const prepared = await prepareGpuMediaParticipant(participant(item), 5, rctx)

    expect(prepared?.media).not.toMatchObject({ source: domVideo })
    expect(domVideoElementProvider).not.toHaveBeenCalled()
    expect(captureFrame).not.toHaveBeenCalled()
    expect(prepared?.media).toMatchObject({ kind: 'staged', texture })
    expect(render).toHaveBeenCalledWith(item, 5)
  })

  it('is laid out at the staged size, not the file’s', async () => {
    const { stages } = fakeStages({ width: 300, height: 170 })
    const item = video({ inputColor: 'dlog-m' })
    const { rctx } = rig('export', stages)

    const prepared = await prepareGpuMediaParticipant(participant(item), 5, rctx)

    expect(prepared?.media.sourceWidth).toBe(300)
    expect(prepared?.media.sourceHeight).toBe(170)
  })

  it('asks for the source frame the span maps the timeline frame to', async () => {
    const { stages, render } = fakeStages()
    const item = video({ inputColor: 'dlog-m', from: 10, sourceStart: 4 })
    const { rctx } = rig('export', stages)

    await prepareGpuMediaParticipant(
      { ...participant(item), renderSpan: { from: 10, durationInFrames: 30, sourceStart: 4 } },
      17,
      rctx,
    )

    expect(render).toHaveBeenCalledWith(item, 11)
  })

  it('throws an export’s StageError instead of drawing the raw frame (S3)', async () => {
    const { stages, render } = fakeStages()
    const error = new StageError({ clip: 'clip', stage: 'stabilize', sourceIndex: 5, reason: 'no data' })
    render.mockRejectedValueOnce(error)
    const item = video({ stabilization: STABILIZATION })
    const { rctx, captureFrame } = rig('export', stages)

    await expect(prepareGpuMediaParticipant(participant(item), 5, rctx)).rejects.toBe(error)
    expect(captureFrame).not.toHaveBeenCalled()
  })

  it('gives no participant in a preview that cannot draw the clip, and never falls back to the raw frame', async () => {
    const { stages, render } = fakeStages()
    render.mockRejectedValueOnce(new Error('decoder gone'))
    const item = video({ stabilization: STABILIZATION })
    const { rctx, captureFrame, domVideoElementProvider } = rig('preview', stages)

    await expect(prepareGpuMediaParticipant(participant(item), 5, rctx)).resolves.toBeNull()
    expect(captureFrame).not.toHaveBeenCalled()
    expect(domVideoElementProvider).not.toHaveBeenCalled()
  })

  it('keeps FreeCut’s own source for a clip no stage changes', async () => {
    const { stages, render } = fakeStages()
    const item = video()
    const { rctx } = rig('preview', stages)

    const prepared = await prepareGpuMediaParticipant(participant(item), 5, rctx)

    expect(render).not.toHaveBeenCalled()
    expect(prepared?.media.kind).toBe('media')
  })
})

describe('a preview clip whose stages need no exact frame (input colour, a look)', () => {
  it('starts from FreeCut’s own fast source (its <video> may answer, here its decoder does), fed into the stages', async () => {
    const { stages, render, stageImage, texture } = fakeStages()
    const item = video({ inputColor: 'dlog-m' })
    const { rctx, domVideoElementProvider, captureFrame } = rig('preview', stages)

    const prepared = await prepareGpuMediaParticipant(participant(item), 5, rctx)

    expect(domVideoElementProvider).toHaveBeenCalled()
    expect(captureFrame).toHaveBeenCalledTimes(1)
    const captured = (await captureFrame.mock.results[0]!.value).frame
    expect(render).not.toHaveBeenCalled()
    expect(stageImage).toHaveBeenCalledWith(item, 5, { source: captured, width: 320, height: 240 })
    expect(prepared?.media).toMatchObject({ kind: 'staged', texture })
  })

  it('gives no participant when FreeCut has no frame: the canvas path then stages it from the provider', async () => {
    const { stages, stageImage } = fakeStages()
    const item = video({ inputColor: 'dlog-m' })
    const { rctx } = rig('preview', stages)
    rctx.domVideoElementProvider = undefined
    rctx.videoExtractors.clear()

    await expect(prepareGpuMediaParticipant(participant(item), 5, rctx)).resolves.toBeNull()
    expect(stageImage).not.toHaveBeenCalled()
  })

  it('takes the provider in an export, every staged clip, for the exact frame at full precision', async () => {
    const { stages, render, stageImage } = fakeStages()
    const item = video({ inputColor: 'dlog-m' })
    const { rctx, domVideoElementProvider } = rig('export', stages)

    await prepareGpuMediaParticipant(participant(item), 5, rctx)

    expect(render).toHaveBeenCalledWith(item, 5)
    expect(stageImage).not.toHaveBeenCalled()
    expect(domVideoElementProvider).not.toHaveBeenCalled()
  })
})

describe('a staged clip whose FreeCut decoder did not open (§2.10)', () => {
  it('is drawn from the provider in an export, never refused to the 8-bit canvas path', async () => {
    const { stages, render } = fakeStages()
    const item = video({ inputColor: 'dlog-m' })
    const { rctx } = rig('export', stages)
    rctx.useMediabunny.clear()
    rctx.ensureVideoItemReady = vi.fn(async () => false)
    rctx.gpuPipeline = {} as unknown as ItemRenderContext['gpuPipeline']
    rctx.gpuMediaPipeline = {
      renderTextureToTexture: vi.fn(() => true),
      renderSourceToTexture: vi.fn(() => true),
    } as unknown as ItemRenderContext['gpuMediaPipeline']

    const drawn = await renderItemGpuEffectsToTexture(
      item,
      item.transform as unknown as ItemTransform,
      [],
      5,
      rctx,
      fakeTexture(320, 180),
      { acquire: () => fakeTexture(320, 180), release: vi.fn() },
      undefined,
      true,
    )

    expect(drawn).toBe(true)
    expect(render).toHaveBeenCalledWith(item, 5)
    expect(rctx.ensureVideoItemReady).not.toHaveBeenCalled()
  })
})

describe('a staged clip’s draw', () => {
  it('samples the staged texture through FreeCut’s media pipeline, with the participant’s layout', async () => {
    const { stages } = fakeStages()
    const item = video({ stabilization: STABILIZATION })
    const renderTextureToTexture = vi.fn(() => true)
    const renderSourceToTexture = vi.fn(() => true)
    const { rctx } = rig('export', stages)
    rctx.gpuMediaPipeline = {
      renderTextureToTexture,
      renderSourceToTexture,
    } as unknown as ItemRenderContext['gpuMediaPipeline']
    const prepared = await prepareGpuMediaParticipant(participant(item), 5, rctx)
    const output = fakeTexture(320, 180)

    const rendered = await renderGpuMediaParticipantToTexture(
      prepared!,
      rctx,
      { acquire: () => fakeTexture(320, 180), release: vi.fn() },
      output,
    )

    expect(rendered).toBe(true)
    expect(renderSourceToTexture).not.toHaveBeenCalled()
    expect(renderTextureToTexture).toHaveBeenCalledWith(
      (prepared!.media as { texture: GPUTexture }).texture,
      output,
      expect.objectContaining({
        sourceWidth: 320,
        sourceHeight: 180,
        sourceRect: prepared!.sourceRect,
        destRect: prepared!.destRect,
        flipX: false,
        flipY: false,
      }),
    )
  })
})

describe('the preview DOM-video fast path', () => {
  function fastPathRig(item: VideoItem) {
    const domVideoElementProvider = vi.fn(() => ({}) as HTMLVideoElement)
    const rctx = createItemRenderContext({
      fps: FPS,
      renderMode: 'preview',
      canvasSettings: { width: 320, height: 180, fps: FPS },
      gpuPipeline: { getDevice: () => ({}) } as unknown as ItemRenderContext['gpuPipeline'],
      domVideoElementProvider,
    })
    const canvas = renderPreviewVideoGpuEffectsToCanvas(
      item,
      item.transform as unknown as ItemTransform,
      item.effects!,
      5,
      rctx,
    )
    return { canvas, domVideoElementProvider }
  }

  const effects: VideoItem['effects'] = [
    {
      id: 'fx',
      enabled: true,
      effect: { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: {} },
    } as unknown as NonNullable<VideoItem['effects']>[number],
  ]

  it('is never taken by a clip with a speed curve', () => {
    const item = video({
      speedCurve: {
        keys: [
          { frame: 0, speed: 1 },
          { frame: 29, speed: 2 },
        ],
      },
      effects,
    } as unknown as VideoItem)
    const { canvas, domVideoElementProvider } = fastPathRig(item)
    expect(canvas).toBeNull()
    expect(domVideoElementProvider).not.toHaveBeenCalled()
  })

  it('is never taken by a staged clip: the fast path has no stages', () => {
    for (const item of [
      video({ stabilization: STABILIZATION, effects }),
      video({ inputColor: 'dlog-m', effects }),
    ]) {
      const { canvas, domVideoElementProvider } = fastPathRig(item)
      expect(canvas).toBeNull()
      expect(domVideoElementProvider).not.toHaveBeenCalled()
    }
  })
})
