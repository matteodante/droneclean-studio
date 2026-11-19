// The float golden cases' inputs and comparison.
//
// A float case renders through the precise path (`src/studio/render/test-sink.ts`): the compositor's `rgba16float`
// accumulator is read back as unorm16 and stored as a 16-bit PNG, compared exactly like every other frame. The sources
// are headerless 10-bit `gbrp10le` files (FFmpeg's raw stream) that the raw test backend decodes
// (`src/studio/render/frames/backends/raw-test.ts`); they are made here in code, byte for byte the same on every run,
// and generated into the run's temporary folder, so no footage and no binary is committed.
//
// The ramp: 1024 pixels, 877 grey levels (codes 64 to 940, studio range, as the bench's ramp) in every row, 16 rows.
// A float path keeps all 877 as different values; one 8-bit step anywhere in it leaves at most 256.

/**
 * A float clip's media id names a tiny real video (the renderer opens every clip's file with its decoder first); its raw
 * frames are served under the same id with this suffix.
 */
export const RAW_SUFFIX = '-raw'

export const RAW_WIDTH = 1024
export const RAW_HEIGHT = 16
export const RAMP_LEVELS = 877
const RAMP_BASE = 64
const MAX_CODE = 1023

/** The code of a ramp pixel: levels 0..876 spread over the 1024 columns, so every level appears at least once. */
const rampLevel = (x) => Math.floor((x * RAMP_LEVELS) / RAW_WIDTH)

/**
 * One `gbrp10le` frame of `RAW_WIDTH` x `RAW_HEIGHT`: planes G, B, R, each 16-bit little endian, no padding.
 * `codeAt(x, channel)` gives the 10-bit code (channel 0 R, 1 G, 2 B); every row of a frame is the same.
 */
function gbrp10leFrame(codeAt) {
  const plane = RAW_WIDTH * RAW_HEIGHT * 2
  const frame = Buffer.alloc(plane * 3)
  const planeOf = [1, 2, 0] // G, B, R in the file order
  planeOf.forEach((channel, planeIndex) => {
    for (let y = 0; y < RAW_HEIGHT; y++) {
      for (let x = 0; x < RAW_WIDTH; x++) {
        const code = Math.max(0, Math.min(MAX_CODE, codeAt(x, channel)))
        frame.writeUInt16LE(code, planeIndex * plane + (y * RAW_WIDTH + x) * 2)
      }
    }
  })
  return frame
}

const grey = (level) => RAMP_BASE + (((level % RAMP_LEVELS) + RAMP_LEVELS) % RAMP_LEVELS)

/** The ramp's frames: frame 0 the ramp, frame 1 the ramp reversed, so a clip drawn from the wrong frame shows. */
export function rampFile() {
  return Buffer.concat([
    gbrp10leFrame((x) => grey(rampLevel(x))),
    gbrp10leFrame((x) => grey(RAMP_LEVELS - 1 - rampLevel(x))),
  ])
}

/** The shadow case's source: 8 frames, frame k the ramp moved by 40 k levels (a wrong frame is a different ramp). */
export const SHADOW_SOURCE_FRAMES = 8
export function shadowSourceFile() {
  const frames = []
  for (let k = 0; k < SHADOW_SOURCE_FRAMES; k++) frames.push(gbrp10leFrame((x) => grey(rampLevel(x) + 40 * k)))
  return Buffer.concat(frames)
}

/**
 * The cleaned piece of source frames 3 to 5: three frames of a different picture on purpose (red and blue carry the
 * ramp, green a third of it moved by 100 levels), so a frame read from the wrong file or the wrong offset shows.
 */
export const SHADOW_PIECE_FRAMES = 3
export function shadowPieceFile() {
  const frames = []
  for (let j = 0; j < SHADOW_PIECE_FRAMES; j++) {
    frames.push(
      gbrp10leFrame((x, channel) =>
        channel === 1 ? grey(Math.floor(rampLevel(x) / 3) + 100 + 40 * j) : grey(rampLevel(x) + 40 * j),
      ),
    )
  }
  return Buffer.concat(frames)
}

/** The distinct values of the first channel of row `row`, as a sorted list. */
function distinctValues(frame, row = Math.floor(frame.height / 2)) {
  const seen = new Set()
  for (let x = 0; x < frame.width; x++) seen.add(frame.data[(row * frame.width + x) * 4])
  return [...seen].sort((a, b) => a - b)
}

/**
 * The levels a row of a float frame holds, counted on the first channel: its distinct unorm16 values (every value the
 * float composite kept apart), and the 10-bit codes (`round(v * 1023)`) they fall on.
 */
export function countLevels(frame, row) {
  const values = distinctValues(frame, row)
  const codes = new Set(values.map((value) => Math.round((value / 65535) * MAX_CODE)))
  return { values: values.length, codes: codes.size }
}

/** Exact comparison of two unorm16 frames: how many values differ and by how much at most (in unorm16 steps). */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
export function diffStats16(expected, actual) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      sizeMismatch: `${actual.width}x${actual.height} against stored ${expected.width}x${expected.height}`,
    }
  }
  let differing = 0
  let max = 0
  let sumAbs = 0
  for (let i = 0; i < expected.data.length; i++) {
    const d = Math.abs(actual.data[i] - expected.data[i])
    if (d === 0) continue
    differing++
    sumAbs += d
    if (d > max) max = d
  }
  return { differing, max, values: expected.data.length, mean: sumAbs / expected.data.length }
}

export const isIdentical16 = (stats) => !stats.sizeMismatch && stats.differing === 0

export function describeStats16(stats) {
  if (stats.sizeMismatch) return `size differs: ${stats.sizeMismatch}`
  return `${stats.differing} of ${stats.values} values differ; largest difference ${stats.max} of 65535 (${(stats.max / 257).toFixed(2)} 8-bit levels); mean ${stats.mean.toFixed(3)}`
}

/** A float frame as an 8-bit picture, to look at (the high byte of each value) */
export function toEightBit(frame) {
  const data = new Uint8Array(frame.data.length)
  for (let i = 0; i < data.length; i++) data[i] = frame.data[i] >> 8
  return { width: frame.width, height: frame.height, data }
}
