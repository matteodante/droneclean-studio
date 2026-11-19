// The DroneClean shadow removal carried by a clip: the mark, the ranges that were paid for, the
// cleaned pieces kept beside the source, and the paid cleans still on their way. Every frame number
// is an integer source frame, counted from the source media's first frame — never a timeline frame,
// never a time — and every mark coordinate is a source pixel at the source's own size. Trims,
// splits, speed changes and the project's frame rate move timeline frames only, so a record stays
// right when a clip is edited. The one exception is a pending clean's `segments`: the job's request
// exactly as it was sent, in the uploaded piece's seconds, kept so it can be sent again unchanged.

import type { Segment } from './api/types'

/** Where the user pointed at the shadow: a circle in source pixels, on a source frame. */
export interface ShadowMark {
  /** Circle centre, in source pixels from the picture's left edge (never negative). */
  x: number
  /** Circle centre, in source pixels from the picture's top edge (never negative). */
  y: number
  /** The source frame the mark was made on. */
  sourceFrame: number
  /** Circle radius, in source pixels (greater than zero). */
  radius: number
}

/** A run of source frames one job was paid to clean, and the job that did it. */
export interface ShadowRange {
  /** The range's first source frame. */
  startFrame: number
  /** One past the range's last source frame, always greater than `startFrame`; its length. */
  endFrame: number
  /** Credits the job reserved for this range, as the cloud reported them (a non-negative integer). */
  credits: number
  /** The job that cleaned the range. */
  jobId: string
  /** The tracking pass that job reused to follow the shadow. */
  passJobId: string
}

/**
 * One cleaned file kept beside the source. The piece's frame `j` (`0 <= j < frames`) is source
 * frame `startFrame + j`, so the piece covers source frames `startFrame` to
 * `startFrame + frames - 1`, decoded from its own keyframes, at the source's size and frame times.
 */
export interface ShadowPiece {
  /** The job whose result this file is. */
  jobId: string
  /** Workspace path of the file, e.g. `media/{mediaId}/shadow/{startFrame}_{frames}.mp4`. */
  path: string
  /**
   * Blob URL acquired from `path` when the project opens, for the renderer to read. Runtime
   * only: it dies with the page and is never saved (`stripRuntimeFields` drops it before a save).
   */
  src?: string
  /** The source frame the piece's first frame is. */
  startFrame: number
  /** Number of frames in the piece. */
  frames: number
  /** ISO 8601 time after which the cloud's copy can no longer be downloaded, when it said. */
  availableUntil?: string
}

/** A run of source frames a pending clean pays for (`endFrame` excluded). */
export interface ShadowPendingRange {
  startFrame: number
  endFrame: number
}

/**
 * Why a pending clean is waiting rather than running: the service could not be reached (the job,
 * or its creation, is still to be confirmed), it reserved another price than the one shown and its
 * cancel has not gone through yet, or it does not know the job (it answered 404: the job may belong
 * to another account), which the pilot may choose to forget.
 */
export type ShadowPendingState = 'unreachable' | 'repriced' | 'missing'

const PENDING_STATES: readonly ShadowPendingState[] = ['unreachable', 'repriced', 'missing']

/**
 * A paid clean whose result is not on the clip yet. It is written on the record before the job is
 * asked for, so a lost answer, a closed section, an undo or a restart finds the same job again
 * through `attemptId` (the API makes one job per account and attempt) instead of paying for a
 * second, and a job that succeeded is downloaded and recorded however the editor was left. It
 * leaves the record only with a known outcome: the result recorded, the job failed or canceled
 * (its credits came back), or its creation refused.
 */
export interface ShadowPendingClean {
  /** The client's id for the job: the same request sent again gets the same job, never a second. */
  attemptId: string
  /** The upload the job cleans: the tracking pass's own piece. */
  uploadId: string
  /** The job, once the API answered its creation. */
  jobId?: string
  /** The window of source frames that was uploaded: the result's frame `j` is source frame `startFrame + j`. */
  startFrame: number
  /** Frames in that window. */
  frames: number
  /** The stretches the job pays for, in source frames inside the window. */
  ranges: ShadowPendingRange[]
  /** The tracking pass that found them. */
  passJobId: string
  /** The price the section showed for exactly these ranges: a different reservation is canceled. */
  credits: number
  /** The job's ranges exactly as they were sent, so its creation can be asked for again unchanged. */
  segments: Segment[]
  /** ISO 8601 time of the press. */
  startedAt: string
  /** Why it waits, when it does; absent while it simply runs. */
  state?: ShadowPendingState
  /** What the service reserved, when it was not `credits` (`state: 'repriced'`). */
  reservedCredits?: number
}

