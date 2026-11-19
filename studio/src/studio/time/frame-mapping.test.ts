// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { sourceFrameAt, sourceTimeAt, timelineFramesForSource } from './frame-mapping'
import { frameToSeconds, secondsToFrame, type Rate } from './rate'

const PROJECT_59_94: Rate = { num: 60000, den: 1001 }
const SOURCE_59_94: Rate = { num: 60000, den: 1001 }
const SOURCE_29_97: Rate = { num: 30000, den: 1001 }
const SOURCE_60: Rate = { num: 60, den: 1 }
const SOURCE_25: Rate = { num: 25, den: 1 }
const SOURCE_23_976: Rate = { num: 24000, den: 1001 }

function firstSourceFrames(
  sourceRate: Rate,
  count: number,
  speed: number,
  sourceStart = 0,
): number[] {
  const frames: number[] = []
  for (let timelineFrame = 0; timelineFrame < count; timelineFrame += 1) {
    frames.push(
      sourceFrameAt({
        timelineFrame,
        sourceStart,
        speed,
        sourceRate,
        projectRate: PROJECT_59_94,
      }),
    )
  }
  return frames
}

/** 20 minutes of a 59.94 project. */
const TWENTY_MINUTES_FRAMES = 71_928

function twentyMinuteCounts(sourceRate: Rate): {
  distinct: number
  repeats: number
  skips: number
  lastSourceFrame: number
} {
  const seen = new Set<number>()
  let lastSourceFrame = -1
  for (let timelineFrame = 0; timelineFrame < TWENTY_MINUTES_FRAMES; timelineFrame += 1) {
    const sourceFrame = sourceFrameAt({
      timelineFrame,
      sourceStart: 0,
      speed: 1,
      sourceRate,
      projectRate: PROJECT_59_94,
    })
    seen.add(sourceFrame)
    if (sourceFrame > lastSourceFrame) {
      lastSourceFrame = sourceFrame
    }
  }
  return {
    distinct: seen.size,
    repeats: TWENTY_MINUTES_FRAMES - seen.size,
    skips: lastSourceFrame + 1 - seen.size,
    lastSourceFrame,
  }
}

/**
 * The first twelve timeline frames of a 59.94 project, source start 0. The first eight of each
 * column are the table of design 1.5, section 4.2; the speeds 2 and 0.5 there are the rows of
 * the 59.94 source, repeated here for the other four sources as section 4.8 asks.
 */
const TWELVE_FRAMES = [
  {
    name: '59.94',
    rate: SOURCE_59_94,
    normal: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    double: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
    half: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  },
  {
    name: '29.97',
    rate: SOURCE_29_97,
    normal: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
    double: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    half: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
  },
  {
    name: '60',
    rate: SOURCE_60,
    normal: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    double: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
    half: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  },
  {
    name: '25',
    rate: SOURCE_25,
    normal: [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4],
    double: [0, 0, 1, 2, 3, 4, 5, 5, 6, 7, 8, 9],
    half: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2],
  },
  {
    name: '23.976',
    rate: SOURCE_23_976,
    normal: [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4],
    double: [0, 0, 1, 2, 3, 4, 4, 5, 6, 7, 8, 8],
    half: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2],
  },
]

/**
 * The 20-minute loop of design 1.5, section 4.2. The design prints 30,030 distinct and 41,970
 * repeats for the 25 fps source; those add up to 72,000, not 71,928, so that row was measured
 * over a 72,000-frame loop (20 minutes at 60 fps). Counted over every one of the 71,928 frames
 * the other rows use, a 25 fps source has 30,000 distinct frames (0..29,999, each shown two or
 * three times) and 41,928 repeats. The test below asserts the counts of this table.
 */
const TWENTY_MINUTE_COUNTS = [
  {
    name: '59.94',
    rate: SOURCE_59_94,
    distinct: 71_928,
    repeats: 0,
    skips: 0,
    lastSourceFrame: 71_927,
  },
  {
    name: '29.97',
    rate: SOURCE_29_97,
    distinct: 35_964,
    repeats: 35_964,
    skips: 0,
    lastSourceFrame: 35_963,
  },
  {
    name: '23.976',
    rate: SOURCE_23_976,
    distinct: 28_771,
    repeats: 43_157,
    skips: 0,
    lastSourceFrame: 28_770,
  },
  {
    name: '25',
    rate: SOURCE_25,
    distinct: 30_000,
    repeats: 41_928,
    skips: 0,
    lastSourceFrame: 29_999,
  },
  { name: '60', rate: SOURCE_60, distinct: 71_928, repeats: 0, skips: 71, lastSourceFrame: 71_998 },
]

