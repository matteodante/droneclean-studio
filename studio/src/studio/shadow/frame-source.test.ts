// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import type { ShadowRemoval } from './model'
import {
  hasShadowPieces,
  refuseMissingShadowPiece,
  resolveShadowVideoFrame,
  shadowFrameRead,
} from './frame-source'

const FPS = 30
const PIECE_SRC = 'blob:cleaned-30-59'
const PIECE_PATH = 'media/media-1/shadow/30_30.mp4'

function itemWith(src: string | undefined, withPiece = true): VideoItem {
  const shadowRemoval: ShadowRemoval = {
    mark: { x: 160, y: 90, sourceFrame: 30, radius: 20 },
    ranges: [{ startFrame: 30, endFrame: 60, credits: 45, jobId: 'job-1', passJobId: 'pass-1' }],
    pieces: withPiece
      ? [{ jobId: 'job-1', path: PIECE_PATH, src, startFrame: 30, frames: 30 }]
      : [],
  }
  return {
    id: 'clip-1',
    type: 'video',
    label: 'Cleaned clip',
    src: 'blob:source',
    from: 0,
    durationInFrames: 90,
    sourceStart: 0,
    sourceFps: FPS,
    shadowRemoval,
  } as VideoItem
}

describe('shadowFrameRead: which file a source frame comes from', () => {
  const item = itemWith(PIECE_SRC)

  it('reads the source up to frame 29 and the piece from frame 30 on', () => {
    expect(shadowFrameRead(item, 0)).toEqual({ kind: 'source' })
    expect(shadowFrameRead(item, 29)).toEqual({ kind: 'source' })
    expect(shadowFrameRead(item, 30)).toEqual({
      kind: 'piece',
      src: PIECE_SRC,
      path: PIECE_PATH,
      pieceFrame: 0,
    })
  })

  it('reads the piece up to frame 59 and the source again from frame 60', () => {
    expect(shadowFrameRead(item, 59)).toEqual({
      kind: 'piece',
      src: PIECE_SRC,
      path: PIECE_PATH,
      pieceFrame: 29,
    })
    expect(shadowFrameRead(item, 60)).toEqual({ kind: 'source' })
    expect(shadowFrameRead(item, 1000)).toEqual({ kind: 'source' })
  })

  it('says a recorded piece without a file is missing, rather than reading the source', () => {
    expect(shadowFrameRead(itemWith(undefined), 45)).toEqual({
      kind: 'missing',
      path: PIECE_PATH,
      pieceFrame: 15,
    })
    expect(shadowFrameRead(itemWith(undefined), 29)).toEqual({ kind: 'source' })
  })

  it('reads the source of a clip with no cleaned piece', () => {
    expect(shadowFrameRead(itemWith(PIECE_SRC, false), 45)).toEqual({ kind: 'source' })
    expect(hasShadowPieces(itemWith(PIECE_SRC, false))).toBe(false)
    expect(hasShadowPieces(item)).toBe(true)
  })
})

describe('resolveShadowVideoFrame (moved from video.ts, behaviour unchanged)', () => {
  it('resolves the frame and its offset without rounding twice', () => {
    const item = itemWith(PIECE_SRC)
    expect(resolveShadowVideoFrame(item, 29 / FPS, FPS)).toBeNull()
    expect(resolveShadowVideoFrame(item, 30 / FPS, FPS)).toEqual({
      src: PIECE_SRC,
      path: PIECE_PATH,
      pieceFrame: 0,
      timeSeconds: 0,
    })
    expect(resolveShadowVideoFrame(item, 59 / FPS, FPS)).toEqual({
      src: PIECE_SRC,
      path: PIECE_PATH,
      pieceFrame: 29,
      timeSeconds: 29 / FPS,
    })
    expect(resolveShadowVideoFrame(item, 60 / FPS, FPS)).toBeNull()
  })
})

describe('refuseMissingShadowPiece', () => {
  const played = (first: number, last: number) => () => ({ first, last })

  it('refuses an export whose frame reads a piece with no file', async () => {
    const item = itemWith(undefined)
    const shadowFrame = resolveShadowVideoFrame(item, 45 / FPS, FPS)
    await expect(
      refuseMissingShadowPiece({ item, isPreviewMode: false, shadowFrame }, played(0, 89)),
    ).rejects.toThrow(/missing its cleaned piece "media\/media-1\/shadow\/30_30.mp4"/)
  })

  it('refuses an export whose played range covers the piece, even on a frame outside it', async () => {
    const item = itemWith(undefined)
    await expect(
      refuseMissingShadowPiece({ item, isPreviewMode: false, shadowFrame: null }, played(0, 89)),
    ).rejects.toThrow(/missing its cleaned piece/)
    await expect(
      refuseMissingShadowPiece({ item, isPreviewMode: false, shadowFrame: null }, played(0, 29)),
    ).resolves.toBeUndefined()
    await expect(
      refuseMissingShadowPiece({ item, isPreviewMode: false, shadowFrame: null }, played(60, 89)),
    ).resolves.toBeUndefined()
  })

  it('lets a preview keep playing', async () => {
    const item = itemWith(undefined)
    const shadowFrame = resolveShadowVideoFrame(item, 45 / FPS, FPS)
    await expect(
      refuseMissingShadowPiece({ item, isPreviewMode: true, shadowFrame }, played(0, 89)),
    ).resolves.toBeUndefined()
  })

  it('does not ask for the played range when the piece is readable', async () => {
    const item = itemWith(PIECE_SRC)
    let asked = false
    await refuseMissingShadowPiece({ item, isPreviewMode: false, shadowFrame: null }, () => {
      asked = true
      return { first: 0, last: 89 }
    })
    expect(asked).toBe(false)
  })
})
