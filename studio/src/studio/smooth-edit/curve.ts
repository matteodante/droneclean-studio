/**
 * The speed curve of the "smooth edit" recipe (plan task 11.10): fast, slow, fast, with eased ramps.
 *
 * It is a shape, not an edit: `smoothEditCurve` answers the keys a clip of `durationInFrames` frames
 * would carry, as fractions of that length. The action hands them to `applySpeedCurve`, which keeps
 * the clip's source span and takes the length the shape needs, so the curve fits the clip's content
 * through the curve's own exact integral and not through a second formula kept here.
 *
 *     (0, peak) ~> (0.3 D, slow) -> (0.7 D, slow) ~> (D, peak)        ~> is the `smooth` ease
 *
 * The two ramps are eased; the hold between them is flat, so it needs no ease of its own.
 */

import { type SpeedCurve, type SpeedKey } from '@/studio/speed/curve'

/** What an option takes when the caller names none: 4x, 0.45x and a 20 % zoom-in. */
export const SMOOTH_EDIT_DEFAULTS = { peak: 4, slow: 0.45, zoom: 0.2 } as const

/** The fast speed's range, in x. A faster clip than the slow part by construction. */
export const SMOOTH_EDIT_PEAK_RANGE = { min: 1, max: 10 } as const

/** The slow speed's range, in x: from the schema's slowest speed to normal speed. */
export const SMOOTH_EDIT_SLOW_RANGE = { min: 0.1, max: 1 } as const

/** The zoom's range as a fraction of the picture: 0 leaves the zoom alone, 1 doubles the size. */
export const SMOOTH_EDIT_ZOOM_RANGE = { min: 0, max: 1 } as const

/** The shortest clip the recipe is cut for: four frames hold the four keys. */
export const SMOOTH_EDIT_MIN_FRAMES = 4

/** Where the slow part starts and ends, as shares of the clip's length. */
const SLOW_START_SHARE = 0.3
const SLOW_END_SHARE = 0.7

/** A speed to the hundredth, the precision every speed control commits. */
function toHundredth(speed: number): number {
  return Math.round(speed * 100) / 100
}

/**
 * The curve of the recipe for a clip `durationInFrames` long: four keys, whole frames, the first at 0
 * and the last at the length, the two ramps `smooth`.
 *
 * @throws RangeError when the clip is shorter than {@link SMOOTH_EDIT_MIN_FRAMES} frames.
 */
export function smoothEditCurve(durationInFrames: number, peak: number, slow: number): SpeedCurve {
  const duration = Math.round(durationInFrames)
  if (!Number.isFinite(durationInFrames) || duration < SMOOTH_EDIT_MIN_FRAMES) {
    throw new RangeError(
      `smoothEditCurve: durationInFrames must be at least ${SMOOTH_EDIT_MIN_FRAMES}, got ${durationInFrames}`,
    )
  }
  const slowStart = Math.max(1, Math.round(duration * SLOW_START_SHARE))
  const slowEnd = Math.min(duration - 1, Math.max(slowStart + 1, Math.round(duration * SLOW_END_SHARE)))
  const keys: SpeedKey[] = [
    { frame: 0, speed: toHundredth(peak), ease: 'smooth' },
    { frame: slowStart, speed: toHundredth(slow) },
    { frame: slowEnd, speed: toHundredth(slow), ease: 'smooth' },
    { frame: duration, speed: toHundredth(peak) },
  ]
  return { keys }
}
