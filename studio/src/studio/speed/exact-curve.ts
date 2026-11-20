/**
 * The speed curve's integral and speed as exact fractions (review findings T3 and T9).
 *
 * Every key's frame is an integer and every key's speed is read back as the fraction it stands
 * for (`exactSpeed`: a hundredth for a key a person set, the parent line's fraction for a key a
 * cut inserted), so the integral at an integer frame is a rational number and these functions
 * compute it with no rounding:
 *
 *     area(n) = B_i + u·S_i + (S_(i+1) − S_i)·u² / (2·L_i)     (u = n − f_i, L_i = f_(i+1) − f_i)
 *
 * the closed form of `curve.ts`, term for term. An eased segment (`ease.ts`) replaces the
 * quadratic term with the shape's own polynomial, `(v1 − v0)·L·G(u/L)`, which is rational too;
 * a segment cut from a longer ramp (`easeSlice`) is that ramp's area between two of its frames. `curve.ts` keeps the double version for the
 * inverse, the audio read between samples and the panel's drawing; a floor — which source frame
 * a timeline frame shows — always comes from here.
 */

import {
  addFractions,
  exactSpeed,
  fraction,
  multiplyFractions,
  subtractFractions,
  ZERO_FRACTION,
  type Fraction,
} from '@/studio/time'
import { validateSpeedCurve, type SpeedCurve, type SpeedKey } from './curve'
import { exactEaseArea, exactEaseValue } from './ease'

/** A clip frame for the exact maths must be an integer >= 0; the error names the function. */
function assertIntegerFrame(functionName: string, frame: number): void {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError(`${functionName}: frame must be an integer >= 0, got ${frame}`)
  }
}

/** One segment as the exact maths reads it: a piece `[offset, offset + length]` of a parent ramp. */
interface ExactSegment {
  readonly ease: SpeedKey['ease'] & string
  readonly start: Fraction
  readonly delta: Fraction
  readonly parentLength: number
  readonly offset: number
  readonly length: number
}

/** The segment from `startKey` to the next key `endKey`, with its speeds as fractions. */
function exactSegmentBetween(startKey: SpeedKey, endKey: SpeedKey): ExactSegment {
  const length = endKey.frame - startKey.frame
  const ease = startKey.ease ?? 'linear'
  const slice = ease === 'linear' ? undefined : startKey.easeSlice
  const start = exactSpeed(slice ? slice.from : startKey.speed)
  const end = exactSpeed(slice ? slice.to : endKey.speed)
  return {
    ease,
    start,
    delta: subtractFractions(end, start),
    parentLength: slice ? slice.length : length,
    offset: slice ? slice.offset : 0,
    length,
  }
}

/** The area of the parent ramp from its start to frame `t`: `t·v0 + (v1 − v0)·L·G(t/L)`. */
function rampArea(segment: ExactSegment, t: number): Fraction {
  return addFractions(
    multiplyFractions(segment.start, fraction(t)),
    multiplyFractions(segment.delta, exactEaseArea(segment.ease, t, segment.parentLength)),
  )
}

/** One segment's area over its first `offset` frames. */
function segmentArea(segment: ExactSegment, offset: number): Fraction {
  if (segment.offset === 0) return rampArea(segment, offset)
  return subtractFractions(
    rampArea(segment, segment.offset + offset),
    rampArea(segment, segment.offset),
  )
}

/**
 * The curve's integral from frame 0 to the integer `frame`, exactly, in "speed × timeline
 * frames". Past the last key the last speed holds.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does) or `frame` when it is
 * not an integer >= 0.
 */
export function exactAreaAt(curve: SpeedCurve, frame: number): Fraction {
  validateSpeedCurve(curve)
  assertIntegerFrame('exactAreaAt', frame)
  const { keys } = curve
  let area = ZERO_FRACTION
  let startKey = keys[0]!
  for (let index = 1; index < keys.length; index++) {
    const key = keys[index]!
    const segment = exactSegmentBetween(startKey, key)
    if (frame <= key.frame) {
      return addFractions(area, segmentArea(segment, frame - startKey.frame))
    }
    area = addFractions(area, segmentArea(segment, segment.length))
    startKey = key
  }
  return addFractions(
    area,
    multiplyFractions(exactSpeed(startKey.speed), fraction(frame - startKey.frame)),
  )
}

/**
 * The speed the curve holds at the integer `frame`, exactly: a key's own on a key, the line
 * between two keys inside a segment, the last key's past the last key. This is the speed a cut
 * at `frame` gives the key it inserts.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does) or `frame` when it is
 * not an integer >= 0.
 */
export function exactSpeedAt(curve: SpeedCurve, frame: number): Fraction {
  validateSpeedCurve(curve)
  assertIntegerFrame('exactSpeedAt', frame)
  const { keys } = curve
  let startKey = keys[0]!
  for (let index = 1; index < keys.length; index++) {
    const key = keys[index]!
    if (frame <= key.frame) {
      if (frame === key.frame) return exactSpeed(key.speed)
      const segment = exactSegmentBetween(startKey, key)
      return addFractions(
        segment.start,
        multiplyFractions(
          segment.delta,
          exactEaseValue(segment.ease, segment.offset + (frame - startKey.frame), segment.parentLength),
        ),
      )
    }
    startKey = key
  }
  return exactSpeed(startKey.speed)
}
