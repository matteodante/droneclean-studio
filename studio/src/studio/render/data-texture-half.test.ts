import { describe, expect, it } from 'vite-plus/test'
import { floatToHalf, tableToHalf } from './data-texture-half'

/** The float a half-float word stands for */
function halfToFloat(word: number): number {
  const sign = word & 0x8000 ? -1 : 1
  const exponent = (word >> 10) & 0x1f
  const mantissa = word & 0x3ff
  if (exponent === 0) return sign * mantissa * 2 ** -24
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15)
}

describe('floatToHalf', () => {
  it('writes the exact half-float words of known values', () => {
    expect(floatToHalf(0)).toBe(0x0000)
    expect(floatToHalf(1)).toBe(0x3c00)
    expect(floatToHalf(0.5)).toBe(0x3800)
    expect(floatToHalf(-2)).toBe(0xc000)
    expect(floatToHalf(65504)).toBe(0x7bff)
    expect(floatToHalf(1e9)).toBe(0x7bff)
    expect(floatToHalf(2 ** -24)).toBe(0x0001)
  })

  it('keeps a unit-range value within a half-float step, so 1024 levels stay distinct', () => {
    const seen = new Set<number>()
    for (let code = 0; code < 1024; code++) {
      const value = code / 1023
      const back = halfToFloat(floatToHalf(value))
      expect(Math.abs(back - value)).toBeLessThanOrEqual(2 ** -12)
      seen.add(floatToHalf(value))
    }
    expect(seen.size).toBe(1024)
  })
})

describe('tableToHalf', () => {
  it('reads bytes as 0..1 and floats as they are', () => {
    expect(Array.from(tableToHalf(new Uint8Array([0, 255])))).toEqual([0x0000, 0x3c00])
    expect(Array.from(tableToHalf(new Float32Array([0.5, 1])))).toEqual([0x3800, 0x3c00])
  })
})