/** The clip lengths of the 20-second clip of design 1.5, section 4.2, at normal speed. */
const CLIP_LENGTHS = [
  { name: '59.94', rate: SOURCE_59_94, sourceFrames: 1_199, timelineFrames: 1_199 },
  { name: '29.97', rate: SOURCE_29_97, sourceFrames: 599, timelineFrames: 1_198 },
  { name: '60', rate: SOURCE_60, sourceFrames: 1_200, timelineFrames: 1_199 },
  { name: '25', rate: SOURCE_25, sourceFrames: 500, timelineFrames: 1_199 },
  { name: '23.976', rate: SOURCE_23_976, sourceFrames: 480, timelineFrames: 1_200 },
]

describe('sourceFrameAt in a 59.94 project', () => {
  for (const row of TWELVE_FRAMES) {
    describe(`a ${row.name} source`, () => {
      it('maps the first twelve timeline frames at normal speed', () => {
        expect(firstSourceFrames(row.rate, 12, 1)).toEqual(row.normal)
      })

      it('maps them at speed 2', () => {
        expect(firstSourceFrames(row.rate, 12, 2)).toEqual(row.double)
      })

      it('maps them at speed 0.5', () => {
        expect(firstSourceFrames(row.rate, 12, 0.5)).toEqual(row.half)
      })

      it('adds the clip trim-in to every frame', () => {
        expect(firstSourceFrames(row.rate, 12, 1, 100)).toEqual(
          row.normal.map((frame) => frame + 100),
        )
        expect(firstSourceFrames(row.rate, 12, 2, 100)).toEqual(
          row.double.map((frame) => frame + 100),
        )
        expect(firstSourceFrames(row.rate, 12, 0.5, 100)).toEqual(
          row.half.map((frame) => frame + 100),
        )
      })
    })
  }
})

describe('sourceFrameAt over 20 minutes', () => {
  it('maps every one of the first 71,929 timeline frames to itself at 59.94', () => {
    let failures = 0
    let firstFailure = -1
    for (let timelineFrame = 0; timelineFrame <= TWENTY_MINUTES_FRAMES; timelineFrame += 1) {
      const sourceFrame = sourceFrameAt({
        timelineFrame,
        sourceStart: 0,
        speed: 1,
        sourceRate: SOURCE_59_94,
        projectRate: PROJECT_59_94,
      })
      if (sourceFrame !== timelineFrame) {
        failures += 1
        if (firstFailure < 0) {
          firstFailure = timelineFrame
        }
      }
    }

    expect({ failures, firstFailure }).toEqual({ failures: 0, firstFailure: -1 })
  })

  for (const row of TWENTY_MINUTE_COUNTS) {
    it(`shows a ${row.name} source without drift`, () => {
      const counts = twentyMinuteCounts(row.rate)

      expect(counts).toEqual({
        distinct: row.distinct,
        repeats: row.repeats,
        skips: row.skips,
        lastSourceFrame: row.lastSourceFrame,
      })
      expect(counts.distinct + counts.repeats).toBe(TWENTY_MINUTES_FRAMES)
    })
  }
})

