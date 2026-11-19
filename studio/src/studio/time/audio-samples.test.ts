// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { bufferSamples, sampleAt } from './audio-samples'
import { LEGACY_RATES, RATES, rateValue, type Rate } from './rate'

const RATE_59_94: Rate = { num: 60000, den: 1001 }

describe('sampleAt at 59.94 and 48 kHz', () => {
  it('puts the first frames at the design 4.3 samples', () => {
    const samples: number[] = []
    for (let frame = 0; frame <= 5; frame += 1) {
      samples.push(sampleAt(frame, RATE_59_94))
    }

    expect(samples).toEqual([0, 800, 1601, 2402, 3203, 4004])
  })

  it('is floor(frame · 4004 / 5) for the first 200,001 frames', () => {
    let mismatches = 0
    let firstMismatch = -1
    for (let frame = 0; frame <= 200_000; frame += 1) {
      const expected = Number((BigInt(frame) * 4_004n) / 5n)
      if (sampleAt(frame, RATE_59_94) !== expected) {
        mismatches += 1
        if (firstMismatch < 0) {
          firstMismatch = frame
        }
      }
    }

    expect({ mismatches, firstMismatch }).toEqual({ mismatches: 0, firstMismatch: -1 })
  })

  it("is never low where today's float formula is, and is exact everywhere", () => {
    // The old formula is floor((frame / fps) * 48000) with fps the rate's double.
    const floatFps = rateValue(RATE_59_94)
    let floatLow = 0
    let firstFloatLow = -1
    let newMismatches = 0
    for (let frame = 0; frame <= 200_000; frame += 1) {
      const exact = Number((BigInt(frame) * 48_000n * 1_001n) / 60_000n)
      const today = Math.floor((frame / floatFps) * 48_000)
      if (sampleAt(frame, RATE_59_94) !== exact) {
        newMismatches += 1
      }
      if (today !== exact) {
        floatLow += 1
        if (firstFloatLow < 0) {
          firstFloatLow = frame
        }
      }
    }

    expect({ floatLow, firstFloatLow, newMismatches }).toEqual({
      floatLow: 1_104,
      firstFloatLow: 65,
      newMismatches: 0,
    })
    // Frame 65: the old formula gives 52,051, the exact position is 52,052.
    expect(Math.floor((65 / floatFps) * 48_000)).toBe(52_051)
    expect(sampleAt(65, RATE_59_94)).toBe(52_052)
  })

  it('puts the 20-minute frame where the integer arithmetic does', () => {
    expect(sampleAt(71_928, RATE_59_94)).toBe(57_599_942)
  })

  it('starts the timeline at sample 0', () => {
    expect(sampleAt(0, RATE_59_94)).toBe(0)
  })
})

describe('bufferSamples at 59.94 and 48 kHz', () => {
  it('covers the last frame of a 1,199-frame clip', () => {
    expect(bufferSamples(1_199, RATE_59_94)).toBe(960_160)
    expect(sampleAt(1_199, RATE_59_94)).toBe(960_159)
  })

  it('is the ceiling of the exact sample count for 20 minutes', () => {
    expect(bufferSamples(71_928, RATE_59_94)).toBe(57_599_943)
  })

  it('is zero for an empty timeline', () => {
    expect(bufferSamples(0, RATE_59_94)).toBe(0)
  })
})

describe('exact integer arithmetic', () => {
  it('keeps every 20-minute product below 2^53 at every rate', () => {
    const twentyMinutesSeconds = 20 * 60
    for (const rate of [...RATES, ...LEGACY_RATES]) {
      const frames = Math.floor(twentyMinutesSeconds * rateValue(rate))
      const product = frames * 48_000 * rate.den

      expect(Number.isSafeInteger(product)).toBe(true)
      expect(product).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    }
  })

  it('matches the BigInt reference at 20 minutes at every rate', () => {
    const twentyMinutesSeconds = 20 * 60
    for (const rate of [...RATES, ...LEGACY_RATES]) {
      const frames = Math.floor(twentyMinutesSeconds * rateValue(rate))
      const numerator = BigInt(frames) * 48_000n * BigInt(rate.den)
      const divisor = BigInt(rate.num)

      expect(sampleAt(frames, rate)).toBe(Number(numerator / divisor))
      expect(bufferSamples(frames, rate)).toBe(Number((numerator + divisor - 1n) / divisor))
    }
  })

  it('switches to BigInt above 2^53 and stays exact', () => {
    // 2,000,000,001 · 48000 · 1001 is 9.6e16, above Number.MAX_SAFE_INTEGER.
    const frame = 2_000_000_001
    const numerator = BigInt(frame) * 48_000n * 1_001n
    const divisor = 60_000n

    expect(frame * 48_000 * 1_001).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    expect(sampleAt(frame, RATE_59_94)).toBe(Number(numerator / divisor))
    expect(bufferSamples(frame, RATE_59_94)).toBe(Number((numerator + divisor - 1n) / divisor))
  })
})

describe('audio-samples input validation', () => {
  it('rejects a frame that is not an integer >= 0, naming it', () => {
    for (const frame of [-1, 1.5, Number.NaN]) {
      expect(() => sampleAt(frame, RATE_59_94)).toThrowError(RangeError)
      expect(() => sampleAt(frame, RATE_59_94)).toThrowError(/frame/)
    }
    expect(() => bufferSamples(-1, RATE_59_94)).toThrowError(/totalFrames/)
    expect(() => bufferSamples(1.5, RATE_59_94)).toThrowError(/totalFrames/)
  })

  it('rejects a sample rate that is not an integer > 0, naming it', () => {
    for (const sampleRate of [0, -48_000, 48_000.5]) {
      expect(() => sampleAt(0, RATE_59_94, sampleRate)).toThrowError(RangeError)
      expect(() => sampleAt(0, RATE_59_94, sampleRate)).toThrowError(/sampleRate/)
      expect(() => bufferSamples(0, RATE_59_94, sampleRate)).toThrowError(/sampleRate/)
    }
  })

  it('rejects a rate that is not a rate of positive integers', () => {
    expect(() => sampleAt(0, { num: 60000, den: 0 })).toThrowError(RangeError)
    expect(() => bufferSamples(0, { num: 0, den: 1 })).toThrowError(RangeError)
  })
})
