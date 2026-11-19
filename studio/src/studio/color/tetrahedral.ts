/**
 * Tetrahedral interpolation of a `.cube` look in float, the CPU reference for the WGSL the precise
 * render path (3.2, 5.1c) runs on an `rgba16float` 3D texture with `textureLoad` and no sampler
 * (design 5.1 §4.4).
 *
 * `sampleTetrahedral` is the float64 reference. `sampleTetrahedralFloat32` is the same algorithm
 * with every operation in float32 — one `Math.fround` per WGSL operation, in the same order — so
 * the shader can be transcribed from it line for line:
 *
 *     let t = clamp((value - domainMin) / (domainMax - domainMin), vec3f(0.0), vec3f(1.0));
 *     let c = t * f32(size - 1u);                    // size: the grid's points per side
 *     let i0 = min(vec3u(floor(c)), vec3u(size - 2u));
 *     let f = c - vec3f(i0);
 *     // one of the six tetrahedra below; four texels, four weights that sum to 1
 *
 * The table fills the texture with the entry `r + g·size + b·size²` at texel `(x, y, z) = (r, g,
 * b)`, so a shader reads `textureLoad(lut, vec3<i32>(i0 + offset), 0)` directly.
 *
 * The six tetrahedra, with `f = (x, y, z)` and the same conditions in both functions:
 *
 *     x > y > z      c000(1-x) + c100(x-y) + c110(y-z) + c111 z
 *     x > z >= y     c000(1-x) + c100(x-z) + c101(z-y) + c111 y
 *     z >= x > y     c000(1-z) + c001(z-x) + c101(x-y) + c111 y
 *     z > y >= x     c000(1-z) + c001(z-y) + c011(y-x) + c111 x
 *     y >= z > x     c000(1-y) + c010(y-z) + c011(z-x) + c111 x
 *     y >= x >= z    c000(1-y) + c010(y-x) + c110(x-z) + c111 z
 *
 * In every case the 000 corner's weight is `1 - max(x, y, z)` and the 111 corner's is `min(x, y,
 * z)`; each channel's products are summed left to right.
 *
 * The input domain is the file's `DOMAIN_MIN`/`DOMAIN_MAX` and is clamped: `DOMAIN_MAX 2 2 2`
 * reads the last grid point at input 2.0 (design 5.1 §4.4). A 1D shaper, when the file has one,
 * runs first and its output (0…1) indexes the grid.
 */

import {
  CUBE_MAX_SHAPER_SIZE,
  CUBE_MAX_SIZE,
  CUBE_MIN_SIZE,
  type CubeLut1D,
  type CubeLut3D,
} from './cube'

/**
 * A colour's three components. Look inputs are normalized display values (0…1); outputs are
 * whatever the table holds.
 */
export type Rgb = readonly [number, number, number]

const ZERO: Rgb = [0, 0, 0]
const ONE: Rgb = [1, 1, 1]

/** One operation's rounding: the identity for the float64 reference, `Math.fround` for float32. */
type Rounding = (value: number) => number

const NO_ROUNDING: Rounding = (value) => value

interface LatticePoint {
  /** The cell's lower grid index, `0 … size - 2`. */
  readonly index: number
  /** The position inside the cell, 0…1. */
  readonly fraction: number
}

