// @vitest-environment node

/**
 * A cleaned shadow range is read from its own file: the video stage turns the frame's
 * source time into an integer source frame, asks the resolver which piece covers it, and
 * reads that piece at its own offset. These tests pin the two frames either side of the
 * boundary and both edges of the range, in preview and in export, and pin the rule that
 * an export never falls back to the source when the piece is missing — nor ships a range
 * whose cleaned file has gone since the project opened.
 */

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import type { ShadowRemoval } from '@/studio/shadow/model'
import { unavailableShadowPieces } from '@/studio/shadow/hydrate'
import {
  registerObjectUrl,
  unregisterObjectUrl,
} from '@/infrastructure/browser/object-url-registry'
import { frameToSeconds, toRate } from '@/studio/time'
import { resolveShadowVideoFrame } from '@/studio/shadow/frame-source'
import { renderVideoItem } from './video'
import { videoExtractorKey } from '../shared-video-extractor'
import type { ItemRenderContext, ItemTransform } from './types'

const FPS = 30
/** The source's rate as the exact fraction every asked-for time below is a function of. */
const SOURCE_RATE = toRate(FPS)
const PIECE_SRC = 'blob:cleaned-30-59'

const transform: ItemTransform = {
  x: 0,
  y: 0,
  width: 320,
  height: 180,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
}

const shadowRemoval = (src: string | undefined): ShadowRemoval => ({
  mark: { x: 160, y: 90, sourceFrame: 30, radius: 20 },
  ranges: [{ startFrame: 30, endFrame: 60, credits: 45, jobId: 'job-1', passJobId: 'pass-1' }],
  pieces: [
    {
      jobId: 'job-1',
      path: 'media/media-1/shadow/30_30.mp4',
      src,
      startFrame: 30,
      frames: 30,
    },
  ],
})

function createItem(src: string | undefined): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    label: 'Cleaned clip',
    src: 'blob:source',
    from: 0,
    durationInFrames: 64,
    sourceStart: 0,
    sourceFps: FPS,
    sourceDuration: 64,
    speed: 1,
    shadowRemoval: shadowRemoval(src),
    transform,
  } as VideoItem
}

function createCanvasContext(): OffscreenCanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as OffscreenCanvasRenderingContext2D
}

function createExtractor(durationSeconds: number, opened = true) {
  let isOpen = opened
  return {
    init: vi.fn(async () => {
      isOpen = true
      return true
    }),
    drawFrame: vi.fn(async () => true),
    drawFrameWithCapture: vi.fn(),
    captureFrame: vi.fn(),
    getLastFailureKind: vi.fn(() => 'none' as const),
    getDimensions: vi.fn(() => ({ width: 320, height: 180 })),
    getCanBeTransparent: vi.fn(() => false),
    getDuration: vi.fn(() => (isOpen ? durationSeconds : 0)),
    prewarmBatch: vi.fn(async () => 0),
    isBatchPrewarmAvailable: vi.fn(() => false),
    dispose: vi.fn(),
  }
}

/** The extractors of one render, and the context that finds them by file. */
function createRig(item: VideoItem, renderMode: 'preview' | 'export') {
  const source = createExtractor(64 / FPS)
  // A piece is not open until its own file is: its duration is unknown before that.
  const piece = createExtractor(30 / FPS, false)
  const context = {
    fps: FPS,
    renderMode,
    canvasSettings: { width: 320, height: 180, fps: FPS },
    videoExtractors: new Map([
      [item.id, source],
      [videoExtractorKey(item.id, PIECE_SRC), piece],
    ]),
    videoElements: new Map(),
    useMediabunny: new Set([item.id]),
    mediabunnyDisabledItems: new Set(),
    mediabunnyFailureCountByItem: new Map(),
    scrubbingCache: null,
  } as unknown as ItemRenderContext
  const times = (extractor: typeof source) =>
    extractor.drawFrame.mock.calls.map((call) => (call as unknown[])[1] as number)
  return { context, source, piece, times }
}

/** A file whose content is gone: it still reports the size it had, and gives no byte. */
function vanishedFile(): Blob {
  return {
    size: 4096,
    type: 'video/mp4',
    slice: () => ({
      arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotFoundError')),
    }),
  } as unknown as Blob
}

