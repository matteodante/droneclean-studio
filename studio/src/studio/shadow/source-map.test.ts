// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ShadowPiece, ShadowRemoval } from './model'
import { pieceTimeSeconds, resolveShadowSource, shadowPiecesWithoutFile } from './source-map'

const RATE = { num: 60000, den: 1001 }

function piece(startFrame: number, frames: number): ShadowPiece {
  return {
    jobId: `job-${startFrame}`,
    path: `media/media-1/shadow/${startFrame}_${frames}.mp4`,
    src: `blob:http://localhost/piece-${startFrame}`,
    startFrame,
    frames,
  }
}

function recordWithPieces(...pieces: ShadowPiece[]): ShadowRemoval {
  return {
    mark: { x: 960, y: 640, sourceFrame: pieces[0]?.startFrame ?? 0, radius: 48 },
    ranges: [],
    pieces,
  }
}

describe('resolveShadowSource', () => {
  it('resolves a source frame inside a piece to that piece and its frame in it', () => {
    const record = recordWithPieces(piece(2970, 90))

    expect(resolveShadowSource(record, 3000)).toEqual({
      src: 'blob:http://localhost/piece-2970',
      path: 'media/media-1/shadow/2970_90.mp4',
      pieceFrame: 30,
    })
  })

  it('resolves the piece first and last frame, and nothing just outside them', () => {
    const record = recordWithPieces(piece(2970, 90)) // covers source frames 2970..3059

    expect(resolveShadowSource(record, 2970)?.pieceFrame).toBe(0)
    expect(resolveShadowSource(record, 3059)?.pieceFrame).toBe(89)
    expect(resolveShadowSource(record, 2969)).toBeNull()
    expect(resolveShadowSource(record, 3060)).toBeNull()
  })

  it('resolves each of two pieces and leaves the frames between them to the source', () => {
    const record = recordWithPieces(piece(2970, 90), piece(3200, 60))
    expect(resolveShadowSource(record, 2970)).toMatchObject({
      path: 'media/media-1/shadow/2970_90.mp4',
      pieceFrame: 0,
    })
    expect(resolveShadowSource(record, 3059)).toMatchObject({
      path: 'media/media-1/shadow/2970_90.mp4',
      pieceFrame: 89,
    })
    expect(resolveShadowSource(record, 3060)).toBeNull()
    expect(resolveShadowSource(record, 3199)).toBeNull()
    expect(resolveShadowSource(record, 3200)).toMatchObject({
      path: 'media/media-1/shadow/3200_60.mp4',
      pieceFrame: 0,
    })
    expect(resolveShadowSource(record, 3259)).toMatchObject({
      path: 'media/media-1/shadow/3200_60.mp4',
      pieceFrame: 59,
    })
    expect(resolveShadowSource(record, 3260)).toBeNull()
  })

  it('draws the newer of two pieces where both jobs cleaned the frame', () => {
    const older = piece(2970, 90)
    const newer = { ...piece(3000, 90), jobId: 'job-newer', src: 'blob:http://localhost/newer' }
    const record: ShadowRemoval = {
      ...recordWithPieces(older, newer),
      ranges: [
        { startFrame: 3000, endFrame: 3040, credits: 10, jobId: older.jobId, passJobId: 'p-1' },
        { startFrame: 3010, endFrame: 3050, credits: 10, jobId: 'job-newer', passJobId: 'p-2' },
      ],
    }

    // Both kept: the newer clean answers where both repainted the frame.
    expect(resolveShadowSource(record, 3020)).toEqual({
      src: 'blob:http://localhost/newer',
      path: newer.path,
      pieceFrame: 20,
    })
    // Before the newer piece starts, the older piece answers.
    expect(resolveShadowSource(record, 2990)?.src).toBe(older.src)
  })

  it('never hides an older piece’s paid frame behind a newer piece’s untouched copy of it', () => {
    const older = piece(2970, 90)
    const newer = { ...piece(3000, 90), jobId: 'job-newer', src: 'blob:http://localhost/newer' }
    const record: ShadowRemoval = {
      ...recordWithPieces(older, newer),
      ranges: [
        { startFrame: 3040, endFrame: 3050, credits: 10, jobId: older.jobId, passJobId: 'p-1' },
        { startFrame: 3070, endFrame: 3080, credits: 10, jobId: 'job-newer', passJobId: 'p-2' },
      ],
    }

    // Only the older job cleaned 3045: its piece answers, though the newer one covers the frame.
    expect(resolveShadowSource(record, 3045)).toEqual({
      src: older.src,
      path: older.path,
      pieceFrame: 75,
    })
    // Neither job cleaned 3020: the newer piece answers, as a lone piece does around its ranges.
    expect(resolveShadowSource(record, 3020)?.src).toBe('blob:http://localhost/newer')
    expect(resolveShadowSource(record, 3075)?.src).toBe('blob:http://localhost/newer')
  })

  it('finds a piece wherever the pieces sit in the stored array', () => {
    const record = recordWithPieces(piece(3200, 60), piece(2970, 90))

    expect(resolveShadowSource(record, 3000)?.path).toBe('media/media-1/shadow/2970_90.mp4')
  })

  it('answers the same for a clip trimmed to start at source frame 3000', () => {
    const record = recordWithPieces(piece(2970, 90))
    const trimmedStart = 3000
    const trimmedFrames = 200

    const pieceFrames: number[] = []
    for (let offset = 0; offset < trimmedFrames; offset++) {
      const resolved = resolveShadowSource(record, trimmedStart + offset)
      if (resolved) pieceFrames.push(resolved.pieceFrame)
    }

    // The clip's first timeline frame plays source frame 3000, which is piece frame 30: the
    // offset is counted from the piece, and the trim changes nothing else. The piece runs out at
    // source frame 3059, so the rest of the trimmed clip comes from the source.
    expect(pieceFrames).toEqual(Array.from({ length: 60 }, (_, index) => 30 + index))
  })

  it('resolves only the source frames each half of a split clip plays', () => {
    const record = recordWithPieces(piece(2970, 90)) // covers source frames 2970..3059
    // A split clones the item, so both halves carry the record; each half plays its own
    // source bounds of the same piece.
    const halves = [
      { record: structuredClone(record), sourceStart: 2970, sourceFrames: 45 },
      { record: structuredClone(record), sourceStart: 3015, sourceFrames: 45 },
    ]

    const resolvedFrames = halves.map((half) =>
      Array.from({ length: half.sourceFrames }, (_, offset) =>
        resolveShadowSource(half.record, half.sourceStart + offset),
      ),
    )

    expect(resolvedFrames[0]?.map((hit) => hit?.pieceFrame)).toEqual(
      Array.from({ length: 45 }, (_, index) => index),
    )
    expect(resolvedFrames[1]?.map((hit) => hit?.pieceFrame)).toEqual(
      Array.from({ length: 45 }, (_, index) => 45 + index),
    )
    expect(resolvedFrames.flat().every((hit) => hit?.path === record.pieces[0]?.path)).toBe(true)
  })

  it('has no answer without a record or without a piece', () => {
    expect(resolveShadowSource(undefined, 3000)).toBeNull()
    expect(resolveShadowSource(recordWithPieces(), 3000)).toBeNull()
  })

  it('names the piece and its frame when the piece file is not open yet', () => {
    const record = recordWithPieces({ ...piece(2970, 90), src: undefined })

    expect(resolveShadowSource(record, 3000)).toEqual({
      src: undefined,
      path: 'media/media-1/shadow/2970_90.mp4',
      pieceFrame: 30,
    })
  })
})

