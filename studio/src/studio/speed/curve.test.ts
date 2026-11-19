// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  MAX_CURVE_SPEED,
  MIN_CURVE_SPEED,
  areaAt,
  averageSpeed,
  constantSpeed,
  frameAtArea,
  speedAt,
  validateSpeedCurve,
  type SpeedCurve,
  type SpeedKey,
} from './curve'

/** The 10-second ramp of design 7.1, section 5.2: 1x -> 4x, hold, 4x -> 1x, over 600 frames. */
const RAMP_600: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}

/** A constant curve: one key, the speed holding for every frame; two when a span is given. */
function flatCurve(speed: number, frames = 0): SpeedCurve {
  const first: SpeedKey = { frame: 0, speed }
  return frames === 0 ? { keys: [first] } : { keys: [first, { frame: frames, speed }] }
}

/** The area of one segment of the design's formula, evaluated at `offset` frames. */
function designSegmentArea(start: SpeedKey, end: SpeedKey, offset: number): number {
  const length = end.frame - start.frame
  const speedDelta = end.speed - start.speed
  return offset * start.speed + (speedDelta * offset * offset) / (2 * length)
}

describe('areaAt', () => {
  it('is speed times frames on a constant curve, with one key and with two', () => {
    for (const speed of [MIN_CURVE_SPEED, 0.5, 1, 2, MAX_CURVE_SPEED]) {
      for (let frame = 0; frame <= 1_000; frame += 1) {
        expect(areaAt(flatCurve(speed), frame)).toBe(frame * speed)
        expect(areaAt(flatCurve(speed, 1_000), frame)).toBe(frame * speed)
      }
    }
  })

  it('is the design table of the 10-second ramp', () => {
    expect([
      areaAt(RAMP_600, 0),
      areaAt(RAMP_600, 30),
      areaAt(RAMP_600, 570),
      areaAt(RAMP_600, 600),
    ]).toEqual([0, 75, 2_235, 2_310])
  })

  it('integrates a decelerating segment: 4x -> 1x over 100 frames', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 4 },
        { frame: 100, speed: 1 },
      ],
    }

    expect(areaAt(curve, 50)).toBe(162.5)
    expect(areaAt(curve, 100)).toBe(250)
  })

  it('integrates fractional frames, which the inverse produces', () => {
    expect(areaAt(RAMP_600, 30.5)).toBe(77)
    expect(areaAt(RAMP_600, 0.5)).toBe(0.5125)
  })

  it('holds the last speed beyond the last key', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 10, speed: 2 },
      ],
    }

    expect(areaAt(curve, 10)).toBe(15)
    expect(areaAt(curve, 15)).toBe(25)
    expect(areaAt(curve, 15.5)).toBe(26)
  })

  it('agrees with a per-frame midpoint sum to within 1e-6 source frames over 20 minutes', () => {
    // Design 7.1, 5.2: a midpoint sum also lands within 1e-6 source frames, so the closed
    // form's virtue is random access and agreement, not a visible error. The window is a 1x -> 4x
    // ramp over 20 minutes, a 59.94 source in a 60 fps project (source frames, not area units).
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 71_928, speed: 4 },
      ],
    }
    const sourceFramesPerAreaUnit = (60000 * 1) / (1001 * 60)
    let sum = 0
    let maxDifference = 0
    for (let frame = 0; frame < 71_928; frame += 1) {
      sum += speedAt(curve, frame + 0.5)
      maxDifference = Math.max(
        maxDifference,
        Math.abs(sum - areaAt(curve, frame + 1)) * sourceFramesPerAreaUnit,
      )
    }

    expect(maxDifference).toBeLessThan(1e-6)
  })

  it('is strictly increasing, so the mapping cannot go backwards', () => {
    let previous = areaAt(RAMP_600, 0)
    let regressions = 0
    for (let frame = 1; frame <= 600; frame += 1) {
      const area = areaAt(RAMP_600, frame)
      if (area <= previous) {
        regressions += 1
      }
      previous = area
    }

    expect(regressions).toBe(0)
  })

  it('has no jump at a key: the prefix sum of the design is the value returned there', () => {
    // The design's row: "integral bit-identical at every key from either side". `B_i` is built by
    // evaluating the segment formula at its end; a key's area is that prefix, and the next
    // segment starts there adding `segmentArea(…, 0)`, i.e. exactly zero. So the two sides are
    // the same double, and the function must return that double from the frame index.
    const rows: { frame: number; prefix: number; actual: number }[] = []
    let prefix = 0
    let previous: SpeedKey | undefined
    for (const key of RAMP_600.keys) {
      if (previous !== undefined) {
        prefix += designSegmentArea(previous, key, key.frame - previous.frame)
        rows.push({ frame: key.frame, prefix, actual: areaAt(RAMP_600, key.frame) })
      }
      previous = key
    }

    expect(rows).toEqual([
      { frame: 30, prefix: 75, actual: 75 },
      { frame: 570, prefix: 2_235, actual: 2_235 },
      { frame: 600, prefix: 2_310, actual: 2_310 },
    ])
  })

  it('steps by no more than the speed on either side of a key', () => {
    // A jump of any size would show as a step larger than one frame of the fastest speed.
    for (const key of RAMP_600.keys.slice(1)) {
      const before = areaAt(RAMP_600, key.frame - 1)
      const at = areaAt(RAMP_600, key.frame)
      const after = areaAt(RAMP_600, key.frame + 1)
      expect(at - before).toBeGreaterThan(0)
      expect(at - before).toBeLessThanOrEqual(MAX_CURVE_SPEED)
      expect(after - at).toBeGreaterThan(0)
      expect(after - at).toBeLessThanOrEqual(MAX_CURVE_SPEED)
    }
  })
})

