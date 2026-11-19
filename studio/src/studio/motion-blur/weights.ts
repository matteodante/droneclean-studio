/**
 * The source frames an output frame's motion blur is made of, and their weights (design 7.2,
 * section 4.1).
 *
 * Output frame `n`'s span is `[P(n), P(n + 1))` in source frames, where `P` is the clip's exact
 * source position (`clipSourcePosition`, the one mapping every reader asks). A camera's
 * shutter opens at its own frame's timestamp, so the window is **causal**: it opens
 * at `a0` and lasts `shutter / 360 · (a1 - a0)`. Every integer source frame the span covers —
 * `floor(a0)` through `ceil(a1) - 1` — takes the part of its own interval `[i, i + 1)` that
 * falls inside the window, divided by the window's length. A frame wholly outside the window
 * is not a sample at all: nothing needs decoding to weight 0. A plan's weights sum to 1, so a
 * blend neither darkens nor brightens the picture, and a window inside one source frame is
 * that frame at weight 1 — which is why every angle is the identity at and below 1x.
 *
 * The span is a real interval, not a count: a fractional speed weights by time, and a rate
 * conversion makes a 10x span land on 10 or 11 integer frames. The span's integer frames are
 * taken from the exact positions — the first is the frame the picture shows, the cut's remainder
 * included (design 7.1, section 4.6) — so a blend is made of the frames the clip plays, and a
 * cut clip blends its parent's frames; only the weights are doubles.
 *
 * Invalid input throws a `RangeError` naming the argument. The store's normaliser is what
 * repairs a value from a project file — an unknown shutter falls back to 360 (design 7.2,
 * section 4.7) — so by the time the maths runs, a wrong value is a caller's bug; a silent clamp
 * here would render a look the pilot did not choose.
 */

import { clipSourcePosition, type ClipTiming } from '@/studio/speed'
import { ceilFraction, fractionToNumber, type Rate } from '@/studio/time'
import type { ShutterDegrees } from './types'

/** One source frame of an output frame's blend: its index and its share of the shutter window. */
export interface MotionBlurSample {
  /** The integer source frame index, the one the decoder is asked for. */
  readonly sourceFrame: number
  /** The share of the blend: greater than 0, and a plan's shares sum to 1. */
  readonly weight: number
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
  /** The shutter angle in degrees: one of 90, 180, 270, 360. */
  shutterDegrees: ShutterDegrees
}

/** The fraction of the span the shutter is open, `shutterDegrees / 360`; throws on any other value. */
function shutterFraction(shutterDegrees: ShutterDegrees): number {
  switch (shutterDegrees) {
    case 90:
      return 0.25
    case 180:
      return 0.5
    case 270:
      return 0.75
    case 360:
      return 1
    default:
      throw new RangeError(
        `planMotionBlur: shutterDegrees must be 90, 180, 270 or 360, got ${String(shutterDegrees)}`,
      )
  }
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
 * The blend of one output frame (design 7.2, section 4.1): its source span, the decode count,
 * and one sample per source frame inside the causal shutter window.
 *
 * The span is the clip's exact positions at `n` and `n + 1` (`clipSourcePosition`), the cut's
 * remainder included; the window opens at the span's start and lasts the shutter's fraction of
 * it. The first sample is the frame the picture shows at `n`. Samples are in increasing
 * source-frame order, their weights sum to 1, and in a 1x or slower hold there is exactly one
 * at weight 1 for every angle.
 *
 * @throws RangeError naming the argument when `shutterDegrees` is not one of the four angles or
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
  const open = startFrame
  const close = open + duration
  const samples: MotionBlurSample[] = []
  for (let sourceFrame = firstFrame; sourceFrame <= lastFrame; sourceFrame += 1) {
    // The part of [sourceFrame, sourceFrame + 1) inside [open, close). A partial shutter's
    // window ends before the span does, so the frames past it get no weight and no sample.
    const overlap = Math.min(sourceFrame + 1, close) - Math.max(sourceFrame, open)
    if (overlap > 0) {
      samples.push({ sourceFrame, weight: overlap / duration })
    }
  }
  return { startFrame, endFrame, frameCount, samples }
}
