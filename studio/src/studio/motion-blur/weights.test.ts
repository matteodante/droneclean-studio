// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { windowClipTiming, type ClipTiming, type SpeedCurve } from '@/studio/speed'
import { rateValue, type Rate } from '@/studio/time'
import {
  motionBlurFrameCount,
  planMotionBlur,
  type MotionBlurPlan,
  type ShutterDegrees,
} from './index'

const RATE_59_94: Rate = { num: 60000, den: 1001 }
const RATE_60: Rate = { num: 60, den: 1 }
const SHUTTERS: readonly ShutterDegrees[] = [90, 180, 270, 360]

/** The 10-second ramp of design 7.1, section 5.2: 1x -> 4x, hold, 4x -> 1x, over 600 frames. */
const RAMP_600: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}

/** A 59.94 clip with `curve` from `sourceStart`, as the one mapping reads it. */
function clipOf(curve: SpeedCurve, sourceStart = 0): ClipTiming {
  return { type: 'video', speedCurve: curve, sourceStart, sourceFps: rateValue(RATE_59_94) }
}

/** A constant curve: one key, the speed holding for every frame. */
function flatCurve(speed: number): SpeedCurve {
  return { keys: [{ frame: 0, speed }] }
}

/** The plan of one output frame of a clip at one speed, from `sourceStart` 0. */
function planAt(
  speed: number,
  timelineFrame: number,
  shutterDegrees: ShutterDegrees,
  projectRate: Rate = RATE_59_94,
): MotionBlurPlan {
  return planMotionBlur({
    clip: clipOf(flatCurve(speed)),
    timelineFrame,
    projectRate,
    shutterDegrees,
  })
}

function weightSum(plan: MotionBlurPlan): number {
  return plan.samples.reduce((sum, sample) => sum + sample.weight, 0)
}

