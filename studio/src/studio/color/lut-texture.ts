/**
 * The `rgba16float` 3D texture a look is sampled from, and the interface the float look stage
 * implements (design 5.1 §4.4, §4.6).
 *
 * The table is uploaded as it is: `.cube` entry `r + g·size + b·size²` is texel `(x, y, z) = (r,
 * g, b)`, and a 3D texture's byte order is x fastest, then y, then z, so one pass over the parsed
 * entries fills `bytesPerRow = size · 8` and `rowsPerImage = size` with no transposition. The
 * shader reads it with `textureLoad(lut, vec3<i32>(x, y, z), 0)` — no sampler, so no filtering
 * and no `float32-filterable` feature (design 5.1 §4.4).
 *
 * Size: an `rgba16float` texel is 8 bytes, so a 33³ table is 287,496 bytes (0.27 MiB) and a 65³
 * table 2,197,000 bytes (2.10 MiB, the design's 2.1 MB). WebGPU's `maxTextureDimension3D` is 2048,
 * so 65 fits everywhere.
 */

import { CUBE_MAX_SIZE, CUBE_MIN_SIZE, type CubeLut3D } from './cube'

/** The texel format of a look's 3D texture. */
export const LUT_TEXTURE_FORMAT = 'rgba16float' as const

/** Bytes one texel occupies: four half-floats. */
export const LUT_TEXTURE_BYTES_PER_TEXEL = 8

/**
 * `GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST`. The bits are fixed by the WebGPU
 * spec and are spelled out because `GPUTextureUsage` is a browser global while this module's tests
 * run in Node.
 */
const LUT_TEXTURE_USAGE = 0x04 | 0x02

/** The half-float bit pattern of 1.0: the alpha a look's texels carry. */
const HALF_ONE_BITS = 0x3c00

/** Everything a look's 3D texture needs: its descriptor, the upload layout and the byte size. */
export interface LutTextureLayout {
  /** Points per side of the grid. */
  readonly size: number
  readonly format: typeof LUT_TEXTURE_FORMAT
  /** Bytes in one row of a z slice: `size · 8`. */
  readonly bytesPerRow: number
  /** Rows in one z slice: `size`. */
  readonly rowsPerImage: number
  /** `size³ · 8` bytes. */
  readonly byteLength: number
  /** The 3D texture to create, with the usage a look needs. */
  readonly descriptor: GPUTextureDescriptor
}

/**
 * The identity of a look in the workspace's looks library. The look stage resolves it to the
 * look's texture and values; this module only carries it through the interface.
 */
export type LookId = string

/**
 * The float look stage of the precise render path (design 5.1 §4.6): reads normalized float
 * colour from `input`, writes it to `output`, both `rgba16float` of the same width and height,
 * with no mips and no sampler. A look runs after the input transform, so its input is
 * display-referred Rec.709 in 0…1 (values outside are clamped by the look's table domain).
 *
 * 5.1c/5.2b implement this; the stage owns only its pipeline, the precise path owns the textures
 * and the command encoder, so preview and export share it.
 */
export interface LookPass {
  /**
   * Records the look's render pass.
   *
   * @param look the look to apply, from the workspace's looks library
   * @param intensity 0…1 blend between the input and the looked image
   */
  encode(
    encoder: GPUCommandEncoder,
    input: GPUTextureView,
    output: GPUTextureView,
    look: LookId,
    intensity: number,
    size: { readonly width: number; readonly height: number },
  ): void
}

/** The layout of a look's `rgba16float` 3D texture for a `size³` grid. */
export function createLutTextureLayout(size: number): LutTextureLayout {
  if (!Number.isInteger(size) || size < CUBE_MIN_SIZE || size > CUBE_MAX_SIZE) {
    throw new RangeError(
      `createLutTextureLayout: size must be an integer between ${CUBE_MIN_SIZE} and ${CUBE_MAX_SIZE}, got ${size}`,
    )
  }
  const bytesPerRow = size * LUT_TEXTURE_BYTES_PER_TEXEL
  return {
    size,
    format: LUT_TEXTURE_FORMAT,
    bytesPerRow,
    rowsPerImage: size,
    byteLength: bytesPerRow * size * size,
    descriptor: {
      label: `look lut ${size}`,
      size: { width: size, height: size, depthOrArrayLayers: size },
      format: LUT_TEXTURE_FORMAT,
      dimension: '3d',
      usage: LUT_TEXTURE_USAGE,
      mipLevelCount: 1,
      sampleCount: 1,
    },
  }
}

