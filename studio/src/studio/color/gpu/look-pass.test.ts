// @vitest-environment node

// The look pass without a GPU: the 16 floats an encode hands the shader, the 1024-entry shaper
// texture a combined .cube becomes, the shader's own text, and the formats and files it refuses.
// The draw itself is the probe's (`probe.mjs`), which compares a generated 65³ table against
// `sampleTetrahedral` on this Mac's GPU.

import { describe, expect, it } from 'vite-plus/test'
import { type CubeLut1D, type CubeLut3D, type ParsedCube } from '../cube'
import { halfBitsToFloat } from '../lut-texture'
import {
  LOOK_FORMATS,
  LOOK_SHAPER_SIZE,
  LOOK_UNIFORM_FLOATS,
  createLookPass,
  encodeShaperTexture,
  lookShader,
  packLookUniforms,
} from './look-pass'

/** A 3D table of `size` points per side, its entries all zero. */
function table(size: number, domainMax: readonly [number, number, number] = [1, 1, 1]): CubeLut3D {
  return {
    size,
    domainMin: [0, 0, 0],
    domainMax,
    data: new Float32Array(size ** 3 * 3),
  }
}

/** A 1D shaper of `values` at `size` entries, over 0…`domainMax`. */
function shaper(
  values: readonly [number, number, number][],
  domainMax: readonly [number, number, number] = [1, 1, 1],
): CubeLut1D {
  const data = new Float32Array(values.length * 3)
  values.forEach((rgb, entry) => {
    data[entry * 3] = rgb[0]
    data[entry * 3 + 1] = rgb[1]
    data[entry * 3 + 2] = rgb[2]
  })
  return { size: values.length, data, domainMin: [0, 0, 0], domainMax }
}

function cube(lut3d: CubeLut3D | null, shaper: CubeLut1D | null = null): ParsedCube {
  return { title: null, lut3d, shaper }
}

/** The four floats of one shaper texel, decoded from the texture bytes. */
function shaperTexel(bytes: Uint8Array, index: number): [number, number, number, number] {
  const offset = index * 8
  const channel = (which: number): number =>
    halfBitsToFloat(
      (bytes[offset + which * 2] as number) | ((bytes[offset + which * 2 + 1] as number) << 8),
    )
  return [channel(0), channel(1), channel(2), channel(3)]
}

describe('packLookUniforms', () => {
  it('packs the grid domain, the intensity and the points per side', () => {
    const floats = packLookUniforms(cube(table(33, [2, 2, 2])), 0.25)
    expect(floats).toHaveLength(LOOK_UNIFORM_FLOATS)
    expect([floats[0], floats[1], floats[2], floats[3]]).toEqual([0, 0, 0, Math.fround(0.25)])
    expect([floats[4], floats[5], floats[6], floats[7]]).toEqual([2, 2, 2, 33])
    // No shaper: its domain stays 0 and the flag says the shader must not read it
    expect([floats[8], floats[9], floats[10], floats[11]]).toEqual([0, 0, 0, 0])
    expect([floats[12], floats[13], floats[14]]).toEqual([0, 0, 0])
  })

  it('packs a combined file: the shaper domain and the flag that reads it', () => {
    const combined = cube(
      table(17),
      shaper(
        [
          [0, 0, 0],
          [1, 1, 1],
        ],
        [0.9, 0.8, 0.7],
      ),
    )
    const floats = packLookUniforms(combined, 1)
    expect([floats[8], floats[9], floats[10], floats[11]]).toEqual([0, 0, 0, 1])
    expect([floats[12], floats[13], floats[14]]).toEqual([
      Math.fround(0.9),
      Math.fround(0.8),
      Math.fround(0.7),
    ])
  })

  it('refuses a file that holds a shaper and no grid', () => {
    const shaperOnly = cube(
      null,
      shaper([
        [0, 0, 0],
        [1, 1, 1],
      ]),
    )
    expect(() => packLookUniforms(shaperOnly, 1)).toThrow(/no LUT_3D_SIZE/)
  })

  it('refuses a table size and an intensity the shader cannot use', () => {
    expect(() => packLookUniforms(cube(table(66)), 1)).toThrow(/between 2 and 65, got 66/)
    expect(() => packLookUniforms(cube(table(1)), 1)).toThrow(/between 2 and 65, got 1/)
    expect(() => packLookUniforms(cube(table(2)), -0.1)).toThrow(RangeError)
    expect(() => packLookUniforms(cube(table(2)), 1.1)).toThrow(RangeError)
    expect(() => packLookUniforms(cube(table(2)), Number.NaN)).toThrow(RangeError)
  })
})