/** The shadow removal of one clip, all in source frames. */
export interface ShadowRemoval {
  /** Where the shadow is in the source. */
  mark: ShadowMark
  /**
   * The ranges paid for, in source frames. A range may lie outside every piece: its job may have
   * failed, or its piece may be missing locally — the user is shown the source there.
   */
  ranges: ShadowRange[]
  /**
   * The cleaned files kept beside the source, in source frames, in the order they were recorded.
   * Two may overlap (a second clean of some of the same frames never deletes the first, which was
   * paid for); where they do, `resolveShadowSource` draws the newest whose own job cleaned the
   * frame.
   */
  pieces: ShadowPiece[]
  /** Paid cleans whose result is not recorded yet; absent when there are none. */
  pending?: ShadowPendingClean[]
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`)
  }
  return value
}

function requireNonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative number`)
  }
  return value
}

function requirePositiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive number`)
  }
  return value
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer`)
  }
  return value
}

function requireSourceFrame(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer source frame`)
  }
  return value
}

function requireFrameCount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive integer frame count`)
  }
  return value
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`)
  }
  return value
}

function requireOptionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : requireString(value, path)
}

/**
 * The validated fields laid over the stored object: a field this version does not know, written
 * by a newer one, is kept, so a load and a save do not lose it.
 */
function keepUnknownFields<T extends object>(stored: Record<string, unknown>, known: T): T {
  return { ...stored, ...known } as T
}

function validatePendingRange(value: unknown, path: string): ShadowPendingRange {
  const range = requireObject(value, path)
  const startFrame = requireSourceFrame(range.startFrame, `${path}.startFrame`)
  const endFrame = requireSourceFrame(range.endFrame, `${path}.endFrame`)
  if (endFrame <= startFrame) {
    throw new TypeError(`${path}.endFrame must be greater than its startFrame ${startFrame}`)
  }
  return keepUnknownFields(range, { startFrame, endFrame })
}

function validatePending(value: unknown, path: string): ShadowPendingClean {
  const pending = requireObject(value, path)
  const ranges = requireArray(pending.ranges, `${path}.ranges`).map((range, index) =>
    validatePendingRange(range, `${path}.ranges[${index}]`),
  )
  if (ranges.length === 0) throw new TypeError(`${path}.ranges must not be empty`)
  const segments = requireArray(pending.segments, `${path}.segments`).map(
    (segment, index) => requireObject(segment, `${path}.segments[${index}]`) as unknown as Segment,
  )
  if (segments.length === 0) throw new TypeError(`${path}.segments must not be empty`)
  const known: ShadowPendingClean = {
    attemptId: requireString(pending.attemptId, `${path}.attemptId`),
    uploadId: requireString(pending.uploadId, `${path}.uploadId`),
    startFrame: requireSourceFrame(pending.startFrame, `${path}.startFrame`),
    frames: requireFrameCount(pending.frames, `${path}.frames`),
    ranges,
    passJobId: requireString(pending.passJobId, `${path}.passJobId`),
    credits: requireNonNegativeInteger(pending.credits, `${path}.credits`),
    segments,
    startedAt: requireString(pending.startedAt, `${path}.startedAt`),
  }
  const jobId = requireOptionalString(pending.jobId, `${path}.jobId`)
  if (jobId !== undefined) known.jobId = jobId
  if (pending.state !== undefined) {
    if (!PENDING_STATES.includes(pending.state as ShadowPendingState)) {
      throw new TypeError(`${path}.state must be one of ${PENDING_STATES.join(', ')}`)
    }
    known.state = pending.state as ShadowPendingState
  }
  if (pending.reservedCredits !== undefined) {
    known.reservedCredits = requireNonNegativeInteger(
      pending.reservedCredits,
      `${path}.reservedCredits`,
    )
  }
  return keepUnknownFields(pending, known)
}

/**
 * Reads a stored shadow record, or throws a `TypeError` naming the first field that is wrong.
 *
 * Rejects a frame that is not a non-negative integer, a piece of zero or negative frames, a range
 * that is empty (`endFrame <= startFrame`), a mark outside the picture (`x`, `y` below zero), a
 * radius that is not positive, credits that are not a non-negative integer, and a pending clean
 * without its attempt, upload, window, ranges or price. A range outside every piece is allowed,
 * and so are two pieces that share source frames (the newer is drawn). Returns a copy: the
 * declared fields validated, and the fields this version does not know kept, at every level, so a
 * record written by a newer version survives a load and a save.
 */
export function validateShadowRemoval(value: unknown): ShadowRemoval {
  const root = requireObject(value, 'shadowRemoval')

  const markValue = requireObject(root.mark, 'shadowRemoval.mark')
  const mark: ShadowMark = keepUnknownFields(markValue, {
    x: requireNonNegativeNumber(markValue.x, 'shadowRemoval.mark.x'),
    y: requireNonNegativeNumber(markValue.y, 'shadowRemoval.mark.y'),
    sourceFrame: requireSourceFrame(markValue.sourceFrame, 'shadowRemoval.mark.sourceFrame'),
    radius: requirePositiveNumber(markValue.radius, 'shadowRemoval.mark.radius'),
  })

  const ranges: ShadowRange[] = requireArray(root.ranges, 'shadowRemoval.ranges').map(
    (rangeValue, index) => {
      const path = `shadowRemoval.ranges[${index}]`
      const range = requireObject(rangeValue, path)
      const startFrame = requireSourceFrame(range.startFrame, `${path}.startFrame`)
      const endFrame = requireSourceFrame(range.endFrame, `${path}.endFrame`)
      if (endFrame <= startFrame) {
        throw new TypeError(`${path}.endFrame must be greater than its startFrame ${startFrame}`)
      }
      return keepUnknownFields(range, {
        startFrame,
        endFrame,
        credits: requireNonNegativeInteger(range.credits, `${path}.credits`),
        jobId: requireString(range.jobId, `${path}.jobId`),
        passJobId: requireString(range.passJobId, `${path}.passJobId`),
      })
    },
  )

  const pieces: ShadowPiece[] = requireArray(root.pieces, 'shadowRemoval.pieces').map(
    (pieceValue, index) => {
      const path = `shadowRemoval.pieces[${index}]`
      const piece = requireObject(pieceValue, path)
      const known: ShadowPiece = {
        jobId: requireString(piece.jobId, `${path}.jobId`),
        path: requireString(piece.path, `${path}.path`),
        startFrame: requireSourceFrame(piece.startFrame, `${path}.startFrame`),
        frames: requireFrameCount(piece.frames, `${path}.frames`),
      }
      const pieceSrc = requireOptionalString(piece.src, `${path}.src`)
      if (pieceSrc !== undefined) known.src = pieceSrc
      const availableUntil = requireOptionalString(piece.availableUntil, `${path}.availableUntil`)
      if (availableUntil !== undefined) known.availableUntil = availableUntil
      return keepUnknownFields(piece, known)
    },
  )

  const record: ShadowRemoval = keepUnknownFields(root, { mark, ranges, pieces })
  if (root.pending === undefined) return record
  record.pending = requireArray(root.pending, 'shadowRemoval.pending').map((value, index) =>
    validatePending(value, `shadowRemoval.pending[${index}]`),
  )
  return record
}

/**
 * The record as it is saved: a copy without the pieces' `src`, the blob URL that dies with the
 * page and is acquired again from `path` when the project opens. Everything else is kept,
 * including the fields this version does not know.
 */
export function stripRuntimeFields(record: ShadowRemoval): ShadowRemoval {
  const saved: ShadowRemoval = {
    ...record,
    mark: { ...record.mark },
    ranges: record.ranges.map((range) => ({ ...range })),
    pieces: record.pieces.map((piece) => {
      const savedPiece: ShadowPiece = { ...piece }
      delete savedPiece.src
      return savedPiece
    }),
  }
  if (record.pending) saved.pending = record.pending.map((pending) => ({ ...pending }))
  return saved
}
