// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { halfOutOfRange, halfToFloat, halfToUnorm16, unpackHalfRows } from './half-float'

describe('half floats', () => {
  it('decodes the values the float path writes', () => {
    expect(halfToFloat(0x0000)).toBe(0)
    expect(halfToFloat(0x3c00)).toBe(1)
    expect(halfToFloat(0x3800)).toBe(0.5)
    expect(halfToFloat(0x0001)).toBe(2 ** -24) // the smallest subnormal
    expect(halfToFloat(0xbc00)).toBe(-1)
    expect(halfToFloat(0x7c00)).toBe(Infinity)
    expect(halfToFloat(0x7e00)).toBeNaN()
  })

  it('gives every 10-bit code its own 16-bit value (what the ramp case counts)', () => {
    const write = (value: number): number => {
      // The nearest half float of `value`, by search: the test must not share the decoder's mistakes
      let best = 0
      for (let bits = 0; bits < 0x3c00; bits++) {
        if (Math.abs(halfToFloat(bits) - value) < Math.abs(halfToFloat(best) - value)) best = bits
      }
      return best
    }
    const seen = new Set<number>()
    for (let code = 64; code <= 940; code++) seen.add(halfToUnorm16(write(code / 1023)))
    expect(seen.size).toBe(877)
  })

  it('clamps to 0..1 and counts what was clamped', () => {
    expect(halfToUnorm16(0xbc00)).toBe(0)
    expect(halfToUnorm16(0x7e00)).toBe(0)
    expect(halfToUnorm16(0x3c00)).toBe(65535)
    expect(halfToUnorm16(0x4000)).toBe(65535)
    expect(halfToUnorm16(0x3800)).toBe(32768)
    expect(halfOutOfRange(0x3c00)).toBe(false)
    expect(halfOutOfRange(0x0000)).toBe(false)
    expect(halfOutOfRange(0x4000)).toBe(true)
    expect(halfOutOfRange(0xbc00)).toBe(true)
    expect(halfOutOfRange(0x7e00)).toBe(true)
  })

  it('reads rows that are padded to the copy alignment', () => {
    const bytesPerRow = 32 // 2 pixels * 8 bytes = 16, padded to 32
    const data = new Uint8Array(bytesPerRow * 2)
    const view = new DataView(data.buffer)
    const pixels = [
      [0x3c00, 0x3800, 0x0000, 0x3c00],
      [0x3c00, 0x3c00, 0x3c00, 0x3c00],
      [0x0000, 0x0000, 0x0000, 0x3c00],
      [0x4000, 0x3800, 0x0000, 0x3c00],
    ]
    pixels.forEach((pixel, index) => {
      const row = Math.floor(index / 2)
      const x = index % 2
      pixel.forEach((bits, channel) => view.setUint16(row * bytesPerRow + x * 8 + channel * 2, bits, true))
    })
    const { rgba16, outOfRange } = unpackHalfRows(data, 2, 2, bytesPerRow)
    expect([...rgba16]).toEqual([
      65535, 32768, 0, 65535, 65535, 65535, 65535, 65535, 0, 0, 0, 65535, 65535, 32768, 0, 65535,
    ])
    expect(outOfRange).toBe(1)
  })
})
