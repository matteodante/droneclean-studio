/**
 * Exact frame rates, and the two conversions between a frame index and seconds.
 *
 * A rate is the fraction `num / den` (frames per second) held as two integers: 59.94 is
 * `60000 / 1001`, not the double 59.94. Every module takes its rates from `toRate` and keeps
 * positions as integer frame counts; seconds are derived from a frame index, never summed, so
 * nothing drifts (design 1.5, section 4.1).
 */

/** An exact frame rate: `num / den` frames per second, both integers, reduced, `den > 0`. */
export interface Rate {
  /** Numerator: a positive integer. */
  readonly num: number
  /** Denominator: a positive integer; `num / den` is reduced. */
  readonly den: number
}

/**
 * The rates a project can have, in the order the UI lists them: 23.976, 24, 25, 29.97, 30, 50,
 * 59.94 and 60. The three fractional rates are the NTSC families, exactly 24000/1001,
 * 30000/1001 and 60000/1001.
 */
export const RATES = [
  { num: 24000, den: 1001 },
  { num: 24, den: 1 },
  { num: 25, den: 1 },
  { num: 30000, den: 1001 },
  { num: 30, den: 1 },
  { num: 50, den: 1 },
  { num: 60000, den: 1001 },
  { num: 60, den: 1 },
] as const satisfies readonly Rate[]

/**
 * The two rates an old project may still hold: 120 and 240 fps. A new project is never offered
 * them; a project that already has one keeps it visible in its rate list (project-fps.ts).
 */
export const LEGACY_RATES = [
  { num: 120, den: 1 },
  { num: 240, den: 1 },
] as const satisfies readonly Rate[]

/**
 * How far a double may be from a known fraction and still be that fraction, relative to the
 * fraction. 1e-12 is far above one ulp (2.2e-16), which unites mediabunny's `60 / 1.001` with
 * `60000 / 1001`, and far below the 1e-6 that separates the decimal names from their fractions.
 */
const RELATIVE_TOLERANCE = 1e-12

/**
 * The decimal names the project file, the probe and the UI use for the fractional rates. Each
 * is 1e-6 (relative) from its fraction, so the tolerance above cannot catch it: the name is
 * matched exactly. 47.952 and 119.88 are the 48 and 120 fps NTSC rates, 48000/1001 and
 * 120000/1001, which a source can carry even though a project cannot be created at them.
 */
const DECIMAL_NAMES: readonly { readonly value: number; readonly rate: Rate }[] = [
  { value: 23.976, rate: { num: 24000, den: 1001 } },
  { value: 29.97, rate: { num: 30000, den: 1001 } },
  { value: 47.952, rate: { num: 48000, den: 1001 } },
  { value: 59.94, rate: { num: 60000, den: 1001 } },
  { value: 119.88, rate: { num: 120000, den: 1001 } },
]

/**
 * Every fraction `toRate` recognises: the offered rates, the legacy rates, and the two NTSC
 * rates a source can carry though a project cannot be created at them — 48 fps NTSC (47.952,
 * which drones record) and 120 fps NTSC (119.88).
 */
const KNOWN_RATES: readonly Rate[] = [
  ...RATES,
  ...LEGACY_RATES,
  { num: 48000, den: 1001 },
  { num: 120000, den: 1001 },
]

/** The denominator of the fallback of `toRate`: a value becomes a whole number of millionths. */
const MICRO = 1_000_000

/** Euclid's algorithm on positive safe integers. */
function greatestCommonDivisor(a: number, b: number): number {
  let left = a
  let right = b
  while (right !== 0) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return left
}

/**
 * Reduce a fraction of positive integers, returning the input object when it is already
 * reduced so a rate that came out of `toRate` is not copied again on every call.
 */
function reduceFraction(rate: Rate): Rate {
  const divisor = greatestCommonDivisor(rate.num, rate.den)
  return divisor === 1 ? rate : { num: rate.num / divisor, den: rate.den / divisor }
}

/**
 * Check a `Rate`'s invariant (positive safe integers) and reduce it. A rate built by hand
 * cannot reach the maths unreduced or with a zero denominator.
 */
