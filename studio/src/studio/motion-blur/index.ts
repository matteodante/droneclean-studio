/**
 * Motion blur (design 7.2): the causal shutter window that blends the source frames each
 * output frame covers, as pure maths — no GPU, no panel, no field on a clip.
 *
 * Other modules import from `@/studio/motion-blur` and never from the files beside this one.
 * The export stage (slice B) and the preview (slice D) plan every output frame with
 * `planMotionBlur` and draw or add its samples with their weights; the item's field, the panel
 * and the SDK (slice C) carry `MotionBlurSettings`. `motionBlurFrameCount` is the decode count
 * of design 7.2 section 4.4.
 */

/** A clip's motion blur: the shutter angle of its causal blend window (design 7.2, 4.7), and its smooth slow motion. */
export type { MotionBlurSettings, ShutterDegrees, SmoothSlowMotion } from './types'

/** One source frame of a blend: its index and its share of the window. */
export type { MotionBlurSample } from './weights'

/** The blend of one output frame: its source span, its decode count, and its samples. */
export type { MotionBlurPlan } from './weights'

/** One question to the plan: the clip, its output frame, the cut's remainder, the shutter. */
export type { MotionBlurQuery } from './weights'

/** How many source frames an output frame covers: `ceil(endFrame) - floor(startFrame)`. */
export { motionBlurFrameCount } from './weights'

/** The weighted source frames output frame `n` is blended from (design 7.2, section 4.1). */
export { planMotionBlur } from './weights'

/** The four shutter angles, the checks of an angle and of a smooth slow motion mode, the clip rule and the store's clamp (design 7.2, 4.7 and 4.8). */
export {
  SHUTTER_DEGREES,
  canHoldMotionBlur,
  isShutterDegrees,
  isSmoothSlowMotion,
  normalizeMotionBlurField,
} from './settings'

/** Drops the samples outside the file's frames and renormalises the rest (the last output frame at 4x). */
export { restrictToSourceRange } from './source-range'
