// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { detectBeats, normalizeBeatStrength } from './detect'

const SAMPLE_RATE = 44100

/** A deterministic noise source in -1..1, so a failure is reproducible. */
function noise(seed: number): () => number {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 31 - 1
  }
}

/** A thump: a 60 Hz sine with a short exponential decay. */
function addKick(samples: Float32Array, at: number, gain: number): void {
  const start = Math.round(at * SAMPLE_RATE)
  for (let i = 0; start + i < samples.length && i < 0.3 * SAMPLE_RATE; i += 1) {
    const t = i / SAMPLE_RATE
    samples[start + i] =
      (samples[start + i] as number) + gain * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t / 0.07)
  }
}

/** A hi-hat: 25 ms of loud white noise with a fast decay. */
function addHat(samples: Float32Array, at: number, gain: number, random: () => number): void {
  const start = Math.round(at * SAMPLE_RATE)
  for (let i = 0; start + i < samples.length && i < 0.025 * SAMPLE_RATE; i += 1) {
    const t = i / SAMPLE_RATE
    samples[start + i] = (samples[start + i] as number) + gain * random() * Math.exp(-t / 0.008)
  }
}

/** A song: kicks at `kicks`, a hat on every eighth between them, and a bed of noise. */
function song(seconds: number, kicks: readonly number[]): Float32Array {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  const random = noise(7)
  for (let i = 0; i < samples.length; i += 1) samples[i] = 0.003 * random()
  for (const at of kicks) addKick(samples, at, 0.8)
  for (let at = 0.25; at < seconds - 0.1; at += 0.25) addHat(samples, at, 0.7, random)
  return samples
}

const KICKS = [0.5, 1.0, 1.5, 2.0, 3.1, 3.6, 4.1, 4.6, 6.0, 6.5, 7.0, 8.4, 8.9, 9.4]

describe('detectBeats', () => {
  it('finds each kick within one frame at 30 fps and ignores the hi-hats', () => {
    const times = detectBeats(song(10, KICKS), SAMPLE_RATE, { strength: 0.5 })

    expect(times).toHaveLength(KICKS.length)
    times.forEach((time, index) => {
      expect(Math.abs(time - (KICKS[index] as number))).toBeLessThan(1 / 30)
    })
  })

  it('does not mark hi-hats when there are no kicks at all', () => {
    expect(detectBeats(song(10, []), SAMPLE_RATE)).toEqual([])
  })

  it('keeps fewer hits as the strength grows', () => {
    const samples = new Float32Array(10 * SAMPLE_RATE)
    // Strong kicks on the second, weak ones in between.
    for (let at = 0.5; at < 9.5; at += 1) addKick(samples, at, 0.9)
    for (let at = 1; at < 9.5; at += 1) addKick(samples, at, 0.25)

    const lenient = detectBeats(samples, SAMPLE_RATE, { strength: 0 })
    const strict = detectBeats(samples, SAMPLE_RATE, { strength: 1 })

    expect(lenient.length).toBeGreaterThan(strict.length)
    expect(strict.length).toBeGreaterThan(0)
    // Every hit the strict setting keeps is one of the strong ones.
    for (const time of strict) expect(Math.abs(((time - 0.5) % 1) - 0)).toBeLessThan(0.03)
  })

  it('returns nothing for silence, an empty buffer or a bad rate', () => {
    expect(detectBeats(new Float32Array(SAMPLE_RATE), SAMPLE_RATE)).toEqual([])
    expect(detectBeats(new Float32Array(0), SAMPLE_RATE)).toEqual([])
    expect(detectBeats(song(2, [0.5]), 0)).toEqual([])
  })

  it('keeps two hits closer than the minimum gap as one', () => {
    const samples = new Float32Array(4 * SAMPLE_RATE)
    addKick(samples, 1.0, 0.8)
    addKick(samples, 1.08, 0.7)
    addKick(samples, 2.5, 0.8)

    const times = detectBeats(samples, SAMPLE_RATE)

    expect(times).toHaveLength(2)
    expect(Math.abs((times[0] as number) - 1.0)).toBeLessThan(1 / 30)
  })

  it('analyses a 3-minute song fast enough to be near-instant', () => {
    const kicks = Array.from({ length: 358 }, (_, i) => 0.5 + i * 0.5)
    const samples = song(180, kicks)

    const started = performance.now()
    const times = detectBeats(samples, SAMPLE_RATE)
    const elapsed = performance.now() - started
    console.info(`detectBeats on 180 s at ${SAMPLE_RATE} Hz: ${elapsed.toFixed(0)} ms`)

    expect(times).toHaveLength(kicks.length)
    expect(elapsed).toBeLessThan(2000)
  })
})

describe('normalizeBeatStrength', () => {
  it('clamps to 0..1 and falls back to the default', () => {
    expect(normalizeBeatStrength(-1)).toBe(0)
    expect(normalizeBeatStrength(3)).toBe(1)
    expect(normalizeBeatStrength(undefined)).toBe(0.5)
    expect(normalizeBeatStrength(Number.NaN)).toBe(0.5)
    expect(normalizeBeatStrength(0.2)).toBe(0.2)
  })
})