describe('shadowPiecesWithoutFile', () => {
  it('names the pieces whose file is not open, and only those', () => {
    const open = piece(2970, 90)
    const closed = { ...piece(3200, 60), src: undefined }
    const record = recordWithPieces(open, closed)

    expect(shadowPiecesWithoutFile(record)).toEqual([closed])
    // The resolver still names the piece for the frame it covers: the renderer falls back
    // to the source there in preview, and an export refuses before drawing it.
    expect(resolveShadowSource(record, 3210)).toEqual({
      src: undefined,
      path: 'media/media-1/shadow/3200_60.mp4',
      pieceFrame: 10,
    })
  })

  it('has nothing to report without a record, without pieces, or with every file open', () => {
    expect(shadowPiecesWithoutFile(undefined)).toEqual([])
    expect(shadowPiecesWithoutFile(recordWithPieces())).toEqual([])
    expect(shadowPiecesWithoutFile(recordWithPieces(piece(2970, 90)))).toEqual([])
  })
})

describe('pieceTimeSeconds', () => {
  it('asks the decoder for the piece frame own time, in seconds', () => {
    expect(pieceTimeSeconds(0, RATE)).toBe(0)
    expect(pieceTimeSeconds(30, RATE)).toBe(0.5005)
    expect(pieceTimeSeconds(3, { num: 25, den: 1 })).toBe(0.12)
  })

  it('returns the same frame for every frame of a 27-minute clip, with no drift', () => {
    const notRecovered: number[] = []
    let maxDeviation = 0
    for (let pieceFrame = 0; pieceFrame <= 100_000; pieceFrame++) {
      const seconds = pieceTimeSeconds(pieceFrame, RATE)
      const back = (seconds * RATE.num) / RATE.den
      maxDeviation = Math.max(maxDeviation, Math.abs(back - pieceFrame))
      if (Math.round(back) !== pieceFrame) {
        notRecovered.push(pieceFrame)
      }
    }

    // `frame·den/num` is one rounding from the integer frame, so nothing accumulates. The value is
    // not always an exact double — 5,132 of these 100,001 come back up to 1.5e-11 of a frame away —
    // so the frame is recovered by rounding: none is lost or repeated.
    expect(notRecovered).toEqual([])
    expect(maxDeviation).toBeLessThan(1e-10)
  })
})
