// The pure parts of the e2e flows' media tools: the channel-swap `.cube` the looks flow adds, and the colour
// comparisons it judges with. The flows themselves run in `npm run e2e`.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  colourWithin,
  LOOK_CLIP_RGB,
  maxChannelDifference,
  parsePsnrAverage,
  swapCubeText,
  swapRedBlue,
} from './support/flow-media.mjs'

/** Trilinear lookup in a red-fastest `.cube` text, the way the look stage reads it. */
function lookup(text, [r, g, b]) {
  const lines = text.trim().split('\n')
  const size = Number(lines.find((line) => line.startsWith('LUT_3D_SIZE')).split(' ')[1])
  const table = lines
    .filter((line) => /^[-\d.]/.test(line))
    .map((line) => line.split(' ').map(Number))
  assert.equal(table.length, size ** 3)
  const at = (ri, gi, bi) => table[ri + size * (gi + size * bi)]
  const scaled = [r, g, b].map((value) => (value / 255) * (size - 1))
  const lo = scaled.map((value) => Math.min(Math.floor(value), size - 2))
  const f = scaled.map((value, index) => value - lo[index])
  const out = [0, 0, 0]
  for (let corner = 0; corner < 8; corner += 1) {
    const dr = corner & 1
    const dg = (corner >> 1) & 1
    const db = (corner >> 2) & 1
    const weight = (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2])
    const value = at(lo[0] + dr, lo[1] + dg, lo[2] + db)
    for (let channel = 0; channel < 3; channel += 1) out[channel] += weight * value[channel]
  }
  return out.map((value) => Math.round(value * 255))
}

test('the swap cube has size^3 entries, red fastest, and a valid header', () => {
  const text = swapCubeText(5)
  const lines = text.trim().split('\n')
  assert.equal(lines[0], 'TITLE "E2E channel swap"')
  assert.equal(lines[1], 'LUT_3D_SIZE 5')
  assert.equal(lines.length, 2 + 125)
  // Entry 1 is the next red step: the output's blue (swapped in) moves, red and green do not.
  assert.equal(lines[3], '0.000000 0.000000 0.250000')
})

test('looking a colour up in the swap cube gives the colour with red and blue swapped', () => {
  const text = swapCubeText(17)
  for (const colour of [LOOK_CLIP_RGB, [10, 200, 130], [255, 0, 255], [0, 0, 0]]) {
    assert.ok(colourWithin(lookup(text, colour), swapRedBlue(colour), 2), `colour ${colour}`)
  }
})

test('the looks clip colour is not near its own swap, so an unchanged picture cannot pass', () => {
  assert.ok(maxChannelDifference(LOOK_CLIP_RGB, swapRedBlue(LOOK_CLIP_RGB)) > 100)
})

test('colourWithin judges every channel', () => {
  assert.equal(colourWithin([10, 20, 30], [12, 18, 33], 3), true)
  assert.equal(colourWithin([10, 20, 30], [12, 18, 34], 3), false)
})

test('the PSNR average is read from the filter summary, and identical frames score 100', () => {
  assert.equal(parsePsnrAverage('[Parsed_psnr_5 @ 0x1] PSNR y:21.4 u:30.1 v:29.9 average:23.17 min:23.17 max:23.17'), 23.17)
  assert.equal(parsePsnrAverage('PSNR y:inf u:inf v:inf average:inf min:inf max:inf'), 100)
  assert.equal(parsePsnrAverage('no summary here'), null)
})
