/**
 * The gamut matrices of the input transform: D-Gamut → Rec.709 for D-Log, and our fitted
 * matrix for D-Log M, both applied to linear light in float64.
 *
 * D-Gamut's primaries, its D65 white point and the D-Gamut → Rec.709 matrix are DJI's
 * published ones (Cinema Color System white paper, 2017); the test derives the matrix from the
 * primaries. The D-Log M matrix is fitted to DJI's LUT (design 5.1, section 4.1) and is not
 * the published matrix: D-Log M's chroma gain is about 1.39, against the published matrix's
 * 2.2, which is the measured form of the "Resolve oversaturates D-Log M" report.
 */

import type { Rgb } from './types'

/** A CIE 1931 chromaticity pair. */
export interface Chromaticity {
  /** The x coordinate. */
  readonly x: number
  /** The y coordinate. */
  readonly y: number
}

/** A 3×3 matrix in row-major order: the R row, the G row, then the B row. */
export type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

/** D-Gamut's RGB primaries, as published by DJI (Cinema Color System white paper, 2017). */
export const D_GAMUT_PRIMARIES = {
  red: { x: 0.71, y: 0.31 },
  green: { x: 0.21, y: 0.88 },
  blue: { x: 0.09, y: -0.08 },
} as const satisfies Record<'red' | 'green' | 'blue', Chromaticity>

/** D65, the white point of both D-Gamut and Rec.709 (the two need no chromatic adaptation). */
export const D65: Chromaticity = { x: 0.3127, y: 0.329 }

/**
 * D-Gamut (linear) → Rec.709 (linear), row-major, as published in the same white paper.
 *
 * The paper's own numbers are rounded to four decimals; deriving the matrix from
 * `D_GAMUT_PRIMARIES`, `D65` and Rec.709's primaries reproduces them to 1e-4 (a test does
 * exactly that). Each row sums to 1, so neutral D-Gamut stays neutral Rec.709.
 */
export const D_GAMUT_TO_REC709 = [
  1.6746, -0.5797, -0.0949, -0.0981, 1.334, -0.2359, -0.041, -0.243, 1.284,
] as const satisfies Matrix3

/**
 * The fitted D-Log M → Rec.709 matrix, in linear light, row-major (design 5.1, section 4.1).
 *
 * Fitted by least squares to the LUT's low-chroma samples (linear spread < 0.05, level
 * 0.02..0.5) after the D-Log M curve; rows sum to 1.0000. On that set it reproduces the LUT
 * to rms 5.7 and max 27.7 levels of 1023, and near-neutral colours to 4.5 levels mean. On
 * eight frames of clip 0020 the whole transform is mean 5.16, p99 12.97 and max 60.39 levels
 * from the LUT; the published D-Gamut matrix here would cost mean 7.04 and max 131.41.
 */
export const DLOG_M_TO_REC709 = [
  1.3312, -0.3467, 0.0155, -0.0811, 1.1176, -0.0365, -0.0577, -0.3179, 1.3756,
] as const satisfies Matrix3

/** Multiply an RGB triple by a row-major 3×3 matrix: `out[i] = Σ M[i][j]·rgb[j]`. */
export function applyMatrix(matrix: Matrix3, rgb: Rgb): Rgb {
  return [
    matrix[0] * rgb[0] + matrix[1] * rgb[1] + matrix[2] * rgb[2],
    matrix[3] * rgb[0] + matrix[4] * rgb[1] + matrix[5] * rgb[2],
    matrix[6] * rgb[0] + matrix[7] * rgb[1] + matrix[8] * rgb[2],
  ]
}
