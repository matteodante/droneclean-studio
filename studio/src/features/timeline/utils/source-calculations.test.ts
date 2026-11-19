// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  calculateSplitSourceBoundaries,
  getMaxStartExtension,
  getMaxTimelineDuration,
  getSafeTrimBefore,
  isWithinSourceBounds,
  mapSourceWindowOverlap,
  sourceToTimelineFrames,
  timelineToSourceFrames,
} from './source-calculations'

/**
 * The source rate a probe carries for the design's fractional rates: mediabunny snaps a
 * 59.94 clip's `bestGuessFrameRate` to `60 / 1.001`, one ulp from `60000 / 1001`.
 */
const SOURCE_59_94 = 60 / 1.001
const PROJECT_59_94 = 59.94

describe('timelineToSourceFrames is the exact mapping of design 1.5, section 4.2', () => {
  const cases = [
    // A 59.94 source in a 59.94 project advances one source frame per timeline frame.
    {
      timelineFrames: 1_199,
      speed: 1,
      timelineFps: PROJECT_59_94,
      sourceFps: SOURCE_59_94,
      source: 1_199,
    },
    // A 60 fps source advances 1.001, floored from the frame index.
    { timelineFrames: 1_199, speed: 1, timelineFps: PROJECT_59_94, sourceFps: 60, source: 1_200 },
    { timelineFrames: 1_200, speed: 1, timelineFps: PROJECT_59_94, sourceFps: 60, source: 1_201 },
    // A 29.97 source in a 59.94 project advances half a frame per timeline frame.
    {
      timelineFrames: 1_199,
      speed: 1,
      timelineFps: PROJECT_59_94,
      sourceFps: 30000 / 1001,
      source: 599,
    },
    // Speed multiplies the advance.
    { timelineFrames: 600, speed: 2, timelineFps: 30, sourceFps: 60, source: 2_400 },
    { timelineFrames: 601, speed: 0.5, timelineFps: 30, sourceFps: 60, source: 601 },
    // Clockwise and back.
    { timelineFrames: 10, speed: 2, timelineFps: 30, sourceFps: 60, source: 40 },
    { timelineFrames: -10, speed: 2, timelineFps: 30, sourceFps: 60, source: -40 },
  ]

  for (const row of cases) {
    it(`${row.timelineFrames} timeline frames at speed ${row.speed} (${row.timelineFps} → ${row.sourceFps}) is ${row.source} source frames`, () => {
      expect(
        timelineToSourceFrames(row.timelineFrames, row.speed, row.timelineFps, row.sourceFps),
      ).toBe(row.source)
    })
  }

  it('returns the count unchanged at equal rates and speed 1', () => {
    expect(timelineToSourceFrames(123_456, 1, PROJECT_59_94, SOURCE_59_94)).toBe(123_456)
  })

  it('gives the exact 1,197 where the old round gave 1,198 (design 1.5, 4.7)', () => {
    // 1199 timeline frames of a 60 fps project show 59.94/60 of a source frame each.
    expect(timelineToSourceFrames(1_199, 1, 60, PROJECT_59_94)).toBe(1_197)
  })

  it('is a function of the frame index over 20 minutes', () => {
    let failures = 0
    for (let timelineFrame = 0; timelineFrame < 71_928; timelineFrame += 1) {
      if (timelineToSourceFrames(timelineFrame, 1, PROJECT_59_94, SOURCE_59_94) !== timelineFrame) {
        failures += 1
      }
    }

    expect(failures).toBe(0)
  })
})

describe('sourceToTimelineFrames', () => {
  it('is the timeline frame that holds the source position, floored', () => {
    expect(sourceToTimelineFrames(1_200, 1, 60, PROJECT_59_94)).toBe(1_198)
    expect(sourceToTimelineFrames(1_199, 1, SOURCE_59_94, PROJECT_59_94)).toBe(1_199)
    expect(sourceToTimelineFrames(60, 1, 60, 30)).toBe(30)
    expect(sourceToTimelineFrames(60, 2, 60, 30)).toBe(15)
  })

  it('returns the count unchanged at equal rates and speed 1', () => {
    expect(sourceToTimelineFrames(4_321, 1, PROJECT_59_94, PROJECT_59_94)).toBe(4_321)
  })

  it('keeps the magnitude of a negative delta', () => {
    expect(sourceToTimelineFrames(-60, 2, 60, 30)).toBe(-15)
  })
})

describe('trim and split keep source bounds exact', () => {
  it('splits a 60 fps clip in a 59.94 project on the frame the renderer shows', () => {
    const boundaries = calculateSplitSourceBoundaries(0, 600, 600, 1, PROJECT_59_94, 60)

    // Timeline frame 600 shows source frame floor(600 · 60 / 59.94) = 600.
    expect(boundaries.left.sourceEnd).toBe(600)
    expect(boundaries.right.sourceStart).toBe(600)
    // The clip's whole source span is floor(1,200 · 60 / 59.94) = 1,201 source frames.
    expect(boundaries.right.sourceEnd).toBe(1_201)
  })

  it('splits a 59.94 clip in a 59.94 project on the same frame', () => {
    const boundaries = calculateSplitSourceBoundaries(100, 450, 749, 1, PROJECT_59_94, SOURCE_59_94)

    expect(boundaries.left.sourceEnd).toBe(550)
    expect(boundaries.right.sourceStart).toBe(550)
    expect(boundaries.right.sourceEnd).toBe(1_299)
  })

  it('trims a 59.94 clip by the exact number of source frames', () => {
    expect(timelineToSourceFrames(1_000, 1, PROJECT_59_94, SOURCE_59_94)).toBe(1_000)
    expect(timelineToSourceFrames(1_000, 1, PROJECT_59_94, 60)).toBe(1_001)
  })

  it('keeps a clip inside its source bounds', () => {
    expect(isWithinSourceBounds(0, 1_199, 1, 1_199, 0, PROJECT_59_94, SOURCE_59_94)).toBe(true)
    expect(isWithinSourceBounds(0, 1_200, 1, 1_199, 0, PROJECT_59_94, SOURCE_59_94)).toBe(false)
    expect(getSafeTrimBefore(500, 1_199, 1, 1_300, PROJECT_59_94, SOURCE_59_94)).toBe(101)
  })

  it('computes the available length of a 59.94 source in a 59.94 project', () => {
    expect(getMaxTimelineDuration(1_199, 100, 1, SOURCE_59_94, PROJECT_59_94)).toBe(1_099)
    expect(getMaxStartExtension(1_199, 1, SOURCE_59_94, PROJECT_59_94)).toBe(1_199)
  })

  it('maps a sub-composition window with the same exact conversion', () => {
    const mapping = mapSourceWindowOverlap({
      itemStart: 100,
      itemDuration: 500,
      wrapperDuration: 1_200,
      wrapperSourceStart: 0,
      timelineFps: PROJECT_59_94,
      fallbackSourceFps: 60,
    })

    expect(mapping).toMatchObject({
      mappedFrom: 99,
      mappedEnd: 599,
      mappedDuration: 500,
    })
  })
})