describe('renderVideoItem with a cleaned shadow range', () => {
  // Each case starts with no file behind the piece's URL: a test that wants one registers it.
  beforeEach(() => unregisterObjectUrl(PIECE_SRC))

  // The piece covers source frames 30 to 59: the frame before and the one after it
  // read the source, and both edges of the range read the piece at its own frames.
  const frames = [29, 30, 59, 60]

  for (const renderMode of ['preview', 'export'] as const) {
    it(`reads the piece inside the range and the source outside it (${renderMode})`, async () => {
      const item = createItem(PIECE_SRC)
      const { context, source, piece, times } = createRig(item, renderMode)

      for (const frame of frames) {
        const drawn = await renderVideoItem(createCanvasContext(), item, transform, frame, context)
        expect(drawn, `frame ${frame} must be drawn`).toBe(true)
      }

      // Both files are asked for the frame's own start time, exactly: the source at
      // frames 29 and 60, the piece at its own frames 0 and 29 (source frames 30 to 59).
      expect(times(source)).toEqual([
        frameToSeconds(SOURCE_RATE, 29),
        frameToSeconds(SOURCE_RATE, 60),
      ])
      expect(times(piece)).toEqual([
        frameToSeconds(SOURCE_RATE, 0),
        frameToSeconds(SOURCE_RATE, 29),
      ])
      // A piece is opened before its size and duration are read, so its first frame
      // is not decoded at frame 0 of the wrong file.
      expect(piece.init).toHaveBeenCalledOnce()
      expect(source.init).not.toHaveBeenCalled()
    })
  }

  it('never draws a cleaned clip from a live <video> element', async () => {
    const item = createItem(PIECE_SRC)
    const domVideoElementProvider = vi.fn(
      () =>
        ({
          readyState: 4,
          videoWidth: 320,
          videoHeight: 180,
          currentTime: 1,
        }) as HTMLVideoElement,
    )
    const { context, piece, times } = createRig(item, 'preview')
    context.domVideoElementProvider = domVideoElementProvider

    await renderVideoItem(createCanvasContext(), item, transform, 30, context)

    expect(domVideoElementProvider).not.toHaveBeenCalled()
    expect(times(piece)).toEqual([0])
  })

  it('falls back to the source in preview when the piece is missing', async () => {
    const item = createItem(undefined)
    const { context, source, piece, times } = createRig(item, 'preview')

    const drawn = await renderVideoItem(createCanvasContext(), item, transform, 30, context)

    expect(drawn).toBe(true)
    // The source, asked at the frame's own source time: the piece has no frames to offer.
    expect(times(source)).toEqual([frameToSeconds(SOURCE_RATE, 30)])
    expect(times(piece)).toEqual([])
    // What the clip panel reads: this clip's cleaned file is not there.
    expect(unavailableShadowPieces(item)).toEqual([
      expect.objectContaining({ path: 'media/media-1/shadow/30_30.mp4' }),
    ])
  })

  it('refuses to export a clip whose cleaned piece is missing', async () => {
    const item = createItem(undefined)
    const { context, source, times } = createRig(item, 'export')

    await expect(
      renderVideoItem(createCanvasContext(), item, transform, 29, context),
    ).rejects.toThrow(
      /Clip "Cleaned clip" is missing its cleaned piece "media\/media-1\/shadow\/30_30\.mp4"/,
    )
    expect(times(source)).toEqual([])
  })

  it('refuses to export a clip whose cleaned piece file has gone since the URL was made', async () => {
    const item = createItem(PIECE_SRC)
    const { context, piece, times } = createRig(item, 'export')
    // The file behind the URL the project holds still reports a size and gives no byte:
    // without the check at export the range would render as nothing, silently.
    registerObjectUrl(PIECE_SRC, vanishedFile())

    await expect(
      renderVideoItem(createCanvasContext(), item, transform, 30, context),
    ).rejects.toThrow(
      /Clip "Cleaned clip" is missing its cleaned piece "media\/media-1\/shadow\/30_30\.mp4"/,
    )
    expect(times(piece)).toEqual([])
  })

  it('exports a clip whose cleaned piece file still opens', async () => {
    const item = createItem(PIECE_SRC)
    const { context, piece, times } = createRig(item, 'export')
    registerObjectUrl(PIECE_SRC, new Blob(['cleaned'], { type: 'video/mp4' }))

    const drawn = await renderVideoItem(createCanvasContext(), item, transform, 30, context)

    expect(drawn).toBe(true)
    expect(times(piece)).toEqual([frameToSeconds(SOURCE_RATE, 0)])
  })

  it('keeps playing a preview whose cleaned piece file has gone', async () => {
    const item = createItem(PIECE_SRC)
    const { context, piece, times } = createRig(item, 'preview')
    registerObjectUrl(PIECE_SRC, vanishedFile())

    const drawn = await renderVideoItem(createCanvasContext(), item, transform, 30, context)

    expect(drawn).toBe(true)
    expect(times(piece)).toEqual([frameToSeconds(SOURCE_RATE, 0)])
  })

  it('does not refuse a clip whose pieces are all readable', () => {
    expect(unavailableShadowPieces(createItem(PIECE_SRC))).toEqual([])
  })

  it('resolves the frame and its offset without rounding twice', () => {
    const item = createItem(PIECE_SRC)

    expect(resolveShadowVideoFrame(item, 29 / FPS, FPS)).toBeNull()
    expect(resolveShadowVideoFrame(item, 30 / FPS, FPS)).toEqual({
      src: PIECE_SRC,
      path: 'media/media-1/shadow/30_30.mp4',
      pieceFrame: 0,
      timeSeconds: 0,
    })
    expect(resolveShadowVideoFrame(item, 59 / FPS, FPS)).toEqual({
      src: PIECE_SRC,
      path: 'media/media-1/shadow/30_30.mp4',
      pieceFrame: 29,
      timeSeconds: 29 / FPS,
    })
    expect(resolveShadowVideoFrame(item, 60 / FPS, FPS)).toBeNull()
    // A source time a hair inside the frame still resolves to it: the time is rounded to
    // its frame, so a container's quantisation cannot pick a neighbour.
    expect(resolveShadowVideoFrame(item, (30 + 1e-4) / FPS, FPS)?.pieceFrame).toBe(0)
    expect(resolveShadowVideoFrame(item, (59 + 1e-4) / FPS, FPS)?.pieceFrame).toBe(29)
  })
})
