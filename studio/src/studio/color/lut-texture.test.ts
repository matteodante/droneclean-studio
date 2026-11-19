// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { parseCube, type CubeLut3D } from './cube'
import {
  LUT_TEXTURE_BYTES_PER_TEXEL,
  LUT_TEXTURE_FORMAT,
  createLutTextureLayout,
  encodeLutTexture,
  floatToHalfBits,
  halfBitsToFloat,
  type LookPass,
} from './lut-texture'

/** A LUT of `data` at `size`, with the unit domain. */
function lut(size: number, data: Float32Array): CubeLut3D {
  return { size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }
}

describe('floatToHalfBits', () => {
  it('writes the IEEE 754 binary16 patterns of a value table', () => {
    const cases: readonly (readonly [number, number])[] = [
      [0, 0x0000],
      [-0, 0x8000],
      [0.5, 0x3800],
      [0.75, 0x3a00],
      [1, 0x3c00],
      [2, 0x4000],
      [0.25, 0x3400],
      [0.1, 0x2e66],
      [1 / 3, 0x3555],
      [0.9, 0x3b33],
      [0.999, 0x3bfe],
      [-0.5, 0xb800],
      // The smallest normal, a subnormal and a value too small to keep.
      [0.00006103515625, 0x0400],
      [1e-5, 0x00a8],
      [1e-8, 0x0000],
      // Ties go to the even mantissa: 1 + 2^-11 is halfway between 1 and 1 + 2^-10.
      [1 + 2 ** -11, 0x3c00],
      [1 + 3 * 2 ** -11, 0x3c02],
      [65504, 0x7bff],
      [65520, 0x7c00],
    ]
    for (const [value, bits] of cases) {
      expect(floatToHalfBits(value), `${value}`).toBe(bits)
    }
  })

  it('writes infinity and NaN as halves', () => {
    expect(floatToHalfBits(Infinity)).toBe(0x7c00)
    expect(floatToHalfBits(-Infinity)).toBe(0xfc00)
    expect(floatToHalfBits(NaN)).toBe(0x7e00)
    expect(Number.isNaN(halfBitsToFloat(0x7e00))).toBe(true)
  })
})

describe('halfBitsToFloat', () => {
  it('reads the value of a half-float bit pattern', () => {
    const cases: readonly (readonly [number, number])[] = [
      [0x0000, 0],
      [0x8000, -0],
      [0x3800, 0.5],
      [0x3c00, 1],
      [0x4000, 2],
      [0x2e66, 0.0999755859375],
      [0x3555, 0.333251953125],
      [0x0400, 0.00006103515625],
      [0x00a8, 1.0013580322265625e-5],
      [0x7bff, 65504],
    ]
    for (const [bits, value] of cases) {
      expect(halfBitsToFloat(bits), `0x${bits.toString(16)}`).toBe(value)
    }
  })

  it('round-trips a table of values through its half-float storage', () => {
    const cases: readonly (readonly [number, number])[] = [
      [0, 0],
      [1e-5, 1.0013580322265625e-5],
      [0.1, 0.0999755859375],
      [1 / 3, 0.333251953125],
      [0.5, 0.5],
      [0.999, 0.9990234375],
      [1, 1],
      [-0.25, -0.25],
      [65504, 65504],
    ]
    for (const [value, stored] of cases) {
      expect(halfBitsToFloat(floatToHalfBits(value)), `${value}`).toBe(stored)
    }
  })
})

describe('createLutTextureLayout', () => {
  it('describes a 65³ rgba16float texture in 2.10 MiB', () => {
    const layout = createLutTextureLayout(65)
    expect(LUT_TEXTURE_FORMAT).toBe('rgba16float')
    expect(layout.format).toBe(LUT_TEXTURE_FORMAT)
    expect(layout.size).toBe(65)
    expect(layout.bytesPerRow).toBe(65 * LUT_TEXTURE_BYTES_PER_TEXEL)
    expect(layout.rowsPerImage).toBe(65)
    expect(layout.byteLength).toBe(65 ** 3 * 8)
    expect(layout.byteLength).toBe(2_197_000)
    expect(layout.byteLength / 1024 / 1024).toBeCloseTo(2.095, 3)
    expect(layout.descriptor).toMatchObject({
      size: { width: 65, height: 65, depthOrArrayLayers: 65 },
      format: 'rgba16float',
      dimension: '3d',
      mipLevelCount: 1,
      sampleCount: 1,
      // GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      usage: 0x06,
    })
  })

  it('sizes the 33³ table the looks library caps the panel at', () => {
    const layout = createLutTextureLayout(33)
    expect(layout.byteLength).toBe(33 ** 3 * 8)
    expect(layout.byteLength).toBe(287_496)
    expect(layout.bytesPerRow).toBe(264)
  })

  it('rejects sizes a look cannot have', () => {
    expect(() => createLutTextureLayout(1)).toThrow(RangeError)
    expect(() => createLutTextureLayout(66)).toThrow(RangeError)
    expect(() => createLutTextureLayout(2.5)).toThrow(RangeError)
  })
})

describe('encodeLutTexture', () => {
  it('writes four little-endian half-floats per texel, alpha 1.0', () => {
    const data = new Float32Array(8 * 3)
    // Two entries with known values; the rest stay black.
    data[0] = 0
    data[1] = 0
    data[2] = 0
    data[3] = 1
    data[4] = 0.5
    data[5] = 0.25
    const bytes = encodeLutTexture(lut(2, data))

    expect(bytes.length).toBe(2 ** 3 * 8)
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0x00, 0x3c])
    // Entry 1: red 1 (0x3c00), green 0.5 (0x3800), blue 0.25 (0x3400), alpha 1.
    expect(Array.from(bytes.subarray(8, 16))).toEqual([
      0x00, 0x3c, 0x00, 0x38, 0x00, 0x34, 0x00, 0x3c,
    ])
  })

  it('keeps the .cube red-fastest order in the texture', () => {
    // Entry index = red + 2·green + 4·blue: the red-only ramp makes each entry distinct.
    const rows: string[] = ['LUT_3D_SIZE 2']
    for (let entry = 0; entry < 8; entry++) rows.push(`${(entry + 1) / 10} 0 0`)
    const parsed = parseCube(rows.join('\n')).lut3d as CubeLut3D
    const bytes = encodeLutTexture(parsed)
    for (let entry = 0; entry < 8; entry++) {
      const red = halfBitsToFloat(
        (bytes[entry * 8] as number) | ((bytes[entry * 8 + 1] as number) << 8),
      )
      expect(red).toBeCloseTo((entry + 1) / 10, 3)
    }
  })

  it('rejects a table that is not a cube', () => {
    expect(() => encodeLutTexture(lut(2, new Float32Array(3)))).toThrow(RangeError)
    expect(() => encodeLutTexture(lut(66, new Float32Array(66 ** 3 * 3)))).toThrow(RangeError)
  })
})

describe('LookPass', () => {
  it('is implementable with the signature design 5.1 §4.6 describes', () => {
    // The shape 5.2b implements: the stage records one pass into the precise path's encoder.
    const recorded: string[] = []
    const pass: LookPass = {
      encode(_encoder, _input, _output, look, intensity, size): void {
        recorded.push(`${look}:${intensity}:${size.width}x${size.height}`)
      },
    }
    pass.encode(
      {} as GPUCommandEncoder,
      {} as GPUTextureView,
      {} as GPUTextureView,
      'look-01',
      0.5,
      { width: 3840, height: 2160 },
    )
    expect(recorded).toEqual(['look-01:0.5:3840x2160'])
  })
})
