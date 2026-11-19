// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { parseCube, type CubeLut3D } from './cube'
import { halfBitsToFloat, floatToHalfBits } from './lut-texture'
import {
  sampleTetrahedral,
  sampleTetrahedralFloat32,
  sampleTrilinear,
  type Rgb,
} from './tetrahedral'

/**
 * The curve of the design's precision measurements (design 5.1 §4.1, §5 M6/M7): DJI's D-Log M
 * fit of §4.1 written as the design's measurement script writes it — `(a·x^p + b·x^q)/(a + b)` is
 * the same curve as `(x^p - b'·x^q)/(1 - b')` with `b' = 0.285082` — then the D-Log M → Rec.709
 * matrix, then the sRGB transfer function. §4.1 calls the transfer "OETF709", but the numbers of
 * §5 M6/M7 (1.757, 2.413, 857 levels) come from this sRGB curve, so the fixture follows the
 * measurement. 5.1a owns the production curve; this is the precision harness's reference.
 */
const DLOG_M = { a: 2.819952, p: 2.715683, b: -0.803923, q: 5.587935 } as const
const DLOG_M_NORM = DLOG_M.a + DLOG_M.b
const DLOG_M_TO_REC709: readonly (readonly [number, number, number])[] = [
  [1.3312, -0.3467, 0.0155],
  [-0.0811, 1.1176, -0.0365],
  [-0.0577, -0.3179, 1.3756],
]

function decodeDLogM(value: number): number {
  const x = Math.min(1, Math.max(1e-9, value))
  return (DLOG_M.a * x ** DLOG_M.p + DLOG_M.b * x ** DLOG_M.q) / DLOG_M_NORM
}

function srgbTransfer(value: number): number {
  const x = Math.min(1, Math.max(0, value))
  return x < 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
}

function designDisplay(input: Rgb): Rgb {
  const decoded: Rgb = [decodeDLogM(input[0]), decodeDLogM(input[1]), decodeDLogM(input[2])]
  const channel = (row: readonly [number, number, number]): number =>
    srgbTransfer(row[0] * decoded[0] + row[1] * decoded[1] + row[2] * decoded[2])
  return [
    channel(DLOG_M_TO_REC709[0] as readonly [number, number, number]),
    channel(DLOG_M_TO_REC709[1] as readonly [number, number, number]),
    channel(DLOG_M_TO_REC709[2] as readonly [number, number, number]),
  ]
}

/** A table of `designDisplay` over the grid, each entry put through `quantize`. */
function buildTable(size: number, quantize: (value: number) => number): Float32Array {
  const data = new Float32Array(size ** 3 * 3)
  const last = size - 1
  let offset = 0
  for (let blue = 0; blue < size; blue++) {
    for (let green = 0; green < size; green++) {
      for (let red = 0; red < size; red++) {
        const out = designDisplay([red / last, green / last, blue / last])
        data[offset++] = quantize(out[0])
        data[offset++] = quantize(out[1])
        data[offset++] = quantize(out[2])
      }
    }
  }
  return data
}

function lut(size: number, data: Float32Array): CubeLut3D {
  return { size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }
}

/**
 * The design's M6 sample set: 30,000 uniform samples from its linear congruential generator
 * (seed 987654321) plus a 1024-step neutral ramp. Fixed, so the measurement repeats exactly.
 */
function designSamples(): Rgb[] {
  let seed = 987654321
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const samples: Rgb[] = []
  for (let index = 0; index < 30_000; index++) samples.push([next(), next(), next()])
  for (let step = 0; step <= 1023; step++) {
    const value = step / 1023
    samples.push([value, value, value])
  }
  return samples
}

const SAMPLES = designSamples()

interface Stats {
  readonly mean: number
  readonly p99: number
  readonly max: number
}

function summarize(errors: number[]): Stats {
  const sorted = [...errors].sort((a, b) => a - b)
  return {
    mean: errors.reduce((sum, value) => sum + value, 0) / errors.length,
    p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  }
}

/**
 * The four comparisons of design §5 M6, in levels of 1023. The table is the parser's float32
 * array; the design's harness built a float64 table, a difference below the digits reported here.
 */
