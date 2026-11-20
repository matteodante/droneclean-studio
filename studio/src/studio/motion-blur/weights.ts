/**
 * The source frames an output frame's motion blur is made of, their weights (design 7.2, section 4.1), and the shutter
 * time each one stands for, which the vector blur blurs it over (design 9.2, section 5.3).
 *
 * Output frame `n`'s span is `[P(n), P(n + 1))` in source frames, where `P` is the clip's exact
 * source position (`clipSourcePosition`, the one mapping every reader asks). A camera's
 * shutter opens at its own frame's timestamp, so the window is **causal**: it opens
 * at `a0` and lasts `shutter / 360 · (a1 - a0)`. Every integer source frame the span covers —
 * `floor(a0)` through `ceil(a1) - 1` — takes the part of its own interval `[i, i + 1)` that
 * falls inside the window, divided by the window's length (the sum of those parts). A frame wholly outside the window
 * is not a sample at all: nothing needs decoding to weight 0. A plan's weights sum to 1, so a
 * blend neither darkens nor brightens the picture, and a window inside one source frame is
 * that frame at weight 1.
 *
 * Each sample also carries its `extent`, the part of the window it stands for in source frames (its overlap: weight
 * times the window's length). The vector blur (design 9.2) blurs every sample along its own motion over its extent,
 * centred on its time, before the weighted average, so the samples of a sped-up frame join into one smear instead of
 * showing as copies, and a frame at 1x or slower is blurred over the shutter's share of its interval.
 *
 * The span is a real interval, not a count: a fractional speed weights by time, and a rate
 * conversion makes a 10x span land on 10 or 11 integer frames. The span's integer frames are
 * taken from the exact positions — the first is the frame the picture shows, the cut's remainder
 * included (design 7.1, section 4.6) — so a blend is made of the frames the clip plays, and a
 * cut clip blends its parent's frames; only the weights are doubles.
 *
 * Invalid input throws a `RangeError` naming the argument. The store's normaliser is what
 * repairs a value from a project file — a shutter outside (0, 360] falls back to 180 (design 9.2,
 * section 0) — so by the time the maths runs, a wrong value is a caller's bug; a silent clamp
 * here would render a look the pilot did not choose.
 */

import { clipSourcePosition, type ClipTiming } from '@/studio/speed'
import { ceilFraction, fractionToNumber, type Rate } from '@/studio/time'
import { isShutterDegrees, MAX_SHUTTER_DEGREES } from './settings'
import type { ShutterDegrees, SmoothSlowMotion } from './types'

/** One source frame of an output frame's blend: its index, its share of the shutter window, and the time it stands for. */
export interface MotionBlurSample {
  /** The integer source frame index, the one the decoder is asked for. */
  readonly sourceFrame: number
  /** The share of the blend: greater than 0, and a plan's shares sum to 1. */
  readonly weight: number
  /**
   * The shutter time this sample stands for, in source frames, greater than 0: the vector blur blurs it along its
   * motion over this long, centred on its time (design 9.2, section 5.3). Its overlap with the window (`weight` times
   * the window's length); each frame of a smooth slow motion stands for the whole window.
   */
  readonly extent: number
}

/** The blend one output frame is made of: the source span it covers and its weighted samples. */
export interface MotionBlurPlan {
  /** The span's first edge `a0`: a real source frame index, `sourceStart` included. */
  readonly startFrame: number
  /** One past the span's last edge `a1`. */
  readonly endFrame: number
  /**
   * The source frames the output frame covers, `ceil(endFrame) - floor(startFrame)`: the decode
   * count `N` of design 7.2 section 4.4, which a partial shutter leaves larger than `samples`.
   */
  readonly frameCount: number
  /** The frames inside the shutter window, by increasing index; never empty. */
  readonly samples: readonly MotionBlurSample[]
  /**
   * Optical-flow slow motion only (task 11.12): the frame lies strictly between `samples[0]` and `samples[1]`, at this
   * phase in (0, 1) of the gap from the first to the second, and is made by moving both along the motion between them.
   * The samples are then the blend of the two, `1 - phase` and `phase`, which the flow falls back to where it cannot
   * trust the motion. Absent on every other plan.
   */
  readonly flowPhase?: number
}

