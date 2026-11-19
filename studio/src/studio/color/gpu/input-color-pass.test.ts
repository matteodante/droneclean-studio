// @vitest-environment node

// The input colour pass without a GPU: the 16 floats each profile hands the shader, the shader's
// own text (the published D-Log constants and the modes it switches on, the struct whose size the
// uniform buffer has), and the formats it refuses. The draw itself is the probe's
// (`probe.mjs`), which compares all 1024 codes against `transform()` on this Mac's GPU.

import { describe, expect, it } from 'vite-plus/test'
import { D_GAMUT_TO_REC709, DLOG_M_TO_REC709, type Matrix3 } from '../gamut'
import { DLOG_CURVE, DLOG_M_CURVE, DLOG_SHOULDER } from '../profiles'
import type { ColorProfileId } from '../types'
import {
  INPUT_COLOR_FORMATS,
  INPUT_COLOR_MODES,
  INPUT_COLOR_UNIFORM_BYTES,
  INPUT_COLOR_UNIFORM_FLOATS,
  createInputColorPass,
  inputColorShader,
  packInputColorUniforms,
} from './input-color-pass'

/** A profile's 9 matrix coefficients as the 3 rows the uniform holds. */
function rows(matrix: Matrix3): number[] {
  return [
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[3],
    matrix[4],
    matrix[5],
    matrix[6],
    matrix[7],
    matrix[8],
  ].map((value) => Math.fround(value))
}

/** The three coefficients of a 3-vector in the uniform's order: row0.xyz, row1.xyz, row2.xyz. */
function matrixInUniformOrder(floats: Float32Array): number[] {
  return [
    floats[4],
    floats[5],
    floats[6],
    floats[8],
    floats[9],
    floats[10],
    floats[12],
    floats[13],
    floats[14],
  ].map((value) => value as number)
}

describe('packInputColorUniforms', () => {
  it('writes 16 floats, the four vec4f of the shader struct', () => {
    expect(INPUT_COLOR_UNIFORM_FLOATS).toBe(16)
    expect(INPUT_COLOR_UNIFORM_BYTES).toBe(64)
    for (const profile of Object.keys(INPUT_COLOR_MODES) as ColorProfileId[]) {
      expect(packInputColorUniforms(profile)).toHaveLength(INPUT_COLOR_UNIFORM_FLOATS)
    }
  })

  it('packs D-Log M: its fitted curve, its matrix, and no shoulder', () => {
    const floats = packInputColorUniforms('dlog-m')
    expect(floats[0]).toBe(INPUT_COLOR_MODES['dlog-m'])
    expect([floats[1], floats[2], floats[3]]).toEqual([
      Math.fround(DLOG_M_CURVE.p),
      Math.fround(DLOG_M_CURVE.q),
      Math.fround(DLOG_M_CURVE.b),
    ])
    expect(matrixInUniformOrder(floats)).toEqual(rows(DLOG_M_TO_REC709))
    // D-Log M ships no shoulder: the flag is 0, and the two numbers are the neutral 1
    expect([floats[7], floats[11], floats[15]]).toEqual([1, 1, 0])
  })

  it('packs D-Log: the published matrix and the fitted shoulder, no fitted curve', () => {
    const floats = packInputColorUniforms('dlog')
    expect(floats[0]).toBe(INPUT_COLOR_MODES.dlog)
    // The decode's three curve slots stay 0: D-Log's constants are compiled into the shader
    expect([floats[1], floats[2], floats[3]]).toEqual([0, 0, 0])
    expect(matrixInUniformOrder(floats)).toEqual(rows(D_GAMUT_TO_REC709))
    expect([floats[7], floats[11], floats[15]]).toEqual([
      Math.fround(DLOG_SHOULDER.exposure),
      Math.fround(DLOG_SHOULDER.white),
      1,
    ])
  })

  it('packs none: the mode that copies through, an identity and no shoulder', () => {
    const floats = packInputColorUniforms('none')
    expect(floats[0]).toBe(0)
    expect(matrixInUniformOrder(floats)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
    expect(floats[15]).toBe(0)
  })
})

describe('inputColorShader', () => {
  const shader = inputColorShader()

  it('compiles the published D-Log decode in from profiles.ts', () => {
    const constants: readonly (readonly [string, number])[] = [
      ['DLOG_CODE_THRESHOLD', DLOG_CURVE.codeThreshold],
      ['DLOG_OFFSET', DLOG_CURVE.offset],
      ['DLOG_SLOPE', DLOG_CURVE.slope],
      ['DLOG_EXPONENT_SCALE', DLOG_CURVE.exponentScale],
      ['DLOG_EXPONENT_OFFSET', DLOG_CURVE.exponentOffset],
      ['DLOG_LOG_GAIN', DLOG_CURVE.logGain],
      ['DLOG_LOG_OFFSET', DLOG_CURVE.logOffset],
    ]
    for (const [name, value] of constants) {
      expect(shader, name).toContain(`const ${name}: f32 = ${value};`)
    }
  })

  it('switches on the same modes packInputColorUniforms writes', () => {
    expect(shader).toContain(`const MODE_DLOG: f32 = ${INPUT_COLOR_MODES.dlog}.0;`)
    expect(shader).toContain(`const MODE_DLOG_M: f32 = ${INPUT_COLOR_MODES['dlog-m']}.0;`)
    expect(INPUT_COLOR_MODES.none).toBe(0)
  })

  it('declares the uniform the pass allocates and binds it with one texture', () => {
    const fields = [...shader.matchAll(/^ {2}(\w+): vec4f,$/gm)].map((match) => match[1])
    expect(fields).toEqual(['decode', 'row0', 'row1', 'row2'])
    expect(fields).toHaveLength(INPUT_COLOR_UNIFORM_FLOATS / 4)
    expect(shader).toContain('@group(0) @binding(0) var<uniform> uniforms: Uniforms;')
    expect(shader).toContain('@group(0) @binding(1) var inputTexture: texture_2d<f32>;')
    // No sampler: every read is a textureLoad at the pixel the fragment writes
    expect(shader).not.toContain('sampler')
    expect(shader).toContain('textureLoad(inputTexture, vec2i(position.xy), 0)')
  })

  it('ports the sRGB transfer function display.ts uses after the shoulder', () => {
    expect(shader).toContain('12.92 * value')
    expect(shader).toContain('1.055 * pow(value, 1.0 / 2.4) - 0.055')
    expect(shader).toContain('0.0031308')
    // The order of transform(): decode, then the matrix, then the shoulder, then the encode
    const decode = shader.indexOf('var linear: vec3f;')
    const matrix = shader.indexOf('var mapped = vec3f(')
    const shoulder = shader.indexOf('if (uniforms.row2.w > 0.5)')
    const encode = shader.indexOf('return vec4f(srgbEncode(mapped.r)')
    expect(decode).toBeGreaterThan(0)
    expect(matrix).toBeGreaterThan(decode)
    expect(shoulder).toBeGreaterThan(matrix)
    expect(encode).toBeGreaterThan(shoulder)
  })
})

describe('createInputColorPass', () => {
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
    expect(INPUT_COLOR_FORMATS).toEqual(['rgba8unorm', 'rgba16float'])
    await expect(
      createInputColorPass(untouchedDevice, {
        input: 'rgba16uint',
        output: 'rgba16float',
      }),
    ).rejects.toThrow(/rgba16uint/)
    await expect(
      createInputColorPass(untouchedDevice, {
        input: 'rgba16float',
        output: 'bgra8unorm',
      }),
    ).rejects.toThrow(/bgra8unorm/)
  })
})
