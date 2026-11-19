/**
 * The constants of the two input transforms, gathered in one file: the D-Log curve is DJI's
 * published 2017 formula and the D-Log M curve and the D-Log shoulder are ours. A later DJI
 * family ("B", Mavic 4 Pro and later) replaces the D-Log M numbers here and in `gamut.ts`.
 *
 * The D-Log numbers are from DJI's Cinema Color System white paper (2017), also reproduced in
 * colour-science's `colour/models/rgb/transfer_functions/dji_d_log.py`. The D-Log M numbers are
 * a fit to DJI's "D-Log M to Rec.709" LUT: three curve constants and nine matrix numbers, not
 * the LUT's table (design 5.1, sections 3.3 and 4.1; the LUT's terms allow private,
 * non-commercial use only, so nothing of DJI's file is in this repository).
 */

/**
 * The published D-Log transfer function.
 *
 * Encode: `out = 6.025·in + 0.0929` for `in <= 0.0078`, else
 * `out = 0.256663·log10(0.9892·in + 0.0108) + 0.584555`.
 *
 * Decode: `out = (x − 0.0929)/6.025` for `x <= 0.14`, else
 * `out = (10^(3.89616·x − 2.27752) − 0.0108)/0.9892`.
 */
export const DLOG_CURVE = {
  /** The encode's linear branch ends here (`in`). */
  linearThreshold: 0.0078,
  /** The encode's linear slope. */
  slope: 6.025,
  /** The encode's linear offset, and the decode's offset. */
  offset: 0.0929,
  /** The encode's logarithm multiplier. */
  logScale: 0.256663,
  /** The encode's logarithm gain, and the decode's divisor. */
  logGain: 0.9892,
  /** The encode's logarithm offset, and the decode's subtraction. */
  logOffset: 0.0108,
  /** The encode's logarithm bias. */
  bias: 0.584555,
  /** The decode switches from its linear branch to its exponential branch here (`x`). */
  codeThreshold: 0.14,
  /** The decode's exponent multiplier. */
  exponentScale: 3.89616,
  /** The decode's exponent offset. */
  exponentOffset: 2.27752,
} as const

/**
 * The fitted D-Log M decode curve, `(x^p − b·x^q) / (1 − b)`: monotone on 0..1, `f(0) = 0`
 * and `f(1) = 1`.
 *
 * DJI publishes no D-Log M formula, so the curve is fitted (Nelder-Mead, least squares in
 * sRGB-encoded levels of 1023) to the neutral axis of DJI's D-Log M LUT at its 33 grid points.
 * It reproduces that axis to rms 5.44 and max 9.55 levels of 1023, and on eight frames of clip
 * 0020 the whole transform differs from the LUT by mean 5.16, p99 12.97 and max 60.39 levels
 * (design 5.1, sections 5 M3 and M5). This is a fit to a black box, only as good as that LUT.
 *
 * The same Reinhard family as D-Log's shoulder was fitted to this curve and landed on
 * `exposure 0.996, white 0.99`, a change below the fit's own error; design 5.1 section 4.1
 * ships no shoulder for D-Log M, so the transform adds none.
 */
export const DLOG_M_CURVE = {
  /** The first exponent. */
  p: 2.715683,
  /** The second exponent. */
  q: 5.587935,
  /** The weight of the second term; `0 < b < 1`. */
  b: 0.285082,
} as const

/**
 * An extended Reinhard shoulder: `v ← v·(1 + v/w²)/(1 + v)`, after the exposure
 * `v ← exposure·v`. Linear light enters in 0..∞; the shoulder maps `white / exposure` to 1.
 */
export interface Shoulder {
  /** The gain applied to linear light before the curve. */
  readonly exposure: number
  /** The white point in exposure-adjusted linear light: the curve maps it to 1. */
  readonly white: number
}

/**
 * The fitted D-Log shoulder. The published decode plus the D-Gamut matrix and the sRGB
 * transfer reaches 1.0 at code 0.585 and stays there, losing the 7.8 stops above 18 % white;
 * without a tone curve that transform differs from DJI's D-Log LUT by mean 68.5 and max 248
 * levels of 1023. With this shoulder it differs by rms 23.45 and max 37.95 levels (design 5.1,
 * sections 4.2 and 5 M3; the slice's ceiling is 40). The family is a guess at DJI's roll-off:
 * the D-Log LUT is the only reference, since no D-Log footage was measured.
 */
export const DLOG_SHOULDER: Shoulder = {
  exposure: 0.808,
  white: 4.08,
}