function measurePrecision(size: number): {
  readonly arithmetic: Stats
  readonly storage: Stats
  readonly tetrahedral: Stats
  readonly trilinear: Stats
} {
  const exact = lut(
    size,
    buildTable(size, (value) => value),
  )
  const half = lut(
    size,
    buildTable(size, (value) => halfBitsToFloat(floatToHalfBits(value))),
  )
  const arithmetic: number[] = []
  const storage: number[] = []
  const tetrahedral: number[] = []
  const trilinear: number[] = []
  for (const sample of SAMPLES) {
    const reference = designDisplay(sample)
    const asFloat64 = sampleTetrahedral(exact, sample)
    const asFloat32 = sampleTetrahedralFloat32(exact, sample)
    const stored = sampleTetrahedralFloat32(half, sample)
    const blended = sampleTrilinear(half, sample)
    let arithmeticError = 0
    let storageError = 0
    let tetrahedralError = 0
    let trilinearError = 0
    for (let channel = 0; channel < 3; channel++) {
      const truth = reference[channel] as number
      arithmeticError = Math.max(
        arithmeticError,
        Math.abs((asFloat32[channel] as number) - (asFloat64[channel] as number)) * 1023,
      )
      storageError = Math.max(
        storageError,
        Math.abs((stored[channel] as number) - (asFloat64[channel] as number)) * 1023,
      )
      tetrahedralError = Math.max(
        tetrahedralError,
        Math.abs((stored[channel] as number) - truth) * 1023,
      )
      trilinearError = Math.max(
        trilinearError,
        Math.abs((blended[channel] as number) - truth) * 1023,
      )
    }
    arithmetic.push(arithmeticError)
    storage.push(storageError)
    tetrahedral.push(tetrahedralError)
    trilinear.push(trilinearError)
  }
  return {
    arithmetic: summarize(arithmetic),
    storage: summarize(storage),
    tetrahedral: summarize(tetrahedral),
    trilinear: summarize(trilinear),
  }
}