function normalizeRate(rate: Rate): Rate {
  const { num, den } = rate
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
    throw new RangeError(`toRate: ${num}/${den} is not a rate of positive integers`)
  }
  return reduceFraction(rate)
}

/**
 * The rate as frames per second: `num / den`, one correctly rounded division. For display, an
 * export setting or a third-party API only — never use it as the step of a sum (design 1.5,
 * 4.1 and 5.4).
 */
export function rateValue(rate: Rate): number {
  return rate.num / rate.den
}

/**
 * Turn a value into a rate: the only way a number becomes one.
 *
 * - A value within 1e-12 relative of a known fraction becomes that fraction; this is what
 *   unites `60000 / 1001` with mediabunny's `60 / 1.001`, one ulp apart.
 * - The decimal names 23.976, 29.97, 47.952, 59.94 and 119.88 become their fractions exactly;
 *   they sit 1e-6 from the fractions, outside the tolerance above.
 * - Anything else becomes `round(value · 1e6) / 1e6`, reduced, so a value survives to six
 *   decimals and the type's integer invariant holds.
 *
 * A `Rate` argument is checked against the same invariant and reduced, so a rate that arrived
 * from the project file or a caller is safe to pass through here as well.
 *
 * @throws RangeError when the value is not finite or not positive, when a `Rate`'s `num`/`den`
 * are not positive integers, or when a value cannot be expressed in millionths (above ~9.0e9,
 * or below 5e-7, where the rounded numerator would leave the integer range).
 */
export function toRate(value: Rate | number): Rate {
  if (typeof value !== 'number') {
    return normalizeRate(value)
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`toRate: ${value} is not a positive finite frame rate`)
  }
  for (const known of KNOWN_RATES) {
    const exact = rateValue(known)
    if (Math.abs(value - exact) <= RELATIVE_TOLERANCE * exact) {
      return known
    }
  }
  for (const named of DECIMAL_NAMES) {
    if (value === named.value) {
      return named.rate
    }
  }
  const numerator = Math.round(value * MICRO)
  if (!Number.isSafeInteger(numerator) || numerator < 1) {
    throw new RangeError(`toRate: ${value} cannot be expressed in millionths of a frame rate`)
  }
  return reduceFraction({ num: numerator, den: MICRO })
}

/**
 * Whether two rates are the same: `a.num · b.den === b.num · a.den`, no division, so no
 * rounding can call two different rates equal. Unreduced fractions compare correctly:
 * `{60000, 1001}` and `{120000, 2002}` are equal.
 */
export function ratesEqual(a: Rate, b: Rate): boolean {
  return a.num * b.den === b.num * a.den
}

/**
 * The start time in seconds of `frame` at `rate`: `frame · den / num`, one rounding.
 *
 * Use it only where a seconds value is required (a `<video>` currentTime, a decoder timestamp,
 * a mediabunny sample). Never add such values up to find the next frame: call this again with
 * the next integer frame, so every result is a function of one index (design 1.5, 4.1).
 */
export function frameToSeconds(rate: Rate, frame: number): number {
  return (frame * rate.den) / rate.num
}

/**
 * The frame that contains `seconds` at `rate`: `round(seconds · num / den)`, one rounding.
 *
 * `secondsToFrame(frameToSeconds(frame))` is `frame` for every frame in the editor's range: at
 * 20 minutes and 59.94 the product is at most 7.2e7, whose rounding error is eight orders of
 * magnitude below the distance to the nearest half-frame boundary (design 1.5, 4.1 and 4.8).
 */
export function secondsToFrame(rate: Rate, seconds: number): number {
  return Math.round((seconds * rate.num) / rate.den)
}

/**
 * The label a list shows for a rate: "60", "59.94", "29.97", "23.976", "119.88". An integer
 * rate prints without decimals; any other rate is rounded to three decimals with trailing zeros
 * dropped — the rule the project form's `formatFpsValue` already uses, so the two cannot
 * disagree (design 1.5, 4.6).
 */
export function formatRate(rate: Rate): string {
  const value = rateValue(rate)
  if (Number.isInteger(value)) {
    return `${value}`
  }
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
