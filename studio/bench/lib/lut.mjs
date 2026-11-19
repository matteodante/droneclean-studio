// The LUT of the colour measurement: a gentle grade generated at run time, so that no LUT file is committed and no
// one's own LUT is needed. Deterministic: the same bytes on every run (the test pins the hash).
//
// Per channel, with x in [0, 1] the input and g the channel's gain (R 1.03, G 1.00, B 0.97: a slight warm shift):
//   out = clamp(g * (x - 0.15 * sin(2 * pi * x) / (2 * pi)), 0, 1)
// The bracket is a mild S-curve (slope 0.85 at the ends, 1.15 in the middle); with the gain the slope never
// exceeds 1.15 * 1.03 = 1.1845. 33 points per axis, red varying fastest (the .cube order), 6 decimals.
import fs from 'node:fs'
import path from 'node:path'

export const LUT_SIZE = 33
const LUT_TITLE = 'DroneClean bench grade'
const LUT_GAINS = [1.03, 1.0, 0.97]
const LUT_S_CURVE = 0.15

/** One channel's curve, for an input in [0, 1]. */
function gradeChannel(x, gain) {
  const s = x - (LUT_S_CURVE * Math.sin(2 * Math.PI * x)) / (2 * Math.PI)
  return Math.min(1, Math.max(0, gain * s))
}

/** The table: LUT_SIZE^3 rows of [r, g, b] in .cube order (red index varies fastest). */
export function benchLutTable() {
  const rows = []
  for (let b = 0; b < LUT_SIZE; b++)
    for (let g = 0; g < LUT_SIZE; g++)
      for (let r = 0; r < LUT_SIZE; r++) {
        const input = [r, g, b].map((i) => i / (LUT_SIZE - 1))
        rows.push(input.map((x, c) => Number(gradeChannel(x, LUT_GAINS[c]).toFixed(6))))
      }
  return rows
}

/** The .cube text (LF line endings). */
export function benchCubeText() {
  const lines = [
    `TITLE "${LUT_TITLE}"`,
    `LUT_3D_SIZE ${LUT_SIZE}`,
    'DOMAIN_MIN 0 0 0',
    'DOMAIN_MAX 1 1 1',
  ]
  for (const row of benchLutTable()) lines.push(row.map((v) => v.toFixed(6)).join(' '))
  return `${lines.join('\n')}\n`
}

/** Write the generated LUT to `file` (always: it is cheap and keeps the file in step with this code). */
export function writeBenchLut(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, benchCubeText())
  return file
}