interface LatticeSample {
  readonly size: number
  readonly data: Float32Array
  readonly x: LatticePoint
  readonly y: LatticePoint
  readonly z: LatticePoint
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function assertTable(
  functionName: string,
  size: number,
  dataLength: number,
  entries: number,
  maxSize: number,
): void {
  if (!Number.isInteger(size) || size < CUBE_MIN_SIZE || size > maxSize) {
    throw new RangeError(
      `${functionName}: size must be an integer between ${CUBE_MIN_SIZE} and ${maxSize}`,
    )
  }
  if (dataLength !== entries * 3) {
    throw new RangeError(`${functionName}: data must hold ${entries * 3} values, got ${dataLength}`)
  }
}

function assertLut3D(functionName: string, lut: CubeLut3D): void {
  assertTable(
    functionName,
    lut.size,
    lut.data.length,
    lut.size * lut.size * lut.size,
    CUBE_MAX_SIZE,
  )
}

function assertLut1D(functionName: string, shaper: CubeLut1D): void {
  assertTable(functionName, shaper.size, shaper.data.length, shaper.size, CUBE_MAX_SHAPER_SIZE)
}

/**
 * Where `value` falls in a table of `size` points over `min…max`: the cell's lower index and the
 * fraction inside it. The domain is clamped; a zero-width domain reads the first point.
 */
function latticePoint(
  value: number,
  min: number,
  max: number,
  size: number,
  round: Rounding,
): LatticePoint {
  const low = round(min)
  const high = round(max)
  const range = round(high - low)
  const normalized = range === 0 ? 0 : clamp01(round(round(value - low) / range))
  const coordinate = round(normalized * round(size - 1))
  const index = Math.min(Math.floor(coordinate), size - 2)
  return { index, fraction: round(coordinate - index) }
}

/** The shaper's output for one channel: a 1D lookup, linearly interpolated between entries. */
function shaperChannel(shaper: CubeLut1D, value: number, channel: number, round: Rounding): number {
  const point = latticePoint(
    value,
    shaper.domainMin[channel] as number,
    shaper.domainMax[channel] as number,
    shaper.size,
    round,
  )
  const offset = point.index * 3 + channel
  const from = shaper.data[offset] as number
  const to = shaper.data[offset + 3] as number
  return round(from + round(round(to - from) * point.fraction))
}

/**
 * The three cell coordinates for `input`: through the shaper first when there is one, otherwise
 * straight through the grid's input domain.
 */
function latticeFor(
  lut: CubeLut3D,
  input: Rgb,
  shaper: CubeLut1D | null,
  round: Rounding,
  functionName: string,
): LatticeSample {
  assertLut3D(functionName, lut)
  if (shaper !== null) assertLut1D(functionName, shaper)
  const source: Rgb =
    shaper === null
      ? input
      : [
          shaperChannel(shaper, input[0], 0, round),
          shaperChannel(shaper, input[1], 1, round),
          shaperChannel(shaper, input[2], 2, round),
        ]
  const domainMin = shaper === null ? lut.domainMin : ZERO
  const domainMax = shaper === null ? lut.domainMax : ONE
  return {
    size: lut.size,
    data: lut.data,
    x: latticePoint(source[0], domainMin[0] as number, domainMax[0] as number, lut.size, round),
    y: latticePoint(source[1], domainMin[1] as number, domainMax[1] as number, lut.size, round),
    z: latticePoint(source[2], domainMin[2] as number, domainMax[2] as number, lut.size, round),
  }
}

/**
 * One channel of a tetrahedron: four corners and four weights, multiplied and summed left to
 * right (`(c0·w0 + c1·w1) + c2·w2 + c3·w3`), one `round` per operation.
 */
function blend4(
  c0: number,
  c1: number,
  c2: number,
  c3: number,
  w0: number,
  w1: number,
  w2: number,
  w3: number,
  round: Rounding,
): number {
  const sum01 = round(round(c0 * round(w0)) + round(c1 * round(w1)))
  const sum012 = round(sum01 + round(c2 * round(w2)))
  return round(sum012 + round(c3 * round(w3)))
}

/** One channel of the tetrahedral blend: the corner texels of the sample's cell. */
function tetrahedralChannel(sample: LatticeSample, channel: number, round: Rounding): number {
  const stride = sample.size
  const base = (sample.z.index * stride + sample.y.index) * stride + sample.x.index
  const c000 = sample.data[base * 3 + channel] as number
  const c100 = sample.data[(base + 1) * 3 + channel] as number
  const c010 = sample.data[(base + stride) * 3 + channel] as number
  const c110 = sample.data[(base + stride + 1) * 3 + channel] as number
  const c001 = sample.data[(base + stride * stride) * 3 + channel] as number
  const c101 = sample.data[(base + stride * stride + 1) * 3 + channel] as number
  const c011 = sample.data[(base + stride * stride + stride) * 3 + channel] as number
  const c111 = sample.data[(base + stride * stride + stride + 1) * 3 + channel] as number
  const x = sample.x.fraction
  const y = sample.y.fraction
  const z = sample.z.fraction
  if (x > y) {
    if (y > z) return blend4(c000, c100, c110, c111, 1 - x, x - y, y - z, z, round)
    if (x > z) return blend4(c000, c100, c101, c111, 1 - x, x - z, z - y, y, round)
    return blend4(c000, c001, c101, c111, 1 - z, z - x, x - y, y, round)
  }
  if (z > y) return blend4(c000, c001, c011, c111, 1 - z, z - y, y - x, x, round)
  if (z > x) return blend4(c000, c010, c011, c111, 1 - y, y - z, z - x, x, round)
  return blend4(c000, c010, c110, c111, 1 - y, y - x, x - z, z, round)
}

function trilinearChannel(sample: LatticeSample, channel: number): number {
  const stride = sample.size
  const base = (sample.z.index * stride + sample.y.index) * stride + sample.x.index
  const c000 = sample.data[base * 3 + channel] as number
  const c100 = sample.data[(base + 1) * 3 + channel] as number
  const c010 = sample.data[(base + stride) * 3 + channel] as number
  const c110 = sample.data[(base + stride + 1) * 3 + channel] as number
  const c001 = sample.data[(base + stride * stride) * 3 + channel] as number
  const c101 = sample.data[(base + stride * stride + 1) * 3 + channel] as number
  const c011 = sample.data[(base + stride * stride + stride) * 3 + channel] as number
  const c111 = sample.data[(base + stride * stride + stride + 1) * 3 + channel] as number
  const fx = sample.x.fraction
  const fy = sample.y.fraction
  const fz = sample.z.fraction
  const c00 = c000 + (c100 - c000) * fx
  const c10 = c010 + (c110 - c010) * fx
  const c01 = c001 + (c101 - c001) * fx
  const c11 = c011 + (c111 - c011) * fx
  const c0 = c00 + (c10 - c00) * fy
  const c1 = c01 + (c11 - c01) * fy
  return c0 + (c1 - c0) * fz
}

function blend(
  lut: CubeLut3D,
  input: Rgb,
  shaper: CubeLut1D | null,
  round: Rounding,
  functionName: string,
): Rgb {
  const sample = latticeFor(lut, input, shaper, round, functionName)
  return [
    tetrahedralChannel(sample, 0, round),
    tetrahedralChannel(sample, 1, round),
    tetrahedralChannel(sample, 2, round),
  ]
}

/**
 * The float64 reference: the colour `lut` maps `input` to, interpolated tetrahedrally.
 *
 * `shaper`, when the file has one, runs first; its output is the grid's input. The grid's input
 * domain is clamped to the table, so inputs below `DOMAIN_MIN` read the first point and inputs
 * above `DOMAIN_MAX` read the last one.
 */
export function sampleTetrahedral(
  lut: CubeLut3D,
  input: Rgb,
  shaper: CubeLut1D | null = null,
): Rgb {
  return blend(lut, input, shaper, NO_ROUNDING, 'sampleTetrahedral')
}

/**
 * The same interpolation with every operation in float32, in the order the WGSL runs it (see the
 * module comment). On the design's 33³ and 65³ tables it stays within 0.0004 levels of 1023 of
 * `sampleTetrahedral` (design 5.1 §5 M6: 0.000 mean and max; measured in the test).
 */
export function sampleTetrahedralFloat32(
  lut: CubeLut3D,
  input: Rgb,
  shaper: CubeLut1D | null = null,
): Rgb {
  return blend(lut, input, shaper, Math.fround, 'sampleTetrahedralFloat32')
}

/**
 * Trilinear interpolation of the same table in float64: the baseline design 5.1 §5 compares
 * tetrahedral against (mean 2.413 vs 1.757 levels of 1023 on a 33³ `rgba16float` table of the
 * input transform). Not used by the render path.
 */
export function sampleTrilinear(lut: CubeLut3D, input: Rgb, shaper: CubeLut1D | null = null): Rgb {
  const sample = latticeFor(lut, input, shaper, NO_ROUNDING, 'sampleTrilinear')
  return [trilinearChannel(sample, 0), trilinearChannel(sample, 1), trilinearChannel(sample, 2)]
}
