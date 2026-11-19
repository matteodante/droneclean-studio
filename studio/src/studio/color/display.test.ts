// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { applyShoulder, srgbDecode, srgbEncode, transform } from './display'
import { DLOG_SHOULDER } from './profiles'
import type { ColorProfileId, Rgb } from './types'

const TEN_BIT_MAX = 1023

const PROFILES = ['dlog-m', 'dlog'] as const satisfies readonly ColorProfileId[]

/**
 * The neutral axis of the fitted D-Log M transform at the LUT's 33 grid codes, as fractions
 * of 1023. Generated from the design's numbers (curve, matrix, sRGB transfer) when the slice
 * was built; it is a regression guard, not evidence of the fit's accuracy: the fit's own
 * measured error against DJI's LUT is rms 5.44 / max 9.55 levels on that axis, and mean 5.16 /
 * p99 12.97 / max 60.39 on eight frames of clip 0020 (design 5.1, section 5).
 */
const DLOGM_GREYS = [
  0.0, 0.001477373111, 0.009704094981, 0.029178844828, 0.060337362559, 0.093425623677,
  0.127361519901, 0.161995406536, 0.19721013807, 0.232907873191, 0.269002646133, 0.305415827481,
  0.342073163807, 0.378902736488, 0.415833480896, 0.452794057987, 0.489711950871, 0.526512704197,
  0.563119250559, 0.599451283847, 0.635424648833, 0.67095072171, 0.705935758959, 0.740280192663,
  0.773877849392, 0.806615067247, 0.838369681428, 0.86900984236, 0.898392621611, 0.926362348464,
  0.952748602868, 0.977363766533, 1.0,
] as const

/**
 * The neutral axis of the D-Log transform (published decode, published matrix, fitted
 * shoulder, sRGB transfer) at the same 33 codes. The shoulder keeps the transform from
 * clipping at code 0.585; with it the axis differs from DJI's D-Log LUT by rms 23.45 and max
 * 37.95 levels of 1023, against mean 68.5 / max 248 without it (design 5.1, section 5 M3).
 */
const DLOG_GREYS = [
  0.0, 0.0, 0.0, 0.001472614999, 0.053810713159, 0.090574358841, 0.12404867987, 0.157702200157,
  0.192677846947, 0.229674761976, 0.269164358979, 0.311456011921, 0.356706446064, 0.404903655135,
  0.455841097738, 0.50909593647, 0.564026891194, 0.619808051557, 0.675510610526, 0.730232538967,
  0.783258815443, 0.834219673141, 0.883210917278, 0.930852407109, 0.978281950997, 1.0, 1.0, 1.0,
  1.0, 1.0, 1.0, 1.0, 1.0,
] as const

/** Ten input triples, including the cube's corners and saturated colours where the matrix clips. */
const INPUT_COLOURS: readonly Rgb[] = [
  [0, 0, 0],
  [1, 1, 1],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.25, 0.5, 0.75],
  [0.8, 0.2, 0.5],
  [0.1, 0.9, 0.3],
  [0.44, 0.44, 0.44],
  [0.65, 0.32, 0.18],
]

const DLOGM_COLOURS: readonly Rgb[] = [
  [0.0, 0.0, 0.0],
  [1.0, 1.0, 1.0],
  [1.0, 0.0, 0.0],
  [0.0, 1.0, 0.0],
  [0.130876292119, 0.0, 1.0],
  [0.0, 0.490811711685, 0.856521313286],
  [0.93588824952, 0.0, 0.525576611735],
  [0.0, 0.966177607346, 0.0],
  [0.418790180275, 0.418790180275, 0.418790180275],
  [0.741025305341, 0.212920515511, 0.0],
]

const DLOG_COLOURS: readonly Rgb[] = [
  [0.0, 0.0, 0.0],
  [1.0, 1.0, 1.0],
  [1.0, 0.0, 0.0],
  [0.0, 1.0, 0.0],
  [0.0, 0.0, 1.0],
  [0.0, 0.0, 1.0],
  [1.0, 0.0, 0.483943282424],
  [0.0, 1.0, 0.0],
  [0.460023345523, 0.460023345523, 0.460023345523],
  [0.91053980476, 0.0, 0.0],
]

