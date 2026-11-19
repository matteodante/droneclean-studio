// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  stripRuntimeFields,
  validateShadowRemoval,
  type ShadowPendingClean,
  type ShadowPiece,
  type ShadowRemoval,
} from './model'

const PIECE_PATH = 'media/media-1/shadow/2970_90.mp4'
const PIECE_SRC = 'blob:http://localhost/piece-1'

function validRecord(): ShadowRemoval {
  return {
    mark: { x: 960, y: 640, sourceFrame: 3000, radius: 48 },
    ranges: [
      { startFrame: 3000, endFrame: 3030, credits: 15, jobId: 'job-1', passJobId: 'pass-1' },
    ],
    pieces: [
      {
        jobId: 'job-1',
        path: PIECE_PATH,
        src: PIECE_SRC,
        startFrame: 2970,
        frames: 90,
        availableUntil: '2026-12-18T00:00:00.000Z',
      },
    ],
  }
}

/** A paid clean whose job answered, still on its way. */
function validPending(): ShadowPendingClean {
  return {
    attemptId: '0b6f9c3e-7a52-4f0e-9d1c-2b8f4a6e5d30',
    uploadId: 'upload-1',
    jobId: 'job-2',
    startFrame: 2970,
    frames: 600,
    ranges: [{ startFrame: 3000, endFrame: 3030 }],
    passJobId: 'pass-1',
    credits: 45,
    segments: [
      {
        startSeconds: 0.5,
        endSeconds: 1,
        anchor: { x: 960, y: 640, timeSeconds: 0.5, radius: 48 },
        trackJobIds: ['pass-1'],
      },
    ],
    startedAt: '2026-11-19T10:00:00.000Z',
  }
}

function piece(startFrame: number, frames: number, jobId: string): ShadowPiece {
  return { jobId, path: `media/media-1/shadow/${startFrame}_${frames}.mp4`, startFrame, frames }
}

function recordWith(field: 'mark' | 'ranges' | 'pieces', value: Record<string, unknown>): unknown {
  const record = validRecord()
  const current = record[field]
  const patched = Array.isArray(current) ? [{ ...current[0], ...value }] : { ...current, ...value }
  return { ...record, [field]: patched }
}

