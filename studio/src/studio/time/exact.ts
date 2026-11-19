/**
 * Exact rational arithmetic for the timing maths: fractions of BigInts, the reading of a stored
 * speed back as the fraction it stands for, and the floored products every source-frame
 * position is made of.
 *
 * A source position is a product of integers and stored values — frame indices, rate fractions,
 * speeds stored to the hundredth (or, for a key a cut inserted, to the fraction on its parent's
 * line) — so it is a rational number, and its floor is decided exactly here. A double product
 * lands one frame low whenever the true value is a whole frame and the rounding falls below it
 * (0.29 · 100 is 28.999999999999996): that is the class of error this module removes. Numbers
 * stay doubles at the edges (a stored speed, a frame index); everything in between is a
 * `Fraction`, and the integer fast paths below are taken only where the double result is
 * provably the exact one.
 */

import type { Rate } from './rate'

/** An exact rational number `num / den`: BigInts, `den > 0`, reduced. */
export interface Fraction {
  /** The numerator; its sign is the fraction's. */
  readonly num: bigint
  /** The denominator: always > 0. */
  readonly den: bigint
}

/**
 * The largest denominator a stored speed is read back with: 2^23. A speed a person enters is a
 * hundredth (denominator 100). A key a cut inserts inside a linear segment of length `L` holds
 * the speed the segment has there, a fraction whose denominator divides `100 · L`; so the
 * reading recovers it exactly for every segment up to 83,886 frames (23 minutes at 60 fps) —
 * above that the curve normaliser refuses the ramp (`MAX_RAMP_SEGMENT_FRAMES` in
 * `@/studio/speed`). The bound is what makes the reading unique: two fractions with
 * denominators up to 2^23 are at least 2^-46 apart, far more than the half-ulp (at most
 * 1.8e-15 below 16x) by which a double can miss the fraction it was rounded from.
 */
export const MAX_SPEED_DENOMINATOR = 2 ** 23

const ZERO_BIG = BigInt(0)
const ONE_BIG = BigInt(1)
const TWO_BIG = BigInt(2)

/** Euclid on BigInts; the result is >= 0. */
function gcd(a: bigint, b: bigint): bigint {
  let left = a < ZERO_BIG ? -a : a
  let right = b < ZERO_BIG ? -b : b
  while (right !== ZERO_BIG) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return left
}

/** A safe integer or a BigInt as a BigInt; the error names the value. */
function toBig(value: bigint | number, name: string): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`fraction: ${name} must be a safe integer, got ${value}`)
  }
  return BigInt(value)
}

/**
 * The fraction `num / den`, reduced, with a positive denominator. Numbers must be safe
 * integers: a double that is not an integer has no place in an exact expression.
 *
 * @throws RangeError when `den` is 0 or a number argument is not a safe integer.
 */
export function fraction(num: bigint | number, den: bigint | number = ONE_BIG): Fraction {
  let n = toBig(num, 'num')
  let d = toBig(den, 'den')
  if (d === ZERO_BIG) throw new RangeError('fraction: den must not be 0')
  if (d < ZERO_BIG) {
    n = -n
    d = -d
  }
  const divisor = gcd(n, d)
  return divisor === ONE_BIG || divisor === ZERO_BIG
    ? { num: n, den: d }
    : { num: n / divisor, den: d / divisor }
}

/** 0 as a fraction. */
export const ZERO_FRACTION: Fraction = { num: ZERO_BIG, den: ONE_BIG }

/** `a + b`, exactly. */
export function addFractions(a: Fraction, b: Fraction): Fraction {
  if (a.den === b.den) return fraction(a.num + b.num, a.den)
  return fraction(a.num * b.den + b.num * a.den, a.den * b.den)
}

/** `a - b`, exactly. */
export function subtractFractions(a: Fraction, b: Fraction): Fraction {
  if (a.den === b.den) return fraction(a.num - b.num, a.den)
  return fraction(a.num * b.den - b.num * a.den, a.den * b.den)
}

/** `a · b`, exactly. */
export function multiplyFractions(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.num, a.den * b.den)
}

/**
 * `a / b`, exactly.
 *
 * @throws RangeError when `b` is 0.
 */
export function divideFractions(a: Fraction, b: Fraction): Fraction {
  if (b.num === ZERO_BIG) throw new RangeError('divideFractions: division by 0')
  return fraction(a.num * b.den, a.den * b.num)
}

/** `-1`, `0` or `1` as `a` is below, equal to or above `b`. */
export function compareFractions(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const left = a.num * b.den
  const right = b.num * a.den
  return left < right ? -1 : left > right ? 1 : 0
}

