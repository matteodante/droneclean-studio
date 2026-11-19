/**
 * Which source frame a timeline frame shows when the clip has a speed curve, and how long a
 * clip must be to spend a source span (design 7.1, sections 4.2 and 4.6-4.7).
 *
 * `sourceFrameAt` is `sourceStart + floor(area(n)·sNum·pDen/(sDen·pNum))`: the integral of
 * `curve.ts`, the rate ratio folded in once, floored from the frame index — never a sum over
 * frames, so it is monotone and cannot drift. On a constant curve it calls `@/studio/time`'s
 * `sourceFrameAt`, so a flat curve and no curve cannot disagree by a bit; the same holds for
 * `timelineFramesForSource` against the time module's inverse.
 *
 * A curve's clip keeps its `speed` equal to `averageSpeed` (slice B), and that value is a
 * length, never a position: a reader that wants a source frame for a timeline frame asks here.
 *
 * For motion blur (7.2): `sourceSpanCoveredBy(n)` is output frame `n`'s span in source frames;
 * the samples are weighted by each frame's overlap with the shutter window (design 7.2,
 * section 4.1), never by `speedAt(n)`. The span's integer source frames are
 * `floor(startFrame)` through `ceil(endFrame) - 1` — at most 11 of them at 10x — and the union
 * over consecutive `n` has no gap, because `startFrame(n + 1)` and `endFrame(n)` are the same
 * double.
 */

import {
  floorFraction,
  multiplyFractions,
  rateRatio,
  sourceFrameAt as flatSourceFrameAt,
  timelineFramesForSource as flatTimelineFramesForSource,
  toRate,
  type Rate,
} from '@/studio/time'
import { areaAt, constantSpeed, frameAtArea, type SpeedCurve } from './curve'
import { exactAreaAt } from './exact-curve'

/** A source span as real source frame indices, `sourceStart` included. */
export interface SourceFrameSpan {
  /** The first source frame the output frame covers, as a real source frame index. */
  readonly startFrame: number
  /** One past the last one, as a real source frame index; always greater than `startFrame`. */
  readonly endFrame: number
}