const invalidRecords: Array<{ field: string; what: string; value: () => unknown }> = [
  { field: 'shadowRemoval', what: 'null', value: () => null },
  { field: 'shadowRemoval', what: 'an array', value: () => [] },
  {
    field: 'shadowRemoval.mark',
    what: 'missing',
    value: () => ({ ...validRecord(), mark: undefined }),
  },
  {
    field: 'shadowRemoval.mark',
    what: 'not an object',
    value: () => ({ ...validRecord(), mark: 3000 }),
  },
  {
    field: 'shadowRemoval.mark.x',
    what: 'a string',
    value: () => recordWith('mark', { x: '960' }),
  },
  { field: 'shadowRemoval.mark.x', what: 'NaN', value: () => recordWith('mark', { x: NaN }) },
  {
    field: 'shadowRemoval.mark.y',
    what: 'infinite',
    value: () => recordWith('mark', { y: Infinity }),
  },
  {
    field: 'shadowRemoval.mark.x',
    what: 'negative',
    value: () => recordWith('mark', { x: -1 }),
  },
  {
    field: 'shadowRemoval.mark.y',
    what: 'negative',
    value: () => recordWith('mark', { y: -0.5 }),
  },
  {
    field: 'shadowRemoval.mark.sourceFrame',
    what: 'not an integer',
    value: () => recordWith('mark', { sourceFrame: 3000.5 }),
  },
  {
    field: 'shadowRemoval.mark.sourceFrame',
    what: 'negative',
    value: () => recordWith('mark', { sourceFrame: -1 }),
  },
  {
    field: 'shadowRemoval.mark.radius',
    what: 'a string',
    value: () => recordWith('mark', { radius: '48' }),
  },
  {
    field: 'shadowRemoval.mark.radius',
    what: 'zero',
    value: () => recordWith('mark', { radius: 0 }),
  },
  {
    field: 'shadowRemoval.mark.radius',
    what: 'negative',
    value: () => recordWith('mark', { radius: -48 }),
  },
  {
    field: 'shadowRemoval.ranges',
    what: 'not an array',
    value: () => ({ ...validRecord(), ranges: {} }),
  },
  {
    field: 'shadowRemoval.ranges[0]',
    what: 'not an object',
    value: () => ({ ...validRecord(), ranges: [null] }),
  },
  {
    field: 'shadowRemoval.ranges[0].startFrame',
    what: 'not an integer',
    value: () => recordWith('ranges', { startFrame: 3000.5 }),
  },
  {
    field: 'shadowRemoval.ranges[0].startFrame',
    what: 'negative',
    value: () => recordWith('ranges', { startFrame: -3 }),
  },
  {
    field: 'shadowRemoval.ranges[0].endFrame',
    what: 'not an integer',
    value: () => recordWith('ranges', { endFrame: 3029.5 }),
  },
  {
    field: 'shadowRemoval.ranges[0].endFrame',
    what: 'negative',
    value: () => recordWith('ranges', { endFrame: -1 }),
  },
  {
    field: 'shadowRemoval.ranges[0].endFrame',
    what: 'equal to its startFrame',
    value: () => recordWith('ranges', { endFrame: 3000 }),
  },
  {
    field: 'shadowRemoval.ranges[0].endFrame',
    what: 'before its startFrame',
    value: () => recordWith('ranges', { endFrame: 2999 }),
  },
  {
    field: 'shadowRemoval.ranges[0].credits',
    what: 'NaN',
    value: () => recordWith('ranges', { credits: NaN }),
  },
  {
    field: 'shadowRemoval.ranges[0].credits',
    what: 'negative',
    value: () => recordWith('ranges', { credits: -15 }),
  },
  {
    field: 'shadowRemoval.ranges[0].credits',
    what: 'not an integer',
    value: () => recordWith('ranges', { credits: 14.5 }),
  },
  {
    field: 'shadowRemoval.ranges[0].jobId',
    what: 'empty',
    value: () => recordWith('ranges', { jobId: '' }),
  },
  {
    field: 'shadowRemoval.ranges[0].passJobId',
    what: 'not a string',
    value: () => recordWith('ranges', { passJobId: 3 }),
  },
  {
    field: 'shadowRemoval.pieces',
    what: 'not an array',
    value: () => ({ ...validRecord(), pieces: 'one' }),
  },
  {
    field: 'shadowRemoval.pieces[0]',
    what: 'not an object',
    value: () => ({ ...validRecord(), pieces: [90] }),
  },
  {
    field: 'shadowRemoval.pieces[0].jobId',
    what: 'empty',
    value: () => recordWith('pieces', { jobId: '' }),
  },
  {
    field: 'shadowRemoval.pieces[0].path',
    what: 'empty',
    value: () => recordWith('pieces', { path: '' }),
  },
  {
    field: 'shadowRemoval.pieces[0].startFrame',
    what: 'not an integer',
    value: () => recordWith('pieces', { startFrame: 2970.5 }),
  },
  {
    field: 'shadowRemoval.pieces[0].startFrame',
    what: 'negative',
    value: () => recordWith('pieces', { startFrame: -1 }),
  },
  {
    field: 'shadowRemoval.pieces[0].frames',
    what: 'zero',
    value: () => recordWith('pieces', { frames: 0 }),
  },
  {
    field: 'shadowRemoval.pieces[0].frames',
    what: 'negative',
    value: () => recordWith('pieces', { frames: -90 }),
  },
  {
    field: 'shadowRemoval.pieces[0].frames',
    what: 'not an integer',
    value: () => recordWith('pieces', { frames: 90.5 }),
  },
  {
    field: 'shadowRemoval.pieces[0].src',
    what: 'not a string',
    value: () => recordWith('pieces', { src: 5 }),
  },
  {
    field: 'shadowRemoval.pieces[0].availableUntil',
    what: 'not a string',
    value: () => recordWith('pieces', { availableUntil: 0 }),
  },
  {
    field: 'shadowRemoval.pending',
    what: 'not an array',
    value: () => ({ ...validRecord(), pending: {} }),
  },
  {
    field: 'shadowRemoval.pending[0].attemptId',
    what: 'missing',
    value: () => ({ ...validRecord(), pending: [{ ...validPending(), attemptId: undefined }] }),
  },
  {
    field: 'shadowRemoval.pending[0].uploadId',
    what: 'empty',
    value: () => ({ ...validRecord(), pending: [{ ...validPending(), uploadId: '' }] }),
  },
  {
    field: 'shadowRemoval.pending[0].frames',
    what: 'zero',
    value: () => ({ ...validRecord(), pending: [{ ...validPending(), frames: 0 }] }),
  },
  {
    field: 'shadowRemoval.pending[0].ranges',
    what: 'empty',
    value: () => ({ ...validRecord(), pending: [{ ...validPending(), ranges: [] }] }),
  },
  {
    field: 'shadowRemoval.pending[0].ranges[0].endFrame',
    what: 'before its start',
    value: () => ({
      ...validRecord(),
      pending: [{ ...validPending(), ranges: [{ startFrame: 3000, endFrame: 3000 }] }],
    }),
  },
  {
    field: 'shadowRemoval.pending[0].segments',
    what: 'empty',
    value: () => ({ ...validRecord(), pending: [{ ...validPending(), segments: [] }] }),
  },
  {
    field: 'shadowRemoval.pending[0].credits',
    what: 'not an integer',
    value: () => ({ ...validRecord(), pending: [{ ...validPending(), credits: 4.5 }] }),
  },
  {
    field: 'shadowRemoval.pending[0].state',
    what: 'unknown',
    value: () => ({ ...validRecord(), pending: [{ ...validPending(), state: 'lost' }] }),
  },
  {
    field: 'shadowRemoval.pending[0].reservedCredits',
    what: 'negative',
    value: () => ({ ...validRecord(), pending: [{ ...validPending(), reservedCredits: -1 }] }),
  },
]

