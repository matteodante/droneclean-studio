// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  LEGACY_RATES,
  RATES,
  formatRate,
  frameToSeconds,
  rateValue,
  ratesEqual,
  secondsToFrame,
  toRate,
  type Rate,
} from './rate'

const RATE_23_976 = { num: 24000, den: 1001 }
const RATE_29_97 = { num: 30000, den: 1001 }
const RATE_59_94 = { num: 60000, den: 1001 }
const RATE_119_88 = { num: 120000, den: 1001 }

describe('RATES', () => {
  it('lists the eight offered rates in display order, then the legacy pair', () => {
    expect(RATES).toEqual([
      { num: 24000, den: 1001 },
      { num: 24, den: 1 },
      { num: 25, den: 1 },
      { num: 30000, den: 1001 },
      { num: 30, den: 1 },
      { num: 50, den: 1 },
      { num: 60000, den: 1001 },
      { num: 60, den: 1 },
    ])
    expect(LEGACY_RATES).toEqual([
      { num: 120, den: 1 },
      { num: 240, den: 1 },
    ])
  })
})

describe('toRate', () => {
  it('recognises every fraction from the double it prints as', () => {
    for (const rate of [...RATES, ...LEGACY_RATES, RATE_119_88]) {
      expect(toRate(rate)).toEqual(rate)
      expect(toRate(rateValue(rate))).toEqual(rate)
    }
  })

  it("unites mediabunny's 60/1.001 with 60000/1001, one ulp apart", () => {
    const fromMediabunny = 60 / 1.001

    expect(fromMediabunny).not.toBe(60000 / 1001)
    expect(toRate(fromMediabunny)).toEqual(RATE_59_94)
    expect(toRate(60000 / 1001)).toEqual(RATE_59_94)
  })

  it('knows 47.952 fps, the 48 fps NTSC rate drones record, as 48000/1001 (T10)', () => {
    const RATE_47_952 = { num: 48000, den: 1001 }
    expect(toRate(48000 / 1001)).toEqual(RATE_47_952)
    expect(toRate(48 / 1.001)).toEqual(RATE_47_952)
    // The project file's three-decimal name, as `normalizeOptionalFps` stores it.
    expect(toRate(47.952)).toEqual(RATE_47_952)
  })

  it('maps the decimal names the project file and the probe write', () => {
    const cases = [
      { value: 23.976, rate: RATE_23_976 },
      { value: 29.97, rate: RATE_29_97 },
      { value: 59.94, rate: RATE_59_94 },
      { value: 119.88, rate: RATE_119_88 },
    ]

    for (const row of cases) {
      expect(toRate(row.value)).toEqual(row.rate)
    }
  })

  it('keeps an integer rate as itself', () => {
    for (const fps of [24, 25, 30, 50, 60, 120, 240, 1000]) {
      expect(toRate(fps)).toEqual({ num: fps, den: 1 })
    }
  })

  it('falls back to millionths, reduced, for a value it has no fraction for', () => {
    // 47.952 used to be the example here; it is 48 fps NTSC (48000/1001) and now known (T10).
    expect(toRate(47.95)).toEqual({ num: 959, den: 20 })
    expect(toRate(47.5)).toEqual({ num: 95, den: 2 })
    expect(toRate(0.5)).toEqual({ num: 1, den: 2 })
    expect(toRate(29.9701)).toEqual({ num: 299701, den: 10000 })
  })

  it('reduces an unreduced Rate it is given', () => {
    expect(toRate({ num: 120000, den: 2002 })).toEqual(RATE_59_94)
    expect(toRate({ num: 50, den: 2 })).toEqual({ num: 25, den: 1 })
  })

  it('does not snap 29.9701 to the nearest fractional rate', () => {
    expect(ratesEqual(toRate(29.9701), RATE_29_97)).toBe(false)
    expect(rateValue(toRate(29.9701))).toBe(29.9701)
  })

  it('throws a RangeError naming a value that is not a frame rate', () => {
    expect(() => toRate(0)).toThrowError(RangeError)
    expect(() => toRate(0)).toThrowError(/0/)
    expect(() => toRate(-1)).toThrowError(RangeError)
    expect(() => toRate(-1)).toThrowError(/-1/)
    expect(() => toRate(Number.NaN)).toThrowError(RangeError)
    expect(() => toRate(Number.NaN)).toThrowError(/NaN/)
    expect(() => toRate(Number.POSITIVE_INFINITY)).toThrowError(RangeError)
    expect(() => toRate(Number.POSITIVE_INFINITY)).toThrowError(/Infinity/)
    expect(() => toRate(Number.NEGATIVE_INFINITY)).toThrowError(/Infinity/)
  })

  it('throws a RangeError naming a Rate that breaks the integer invariant', () => {
    expect(() => toRate({ num: 60000, den: 0 })).toThrowError(RangeError)
    expect(() => toRate({ num: 60000, den: 0 })).toThrowError(/60000\/0/)
    expect(() => toRate({ num: 1.5, den: 1 })).toThrowError(/1\.5\/1/)
    expect(() => toRate({ num: -60, den: 1 })).toThrowError(/-60\/1/)
  })

  it('throws a RangeError for a value millionths cannot hold', () => {
    expect(() => toRate(1e-9)).toThrowError(RangeError)
    expect(() => toRate(1e-9)).toThrowError(/1e-9/)
    expect(() => toRate(1e10)).toThrowError(RangeError)
    expect(() => toRate(1e10)).toThrowError(/10000000000/)
  })
})