describe('sourceTimeAt', () => {
  it("is the source frame's own start time, not a snapped neighbour", () => {
    const times: number[] = []
    for (let timelineFrame = 0; timelineFrame < 5; timelineFrame += 1) {
      times.push(
        sourceTimeAt({
          timelineFrame,
          sourceStart: 0,
          speed: 1,
          sourceRate: SOURCE_29_97,
          projectRate: PROJECT_59_94,
        }),
      )
    }

    expect(times).toEqual([0, 0, 1001 / 30000, 1001 / 30000, 2002 / 30000])
  })

  it('round-trips to the same source frame through secondsToFrame', () => {
    const failures: string[] = []
    for (const rate of [SOURCE_59_94, SOURCE_29_97, SOURCE_60, SOURCE_25, SOURCE_23_976]) {
      for (let timelineFrame = 0; timelineFrame < 1_000; timelineFrame += 1) {
        const query = {
          timelineFrame,
          sourceStart: 0,
          speed: 1,
          sourceRate: rate,
          projectRate: PROJECT_59_94,
        }
        const sourceFrame = sourceFrameAt(query)
        const roundTrip = secondsToFrame(rate, sourceTimeAt(query))
        if (roundTrip !== sourceFrame) {
          failures.push(`${rate.num}/${rate.den} frame ${timelineFrame}: ${sourceFrame}`)
        }
      }
    }

    expect(failures.slice(0, 10)).toEqual([])
  })

  it('is frameToSeconds of the source frame', () => {
    for (let timelineFrame = 0; timelineFrame < 100; timelineFrame += 1) {
      const query = {
        timelineFrame,
        sourceStart: 7,
        speed: 1,
        sourceRate: SOURCE_59_94,
        projectRate: PROJECT_59_94,
      }

      expect(sourceTimeAt(query)).toBe(frameToSeconds(SOURCE_59_94, sourceFrameAt(query)))
    }
  })
})

