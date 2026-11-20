// Keyframes on the stabilized window's framing (task 11.23). `framingX` and `framingY` are two animatable properties of a
// stabilized clip, kept in the editor's keyframe store like every other (`features/keyframes`); the clip's stored
// `framingX`/`framingY` (`settings.ts`) are the value where a property has no keyframe, so a project from before the
// keyframes reads as it did.
//
// Where it is evaluated: once per output frame, before the pipeline. The stabilize stage is asked for a source frame and
// knows no timeline time, and the engine's key leaves the framing out (a framing change opens no engine), so the frame
// being drawn hands the pipeline a copy of the clip whose settings carry the framing of that frame
// (`render/stages/draw.ts`). The preview and the export both go through there, and `applyFraming` (`reframe.ts`) still
// holds the animated value to the room the stabilization has at each source frame. The choice against the other way
// (a new argument through the stage contract, the pipeline and its cache) is that nothing in the pipeline changes: it
// sees a clip with a framing, as it did with the slider.
//
// A clip frame outside the lane's first and last keyframe holds the nearest one, the editor's rule for every property
// (`interpolatePropertyValue`). A curve easing that overshoots (a spring) is held to the -1..1 range.

import { interpolatePropertyValue, getPropertyKeyframes } from '@/features/keyframes/utils/interpolation'
import type { ItemKeyframes } from '@/types/keyframe'
import type { VideoItem } from '@/types/timeline'
import { FRAMING_RANGE } from './settings'

/** The two properties, as the keyframe store names them */
const FRAMING_PROPERTIES = ['framingX', 'framingY'] as const

/** One of them */
export type FramingProperty = (typeof FRAMING_PROPERTIES)[number]

/** Whether the clip has a keyframe on either framing property */
export function hasFramingKeyframes(itemKeyframes: ItemKeyframes | undefined): boolean {
  return FRAMING_PROPERTIES.some((property) => getPropertyKeyframes(itemKeyframes, property).length > 0)
}

function held(value: number): number {
  return Math.min(FRAMING_RANGE.max, Math.max(FRAMING_RANGE.min, value))
}

/** One axis of the framing at clip frame `clipFrame`: the lane's value, or the stored setting where the lane has no keyframe */
export function framingValueAt(
  settings: { framingX?: number; framingY?: number },
  itemKeyframes: ItemKeyframes | undefined,
  clipFrame: number,
  property: FramingProperty,
): number {
  const stored = settings[property] ?? 0
  const keyframes = getPropertyKeyframes(itemKeyframes, property)
  return keyframes.length === 0 ? stored : held(interpolatePropertyValue(keyframes, clipFrame, stored))
}

/**
 * The clip as the frame `clipFrame` (relative to the clip's start) draws it: the same object when the clip is not
 * stabilized or has no framing keyframe (nothing changes, not a byte), otherwise a copy whose `stabilization` has the
 * framing of that frame, each of the two from its own lane or, with no keyframe on it, from the stored setting.
 */
export function withAnimatedFraming(
  item: VideoItem,
  itemKeyframes: ItemKeyframes | undefined,
  clipFrame: number,
): VideoItem {
  const settings = item.stabilization
  if (!settings || !hasFramingKeyframes(itemKeyframes)) return item
  const framing = { ...settings }
  for (const property of FRAMING_PROPERTIES) {
    if (getPropertyKeyframes(itemKeyframes, property).length > 0) {
      framing[property] = framingValueAt(settings, itemKeyframes, clipFrame, property)
    }
  }
  return { ...item, stabilization: framing }
}