describe('frameAtArea', () => {
  it('returns the frame a key sits on for that key’s area', () => {
    expect(frameAtArea(RAMP_600, 0)).toBe(0)
    expect(frameAtArea(RAMP_600, 75)).toBe(30)
    expect(frameAtArea(RAMP_600, 2_235)).toBe(570)
    expect(frameAtArea(RAMP_600, 2_310)).toBe(600)
  })

  it('round-trips areaAt over the ramp to within 1e-12 of an area unit', () => {
    let maxError = 0
    for (let area = 0; area <= 2_310; area += 0.25) {
      maxError = Math.max(maxError, Math.abs(areaAt(RAMP_600, frameAtArea(RAMP_600, area)) - area))
    }

    expect(maxError).toBeLessThan(1e-12)
  })

  it('holds the last speed beyond the last key', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 10, speed: 2 },
      ],
    }

    expect(frameAtArea(curve, 25)).toBe(15)
  })

  it('is the design table of the 10-second ramp in source frames', () => {
    // With equal rates the area is the source frame count, which is what the 2,310 of design
    // 7.1, section 5.2 counts.
    expect(frameAtArea(RAMP_600, areaAt(RAMP_600, 600))).toBe(600)
  })
})

describe('speedAt', () => {
  it('returns each key’s own speed on the key', () => {
    for (const key of RAMP_600.keys) {
      expect(speedAt(RAMP_600, key.frame)).toBe(key.speed)
    }
  })

  it('is linear between two keys', () => {
    expect(speedAt(RAMP_600, 15)).toBe(2.5)
    expect(speedAt(RAMP_600, 45)).toBe(4)
    expect(speedAt(RAMP_600, 585)).toBe(2.5)
    expect(speedAt(RAMP_600, 599)).toBe(1.1)
  })

  it('holds the last speed past the last key, and a single key everywhere', () => {
    expect(speedAt(RAMP_600, 600)).toBe(1)
    expect(speedAt(RAMP_600, 900)).toBe(1)
    expect(speedAt({ keys: [{ frame: 0, speed: 2 }] }, 0)).toBe(2)
    expect(speedAt({ keys: [{ frame: 0, speed: 2 }] }, 1_000)).toBe(2)
  })
})

describe('averageSpeed', () => {
  it('is the design’s 3.85 for the 10-second ramp', () => {
    expect(averageSpeed(RAMP_600)).toBe(3.85)
    expect(averageSpeed(RAMP_600) * 600).toBe(2_310)
  })

  it('is the constant speed of a flat curve', () => {
    expect(averageSpeed(flatCurve(2))).toBe(2)
    expect(averageSpeed(flatCurve(0.1, 1_000))).toBe(0.1)
    expect(averageSpeed({ keys: [{ frame: 0, speed: 4 }] })).toBe(4)
  })

  it('is the integral over the curve’s span, divided by the span', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 2 },
        { frame: 100, speed: 2 },
        { frame: 300, speed: 6 },
      ],
    }

    expect(averageSpeed(curve)).toBe(areaAt(curve, 300) / 300)
  })
})

