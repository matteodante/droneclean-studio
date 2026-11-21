/**
 * The "smooth edit" recipe on one clip (plan task 11.10): the reference look of the drone reels in one
 * action. A speed curve fast-slow-fast with eased ramps, smooth slow motion and motion blur on, and an
 * eased zoom-in over the clip's new length, all in one undo step.
 *
 * The panel's button and the SDK's `clips.applySmoothEdit` both call `smoothEditClip`, so a click and a
 * script give the same clip. Inside, the steps are the ones the separate controls run, in their
 * no-history forms (`applySpeedCurve`, the item's own `motionBlur` field, the keyframe store), under one
 * `execute`: the speed step moves the clips after this one by the speed slider's rule (only past the
 * next clip's start), and the zoom keyframes are written after it, so they span the length the clip
 * has once the curve is in.
 *
 * The zoom is the clip's width and height, from their resolved size to `1 + zoom` times it, centred
 * (the clip's x and y are untouched): that is how a pilot zooms a clip in this editor, and it needs
 * no lane the keyframe panel cannot show. Earlier width, height and scale keyframes of the clip are
 * replaced.
 */

import type { KeyframeAddPayload } from '@/features/timeline/stores/keyframes-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { execute, canAddKeyframeAtFrame } from '@/features/timeline/stores/actions/shared'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { getSourceDimensions, resolveTransform } from '@/runtime/composition-runtime/utils/transform-resolver'
import type { TimelineItem } from '@/types/timeline'
import { canHoldMotionBlur, DEFAULT_SHUTTER_DEGREES } from '@/studio/motion-blur/settings'
import type { MotionBlurSettings } from '@/studio/motion-blur/types'
import { applySpeedCurve, canHoldSpeedCurve } from '@/studio/speed/actions'
import { averageSpeed, type SpeedKey } from '@/studio/speed/curve'
import { normalizeSpeedCurve } from '@/studio/speed/normalize'
import { toRate } from '@/studio/time'
import { SMOOTH_EDIT_DEFAULTS, SMOOTH_EDIT_MIN_FRAMES, smoothEditCurve } from './curve'

/** What the recipe takes; every field is optional and defaults to {@link SMOOTH_EDIT_DEFAULTS}. */
export interface SmoothEditInput {
  /** The fast speed at both ends, in x. */
  peak?: number
  /** The slow speed in the middle, in x. */
  slow?: number
  /** The zoom-in over the clip as a fraction: 0.2 ends 20 % larger than it starts; 0 leaves the zoom alone. */
  zoom?: number
}

/** What the recipe set on the clip. */
export interface SmoothEditOutcome {
  /** The speed curve's keys as stored, clip-relative. */
  keys: SpeedKey[]
  /** The curve's average speed, which is the clip's `speed`. */
  averageSpeed: number
  /** The clip's length after the curve, in frames. */
  durationInFrames: number
  /** The motion blur the clip now has: its own angle (360 when it had none) and smooth slow motion by optical flow. */
  motionBlur: MotionBlurSettings
  /**
   * The zoom keyframes: the clip-relative frames they sit on and the scale they reach, or null when
   * no zoom was asked for (`zoom` 0) or the clip's first or last frame is inside a transition
   * (`zoomBlocked`), where a keyframe cannot sit.
   */
  zoom: { firstFrame: number; lastFrame: number; scale: number } | null
  /** Whether a zoom was asked for but a transition region blocked it. */
  zoomBlocked: boolean
}

/** Whether the recipe applies to a clip: a video clip that holds a curve and blur and has room for the keys. */
export function canHoldSmoothEdit(item: TimelineItem): boolean {
  return (
    canHoldSpeedCurve(item) &&
    canHoldMotionBlur(item) &&
    Math.round(item.durationInFrames) >= SMOOTH_EDIT_MIN_FRAMES
  )
}

/**
 * The length, in frames, the recipe leaves a clip with: what `applySpeedCurve` computes for a clip of
 * `startFrames` frames that plays `sourceSpanFrames` source frames. Answered without touching a store, so
 * the smooth edit of a whole timeline can pick the footage that ends a shot on its beat; a test holds it
 * equal to the real action.
 */
export function smoothEditLength(
  startFrames: number,
  sourceSpanFrames: number,
  sourceFps: number,
  projectFps: number,
  options: SmoothEditInput = {},
): number {
  const peak = options.peak ?? SMOOTH_EDIT_DEFAULTS.peak
  const slow = options.slow ?? SMOOTH_EDIT_DEFAULTS.slow
  const shape = normalizeSpeedCurve(smoothEditCurve(startFrames, peak, slow), startFrames)
  if (shape === undefined) return Math.round(startFrames)
  const source = toRate(sourceFps)
  const project = toRate(projectFps)
  return Math.max(
    1,
    Math.round(
      (sourceSpanFrames * source.den * project.num) / (averageSpeed(shape) * source.num * project.den),
    ),
  )
}

