// The look golden case's input: a 65 point `.cube` made in code (never a user's file, never committed as data).
//
// The grid is a linear map of its input, so a tetrahedral (or trilinear) read reproduces it exactly and the case can say
// what every pixel of a grey ramp must become: out = (0.1 + 0.8 r, g, 0.1 + 0.5 b + 0.3 (1 - r)). It is cross-channel on
// purpose: a grey ramp comes out with three different channels, so a stage that read the wrong channel or the wrong row
// order shows. `LOOK_TABLE_SIZE` is the largest a look can be (65), the case the preview budget is measured with.

const LOOK_TABLE_SIZE = 65
export const LOOK_ID = 'golden-linear-look'

/** The look's output for an input colour (all 0..1) */
export const lookOf = (r, g, b) => [0.1 + 0.8 * r, g, 0.1 + 0.5 * b + 0.3 * (1 - r)]

/** The `.cube` text, red varying fastest as the format says */
export function linearLookText() {
  const lines = ['TITLE "golden linear look"', `LUT_3D_SIZE ${LOOK_TABLE_SIZE}`]
  const last = LOOK_TABLE_SIZE - 1
  for (let b = 0; b < LOOK_TABLE_SIZE; b++) {
    for (let g = 0; g < LOOK_TABLE_SIZE; g++) {
      for (let r = 0; r < LOOK_TABLE_SIZE; r++) {
        lines.push(lookOf(r / last, g / last, b / last).map((v) => v.toFixed(7)).join(' '))
      }
    }
  }
  return lines.join('\n') + '\n'
}
