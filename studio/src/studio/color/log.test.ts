// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { decodeDLog, decodeDLogM, encodeDLog, encodeDLogM } from './log'

const CODE_MAX = 1023

describe('D-Log, the published 2017 curve', () => {
  it("pins the white paper's 10-bit anchors", () => {
    const anchors = [
      { linear: 0, code: 95 },
      { linear: 0.18, code: 408 },
      { linear: 0.9, code: 586 },
    ]
    for (const anchor of anchors) {
      expect(Math.abs(encodeDLog(anchor.linear) * CODE_MAX - anchor.code)).toBeLessThan(1)
    }
  })

  it('encodes 4200 % reflectance to 1.0, and 7.8 stops above 18 % just under it', () => {
    expect(encodeDLog(42)).toBeCloseTo(1, 5)
    const sevenPointEightStops = 0.18 * 2 ** 7.8
    expect(encodeDLog(sevenPointEightStops)).toBeGreaterThan(0.99)
    expect(encodeDLog(sevenPointEightStops)).toBeLessThan(1)
  })

  it('takes the linear branch up to 0.0078 and the log branch above it', () => {
    expect(encodeDLog(0)).toBe(0.0929)
    expect(encodeDLog(0.0078)).toBeCloseTo(6.025 * 0.0078 + 0.0929, 12)
    expect(encodeDLog(0.0078001)).toBeGreaterThan(6.025 * 0.0078 + 0.0929)
    expect(encodeDLog(-1)).toBe(0.0929)
  })

  it('decodes the two published branches and clamps the code to its 10-bit domain', () => {
    expect(decodeDLog(0)).toBeCloseTo(-0.0929 / 6.025, 12)
    expect(decodeDLog(0.14)).toBeCloseTo((0.14 - 0.0929) / 6.025, 12)
    expect(decodeDLog(2.27752 / 3.89616)).toBeCloseTo(1, 12)
    expect(decodeDLog(1)).toBeCloseTo(41.9994, 3)
    expect(decodeDLog(-1)).toBe(decodeDLog(0))
    expect(decodeDLog(2)).toBe(decodeDLog(1))
  })

  it('round-trips linear light through encode and decode', () => {
    const failures: string[] = []
    for (let step = 0; step <= 4200; step += 1) {
      const linear = step / 100
      const back = decodeDLog(encodeDLog(linear))
      if (Math.abs(back - linear) > 1e-3) {
        failures.push(`${linear} -> ${back}`)
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })

  it('round-trips every code above the published toe', () => {
    const failures: string[] = []
    for (let code = 96; code <= CODE_MAX; code += 1) {
      const value = code / CODE_MAX
      const back = encodeDLog(decodeDLog(value))
      if (Math.abs(back - value) > 1e-6) {
        failures.push(`${code}: ${back}`)
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })
})

describe('D-Log M, the fitted curve', () => {
  it('maps the ends to 0 and 1 and stays inside the unit interval', () => {
    expect(decodeDLogM(0)).toBe(0)
    expect(decodeDLogM(1)).toBe(1)
    const failures: number[] = []
    for (let code = 0; code <= CODE_MAX; code += 1) {
      const value = decodeDLogM(code / CODE_MAX)
      if (!(value >= 0 && value <= 1)) {
        failures.push(code)
      }
    }
    expect(failures).toEqual([])
  })

  it('is strictly increasing on every 10-bit code', () => {
    const failures: number[] = []
    let previous = decodeDLogM(0)
    for (let code = 1; code <= CODE_MAX; code += 1) {
      const value = decodeDLogM(code / CODE_MAX)
      if (!(value > previous)) {
        failures.push(code)
      }
      previous = value
    }
    expect(failures).toEqual([])
  })

  it('clamps the code to its 10-bit domain', () => {
    expect(decodeDLogM(-1)).toBe(0)
    expect(decodeDLogM(2)).toBe(1)
  })

  it('inverts the fitted curve', () => {
    expect(encodeDLogM(-1)).toBe(0)
    expect(encodeDLogM(2)).toBe(1)
    const failures: string[] = []
    for (let code = 0; code <= CODE_MAX; code += 1) {
      const target = code / CODE_MAX
      const back = encodeDLogM(decodeDLogM(target))
      if (Math.abs(back - target) > 1e-12) {
        failures.push(`${code}: ${back}`)
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  })

  it('is strictly increasing as an encode too', () => {
    const failures: number[] = []
    let previous = encodeDLogM(0)
    for (let code = 1; code <= CODE_MAX; code += 1) {
      const value = encodeDLogM(code / CODE_MAX)
      if (!(value > previous)) {
        failures.push(code)
      }
      previous = value
    }
    expect(failures).toEqual([])
  })
})
