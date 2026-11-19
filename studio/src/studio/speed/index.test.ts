// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { type Rate } from '@/studio/time'
import {
  MAX_CURVE_SPEED,
  MIN_CURVE_SPEED,
  areaAt,
  averageSpeed,
  constantSpeed,
  frameAtArea,
  normalizeSpeedCurve,
  sourceFrameAt,
  sourceFramesAt,
  sourceSpanCoveredBy,
  speedAt,
  timelineDurationForSource,
  timelineFramesForSource,
  validateSpeedCurve,
  type SourceFrameSpan,
  type SpeedCurve,
  type SpeedKey,
} from './index'

const RATE_59_94: Rate = { num: 60000, den: 1001 }

/** The 10-second ramp of design 7.1, section 5.2: 1x -> 4x, hold, 4x -> 1x, over 600 frames. */
const RAMP_600: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}

/** A key as the SDK and the panel will hand one in. */
const FIRST_KEY: SpeedKey = { frame: 0, speed: 2 }

describe('the public surface of @/studio/speed', () => {
  it('exports the curve, the mapping and the inverse under their design names', () => {
    for (const exported of [
      areaAt,
      frameAtArea,
      speedAt,
      averageSpeed,
      constantSpeed,
      sourceFramesAt,
      sourceFrameAt,
      timelineDurationForSource,
      timelineFramesForSource,
      sourceSpanCoveredBy,
      validateSpeedCurve,
      normalizeSpeedCurve,
    ]) {
      expect(typeof exported).toBe('function')
    }
    expect([MIN_CURVE_SPEED, MAX_CURVE_SPEED]).toEqual([0.1, 10])
  })

  it('answers the design’s 10-second ramp end to end through the index', () => {
    expect(averageSpeed(RAMP_600)).toBe(3.85)
    expect(areaAt(RAMP_600, 600)).toBe(2_310)
    expect(sourceFramesAt(RAMP_600, 600, RATE_59_94, RATE_59_94)).toBe(2_310)
    expect(sourceFrameAt(RAMP_600, 300, 0, RATE_59_94, RATE_59_94)).toBe(1_155)
    expect(frameAtArea(RAMP_600, 2_310)).toBe(600)
    expect(speedAt(RAMP_600, 15)).toBe(2.5)
    expect(constantSpeed(RAMP_600)).toBeUndefined()
    expect(timelineFramesForSource(RAMP_600, 2_310, RATE_59_94, RATE_59_94)).toBe(600)
    expect(timelineDurationForSource(RAMP_600, 2_310, RATE_59_94, RATE_59_94)).toBe(600)
    const span: SourceFrameSpan = sourceSpanCoveredBy(RAMP_600, 300, 0, RATE_59_94, RATE_59_94)
    expect(span).toEqual({ startFrame: 1_155, endFrame: 1_159 })
  })

  it('validates a curve handed in from outside', () => {
    expect(averageSpeed({ keys: [FIRST_KEY] })).toBe(2)
    expect(() => validateSpeedCurve(RAMP_600)).not.toThrow()
    expect(() => validateSpeedCurve({ keys: [{ frame: 0, speed: 20 }] })).toThrowError(
      /keys\[0\]\.speed/,
    )
  })
})
