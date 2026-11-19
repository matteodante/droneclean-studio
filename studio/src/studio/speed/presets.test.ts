// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { averageSpeed, validateSpeedCurve } from './curve'
import { areaAt } from './curve'
import { SPEED_PRESET_NAMES, speedPresetCurve } from './presets'

/** A 10-second clip at 60, the length design 7.1's section 4.8 examples use. */
const DURATION = 600

describe('speedPresetCurve', () => {
  it('builds ramp-in: 1x at the start, the peak after the ramp, held to the end', () => {
    expect(speedPresetCurve('ramp-in', DURATION, 4, 15).keys).toEqual([
      { frame: 0, speed: 1 },
      { frame: 15, speed: 4 },
      { frame: 600, speed: 4 },
    ])
  })

  it('builds ramp-out: the peak held from the start, then down to 1x at the end', () => {
    expect(speedPresetCurve('ramp-out', DURATION, 4, 15).keys).toEqual([
      { frame: 0, speed: 4 },
      { frame: 585, speed: 4 },
      { frame: 600, speed: 1 },
    ])
  })

  it('builds ramp-in-out: up, hold, down, with the ramp at both ends', () => {
    expect(speedPresetCurve('ramp-in-out', DURATION, 4, 15).keys).toEqual([
      { frame: 0, speed: 1 },
      { frame: 15, speed: 4 },
      { frame: 585, speed: 4 },
      { frame: 600, speed: 1 },
    ])
  })

  it('defaults to a peak of 4x and a ramp of 15 frames', () => {
    expect(speedPresetCurve('ramp-in', DURATION).keys).toEqual(
      speedPresetCurve('ramp-in', DURATION, 4, 15).keys,
    )
    expect(speedPresetCurve('ramp-in-out', DURATION).keys).toEqual([
      { frame: 0, speed: 1 },
      { frame: 15, speed: 4 },
      { frame: 585, speed: 4 },
      { frame: 600, speed: 1 },
    ])
  })

  it('pins the first and last keys to the clip, whatever the clip length', () => {
    for (const duration of [2, 3, 47, 600]) {
      for (const preset of SPEED_PRESET_NAMES) {
        const curve = speedPresetCurve(preset, duration, 4, 15)
        expect(() => validateSpeedCurve(curve)).not.toThrow()
        expect(curve.keys[0]?.frame).toBe(0)
        expect(curve.keys[curve.keys.length - 1]?.frame).toBe(duration)
      }
    }
  })

  it('clamps a ramp longer than the clip to the clip', () => {
    // Reaching the peak at the clip's end leaves no hold: the two keys at the end are one.
    expect(speedPresetCurve('ramp-in', 20, 4, 1000).keys).toEqual([
      { frame: 0, speed: 1 },
      { frame: 20, speed: 4 },
    ])
  })

  it('keeps an in-out ramp with no hold left symmetric when it is longer than half the clip', () => {
    expect(speedPresetCurve('ramp-in-out', 20, 4, 15).keys).toEqual([
      { frame: 0, speed: 1 },
      { frame: 10, speed: 4 },
      { frame: 20, speed: 1 },
    ])
  })

  it('clamps the peak into the schema speed range', () => {
    expect(speedPresetCurve('ramp-in', DURATION, 16, 15).keys[1]?.speed).toBe(10)
    expect(speedPresetCurve('ramp-in', DURATION, 0.01, 15).keys[1]?.speed).toBe(0.1)
  })

  it('answers a curve whose average is its integral over its length', () => {
    // The value the store writes into the clip's `speed`: every length calculation reads it.
    for (const preset of SPEED_PRESET_NAMES) {
      const curve = speedPresetCurve(preset, DURATION, 4, 15)
      expect(averageSpeed(curve)).toBeCloseTo(areaAt(curve, DURATION) / DURATION, 12)
    }
  })

  it('refuses a clip shorter than one frame', () => {
    expect(() => speedPresetCurve('ramp-in', 0)).toThrow(RangeError)
    expect(() => speedPresetCurve('ramp-in', Number.NaN)).toThrow(RangeError)
  })
})
