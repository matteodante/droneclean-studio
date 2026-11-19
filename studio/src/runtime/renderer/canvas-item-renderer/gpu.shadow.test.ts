// @vitest-environment node

/**
 * A clip with a cleaned shadow range inside a GPU transition is read from the same file the
 * video stage would read for that frame: the source outside a cleaned range, the piece at its
 * own frame inside it. A transition draws two participants in one timeline frame, and its time
 * names no single source frame, so each side resolves its own — these tests pin both sides of
 * one blend and the two frames either side of the range's boundary.
 */

import { describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import type { ShadowRemoval } from '@/studio/shadow/model'
import { frameToSeconds, toRate } from '@/studio/time'
import { createItemRenderContext, createItemTransform } from '../canvas-item-renderer-test-helpers'
import { prepareGpuMediaParticipant } from './gpu'
import { videoExtractorKey, type VideoFrameSource } from '../shared-video-extractor'
import type { ItemRenderContext, ItemTransform, TransitionParticipantRenderState } from './types'

const FPS = 30
/** The source's rate as the exact fraction every asked-for time below is a function of. */
const SOURCE_RATE = toRate(FPS)
const PIECE_SRC = 'blob:cleaned-30-59'
const PIECE_PATH = 'media/media-1/shadow/30_30.mp4'
/** Long enough that no frame the tests ask for is clamped to the source's end. */
const SOURCE_DURATION = 300

const transform: ItemTransform = createItemTransform({ width: 320, height: 180 })

const shadowRemoval: ShadowRemoval = {
  mark: { x: 160, y: 90, sourceFrame: 30, radius: 20 },
  ranges: [{ startFrame: 30, endFrame: 60, credits: 45, jobId: 'job-1', passJobId: 'pass-1' }],
  pieces: [{ jobId: 'job-1', path: PIECE_PATH, src: PIECE_SRC, startFrame: 30, frames: 30 }],
}

function createItem(id: string, sourceStart: number, shadow?: ShadowRemoval): VideoItem {
  return {
    id,
    type: 'video',
    label: id,
    src: 'blob:source',
    from: 0,
    durationInFrames: 64,
    sourceStart,
    sourceFps: FPS,
    sourceDuration: SOURCE_DURATION,
    speed: 1,
    shadowRemoval: shadow,
    transform,
  } as VideoItem
}

/** A participant of a transition that starts before the clip, as `transition.ts` builds one. */
function createParticipant(
  item: VideoItem,
  sourceStart: number,
): TransitionParticipantRenderState<VideoItem> {
  return {
    item,
    transform,
    effects: [],
    renderSpan: { from: 0, durationInFrames: 64, sourceStart },
  }
}

interface FakeExtractor {
  captureFrame: ReturnType<typeof vi.fn>
}

/** A stand-in for the media decoder of one file, naming the picture it hands back. */
function createExtractor(name: string): FakeExtractor {
  const frame = { label: name, width: 320, height: 180, close: vi.fn() }
  return {
    captureFrame: vi.fn(async () => ({ success: true, frame, sourceTime: 0 })),
  }
}

function timesOf(extractor: FakeExtractor): number[] {
  return extractor.captureFrame.mock.calls.map((call) => (call as unknown[])[0] as number)
}

/** The name of the picture a prepared participant drew, or undefined when it drew none. */
function drawnFile(
  prepared: Awaited<ReturnType<typeof prepareGpuMediaParticipant>>,
): string | undefined {
  if (prepared?.media.kind !== 'media') return undefined
  return (prepared.media.source as unknown as { label: string }).label
}

/** The render context of one transition: its canvas, and the decoders it looks files up in. */
function createRig(): ItemRenderContext {
  return createItemRenderContext({
    fps: FPS,
    canvasSettings: { width: 320, height: 180, fps: FPS },
    useMediabunny: new Set(['clip-1', 'clip-2']),
  })
}

function addFile(
  rctx: ItemRenderContext,
  itemId: string,
  src: string | undefined,
  extractor: FakeExtractor,
): void {
  rctx.videoExtractors.set(
    src === undefined ? itemId : videoExtractorKey(itemId, src),
    extractor as unknown as VideoFrameSource,
  )
}

describe('prepareGpuMediaParticipant with a cleaned shadow range', () => {
  // The piece covers source frames 30 to 59: the frame before and the one after it read the
  // source, and both edges of the range read the piece at its own frames.
  const frames = [29, 30, 59, 60]

  for (const renderMode of ['preview', 'export'] as const) {
    it(`reads the piece inside the range and the source outside it (${renderMode})`, async () => {
      const item = createItem('clip-1', 0, shadowRemoval)
      const rctx = createRig()
      rctx.renderMode = renderMode
      const source = createExtractor('source')
      const piece = createExtractor('piece')
      addFile(rctx, item.id, undefined, source)
      addFile(rctx, item.id, PIECE_SRC, piece)

      const drawn: string[] = []
      for (const frame of frames) {
        const prepared = await prepareGpuMediaParticipant(createParticipant(item, 0), frame, rctx)
        const file = drawnFile(prepared)
        expect(file, `frame ${frame} must be drawn`).toBeDefined()
        drawn.push(file!)
      }

      // The source at frames 29 and 60, the piece at its own frames 0 and 29.
      expect(drawn).toEqual(['source', 'piece', 'piece', 'source'])
      expect(timesOf(source)).toEqual([
        frameToSeconds(SOURCE_RATE, 29),
        frameToSeconds(SOURCE_RATE, 60),
      ])
      expect(timesOf(piece)).toEqual([
        frameToSeconds(SOURCE_RATE, 0),
        frameToSeconds(SOURCE_RATE, 29),
      ])
    })
  }

  it('gives each side of a mid-transition blend its own file and its own frame', async () => {
    // A dissolve at frame 30: the left clip shows source frame 90, the right one source frame
    // 30, which is the piece's first frame. One timeline frame, two different files.
    const left = createItem('clip-1', 60)
    const right = createItem('clip-2', 0, shadowRemoval)
    const rctx = createRig()
    const leftSource = createExtractor('left-source')
    const rightSource = createExtractor('right-source')
    const rightPiece = createExtractor('right-piece')
    addFile(rctx, left.id, undefined, leftSource)
    addFile(rctx, right.id, undefined, rightSource)
    addFile(rctx, right.id, PIECE_SRC, rightPiece)

    const preparedLeft = await prepareGpuMediaParticipant(createParticipant(left, 60), 30, rctx)
    const preparedRight = await prepareGpuMediaParticipant(createParticipant(right, 0), 30, rctx)

    expect(timesOf(leftSource)).toEqual([frameToSeconds(SOURCE_RATE, 90)])
    expect(timesOf(rightPiece)).toEqual([frameToSeconds(SOURCE_RATE, 0)])
    // The right clip's source is not read at all while the piece covers the frame.
    expect(rightSource.captureFrame).not.toHaveBeenCalled()
    expect(drawnFile(preparedLeft)).toBe('left-source')
    expect(drawnFile(preparedRight)).toBe('right-piece')
  })

  it('reads the source in preview when the piece has no file open', async () => {
    const item = createItem('clip-1', 0, {
      ...shadowRemoval,
      pieces: [{ ...shadowRemoval.pieces[0]!, src: undefined }],
    })
    const rctx = createRig()
    rctx.renderMode = 'preview'
    const source = createExtractor('source')
    addFile(rctx, item.id, undefined, source)

    const prepared = await prepareGpuMediaParticipant(createParticipant(item, 0), 30, rctx)

    expect(drawnFile(prepared)).toBe('source')
    expect(timesOf(source)).toEqual([frameToSeconds(SOURCE_RATE, 30)])
  })

  it('does not fall back to the source in export when the piece has no file open', async () => {
    // The canvas path this returns to is the one that refuses the clip, with the message
    // the export already uses; drawing the source here would ship the uncleaned frames.
    const item = createItem('clip-1', 0, {
      ...shadowRemoval,
      pieces: [{ ...shadowRemoval.pieces[0]!, src: undefined }],
    })
    const rctx = createRig()
    rctx.renderMode = 'export'
    const source = createExtractor('source')
    addFile(rctx, item.id, undefined, source)

    const prepared = await prepareGpuMediaParticipant(createParticipant(item, 0), 30, rctx)

    expect(prepared).toBeNull()
    expect(source.captureFrame).not.toHaveBeenCalled()
  })
})