/** A source span as real source frame indices, `sourceStart` included. */
interface SourceFrameSpan {
  /** The first source frame the output frame covers, as a real source frame index. */
  readonly startFrame: number
  /** One past the last one, as a real source frame index. */
  readonly endFrame: number
}

/** One question to `planMotionBlur`: the clip, its output frame, and the shutter angle. */
export interface MotionBlurQuery {
  /**
   * The clip's timing — its source start, speed or speed curve, source rate and cut remainder —
   * as the one mapping reads it (a timeline item is one).
   */
  clip: ClipTiming
  /** The output frame, counted from the clip's first frame: an integer >= 0. */
  timelineFrame: number
  /** The project's rate. */
  projectRate: Rate
  /** The shutter in degrees: a number in [0, 360]; 0 blurs nothing. */
  shutterDegrees: ShutterDegrees
  /** Make a slow-motion frame from the two source frames around it, and how (`MotionBlurSettings.smoothSlowMotion`). */
  smoothSlowMotion?: SmoothSlowMotion
}

/** The fraction of the span the shutter is open, `shutterDegrees / 360`; throws outside [0, 360]. */
function shutterFraction(shutterDegrees: ShutterDegrees): number {
  if (!isShutterDegrees(shutterDegrees)) {
    throw new RangeError(
      `planMotionBlur: shutterDegrees must be a number in [0, 360], got ${String(shutterDegrees)}`,
    )
  }
  return shutterDegrees / MAX_SHUTTER_DEGREES
}

/** Check a span is a finite, non-empty interval; the error names the function and the values. */
function assertSpan(functionName: string, span: SourceFrameSpan): void {
  const { startFrame, endFrame } = span
  if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame)) {
    throw new RangeError(
      `${functionName}: the span must be finite, got [${startFrame}, ${endFrame})`,
    )
  }
  if (!(endFrame > startFrame)) {
    throw new RangeError(
      `${functionName}: the span must be non-empty, got [${startFrame}, ${endFrame})`,
    )
  }
}

/**
 * How many source frames an output frame covers: `ceil(endFrame) - floor(startFrame)`, the
 * decode count `N` of design 7.2 section 4.4. It counts the whole span, so a 180-degree
 * shutter at 4x still decodes 4 frames although only 2 of them carry weight; the stream has
 * to reach the next output frame's start either way.
 *
 * @throws RangeError when the span is not finite or not non-empty.
 */
export function motionBlurFrameCount(span: SourceFrameSpan): number {
  assertSpan('motionBlurFrameCount', span)
  return Math.ceil(span.endFrame) - Math.floor(span.startFrame)
}

/**
 * The frame blend of a slow-motion output frame (19 Nov 2026): it sits at `position` between source frames `first` and
 * `first + 1`, and takes each in proportion to how near it is, `1 - t` and `t` for `t = position - first`. A frame
 * that lands on a whole source frame (within 1e-6) is that frame alone, so a 2x slow-down alternates a source frame
 * and an even mix of two, and a clip at 1x with equal rates never blends. The optical-flow mode starts from the same
 * two samples: `t` is its phase, and the blend is what it falls back to. Both frames stand for the output frame's whole
 * shutter, `extent`.
 */
function slowMotionBlend(position: number, first: number, extent: number): MotionBlurSample[] {
  const t = position - first
  if (t <= 1e-6) return [{ sourceFrame: first, weight: 1, extent }]
  if (t >= 1 - 1e-6) return [{ sourceFrame: first + 1, weight: 1, extent }]
  return [
    { sourceFrame: first, weight: 1 - t, extent },
    { sourceFrame: first + 1, weight: t, extent },
  ]
}

