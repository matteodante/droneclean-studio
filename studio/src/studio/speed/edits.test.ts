// @vitest-environment node

/**
 * The curve maths of the edits (moved here from FreeCut's trim-utils, review finding F2): a
 * window of a curve, the stretch an edge drag applies, and the speed a cut inserts.
 */

import { describe, expect, it } from 'vite-plus/test'
import { exactSpeed, fraction, toRate } from '@/studio/time'
import { sourceFramesAt } from './mapping'
import type { SpeedCurve } from './curve'
import { exactSpeedAt } from './exact-curve'
import { stretchSpeedCurve, windowSpeedCurve } from './edits'

const RATE_30 = toRate(30)

/** The 10-second ramp of design 7.1, section 5.2: 1x -> 4x, hold, 4x -> 1x over 600 frames. */
const RAMP_600: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}

describe('windowSpeedCurve', () => {
  it('windows a curve onto a range and back to the whole clip', () => {
    expect(windowSpeedCurve(RAMP_600, 0, 600).keys).toEqual(RAMP_600.keys)
    expect(windowSpeedCurve(RAMP_600, 300, 600).keys).toEqual([
      { frame: 0, speed: 4 },
      { frame: 270, speed: 4 },
      { frame: 300, speed: 1 },
    ])
    expect(windowSpeedCurve(RAMP_600, 0, 300).keys).toEqual([
      { frame: 0, speed: 1 },
      { frame: 30, speed: 4 },
      { frame: 300, speed: 4 },
    ])
  })

  it('gives a cut inside a ramp the exact speed of the line there, as the double it reads back as', () => {
    // 5.02 -> 2.46 over 171 frames, cut at 1: (502·171 − 256·1) / (100·171) = 85586/17100.
    const ramp: SpeedCurve = {
      keys: [
        { frame: 0, speed: 5.02 },
        { frame: 171, speed: 2.46 },
      ],
    }
    const windowed = windowSpeedCurve(ramp, 1, 171)
    const cutSpeed = windowed.keys[0]!.speed
    expect(exactSpeed(cutSpeed)).toEqual(fraction(85_586, 17_100))
    expect(exactSpeed(cutSpeed)).toEqual(exactSpeedAt(ramp, 1))
  })
})

describe('stretchSpeedCurve', () => {
  it('scales a curve with the clip length, its shape kept and its span unchanged', () => {
    const halved = stretchSpeedCurve(RAMP_600, 600, 300)!
    expect(halved.keys).toEqual([
      { frame: 0, speed: 2 },
      { frame: 15, speed: 8 },
      { frame: 285, speed: 8 },
      { frame: 300, speed: 2 },
    ])
    expect(Math.floor(sourceFramesAt(halved, 300, RATE_30, RATE_30))).toBe(2_310)
    expect(stretchSpeedCurve(RAMP_600, 600, 600)!.keys).toEqual(RAMP_600.keys)
  })

  it('rounds the stretched speeds to the hundredth, as a person’s edit is', () => {
    const stretched = stretchSpeedCurve(RAMP_600, 600, 700)!
    for (const key of stretched.keys) {
      expect(Math.round(key.speed * 100) / 100).toBe(key.speed)
    }
  })

  it('refuses a stretch that would push a key past 10x or below 0.1x (review finding T7)', () => {
    expect(stretchSpeedCurve(RAMP_600, 600, 200)).toBeUndefined()
    expect(stretchSpeedCurve(RAMP_600, 600, 6_001)).toBeUndefined()
  })
})