describe('the table of design 7.2, section 5.7', () => {
  it('is four frames at 0.250 each with a 360-degree shutter, on every output frame', () => {
    const failures: string[] = []
    for (let timelineFrame = 0; timelineFrame < 600; timelineFrame += 1) {
      const plan = planAt(4, timelineFrame, 360)
      if (plan.frameCount !== 4 || plan.samples.length !== 4) {
        failures.push(`${timelineFrame}: ${plan.samples.length} of ${plan.frameCount} samples`)
        continue
      }
      for (const [index, sample] of plan.samples.entries()) {
        if (sample.sourceFrame !== timelineFrame * 4 + index) {
          failures.push(`${timelineFrame}: sample ${index} is frame ${sample.sourceFrame}`)
        }
        if (sample.weight !== 0.25) {
          failures.push(`${timelineFrame}: sample ${index} has weight ${sample.weight}`)
        }
      }
    }

    expect(failures.slice(0, 10)).toEqual([])
  })

  it('is two frames at 0.500 each with a 180-degree shutter, while the decode count stays 4', () => {
    for (let timelineFrame = 0; timelineFrame < 600; timelineFrame += 1) {
      const plan = planAt(4, timelineFrame, 180)
      expect(plan.samples).toEqual([
        { sourceFrame: timelineFrame * 4, weight: 0.5 },
        { sourceFrame: timelineFrame * 4 + 1, weight: 0.5 },
      ])
      expect(plan.frameCount).toBe(4)
    }
  })

  it('shortens the blend with a partial shutter at 4x: 3 frames at 1/3 at 270, 1 at 90', () => {
    expect(planAt(4, 0, 270).samples).toEqual([
      { sourceFrame: 0, weight: 1 / 3 },
      { sourceFrame: 1, weight: 1 / 3 },
      { sourceFrame: 2, weight: 1 / 3 },
    ])
    expect(planAt(4, 0, 90).samples).toEqual([{ sourceFrame: 0, weight: 1 }])
  })

  it('counts the clip’s source start in the plan: frame 2 at 4x starts on source frame 508', () => {
    const plan = planMotionBlur({
      clip: clipOf(flatCurve(4), 500),
      timelineFrame: 2,
      projectRate: RATE_59_94,
      shutterDegrees: 360,
    })
    expect(plan.startFrame).toBe(508)
    expect(plan.endFrame).toBe(512)
    expect(plan.samples.map((sample) => sample.sourceFrame)).toEqual([508, 509, 510, 511])
  })

  it('is the identity at 1x and 0.5x for every angle: 600 of 600 frames at weight 1', () => {
    for (const speed of [1, 0.5]) {
      for (const shutterDegrees of SHUTTERS) {
        let identity = 0
        for (let timelineFrame = 0; timelineFrame < 600; timelineFrame += 1) {
          const plan = planAt(speed, timelineFrame, shutterDegrees)
          const only = plan.samples[0]
          if (
            plan.samples.length === 1 &&
            only !== undefined &&
            only.weight === 1 &&
            only.sourceFrame === Math.floor(timelineFrame * speed)
          ) {
            identity += 1
          }
        }
        expect({ speed, shutterDegrees, identity }).toEqual({
          speed,
          shutterDegrees,
          identity: 600,
        })
      }
    }
  })

  it('weights a fractional 1.5x span by time: two frames at 2/3 and 1/3, alternating', () => {
    const plans = [0, 1, 2, 3].map((timelineFrame) => planAt(1.5, timelineFrame, 360))
    expect(plans.map((plan) => plan.samples.map((sample) => sample.sourceFrame))).toEqual([
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
    ])
    expect(plans.map((plan) => plan.samples.map((sample) => sample.weight))).toEqual([
      [2 / 3, 1 / 3],
      [1 / 3, 2 / 3],
      [2 / 3, 1 / 3],
      [1 / 3, 2 / 3],
    ])
  })

  it('blends 10 frames in all 1,000 output frames at 10x, and at most 11 across a rate conversion', () => {
    let tenAtATenth = 0
    for (let timelineFrame = 0; timelineFrame < 1_000; timelineFrame += 1) {
      const plan = planAt(10, timelineFrame, 360)
      if (
        plan.frameCount === 10 &&
        plan.samples.length === 10 &&
        plan.samples.every((sample) => sample.weight === 0.1)
      ) {
        tenAtATenth += 1
      }
    }
    expect(tenAtATenth).toBe(1_000)

    let smallest = Number.POSITIVE_INFINITY
    let largest = 0
    for (let timelineFrame = 0; timelineFrame < 1_000; timelineFrame += 1) {
      const plan = planAt(10, timelineFrame, 360, RATE_60)
      smallest = Math.min(smallest, plan.samples.length)
      largest = Math.max(largest, plan.samples.length)
    }
    expect({ smallest, largest }).toEqual({ smallest: 10, largest: 11 })
  })

  it('is at most 5 samples on the 1-4-1 ramp, 560 frames of 4, every sum 1', () => {
    const counts = new Map<number, number>()
    let maxSumError = 0
    let outsideSpan = 0
    let repeatedFirstFrame = 0
    let previousFirst = -1
    for (let timelineFrame = 0; timelineFrame < 600; timelineFrame += 1) {
      const plan = planMotionBlur({
        clip: clipOf(RAMP_600),
        timelineFrame,
        projectRate: RATE_59_94,
        shutterDegrees: 360,
      })
      counts.set(plan.samples.length, (counts.get(plan.samples.length) ?? 0) + 1)
      maxSumError = Math.max(maxSumError, Math.abs(weightSum(plan) - 1))
      const firstAllowed = Math.floor(plan.startFrame)
      const lastAllowed = Math.ceil(plan.endFrame) - 1
      for (const sample of plan.samples) {
        if (sample.sourceFrame < firstAllowed || sample.sourceFrame > lastAllowed) outsideSpan += 1
      }
      const first = plan.samples[0]?.sourceFrame
      if (first === previousFirst) repeatedFirstFrame += 1
      if (first !== undefined) previousFirst = first
    }

    expect(Object.fromEntries(counts)).toEqual({ 2: 12, 3: 20, 4: 560, 5: 8 })
    expect(maxSumError).toBeLessThanOrEqual(1e-9)
    expect(outsideSpan).toBe(0)
    expect(repeatedFirstFrame).toBe(0)
  })

  it('ends the ramp on the span [2308.950, 2310.000) with 2 samples', () => {
    const plan = planMotionBlur({
      clip: clipOf(RAMP_600),
      timelineFrame: 599,
      projectRate: RATE_59_94,
      shutterDegrees: 360,
    })
    expect(plan.startFrame).toBeCloseTo(2308.95, 9)
    expect(plan.endFrame).toBeCloseTo(2310, 9)
    expect(plan.frameCount).toBe(2)
    expect(plan.samples.map((sample) => sample.sourceFrame)).toEqual([2308, 2309])
    expect(plan.samples[0]!.weight).toBeCloseTo(0.05 / 1.05, 12)
    expect(plan.samples[1]!.weight).toBeCloseTo(1 / 1.05, 12)
  })

  it('counts a span as ceil(end) - floor(start), refusing an empty one', () => {
    expect(motionBlurFrameCount({ startFrame: 2308.95, endFrame: 2310 })).toBe(2)
    expect(motionBlurFrameCount({ startFrame: 3, endFrame: 7 })).toBe(4)
    expect(() => motionBlurFrameCount({ startFrame: 2, endFrame: 2 })).toThrowError(/non-empty/)
  })
})

