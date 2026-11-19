/**
 * The three speed-ramp presets, as pure functions of a clip's length (design 7.1, section 4.8).
 *
 * A preset is a shape, not an edit: `speedPresetCurve` answers the keys a clip of
 * `durationInFrames` frames would carry, and the caller hands them to `setSpeedCurve` (the panel) or
 * `clips.setSpeedPreset` (an agent), which keep the clip's source span and take the length the shape
 * needs. Because both callers build the curve here, a button in the panel and a script produce the
 * same keys for the same clip (design 7.1, sections 4.8 and 4.9).
 *
 * Each preset is the design's list:
 *
 *     ramp-in      (0, 1) -> (r, peak) -> (D, peak)
 *     ramp-out     (0, peak) -> (D - r, peak) -> (D, 1)
 *     ramp-in-out  (0, 1) -> (r, peak) -> (D - r, peak) -> (D, 1)
 *
 * with `peak` in `0.1..10` (the schema's speed range) and `r` the ramp's length in frames. Inputs are
 * clamped into the clip rather than thrown on: a ramp longer than the clip reaches its peak at the
 * clip's end, and an in-out ramp longer than half the clip has no hold left, so its two ramp keys meet
 * (or are sorted back into the symmetric shape when they cross). The result always satisfies
 * `validateSpeedCurve` and is pinned to frames 0 and `durationInFrames`, ready to store.
 */

import {
  MAX_CURVE_SPEED,
  MIN_CURVE_SPEED,
  type SpeedCurve,
  type SpeedKey,
} from './curve'
import { normalizeSpeedCurve } from './normalize'

/** The peak speed a preset ramps to when the caller names none: 4x (design 7.1, section 4.8). */
const DEFAULT_PRESET_PEAK = 4

/** The ramp's length when the caller names none: 15 frames, a quarter second at 60 (section 4.8). */
const DEFAULT_PRESET_RAMP_FRAMES = 15

/** The presets the panel's buttons and `clips.setSpeedPreset` accept (design 7.1, section 4.9). */
export const SPEED_PRESET_NAMES = ['ramp-in', 'ramp-out', 'ramp-in-out'] as const

/** One of the three ramp shapes (design 7.1, section 4.8). */
export type SpeedPresetName = (typeof SPEED_PRESET_NAMES)[number]

/** `peak` clamped into the schema's speed range and `rampFrames` into the clip's own length. */
function presetInputs(durationInFrames: number, peak: number, rampFrames: number): {
  duration: number
  peak: number
  rampFrames: number
} {
  if (!Number.isFinite(durationInFrames) || durationInFrames < 1) {
    throw new RangeError(
      `speedPresetCurve: durationInFrames must be a finite number >= 1, got ${durationInFrames}`,
    )
  }
  const duration = Math.round(durationInFrames)
  const clampedPeak = Number.isFinite(peak)
    ? Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, peak))
    : DEFAULT_PRESET_PEAK
  const ramp = Number.isFinite(rampFrames) ? Math.round(rampFrames) : DEFAULT_PRESET_RAMP_FRAMES
  return {
    duration,
    peak: clampedPeak,
    rampFrames: Math.min(Math.max(1, ramp), duration),
  }
}

/**
 * The keys of one preset for a clip `durationInFrames` long: whole frames, sorted, first at 0 and
 * last at the duration, every speed in `0.1..10` (design 7.1, section 4.8).
 *
 * `peak` and `rampFrames` are clamped (see the module comment); the defaults are
 * {@link DEFAULT_PRESET_PEAK} and {@link DEFAULT_PRESET_RAMP_FRAMES}.
 *
 * @throws RangeError when `durationInFrames` is not a finite number >= 1.
 */
export function speedPresetCurve(
  preset: SpeedPresetName,
  durationInFrames: number,
  peak: number = DEFAULT_PRESET_PEAK,
  rampFrames: number = DEFAULT_PRESET_RAMP_FRAMES,
): SpeedCurve {
  const { duration, peak: clampedPeak, rampFrames: ramp } = presetInputs(
    durationInFrames,
    peak,
    rampFrames,
  )
  const end = duration
  let keys: SpeedKey[]
  switch (preset) {
    case 'ramp-in':
      keys = [
        { frame: 0, speed: 1 },
        { frame: ramp, speed: clampedPeak },
        { frame: end, speed: clampedPeak },
      ]
      break
    case 'ramp-out':
      keys = [
        { frame: 0, speed: clampedPeak },
        { frame: Math.max(0, end - ramp), speed: clampedPeak },
        { frame: end, speed: 1 },
      ]
      break
    case 'ramp-in-out': {
      // Two ramps and a hold between them: the ramp cannot be longer than half the clip, or the
      // two ramp keys would cross (the normaliser would sort them back into the symmetric shape,
      // which is the same curve, but the clamp keeps the intent readable).
      const half = Math.max(1, Math.floor(end / 2))
      const inOutRamp = Math.min(ramp, half)
      keys = [
        { frame: 0, speed: 1 },
        { frame: inOutRamp, speed: clampedPeak },
        { frame: Math.max(inOutRamp, end - inOutRamp), speed: clampedPeak },
        { frame: end, speed: 1 },
      ]
      break
    }
    default: {
      const unknown: never = preset
      throw new RangeError(`speedPresetCurve: unknown preset ${String(unknown)}`)
    }
  }
  // The keys above already satisfy the invariants for every clamp; normalising is what the store
  // does on every write, and doing it here keeps a preset's answer exactly the curve that is stored.
  return normalizeSpeedCurve({ keys }, end)!
}
