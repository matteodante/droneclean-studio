// The one place a clip frame becomes source frames (design 3.6 section 2.5). Blur off: one sample at weight 1, at the
// integer source frame the clip shows. Blur on: `planMotionBlur`'s weighted samples over the span the output frame
// covers. The source frame comes from `clipSourcePosition(item, clipFrame, projectFps)` of `@/studio/speed` (review
// finding T8), through `exactSourcePosition`: the plan takes the mapping's own integer `frame`, never the floor of a
// double, so a position within 1e-12 of a whole frame still names the right one.

import { planMotionBlur, restrictToSourceRange, type MotionBlurQuery } from '@/studio/motion-blur'
import { clipSourcePosition } from '@/studio/speed'
import type { Rate } from '@/studio/time'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { hasMotionBlur } from './predicates'

/** One source frame of an output frame's picture: the integer index the decoder is asked for, and its share. */
export interface SourceSample {
  readonly index: number
  readonly weight: number
}

/** The source frames one output frame is made of: weights above 0 that sum to 1, by increasing index. */
export interface SourceFramePlan {
  readonly samples: readonly SourceSample[]
}

/** What the plan needs from the time code. */
export interface SourceFramePlanSources {
  /**
   * The source frame the clip's frame `clipFrame` shows, counted from the file's first frame: the `frame` of
   * `clipSourcePosition` (see `exactSourcePosition`).
   */
  position(item: VideoItem, clipFrame: number): { readonly frame: number }
  /**
   * The blur question for the clip's frame `clipFrame`, or `undefined` when the clip has no blur: its curve, source
   * start, rates, cut remainder and shutter angle. Called only when the clip's motion blur is on.
   */
  motionBlurQuery(item: VideoItem, clipFrame: number): MotionBlurQuery | undefined
  /**
   * How many frames the source file holds (the media record's count, `VideoItem.sourceDuration`), or `undefined` when
   * it is not known. A blend's samples outside `[0, count)` are dropped and the rest renormalised.
   */
  sourceFrameCount?(item: VideoItem): number | undefined
}

/** The plan's `position` over the one exact mapping, for a project at `projectFps` (a number or an exact rate). */
export function exactSourcePosition(
  projectFps: number | Rate,
): SourceFramePlanSources['position'] {
  return (item, clipFrame) => ({ frame: clipSourcePosition(item, clipFrame, projectFps).frame })
}

/**
 * The plan of one clip frame.
 *
 * @throws RangeError when the source frame is not a whole number >= 0 (a plan with a negative frame is a caller's bug).
 */
export function sourceFramePlan(
  item: TimelineItem,
  clipFrame: number,
  sources: SourceFramePlanSources,
): SourceFramePlan {
  if (item.type !== 'video') {
    throw new RangeError(`sourceFramePlan: a ${item.type} item has no source frames`)
  }
  const query = hasMotionBlur(item) ? sources.motionBlurQuery(item, clipFrame) : undefined
  if (query !== undefined) {
    const plan = planMotionBlur(query)
    const count = sources.sourceFrameCount?.(item)
    const samples =
      count !== undefined && Number.isSafeInteger(count) && count >= 1
        ? restrictToSourceRange(plan.samples, count)
        : plan.samples
    return { samples: samples.map((s) => ({ index: s.sourceFrame, weight: s.weight })) }
  }
  const { frame } = sources.position(item, clipFrame)
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError(`sourceFramePlan: the source frame must be a whole number >= 0, got ${frame}`)
  }
  return { samples: [{ index: frame, weight: 1 }] }
}