describe('rateValue', () => {
  it('is num / den, one rounding', () => {
    expect(rateValue(RATE_59_94)).toBe(60000 / 1001)
    expect(rateValue({ num: 60, den: 1 })).toBe(60)
    expect(rateValue({ num: 1, den: 2 })).toBe(0.5)
    expect(rateValue(RATE_119_88)).toBe(120000 / 1001)
  })
})

describe('ratesEqual', () => {
  it('compares by cross-multiplication, so unreduced fractions are equal', () => {
    const equalPairs: Array<[Rate, Rate]> = [
      [RATE_59_94, RATE_59_94],
      [
        { num: 60, den: 1 },
        { num: 60000, den: 1000 },
      ],
      [RATE_59_94, { num: 120000, den: 2002 }],
      [RATE_23_976, { num: 48000, den: 2002 }],
      [toRate(60 / 1.001), RATE_59_94],
    ]

    for (const [a, b] of equalPairs) {
      expect(ratesEqual(a, b)).toBe(true)
      expect(ratesEqual(b, a)).toBe(true)
    }
  })

  it('tells different rates apart', () => {
    const differentPairs: Array<[Rate, Rate]> = [
      [RATE_59_94, { num: 60, den: 1 }],
      [RATE_23_976, RATE_29_97],
      [
        { num: 25, den: 1 },
        { num: 50, den: 3 },
      ],
      [
        { num: 24, den: 1 },
        { num: 25, den: 1 },
      ],
    ]

    for (const [a, b] of differentPairs) {
      expect(ratesEqual(a, b)).toBe(false)
      expect(ratesEqual(b, a)).toBe(false)
    }
  })
})

describe('frameToSeconds and secondsToFrame', () => {
  it('converts frames exactly where the fraction divides the numerator', () => {
    const cases = [
      { rate: RATE_59_94, frame: 0, seconds: 0 },
      { rate: RATE_59_94, frame: 1, seconds: 1001 / 60000 },
      { rate: RATE_59_94, frame: 60000, seconds: 1001 },
      { rate: RATE_23_976, frame: 24000, seconds: 1001 },
      { rate: { num: 24, den: 1 }, frame: 24, seconds: 1 },
      { rate: { num: 25, den: 1 }, frame: 5, seconds: 0.2 },
      { rate: { num: 1, den: 2 }, frame: 1, seconds: 2 },
    ]

    for (const row of cases) {
      expect(frameToSeconds(row.rate, row.frame)).toBe(row.seconds)
    }
  })

  it('finds the frame that contains a time', () => {
    const cases = [
      { rate: RATE_59_94, seconds: 0, frame: 0 },
      { rate: RATE_59_94, seconds: 1001, frame: 60000 },
      { rate: RATE_29_97, seconds: 1001, frame: 30000 },
      { rate: { num: 25, den: 1 }, seconds: 0.2, frame: 5 },
      { rate: { num: 24, den: 1 }, seconds: 1, frame: 24 },
    ]

    for (const row of cases) {
      expect(secondsToFrame(row.rate, row.seconds)).toBe(row.frame)
    }
  })

  it('round-trips every frame of the first 1,000 at every rate', () => {
    for (const rate of [...RATES, ...LEGACY_RATES]) {
      for (let frame = 0; frame <= 1_000; frame += 1) {
        expect(secondsToFrame(rate, frameToSeconds(rate, frame))).toBe(frame)
      }
    }
  })
})

describe('formatRate', () => {
  it('labels the fractional rates with the names the UI knows', () => {
    expect(formatRate(RATE_59_94)).toBe('59.94')
    expect(formatRate(RATE_29_97)).toBe('29.97')
    expect(formatRate(RATE_23_976)).toBe('23.976')
    expect(formatRate(RATE_119_88)).toBe('119.88')
  })

  it('prints an integer rate without decimals', () => {
    const integerRates = [...RATES, ...LEGACY_RATES].filter((rate) => rate.den === 1)

    for (const rate of integerRates) {
      expect(formatRate(rate)).toBe(`${rateValue(rate)}`)
    }
  })

  it('rounds a rate with no name to three decimals and drops trailing zeros', () => {
    expect(formatRate({ num: 1, den: 2 })).toBe('0.5')
    expect(formatRate({ num: 5994, den: 125 })).toBe('47.952')
  })
})