describe('sampleTetrahedral on the design’s precision harness', () => {
  it('reproduces the 33³ numbers of design §5 M6', { timeout: 30_000 }, () => {
    const result = measurePrecision(33)
    // f32 arithmetic against the same table in float64: mean 0.000 / max 0.000 levels of 1023.
    expect(result.arithmetic.mean).toBeLessThan(0.0005)
    expect(result.arithmetic.max).toBeLessThan(0.0005)
    // rgba16float storage: mean 0.079 / max 0.243.
    expect(result.storage.mean).toBeCloseTo(0.079, 2)
    expect(result.storage.p99).toBeCloseTo(0.205, 2)
    expect(result.storage.max).toBeCloseTo(0.243, 1)
    // Tetrahedral on the f16 table against the analytic curve: mean 1.757, p99 27.6, max 89.3.
    expect(result.tetrahedral.mean).toBeCloseTo(1.757, 2)
    expect(result.tetrahedral.p99).toBeCloseTo(27.572, 1)
    expect(result.tetrahedral.max).toBeCloseTo(89.301, 1)
    // Trilinear on the same table: mean 2.413, p99 33.5, max 91.0.
    expect(result.trilinear.mean).toBeCloseTo(2.413, 2)
    expect(result.trilinear.p99).toBeCloseTo(33.535, 1)
    expect(result.trilinear.max).toBeCloseTo(91.023, 1)
    expect(result.tetrahedral.mean).toBeLessThan(result.trilinear.mean)
    expect(result.tetrahedral.max).toBeLessThan(result.trilinear.max)
  })

  it('reproduces the 65³ numbers of design §5 M6', { timeout: 30_000 }, () => {
    const result = measurePrecision(65)
    expect(result.arithmetic.mean).toBeLessThan(0.0005)
    expect(result.arithmetic.max).toBeLessThan(0.0005)
    expect(result.storage.mean).toBeCloseTo(0.078, 2)
    expect(result.storage.p99).toBeCloseTo(0.206, 2)
    expect(result.storage.max).toBeCloseTo(0.239, 1)
    expect(result.tetrahedral.mean).toBeCloseTo(0.591, 2)
    expect(result.tetrahedral.p99).toBeCloseTo(11.216, 1)
    expect(result.tetrahedral.max).toBeCloseTo(54.573, 1)
    expect(result.trilinear.mean).toBeCloseTo(0.812, 2)
    expect(result.trilinear.p99).toBeCloseTo(14.919, 1)
    expect(result.trilinear.max).toBeCloseTo(55.094, 1)
  })

  it('keeps the design’s 857 levels on the bench’s 877-level ramp', () => {
    // The bench's ramp: luma codes 64…940 of 1023, 877 levels (bench/lib/inputs.mjs).
    const levels: number[] = []
    for (let code = 64; code <= 940; code++) {
      const code01 = code / 1023
      levels.push(Math.round((designDisplay([code01, code01, code01])[0] as number) * 1023))
    }
    expect(new Set(levels).size).toBe(857)
    let nonMonotone = 0
    let largestStep = 0
    for (let index = 1; index < levels.length; index++) {
      const previous = levels[index - 1] as number
      const current = levels[index] as number
      if (current < previous) nonMonotone++
      largestStep = Math.max(largestStep, current - previous)
    }
    expect(nonMonotone).toBe(0)
    expect(largestStep).toBe(2)
  })

  it('keeps all 877 levels through an identity 65³ table', () => {
    const size = 65
    const data = new Float32Array(size ** 3 * 3)
    const last = size - 1
    let offset = 0
    for (let blue = 0; blue < size; blue++) {
      for (let green = 0; green < size; green++) {
        for (let red = 0; red < size; red++) {
          data[offset++] = red / last
          data[offset++] = green / last
          data[offset++] = blue / last
        }
      }
    }
    const identity = lut(size, data)
    const levels: number[] = []
    for (let code = 64; code <= 940; code++) {
      const code01 = code / 1023
      levels.push(
        Math.round(
          (sampleTetrahedralFloat32(identity, [code01, code01, code01])[0] as number) * 1023,
        ),
      )
    }
    expect(new Set(levels).size).toBe(877)
    let nonMonotone = 0
    let largestStep = 0
    for (let index = 1; index < levels.length; index++) {
      const previous = levels[index - 1] as number
      const current = levels[index] as number
      if (current < previous) nonMonotone++
      largestStep = Math.max(largestStep, current - previous)
    }
    expect(nonMonotone).toBe(0)
    // An identity table moves one level per input level, so no step is larger than 1.
    expect(largestStep).toBe(1)
  })
})

