/**
 * The remainder a cut leaves (design 7.1, section 4.6; review finding T4): the fractional part
 * of the source position at a clip's first frame, stored as a fraction of two integers.
 *
 * A clip's source position at its frame `m` is `floor(sourceStart) + rem + advance(m)`, where
 * `advance` is the curve's integral, or `m · speed`, with the rate ratio folded in. A cut at a
 * frame whose position is not a whole source frame puts the whole part into the new clip's
 * `sourceStart` and keeps the rest here, so the new clip's frames are its parent's, on a curve
 * or at one speed alike. The position is a rational number (`@/studio/time`'s exact
 * arithmetic), so its fractional part is a fraction: storing it as a double would put the next
 * floor one frame low wherever the parent's position is a whole frame.
 *
 * The remainder belongs to the mapping it was cut from. Re-authoring the mapping — a speed
 * change, a curve edit, an edge stretch — drops it (the first frame's source frame is
 * unchanged, `floor(rem) = 0`): a new mapping has no parent to agree with, and dropping it keeps
 * every stored denominator a divisor of `200 · L · ratio` (at most about 3.5e10), far inside a
 * double's integers.
 */

import {
  compareFractions,
  fraction,
  nearestFraction,
  ZERO_FRACTION,
  type Fraction,
} from '@/studio/time'

/** A cut's remainder: `num / den` source frames, `0 < num < den`, reduced, safe integers. */
export interface SourceRemainder {
  /** The numerator: an integer, 0 < num < den. */
  readonly num: number
  /** The denominator: a positive integer. */
  readonly den: number
}

/**
 * The largest denominator an old project's double remainder is read back with (decision 3 of
 * the time-core brief): the nearest fraction with a denominator up to 1,000,000.
 */
export const LEGACY_REMAINDER_DENOMINATOR = 1_000_000

const ONE: Fraction = fraction(1)
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * A fraction in `[0, 1)` as the stored remainder, or `undefined` for 0. A denominator past a
 * double's integers — only reachable from an old project's remainder cut again — is the nearest
 * fraction that fits, and one that rounds up to 1 is dropped.
 *
 * @throws RangeError when `value` is outside `[0, 1)`.
 */
export function toSourceRemainder(value: Fraction): SourceRemainder | undefined {
  if (compareFractions(value, ZERO_FRACTION) < 0 || compareFractions(value, ONE) >= 0) {
    throw new RangeError('toSourceRemainder: a remainder must be within [0, 1)')
  }
  const fitting = value.den > MAX_SAFE ? nearestFraction(value, MAX_SAFE) : value
  if (fitting.num === BigInt(0) || fitting.num === fitting.den) return undefined
  return { num: Number(fitting.num), den: Number(fitting.den) }
}

/** The stored remainder as an exact fraction; absent is 0. */
export function remainderFraction(value: SourceRemainder | undefined): Fraction {
  return value === undefined ? ZERO_FRACTION : fraction(value.num, value.den)
}

/**
 * The stored remainder as a double, in source frames: for audio, which reads between samples
 * and needs no floor. Absent is 0.
 */
export function sourceRemainderValue(value: SourceRemainder | undefined): number {
  return value === undefined ? 0 : value.num / value.den
}

/**
 * The remainder a project file or a caller holds, normalised for the store, or `undefined`:
 *
 * - `{ num, den }` of safe integers with `0 <= num < den`: reduced, and 0 is `undefined`.
 * - A number — the double an old project stored — is reduced to its fractional part and read
 *   as the nearest fraction with a denominator up to `LEGACY_REMAINDER_DENOMINATOR`
 *   (1,000,000); one that rounds to 0 or 1 is `undefined`.
 * - Anything else (a negative or non-finite number, a malformed object) is `undefined`: a
 *   hand-edited file loads as the clip without a remainder rather than as a crash.
 */
export function normalizeSourceRemainder(value: unknown): SourceRemainder | undefined {
  if (typeof value === 'number') return legacyRemainder(value)
  const parts = fractionParts(value)
  if (parts === undefined || parts.den <= 0 || parts.num < 0 || parts.num >= parts.den) {
    return undefined
  }
  return toSourceRemainder(fraction(parts.num, parts.den))
}

/** An old project's double: its fractional part, as the nearest fraction up to 1,000,000. */
function legacyRemainder(value: number): SourceRemainder | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined
  const part = value - Math.floor(value)
  if (part === 0) return undefined
  const read = nearestFraction(part, LEGACY_REMAINDER_DENOMINATOR)
  if (read.num === BigInt(0) || read.num === read.den) return undefined
  return { num: Number(read.num), den: Number(read.den) }
}

/** `{ num, den }` of safe integers, read off data from outside, or `undefined`. */
function fractionParts(value: unknown): { num: number; den: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { num, den } = value as { num?: unknown; den?: unknown }
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) return undefined
  return { num: num as number, den: den as number }
}
