// The two questions every part of the app asks about a clip, answered once (design 3.6 section 2.3).
//
//   needsSourceStages(item)      does any stage change this clip's pixels?
//   needsExactSourceFrame(item)  must this clip be drawn from the exact decoded source frame: no DOM `<video>`, no
//                                packet copy? True for a stage keyed by integer source frames (stabilization, the
//                                motion blur, which reads the neighbour frames), a speed curve, cleaned shadow pieces or
//                                a reversed clip.
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
import type { TimelineItem, VideoItem } from '@/types/timeline'

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

/**
 * What the per-source-frame stages of a clip read, as one string (design 9.2, section 5.4): its stabilization (the
 * framing at the frame being drawn included), its input colour and its cleaned shadow pieces. Two staged frames of the
 * same media and index are the same picture when these agree, so the motion blur keys the flows it measures on staged
 * frames, and the staged neighbour it keeps, with it.
 */
export function sourceStageFingerprint(item: TimelineItem): string {
  const video = videoOf(item)
  if (video === undefined) return ''
  return JSON.stringify([video.stabilization ?? null, video.inputColor ?? null, video.shadowRemoval?.pieces ?? null])
}

/**
 * Whether every video clip is drawn through the stages, staged or not: during a precise export, whose frames must come
 * from the provider's exact 10-bit source (a native export, `precise/native-session.ts`), and while the golden kit's raw
 * 10-bit backend is on. FreeCut's own decoder would hand a plain clip over as 8 bits.
 */
function preciseExportActive(): boolean {
  return nativeExportActive() || rawTestKitActive()
}

/** Whether any stage changes this clip's pixels: stabilization, input colour, a look, or the motion blur. */
export function needsSourceStages(item: TimelineItem): boolean {
  return (
    (videoOf(item) !== undefined && preciseExportActive()) ||
    isStabilized(item) || hasInputColour(item) || hasLook(item) || hasMotionBlur(item)
  )
}

/**
 * Whether this clip must be drawn from the exact decoded source frame, never from a DOM `<video>` that plays at a
 * constant rate: a stage keyed by integer source frames (the stabilization's warp, the motion blur, which measures the
 * motion to the neighbour frames: S1), a speed curve, cleaned shadow pieces, or a reversed clip. An input colour
 * transform or a look acts on the frame it is given, so on its own it needs no exact frame (a copy of the file's
 * packets is refused for it by `needsSourceStages`).
 */
export function needsExactSourceFrame(item: TimelineItem): boolean {
  const video = videoOf(item)
  if (video === undefined) return false
  return (
    isStabilized(item) ||
    hasMotionBlur(item) ||
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
export function needsExactStagedFrame(item: TimelineItem): boolean {
  return needsSourceStages(item) && needsExactSourceFrame(item)
}