describe('the slow-motion blend (19 Nov 2026)', () => {
  const blendAt = (speed: number, timelineFrame: number, shutterDegrees: ShutterDegrees = 180) =>
    planMotionBlur({
      clip: clipOf(flatCurve(speed)),
      timelineFrame,
      projectRate: RATE_59_94,
      shutterDegrees,
      blendSlowMotion: true,
    })

  it('alternates a source frame and an even mix of the next two at 0.5x, for every angle', () => {
    for (const shutterDegrees of SHUTTERS) {
      expect(blendAt(0.5, 10, shutterDegrees).samples).toEqual([{ sourceFrame: 5, weight: 1 }])
      expect(blendAt(0.5, 11, shutterDegrees).samples).toEqual([
        { sourceFrame: 5, weight: 0.5 },
        { sourceFrame: 6, weight: 0.5 },
      ])
    }
  })

  it('weights the two frames by position at 0.25x: 3/4 and 1/4, then a half, then 1/4 and 3/4', () => {
    const weights = [1, 2, 3].map((frame) => blendAt(0.25, frame).samples.map((sample) => sample.weight))
    expect(weights).toEqual([
      [0.75, 0.25],
      [0.5, 0.5],
      [0.25, 0.75],
    ])
    for (const frame of [1, 2, 3]) expect(weightSum(blendAt(0.25, frame))).toBeCloseTo(1, 12)
  })

  it('changes nothing at 1x, and leaves a sped-up frame to the shutter', () => {
    for (let frame = 0; frame < 60; frame += 1) {
      expect(blendAt(1, frame).samples).toEqual([{ sourceFrame: frame, weight: 1 }])
    }
    expect(blendAt(4, 2, 360).samples).toEqual(planAt(4, 2, 360).samples)
  })

  it('is off unless asked: 0.5x without the blend holds the frame', () => {
    expect(planAt(0.5, 11, 180).samples).toEqual([{ sourceFrame: 5, weight: 1 }])
  })
})

describe('a cut between two source frames', () => {
  it('gives the cut clip its parent’s spans: the remainder is added before the floor', () => {
    // Frame 1 of the ramp sits at source frame 1.05, so the clip a cut leaves there starts on
    // source frame 1 and carries the cut's 1/20 (design 7.1, section 4.6): the blend must be the
    // parent's. The child is the window the split itself computes.
    const parentClip: ClipTiming & { durationInFrames: number } = {
      ...clipOf(RAMP_600),
      durationInFrames: 600,
    }
    const window = windowClipTiming(parentClip, 1, 599, RATE_59_94)!
    expect(window.sourceStart).toBe(1)
    expect(window.sourceFrameOffset).toEqual({ num: 1, den: 20 })
    const childClip: ClipTiming = { ...parentClip, ...window }

    let maxSpanError = 0
    let frameMismatches = 0
    let maxWeightError = 0
    for (let timelineFrame = 0; timelineFrame < 599; timelineFrame += 1) {
      const child = planMotionBlur({
        clip: childClip,
        timelineFrame,
        projectRate: RATE_59_94,
        shutterDegrees: 360,
      })
      const parent = planMotionBlur({
        clip: parentClip,
        timelineFrame: timelineFrame + 1,
        projectRate: RATE_59_94,
        shutterDegrees: 360,
      })
      maxSpanError = Math.max(
        maxSpanError,
        Math.abs(child.startFrame - parent.startFrame),
        Math.abs(child.endFrame - parent.endFrame),
      )
      if (child.samples.length !== parent.samples.length) {
        frameMismatches += 1
        continue
      }
      for (const [index, sample] of child.samples.entries()) {
        const expected = parent.samples[index]!
        if (sample.sourceFrame !== expected.sourceFrame) frameMismatches += 1
        maxWeightError = Math.max(maxWeightError, Math.abs(sample.weight - expected.weight))
      }
    }

    expect(maxSpanError).toBeLessThan(1e-12)
    expect(frameMismatches).toBe(0)
    expect(maxWeightError).toBeLessThan(1e-12)
  })
})

describe('input validation', () => {
  it('refuses a shutter that is not one of the four angles, naming it', () => {
    for (const shutterDegrees of [0, 45, 361, Number.NaN] as ShutterDegrees[]) {
      expect(() => planAt(2, 0, shutterDegrees)).toThrowError(RangeError)
      expect(() => planAt(2, 0, shutterDegrees)).toThrowError(/shutterDegrees/)
    }
  })

  it('refuses an output frame that is not an integer >= 0, naming it', () => {
    for (const timelineFrame of [-1, 1.5, Number.NaN]) {
      expect(() =>
        planMotionBlur({
          clip: clipOf(flatCurve(2)),
          timelineFrame,
          projectRate: RATE_59_94,
          shutterDegrees: 360,
        }),
      ).toThrowError(/timelineFrame/)
    }
  })
})
