// Frame comparison for the golden kit: numbers, a rule, and the pictures to look at.
import { encodePng } from './png.mjs'

const CHANNELS = ['R', 'G', 'B', 'A']

/**
 * Compare two RGBA images of the same size.
 * Returns per-channel mean and maximum absolute difference (in 8-bit levels),
 * the signed mean difference per channel (a uniform shift shows here), the share
 * of pixels where any channel differs, and the share that differ by more than
 * `bigLevels`.
 */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
export function diffStats(expected, actual, bigLevels = 8) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      sizeMismatch: `${actual.width}x${actual.height} against stored ${expected.width}x${expected.height}`,
    }
  }
  const pixels = expected.width * expected.height
  const sumAbs = [0, 0, 0, 0]
  const sumSigned = [0, 0, 0, 0]
  const max = [0, 0, 0, 0]
  let differing = 0
  let big = 0
  for (let p = 0; p < pixels; p++) {
    let any = false
    let anyBig = false
    for (let c = 0; c < 4; c++) {
      const d = actual.data[p * 4 + c] - expected.data[p * 4 + c]
      if (d === 0) continue
      const a = Math.abs(d)
      any = true
      if (a > bigLevels) anyBig = true
      sumAbs[c] += a
      sumSigned[c] += d
      if (a > max[c]) max[c] = a
    }
    if (any) differing++
    if (anyBig) big++
  }
  return {
    mean: sumAbs.map((v) => v / pixels),
    signedMean: sumSigned.map((v) => v / pixels),
    max,
    differingShare: differing / pixels,
    bigShare: big / pixels,
    differingPixels: differing,
    pixels,
  }
}

/** True when nothing differs at all. */
export const isIdentical = (stats) => !stats.sizeMismatch && stats.differingPixels === 0

export function describeStats(stats) {
  if (stats.sizeMismatch) return `size differs: ${stats.sizeMismatch}`
  const f = (values, digits) =>
    CHANNELS.slice(0, 3)
      .map((name, i) => `${name} ${values[i].toFixed(digits)}`)
      .join('  ')
  return [
    `mean difference per channel (levels of 255): ${f(stats.mean, 4)}`,
    `signed mean (actual - stored):               ${f(stats.signedMean, 4)}`,
    `maximum difference per channel:              ${f(stats.max, 0)}`,
    `pixels that differ: ${(stats.differingShare * 100).toFixed(2)} % (${stats.differingPixels} of ${stats.pixels}); by more than 8 levels: ${(stats.bigShare * 100).toFixed(2)} %`,
  ].join('\n')
}

/** Amplified difference: black where equal; where different, at least 96 so a one-level change is visible. */
export function diffImage(expected, actual) {
  const data = new Uint8Array(expected.data.length)
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(actual.data[i + c] - expected.data[i + c])
      data[i + c] = d === 0 ? 0 : Math.min(255, 96 + d * 40)
    }
    data[i + 3] = 255
  }
  return { width: expected.width, height: expected.height, data }
}

/** Stored | rendered | difference side by side, for one look at a failure. */
export function triptychPng(expected, actual) {
  const { width, height } = expected
  const gap = 4
  const total = width * 3 + gap * 2
  const data = new Uint8Array(total * height * 4).fill(255)
  const parts = [expected, actual, diffImage(expected, actual)]
  parts.forEach((image, index) => {
    const x0 = index * (width + gap)
    for (let y = 0; y < height; y++) {
      const from = y * width * 4
      data.set(image.data.subarray(from, from + width * 4), (y * total + x0) * 4)
    }
  })
  return encodePng({ width: total, height, data })
}
