/**
 * What a clip's `motionBlur` field may hold, and which clips may carry it (design 7.2, sections
 * 4.7 and 4.8).
 *
 * The store's normaliser, the panel and the SDK all ask here, so a hand-edited project file, a
 * click and a script agree on the four shutter angles and on the clips the blur belongs to.
 */

import type { TimelineItem } from '@/types/timeline'
import type { MotionBlurSettings, ShutterDegrees, SmoothSlowMotion } from './types'

/** The shutter angles the panel's select offers, in the order it lists them. */
export const SHUTTER_DEGREES: readonly ShutterDegrees[] = [90, 180, 270, 360]

/** The angle a new switch starts at and an unknown stored value falls back to: the whole span. */
export const DEFAULT_SHUTTER_DEGREES: ShutterDegrees = 360

/** Whether a value is one of the four shutter angles. */
export function isShutterDegrees(value: unknown): value is ShutterDegrees {
  return SHUTTER_DEGREES.some((degrees) => degrees === value)
}

/** The ways smooth slow motion can make a frame, in the order the panel's select lists them after "Off". */
export const SMOOTH_SLOW_MOTION: readonly SmoothSlowMotion[] = ['blend', 'optical-flow']

/** Whether a value is one of the smooth slow motion modes. */
export function isSmoothSlowMotion(value: unknown): value is SmoothSlowMotion {
  return SMOOTH_SLOW_MOTION.some((mode) => mode === value)
}

/**
 * The stored smooth slow motion mode: a known `smoothSlowMotion`, else the field it replaced, `blendSlowMotion: true`
 * (projects saved on 19 Nov 2026, before the optical-flow mode), as `'blend'`, so an old project keeps its mode. The old
 * field is never written back.
 */
function storedSmoothSlowMotion(value: { smoothSlowMotion?: unknown; blendSlowMotion?: unknown }): SmoothSlowMotion | undefined {
  if (isSmoothSlowMotion(value.smoothSlowMotion)) return value.smoothSlowMotion
  return value.blendSlowMotion === true ? 'blend' : undefined
}

/**
 * A stored `motionBlur` value made safe for the renderer: an object with an unknown or missing
 * angle falls to 360 (design 7.2, section 4.7), an unknown smooth slow motion mode is none, anything
 * that is not an object is no blur. A hand-edited file can therefore never put a broken number in
 * front of a shader.
 */
function normalizeMotionBlur(value: unknown): MotionBlurSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const stored = value as { shutterDegrees?: unknown; smoothSlowMotion?: unknown; blendSlowMotion?: unknown }
  const smoothSlowMotion = storedSmoothSlowMotion(stored)
  return {
    shutterDegrees: isShutterDegrees(stored.shutterDegrees) ? stored.shutterDegrees : DEFAULT_SHUTTER_DEGREES,
    // Only a known mode turns smooth slow motion on; anything else is the hold, and is not written back.
    ...(smoothSlowMotion !== undefined ? { smoothSlowMotion } : {}),
  }
}

/**
 * Whether a clip can carry motion blur: a video clip that is not reversed and not a composition
 * wrapper (design 7.2, section 4.8). The panel hides the controls and the SDK answers
 * `UNSUPPORTED` for any other clip.
 */
export function canHoldMotionBlur(item: TimelineItem): boolean {
  return item.type === 'video' && item.isReversed !== true && item.compositionId === undefined
}

/**
 * A clip's motion blur made safe on every store write: an unknown angle falls to 360, and a
 * value that is not an object, or the undefined a switch-off leaves, is removed. It lives here
 * so the store's normaliser reads no clip field itself (`predicates.guard.test.ts`).
 */
export function normalizeMotionBlurField(item: TimelineItem): void {
  const carrier = item as { motionBlur?: unknown }
  if (!('motionBlur' in carrier)) return
  const normalized = normalizeMotionBlur(carrier.motionBlur)
  if (normalized === undefined) {
    delete carrier.motionBlur
  } else {
    carrier.motionBlur = normalized
  }
}
