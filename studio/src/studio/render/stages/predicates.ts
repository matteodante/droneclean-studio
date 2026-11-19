// The two questions every part of the app asks about a clip, answered once (design 3.6 section 2.3).
//
//   needsSourceStages(item)      does any stage change this clip's pixels?
//   needsExactSourceFrame(item)  must this clip be drawn from the exact decoded source frame: no DOM `<video>`, no
//                                packet copy? True for a stage keyed by integer source frames (stabilization, a
//                                blur that blends frames), a speed curve, cleaned shadow pieces or a reversed clip.
//                                Not for an input colour transform or a look: they act on whatever frame is drawn.
//
// A clip that needs stages but not the exact frame (input colour, a look) is drawn in the preview from FreeCut's
// own fast source, fed into its stages; an export draws every staged clip from the exact frame (design 3.6, task
// 8.2's measurement).
//
// This file is the only place that reads a clip's `stabilization`, `inputColor`, `look` and `motionBlur` fields.
// FreeCut's files import the two functions; `predicates.guard.test.ts` fails on a direct read there.

import { isFeatureShown } from '@/studio/feature-switches'
import { rawTestKitActive } from '@/studio/render/frames/backends/raw-test'
import { nativeExportActive } from '@/studio/render/precise/native-session'
import { toRate, type Rate } from '@/studio/time'
import type { TimelineItem, VideoItem } from '@/types/timeline'

/** The two rates the number of source frames per output frame depends on (a 120 fps clip in a 60 fps project). */
export interface PlaybackRates {
  readonly source: Rate
  readonly project: Rate
}

/**
 * The project's rate, which the playback rates default to: the call sites ask about a clip alone, and a clip's source
 * rate against the project's decides how many source frames an output frame covers. Set by the renderer on creation and
 * by the page's session as the timeline's rate changes; until it is set, the rates are taken as equal.
 */
let projectRate: Rate | undefined

/** Tells the predicates the project's rate (a number or an exact rate); `undefined` forgets it. */
export function setProjectRate(fps: number | Rate | undefined): void {
  projectRate = fps === undefined ? undefined : toRate(fps)
}

/** The rates of a clip: the ones given, or its source rate against the project's, when both are known. */
function ratesOf(item: VideoItem, given: PlaybackRates | undefined): PlaybackRates | undefined {
  if (given !== undefined) return given
  if (projectRate === undefined || item.sourceFps === undefined) return undefined
  return { source: toRate(item.sourceFps), project: projectRate }
}

function videoOf(item: TimelineItem): VideoItem | undefined {
  return item.type === 'video' ? item : undefined
}

/** Whether the clip's stabilization switch is on, whatever the engine's state is. */
export function isStabilized(item: TimelineItem): boolean {
  return videoOf(item)?.stabilization?.enabled === true
}

/** Whether the clip asks for an input colour transform: a profile other than none. */
export function hasInputColour(item: TimelineItem): boolean {
  const profile = videoOf(item)?.inputColor
  return profile !== undefined && profile !== 'none'
}

/** Whether the clip carries a look that is drawn: set, with an intensity above 0, while the looks switch is on. */
export function hasLook(item: TimelineItem): boolean {
  const look = videoOf(item)?.look
  return look !== undefined && look.intensity > 0 && isFeatureShown('looks')
}

/** Whether the clip has motion blur switched on, at any speed, while the motion blur switch is on. */
export function hasMotionBlur(item: TimelineItem): boolean {
  return videoOf(item)?.motionBlur !== undefined && isFeatureShown('motionBlur')
}

/** The fastest source frames-per-output-frame ratio of the clip's speed: its constant speed, or its curve's peak. */
function peakSpeed(video: VideoItem): number {
  const curve = video.speedCurve
  if (curve !== undefined) return Math.max(...curve.keys.map((key) => key.speed))
  return video.speed ?? 1
}

/** The slowest one: its constant speed, or its curve's lowest key. */
function lowestSpeed(video: VideoItem): number {
  const curve = video.speedCurve
  if (curve !== undefined) return Math.min(...curve.keys.map((key) => key.speed))
  return video.speed ?? 1
}

/**
 * Whether motion blur can blend more than one source frame for this clip: it is on, and one output frame can cover
 * more than one source frame, or less than one with the slow-motion blend on. Every shutter angle is the identity at and below 1x with equal rates (design 7.2
 * section 4.1), so a blurred clip at normal speed needs no stage. Without `rates` the clip's source rate and the project's
 * (`setProjectRate`) are used, or taken as equal while the project's is unknown; with them, a faster source than project counts like a faster clip.
 */
export function hasMotionBlurSpan(item: TimelineItem, rates?: PlaybackRates): boolean {
  const video = videoOf(item)
  if (video === undefined || !hasMotionBlur(item)) return false
  const known = ratesOf(video, rates)
  const rateRatio =
    known === undefined
      ? 1
      : (known.source.num * known.project.den) / (known.source.den * known.project.num)
  if (peakSpeed(video) * rateRatio > 1) return true
  // A slow-motion blend mixes two source frames wherever an output frame covers less than one (19 Nov 2026).
  return video.motionBlur?.blendSlowMotion === true && lowestSpeed(video) * rateRatio < 1
}

/**
 * Whether every video clip is drawn through the stages, staged or not: during a precise export, whose frames must come
 * from the provider's exact 10-bit source (a native export, `precise/native-session.ts`), and while the golden kit's raw
 * 10-bit backend is on. FreeCut's own decoder would hand a plain clip over as 8 bits.
 */
function preciseExportActive(): boolean {
  return nativeExportActive() || rawTestKitActive()
}

/** Whether any stage changes this clip's pixels: stabilization, input colour, a look, or a blur that blends frames. */
export function needsSourceStages(item: TimelineItem, rates?: PlaybackRates): boolean {
  return (
    (videoOf(item) !== undefined && preciseExportActive()) ||
    isStabilized(item) || hasInputColour(item) || hasLook(item) || hasMotionBlurSpan(item, rates)
  )
}

/**
 * Whether this clip must be drawn from the exact decoded source frame, never from a DOM `<video>` that plays at a
 * constant rate: a stage keyed by integer source frames (the stabilization's warp, a blur that blends frames: S1), a
 * speed curve, cleaned shadow pieces, or a reversed clip. An input colour transform or a look acts on the frame it is
 * given, so on its own it needs no exact frame (a copy of the file's packets is refused for it by `needsSourceStages`).
 */
export function needsExactSourceFrame(item: TimelineItem, rates?: PlaybackRates): boolean {
  const video = videoOf(item)
  if (video === undefined) return false
  return (
    isStabilized(item) ||
    hasMotionBlurSpan(item, rates) ||
    video.speedCurve !== undefined ||
    (video.shadowRemoval?.pieces.length ?? 0) > 0 ||
    video.isReversed === true
  )
}

/**
 * Whether a staged clip's stages must start from the exact source frame, so it is never drawn from a DOM `<video>`
 * (S1): a clip that has stages and needs the exact frame. A clip with only per-pixel stages may take the `<video>` in
 * a preview, fed into its stages.
 */
export function needsExactStagedFrame(item: TimelineItem, rates?: PlaybackRates): boolean {
  return needsSourceStages(item, rates) && needsExactSourceFrame(item, rates)
}
