// Half floats (IEEE binary16) as the golden kit reads them back from an `rgba16float` texture: exact decoding, and the
// 16-bit unsigned normalized value the stored float frames hold. Pure, so the test sink and the golden warp page share it.

/** The value of a half float (IEEE binary16). */
export function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >> 10) & 0x1f
  const mantissa = bits & 0x3ff
  if (exponent === 0) return sign * mantissa * 2 ** -24
  if (exponent === 31) return mantissa === 0 ? sign * Infinity : NaN
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15)
}

/** A half float as a 16-bit unsigned normalized value: clamped to 0..1, rounded to the nearest of 65535 steps. */
export function halfToUnorm16(bits: number): number {
  const value = halfToFloat(bits)
  if (!(value > 0)) return 0
  if (value >= 1) return 65535
  return Math.round(value * 65535)
}

/** Whether a half float is not a colour in 0..1 */
export function halfOutOfRange(bits: number): boolean {
  const value = halfToFloat(bits)
  return !(value >= 0 && value <= 1)
}

/** Reads rows of `rgba16float` (4 halves per pixel) into unorm16 values */
export function unpackHalfRows(
  data: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
): { rgba16: Uint16Array; outOfRange: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const rgba16 = new Uint16Array(width * height * 4)
  let outOfRange = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width * 4; x++) {
      const bits = view.getUint16(y * bytesPerRow + x * 2, true)
      rgba16[y * width * 4 + x] = halfToUnorm16(bits)
      // Alpha is part of the picture too; all four channels must be colours
      if (halfOutOfRange(bits)) outOfRange++
    }
  }
  return { rgba16, outOfRange }
}
