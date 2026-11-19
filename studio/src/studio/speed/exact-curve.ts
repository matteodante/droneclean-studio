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
 * the closed form of `curve.ts`, term for term. `curve.ts` keeps the double version for the
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
import { validateSpeedCurve, type SpeedCurve } from './curve'

/** A clip frame for the exact maths must be an integer >= 0; the error names the function. */
function assertIntegerFrame(functionName: string, frame: number): void {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError(`${functionName}: frame must be an integer >= 0, got ${frame}`)
  }
}

/** `offset·start + (end − start)·offset² / (2·length)`: one linear segment's area to `offset`. */
function segmentArea(start: Fraction, end: Fraction, length: number, offset: number): Fraction {
  const linear = multiplyFractions(start, fraction(offset))
  const delta = subtractFractions(end, start)
  return addFractions(
    linear,
    multiplyFractions(delta, fraction(BigInt(offset) * BigInt(offset), BigInt(2 * length))),
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
  let startFrame = keys[0]!.frame
  let startSpeed = exactSpeed(keys[0]!.speed)
  for (let index = 1; index < keys.length; index++) {
    const key = keys[index]!
    const endSpeed = exactSpeed(key.speed)
    const length = key.frame - startFrame
    if (frame <= key.frame) {
      return addFractions(area, segmentArea(startSpeed, endSpeed, length, frame - startFrame))
    }
    area = addFractions(area, segmentArea(startSpeed, endSpeed, length, length))
    startFrame = key.frame
    startSpeed = endSpeed
  }
  return addFractions(area, multiplyFractions(startSpeed, fraction(frame - startFrame)))
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
  let startFrame = keys[0]!.frame
  let startSpeed = exactSpeed(keys[0]!.speed)
  for (let index = 1; index < keys.length; index++) {
    const key = keys[index]!
    const endSpeed = exactSpeed(key.speed)
    if (frame <= key.frame) {
      if (frame === key.frame) return endSpeed
      return addFractions(
        startSpeed,
        multiplyFractions(
          subtractFractions(endSpeed, startSpeed),
          fraction(frame - startFrame, key.frame - startFrame),
        ),
      )
    }
    startFrame = key.frame
    startSpeed = endSpeed
  }
  return startSpeed
}
