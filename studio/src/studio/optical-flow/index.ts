/**
 * Optical flow (task 11.12, design `docs/designs/11.12-optical-flow-slow-motion.md`): the motion between two source
 * frames, measured on the GPU, and the frame between them at any phase. The stage pipeline uses it for the optical-flow
 * mode of smooth slow motion (`MotionBlurSettings.smoothSlowMotion`). Other modules import from `@/studio/optical-flow`
 * and never from the files beside this one.
 */

/** The flow of one frame size: `measure` a source gap, `interpolate` a frame inside it. */
export { createOpticalFlow, type GapFlow, type OpticalFlow } from './flow'

/** The measured gaps of one render, freed once passed (an export) or least recently used (a preview). */
export { FlowGapCache } from './cache'
