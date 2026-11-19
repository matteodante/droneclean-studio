/**
 * The motion-blur measurements' page-side arithmetic (design 7.2, slices D and E): the reference a blurred frame is
 * compared with, the decode counter and the frame-time summary. It imports nothing, so a plain Node test can load it
 * and the benchmark page can bundle it.
 *
 * The reference is written from the sRGB transfer's definition, not taken from `src/studio/motion-blur/stage.ts`, so
 * the proof does not check the stage against its own twin.
 */

/** The sRGB transfer, decoded: a code value in 0..1 to linear light. */
export function srgbToLinear(code: number): number {
  return code <= 0.04045 ? code / 12.92 : ((code + 0.055) / 1.055) ** 2.4
}

/** The sRGB transfer, encoded: linear light to a code value. */
export function linearToSrgb(linear: number): number {
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
}

/** The step the histogram of differences uses, in levels of 1023: eight bins to a level. */
const BINS_PER_LEVEL = 8
/** The last histogram bin holds every difference of this many levels or more. */
const HISTOGRAM_LEVELS = 8

let decodeTable: Float32Array | undefined
/** Linear light of every unorm16 code, built once. */
function decodeTableOf16(): Float32Array {
  if (!decodeTable) {
    decodeTable = new Float32Array(65536)
    for (let i = 0; i < 65536; i++) decodeTable[i] = srgbToLinear(i / 65535)
  }
  return decodeTable
}

/**
 * A running weighted sum of RGBA frames in linear light: the picture a blur of those frames should be. A frame is
 * `rgba16` (unorm16, four values a pixel, as the test sink reads the float accumulator); alpha is not summed.
 */
export class LinearMean {
  readonly sums: Float32Array
  weightSum = 0
  readonly pixels: number

  constructor(pixels: number) {
    this.pixels = pixels
    this.sums = new Float32Array(pixels * 3)
  }

  add(rgba16: Uint16Array, weight: number): void {
    if (rgba16.length !== this.pixels * 4) {
      throw new RangeError(
        `a frame of ${rgba16.length / 4} pixels cannot join a mean of ${this.pixels}`,
      )
    }
    const table = decodeTableOf16()
    const sums = this.sums
    for (let p = 0, s = 0, v = 0; p < this.pixels; p++, v += 4, s += 3) {
      sums[s]! += table[rgba16[v]!]! * weight
      sums[s + 1]! += table[rgba16[v + 1]!]! * weight
      sums[s + 2]! += table[rgba16[v + 2]!]! * weight
    }
    this.weightSum += weight
  }
}

/** How far a frame is from a reference, in levels of 1023, over the three colour channels. */
export interface BlendComparison {
  pixels: number
  channels: number
  maxDiffLevels: number
  meanDiffLevels: number
  /** The smallest difference at or above which 0.01 % of the channels lie, from the histogram (an upper bound, 1/8 level) */
  p9999DiffLevels: number
  /** Channels more than 1 level away, and more than half a level away */
  over1Level: number
  overHalfLevel: number
  /** Where the largest difference is, and the two values (levels of 1023) there */
  maxAt: {
    x: number
    y: number
    channel: 'r' | 'g' | 'b'
    blurred: number
    reference: number
  } | null
  /** Counts of channels per 1/8 level, the last bin holding 8 levels or more */
  histogram: number[]
  /** The weights added to the reference summed to this (1 within rounding for a plan) */
  weightSum: number
}

/**
 * The difference between a blurred frame (`rgba16`, unorm16) and the linear-light mean of its source frames, encoded
 * back to the transfer: one number per colour channel of each pixel, in levels of 1023.
 */