/** A frame count must be an integer >= 0; the error names the argument and the function. */
function assertFrameCount(functionName: string, argumentName: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${functionName}: ${argumentName} must be an integer >= 0, got ${value}`)
  }
}

/**
 * The exact source position at `timelineFrame`, in source frames counted from the clip's
 * `sourceStart`:
 *
 *     sourceFrames(n) = area(n)·sNum·pDen / (sDen·pNum)
 *
 * A real number, not floored: audio (design 7.1, 4.3) reads it directly, the video mapping
 * floors it, and a motion-blur span is the difference of two of them.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does), `timelineFrame` when
 * it is not an integer >= 0, or a rate that is not a rate of positive integers.
 */
export function sourceFramesAt(
  curve: SpeedCurve,
  timelineFrame: number,
  sourceRate: Rate,
  projectRate: Rate,
): number {
  assertFrameCount('sourceFramesAt', 'timelineFrame', timelineFrame)
  const source = toRate(sourceRate)
  const project = toRate(projectRate)
  return (areaAt(curve, timelineFrame) * source.num * project.den) / (source.den * project.num)
}

/**
 * The source frame shown at `timelineFrame` when the clip has `curve` and no cut remainder:
 *
 *     sourceStart + floor(sourceFrames(n))
 *
 * **Rounded down**, from the frame index, exactly as `@/studio/time`'s `sourceFrameAt`: a
 * source frame is shown from its own timestamp until the next one starts. The floor is of the
 * exact integral (`exact-curve.ts`). On a constant curve the time module answers, so a flat
 * curve and no curve agree frame for frame by construction. A clip's frame — remainder
 * included — is `clipSourcePosition`'s.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does), `timelineFrame` or
 * `sourceStart` when they are not integers >= 0, or a rate that is not a rate of positive
 * integers.
 */
export function sourceFrameAt(
  curve: SpeedCurve,
  timelineFrame: number,
  sourceStart: number,
  sourceRate: Rate,
  projectRate: Rate,
): number {
  assertFrameCount('sourceFrameAt', 'timelineFrame', timelineFrame)
  assertFrameCount('sourceFrameAt', 'sourceStart', sourceStart)
  const flatSpeed = constantSpeed(curve)
  if (flatSpeed !== undefined) {
    return flatSourceFrameAt({
      timelineFrame,
      sourceStart,
      speed: flatSpeed,
      sourceRate,
      projectRate,
    })
  }
  // The floor is taken of the exact integral, never of a double (review finding T3).
  const exact = multiplyFractions(
    exactAreaAt(curve, timelineFrame),
    rateRatio(toRate(sourceRate), toRate(projectRate)),
  )
  return sourceStart + Number(floorFraction(exact))
}

/**
 * How many timeline frames it takes to spend `sourceFrames` source frames on `curve`, as a
 * **real** duration: the design's inverse, `frameAtArea(curve, sourceFrames·sDen·pNum/
 * (sNum·pDen))` (design 7.1, 4.2). Callers round it: the retime rounds, "cannot extend
 * further" clamps floor. The round trip through `areaAt` is exact to 1.4e-14 source frames over
 * the design's 2,310-frame span (design 7.1, 5.2).
 *
 * A constant curve divides directly, as the time module does, so a flat curve's duration is
 * the duration of the clip of today.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does), `sourceFrames` when
 * it is not an integer >= 0, or a rate that is not a rate of positive integers.
 */
export function timelineDurationForSource(
  curve: SpeedCurve,
  sourceFrames: number,
  sourceRate: Rate,
  projectRate: Rate,
): number {
  assertFrameCount('timelineDurationForSource', 'sourceFrames', sourceFrames)
  const flatSpeed = constantSpeed(curve)
  const source = toRate(sourceRate)
  const project = toRate(projectRate)
  if (flatSpeed !== undefined) {
    return (sourceFrames * source.den * project.num) / (source.num * project.den * flatSpeed)
  }
  return frameAtArea(curve, (sourceFrames * source.den * project.num) / (source.num * project.den))
}

/**
 * The clip's timeline length for a source span: `ceil(timelineDurationForSource(...))`, the
 * smallest whole number of timeline frames that shows the last source frame — the rule
 * `@/studio/time` applies with no curve. On a constant curve it calls the time module's
 * `timelineFramesForSource`, so a flat curve and no curve give the same clip length bit for
 * bit.
 *
 * A curve on a clip of fixed length does not choose its duration: its keys are pinned to the
 * duration and the design's curve edit moves the duration by the real value, keeping the shape
 * (design 7.1, 4.6). This function answers the other question, a duration from a source span.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does), `sourceFrames` when
 * it is not an integer >= 0, or a rate that is not a rate of positive integers.
 */
export function timelineFramesForSource(
  curve: SpeedCurve,
  sourceFrames: number,
  sourceRate: Rate,
  projectRate: Rate,
): number {
  assertFrameCount('timelineFramesForSource', 'sourceFrames', sourceFrames)
  const flatSpeed = constantSpeed(curve)
  if (flatSpeed !== undefined) {
    return flatTimelineFramesForSource(sourceFrames, sourceRate, projectRate, flatSpeed)
  }
  return Math.ceil(timelineDurationForSource(curve, sourceFrames, sourceRate, projectRate))
}

/**
 * The source span output frame `timelineFrame` covers, as real source frame indices counted
 * from `sourceStart`:
 *
 *     [sourceFrames(n), sourceFrames(n + 1))
 *
 * Motion blur (7.2) blurs the integer source frames `floor(startFrame)` through
 * `ceil(endFrame) - 1` — at most 11 at 10x, and 4 inside a 4x or 1 inside a 1x hold when the
 * rates are equal — weighted by `speedAt(n)`. Consecutive output frames share their boundary
 * value, so their integer spans have no gap; where the boundary falls inside a source frame,
 * the two output frames both cover it.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does), `timelineFrame` or
 * `sourceStart` when they are not integers >= 0, or a rate that is not a rate of positive
 * integers.
 */
export function sourceSpanCoveredBy(
  curve: SpeedCurve,
  timelineFrame: number,
  sourceStart: number,
  sourceRate: Rate,
  projectRate: Rate,
): SourceFrameSpan {
  assertFrameCount('sourceSpanCoveredBy', 'timelineFrame', timelineFrame)
  assertFrameCount('sourceSpanCoveredBy', 'sourceStart', sourceStart)
  return {
    startFrame: sourceStart + sourceFramesAt(curve, timelineFrame, sourceRate, projectRate),
    endFrame: sourceStart + sourceFramesAt(curve, timelineFrame + 1, sourceRate, projectRate),
  }
}