/** A size to the hundredth of a pixel, so a keyframe reads back as written. */
function toHundredth(value: number): number {
  return Math.round(value * 100) / 100
}

/** The clip's resolved width and height on the project's canvas, from the transform and the picture's own size. */
function resolvedSize(item: TimelineItem): { width: number; height: number } {
  const metadata = useProjectStore.getState().currentProject?.metadata
  const fps = useTimelineSettingsStore.getState().fps
  const canvas = { width: metadata?.width ?? 1920, height: metadata?.height ?? 1080, fps }
  const { width, height } = resolveTransform(item, canvas, getSourceDimensions(item))
  return { width, height }
}

/** The zoom's four keyframes (width and height, first and last frame), eased in and out. */
function zoomPayloads(item: TimelineItem, lastFrame: number, scale: number): KeyframeAddPayload[] {
  const { width, height } = resolvedSize(item)
  const lanes = [
    ['width', width],
    ['height', height],
  ] as const
  return lanes.flatMap(([property, value]) => [
    { itemId: item.id, property, frame: 0, value: toHundredth(value), easing: 'ease-in-out' as const },
    { itemId: item.id, property, frame: lastFrame, value: toHundredth(value * scale), easing: 'linear' as const },
  ])
}

/**
 * Switch the clip's blur on with smooth slow motion by optical flow, keeping the shutter angle it had (the default 180
 * when it had none). The recipe is the reference look: its slow part is made by optical flow whatever mode the clip had (design
 * 11.24: frame blending's double image is what Matteo did not want), and the select changes it afterwards.
 */
function turnOnBlur(before: TimelineItem): MotionBlurSettings {
  const motionBlur: MotionBlurSettings = {
    shutterDegrees:
      before.type === 'video'
        ? (before.motionBlur?.shutterDegrees ?? DEFAULT_SHUTTER_DEGREES)
        : DEFAULT_SHUTTER_DEGREES,
    smoothSlowMotion: 'optical-flow',
  }
  useItemsStore.getState()._updateItem(before.id, { motionBlur: { ...motionBlur } })
  return motionBlur
}

/**
 * Write the zoom keyframes over the clip as it is now, replacing the width, height and scale lanes it had.
 * Nothing is written for a zoom of 0 or a clip of one frame, nor when a transition covers the first or last frame.
 */
function writeZoom(
  item: TimelineItem,
  zoom: number,
): { zoom: SmoothEditOutcome['zoom']; blocked: boolean } {
  const lastFrame = item.durationInFrames - 1
  if (zoom <= 0 || lastFrame < 1) return { zoom: null, blocked: false }
  if (!canAddKeyframeAtFrame(item.id, 0) || !canAddKeyframeAtFrame(item.id, lastFrame)) {
    return { zoom: null, blocked: true }
  }
  const keyframes = useKeyframesStore.getState()
  keyframes._removeKeyframesForProperty(item.id, 'width')
  keyframes._removeKeyframesForProperty(item.id, 'height')
  keyframes._removeVectorKeyframesForProperty(item.id, 'scale')
  keyframes._addKeyframes(zoomPayloads(item, lastFrame, 1 + zoom))
  useTimelineSettingsStore.getState().markDirty()
  return { zoom: { firstFrame: 0, lastFrame, scale: 1 + zoom }, blocked: false }
}

/**
 * Give a clip the recipe, as one undo step. Returns what was set, or undefined when the clip cannot
 * take it (callers check {@link canHoldSmoothEdit} first and answer with their own error).
 */
export function smoothEditClip(itemId: string, options: SmoothEditInput = {}): SmoothEditOutcome | undefined {
  const start = useItemsStore.getState().itemById[itemId]
  if (start === undefined || !canHoldSmoothEdit(start)) return undefined
  const peak = options.peak ?? SMOOTH_EDIT_DEFAULTS.peak
  const slow = options.slow ?? SMOOTH_EDIT_DEFAULTS.slow
  const zoom = options.zoom ?? SMOOTH_EDIT_DEFAULTS.zoom

  return execute(
    'SMOOTH_EDIT',
    () => {
      applySpeedCurve(itemId, smoothEditCurve(start.durationInFrames, peak, slow))
      const stretched = useItemsStore.getState().itemById[itemId]
      const curve = stretched?.speedCurve
      if (stretched === undefined || curve === undefined) return undefined

      const motionBlur = turnOnBlur(start)
      const { zoom: zoomResult, blocked } = writeZoom(stretched, zoom)
      return {
        keys: curve.keys.map((key) => ({ ...key })),
        averageSpeed: averageSpeed(curve),
        durationInFrames: stretched.durationInFrames,
        motionBlur,
        zoom: zoomResult,
        zoomBlocked: blocked,
      }
    },
    { id: itemId, peak, slow, zoom },
  )
}
