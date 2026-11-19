/**
 * Audio sample positions for a timeline whose rate is a fraction.
 *
 * One boundary, one index: a segment's start and end, a fade's length and a ducking span all
 * call `sampleAt`, so adjacent segments tile exactly. The maths is integer — `floor(frame ·
 * sampleRate · den / num)` — because the float `frame / fps · sampleRate` lands one sample low
 * on some frames (design 1.5, 4.3).
 */

import { toRate, type Rate } from './rate'

/** The rate the editor mixes at; the export muxer's audio time base is this rate (pipeline.ts). */
const DEFAULT_SAMPLE_RATE = 48_000

/** A frame count must be an integer >= 0; the error names the argument and the function. */
function assertFrameCount(functionName: string, argumentName: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${functionName}: ${argumentName} must be an integer >= 0, got ${value}`)
  }
}

/** The sample rate must be a positive whole number of samples per second. */
function assertSampleRate(functionName: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${functionName}: sampleRate must be an integer > 0, got ${value}`)
  }
}

/**
 * `floor` or `ceil` of `count · sampleRate · den / num`, in exact integer arithmetic.
 *
 * In the app's range the numerator is an exact integer below 2^53 — 20 minutes at 59.94 and
 * 48 kHz is 3.5e12, the largest product of the offered rates — so the division is one correctly
 * rounded operation and the floor/ceil cannot land on the wrong side of an integer: the true
 * quotient is either an integer, which the division returns exactly, or at least `1/num` away
 * from one, while half an ulp is at most `numerator · 2^-53 / num`, which is smaller because the
 * numerator is below 2^53. Above that bound (about nine days at 240 fps) the same product is
 * computed in BigInt, so a very long timeline loses no sample instead of silently rounding.
 */
function scaleToSamples(
  functionName: string,
  count: number,
  sampleRate: number,
  rate: Rate,
  rounding: 'floor' | 'ceil',
): number {
  const product = count * sampleRate * rate.den
  if (product <= Number.MAX_SAFE_INTEGER) {
    const samples = product / rate.num
    return rounding === 'floor' ? Math.floor(samples) : Math.ceil(samples)
  }
  const numerator = BigInt(count) * BigInt(sampleRate) * BigInt(rate.den)
  const divisor = BigInt(rate.num)
  const samples = rounding === 'floor' ? numerator / divisor : (numerator + divisor - 1n) / divisor
  if (samples > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `${functionName}: ${count} frames at ${sampleRate} Hz give more samples than a number can hold`,
    )
  }
  return Number(samples)
}

/**
 * The output sample at which `frame` starts: `floor(frame · sampleRate · den / num)`.
 *
 * Use it for every audio boundary — a segment's start and end, a fade's sample length, a
 * ducking span — so two boundaries computed from the same frame land on the same sample. At
 * 59.94 and 48 kHz frames 0..5 sit at samples 0, 800, 1601, 2402, 3203, 4004 (design 1.5,
 * 4.3).
 *
 * @throws RangeError when `frame` is not an integer >= 0, when `sampleRate` is not an integer
 * > 0, or when the rate is not a rate of positive integers.
 */
export function sampleAt(frame: number, rate: Rate, sampleRate = DEFAULT_SAMPLE_RATE): number {
  assertFrameCount('sampleAt', 'frame', frame)
  assertSampleRate('sampleAt', sampleRate)
  return scaleToSamples('sampleAt', frame, sampleRate, toRate(rate), 'floor')
}

/**
 * The number of output samples that cover `totalFrames` frames: `ceil(totalFrames ·
 * sampleRate · den / num)`.
 *
 * The mix buffer and every export use it for the whole timeline only, so the last frame's span
 * is covered in full; `floor` would shorten every export by one sample. Every boundary inside
 * the buffer uses `sampleAt` instead (design 1.5, 4.3). At 59.94 and 48 kHz a 1,199-frame clip
 * needs 960,160 samples.
 *
 * @throws RangeError when `totalFrames` is not an integer >= 0, when `sampleRate` is not an
 * integer > 0, or when the rate is not a rate of positive integers.
 */
export function bufferSamples(
  totalFrames: number,
  rate: Rate,
  sampleRate = DEFAULT_SAMPLE_RATE,
): number {
  assertFrameCount('bufferSamples', 'totalFrames', totalFrames)
  assertSampleRate('bufferSamples', sampleRate)
  return scaleToSamples('bufferSamples', totalFrames, sampleRate, toRate(rate), 'ceil')
}
