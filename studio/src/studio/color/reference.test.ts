// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { srgbEncode, transform } from './display'
import { decodeDLog, decodeDLogM, encodeDLog, encodeDLogM } from './log'
import type { ColorProfileId, Rgb } from './types'

/*
 * The float64 reference of design 5.1. Every constant below is copied from the design and the
 * 2017 white paper, and every formula is written out again here instead of being imported, so
 * changing a module constant or an algebraic step has to fail this file. All arithmetic is
 * float64: a TypeScript number is a double.
 */

const DLOG = {
  linearThreshold: 0.0078,
  slope: 6.025,
  offset: 0.0929,
  logScale: 0.256663,
  logGain: 0.9892,
  logOffset: 0.0108,
  bias: 0.584555,
  codeThreshold: 0.14,
  exponentScale: 3.89616,
  exponentOffset: 2.27752,
} as const

const DLOG_M = { p: 2.715683, q: 5.587935, b: 0.285082 } as const
const DLOG_SHOULDER = { exposure: 0.808, white: 4.08 } as const

const D_GAMUT_TO_REC709 = [
  1.6746, -0.5797, -0.0949, -0.0981, 1.334, -0.2359, -0.041, -0.243, 1.284,
] as const

const DLOG_M_TO_REC709 = [
  1.3312, -0.3467, 0.0155, -0.0811, 1.1176, -0.0365, -0.0577, -0.3179, 1.3756,
] as const

const PROFILES = ['dlog-m', 'dlog'] as const satisfies readonly ColorProfileId[]
const TEN_BIT_MAX = 1023

function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function referenceDLogEncode(linear: number): number {
  const value = Math.max(linear, 0)
  if (value <= DLOG.linearThreshold) {
    return DLOG.slope * value + DLOG.offset
  }
  return DLOG.logScale * Math.log10(DLOG.logGain * value + DLOG.logOffset) + DLOG.bias
}

function referenceDLogDecode(code: number): number {
  const value = clampUnit(code)
  if (value <= DLOG.codeThreshold) {
    return (value - DLOG.offset) / DLOG.slope
  }
  return (10 ** (DLOG.exponentScale * value - DLOG.exponentOffset) - DLOG.logOffset) / DLOG.logGain
}

function referenceDLogMDecode(code: number): number {
  const value = clampUnit(code)
  return (value ** DLOG_M.p - DLOG_M.b * value ** DLOG_M.q) / (1 - DLOG_M.b)
}

function referenceDLogMEncode(linear: number): number {
  if (linear <= 0) {
    return 0
  }
  if (linear >= 1) {
    return 1
  }
  let low = 0
  let high = 1
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2
    if (referenceDLogMDecode(middle) < linear) {
      low = middle
    } else {
      high = middle
    }
  }
  return (low + high) / 2
}

function referenceSrgbEncode(linear: number): number {
  const value = clampUnit(linear)
  return value < 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
}

function referenceShoulder(linear: number): number {
  const exposed = Math.max(linear, 0) * DLOG_SHOULDER.exposure
  return (exposed * (1 + exposed / DLOG_SHOULDER.white ** 2)) / (1 + exposed)
}

function referenceMatrix(
  matrix: readonly [number, number, number, number, number, number, number, number, number],
  rgb: Rgb,
): Rgb {
  return [
    matrix[0] * rgb[0] + matrix[1] * rgb[1] + matrix[2] * rgb[2],
    matrix[3] * rgb[0] + matrix[4] * rgb[1] + matrix[5] * rgb[2],
    matrix[6] * rgb[0] + matrix[7] * rgb[1] + matrix[8] * rgb[2],
  ]
}

function referenceTransform(code: Rgb, profile: ColorProfileId): Rgb {
  if (profile === 'none') {
    return code
  }
  const isLog = profile === 'dlog'
  const decode = isLog ? referenceDLogDecode : referenceDLogMDecode
  const matrix = isLog ? D_GAMUT_TO_REC709 : DLOG_M_TO_REC709
  const linear = [decode(code[0]), decode(code[1]), decode(code[2])] as const
  const mapped = referenceMatrix(matrix, linear)
  const toned: Rgb = isLog
    ? [referenceShoulder(mapped[0]), referenceShoulder(mapped[1]), referenceShoulder(mapped[2])]
    : mapped
  return [
    referenceSrgbEncode(toned[0]),
    referenceSrgbEncode(toned[1]),
    referenceSrgbEncode(toned[2]),
  ]
}