/**
 * The blend of one output frame (design 7.2, section 4.1): its source span, the decode count,
 * and one sample per source frame inside the causal shutter window.
 *
 * The span is the clip's exact positions at `n` and `n + 1` (`clipSourcePosition`), the cut's
 * remainder included; the window opens at the span's start and lasts the shutter's fraction of
 * it. The first sample is the frame the picture shows at `n`. Samples are in increasing
 * source-frame order, their weights sum to 1, and in a 1x or slower hold there is exactly one
 * at weight 1, standing for the whole window (`extent`: the shutter's fraction of the span).
 *
 * @throws RangeError naming the argument when `shutterDegrees` is not in [0, 360] or
 * `timelineFrame` is not an integer >= 0, or the clip's timing is broken (as
 * `clipSourcePosition` names it).
 */
export function planMotionBlur(query: MotionBlurQuery): MotionBlurPlan {
  const fraction = shutterFraction(query.shutterDegrees)
  if (!Number.isSafeInteger(query.timelineFrame) || query.timelineFrame < 0) {
    throw new RangeError(
      `planMotionBlur: timelineFrame must be an integer >= 0, got ${query.timelineFrame}`,
    )
  }
  const start = clipSourcePosition(query.clip, query.timelineFrame, query.projectRate)
  const end = clipSourcePosition(query.clip, query.timelineFrame + 1, query.projectRate)
  const startFrame = fractionToNumber(start.position)
  const endFrame = fractionToNumber(end.position)
  assertSpan('planMotionBlur', { startFrame, endFrame })
  // The span's integer frames from the exact positions: `floor(P(n))` through `ceil(P(n+1)) − 1`.
  const firstFrame = start.frame
  const lastFrame = Number(ceilFraction(end.position)) - 1
  const frameCount = lastFrame - firstFrame + 1
  const duration = fraction * (endFrame - startFrame)
  if (query.smoothSlowMotion !== undefined && endFrame - startFrame < 1) {
    const samples = slowMotionBlend(startFrame, firstFrame, duration)
    // A frame between two source frames is interpolated in flow mode; one on a source frame is that frame.
    const flowPhase =
      query.smoothSlowMotion === 'optical-flow' && samples.length === 2 ? samples[1]!.weight : undefined
    return { startFrame, endFrame, frameCount, samples, ...(flowPhase !== undefined ? { flowPhase } : {}) }
  }
  // A closed shutter blurs nothing: the frame the picture shows at `n`, as it is (`extent` 0 carries no blur)
  if (duration === 0) return { startFrame, endFrame, frameCount, samples: [{ sourceFrame: firstFrame, weight: 1, extent: 0 }] }
  const open = startFrame
  const close = open + duration
  const overlaps: Array<{ sourceFrame: number; overlap: number }> = []
  for (let sourceFrame = firstFrame; sourceFrame <= lastFrame; sourceFrame += 1) {
    // The part of [sourceFrame, sourceFrame + 1) inside [open, close). A partial shutter's
    // window ends before the span does, so the frames past it get no weight and no sample.
    const overlap = Math.min(sourceFrame + 1, close) - Math.max(sourceFrame, open)
    if (overlap > 0) overlaps.push({ sourceFrame, overlap })
  }
  // Divided by their own sum, which is the window's length up to rounding: a window inside one frame is that frame at
  // weight 1 exactly, never 1 + 1e-13 (which `close - open` against `duration` gives for a small shutter at a
  // fractional position, and which the stage pipeline refuses)
  const total = overlaps.reduce((sum, entry) => sum + entry.overlap, 0)
  const samples = overlaps.map(({ sourceFrame, overlap }) => ({ sourceFrame, weight: overlap / total, extent: overlap }))
  return { startFrame, endFrame, frameCount, samples }
}