describe('sampleTetrahedral', () => {
  it('applies DOMAIN_MIN/DOMAIN_MAX to the input, clamping at both ends', () => {
    // The 2³ grid of a file whose domain is 0…2, with an identity table.
    const text = [
      'LUT_3D_SIZE 2',
      'DOMAIN_MIN 0 0 0',
      'DOMAIN_MAX 2 2 2',
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ].join('\n')
    const grid = parseCube(text).lut3d as CubeLut3D

    expect(sampleTetrahedral(grid, [0, 0, 0])).toEqual([0, 0, 0])
    expect(sampleTetrahedral(grid, [2, 2, 2])).toEqual([1, 1, 1])
    expect(sampleTetrahedral(grid, [1, 1, 1])).toEqual([0.5, 0.5, 0.5])
    // Outside the domain the input clamps: (3, -1, 1) reads (1, 0, 0.5) of the grid.
    expect(sampleTetrahedral(grid, [3, -1, 1])).toEqual([1, 0, 0.5])
  })

  it('runs a 1D shaper before the grid', () => {
    const text = [
      'LUT_3D_SIZE 2',
      'LUT_1D_SIZE 3',
      'DOMAIN_MIN 0 0 0',
      'DOMAIN_MAX 1 1 1',
      '0 0 0',
      '0.25 0.25 0.25',
      '0.5 0.5 0.5',
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ].join('\n')
    const cube = parseCube(text)
    const grid = cube.lut3d as CubeLut3D
    const shaper = cube.shaper

    expect(sampleTetrahedral(grid, [0, 0, 0], shaper)).toEqual([0, 0, 0])
    expect(sampleTetrahedral(grid, [1, 1, 1], shaper)).toEqual([0.5, 0.5, 0.5])
    // 0.5 of the input is the shaper's middle entry, 0.25, which the identity grid keeps.
    expect(sampleTetrahedral(grid, [0.5, 0.5, 0.5], shaper)).toEqual([0.25, 0.25, 0.25])
    // 0.25 of the input falls between the shaper's first two entries: 0.125.
    const quarter = sampleTetrahedral(grid, [0.25, 0.25, 0.25], shaper)
    expect(quarter[0]).toBeCloseTo(0.125, 6)
  })

  it('runs a shaper longer than a grid may be', () => {
    // Resolve writes combined files with a 1024-entry (or longer) shaper before a 33³ grid.
    const rows: string[] = ['LUT_3D_SIZE 2', 'LUT_1D_SIZE 1024']
    for (let entry = 0; entry < 1024; entry++) {
      const value = entry / 1023
      rows.push(`${value} ${value} ${value}`)
    }
    for (const row of ['0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1']) {
      rows.push(row)
    }
    const cube = parseCube(rows.join('\n'))
    expect(cube.shaper?.size).toBe(1024)
    const sampled = sampleTetrahedral(cube.lut3d as CubeLut3D, [0.25, 0.5, 0.75], cube.shaper)
    expect(sampled[0]).toBeCloseTo(0.25, 6)
    expect(sampled[1]).toBeCloseTo(0.5, 6)
    expect(sampled[2]).toBeCloseTo(0.75, 6)
  })

  it('picks each of the six tetrahedra by the order of the fractions', () => {
    // A 2³ red-only table with eight distinct corner values, red fastest:
    // c000 c100 c010 c110 c001 c101 c011 c111.
    const corners = [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 0.99]
    const data = new Float32Array(8 * 3)
    for (let entry = 0; entry < 8; entry++) data[entry * 3] = corners[entry] as number
    const grid = lut(2, data)

    // (name, input, the tetrahedron's weights on c000/c100/c010/c110/c001/c101/c011/c111)
    const cases: readonly (readonly [string, Rgb, readonly number[]])[] = [
      ['x > y > z', [0.7, 0.5, 0.2], [0.3, 0.2, 0, 0.3, 0, 0, 0, 0.2]],
      ['x > z >= y', [0.7, 0.2, 0.5], [0.3, 0.2, 0, 0, 0, 0.3, 0, 0.2]],
      ['z >= x > y', [0.5, 0.2, 0.7], [0.3, 0, 0, 0, 0.2, 0.3, 0, 0.2]],
      ['z > y >= x', [0.2, 0.5, 0.7], [0.3, 0, 0, 0, 0.2, 0, 0.3, 0.2]],
      ['y >= z > x', [0.2, 0.7, 0.5], [0.3, 0, 0.2, 0, 0, 0, 0.3, 0.2]],
      ['y >= x >= z', [0.5, 0.7, 0.2], [0.3, 0, 0.2, 0.3, 0, 0, 0, 0.2]],
    ]
    for (const [name, input, weights] of cases) {
      let expected = 0
      for (let corner = 0; corner < 8; corner++) {
        expected += (weights[corner] as number) * (corners[corner] as number)
      }
      expect(sampleTetrahedral(grid, input)[0], name).toBeCloseTo(expected, 8)
    }
  })

  it('blends the cell diagonal through c000 and c111, as the tetrahedra share it', () => {
    const data = new Float32Array(8 * 3)
    data[0] = 1
    data[1] = 1
    data[2] = 1
    const grid = lut(2, data)
    // On the body diagonal every tetrahedron weighs c000 and c111 only.
    expect(sampleTetrahedral(grid, [0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5])
    expect(sampleTrilinear(grid, [0.5, 0.5, 0.5])).toEqual([0.125, 0.125, 0.125])
  })

  it('rejects a table that is not a full grid', () => {
    expect(() => sampleTetrahedral(lut(2, new Float32Array(3)), [0, 0, 0])).toThrow(RangeError)
    expect(() => sampleTetrahedral(lut(7, new Float32Array(3)), [0, 0, 0])).toThrow(RangeError)
    expect(() => sampleTetrahedralFloat32(lut(1, new Float32Array(3)), [0, 0, 0])).toThrow(
      RangeError,
    )
  })
})