function neutral(code: number): Rgb {
  const value = code / TEN_BIT_MAX
  return [value, value, value]
}

let seed = 987654321
function random(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

describe('the float64 reference agrees with the module', () => {
  it('on both log decode curves, every 10-bit code', () => {
    const failures: string[] = []
    for (let code = 0; code <= TEN_BIT_MAX; code += 1) {
      const value = code / TEN_BIT_MAX
      if (Math.abs(decodeDLog(value) - referenceDLogDecode(value)) > 1e-15) {
        failures.push(`D-Log ${code}`)
      }
      if (Math.abs(decodeDLogM(value) - referenceDLogMDecode(value)) > 1e-15) {
        failures.push(`D-Log M ${code}`)
      }
      if (Math.abs(srgbEncode(value) - referenceSrgbEncode(value)) > 1e-15) {
        failures.push(`sRGB ${code}`)
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })

  it('on the D-Log encode, including the published anchors', () => {
    const values = [0, 0.0001, 0.0078, 0.0078001, 0.18, 0.9, 1, 7.56, 42]
    for (const value of values) {
      expect(encodeDLog(value)).toBe(referenceDLogEncode(value))
    }
    expect(Math.abs(referenceDLogEncode(0) * TEN_BIT_MAX - 95)).toBeLessThan(1)
    expect(Math.abs(referenceDLogEncode(0.18) * TEN_BIT_MAX - 408)).toBeLessThan(1)
    expect(Math.abs(referenceDLogEncode(0.9) * TEN_BIT_MAX - 586)).toBeLessThan(1)
    expect(referenceDLogEncode(42)).toBeCloseTo(1, 4)
  })

  it('on the D-Log M inverse, every 10-bit code', () => {
    const failures: string[] = []
    for (let code = 0; code <= TEN_BIT_MAX; code += 1) {
      const value = code / TEN_BIT_MAX
      if (Math.abs(encodeDLogM(value) - referenceDLogMEncode(value)) > 1e-12) {
        failures.push(`${code}`)
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })

  it('on the whole transform, every 10-bit neutral code and 4096 random colours', () => {
    const failures: string[] = []
    for (const profile of PROFILES) {
      for (let code = 0; code <= TEN_BIT_MAX; code += 1) {
        const input = neutral(code)
        const actual = transform(input, profile)
        const expected = referenceTransform(input, profile)
        for (let channel = 0; channel < 3; channel += 1) {
          if (Math.abs(actual[channel]! - expected[channel]!) > 1e-12) {
            failures.push(`${profile} neutral ${code} channel ${channel}`)
          }
        }
      }
      for (let sample = 0; sample < 4096; sample += 1) {
        const input: Rgb = [random(), random(), random()]
        const actual = transform(input, profile)
        const expected = referenceTransform(input, profile)
        for (let channel = 0; channel < 3; channel += 1) {
          if (Math.abs(actual[channel]! - expected[channel]!) > 1e-12) {
            failures.push(`${profile} sample ${sample} channel ${channel}`)
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })
})

describe('properties across the code range', () => {
  it('is monotone on neutral light for both profiles', () => {
    const failures: string[] = []
    for (const profile of PROFILES) {
      let previous = transform(neutral(0), profile)[0]
      for (let code = 1; code <= TEN_BIT_MAX; code += 1) {
        const value = transform(neutral(code), profile)[0]
        if (value < previous) {
          failures.push(`${profile} ${code}`)
        }
        previous = value
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })

  it('has no NaN or infinity anywhere in 0..1023, and no value outside 0..1', () => {
    const failures: string[] = []
    for (const profile of PROFILES) {
      for (let code = 0; code <= TEN_BIT_MAX; code += 1) {
        for (const channel of transform(neutral(code), profile)) {
          if (!(Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
            failures.push(`${profile} neutral ${code}: ${channel}`)
          }
        }
      }
      for (let red = 0; red <= 16; red += 1) {
        for (let green = 0; green <= 16; green += 1) {
          for (let blue = 0; blue <= 16; blue += 1) {
            const input: Rgb = [red / 16, green / 16, blue / 16]
            for (const channel of transform(input, profile)) {
              if (!(Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
                failures.push(`${profile} ${red},${green},${blue}: ${channel}`)
              }
            }
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })

  it('maps black to 0 and white to 1', () => {
    for (const profile of PROFILES) {
      expect(transform([0, 0, 0], profile)).toEqual([0, 0, 0])
      for (const channel of transform([1, 1, 1], profile)) {
        expect(channel).toBeCloseTo(1, 12)
      }
    }
  })
})
