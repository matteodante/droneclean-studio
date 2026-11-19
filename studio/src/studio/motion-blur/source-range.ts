/**
 * Keeps a blend inside the file (design 7.2, section 4.1 and the finding of wave 14): the last output frame of a clip
 * played at 4x covers source frames 1196..1199 of a 1,199 frame file, and frame 1199 does not exist. A shutter window
 * that reaches past the file's first or last frame measures only what the file holds, so the samples outside
 * `[0, frameCount)` are dropped and the rest are renormalised to sum 1; a plan with none left shows the nearest frame
 * that exists, at weight 1. The same holds at the start of a reversed clip, whose samples run below 0.
 */

import type { MotionBlurSample } from './weights'

/**
 * The samples inside the file's frames `[0, frameCount)`, their weights scaled to sum 1.
 *
 * Samples that are all inside come back as they are (the same array, so the common case allocates nothing); an
 * empty remainder gives the file's nearest frame (0 when the samples lie below it, `frameCount - 1` above) at
 * weight 1.
 *
 * @throws RangeError when `frameCount` is not a whole number >= 1 or `samples` is empty.
 */
export function restrictToSourceRange(
  samples: readonly MotionBlurSample[],
  frameCount: number,
): readonly MotionBlurSample[] {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
    throw new RangeError(`restrictToSourceRange: frameCount must be a whole number >= 1, got ${frameCount}`)
  }
  if (samples.length === 0) throw new RangeError('restrictToSourceRange: a plan has no sample')
  const inside = samples.filter((s) => s.sourceFrame >= 0 && s.sourceFrame < frameCount)
  if (inside.length === samples.length) return samples
  if (inside.length === 0) {
    const nearest = samples[0]!.sourceFrame < 0 ? 0 : frameCount - 1
    return [{ sourceFrame: nearest, weight: 1 }]
  }
  const sum = inside.reduce((total, s) => total + s.weight, 0)
  return inside.map((s) => ({ sourceFrame: s.sourceFrame, weight: s.weight / sum }))
}
