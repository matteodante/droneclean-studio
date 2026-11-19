// @vitest-environment node

/**
 * The varispeed read through a speed curve (design 7.1, section 4.3): the source sample each
 * output sample reads, the exact length of the result, and the 4-point interpolation that is
 * the identity on a whole-sample position.
 */

import { describe, expect, it } from 'vite-plus/test'
import { sampleAt, toRate } from '@/studio/time'
import { areaAt, frameAtArea, type SpeedCurve } from './curve'
import { curveSourceSeconds, resampleThroughCurve, type CurveAudioRead } from './audio'

const RATE_30 = toRate(30)
const SAMPLE_RATE = 48_000

/** The design's 1x -> 4x -> 1x ramp over 96 frames (3.2 s at 30 fps). */
const RAMP_96: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 32, speed: 4 },
    { frame: 64, speed: 4 },
    { frame: 96, speed: 1 },
  ],
}

/** 288 source frames: the ramp's exact span at equal rates, 9.6 s. */
const RAMP_SPAN_FRAMES = 288

/** A read of a segment that starts where its clip does, mixed from sample zero. */
function readOf(overrides: Partial<CurveAudioRead> = {}): CurveAudioRead {
  return {
    curve: RAMP_96,
    projectRate: RATE_30,
    sourceRate: RATE_30,
    sourceSampleRate: SAMPLE_RATE,
    outputSampleRate: SAMPLE_RATE,
    firstOutputSample: 0,
    outputSampleCount: 153_600,
    clipStartFrame: 0,
    preRollFrames: 0,
    averageSpeed: 3,
    sourceFrameOffset: 0,
    ...overrides,
  }
}

/** Decoded samples with a deterministic, non-repeating shape and no `-0`. */
function sourceSamples(length: number): Float32Array {
  const samples = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    samples[index] = Math.sin(index * 0.017) * 0.5 + ((index % 11) - 5) / 100
  }
  return samples
}

/** The output sample index the ramp reads source sample `sourceSample` at. */
function outputSampleForSourceSample(sourceSample: number): number {
  const area = sourceSample / ((SAMPLE_RATE * RATE_30.den) / RATE_30.num)
  return frameAtArea(RAMP_96, area) * (SAMPLE_RATE / 30)
}

/** The strongest sample within `radius` of `expected`, and its distance. */
function peakNear(samples: Float32Array, expected: number, radius: number): number {
  const centre = Math.round(expected)
  const from = Math.max(0, centre - radius)
  const to = Math.min(samples.length - 1, centre + radius)
  let best = centre
  let strength = 0
  for (let index = from; index <= to; index++) {
    const value = Math.abs(samples[index]!)
    if (value > strength) {
      strength = value
      best = index
    }
  }
  return best
}

