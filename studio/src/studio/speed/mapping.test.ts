// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  sourceFrameAt as flatSourceFrameAt,
  timelineFramesForSource as flatTimelineFramesForSource,
  type Rate,
} from '@/studio/time'
import { areaAt, averageSpeed, type SpeedCurve, type SpeedKey } from './curve'
import {
  sourceFrameAt,
  sourceFramesAt,
  sourceSpanCoveredBy,
  timelineDurationForSource,
  timelineFramesForSource,
} from './mapping'

const RATE_59_94: Rate = { num: 60000, den: 1001 }
const RATE_60: Rate = { num: 60, den: 1 }
const RATE_29_97: Rate = { num: 30000, den: 1001 }
const RATE_25: Rate = { num: 25, den: 1 }
const RATE_23_976: Rate = { num: 24000, den: 1001 }

/** 20 minutes at 59.94, the loop of design 1.5, section 4.2. */
const TWENTY_MINUTES_FRAMES = 71_928

/** The 10-second ramp of design 7.1, section 5.2: 1x -> 4x, hold, 4x -> 1x, over 600 frames. */
const RAMP_600: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}

/**
 * The 20-minute ramp of design 7.1, section 5.2: 1x -> 4x over 360 frames (6 s at 59.94), the
 * 4x hold, then 4x -> 1x over the last 360.
 */
const RAMP_20_MIN: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 360, speed: 4 },
    { frame: 71_568, speed: 4 },
    { frame: 71_928, speed: 1 },
  ],
}

/** A constant curve: one key, the speed holding for every frame; two when a span is given. */
function flatCurve(speed: number, frames = 0): SpeedCurve {
  const first: SpeedKey = { frame: 0, speed }
  return frames === 0 ? { keys: [first] } : { keys: [first, { frame: frames, speed }] }
}

function at(
  curve: SpeedCurve,
  timelineFrame: number,
  sourceStart: number,
  sourceRate: Rate,
  projectRate: Rate,
): number {
  return sourceFrameAt(curve, timelineFrame, sourceStart, sourceRate, projectRate)
}

