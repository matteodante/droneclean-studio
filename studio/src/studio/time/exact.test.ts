// @vitest-environment node

/**
 * The exact arithmetic the timing maths floors with (review findings T3, T9): fractions of
 * BigInts, the reading of a stored speed back as the fraction it stands for, and the floored
 * products of the constant-speed mapping.
 */

import { describe, expect, it } from 'vite-plus/test'
import {
  addFractions,
  ceilFraction,
  compareFractions,
  exactSpeed,
  floorFraction,
  floorScaledFrames,
  fraction,
  fractionalPart,
  fractionToNumber,
  MAX_SPEED_DENOMINATOR,
  nearestFraction,
  rateRatio,
} from './exact'

describe('fractions', () => {
  it('reduce, keep the sign on the numerator and compare exactly', () => {
    expect(fraction(6, -8)).toEqual({ num: BigInt(-3), den: BigInt(4) })
    expect(addFractions(fraction(1, 3), fraction(1, 6))).toEqual(fraction(1, 2))
    expect(compareFractions(fraction(1, 3), fraction(333_333, 1_000_000))).toBe(1)
    expect(() => fraction(1, 0)).toThrowError(/den/)
    expect(() => fraction(0.5)).toThrowError(/safe integer/)
  })

  it('floor and ceil toward the right integers on both sides of zero', () => {
    expect(floorFraction(fraction(7, 2))).toBe(BigInt(3))
    expect(floorFraction(fraction(-7, 2))).toBe(BigInt(-4))
    expect(floorFraction(fraction(-6, 2))).toBe(BigInt(-3))
    expect(ceilFraction(fraction(7, 2))).toBe(BigInt(4))
    expect(fractionalPart(fraction(-7, 2))).toEqual(fraction(1, 2))
  })

  it('turn into the nearest double, also past a double’s integers', () => {
    expect(fractionToNumber(fraction(1, 3))).toBe(1 / 3)
    const huge = fraction(
      BigInt(10) ** BigInt(30) + BigInt(1),
      BigInt(3) * BigInt(10) ** BigInt(29),
    )
    expect(fractionToNumber(huge)).toBeCloseTo(10 / 3, 14)
  })
})

describe('exactSpeed', () => {
  it('reads a speed stored to the hundredth as that hundredth (T9: 0.29 is 29/100)', () => {
    expect(exactSpeed(0.29)).toEqual(fraction(29, 100))
    for (let hundredths = 10; hundredths <= 1_600; hundredths++) {
      expect(exactSpeed(hundredths / 100)).toEqual(fraction(hundredths, 100))
    }
  })

  it('reads a cut key’s speed back exactly for every denominator up to 2^23', () => {
    // The largest ramp the normaliser keeps is 83,886 frames: its cut speeds have denominator
    // 100·83,886, just under 2^23.
    const length = 83_886
    for (const [start, end, offset] of [
      [502, 246, 1],
      [10, 1_000, 41_943],
      [999, 11, length - 1],
    ] as const) {
      const exact = fraction(start * length + (end - start) * offset, 100 * length)
      expect(exact.den <= BigInt(MAX_SPEED_DENOMINATOR)).toBe(true)
      expect(exactSpeed(fractionToNumber(exact))).toEqual(exact)
    }
  })

  it('reads any other double as the nearest fraction within 2^23, the same one every time', () => {
    const odd = 1.2345678912345
    const read = exactSpeed(odd)
    expect(read.den <= BigInt(MAX_SPEED_DENOMINATOR)).toBe(true)
    expect(Math.abs(fractionToNumber(read) - odd)).toBeLessThan(1e-12)
    expect(exactSpeed(odd)).toBe(read)
  })

  it('refuses a speed that is not a positive number', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => exactSpeed(value)).toThrowError(/speed/)
    }
  })
})

describe('nearestFraction', () => {
  it('is the best approximation within the bound', () => {
    expect(nearestFraction(Math.PI, 1_000)).toEqual(fraction(355, 113))
    expect(nearestFraction(fraction(1_000_001, 3_000_000), 10)).toEqual(fraction(1, 3))
  })
})

describe('floorScaledFrames', () => {
  it('is the exact floor of frames · speed · ratio, for a negative count too', () => {
    const rate30 = { num: 30, den: 1 }
    const rate2997 = { num: 30_000, den: 1_001 }
    expect(floorScaledFrames(100, exactSpeed(0.29), rate30, rate30)).toBe(29)
    expect(floorScaledFrames(-3, exactSpeed(0.5), rate30, rate30)).toBe(-2)
    // 375 frames at 0.94x of a 23.976 source in a 29.97 project is exactly 282 source frames.
    expect(floorScaledFrames(375, exactSpeed(0.94), { num: 24_000, den: 1_001 }, rate2997)).toBe(
      282,
    )
    expect(rateRatio({ num: 24_000, den: 1_001 }, rate2997)).toEqual(fraction(4, 5))
  })

  it('takes the product in BigInt past a double’s integers', () => {
    const rate = { num: 60_000, den: 1_001 }
    const huge = 2 ** 40
    expect(floorScaledFrames(huge, exactSpeed(9.99), rate, { num: 24, den: 1 })).toBe(
      Number(
        (BigInt(huge) * BigInt(999) * BigInt(60_000)) / (BigInt(100) * BigInt(1_001) * BigInt(24)),
      ),
    )
  })
})
