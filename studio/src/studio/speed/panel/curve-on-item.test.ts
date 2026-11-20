// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { makeTimelineVideoItem } from '@/features/timeline/test-helpers'
import type { SpeedCurve } from '@/studio/speed'
import {
  isBelowProjectRate,
  plottedCurvePoints,
  slowestFrameRate,
  withKeyEase,
  withKeySpeed,
} from './curve-on-item'

const CURVE: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1, ease: 'smooth' },
    { frame: 60, speed: 3 },
  ],
}

describe('withKeyEase', () => {
  it('sets and clears the ease of the segment that starts at a key', () => {
    expect(withKeyEase({ keys: [{ frame: 0, speed: 1 }, { frame: 60, speed: 3 }] }, 0, 'ease-in').keys[0]).toEqual({
      frame: 0,
      speed: 1,
      ease: 'ease-in',
    })
    expect(withKeyEase(CURVE, 0, 'linear').keys[0]).toEqual({ frame: 0, speed: 1 })
  })

  it('leaves the last key alone: no segment starts there', () => {
    expect(withKeyEase(CURVE, 1, 'smooth')).toBe(CURVE)
  })
})

describe('withKeySpeed', () => {
  it('keeps the ease of the key it changes', () => {
    expect(withKeySpeed(CURVE, 0, 2).keys[0]).toEqual({ frame: 0, speed: 2, ease: 'smooth' })
  })
})

describe('plottedCurvePoints', () => {
  it('is the keys for a linear curve and samples inside an eased segment', () => {
    expect(plottedCurvePoints({ keys: [{ frame: 0, speed: 1 }, { frame: 60, speed: 3 }] })).toHaveLength(2)
    const points = plottedCurvePoints(CURVE)
    expect(points).toHaveLength(25)
    expect(points[0]).toEqual({ frame: 0, speed: 1 })
    expect(points[points.length - 1]).toEqual({ frame: 60, speed: 3 })
    expect(points[12]?.speed).toBeCloseTo(2, 12)
  })
})

describe('slowestFrameRate', () => {
  const item = makeTimelineVideoItem({ sourceFps: 30 })

  it('is the file’s rate times the lowest speed on the curve', () => {
    expect(slowestFrameRate({ keys: [{ frame: 0, speed: 1 }, { frame: 10, speed: 1 }] }, item, 60)).toBe(30)
    expect(slowestFrameRate({ keys: [{ frame: 0, speed: 0.5 }, { frame: 10, speed: 0.5 }] }, item, 60)).toBe(15)
    expect(
      slowestFrameRate({ keys: [{ frame: 0, speed: 2 }, { frame: 5, speed: 0.4 }, { frame: 10, speed: 2 }] }, item, 60),
    ).toBeCloseTo(12, 12)
  })

  it('takes the project’s rate for a clip with no rate of its own', () => {
    const bare = makeTimelineVideoItem({ sourceFps: undefined })
    expect(slowestFrameRate({ keys: [{ frame: 0, speed: 0.5 }, { frame: 10, speed: 0.5 }] }, bare, 60)).toBe(30)
  })
})

describe('isBelowProjectRate', () => {
  it('is true below the project’s rate and not for the standard rates’ rounding', () => {
    expect(isBelowProjectRate(30, 60)).toBe(true)
    expect(isBelowProjectRate(60, 60)).toBe(false)
    expect(isBelowProjectRate(59.94, 59.94)).toBe(false)
    expect(isBelowProjectRate(29.97 * 2, 59.94)).toBe(false)
    expect(isBelowProjectRate(59.5, 60)).toBe(true)
  })
})
