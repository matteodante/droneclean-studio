/**
 * A clip's motion blur settings (design 7.2, section 4.7): the shutter angle of the causal
 * window the blend uses, in degrees.
 *
 * The field itself lives on the video item (`src/types/timeline.ts`, slice C); this module
 * only names its shape, so the maths, the store's normaliser, the panel and the SDK all agree
 * on the four angles. Absent on a clip means off, and every angle is the identity at and below
 * 1x (design 7.2, section 4.1), so the setting never changes a clip that is not sped up.
 */

/** The shutter angles a clip's motion blur can take, in degrees (design 7.2, section 4.7). */
export type ShutterDegrees = 90 | 180 | 270 | 360

/**
 * One clip's motion blur: a causal shutter window over the source frames each output frame
 * covers. 360 blends the whole span, 180 its first half, 90 a quarter of it (design 7.2,
 * section 4.1).
 */
export interface MotionBlurSettings {
  /**
   * The shutter angle in degrees. The panel's select offers these four, and the store's
   * normaliser falls an unknown value back to 360 (design 7.2, section 4.7); the maths throws
   * instead, because a value that reaches it broken is a caller's bug.
   */
  shutterDegrees: ShutterDegrees
  /**
   * Smooth slow motion (19 Nov 2026): where an output frame covers less than one source frame (a clip slower than 1x,
   * or a 30 fps file in a 60 fps project), blend the two source frames around its position, weighted by how far it is
   * between them, instead of showing the same frame twice. Absent or false: the frame is held, as before.
   */
  blendSlowMotion?: boolean
}
