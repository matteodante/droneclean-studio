/**
 * A clip's motion blur settings (design 7.2, section 4.7; design 9.2): how long the shutter stays open, in degrees of
 * the frame interval, and the smooth slow motion.
 *
 * The field itself lives on the video item (`src/types/timeline.ts`); this module only names its shape, so the maths,
 * the store's normaliser, the panel and the SDK agree. Absent on a clip means off.
 */

/**
 * The shutter, in degrees of the interval between two output frames: any number in (0, 360]. 180 is RSMB's Blur
 * Amount 0.5 (the panel's slider shows the amount, degrees / 360); 360 blurs over the whole interval.
 */
export type ShutterDegrees = number

/**
 * One clip's motion blur (design 9.2): every pixel blurred along its own motion, measured by optical flow between the
 * stabilized source frames, over the shutter, centred on the frame's time. Above 1x every source frame the shutter
 * covers is blurred over its own share of it before they are averaged.
 */
export interface MotionBlurSettings {
  /**
   * The shutter in degrees, in (0, 360]. The store's normaliser falls an unknown or out-of-range value back to 180
   * (design 9.2, section 0); the maths throws instead, because a value that reaches it broken is a caller's bug.
   */
  shutterDegrees: ShutterDegrees
  /**
   * Smooth slow motion: where an output frame covers less than one source frame (a clip slower than 1x, or a 30 fps
   * file in a 60 fps project), make the frame from the two source frames around its position instead of showing the
   * same frame twice. `'blend'` (19 Nov 2026) mixes them, weighted by how far the frame is between them;
   * `'optical-flow'` (task 11.12) moves each one's content along the motion measured between them to where it is at
   * that moment, and mixes them only where the motion cannot be trusted. Absent: the frame is held, as before.
   */
  smoothSlowMotion?: SmoothSlowMotion
  /**
   * With smooth slow motion by optical flow, the panel's "Motion detail" (design 11.24): `'high'` measures the motion at
   * twice the size (half of a 4K frame instead of a quarter, a 1080p frame's own size instead of half), which follows
   * small and thin moving things a little more closely (+0.10 dB on clip 0020 at 4K) for about three times the flow's
   * time. Absent: `'normal'`. Kept only with `smoothSlowMotion: 'optical-flow'`, and only when not the default.
   */
  flowDetail?: FlowDetail
  /**
   * With smooth slow motion by optical flow, the panel's "Hard edges" (design 11.24): where neither source frame is
   * trusted (a branch near the lens, something entering at the border), `'nearest'` takes the frame more likely to show
   * it (no soft halo, a small local jump) instead of mixing the two. Absent: `'mix'`. Kept only with
   * `smoothSlowMotion: 'optical-flow'`, and only when not the default.
   */
  flowEdges?: FlowEdges
}

/** How smooth slow motion makes a frame between two source frames (`MotionBlurSettings.smoothSlowMotion`). */
export type SmoothSlowMotion = 'blend' | 'optical-flow'

/** How finely optical flow follows the motion (`MotionBlurSettings.flowDetail`). */
export type FlowDetail = 'normal' | 'high'

/** What optical flow shows where it cannot follow the motion (`MotionBlurSettings.flowEdges`). */
export type FlowEdges = 'mix' | 'nearest'