describe('the design table through the mapping', () => {
  it('maps the 10-second ramp to 2,310 source frames with average speed 3.85', () => {
    expect(at(RAMP_600, 0, 0, RATE_59_94, RATE_59_94)).toBe(0)
    expect(at(RAMP_600, 600, 0, RATE_59_94, RATE_59_94)).toBe(2_310)
    expect(averageSpeed(RAMP_600)).toBe(3.85)
    // The clip's stored `speed` is the average: the time module's flat forward map with it
    // spends the curve's span, which is what a length calculation of the editor uses.
    expect(
      flatSourceFrameAt({
        timelineFrame: 600,
        sourceStart: 0,
        speed: averageSpeed(RAMP_600),
        sourceRate: RATE_59_94,
        projectRate: RATE_59_94,
      }),
    ).toBe(2_310)
    // And the inverse takes the span back to the clip's 600 frames.
    expect(timelineFramesForSource(RAMP_600, 2_310, RATE_59_94, RATE_59_94)).toBe(600)
  })

  it('walks the 10-second ramp with no repeat, no step back and no step over 4', () => {
    let previous = at(RAMP_600, 0, 0, RATE_59_94, RATE_59_94)
    let repeats = 0
    let stepsBack = 0
    let maxStep = 0
    let holdOffBeat = 0
    for (let timelineFrame = 1; timelineFrame <= 600; timelineFrame += 1) {
      const frame = at(RAMP_600, timelineFrame, 0, RATE_59_94, RATE_59_94)
      const step = frame - previous
      if (step === 0) repeats += 1
      if (step < 0) stepsBack += 1
      maxStep = Math.max(maxStep, step)
      if (timelineFrame > 30 && timelineFrame <= 570 && step !== 4) holdOffBeat += 1
      previous = frame
    }

    expect({ repeats, stepsBack, maxStep, holdOffBeat }).toEqual({
      repeats: 0,
      stepsBack: 0,
      maxStep: 4,
      holdOffBeat: 0,
    })
  })

  it('gives a constant curve the twelve-frame table of the time module', () => {
    const normal = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    expect(
      [...Array(12).keys()].map((n) => at(flatCurve(1), n, 0, RATE_59_94, RATE_59_94)),
    ).toEqual(normal)
    expect(
      [...Array(12).keys()].map((n) => at(flatCurve(2), n, 0, RATE_59_94, RATE_59_94)),
    ).toEqual(normal.map((frame) => frame * 2))
    expect(
      [...Array(12).keys()].map((n) => at(flatCurve(0.5), n, 0, RATE_59_94, RATE_59_94)),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
    expect(
      [...Array(12).keys()].map((n) => at(flatCurve(1, 100), n, 3, RATE_29_97, RATE_59_94)),
    ).toEqual([3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8])
  })

  it('consumes 286,346 source frames on the 20-minute ramp, with 0 repeats', () => {
    const source = RATE_59_94
    const project = RATE_60
    let previous = at(RAMP_20_MIN, 0, 0, source, project)
    const frames: number[] = [previous]
    let repeats = 0
    let stepsBack = 0
    let maxStep = 0
    for (let timelineFrame = 1; timelineFrame < TWENTY_MINUTES_FRAMES; timelineFrame += 1) {
      const frame = at(RAMP_20_MIN, timelineFrame, 0, source, project)
      const step = frame - previous
      if (step === 0) repeats += 1
      if (step < 0) stepsBack += 1
      maxStep = Math.max(maxStep, step)
      previous = frame
      frames.push(frame)
    }

    // Every value is a function of the index: asking again in reverse order gives the same
    // integers, so nothing accumulated along the first pass (no drift, design 7.1, 4.2).
    let drift = 0
    for (let timelineFrame = frames.length - 1; timelineFrame >= 0; timelineFrame -= 1) {
      const expected = frames[timelineFrame]
      if (
        expected === undefined ||
        at(RAMP_20_MIN, timelineFrame, 0, source, project) !== expected
      ) {
        drift += 1
      }
    }

    // The frame the clip's end boundary falls in is 286,345; the last source frame it shows is
    // the one before it, and the span reaches the end of 286,345: 0..286,345 consumed, 286,346.
    expect(at(RAMP_20_MIN, TWENTY_MINUTES_FRAMES, 0, source, project)).toBe(286_345)
    const lastSpan = sourceSpanCoveredBy(RAMP_20_MIN, TWENTY_MINUTES_FRAMES - 1, 0, source, project)
    expect(Math.floor(lastSpan.startFrame)).toBe(286_344)
    expect(Math.ceil(lastSpan.endFrame)).toBe(286_346)

    expect({ repeats, stepsBack, maxStep, drift }).toEqual({
      repeats: 0,
      stepsBack: 0,
      maxStep: 4,
      drift: 0,
    })
  })
})

describe('a flat curve is the time module, bit for bit', () => {
  it('maps 20 minutes at 1x exactly as @/studio/time, ascending and descending', () => {
    const curve = flatCurve(1)
    const query = (timelineFrame: number) => ({
      timelineFrame,
      sourceStart: 0,
      speed: 1,
      sourceRate: RATE_59_94,
      projectRate: RATE_59_94,
    })
    let ascending = 0
    let descending = 0
    for (let timelineFrame = 0; timelineFrame < TWENTY_MINUTES_FRAMES; timelineFrame += 1) {
      if (
        at(curve, timelineFrame, 0, RATE_59_94, RATE_59_94) !==
        flatSourceFrameAt(query(timelineFrame))
      ) {
        ascending += 1
      }
    }
    for (let timelineFrame = TWENTY_MINUTES_FRAMES - 1; timelineFrame >= 0; timelineFrame -= 1) {
      if (
        at(curve, timelineFrame, 0, RATE_59_94, RATE_59_94) !==
        flatSourceFrameAt(query(timelineFrame))
      ) {
        descending += 1
      }
    }

    expect({ ascending, descending }).toEqual({ ascending: 0, descending: 0 })
  })

  it('maps a flat curve of any speed and rate exactly as @/studio/time', () => {
    const cases: {
      speed: number
      sourceRate: Rate
      projectRate: Rate
      sourceStart: number
      frames: number
    }[] = [
      { speed: 2, sourceRate: RATE_59_94, projectRate: RATE_59_94, sourceStart: 0, frames: 10_000 },
      { speed: 0.5, sourceRate: RATE_59_94, projectRate: RATE_60, sourceStart: 7, frames: 10_000 },
      {
        speed: 1.37,
        sourceRate: RATE_29_97,
        projectRate: RATE_59_94,
        sourceStart: 0,
        frames: 10_000,
      },
      { speed: 1, sourceRate: RATE_25, projectRate: RATE_59_94, sourceStart: 100, frames: 10_000 },
      {
        speed: 8,
        sourceRate: RATE_23_976,
        projectRate: RATE_59_94,
        sourceStart: 0,
        frames: 10_000,
      },
      { speed: 10, sourceRate: RATE_59_94, projectRate: RATE_60, sourceStart: 0, frames: 10_000 },
    ]
    const failures: string[] = []
    for (const row of cases) {
      for (const curve of [flatCurve(row.speed), flatCurve(row.speed, 5_000)]) {
        for (let timelineFrame = 0; timelineFrame < row.frames; timelineFrame += 1) {
          const curved = at(curve, timelineFrame, row.sourceStart, row.sourceRate, row.projectRate)
          const flat = flatSourceFrameAt({
            timelineFrame,
            sourceStart: row.sourceStart,
            speed: row.speed,
            sourceRate: row.sourceRate,
            projectRate: row.projectRate,
          })
          if (curved !== flat) {
            failures.push(`${row.speed}x ${timelineFrame}: ${curved} != ${flat}`)
          }
        }
      }
    }

    expect(failures.slice(0, 10)).toEqual([])
  })

  it('gives a flat curve the time module’s clip length', () => {
    const failures: string[] = []
    for (const speed of [1, 2, 0.5, 1.37]) {
      for (const [sourceRate, projectRate] of [
        [RATE_59_94, RATE_59_94],
        [RATE_59_94, RATE_60],
        [RATE_29_97, RATE_59_94],
        [RATE_25, RATE_59_94],
      ] as const) {
        for (let sourceFrames = 0; sourceFrames <= 5_000; sourceFrames += 1) {
          const curved = timelineFramesForSource(
            flatCurve(speed, 5_000),
            sourceFrames,
            sourceRate,
            projectRate,
          )
          const flat = flatTimelineFramesForSource(sourceFrames, sourceRate, projectRate, speed)
          if (curved !== flat) {
            failures.push(`${speed}x ${sourceRate.num}/${sourceRate.den}: ${curved} != ${flat}`)
          }
        }
      }
    }

    expect(failures.slice(0, 10)).toEqual([])
  })
})

describe('timelineDurationForSource (the design’s inverse)', () => {
  it('is exact to 1.4e-14 source frames over 2,310 spans', () => {
    let maxError = 0
    for (let sourceFrames = 0; sourceFrames <= 2_309; sourceFrames += 1) {
      const duration = timelineDurationForSource(RAMP_600, sourceFrames, RATE_59_94, RATE_59_94)
      // Equal rates: an area unit is a source frame.
      maxError = Math.max(maxError, Math.abs(areaAt(RAMP_600, duration) - sourceFrames))
    }

    expect(maxError).toBeLessThan(1.5e-14)
  })

  it('is within 2 source frames when rounded to a whole timeline frame', () => {
    let maxError = 0
    for (let sourceFrames = 0; sourceFrames <= 2_309; sourceFrames += 1) {
      const duration = timelineDurationForSource(RAMP_600, sourceFrames, RATE_59_94, RATE_59_94)
      const rounded = Math.round(duration)
      maxError = Math.max(
        maxError,
        Math.abs(sourceFramesAt(RAMP_600, rounded, RATE_59_94, RATE_59_94) - sourceFrames),
      )
    }

    expect(maxError).toBeLessThanOrEqual(2)
  })

  it('returns zero for an empty source span', () => {
    expect(timelineDurationForSource(RAMP_600, 0, RATE_59_94, RATE_59_94)).toBe(0)
    expect(timelineFramesForSource(RAMP_600, 0, RATE_59_94, RATE_59_94)).toBe(0)
  })

  it('gives the clip length that just covers the span', () => {
    const failures: string[] = []
    for (let sourceFrames = 1; sourceFrames <= 2_309; sourceFrames += 1) {
      const frames = timelineFramesForSource(RAMP_600, sourceFrames, RATE_59_94, RATE_59_94)
      if (areaAt(RAMP_600, frames) < sourceFrames) {
        failures.push(`${sourceFrames}: ${frames} frames do not reach it`)
      }
      if (frames > 0 && areaAt(RAMP_600, frames - 1) >= sourceFrames) {
        failures.push(`${sourceFrames}: ${frames - 1} frames already reach it`)
      }
    }

    expect(failures.slice(0, 10)).toEqual([])
  })

  it('counts the rate ratio once, in the source span and not in the curve', () => {
    // 2,310 source frames at 59.94 in a 60 fps project are 2,310·1001·60/60000 = 2,312.31 area
    // units; the curve reaches that 602.31 frames in (its last 2.31 at the 1x it ends on), and
    // its own 600-frame span consumes 2,310·60000·1/(1001·60) = 2,307.69 source frames.
    const duration = timelineDurationForSource(RAMP_600, 2_310, RATE_59_94, RATE_60)
    expect(areaAt(RAMP_600, duration)).toBeCloseTo((2_310 * 1001 * 60) / 60000, 9)
    expect(duration).toBeCloseTo(602.31, 9)
    expect(sourceFramesAt(RAMP_600, 600, RATE_59_94, RATE_60)).toBeCloseTo(
      (2_310 * 60000) / (1001 * 60),
      9,
    )
  })
})

describe('sourceSpanCoveredBy (motion blur, 7.2)', () => {
  const count = (curve: SpeedCurve, timelineFrame: number, projectRate = RATE_59_94): number => {
    const span = sourceSpanCoveredBy(curve, timelineFrame, 0, RATE_59_94, projectRate)
    return Math.ceil(span.endFrame) - Math.floor(span.startFrame)
  }

  it('is one source frame in a 1x hold, four in a 4x hold, ten at 10x', () => {
    const hold: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 100, speed: 1 },
        { frame: 200, speed: 4 },
      ],
    }
    expect(count(hold, 50)).toBe(1)
    expect(count(flatCurve(4), 50)).toBe(4)
    expect(count(flatCurve(10), 50)).toBe(10)
  })

  it('is at most 11 source frames at 10x with a 59.94 source in a 60 project', () => {
    let smallest = Number.POSITIVE_INFINITY
    let largest = 0
    for (let timelineFrame = 0; timelineFrame < 1_000; timelineFrame += 1) {
      const frames = count(flatCurve(10), timelineFrame, RATE_60)
      smallest = Math.min(smallest, frames)
      largest = Math.max(largest, frames)
    }

    expect({ smallest, largest }).toEqual({ smallest: 10, largest: 11 })
  })

  it('has no gap across the 10-second ramp, and covers 0..2,309', () => {
    let gaps = 0
    let previousEnd = 0
    for (let timelineFrame = 0; timelineFrame < 600; timelineFrame += 1) {
      const span = sourceSpanCoveredBy(RAMP_600, timelineFrame, 0, RATE_59_94, RATE_59_94)
      if (Math.floor(span.startFrame) > previousEnd) {
        gaps += 1
      }
      previousEnd = Math.ceil(span.endFrame)
    }

    expect(gaps).toBe(0)
    expect(previousEnd).toBe(2_310)
  })

  it('counts sourceStart, and shares each boundary with the next output frame', () => {
    const span = sourceSpanCoveredBy(RAMP_600, 100, 500, RATE_59_94, RATE_59_94)
    expect(span.startFrame).toBe(500 + sourceFramesAt(RAMP_600, 100, RATE_59_94, RATE_59_94))
    const next = sourceSpanCoveredBy(RAMP_600, 101, 500, RATE_59_94, RATE_59_94)
    expect(next.startFrame).toBe(span.endFrame)
    expect(span.endFrame).toBeGreaterThan(span.startFrame)
  })
})