describe('encodeShaperTexture', () => {
  it('resamples a 1D table onto 1024 rgba16float entries, alpha 1', () => {
    const bytes = encodeShaperTexture(
      shaper([
        [0, 0, 0],
        [1, 1, 1],
      ]),
    )
    expect(bytes).toHaveLength(LOOK_SHAPER_SIZE * 8)
    expect(shaperTexel(bytes, 0)).toEqual([0, 0, 0, 1])
    expect(shaperTexel(bytes, LOOK_SHAPER_SIZE - 1)).toEqual([1, 1, 1, 1])
    // Between the two entries the table is linear, so entry i holds i / 1023
    const middle = shaperTexel(bytes, 511)
    expect(middle[0]).toBeCloseTo(511 / 1023, 3)
    expect(middle[1]).toBe(middle[0])
    expect(middle[2]).toBe(middle[0])
    expect(middle[3]).toBe(1)
  })

  it('reads the shaper over its own input domain, not 0…1', () => {
    // Three entries over 0…2: the middle entry is at input 1, the middle of the domain
    const bytes = encodeShaperTexture(
      shaper(
        [
          [0, 0, 0],
          [0.5, 0.5, 0.5],
          [1, 1, 1],
        ],
        [2, 2, 2],
      ),
    )
    const middle = shaperTexel(bytes, 511)
    expect(middle[0]).toBeCloseTo(0.5, 3)
  })

  it('keeps a 1024-entry shaper’s entries, a 10-bit code landing on one', () => {
    const values = Array.from({ length: LOOK_SHAPER_SIZE }, (_, entry) => {
      const value = (entry / (LOOK_SHAPER_SIZE - 1)) ** 2.2
      return [value, value, value] as [number, number, number]
    })
    const bytes = encodeShaperTexture(shaper(values))
    // A 10-bit code reads the entry of its own index, with the fraction that entry carries
    for (const entry of [0, 1, 256, 512, 1023]) {
      expect(shaperTexel(bytes, entry)[0], `${entry}`).toBeCloseTo(values[entry]?.[0] ?? -1, 3)
    }
  })

  it('refuses a table that cannot be a shaper', () => {
    expect(() =>
      encodeShaperTexture({
        ...shaper([
          [0, 0, 0],
          [1, 1, 1],
        ]),
        size: 1,
      }),
    ).toThrow(/between 2 and 65536, got 1/)
    expect(() =>
      encodeShaperTexture({
        ...shaper([
          [0, 0, 0],
          [1, 1, 1],
        ]),
        data: new Float32Array(3),
      }),
    ).toThrow(/must hold 6 values, got 3/)
  })
})

describe('lookShader', () => {
  const shader = lookShader()

  it('declares the four vec4f uniform the pass allocates, and binds the table and the shaper', () => {
    const fields = [...shader.matchAll(/^ {2}(\w+): vec4f,$/gm)].map((match) => match[1])
    expect(fields).toEqual(['gridMin', 'gridMax', 'shaperMin', 'shaperMax'])
    expect(fields).toHaveLength(LOOK_UNIFORM_FLOATS / 4)
    expect(shader).toContain('@group(0) @binding(0) var<uniform> uniforms: Uniforms;')
    expect(shader).toContain('@group(0) @binding(1) var inputTexture: texture_2d<f32>;')
    expect(shader).toContain('@group(0) @binding(2) var lutTexture: texture_3d<f32>;')
    expect(shader).toContain('@group(0) @binding(3) var shaperTexture: texture_2d<f32>;')
  })

  it('loads the table with textureLoad, no sampler (design 5.1 §4.4)', () => {
    expect(shader).not.toContain('sampler')
    expect(shader).toContain('textureLoad(lutTexture, vec3i(cell + offset), 0)')
    expect(shader).toContain('textureLoad(shaperTexture, vec2i(index, 0), 0)')
    expect(shader).toContain(`const SHAPER_SIZE: f32 = ${LOOK_SHAPER_SIZE}.0;`)
  })

  it('picks the same six tetrahedra as tetrahedral.ts, in its order', () => {
    // One w0 per tetrahedron: 1 − the largest of the fractions
    expect(shader.match(/w0 = 1\.0 - f\./g)).toHaveLength(6)
    expect(shader).toContain('if (f.x > f.y) {')
    expect(shader).toContain('} else if (f.z > f.y) {')
    expect(shader).toContain('} else if (f.z > f.x) {')
    // Four corners, blended left to right with the weights that sum to 1
    expect(shader).toContain('return a * w0 + b * w1 + c * w2 + d * w3;')
  })

  it('blends the looked image with the input by the intensity', () => {
    expect(shader).toContain('mix(texel.rgb, looked, uniforms.gridMin.w)')
  })
})

describe('createLookPass', () => {
  // The formats are checked before the device is touched: a stub that fails on any call is enough
  const untouchedDevice = new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`the device was used (${String(property)}) for a pass it should refuse`)
      },
    },
  ) as GPUDevice

  it('reads and writes the two normalized float formats the product renders in', async () => {
    expect(LOOK_FORMATS).toEqual(['rgba8unorm', 'rgba16float'])
    await expect(
      createLookPass(untouchedDevice, { input: 'rgba32float', output: 'rgba16float' }),
    ).rejects.toThrow(/rgba32float/)
    await expect(
      createLookPass(untouchedDevice, { input: 'rgba16float', output: 'bgra8unorm' }),
    ).rejects.toThrow(/bgra8unorm/)
  })
})
