/**
 * Motion blur (design 7.2, design 9.2): which source frames an output frame is made of, their weights and the shutter
 * time each stands for, as pure maths — no GPU, no panel, no field on a clip. The vector blur that draws them is
 * `motion-blur/vector-stage.ts`, which the stage pipeline drives.
 *
 * Other modules import from `@/studio/motion-blur` and never from the files beside this one.
 * The export stage (slice B) and the preview (slice D) plan every output frame with
 * `planMotionBlur` and draw or add its samples with their weights; the item's field, the panel
 * and the SDK (slice C) carry `MotionBlurSettings`. `motionBlurFrameCount` is the decode count
 * of design 7.2 section 4.4.
 */

/** A clip's motion blur: its shutter in degrees (design 9.2), and its smooth slow motion. */
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

/**
 * The checks of a shutter, of a smooth slow motion mode and of the optical flow's two settings, the clip rule and the
 * store's clamp (design 7.2, 4.7 and 4.8; design 9.2, 7; design 11.24).
 */
export {
  canHoldMotionBlur,
  flowSettingsOf,
  isFlowDetail,
  isFlowEdges,
  isShutterDegrees,
  isSmoothSlowMotion,
  normalizeMotionBlurField,
} from './settings'

/** Drops the samples outside the file's frames and renormalises the rest (the last output frame at 4x). */
export { restrictToSourceRange } from './source-range'