describe('the varispeed read', () => {
  it('is the decoded sample itself at 1x, where the read positions are whole', () => {
    // 30 fps in and out at 48 kHz: one output sample per frame is 1,600 samples, and at 1x a
    // whole-sample read lands exactly on a decoded sample. A constant curve never reaches the
    // pipeline (the planner treats it as the clip of today); the kernel's identity is what
    // makes the ramp's 1x start and end seamless with it.
    const source = sourceSamples(153_600)
    const output = resampleThroughCurve(
      [source, source],
      readOf({
        curve: {
          keys: [
            { frame: 0, speed: 1 },
            { frame: 96, speed: 1 },
          ],
        },
        averageSpeed: 1,
      }),
    )

    expect(output).toHaveLength(2)
    expect(output[0]).toHaveLength(153_600)
    expect(output[0]).toEqual(source)
    expect(output[1]).toEqual(source)
  })

  it('folds the sample rate in: a 96 kHz source reads two samples per output sample at 1x', () => {
    const source = sourceSamples(20_000)
    const output = resampleThroughCurve(
      [source],
      readOf({
        curve: {
          keys: [
            { frame: 0, speed: 1 },
            { frame: 96, speed: 1 },
          ],
        },
        sourceSampleRate: 96_000,
        averageSpeed: 1,
      }),
    )

    for (let index = 0; index < 1_000; index++) {
      expect(output[0]![index]).toBe(source[index * 2]!)
    }
  })

  it('lands every impulse of the ramp within one sample of its curve position, in order', () => {
    const span = RAMP_SPAN_FRAMES * (SAMPLE_RATE / 30)
    const source = new Float32Array(span)
    const clicks: number[] = []
    for (let click = 24_000; click < span; click += 24_000) {
      source[click] = 1
      clicks.push(click)
    }

    const output = resampleThroughCurve([source], readOf())[0]!

    const found = clicks.map((click) => peakNear(output, outputSampleForSourceSample(click), 8))
    expect(found.length).toBeGreaterThan(10)
    for (const [index, sample] of found.entries()) {
      const expected = outputSampleForSourceSample(clicks[index]!)
      expect(Math.abs(sample - expected)).toBeLessThanOrEqual(1)
      expect(Math.abs(output[sample]!)).toBeGreaterThan(0)
      if (index > 0) expect(sample).toBeGreaterThan(found[index - 1]!)
    }
  })

  it('adds the cut’s remainder to the read, before any rounding', () => {
    // Half a source frame of remainder is 800 samples at 30 fps and 48 kHz: at 1x the read of
    // output sample `i` is source sample `i + 800`, exactly what the picture's
    // `floor(area(n) + 0.5)` shows.
    const source = sourceSamples(20_000)
    const output = resampleThroughCurve(
      [source],
      readOf({
        curve: {
          keys: [
            { frame: 0, speed: 1 },
            { frame: 96, speed: 1 },
          ],
        },
        averageSpeed: 1,
        sourceFrameOffset: 0.5,
      }),
    )[0]!

    for (let index = 0; index < 1_000; index++) {
      expect(output[index]).toBe(source[index + 800]!)
    }
  })

  it('converts the cut’s remainder with the source rate when it differs from the project’s (T5)', () => {
    // A 30 fps source in a 60 fps project: half a source frame is 1/60 s, 800 samples at
    // 48 kHz. The timeline frame is half as long, so the project rate would read it as 400.
    const source = sourceSamples(20_000)
    const output = resampleThroughCurve(
      [source],
      readOf({
        curve: {
          keys: [
            { frame: 0, speed: 1 },
            { frame: 96, speed: 1 },
          ],
        },
        projectRate: toRate(60),
        sourceRate: toRate(30),
        averageSpeed: 1,
        sourceFrameOffset: 0.5,
      }),
    )[0]!

    for (let index = 0; index < 1_000; index++) {
      expect(output[index]).toBe(source[index + 800]!)
    }
  })

  it('produces exactly the segment’s samples on the 59.94 grid', () => {
    const rate = toRate(59.94)
    const first = sampleAt(7, rate, SAMPLE_RATE)
    const count = sampleAt(18, rate, SAMPLE_RATE) - first
    const output = resampleThroughCurve(
      [sourceSamples(20_000)],
      readOf({ projectRate: rate, firstOutputSample: first, outputSampleCount: count }),
    )

    expect(output[0]).toHaveLength(count)
    expect(output[0]).toHaveLength(8809)
  })

  it('reads silence outside the decoded range instead of repeating its last sample', () => {
    const source = sourceSamples(100)
    const output = resampleThroughCurve(
      [source],
      readOf({
        curve: {
          keys: [
            { frame: 0, speed: 1 },
            { frame: 96, speed: 1 },
          ],
        },
        averageSpeed: 1,
        outputSampleCount: 1_000,
      }),
    )[0]!

    expect(output[99]).toBe(source[99]!)
    expect(output[100]).toBe(0)
    expect(output[800]).toBe(0)
  })

  it('reads a transition pre-roll at the clip’s average speed, then the curve', () => {
    // The segment starts ten frames before its clip and the clip's average is 3x, so the clip's
    // first frame reads 10 · 3 frames of source — the picture's own pre-roll rule.
    const source = new Float32Array(200_000)
    source[45_600] = 1
    source[48_000] = 1
    source[66_500] = 1
    const output = resampleThroughCurve(
      [source],
      readOf({
        curve: {
          keys: [
            { frame: 0, speed: 1 },
            { frame: 96, speed: 4 },
          ],
        },
        averageSpeed: 3,
        clipStartFrame: 20,
        preRollFrames: 10,
        firstOutputSample: sampleAt(10, RATE_30, SAMPLE_RATE),
        outputSampleCount: sampleAt(50, RATE_30, SAMPLE_RATE) - sampleAt(10, RATE_30, SAMPLE_RATE),
      }),
    )[0]!

    // 10 frames at 3x before the clip: 30 frames of source, 48,000 samples; half a frame
    // earlier is 800 samples of output and 2,400 of source back.
    expect(output[16_000]).toBe(source[48_000]!)
    expect(output[16_000 - 800]).toBe(source[45_600]!)
    // Ten frames into the clip the curve has added its own integral, 11.5625 speed x frames.
    expect(output[32_000]).toBe(source[66_500]!)
  })
})

describe('the source seconds of a curved segment', () => {
  it('is the curve’s exact integral, not the average times the frames', () => {
    const span = { curve: RAMP_96, projectRate: RATE_30, preRollFrames: 0, averageSpeed: 3 }

    expect(curveSourceSeconds(span, 96)).toBeCloseTo(9.6, 12)
    expect(curveSourceSeconds(span, 96)).toBeCloseTo(areaAt(RAMP_96, 96) / 30, 12)
  })

  it('adds the pre-roll at the average speed and holds the last key past the clip', () => {
    const span = { curve: RAMP_96, projectRate: RATE_30, preRollFrames: 10, averageSpeed: 3 }

    // 10 frames of pre-roll at 3x (30 source frames) plus the ramp's 288: 10.6 s.
    expect(curveSourceSeconds(span, 96)).toBeCloseTo((30 + 288) / 30, 12)
    // A post-roll runs at the last key's speed, 1x.
    expect(curveSourceSeconds(span, 106)).toBeCloseTo((30 + 288 + 10) / 30, 12)
  })
})
