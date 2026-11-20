/**
 * The curve panel's read model of one clip (design 7.1, section 4.8).
 *
 * The panel edits the same keys the store holds: clip-relative whole frames with a speed, the
 * last one at the clip's current length. A clip without a curve is not a special case: it shows
 * a flat curve at its `speed`, so opening the panel on an ordinary clip and dragging a key is the
 * first edit that gives it a curve (the action then keeps the source span and takes the length
 * the shape needs).
 *
 * Every function here is pure and takes the clip length it works in, so the panel's numbers are
 * testable without a DOM: the source-frame labels and the readout ask `@/studio/speed`'s mapping,
 * never `item.speed`, which is the curve's average and only ever a length (design 7.1, section 8
 * risk 2).
 */

import type { TimelineItem } from '@/types/timeline'
import { floorFraction, multiplyFractions, rateRatio, toRate, type Rate } from '@/studio/time'
import {
  clipSourcePosition,
  MAX_CURVE_SPEED,
  MIN_CURVE_SPEED,
  speedAt,
  type SpeedCurve,
  type SpeedEase,
  type SpeedKey,
} from '@/studio/speed'
import { exactAreaAt } from '../exact-curve'

/** The clip's curve, or the flat curve its constant speed stands for. */
export function curveOnItem(item: TimelineItem): SpeedCurve {
  if (item.speedCurve !== undefined) return item.speedCurve
  const duration = Math.max(1, Math.round(item.durationInFrames))
  const speed = clampCurveSpeed(item.speed ?? 1)
  return {
    keys: [
      { frame: 0, speed },
      { frame: duration, speed },
    ],
  }
}

/** A speed clamped into the schema's curve range, `0.1..10`. */
export function clampCurveSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  return Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, speed))
}

/** A speed rounded to the hundredth, the precision the speed slider commits. */
export function roundCurveSpeed(speed: number): number {
  return Math.round(speed * 100) / 100
}

/**
 * A key as the panel rewrites it: the ease of the segment that starts there stays, the slice a
 * cut left on it goes, because an edit by hand re-authors the segment between the keys (the
 * shape then runs between the keys' own speeds).
 */
function authoredKey(key: SpeedKey, change: { frame?: number; speed?: number } = {}): SpeedKey {
  return {
    frame: change.frame ?? key.frame,
    speed: change.speed ?? key.speed,
    ...(key.ease !== undefined ? { ease: key.ease } : {}),
  }
}

/**
 * The keys with the key at `index` rewritten by `change`, and the slice of the segment that
 * ends at it dropped too: that segment's end moved, so it is no longer a piece of its old ramp.
 */
function withKeyChanged(
  keys: readonly SpeedKey[],
  index: number,
  change: { frame?: number; speed?: number },
): SpeedKey[] {
  return keys.map((key, keyIndex) => {
    if (keyIndex === index) return authoredKey(key, change)
    if (keyIndex === index - 1 && key.easeSlice !== undefined) return authoredKey(key)
    return key
  })
}

/** The curve with one key's speed changed; every other key is untouched. */
export function withKeySpeed(curve: SpeedCurve, index: number, speed: number): SpeedCurve {
  return { keys: withKeyChanged(curve.keys, index, { speed: clampCurveSpeed(speed) }) }
}

/**
 * The curve with the ease of the segment that starts at key `index` set: `linear` removes it. The
 * last key starts no segment, so it is left alone.
 */
export function withKeyEase(curve: SpeedCurve, index: number, ease: SpeedEase): SpeedCurve {
  if (index < 0 || index >= curve.keys.length - 1) return curve
  return {
    keys: curve.keys.map((key, keyIndex) => {
      if (keyIndex !== index) return key
      const plain = { frame: key.frame, speed: key.speed }
      return ease === 'linear' ? plain : { ...plain, ease }
    }),
  }
}

/**
 * The curve with one key's frame changed, kept between its neighbours by at least one frame, so
 * the list stays strictly increasing. The first and last keys are pinned to the clip's ends and
 * never move (design 7.1, section 4.8).
 */
export function withKeyFrame(curve: SpeedCurve, index: number, frame: number): SpeedCurve {
  const keys = curve.keys
  if (index <= 0 || index >= keys.length - 1) return curve
  const previous = keys[index - 1]!
  const next = keys[index + 1]!
  const target = Math.round(frame)
  const clamped = Math.min(next.frame - 1, Math.max(previous.frame + 1, target))
  return { keys: withKeyChanged(keys, index, { frame: clamped }) }
}

/** Samples inside an eased segment when the graph draws it. */
const EASED_SEGMENT_SAMPLES = 24

/**
 * The points the graph draws the curve through: every key, and for an eased segment samples of
 * the speed between its keys, so the polyline follows the bend (a linear segment needs only its
 * two ends).
 */
