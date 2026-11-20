// The one place a clip frame becomes source frames (design 3.6 section 2.5). Blur off: one sample at weight 1, at the
// integer source frame the clip shows. Blur on: `planMotionBlur`'s weighted samples over the span the output frame
// covers, each with the shutter time it stands for, which the vector blur blurs it over (design 9.2). The source frame comes from `clipSourcePosition(item, clipFrame, projectFps)` of `@/studio/speed` (review
// finding T8), through `exactSourcePosition`: the plan takes the mapping's own integer `frame`, never the floor of a
// double, so a position within 1e-12 of a whole frame still names the right one. `timelineFramePlan` is that plan for a
// timeline frame as the renderer draws it (its render span, a transition's pre-roll); the stabilization's look-ahead
// asks the same function which frames the clips the playhead reaches next will read (`stabilize-ahead.ts`).

import {
  getItemRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
  type RenderTimelineSpan,
} from '@/runtime/renderer/render-span'
import { planMotionBlur, restrictToSourceRange, type MotionBlurQuery } from '@/studio/motion-blur'
import { clipSourcePosition } from '@/studio/speed'
import { secondsToFrame, toRate, type Rate } from '@/studio/time'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { hasMotionBlur } from './predicates'

/** One source frame of an output frame's picture: the integer index the decoder is asked for, and its share. */
export interface SourceSample {
  readonly index: number
  readonly weight: number
  /**
   * With motion blur on: the shutter time this frame stands for, in source frames (> 0); the pipeline blurs it along
   * each pixel's motion over that long, centred on its time (design 9.2). Absent: the frame as it is (blur off, or
   * an Amount of 0).
   */
  readonly extent?: number
}

/**
 * The source frames one output frame is made of: weights above 0 that sum to 1, by increasing index. With motion blur
 * on (and an Amount above 0) every sample has an `extent`; otherwise none has.
 */
export interface SourceFramePlan {
  readonly samples: readonly SourceSample[]
  /**
   * Optical-flow slow motion (task 11.12): the frame is interpolated at `phase` (in (0, 1)) of the gap from
   * `samples[0]` to `samples[1]`, two consecutive source frames, whose weights are then the blend `1 - phase`, `phase`
   * the flow falls back to where it cannot trust the motion. Absent: the samples are blended (or the one is shown).
   */
  readonly flow?: { readonly phase: number }
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
    // A sample of a closed shutter (extent 0) is the frame as it is: no extent, so no blur pass runs for it
    const mapped = samples.map((s) =>
      s.extent > 0 ? { index: s.sourceFrame, weight: s.weight, extent: s.extent } : { index: s.sourceFrame, weight: s.weight },
    )
    // A gap whose second frame is past the file's end leaves one sample: that frame, shown as it is.
    return plan.flowPhase !== undefined && mapped.length === 2
      ? { samples: mapped, flow: { phase: plan.flowPhase } }
      : { samples: mapped }
  }
  const { frame } = sources.position(item, clipFrame)
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError(`sourceFramePlan: the source frame must be a whole number >= 0, got ${frame}`)
  }
  return { samples: [{ index: frame, weight: 1 }] }
}

/**
 * The source frames a clip's output frame at timeline frame `frame` is made of, as the renderer draws it. Without motion
 * blur, one: the integer frame FreeCut's one mapping (`clipSourcePosition` inside the clip, the transition's pre-roll
 * and ramp, the clamp to the file) names; the read-back is exact: the mapping's time is `n · den / num` and
 * `secondsToFrame` rounds `t · num / den`. With blur on, the samples `planMotionBlur` weights over the span the frame
 * covers. A frame drawn through a transition (its own span differs from the clip's, or a source offset applies) keeps
 * the single frame: the blur's span is the clip's own (design 7.2 section 4.8).
 */
export function timelineFramePlan(
  item: VideoItem,
  frame: number,
  projectFps: number,
  renderSpan: RenderTimelineSpan | undefined,
  sourceFrameOffset: number,
): SourceFramePlan {
  const span = renderSpan ?? getItemRenderTimelineSpan(item)
  const rate = toRate(item.sourceFps ?? projectFps)
  const clipFrame = frame - item.from
  const ownSpan =
    sourceFrameOffset === 0 &&
    span.from === item.from &&
    span.durationInFrames === item.durationInFrames
  return sourceFramePlan(item, clipFrame, {
    sourceFrameCount: () => item.sourceDuration,
    position: () => ({
      frame: secondsToFrame(
        rate,
        resolveVideoRenderSourceTimeSeconds(item, span, frame, projectFps, sourceFrameOffset),
      ),
    }),
    motionBlurQuery: () =>
      item.motionBlur !== undefined &&
      ownSpan &&
      clipFrame >= 0 &&
      clipFrame < item.durationInFrames
        ? {
            clip: item,
            timelineFrame: clipFrame,
            projectRate: toRate(projectFps),
            shutterDegrees: item.motionBlur.shutterDegrees,
            smoothSlowMotion: item.motionBlur.smoothSlowMotion,
          }
        : undefined,
  })
}
