/**
 * The two log curves of the input transform, both directions, as plain float64 functions.
 *
 * D-Log is DJI's published 2017 formula (Cinema Color System white paper); D-Log M is the
 * three-constant curve fitted to DJI's LUT (design 5.1, sections 3.3 and 4.1). A code is the
 * 10-bit value divided by 1023, which is what the decoder hands the render path; the D-Log M
 * encode has no closed form, so it inverts the monotone curve by bisection.
 */

import { DLOG_CURVE, DLOG_M_CURVE } from './profiles'

/** A source code's domain is the 10-bit value: a code outside 0..1 is clamped to the domain. */
function clampCode(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/**
 * D-Log encode: linear light to the 2017 D-Log code.
 *
 * `out = 6.025·in + 0.0929` for `in <= 0.0078`, else
 * `out = 0.256663·log10(0.9892·in + 0.0108) + 0.584555`.
 *
 * The white paper's 10-bit anchors are 95 at 0 % reflectance, 408 at 18 % and 586 at 90 %;
 * 4200 % reflectance (42.0, 7.8 stops above 18 %) encodes to 1.0. Light below 0 is clamped to
 * 0: the published decode of code 0 is −1.54 %, not a light.
 */
export function encodeDLog(linear: number): number {
  const value = Math.max(linear, 0)
  if (value <= DLOG_CURVE.linearThreshold) {
    return DLOG_CURVE.slope * value + DLOG_CURVE.offset
  }
  return (
    DLOG_CURVE.logScale * Math.log10(DLOG_CURVE.logGain * value + DLOG_CURVE.logOffset) +
    DLOG_CURVE.bias
  )
}

/**
 * D-Log decode: the 2017 D-Log code to linear light.
 *
 * `out = (x − 0.0929)/6.025` for `x <= 0.14`, else
 * `out = (10^(3.89616·x − 2.27752) − 0.0108)/0.9892`.
 *
 * The code is clamped to 0..1, its 10-bit domain. Code 0 decodes to −1.54 % (the published
 * formula's offset), and code 1.0 to 41.999: the curve keeps 7.8 stops above 18 % white.
 */
export function decodeDLog(code: number): number {
  const value = clampCode(code)
  if (value <= DLOG_CURVE.codeThreshold) {
    return (value - DLOG_CURVE.offset) / DLOG_CURVE.slope
  }
  return (
    (10 ** (DLOG_CURVE.exponentScale * value - DLOG_CURVE.exponentOffset) - DLOG_CURVE.logOffset) /
    DLOG_CURVE.logGain
  )
}

/**
 * D-Log M decode: the code to linear light through the fitted curve
 * `(x^p − b·x^q) / (1 − b)` (design 5.1, section 4.1).
 *
 * The code is clamped to 0..1, its 10-bit domain. The curve is monotone and maps 0 to 0 and 1
 * to 1; see `DLOG_M_CURVE` for what it was fitted to and with what residual.
 */
export function decodeDLogM(code: number): number {
  const value = clampCode(code)
  const { p, q, b } = DLOG_M_CURVE
  return (value ** p - b * value ** q) / (1 - b)
}

/**
 * D-Log M encode: linear light back to the code, the inverse of `decodeDLogM`.
 *
 * The fitted curve has no closed-form inverse, so this bisects it: 60 steps take the interval
 * below 1e-18, past what a double can hold, and the curve is strictly increasing on 0..1.
 * Values outside 0..1 clamp to the endpoints, the curve's range.
 */
export function encodeDLogM(linear: number): number {
  if (linear <= 0) {
    return 0
  }
  if (linear >= 1) {
    return 1
  }
  let low = 0
  let high = 1
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2
    if (decodeDLogM(middle) < linear) {
      low = middle
    } else {
      high = middle
    }
  }
  return (low + high) / 2
}