export function plottedCurvePoints(curve: SpeedCurve): Array<{ frame: number; speed: number }> {
  const points: Array<{ frame: number; speed: number }> = []
  for (const [index, key] of curve.keys.entries()) {
    points.push({ frame: key.frame, speed: key.speed })
    const next = curve.keys[index + 1]
    if (next === undefined || key.ease === undefined || key.ease === 'linear') continue
    for (let step = 1; step < EASED_SEGMENT_SAMPLES; step++) {
      const frame = key.frame + ((next.frame - key.frame) * step) / EASED_SEGMENT_SAMPLES
      points.push({ frame, speed: speedAt(curve, frame) })
    }
  }
  return points
}

/**
 * The frames a second the clip really shows at its slowest point: the source's frame rate times
 * the lowest speed on the curve (a 30 fps file at 1x shows 30, at 0.5x 15). An eased segment
 * stays between its keys' speeds, so the lowest key is the lowest speed. Compared with the
 * project's rate, it says whether slowing the clip leaves it too few frames (task 11.18).
 */
export function slowestFrameRate(
  curve: SpeedCurve,
  item: TimelineItem,
  projectFps: number,
): number {
  const slowest = Math.min(...curve.keys.map((key) => key.speed))
  return (item.sourceFps ?? projectFps) * slowest
}

/** Whether a rate is below the project's, past the rounding of the standard rates (29.97 x 2). */
export function isBelowProjectRate(fps: number, projectFps: number): boolean {
  return fps < projectFps - 0.01
}

/** The item's source and project rates as exact fractions. */
function itemRates(
  item: TimelineItem,
  projectFps: number,
): {
  sourceRate: Rate
  projectRate: Rate
} {
  return {
    sourceRate: toRate(item.sourceFps ?? projectFps),
    projectRate: toRate(projectFps),
  }
}

/**
 * The source frame the clip shows at one of its clip-relative timeline frames with `curve`:
 * the one mapping's (`clipSourcePosition`), the clip's cut remainder included, so a row shows
 * the frame the preview shows (review finding T8).
 */
export function keySourceFrame(
  curve: SpeedCurve,
  frame: number,
  item: TimelineItem,
  projectFps: number,
): number {
  return clipSourcePosition({ ...item, speedCurve: curve }, frame, projectFps).frame
}

/**
 * The source frames the whole curve spends: the curve's exact integral at the clip's length
 * with the rate ratio folded in, floored — the span the action writes into `sourceEnd` — not
 * the item's stored span, so the readout describes the curve the user is editing.
 */
export function sourceFramesUsed(
  curve: SpeedCurve,
  item: TimelineItem,
  projectFps: number,
): number {
  const { sourceRate, projectRate } = itemRates(item, projectFps)
  const duration = Math.max(1, Math.round(item.durationInFrames))
  return Number(
    floorFraction(
      multiplyFractions(exactAreaAt(curve, duration), rateRatio(sourceRate, projectRate)),
    ),
  )
}

/**
 * The speed the curve holds at the playhead, and the clip-relative frame it was read at: a
 * playhead outside the clip reads the nearer end, so the readout never shows a number the clip
 * does not have.
 */
export function speedAtPlayhead(
  curve: SpeedCurve,
  playhead: number,
  item: TimelineItem,
): { frame: number; speed: number } {
  const duration = Math.max(1, Math.round(item.durationInFrames))
  const relative = Math.min(duration, Math.max(0, Math.round(playhead - item.from)))
  return { frame: relative, speed: speedAt(curve, relative) }
}

/**
 * The pinned keys' positions: the first at frame 0 and the last at the clip's length. A key list
 * that does not carry both (a hand-edited project) is normalised by the store, so the panel can
 * rely on them.
 */
function pinnedKeyIndexes(curve: SpeedCurve): { first: number; last: number } {
  return { first: 0, last: Math.max(0, curve.keys.length - 1) }
}

/** One key's row in the panel's list. */
export interface CurveKeyRow {
  /** The key's clip-relative frame. */
  frame: number
  /** The key's speed, in x. */
  speed: number
  /** The source frame the clip shows at the key. */
  sourceFrame: number
  /** Whether the frame is pinned to an end of the clip. */
  pinned: boolean
  /** The ease of the segment that starts at the key; `linear` for the last key. */
  ease: SpeedEase
}

/** The key rows the panel lists, with each key's source frame (design 7.1, section 4.8). */
export function curveKeyRows(
  curve: SpeedCurve,
  item: TimelineItem,
  projectFps: number,
): CurveKeyRow[] {
  const { last } = pinnedKeyIndexes(curve)
  return curve.keys.map((key: SpeedKey, index: number) => ({
    frame: key.frame,
    speed: key.speed,
    sourceFrame: keySourceFrame(curve, key.frame, item, projectFps),
    pinned: index === 0 || index === last,
    ease: index === last ? 'linear' : (key.ease ?? 'linear'),
  }))
}
