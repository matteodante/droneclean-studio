/**
 * The shapes a speed curve segment can take between two keys, and their integrals (task 11.11).
 *
 * A segment runs from its first key's speed `v0` to the next key's `v1`. `linear` is the
 * straight line this module started with. The others bend it with a unit shape `g(x)` for
 * `x = u / L` (`u` the frames since the segment's start, `L` its length):
 *
 *     speed(u) = v0 + (v1 - v0)·g(x)
 *
 * | ease       | g(x)      | G(x) = ∫g           | what it does                              |
 * |------------|-----------|---------------------|-------------------------------------------|
 * | `linear`   | x         | x²/2                | the line                                  |
 * | `smooth`   | 3x² − 2x³ | x³ − x⁴/2           | smoothstep: slow to leave, slow to arrive |
 * | `ease-in`  | x²        | x³/3                | stays near `v0` first, arrives fast       |
 * | `ease-out` | 2x − x²   | x² − x³/3           | leaves fast, settles on `v1`              |
 *
 * Every `g` is a polynomial with `g(0) = 0` and `g(1) = 1`, rising, so the speed never leaves
 * `v0..v1` and the integral is a polynomial too: the area of a segment is rational in the frame
 * index exactly as the linear one is, and `exact-curve.ts` computes it with no rounding. The
 * inverse of the area (frames for a source span) has no closed form past the quadratic; the
 * double version in `curve.ts` solves it by bisection, and `mapping.ts` settles the whole
 * frame of a clip's length against the exact integral.
 *
 * A segment cut by an edit keeps the parent's shape: the key that starts it carries
 * `easeSlice`, which says which frames of which parent ramp the segment is (`SpeedEaseSlice`).
 */

import { fraction, type Fraction } from '@/studio/time'

/** The ease of a segment: the shape its speed follows from its key to the next one. */
export type SpeedEase = 'linear' | 'smooth' | 'ease-in' | 'ease-out'

/** Every ease, linear first: the order a menu lists them. */
export const SPEED_EASES: readonly SpeedEase[] = ['linear', 'smooth', 'ease-in', 'ease-out']

/** Whether `value` names an ease. */
export function isSpeedEase(value: unknown): value is SpeedEase {
  return typeof value === 'string' && (SPEED_EASES as readonly string[]).includes(value)
}

/**
 * A piece of a longer eased ramp: the segment that starts at the key holding this runs from
 * frame `offset` of a ramp `length` frames long that goes from speed `from` to speed `to`. A cut
 * inside an eased segment writes one on each half, so both halves keep the parent's speed on
 * every frame; the key's own `speed` (and the next key's) is then only the value there rounded
 * to a double, for display and the clamp, never what the mapping integrates.
 */
export interface SpeedEaseSlice {
  /** Whole frames of the parent ramp before this segment starts: an integer >= 0. */
  readonly offset: number
  /** The parent ramp's length in frames: an integer >= 1. */
  readonly length: number
  /** The parent ramp's speed at its start. */
  readonly from: number
  /** The parent ramp's speed at its end. */
  readonly to: number
}

/** The shape `g(x)` of an ease at `x` in 0..1: 0 at 0, 1 at 1. */
export function easeValue(ease: SpeedEase, x: number): number {
  switch (ease) {
    case 'linear':
      return x
    case 'smooth':
      return x * x * (3 - 2 * x)
    case 'ease-in':
      return x * x
    case 'ease-out':
      return x * (2 - x)
  }
}

/** The integral of the shape, `G(x)`, at `x` in 0..1. */
export function easeIntegral(ease: SpeedEase, x: number): number {
  switch (ease) {
    case 'linear':
      return (x * x) / 2
    case 'smooth':
      return x * x * x * (1 - x / 2)
    case 'ease-in':
      return (x * x * x) / 3
    case 'ease-out':
      return x * x * (1 - x / 3)
  }
}

/** `g(t / length)` exactly, for integers `0 <= t <= length`. */
export function exactEaseValue(ease: SpeedEase, t: number, length: number): Fraction {
  const u = BigInt(t)
  const l = BigInt(length)
  switch (ease) {
    case 'linear':
      return fraction(u, l)
    case 'smooth':
      return fraction(u * u * (3n * l - 2n * u), l * l * l)
    case 'ease-in':
      return fraction(u * u, l * l)
    case 'ease-out':
      return fraction(u * (2n * l - u), l * l)
  }
}

/**
 * `length · G(t / length)` exactly, for integers `0 <= t <= length`: the area under the unit
 * shape scaled to a ramp `length` frames long, up to frame `t`.
 */
export function exactEaseArea(ease: SpeedEase, t: number, length: number): Fraction {
  const u = BigInt(t)
  const l = BigInt(length)
  switch (ease) {
    case 'linear':
      return fraction(u * u, 2n * l)
    case 'smooth':
      return fraction(u * u * u * (2n * l - u), 2n * l * l * l)
    case 'ease-in':
      return fraction(u * u * u, 3n * l * l)
    case 'ease-out':
      return fraction(u * u * (3n * l - u), 3n * l * l)
  }
}
