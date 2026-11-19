import { ratesEqual, secondsToFrame, toRate } from '@/studio/time'
import type { Subclip, SubclipParentInfo, SubclipValidity } from './model'

const FALLBACK_FPS = 30

function rateOf(fps: number | undefined): number {
  return fps !== undefined && Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS
}

/** The number of source frames of a file: the same count the timeline's clip builder uses. */
export function getParentFrameCount(parent: SubclipParentInfo): number {
  return Math.max(1, secondsToFrame(toRate(rateOf(parent.fps)), parent.duration))
}

/**
 * The reason a range cannot be a subclip, or `null`: `0 <= start < end`, both whole frames.
 * With the parent's frame count, a range past the end of the file is refused too.
 */
export function getRangeError(
  startFrame: number,
  endFrame: number,
  parentFrameCount?: number,
): string | null {
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame)) {
    return 'A subclip range is made of whole frames'
  }
  if (startFrame < 0) return 'A subclip cannot start before the first frame'
  if (endFrame <= startFrame) return 'A subclip needs at least one frame'
  if (parentFrameCount !== undefined && endFrame > parentFrameCount) {
    return `A subclip cannot end after the last frame of the file (${parentFrameCount})`
  }
  return null
}

/**
 * Whether a subclip still means what it did: its parent exists, the file still has every frame of
 * the range, and the file's frame rate is the one the range was cut at. Nothing is clamped: a
 * clamp would silently change which frames a clip plays (design 1.6, D6).
 */
export function getSubclipValidity(
  subclip: Subclip,
  parent: SubclipParentInfo | undefined,
): SubclipValidity {
  if (!parent) return { valid: false, reason: 'parent-missing' }
  if (!ratesEqual(toRate(rateOf(parent.fps)), toRate(rateOf(subclip.sourceFps)))) {
    return { valid: false, reason: 'rate-changed' }
  }
  if (subclip.endFrame > getParentFrameCount(parent)) {
    return { valid: false, reason: 'range-past-end' }
  }
  return { valid: true }
}

/** A subclip read back from a saved project, or `null` when the record is malformed. */
export function parseStoredSubclip(value: unknown): Subclip | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const { id, mediaId, name, startFrame, endFrame, sourceFps, createdAt } = record
  if (typeof id !== 'string' || id === '') return null
  if (typeof mediaId !== 'string' || mediaId === '') return null
  if (typeof name !== 'string') return null
  if (typeof startFrame !== 'number' || typeof endFrame !== 'number') return null
  if (getRangeError(startFrame, endFrame) !== null) return null
  if (typeof sourceFps !== 'number' || !Number.isFinite(sourceFps) || sourceFps <= 0) return null
  return {
    id,
    mediaId,
    name,
    startFrame,
    endFrame,
    sourceFps,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  }
}