/**
 * The bytes of a look's 3D texture: `size³` texels of four little-endian half-floats, red, green,
 * blue and an alpha of 1.0, in the layout `createLutTextureLayout` describes.
 *
 * @throws RangeError when the table's size or length is not a `.cube` grid a look can have.
 */
export function encodeLutTexture(lut: CubeLut3D): Uint8Array {
  const size = lut.size
  if (!Number.isInteger(size) || size < CUBE_MIN_SIZE || size > CUBE_MAX_SIZE) {
    throw new RangeError(
      `encodeLutTexture: size must be an integer between ${CUBE_MIN_SIZE} and ${CUBE_MAX_SIZE}, got ${size}`,
    )
  }
  const entries = size * size * size
  if (lut.data.length !== entries * 3) {
    throw new RangeError(
      `encodeLutTexture: data must hold ${entries * 3} values for ${size}³, got ${lut.data.length}`,
    )
  }
  const bytes = new Uint8Array(entries * LUT_TEXTURE_BYTES_PER_TEXEL)
  let offset = 0
  for (let entry = 0; entry < entries; entry++) {
    const source = entry * 3
    for (let channel = 0; channel < 3; channel++) {
      const bits = floatToHalfBits(lut.data[source + channel] as number)
      bytes[offset++] = bits & 0xff
      bytes[offset++] = bits >>> 8
    }
    bytes[offset++] = HALF_ONE_BITS & 0xff
    bytes[offset++] = HALF_ONE_BITS >>> 8
  }
  return bytes
}

/** One float32 reinterpreted as its bits, shared by the half-float conversion (single-threaded). */
const CONVERT_BUFFER = new ArrayBuffer(4)
const CONVERT_FLOAT = new Float32Array(CONVERT_BUFFER)
const CONVERT_BITS = new Uint32Array(CONVERT_BUFFER)

/**
 * The IEEE 754 binary16 bit pattern of `value`, rounded to nearest with ties to even — what
 * `rgba16float` stores. Values beyond the half-float range become infinity; values below the
 * smallest subnormal become zero; NaN stays NaN.
 */
export function floatToHalfBits(value: number): number {
  CONVERT_FLOAT[0] = value
  const bits = CONVERT_BITS[0] as number
  const sign = (bits >>> 16) & 0x8000
  const exponent = (bits >>> 23) & 0xff
  const mantissa = bits & 0x7fffff
  if (exponent === 0xff) {
    // Infinity keeps its sign; every NaN becomes the same quiet NaN.
    return mantissa === 0 ? sign | 0x7c00 : sign | 0x7e00
  }
  const shifted = exponent - 127 + 15
  if (shifted >= 0x1f) return sign | 0x7c00
  if (shifted <= 0) {
    // Subnormal, or too small to represent.
    if (shifted < -10) return sign
    const aligned = (mantissa | 0x800000) >>> (1 - shifted)
    const roundBit = aligned & 0x1000
    const sticky = aligned & 0x0fff
    let half = aligned >>> 13
    if (roundBit !== 0 && (sticky !== 0 || (half & 1) !== 0)) half++
    return sign | half
  }
  const roundBit = mantissa & 0x1000
  const sticky = mantissa & 0x0fff
  let half = (shifted << 10) | (mantissa >>> 13)
  if (roundBit !== 0 && (sticky !== 0 || (half & 1) !== 0)) half++
  return sign | half
}

/** The value of a binary16 bit pattern (the inverse of `floatToHalfBits`). */
export function halfBitsToFloat(bits: number): number {
  const value = bits & 0xffff
  const sign = (value & 0x8000) === 0 ? 1 : -1
  const exponent = (value >>> 10) & 0x1f
  const mantissa = value & 0x3ff
  if (exponent === 0) return sign * mantissa * 2 ** -24
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : NaN
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15)
}