describe('mapping input validation', () => {
  it('rejects a timeline frame that is not an integer >= 0, naming it', () => {
    for (const timelineFrame of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => at(RAMP_600, timelineFrame, 0, RATE_59_94, RATE_59_94)).toThrowError(
        /timelineFrame/,
      )
      expect(() => sourceFramesAt(RAMP_600, timelineFrame, RATE_59_94, RATE_59_94)).toThrowError(
        /timelineFrame/,
      )
      expect(() =>
        sourceSpanCoveredBy(RAMP_600, timelineFrame, 0, RATE_59_94, RATE_59_94),
      ).toThrowError(/timelineFrame/)
    }
  })

  it('rejects a source start that is not an integer >= 0, naming it', () => {
    expect(() => at(RAMP_600, 0, -1, RATE_59_94, RATE_59_94)).toThrowError(/sourceStart/)
    expect(() => sourceSpanCoveredBy(RAMP_600, 0, 0.5, RATE_59_94, RATE_59_94)).toThrowError(
      /sourceStart/,
    )
  })

  it('rejects a source frame count that is not an integer >= 0, naming it', () => {
    expect(() => timelineDurationForSource(RAMP_600, -1, RATE_59_94, RATE_59_94)).toThrowError(
      /sourceFrames/,
    )
    expect(() => timelineFramesForSource(RAMP_600, 1.5, RATE_59_94, RATE_59_94)).toThrowError(
      /sourceFrames/,
    )
  })

  it('rejects a rate that is not a rate of positive integers', () => {
    const broken: Rate = { num: 60000, den: 0 }
    expect(() => at(RAMP_600, 0, 0, broken, RATE_59_94)).toThrowError(RangeError)
    expect(() => at(flatCurve(1), 0, 0, RATE_59_94, broken)).toThrowError(RangeError)
    expect(() => sourceFramesAt(RAMP_600, 0, broken, RATE_59_94)).toThrowError(RangeError)
    expect(() => timelineDurationForSource(RAMP_600, 1, broken, RATE_59_94)).toThrowError(
      RangeError,
    )
    expect(() => timelineFramesForSource(flatCurve(1), 1, RATE_59_94, broken)).toThrowError(
      RangeError,
    )
  })

  it('rejects a broken curve, naming its field', () => {
    const broken: SpeedCurve = { keys: [] }
    expect(() => at(broken, 0, 0, RATE_59_94, RATE_59_94)).toThrowError(/curve\.keys/)
    expect(() => sourceFramesAt(broken, 0, RATE_59_94, RATE_59_94)).toThrowError(/curve\.keys/)
    expect(() => timelineDurationForSource(broken, 1, RATE_59_94, RATE_59_94)).toThrowError(
      /curve\.keys/,
    )
    expect(() => timelineFramesForSource(broken, 1, RATE_59_94, RATE_59_94)).toThrowError(
      /curve\.keys/,
    )
    expect(() => sourceSpanCoveredBy(broken, 0, 0, RATE_59_94, RATE_59_94)).toThrowError(
      /curve\.keys/,
    )
  })
})