/** The largest integer <= `value`, exactly (toward minus infinity for a negative value). */
export function floorFraction(value: Fraction): bigint {
  const quotient = value.num / value.den
  return value.num < ZERO_BIG && quotient * value.den !== value.num ? quotient - ONE_BIG : quotient
}

/** The smallest integer >= `value`, exactly. */
export function ceilFraction(value: Fraction): bigint {
  return -floorFraction({ num: -value.num, den: value.den })
}

/** `value - floor(value)`: the fractional part, in `[0, 1)`. */
export function fractionalPart(value: Fraction): Fraction {
  return fraction(value.num - floorFraction(value) * value.den, value.den)
}

/**
 * The double nearest the fraction, within one ulp: one correctly rounded division when both
 * parts fit a double exactly, else a 64-bit quotient scaled by a power of two. For display, for
 * audio (which reads between samples), never for a floor.
 */
export function fractionToNumber(value: Fraction): number {
  const limit = BigInt(Number.MAX_SAFE_INTEGER)
  const magnitude = value.num < ZERO_BIG ? -value.num : value.num
  if (magnitude <= limit && value.den <= limit) return Number(value.num) / Number(value.den)
  // Shift so the integer quotient carries 64 significant bits, then undo the shift.
  const shift = 64 - (magnitude.toString(2).length - value.den.toString(2).length)
  const scaled =
    shift >= 0
      ? (magnitude << BigInt(shift)) / value.den
      : magnitude / (value.den << BigInt(-shift))
  const result = Number(scaled) * 2 ** -shift
  return value.num < ZERO_BIG ? -result : result
}

/**
 * The exact value of a double as a fraction: `mantissa / 2^exponent`. Doubling a finite double
 * is exact until it is an integer, so the loop below never rounds.
 */
function dyadicFraction(value: number): Fraction {
  let scaled = value
  let exponent = 0
  while (!Number.isInteger(scaled)) {
    scaled *= 2
    exponent += 1
  }
  return fraction(BigInt(scaled), TWO_BIG ** BigInt(exponent))
}

/** Where a continued-fraction walk stopped: the last two convergents, and why it stopped. */
interface ConvergentWalk {
  readonly previous: Fraction
  readonly current: Fraction
  /** The walk ended on `current` itself: the value, or the double it was asked to stop at. */
  readonly settled: boolean
}

/**
 * Walk the convergents of `value` while their denominators stay within `maxDenominator`; with
 * `stopAtDouble`, stop at the first convergent whose correctly rounded double is that double.
 * The convergents are kept unreduced (`{num, den}` as the recurrence builds them), which is what
 * the semiconvergent step needs.
 */
function walkConvergents(
  value: Fraction,
  maxDenominator: bigint,
  stopAtDouble: number | undefined,
): ConvergentWalk {
  let previous: Fraction = { num: ZERO_BIG, den: ONE_BIG }
  let current: Fraction = { num: ONE_BIG, den: ZERO_BIG }
  let numerator = value.num
  let denominator = value.den
  while (denominator !== ZERO_BIG) {
    const term = numerator / denominator
    const next = { num: previous.num + term * current.num, den: previous.den + term * current.den }
    if (next.den > maxDenominator) return { previous, current, settled: false }
    previous = current
    current = next
    const rest = numerator - term * denominator
    numerator = denominator
    denominator = rest
    if (stopAtDouble !== undefined && Number(current.num) / Number(current.den) === stopAtDouble) {
      return { previous, current, settled: true }
    }
  }
  return { previous, current, settled: true }
}

/** `|f|`, exactly. */
function absoluteFraction(value: Fraction): Fraction {
  return value.num < ZERO_BIG ? { num: -value.num, den: value.den } : value
}

/**
 * Past the bound: the semiconvergent with the largest admissible step, or the last convergent,
 * whichever is nearer `value` (the convergent on a tie).
 */
function nearerBound(value: Fraction, walk: ConvergentWalk, maxDenominator: bigint): Fraction {
  const { previous, current } = walk
  const steps = (maxDenominator - previous.den) / current.den
  const semi = fraction(previous.num + steps * current.num, previous.den + steps * current.den)
  const convergent = fraction(current.num, current.den)
  const semiError = absoluteFraction(subtractFractions(semi, value))
  const convergentError = absoluteFraction(subtractFractions(convergent, value))
  return compareFractions(convergentError, semiError) <= 0 ? convergent : semi
}

/**
 * The fraction with a denominator up to `maxDenominator` nearest to `value` (`value >= 0`), by
 * continued fractions: the last convergent within the bound, or the best semiconvergent past it
 * when that is nearer. With `stopAtDouble`, the walk stops at the first convergent whose
 * correctly rounded double is that double — the simplest fraction that prints as it.
 */