describe('constantSpeed', () => {
  it('is undefined as soon as one key differs', () => {
    expect(constantSpeed(RAMP_600)).toBeUndefined()
    expect(
      constantSpeed({
        keys: [
          { frame: 0, speed: 2 },
          { frame: 100, speed: 2 },
          { frame: 200, speed: 3 },
        ],
      }),
    ).toBeUndefined()
  })

  it('is the one speed of a curve whose keys all agree', () => {
    expect(constantSpeed(flatCurve(2, 1_000))).toBe(2)
    expect(constantSpeed({ keys: [{ frame: 0, speed: 0.5 }] })).toBe(0.5)
  })
})

describe('curve validation', () => {
  it('accepts the bounds of the speed range, and the curve of the design', () => {
    expect(() => validateSpeedCurve(flatCurve(MIN_CURVE_SPEED))).not.toThrow()
    expect(() => validateSpeedCurve(flatCurve(MAX_CURVE_SPEED))).not.toThrow()
    expect(() => validateSpeedCurve(RAMP_600)).not.toThrow()
  })

  it('rejects a curve without keys, naming curve.keys', () => {
    expect(() => validateSpeedCurve({ keys: [] })).toThrowError(RangeError)
    expect(() => validateSpeedCurve({ keys: [] })).toThrowError(/curve\.keys/)
  })

  it('rejects keys that are not an array, naming curve.keys', () => {
    const broken = { keys: 'two' } as unknown as SpeedCurve
    expect(() => validateSpeedCurve(broken)).toThrowError(/curve\.keys/)
  })

  it('rejects a first key away from frame 0, naming keys[0].frame', () => {
    expect(() => validateSpeedCurve({ keys: [{ frame: 1, speed: 1 }] })).toThrowError(
      /keys\[0\]\.frame/,
    )
    expect(() =>
      validateSpeedCurve({
        keys: [
          { frame: 3, speed: 1 },
          { frame: 4, speed: 1 },
        ],
      }),
    ).toThrowError(/keys\[0\]\.frame/)
  })

  it('rejects a frame that is not an integer >= 0, naming keys[i].frame', () => {
    for (const frame of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const curve = {
        keys: [
          { frame: 0, speed: 1 },
          { frame, speed: 1 },
        ],
      }
      expect(() => validateSpeedCurve(curve)).toThrowError(RangeError)
      expect(() => validateSpeedCurve(curve)).toThrowError(/keys\[1\]\.frame/)
    }
  })

  it('rejects frames that do not increase, naming keys[i].frame', () => {
    for (const frame of [0, 9, 10]) {
      const curve = {
        keys: [
          { frame: 0, speed: 1 },
          { frame: 10, speed: 1 },
          { frame, speed: 1 },
        ],
      }
      expect(() => validateSpeedCurve(curve)).toThrowError(/keys\[2\]\.frame/)
    }
  })

  it('rejects a speed outside 0.1..10 or not finite, naming keys[i].speed', () => {
    for (const speed of [0, 0.09, 10.1, 16, Number.NaN, Number.POSITIVE_INFINITY]) {
      const curve = {
        keys: [
          { frame: 0, speed: 1 },
          { frame: 10, speed },
        ],
      }
      expect(() => validateSpeedCurve(curve)).toThrowError(RangeError)
      expect(() => validateSpeedCurve(curve)).toThrowError(/keys\[1\]\.speed/)
    }
  })

  it('is enforced by every function, not just by validateSpeedCurve', () => {
    const broken: SpeedCurve = { keys: [] }
    expect(() => areaAt(broken, 0)).toThrowError(/curve\.keys/)
    expect(() => frameAtArea(broken, 0)).toThrowError(/curve\.keys/)
    expect(() => speedAt(broken, 0)).toThrowError(/curve\.keys/)
    expect(() => averageSpeed(broken)).toThrowError(/curve\.keys/)
    expect(() => constantSpeed(broken)).toThrowError(/curve\.keys/)
  })

  it('rejects a frame or area that is not finite and >= 0, naming the argument', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => areaAt(RAMP_600, value)).toThrowError(/frame/)
      expect(() => speedAt(RAMP_600, value)).toThrowError(/frame/)
      expect(() => frameAtArea(RAMP_600, value)).toThrowError(/area/)
    }
  })
})
