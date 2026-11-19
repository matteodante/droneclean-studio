/**
 * The one normaliser for a clip's speed curve (design 7.1, section 4.1).
 *
 * Every write of a curve goes through this before it reaches a store: the keys are sorted,
 * their frames are made integers inside the clip, the first key is pinned to frame 0, the last
 * to the clip's duration, every speed is clamped into `0.1..10`, and a curve of one key grows
 * to two so the segment between them exists. The caller stores the result on the item and sets
 * the item's `speed` to `averageSpeed` of it, so every FreeCut length calculation
 * (`timelineToSourceFrames`) still returns the curve's source span and no reader that uses
 * `speed` for a length has to know about curves.
 *
 * A curve it cannot repair is dropped (`undefined`) rather than thrown: this runs on every
 * edit, and a hand-edited file must load as the clip of today, at its constant `speed`, not as
 * a crash (design 7.1, section 8 risk 5). Dropping a curve leaves `speed` alone, which is the
 * average the curve last wrote, so the clip keeps its length.
 *
 * A reversed clip's curve is dropped by the store's normaliser, not here: this module only
 * knows what a curve is. A composition wrapper is ignored by the render path — sub-composition
 * time is not source frames — so a hand-edited file that carries one there plays at the clip's
 * constant `speed` (design 7.1, section 4.6).
 */

import { MAX_SPEED_DENOMINATOR } from '@/studio/time'
import { MAX_CURVE_SPEED, MIN_CURVE_SPEED, type SpeedCurve, type SpeedKey } from './curve'

/**
 * The longest ramp — a segment between two keys of different speeds — a curve may hold:
 * 83,886 frames, `floor(2^23 / 100)` (23 minutes at 60 fps). A cut inside a ramp of length `L`
 * inserts a key whose speed is a fraction with denominator `100·L`, and a stored speed is read
 * back exactly only up to the denominator `MAX_SPEED_DENOMINATOR` (2^23); so a longer ramp is
 * refused here, where every curve is written, rather than cut inexactly later. A hold (one speed
 * on both keys) has no such limit: a cut inside it inserts that speed.
 */
export const MAX_RAMP_SEGMENT_FRAMES = Math.floor(MAX_SPEED_DENOMINATOR / 100)

/** Whether a ramp in `keys` is longer than `MAX_RAMP_SEGMENT_FRAMES`. */
function hasOverlongRamp(keys: readonly SpeedKey[]): boolean {
  for (let index = 1; index < keys.length; index++) {
    const start = keys[index - 1]!
    const end = keys[index]!
    if (start.speed !== end.speed && end.frame - start.frame > MAX_RAMP_SEGMENT_FRAMES) {
      return true
    }
  }
  return false
}

/**
 * Read one key off data that came from outside (a project file, the SDK): a finite `frame` and
 * a finite `speed`, or `undefined` when the value is not a key at all.
 */
function readKey(value: unknown): { frame: number; speed: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { frame?: unknown; speed?: unknown }
  const { frame, speed } = candidate
  if (typeof frame !== 'number' || !Number.isFinite(frame)) return undefined
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return undefined
  return { frame, speed }
}

/**
 * Normalise a speed curve against the timeline length of the clip that holds it (design 7.1,
 * section 4.1), or `undefined` when there is no curve it can repair.
 *
 * The result has at least two keys, strictly increasing integer frames from 0 to
 * `durationInFrames`, and speeds in `MIN_CURVE_SPEED..MAX_CURVE_SPEED`. Keys are sorted;
 * frames are rounded and clamped into the clip; two keys that land on one frame keep the
 * later one (the segment that starts there); a missing key at frame 0 is inserted with the
 * first key's speed, and a missing key at the end is appended with the last key's speed, so
 * the curve covers the whole clip without changing the shape inside it.
 *
 * Returns `undefined` for a curve whose data is not a non-empty list of keys, for a non-finite
 * frame, for a clip shorter than one frame (a key needs two frames to exist), and for a curve
 * with a ramp longer than `MAX_RAMP_SEGMENT_FRAMES`. The input is not mutated: the result is new
 * objects, ready to store.
 *
 * Speeds are clamped, never rounded: a key a cut inserted holds its parent line's fraction, and
 * rounding it would move the clip off its parent's frames. An edit by a person rounds to the
 * hundredth before it gets here (`setSpeedCurve`, `stretchSpeedCurve`).
 */
export function normalizeSpeedCurve(
  curve: SpeedCurve | undefined,
  durationInFrames: number,
): SpeedCurve | undefined {
  if (curve === undefined) return undefined
  if (!Array.isArray(curve.keys)) return undefined
  const keys: readonly unknown[] = curve.keys
  if (keys.length === 0) return undefined
  if (!Number.isFinite(durationInFrames) || durationInFrames < 1) return undefined
  const duration = Math.round(durationInFrames)

  const speedAtFrame = new Map<number, number>()
  for (const value of keys) {
    const key = readKey(value)
    if (key === undefined) return undefined
    const frame = Math.min(duration, Math.max(0, Math.round(key.frame)))
    speedAtFrame.set(frame, Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, key.speed)))
  }

  const frames = [...speedAtFrame.keys()].sort((left, right) => left - right)
  const normalized: SpeedKey[] = frames.map((frame) => ({ frame, speed: speedAtFrame.get(frame)! }))
  const first = normalized[0]!
  if (first.frame !== 0) {
    normalized.unshift({ frame: 0, speed: first.speed })
  }
  const last = normalized[normalized.length - 1]!
  if (last.frame !== duration) {
    normalized.push({ frame: duration, speed: last.speed })
  }
  if (hasOverlongRamp(normalized)) return undefined
  return { keys: normalized }
}
