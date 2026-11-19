// The effect chain's data tables (curves, LUT, gradient map, atlas) live in `rgba16float` textures, so a table is not
// cut to 256 levels before it is sampled: a 10-bit source through a curves effect keeps its 10 bits (design 3.6
// section 2.18 (c)). A table is built as bytes (a stored LUT, an atlas) or as floats (the curves bake); this turns
// either into the half-float words `writeTexture` takes.

const F32 = new Float32Array(1)
const U32 = new Uint32Array(F32.buffer)

/** One float as a half-float word, rounded to nearest even; magnitudes past the half range clamp to the largest one. */
export function floatToHalf(value: number): number {
  F32[0] = value
  const bits = U32[0]!
  const sign = (bits >>> 16) & 0x8000
  const exponent = (bits >>> 23) & 0xff
  const mantissa = bits & 0x7fffff
  if (exponent === 0xff) return sign | (mantissa !== 0 ? 0x7e00 : 0x7c00)
  const unbiased = exponent - 127
  if (unbiased > 15) return sign | 0x7bff
  if (unbiased >= -14) {
    // Normal half: 10 mantissa bits, rounded to nearest even (a carry into the exponent is the right result)
    const half = ((unbiased + 15) << 10) | (mantissa >>> 13)
    const rest = mantissa & 0x1fff
    const rounded = rest > 0x1000 || (rest === 0x1000 && (half & 1) === 1) ? half + 1 : half
    return sign | Math.min(rounded, 0x7bff)
  }
  if (unbiased < -25) return sign
  // Subnormal half
  const full = mantissa | 0x800000
  const shift = -unbiased - 1
  const half = full >>> shift
  const rest = full & ((1 << shift) - 1)
  const middle = 1 << (shift - 1)
  const rounded = rest > middle || (rest === middle && (half & 1) === 1) ? half + 1 : half
  return sign | rounded
}

/** The half-float words of a table: a byte table (0..255 is 0..1) or a float table (kept as it is). */
export function tableToHalf(data: Uint8Array | Float32Array): Uint16Array {
  const words = new Uint16Array(data.length)
  if (data instanceof Uint8Array) {
    for (let i = 0; i < data.length; i++) words[i] = floatToHalf(data[i]! / 255)
  } else {
    for (let i = 0; i < data.length; i++) words[i] = floatToHalf(data[i]!)
  }
  return words
}
