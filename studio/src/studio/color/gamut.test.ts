// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  applyMatrix,
  D65,
  D_GAMUT_PRIMARIES,
  D_GAMUT_TO_REC709,
  DLOG_M_TO_REC709,
  type Chromaticity,
  type Matrix3,
} from './gamut'

type Vec3 = readonly [number, number, number]

/** Rec.709's own primaries (ITU-R BT.709), which the published D-Gamut matrix converts to. */
const REC709_PRIMARIES = {
  red: { x: 0.64, y: 0.33 },
  green: { x: 0.3, y: 0.6 },
  blue: { x: 0.15, y: 0.06 },
} as const satisfies Record<'red' | 'green' | 'blue', Chromaticity>

function xyYToXyz(x: number, y: number): Vec3 {
  return [x / y, 1, (1 - x - y) / y]
}

/** Solve a row-major 3×3 system by Gauss-Jordan elimination with partial pivoting. */
function solve3(matrix: Matrix3, vector: Vec3): Vec3 {
  const rows = [
    [matrix[0], matrix[1], matrix[2], vector[0]],
    [matrix[3], matrix[4], matrix[5], vector[1]],
    [matrix[6], matrix[7], matrix[8], vector[2]],
  ]
  for (let column = 0; column < 3; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) {
        pivot = row
      }
    }
    const swap = rows[column]!
    rows[column] = rows[pivot]!
    rows[pivot] = swap
    const divisor = rows[column]![column]!
    for (let entry = column; entry < 4; entry += 1) {
      rows[column]![entry] = rows[column]![entry]! / divisor
    }
    for (let row = 0; row < 3; row += 1) {
      if (row === column) {
        continue
      }
      const factor = rows[row]![column]!
      for (let entry = column; entry < 4; entry += 1) {
        rows[row]![entry] = rows[row]![entry]! - factor * rows[column]![entry]!
      }
    }
  }
  return [rows[0]![3]!, rows[1]![3]!, rows[2]![3]!]
}

function multiply3(left: Matrix3, right: Matrix3): Matrix3 {
  return [
    left[0] * right[0] + left[1] * right[3] + left[2] * right[6],
    left[0] * right[1] + left[1] * right[4] + left[2] * right[7],
    left[0] * right[2] + left[1] * right[5] + left[2] * right[8],
    left[3] * right[0] + left[4] * right[3] + left[5] * right[6],
    left[3] * right[1] + left[4] * right[4] + left[5] * right[7],
    left[3] * right[2] + left[4] * right[5] + left[5] * right[8],
    left[6] * right[0] + left[7] * right[3] + left[8] * right[6],
    left[6] * right[1] + left[7] * right[4] + left[8] * right[7],
    left[6] * right[2] + left[7] * right[5] + left[8] * right[8],
  ]
}

function invert3(matrix: Matrix3): Matrix3 {
  const first = solve3(matrix, [1, 0, 0])
  const second = solve3(matrix, [0, 1, 0])
  const third = solve3(matrix, [0, 0, 1])
  return [
    first[0],
    second[0],
    third[0],
    first[1],
    second[1],
    third[1],
    first[2],
    second[2],
    third[2],
  ]
}

/** The matrix whose columns are the primary's XYZ, scaled so D65 maps to 1,1,1. */
function rgbToXyz(
  primaries: Record<'red' | 'green' | 'blue', Chromaticity>,
  white: Chromaticity,
): Matrix3 {
  const red = xyYToXyz(primaries.red.x, primaries.red.y)
  const green = xyYToXyz(primaries.green.x, primaries.green.y)
  const blue = xyYToXyz(primaries.blue.x, primaries.blue.y)
  const columns: Matrix3 = [
    red[0],
    green[0],
    blue[0],
    red[1],
    green[1],
    blue[1],
    red[2],
    green[2],
    blue[2],
  ]
  const scale = solve3(columns, xyYToXyz(white.x, white.y))
  return multiply3(columns, [scale[0], 0, 0, 0, scale[1], 0, 0, 0, scale[2]])
}

describe('the published D-Gamut matrix', () => {
  it('is what the primaries and D65 give (the white paper rounds it to four decimals)', () => {
    const derived = multiply3(
      invert3(rgbToXyz(REC709_PRIMARIES, D65)),
      rgbToXyz(D_GAMUT_PRIMARIES, D65),
    )
    const differences = derived.map((value, index) => Math.abs(value - D_GAMUT_TO_REC709[index]!))
    expect(Math.max(...differences)).toBeLessThan(2e-4)
  })

  it('leaves neutral light neutral: every row sums to 1', () => {
    const sums = [
      D_GAMUT_TO_REC709[0] + D_GAMUT_TO_REC709[1] + D_GAMUT_TO_REC709[2],
      D_GAMUT_TO_REC709[3] + D_GAMUT_TO_REC709[4] + D_GAMUT_TO_REC709[5],
      D_GAMUT_TO_REC709[6] + D_GAMUT_TO_REC709[7] + D_GAMUT_TO_REC709[8],
    ]
    for (const sum of sums) {
      expect(sum).toBeCloseTo(1, 12)
    }
  })
})

describe('the fitted D-Log M matrix', () => {
  it('leaves neutral light neutral: every row sums to 1', () => {
    const sums = [
      DLOG_M_TO_REC709[0] + DLOG_M_TO_REC709[1] + DLOG_M_TO_REC709[2],
      DLOG_M_TO_REC709[3] + DLOG_M_TO_REC709[4] + DLOG_M_TO_REC709[5],
      DLOG_M_TO_REC709[6] + DLOG_M_TO_REC709[7] + DLOG_M_TO_REC709[8],
    ]
    for (const sum of sums) {
      expect(sum).toBeCloseTo(1, 12)
    }
  })

  it('sends the neutral axis to itself', () => {
    const output = applyMatrix(DLOG_M_TO_REC709, [0.3, 0.3, 0.3])
    for (const channel of output) {
      expect(channel).toBeCloseTo(0.3, 12)
    }
  })
})

describe('applyMatrix', () => {
  it('multiplies rows by columns', () => {
    const matrix: Matrix3 = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    expect(applyMatrix(matrix, [1, 0, 0])).toEqual([1, 4, 7])
    expect(applyMatrix(matrix, [0, 1, 0])).toEqual([2, 5, 8])
    expect(applyMatrix(matrix, [0, 0, 1])).toEqual([3, 6, 9])
  })

  it('keeps an identity matrix an identity', () => {
    expect(applyMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1], [0.125, 0.5, 0.875])).toEqual([
      0.125, 0.5, 0.875,
    ])
  })
})