function boundedFraction(value: Fraction, maxDenominator: bigint, stopAtDouble?: number): Fraction {
  if (value.num < ZERO_BIG) throw new RangeError('nearestFraction: value must be >= 0')
  if (value.den <= maxDenominator && stopAtDouble === undefined) return value
  const walk = walkConvergents(value, maxDenominator, stopAtDouble)
  if (walk.settled) return fraction(walk.current.num, walk.current.den)
  return nearerBound(value, walk, maxDenominator)
}

/**
 * The fraction with a denominator up to `maxDenominator` nearest to `value` (a double, or a
 * fraction), `value >= 0`. A double that is the correctly rounded value of such a fraction
 * reads back as exactly that fraction.
 *
 * @throws RangeError when `value` is negative or not finite, or `maxDenominator` < 1.
 */
export function nearestFraction(
  value: number | Fraction,
  maxDenominator: number | bigint,
): Fraction {
  const bound = toBig(maxDenominator, 'maxDenominator')
  if (bound < ONE_BIG) throw new RangeError('nearestFraction: maxDenominator must be >= 1')
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`nearestFraction: value must be a finite number >= 0, got ${value}`)
    }
    return boundedFraction(dyadicFraction(value), bound, value)
  }
  return boundedFraction(value, bound)
}

/** Speeds already read: a timeline holds few distinct ones and every frame asks again. */
const speedFractions = new Map<number, Fraction>()

/** The cache stays small; a pathological caller (a slider sweep) only resets it. */
const SPEED_CACHE_LIMIT = 4_096

/**
 * A stored speed read back as the fraction it stands for: the simplest fraction with a
 * denominator up to `MAX_SPEED_DENOMINATOR` (2^23) whose double is the stored double, or, for
 * a double that is no such fraction's (a speed a rate stretch derived), the nearest fraction
 * within that bound. 0.29 reads as 29/100; a key a cut placed at frame `u` of a segment of
 * length `L` reads as its exact `(V_i·L + dV·u) / (100·L)` while `100·L <= 2^23`, i.e. for a
 * segment up to 83,886 frames (23 minutes at 60 fps), the limit the curve normaliser enforces.
 * Every reader reads a speed through here, so they all compute with the same fraction.
 *
 * @throws RangeError when `value` is not a finite number > 0.
 */
export function exactSpeed(value: number): Fraction {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`exactSpeed: speed must be a finite number > 0, got ${value}`)
  }
  const cached = speedFractions.get(value)
  if (cached !== undefined) return cached
  const result = nearestFraction(value, MAX_SPEED_DENOMINATOR)
  if (speedFractions.size >= SPEED_CACHE_LIMIT) speedFractions.clear()
  speedFractions.set(value, result)
  return result
}

/**
 * `sNum · pDen / (sDen · pNum)`: source frames per timeline frame at 1x, the rate ratio every
 * mapping folds in once.
 */
export function rateRatio(sourceRate: Rate, projectRate: Rate): Fraction {
  return fraction(
    BigInt(sourceRate.num) * BigInt(projectRate.den),
    BigInt(sourceRate.den) * BigInt(projectRate.num),
  )
}

/**
 * `floor(frames · speed · sNum · pDen / (sDen · pNum))`, exactly, for a signed integer `frames`
 * (toward minus infinity when negative): the constant-speed mapping of design 1.5, section 4.2.
 *
 * When the whole numerator is below 2^53 every partial product is an exact double and the one
 * division is correctly rounded, so its floor is exact (a non-integer quotient sits at least
 * `1/denominator` from an integer, more than the rounding can move it); otherwise the product
 * is taken in BigInt.
 */
export function floorScaledFrames(
  frames: number,
  speed: Fraction,
  sourceRate: Rate,
  projectRate: Rate,
): number {
  const speedNum = Number(speed.num)
  const speedDen = Number(speed.den)
  const numerator = frames * speedNum * sourceRate.num * projectRate.den
  const denominator = speedDen * sourceRate.den * projectRate.num
  if (Math.abs(numerator) <= Number.MAX_SAFE_INTEGER && denominator <= Number.MAX_SAFE_INTEGER) {
    return Math.floor(numerator / denominator)
  }
  return Number(
    floorFraction(
      fraction(
        BigInt(frames) * speed.num * BigInt(sourceRate.num) * BigInt(projectRate.den),
        speed.den * BigInt(sourceRate.den) * BigInt(projectRate.num),
      ),
    ),
  )
}