export function compareToLinearMean(
  blurred: Uint16Array,
  mean: LinearMean,
  width: number,
): BlendComparison {
  if (blurred.length !== mean.pixels * 4) {
    throw new RangeError(`a frame of ${blurred.length / 4} pixels against a mean of ${mean.pixels}`)
  }
  const bins = HISTOGRAM_LEVELS * BINS_PER_LEVEL + 1
  const histogram = new Array<number>(bins).fill(0)
  const sums = mean.sums
  let max = -1
  let maxPixel = 0
  let maxChannel = 0
  let maxBlurred = 0
  let maxReference = 0
  let total = 0
  let over1 = 0
  let overHalf = 0
  for (let p = 0, s = 0, v = 0; p < mean.pixels; p++, v += 4, s += 3) {
    for (let c = 0; c < 3; c++) {
      const reference = linearToSrgb(Math.max(0, sums[s + c]!)) * 1023
      const actual = (blurred[v + c]! / 65535) * 1023
      const diff = Math.abs(actual - reference)
      total += diff
      if (diff > 1) over1++
      if (diff > 0.5) overHalf++
      histogram[Math.min(bins - 1, Math.floor(diff * BINS_PER_LEVEL))]!++
      if (diff > max) {
        max = diff
        maxPixel = p
        maxChannel = c
        maxBlurred = actual
        maxReference = reference
      }
    }
  }
  const channels = mean.pixels * 3
  let seen = 0
  let p9999 = 0
  for (let b = bins - 1; b >= 0; b--) {
    seen += histogram[b]!
    if (seen >= channels * 0.0001) {
      p9999 = (b + 1) / BINS_PER_LEVEL
      break
    }
  }
  return {
    pixels: mean.pixels,
    channels,
    maxDiffLevels: Math.max(0, max),
    meanDiffLevels: total / channels,
    p9999DiffLevels: p9999,
    over1Level: over1,
    overHalfLevel: overHalf,
    maxAt:
      max < 0
        ? null
        : {
            x: maxPixel % width,
            y: Math.floor(maxPixel / width),
            channel: (['r', 'g', 'b'] as const)[maxChannel]!,
            blurred: maxBlurred,
            reference: maxReference,
          },
    histogram,
    weightSum: mean.weightSum,
  }
}

/** What the decoder was asked to decode while a counter was running. */
export interface DecodeCount {
  /** `VideoDecoder.decode` calls: encoded chunks sent to a decoder, seeks and their preroll included */
  calls: number
  /** Different chunk timestamps among them (microseconds): the source frames reached */
  distinctTimestamps: number
  /** Chunks that were key frames */
  keyChunks: number
  firstTimestampUs: number | null
  lastTimestampUs: number | null
}

/** Counts the chunks sent to any `VideoDecoder` of the page until `stop()`; a page without WebCodecs counts nothing. */
export function startDecodeCounter(): { stop(): DecodeCount } {
  const decoderClass = (globalThis as { VideoDecoder?: typeof VideoDecoder }).VideoDecoder
  const stamps = new Set<number>()
  let calls = 0
  let keyChunks = 0
  let first: number | null = null
  let last: number | null = null
  if (!decoderClass) {
    return {
      stop: () => ({
        calls,
        distinctTimestamps: 0,
        keyChunks,
        firstTimestampUs: first,
        lastTimestampUs: last,
      }),
    }
  }
  const proto = decoderClass.prototype
  const original = proto.decode
  proto.decode = function (this: VideoDecoder, chunk: EncodedVideoChunk) {
    calls++
    stamps.add(chunk.timestamp)
    if (chunk.type === 'key') keyChunks++
    first = first === null ? chunk.timestamp : Math.min(first, chunk.timestamp)
    last = last === null ? chunk.timestamp : Math.max(last, chunk.timestamp)
    return original.call(this, chunk)
  }
  return {
    stop() {
      proto.decode = original
      return {
        calls,
        distinctTimestamps: stamps.size,
        keyChunks,
        firstTimestampUs: first,
        lastTimestampUs: last,
      }
    },
  }
}

/** The time one frame may take at 59.94 fps, in milliseconds. */
const FRAME_BUDGET_MS = 1001 / 60

/** How a run of frames went: rate from the mean, the tail, and how many frames missed the 59.94 budget. */
export interface FrameTimes {
  frames: number
  meanMs: number
  fps: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  overBudget: number
}

/** The summary of frame times in milliseconds. */
export function summariseFrameTimes(times: readonly number[]): FrameTimes {
  if (times.length === 0) {
    return { frames: 0, meanMs: 0, fps: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, overBudget: 0 }
  }
  const sorted = [...times].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  return {
    frames: times.length,
    meanMs: mean,
    fps: 1000 / mean,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: sorted[sorted.length - 1]!,
    overBudget: times.filter((t) => t > FRAME_BUDGET_MS).length,
  }
}

/** How two pictures of the same size differ, byte for byte. */
export interface PictureDifference {
  bytes: number
  differing: number
  maxDiff: number
  meanDiff: number
  identical: boolean
}

/** Compares two RGBA8 pictures (a canvas read-back). */
export function comparePictures(a: Uint8ClampedArray, b: Uint8ClampedArray): PictureDifference {
  if (a.length !== b.length) throw new RangeError(`pictures of ${a.length} and ${b.length} bytes`)
  let differing = 0
  let max = 0
  let total = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!)
    if (d !== 0) {
      differing++
      total += d
      if (d > max) max = d
    }
  }
  return {
    bytes: a.length,
    differing,
    maxDiff: max,
    meanDiff: total / a.length,
    identical: differing === 0,
  }
}