/**
 * DJI's measured D-Log M grey axis, from design 5.1 section 5 M3: its output minus the input
 * code, in levels of 1023, at six codes. Six published numbers, not a table from DJI's LUT;
 * the whole-transform residual is 9.55 levels max, and these coarse points land within 7.1.
 */
const PUBLISHED_DLOG_M_GREY_DEVIATIONS = [
  { code: 0.125, levels: -73 },
  { code: 0.25, levels: -59 },
  { code: 0.5, levels: -13 },
  { code: 0.75, levels: 25 },
  { code: 0.875, levels: 30 },
  { code: 1, levels: 0 },
]

function neutral(code: number): Rgb {
  const value = code / TEN_BIT_MAX
  return [value, value, value]
}

describe('the sRGB transfer function', () => {
  it('pins its published anchors', () => {
    expect(srgbEncode(0)).toBe(0)
    expect(srgbEncode(1)).toBeCloseTo(1, 12)
    expect(srgbEncode(0.0031308)).toBeCloseTo(0.04045, 4)
    expect(srgbEncode(0.18)).toBeCloseTo(0.46136, 4)
    expect(srgbDecode(0)).toBe(0)
    expect(srgbDecode(1)).toBe(1)
    expect(srgbDecode(0.04045)).toBeCloseTo(0.0031308, 7)
  })

  it('round-trips every 10-bit code', () => {
    const failures: string[] = []
    for (let code = 0; code <= TEN_BIT_MAX; code += 1) {
      const value = code / TEN_BIT_MAX
      const back = srgbDecode(srgbEncode(value))
      if (Math.abs(back - value) > 1e-9) {
        failures.push(`${code}: ${back}`)
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })

  it('clamps input outside 0..1', () => {
    expect(srgbEncode(-1)).toBe(0)
    expect(srgbEncode(2)).toBe(1)
    expect(srgbDecode(-1)).toBe(0)
    expect(srgbDecode(2)).toBe(1)
  })
})

describe('the extended Reinhard shoulder', () => {
  it('maps 0 to 0 and its white point to 1', () => {
    expect(applyShoulder(0, DLOG_SHOULDER)).toBe(0)
    expect(applyShoulder(DLOG_SHOULDER.white / DLOG_SHOULDER.exposure, DLOG_SHOULDER)).toBeCloseTo(
      1,
      12,
    )
  })

  it('is increasing and has no pole below zero: negatives clamp to 0', () => {
    let previous = applyShoulder(0, DLOG_SHOULDER)
    for (let step = 1; step <= 1000; step += 1) {
      const value = applyShoulder(step / 100, DLOG_SHOULDER)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
    expect(applyShoulder(-1, DLOG_SHOULDER)).toBe(0)
    expect(applyShoulder(-100, DLOG_SHOULDER)).toBe(0)
  })
})

describe('transform', () => {
  it('passes a clip with no profile through untouched', () => {
    const code: Rgb = [0.123, 0.456, 0.789]
    expect(transform(code, 'none')).toBe(code)
  })

  it('maps the ends to black and white', () => {
    for (const profile of PROFILES) {
      expect(transform([0, 0, 0], profile)).toEqual([0, 0, 0])
      for (const channel of transform([1, 1, 1], profile)) {
        expect(channel).toBeCloseTo(1, 12)
      }
    }
  })

  it('pins the fitted D-Log M neutral axis (regression guard)', () => {
    const failures: string[] = []
    for (let index = 0; index < DLOGM_GREYS.length; index += 1) {
      const code = index / (DLOGM_GREYS.length - 1)
      const output = transform([code, code, code], 'dlog-m')[0]
      const expected = DLOGM_GREYS[index]!
      if (Math.abs(output - expected) > 5e-9) {
        failures.push(`${index}: ${output} vs ${expected}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('pins the D-Log neutral axis with the shoulder (regression guard)', () => {
    const failures: string[] = []
    for (let index = 0; index < DLOG_GREYS.length; index += 1) {
      const code = index / (DLOG_GREYS.length - 1)
      const output = transform([code, code, code], 'dlog')[0]
      const expected = DLOG_GREYS[index]!
      if (Math.abs(output - expected) > 5e-9) {
        failures.push(`${index}: ${output} vs ${expected}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('pins ten colours per profile, matrix and clipping included', () => {
    const fixtures: readonly (readonly Rgb[])[] = [DLOGM_COLOURS, DLOG_COLOURS]
    const failures: string[] = []
    for (let profileIndex = 0; profileIndex < PROFILES.length; profileIndex += 1) {
      const profile = PROFILES[profileIndex]!
      const fixture = fixtures[profileIndex]!
      for (let colourIndex = 0; colourIndex < INPUT_COLOURS.length; colourIndex += 1) {
        const output = transform(INPUT_COLOURS[colourIndex]!, profile)
        const expected = fixture[colourIndex]!
        for (let channel = 0; channel < 3; channel += 1) {
          if (Math.abs(output[channel]! - expected[channel]!) > 5e-9) {
            failures.push(
              `${profile} ${colourIndex} ${channel}: ${output[channel]} vs ${expected[channel]}`,
            )
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it("stays inside the design's fit bounds at DJI's six published D-Log M grey codes", () => {
    const differences: number[] = []
    const failures: string[] = []
    for (const point of PUBLISHED_DLOG_M_GREY_DEVIATIONS) {
      const output = transform([point.code, point.code, point.code], 'dlog-m')[0]
      const deviation = (output - point.code) * TEN_BIT_MAX
      const difference = Math.abs(deviation - point.levels)
      differences.push(difference)
      if (difference > 8) {
        failures.push(`${point.code}: ${deviation.toFixed(2)} vs ${point.levels}`)
      }
    }
    expect(failures).toEqual([])
    const rms = Math.sqrt(
      differences.reduce((sum, value) => sum + value * value, 0) / differences.length,
    )
    expect(rms).toBeLessThanOrEqual(5.5)
    expect(Math.max(...differences)).toBeLessThanOrEqual(10)
  })

  it('keeps 857 distinct levels on the bench ramp: monotone, no step over 2', () => {
    const levels: number[] = []
    for (let code = 64; code <= 940; code += 1) {
      levels.push(Math.round(transform(neutral(code), 'dlog-m')[0] * TEN_BIT_MAX))
    }
    expect(new Set(levels).size).toBe(857)
    for (let index = 1; index < levels.length; index += 1) {
      const step = levels[index]! - levels[index - 1]!
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThanOrEqual(2)
    }
  })

  it('D-Log keeps highlights to about code 0.764 instead of clipping at 0.585', () => {
    let firstFull = -1
    for (let code = 0; code <= TEN_BIT_MAX; code += 1) {
      if (transform(neutral(code), 'dlog')[0] >= 1 - 1e-12) {
        firstFull = code
        break
      }
    }
    expect(firstFull).toBeGreaterThan(0.76 * TEN_BIT_MAX)
    expect(firstFull).toBeLessThan(0.77 * TEN_BIT_MAX)
  })

  it('has no clamping surprises at the 10-bit edges', () => {
    const failures: string[] = []
    for (const profile of PROFILES) {
      for (const code of [0, 1, 1022, 1023]) {
        for (const channel of transform(neutral(code), profile)) {
          if (!(Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
            failures.push(`${profile} ${code}: ${channel}`)
          }
        }
      }
    }
    expect(failures).toEqual([])
    expect(transform(neutral(1), 'dlog-m')[0]).toBeGreaterThan(0)
    expect(transform(neutral(1), 'dlog')).toEqual([0, 0, 0])
    expect(transform(neutral(1022), 'dlog-m')[0]).toBeLessThan(1)
  })
})
