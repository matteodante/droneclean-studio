/**
 * Cutting and joining eased segments without changing a frame (task 11.11).
 *
 * A cut inside an eased segment leaves each half a piece of a ramp that is not the shape of the
 * same ease between the halves' own end speeds (a piece of a smoothstep has a slope at its
 * ends). So each half keeps the parent ramp: `easeSlice` names its frames of it, the speed on
 * every frame is the parent's, and the halves show the parent's source frames exactly. Joining
 * the halves again puts the parent segment back.
 */

import type { SpeedCurve, SpeedKey } from './curve'
import type { SpeedEase, SpeedEaseSlice } from './ease'

/** The ease fields of the key that starts a segment. */
export interface EaseFields {
  readonly ease?: SpeedEase
  readonly easeSlice?: SpeedEaseSlice
}

/**
 * The ease fields for a key at curve frame `from` whose segment runs to curve frame `to`, when
 * `curve` is cut there: `from` and `to` lie in one segment of `curve` (the cut points include
 * every key between them). Empty for a linear segment, and for a frame past the last key.
 */
export function easeFieldsForWindow(curve: SpeedCurve, from: number, to: number): EaseFields {
  const { keys } = curve
  let index = -1
  for (const [candidate, key] of keys.entries()) {
    if (key.frame <= from) index = candidate
  }
  const start = keys[index]
  const end = keys[index + 1]
  if (start === undefined || end === undefined) return {}
  if (start.ease === undefined || start.ease === 'linear') return {}
  const parentLength = start.easeSlice?.length ?? end.frame - start.frame
  const offset = (start.easeSlice?.offset ?? 0) + (from - start.frame)
  const full = offset === 0 && to - from === parentLength
  if (full) {
    return start.easeSlice === undefined
      ? { ease: start.ease }
      : { ease: start.ease, easeSlice: start.easeSlice }
  }
  return {
    ease: start.ease,
    easeSlice: {
      offset,
      length: parentLength,
      from: start.easeSlice?.from ?? start.speed,
      to: start.easeSlice?.to ?? end.speed,
    },
  }
}

/** Whether two slices are the same parent ramp. */
function sameParent(left: SpeedEaseSlice, right: SpeedEaseSlice): boolean {
  return left.length === right.length && left.from === right.from && left.to === right.to
}

/**
 * The keys with every pair of neighbouring pieces of one parent ramp that meet at a key merged
 * back into one segment, and a segment that is the whole parent ramp made a plain eased one
 * again. What joining the two halves of a split leaves.
 */
export function coalesceEaseSlices(keys: readonly SpeedKey[]): SpeedKey[] {
  const merged: SpeedKey[] = []
  for (const [index, key] of keys.entries()) {
    const previous = merged[merged.length - 1]
    const isInner = index < keys.length - 1
    if (
      isInner &&
      previous !== undefined &&
      previous.ease !== undefined &&
      previous.ease === key.ease &&
      previous.easeSlice !== undefined &&
      key.easeSlice !== undefined &&
      sameParent(previous.easeSlice, key.easeSlice) &&
      previous.easeSlice.offset + (key.frame - previous.frame) === key.easeSlice.offset
    ) {
      continue
    }
    merged.push(key)
  }
  return merged.map((key, index) => {
    const next = merged[index + 1]
    const slice = key.easeSlice
    if (slice === undefined || next === undefined) return key
    if (slice.offset !== 0 || next.frame - key.frame !== slice.length) return key
    return { frame: key.frame, speed: slice.from, ease: key.ease }
  })
}

/**
 * The ease fields of `key` for a curve whose frames are scaled by `factor` and whose speeds are
 * divided by `speedDivisor` (a hundredth after the division when it is not 1): an edge stretch
 * scales both, a curve edit that keeps the source span only the frames. The slice's frames are
 * rounded to whole frames; a slice that no longer fits its segment is dropped by the
 * normaliser, which leaves the plain ease.
 */
export function scaledEaseFields(
  key: SpeedKey,
  factor: number,
  speedDivisor: number,
): EaseFields {
  if (key.ease === undefined) return {}
  const slice = key.easeSlice
  if (slice === undefined) return { ease: key.ease }
  const scaleSpeed = (speed: number): number =>
    speedDivisor === 1 ? speed : Math.round((speed / speedDivisor) * 100) / 100
  return {
    ease: key.ease,
    easeSlice: {
      offset: Math.round(slice.offset * factor),
      length: Math.max(1, Math.round(slice.length * factor)),
      from: scaleSpeed(slice.from),
      to: scaleSpeed(slice.to),
    },
  }
}
