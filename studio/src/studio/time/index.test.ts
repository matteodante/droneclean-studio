// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  LEGACY_RATES,
  RATES,
  bufferSamples,
  formatRate,
  frameToSeconds,
  rateValue,
  ratesEqual,
  sampleAt,
  secondsToFrame,
  sourceFrameAt,
  sourceTimeAt,
  timelineFramesForSource,
  toRate,
  type Rate,
  type SourceFrameQuery,
} from './index'

/**
 * Before 1.5 a project's rate was an integer and a clip's source rate was auto-matched to it, so
 * an old project's mapping, seconds and audio positions came from the float formulas below.
 * These tests hold the new integer functions to those formulas, so merging the fractional rates
 * cannot move a frame or a sample of an old project.
 *
 * The one deliberate difference: where today's float arithmetic is one sample low (25, 30, 50,
 * 60, 120 and 240 fps at some frames; 24 fps is exact on those frames), `sampleAt` returns the
 * exact position, one sample higher.
 */
const INTEGER_RATES = [24, 25, 30, 50, 60, 120, 240] as const
const FRAMES = 10_000

describe('an old integer-rate project behaves as it did', () => {
  it('maps a timeline frame to sourceStart + n and keeps a clip the same length', () => {
    const failures: string[] = []
    for (const fps of INTEGER_RATES) {
      const rate = toRate(fps)
      for (let timelineFrame = 0; timelineFrame <= FRAMES; timelineFrame += 1) {
        const sourceFrame = sourceFrameAt({
          timelineFrame,
          sourceStart: 100,
          speed: 1,
          sourceRate: rate,
          projectRate: rate,
        })
        if (sourceFrame !== 100 + timelineFrame) {
          failures.push(
            `${fps} fps: frame ${timelineFrame} -> ${sourceFrame}, expected ${100 + timelineFrame}`,
          )
        }
        const timelineFrames = timelineFramesForSource(timelineFrame, rate, rate, 1)
        if (timelineFrames !== timelineFrame) {
          failures.push(
            `${fps} fps: ${timelineFrame} source frames -> ${timelineFrames} timeline frames`,
          )
        }
      }
    }

    expect(failures.slice(0, 10)).toEqual([])
  })

  it('converts a frame to seconds exactly as n / fps did', () => {
    const failures: string[] = []
    for (const fps of INTEGER_RATES) {
      const rate = toRate(fps)
      for (let frame = 0; frame <= FRAMES; frame += 1) {
        const seconds = frameToSeconds(rate, frame)
        if (seconds !== frame / fps) {
          failures.push(`${fps} fps: frame ${frame} -> ${seconds}, expected ${frame / fps}`)
        }
      }
    }

    expect(failures.slice(0, 10)).toEqual([])
  })

  it('places audio samples exactly where floor(n / fps · 48000) was exact', () => {
    const failures: string[] = []
    const differingFrames = new Map<number, number>()
    for (const fps of INTEGER_RATES) {
      const rate = toRate(fps)
      let differing = 0
      for (let frame = 0; frame <= FRAMES; frame += 1) {
        const exact = Number((BigInt(frame) * 48_000n) / BigInt(fps))
        const today = Math.floor((frame / fps) * 48_000)
        const samples = sampleAt(frame, rate)
        if (samples !== exact) {
          failures.push(`${fps} fps: frame ${frame} -> sample ${samples}, exact ${exact}`)
        }
        if (today === exact) {
          // Where the old float was exact, the new function must agree with it.
          if (samples !== today) {
            failures.push(`${fps} fps: frame ${frame} -> sample ${samples}, today ${today}`)
          }
        } else {
          // Where it was not, it was one sample low and the exact value is one higher.
          differing += 1
          if (today !== exact - 1) {
            failures.push(`${fps} fps: frame ${frame} today is ${today - exact} from exact`)
          }
        }
      }
      differingFrames.set(fps, differing)
    }

    expect(failures.slice(0, 10)).toEqual([])
    expect(differingFrames.get(24)).toBe(0)
    expect(differingFrames.get(25) ?? 0).toBeGreaterThan(0)
  })
})

describe('the public surface the other slices import from @/studio/time', () => {
  const suggested: Rate = toRate(59.94)

  it('labels the offered and the legacy rates', () => {
    expect(RATES.map(formatRate)).toEqual([
      '23.976',
      '24',
      '25',
      '29.97',
      '30',
      '50',
      '59.94',
      '60',
    ])
    expect(LEGACY_RATES.map(formatRate)).toEqual(['120', '240'])
  })

  it('offers 59.94 as the rate a 59.94 source suggests', () => {
    expect(RATES.filter((rate) => ratesEqual(rate, suggested)).map(rateValue)).toEqual([
      60000 / 1001,
    ])
  })

  it('asks a decoder for the source frame start and sizes an export buffer', () => {
    const query: SourceFrameQuery = {
      timelineFrame: 6,
      sourceStart: 0,
      speed: 1,
      sourceRate: suggested,
      projectRate: suggested,
    }

    expect(sourceTimeAt(query)).toBe(0.1001)
    expect(bufferSamples(1_199, suggested)).toBe(960_160)
  })

  it('finds the frame a time belongs to', () => {
    expect(secondsToFrame(suggested, frameToSeconds(suggested, 1_799))).toBe(1_799)
  })
})