describe('validateShadowRemoval', () => {
  it('accepts a well-formed record and keeps every field', () => {
    expect(validateShadowRemoval(validRecord())).toStrictEqual(validRecord())
  })

  it('accepts a piece that starts where the previous one ended', () => {
    const record = { ...validRecord(), pieces: [piece(0, 30, 'job-1'), piece(30, 30, 'job-2')] }

    expect(validateShadowRemoval(record).pieces).toHaveLength(2)
  })

  it('accepts a range outside every piece, and pieces without the runtime fields', () => {
    const record = {
      ...validRecord(),
      ranges: [{ startFrame: 8000, endFrame: 8030, credits: 15, jobId: 'job-2', passJobId: 'p-2' }],
      pieces: [piece(2970, 90, 'job-1')],
    }

    expect(validateShadowRemoval(record).ranges).toEqual(record.ranges)
    expect(validateShadowRemoval(record).pieces[0]).toStrictEqual(piece(2970, 90, 'job-1'))
  })

  it('keeps fields it does not know, at every level', () => {
    const stored = {
      ...validRecord(),
      note: 'written by a newer version',
      mark: { ...validRecord().mark, trackedRadius: 60 },
      ranges: [{ ...validRecord().ranges[0]!, model: 'maximum' }],
      pieces: [{ ...validRecord().pieces[0]!, checksum: 'sha256:piece' }],
    }

    expect(validateShadowRemoval(stored)).toStrictEqual(stored)
  })

  it('survives a load and a save with the fields this version does not know', () => {
    const stored = {
      ...validRecord(),
      note: 'written by a newer version',
      mark: { ...validRecord().mark, trackedRadius: 60 },
      ranges: [{ ...validRecord().ranges[0]!, model: 'maximum' }],
      pieces: [{ ...validRecord().pieces[0]!, checksum: 'sha256:piece' }],
    }
    const savedPiece: Record<string, unknown> = { ...stored.pieces[0] }
    delete savedPiece.src

    expect(stripRuntimeFields(validateShadowRemoval(stored))).toStrictEqual({
      ...stored,
      pieces: [savedPiece],
    })
  })

  it('keeps two pieces that share source frames, in the order they were recorded', () => {
    // A second clean of some of the same frames never deletes the first: both were paid for.
    const record = {
      ...validRecord(),
      pieces: [piece(2970, 90, 'job-1'), piece(3040, 90, 'job-2')],
    }

    expect(validateShadowRemoval(record).pieces.map((kept) => kept.jobId)).toEqual([
      'job-1',
      'job-2',
    ])
  })

  it('accepts the paid cleans still on their way, in their waiting states', () => {
    const record = {
      ...validRecord(),
      pending: [
        validPending(),
        { ...validPending(), attemptId: 'a-2', jobId: undefined, state: 'unreachable' },
        { ...validPending(), attemptId: 'a-3', state: 'repriced', reservedCredits: 50 },
        { ...validPending(), attemptId: 'a-4', state: 'missing' },
      ],
    }

    const validated = validateShadowRemoval(record)

    expect(validated.pending?.[0]).toStrictEqual(validPending())
    expect(validated.pending?.[1]?.jobId).toBeUndefined()
    expect(validated.pending?.[1]?.state).toBe('unreachable')
    expect(validated.pending?.[2]?.reservedCredits).toBe(50)
    expect(validated.pending?.[3]?.state).toBe('missing')
  })

  it('leaves the pending field out of a record that has none', () => {
    expect(validateShadowRemoval(validRecord())).not.toHaveProperty('pending')
  })

  it('keeps a pending clean through a load and a save, with the fields it does not know', () => {
    const stored = {
      ...validRecord(),
      pending: [{ ...validPending(), priority: 'high' }],
    }

    expect(stripRuntimeFields(validateShadowRemoval(stored)).pending).toStrictEqual(stored.pending)
  })

  for (const { field, what, value } of invalidRecords) {
    it(`rejects ${field} when it is ${what}`, () => {
      expect(() => validateShadowRemoval(value())).toThrow(TypeError)
      expect(() => validateShadowRemoval(value())).toThrow(field)
    })
  }
})

describe('stripRuntimeFields', () => {
  it('drops the pieces src, which dies with the page, and keeps the rest', () => {
    const record = validRecord()

    const saved = stripRuntimeFields(record)

    expect(saved).toStrictEqual({
      ...validRecord(),
      pieces: [
        {
          jobId: 'job-1',
          path: PIECE_PATH,
          startFrame: 2970,
          frames: 90,
          availableUntil: '2026-12-18T00:00:00.000Z',
        },
      ],
    })
    expect('src' in saved.pieces[0]!).toBe(false)
  })

  it('leaves the record it was given untouched', () => {
    const record = validRecord()

    stripRuntimeFields(record)

    expect(record.pieces[0]!.src).toBe(PIECE_SRC)
  })
})
