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

/** The curve with one key's speed changed; every other key is untouched. */
export function withKeySpeed(curve: SpeedCurve, index: number, speed: number): SpeedCurve {
  return {
    keys: curve.keys.map((key, keyIndex) =>
      keyIndex === index ? { frame: key.frame, speed: clampCurveSpeed(speed) } : key,
    ),
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
  return {
    keys: keys.map((key, keyIndex) =>
      keyIndex === index ? { frame: clamped, speed: key.speed } : key,
    ),
  }
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
  }))
}
