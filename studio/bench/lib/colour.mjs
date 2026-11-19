// Colour error of an 8-bit frame against a 16-bit reference of the same picture, in 8-bit levels, per channel.

const CHANNELS = ['red', 'green', 'blue']
const BUCKETS_PER_LEVEL = 16
const MAX_LEVELS = 256

/**
 * @param {Uint8Array} actual   8-bit RGB, interleaved (rgb24)
 * @param {Uint16Array} reference 16-bit RGB, interleaved (rgb48le)
 * Error = |actual - reference / 257|, so a reference of 65535 is level 255 and the two scales agree at both ends.
 */
export function compareToReference(actual, reference) {
  if (actual.length !== reference.length) {
    throw new Error(`size mismatch: ${actual.length} samples against ${reference.length}`)
  }
  const pixels = actual.length / 3
  const out = {}
  CHANNELS.forEach((name, c) => {
    let sumAbs = 0
    let sumSigned = 0
    let max = 0
    const histogram = new Uint32Array(MAX_LEVELS * BUCKETS_PER_LEVEL + 1)
    for (let i = c; i < actual.length; i += 3) {
      const diff = actual[i] - reference[i] / 257
      const abs = Math.abs(diff)
      sumAbs += abs
      sumSigned += diff
      if (abs > max) max = abs
      histogram[Math.min(histogram.length - 1, Math.round(abs * BUCKETS_PER_LEVEL))]++
    }
    out[name] = {
      meanAbsError: sumAbs / pixels,
      meanSignedError: sumSigned / pixels,
      maxAbsError: max,
      p99AbsError: percentile(histogram, pixels, 0.99),
      p999AbsError: percentile(histogram, pixels, 0.999),
    }
  })
  const mean = (key) => CHANNELS.reduce((s, n) => s + out[n][key], 0) / 3
  return {
    pixels,
    perChannel: out,
    allChannels: {
      meanAbsError: mean('meanAbsError'),
      maxAbsError: Math.max(...CHANNELS.map((n) => out[n].maxAbsError)),
    },
  }
}

function percentile(histogram, total, fraction) {
  const target = total * fraction
  let running = 0
  for (let i = 0; i < histogram.length; i++) {
    running += histogram[i]
    if (running >= target) return i / BUCKETS_PER_LEVEL
  }
  return histogram.length / BUCKETS_PER_LEVEL
}

/** The matrix and range FFmpeg should use to read a file, from its tags. Untagged HD video is read as BT.709 limited. */
export function readingOf(colour) {
  const matrixByTag = { bt709: 'bt709', smpte170m: 'bt601', bt470bg: 'bt601', bt2020nc: 'bt2020' }
  const matrix = matrixByTag[colour.matrix] ?? 'bt709'
  const range = colour.range === 'pc' ? 'pc' : 'tv'
  return { matrix, range, assumed: !colour.matrix || !matrixByTag[colour.matrix] || !colour.range }
}