describe('timelineFramesForSource', () => {
  for (const row of CLIP_LENGTHS) {
    it(`turns ${row.sourceFrames} ${row.name} source frames into ${row.timelineFrames} timeline frames`, () => {
      const timelineFrames = timelineFramesForSource(row.sourceFrames, row.rate, PROJECT_59_94, 1)

      expect(timelineFrames).toBe(row.timelineFrames)
      // Rounded up: the last timeline frame shows the last source frame …
      expect(
        sourceFrameAt({
          timelineFrame: timelineFrames - 1,
          sourceStart: 0,
          speed: 1,
          sourceRate: row.rate,
          projectRate: PROJECT_59_94,
        }),
      ).toBe(row.sourceFrames - 1)
      // … and one frame fewer would not reach it.
      expect(
        sourceFrameAt({
          timelineFrame: timelineFrames,
          sourceStart: 0,
          speed: 1,
          sourceRate: row.rate,
          projectRate: PROJECT_59_94,
        }),
      ).toBe(row.sourceFrames)
    })
  }

  it('returns a 1,199-frame 59.94 source as 1,199 timeline frames', () => {
    expect(timelineFramesForSource(1_199, SOURCE_59_94, PROJECT_59_94, 1)).toBe(1_199)
  })

  it('is the smallest count that covers the source at any speed', () => {
    const failures: string[] = []
    for (const row of CLIP_LENGTHS) {
      for (const speed of [1, 2, 0.5]) {
        const timelineFrames = timelineFramesForSource(
          row.sourceFrames,
          row.rate,
          PROJECT_59_94,
          speed,
        )
        const at = (timelineFrame: number) =>
          sourceFrameAt({
            timelineFrame,
            sourceStart: 0,
            speed,
            sourceRate: row.rate,
            projectRate: PROJECT_59_94,
          })
        if (at(timelineFrames - 1) >= row.sourceFrames) {
          failures.push(`${row.name} at ${speed}: ${timelineFrames - 1} already covers the source`)
        }
        if (at(timelineFrames) < row.sourceFrames) {
          failures.push(`${row.name} at ${speed}: ${timelineFrames} does not cover the source`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('returns zero for an empty source', () => {
    expect(timelineFramesForSource(0, SOURCE_59_94, PROJECT_59_94, 1)).toBe(0)
  })
})

describe('frame-mapping input validation', () => {
  const query = {
    timelineFrame: 0,
    sourceStart: 0,
    speed: 1,
    sourceRate: SOURCE_59_94,
    projectRate: PROJECT_59_94,
  }

  it('rejects a timeline frame that is not an integer >= 0, naming it', () => {
    expect(() => sourceFrameAt({ ...query, timelineFrame: -1 })).toThrowError(RangeError)
    expect(() => sourceFrameAt({ ...query, timelineFrame: -1 })).toThrowError(/timelineFrame/)
    expect(() => sourceFrameAt({ ...query, timelineFrame: 1.5 })).toThrowError(/timelineFrame/)
    expect(() => sourceTimeAt({ ...query, timelineFrame: -1 })).toThrowError(/timelineFrame/)
  })

  it('rejects a source start that is not an integer >= 0, naming it', () => {
    expect(() => sourceFrameAt({ ...query, sourceStart: -1 })).toThrowError(RangeError)
    expect(() => sourceFrameAt({ ...query, sourceStart: -1 })).toThrowError(/sourceStart/)
    expect(() => sourceFrameAt({ ...query, sourceStart: 0.5 })).toThrowError(/sourceStart/)
  })

  it('rejects a speed that is not a finite number > 0, naming it', () => {
    for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sourceFrameAt({ ...query, speed })).toThrowError(RangeError)
      expect(() => sourceFrameAt({ ...query, speed })).toThrowError(/speed/)
      expect(() => timelineFramesForSource(1, SOURCE_59_94, PROJECT_59_94, speed)).toThrowError(
        /speed/,
      )
    }
  })

  it('rejects a rate that is not a rate of positive integers', () => {
    expect(() => sourceFrameAt({ ...query, sourceRate: { num: 60000, den: 0 } })).toThrowError(
      RangeError,
    )
    expect(() => sourceFrameAt({ ...query, projectRate: { num: 0, den: 1 } })).toThrowError(
      RangeError,
    )
  })

  it('rejects a source frame count that is not an integer >= 0, naming it', () => {
    expect(() => timelineFramesForSource(-1, SOURCE_59_94, PROJECT_59_94, 1)).toThrowError(
      RangeError,
    )
    expect(() => timelineFramesForSource(-1, SOURCE_59_94, PROJECT_59_94, 1)).toThrowError(
      /sourceFrames/,
    )
    expect(() => timelineFramesForSource(1.5, SOURCE_59_94, PROJECT_59_94, 1)).toThrowError(
      /sourceFrames/,
    )
  })
})

describe('the anti-drift round trip', () => {
  it('returns every frame 0..2,000,000 at 59.94 unchanged', () => {
    let failures = 0
    let firstFailure = -1
    for (let frame = 0; frame <= 2_000_000; frame += 1) {
      const seconds = frameToSeconds(SOURCE_59_94, frame)
      if (secondsToFrame(SOURCE_59_94, seconds) !== frame) {
        failures += 1
        if (firstFailure < 0) {
          firstFailure = frame
        }
      }
    }

    expect({ failures, firstFailure }).toEqual({ failures: 0, firstFailure: -1 })
  })
})

describe('a speed stored to the hundredth (T9)', () => {
  const RATE_30: Rate = { num: 30, den: 1 }

  it('maps 100 frames at 0.29x to source frame 29, not the 28 a float product floors to', () => {
    // 0.29 · 100 is 28.999999999999996 in doubles; the speed is 29/100, so the frame is 29.
    expect(
      sourceFrameAt({
        timelineFrame: 100,
        sourceStart: 0,
        speed: 0.29,
        sourceRate: RATE_30,
        projectRate: RATE_30,
      }),
    ).toBe(29)
  })

  it('agrees with the exact product for every hundredth speed and every rate pair', () => {
    const rates: Rate[] = [
      { num: 24000, den: 1001 },
      { num: 24, den: 1 },
      { num: 25, den: 1 },
      { num: 30000, den: 1001 },
      { num: 30, den: 1 },
      { num: 50, den: 1 },
      { num: 60000, den: 1001 },
      { num: 60, den: 1 },
    ]
    let failures = 0
    let first: unknown = null
    for (let hundredths = 10; hundredths <= 1000; hundredths += 7) {
      const speed = hundredths / 100
      for (const sourceRate of rates) {
        for (const projectRate of rates) {
          for (let timelineFrame = 0; timelineFrame < 400; timelineFrame += 3) {
            const exact = Number(
              (BigInt(timelineFrame) *
                BigInt(hundredths) *
                BigInt(sourceRate.num) *
                BigInt(projectRate.den)) /
                (100n * BigInt(sourceRate.den) * BigInt(projectRate.num)),
            )
            const shown = sourceFrameAt({
              timelineFrame,
              sourceStart: 0,
              speed,
              sourceRate,
              projectRate,
            })
            if (shown !== exact) {
              failures += 1
              first ??= { speed, sourceRate, projectRate, timelineFrame, shown, exact }
            }
          }
        }
      }
    }
    expect({ failures, first }).toEqual({ failures: 0, first: null })
  })
})
