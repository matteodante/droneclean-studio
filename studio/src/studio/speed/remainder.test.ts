// @vitest-environment node

/**
 * The cut's remainder as a stored fraction (review finding T4, decision 3 of the time-core
 * brief): an old project's double read as the nearest fraction up to 1,000,000, a fraction
 * reduced and kept in [0, 1).
 */

import { describe, expect, it } from 'vite-plus/test'
import { fraction } from '@/studio/time'
import {
  LEGACY_REMAINDER_DENOMINATOR,
  normalizeSourceRemainder,
  sourceRemainderValue,
  toSourceRemainder,
} from './remainder'

describe('normalizeSourceRemainder', () => {
  it.each([
    { name: 'a fraction', value: { num: 1, den: 4 }, expected: { num: 1, den: 4 } },
    { name: 'an unreduced fraction', value: { num: 6, den: 8 }, expected: { num: 3, den: 4 } },
    { name: 'zero', value: { num: 0, den: 7 }, expected: undefined },
    { name: 'one or more', value: { num: 4, den: 4 }, expected: undefined },
    { name: 'a negative numerator', value: { num: -1, den: 4 }, expected: undefined },
    { name: 'a zero denominator', value: { num: 0, den: 0 }, expected: undefined },
    { name: 'a fractional numerator', value: { num: 0.5, den: 4 }, expected: undefined },
    { name: 'not an object', value: 'half', expected: undefined },
    { name: 'absent', value: undefined, expected: undefined },
  ])('$name', ({ value, expected }) => {
    expect(normalizeSourceRemainder(value)).toEqual(expected)
  })

  it.each([
    { name: 'a quarter', value: 0.25, expected: { num: 1, den: 4 } },
    { name: 'a value past a whole frame', value: 195.25, expected: { num: 1, den: 4 } },
    { name: 'a whole frame', value: 195, expected: undefined },
    { name: 'a negative value', value: -0.25, expected: undefined },
    { name: 'not a number', value: Number.NaN, expected: undefined },
    { name: 'infinite', value: Number.POSITIVE_INFINITY, expected: undefined },
    { name: 'a value that rounds to 1', value: 0.9999999999, expected: undefined },
  ])('reads an old project’s double: $name', ({ value, expected }) => {
    expect(normalizeSourceRemainder(value)).toEqual(expected)
  })

  it('reads an old double as the nearest fraction with a denominator up to 1,000,000', () => {
    // The old split of the review's ramp stored 0.012514619883040368: the double of 214/17100,
    // whose denominator fits, so it reads back exactly.
    expect(normalizeSourceRemainder(214 / 17_100)).toEqual({ num: 107, den: 8_550 })
    // A double with no such fraction reads as the nearest one.
    const read = normalizeSourceRemainder(0.123456789)!
    expect(read.den).toBeLessThanOrEqual(LEGACY_REMAINDER_DENOMINATOR)
    const error = Math.abs(read.num / read.den - 0.123456789)
    let nearer = 0
    for (let den = 1; den <= LEGACY_REMAINDER_DENOMINATOR; den++) {
      if (Math.abs(Math.round(0.123456789 * den) / den - 0.123456789) < error) nearer += 1
    }
    expect(nearer).toBe(0)
  })
})

describe('toSourceRemainder and its value', () => {
  it('stores a fraction in [0, 1) reduced, and 0 as nothing', () => {
    expect(toSourceRemainder(fraction(10, 40))).toEqual({ num: 1, den: 4 })
    expect(toSourceRemainder(fraction(0))).toBeUndefined()
    expect(() => toSourceRemainder(fraction(1))).toThrowError(/\[0, 1\)/)
  })

  it('fits a denominator past a double’s integers to the nearest fraction that fits', () => {
    const huge = fraction(BigInt(1), BigInt(2) ** BigInt(60))
    const stored = toSourceRemainder(huge)
    expect(stored === undefined || Number.isSafeInteger(stored.den)).toBe(true)
  })

  it('is the double of the fraction, 0 when absent', () => {
    expect(sourceRemainderValue({ num: 1, den: 4 })).toBe(0.25)
    expect(sourceRemainderValue(undefined)).toBe(0)
  })
})
