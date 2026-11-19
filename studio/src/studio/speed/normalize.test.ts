// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { MAX_CURVE_SPEED, MIN_CURVE_SPEED, averageSpeed, validateSpeedCurve } from './curve'
import { MAX_RAMP_SEGMENT_FRAMES, normalizeSpeedCurve } from './normalize'
import type { SpeedCurve } from './curve'

/** The design's 10-second ramp, already normalised for a 600-frame clip. */
const RAMP_600: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}

function keysOf(curve: SpeedCurve | undefined): Array<[number, number]> {
  return curve === undefined ? [] : curve.keys.map((key) => [key.frame, key.speed])
}

describe('normalizeSpeedCurve', () => {
  it('passes a normalised curve through, as new objects', () => {
    const normalized = normalizeSpeedCurve(RAMP_600, 600)

    expect(normalized).toEqual(RAMP_600)
    expect(normalized).not.toBe(RAMP_600)
    expect(normalized?.keys[0]).not.toBe(RAMP_600.keys[0])
    expect(keysOf(normalized)).toEqual([
      [0, 1],
      [30, 4],
      [570, 4],
      [600, 1],
    ])
  })

  it('leaves its input untouched', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 40, speed: 3 },
        { frame: 0, speed: 1 },
      ],
    }
    const before = JSON.stringify(curve)

    normalizeSpeedCurve(curve, 100)

    expect(JSON.stringify(curve)).toBe(before)
  })

  it('sorts the keys by frame', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 100, speed: 2 },
        { frame: 0, speed: 1 },
        { frame: 50, speed: 3 },
      ],
    }

    expect(keysOf(normalizeSpeedCurve(curve, 100))).toEqual([
      [0, 1],
      [50, 3],
      [100, 2],
    ])
  })

  it('pins the last key to the clip’s duration and appends the missing one', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 50, speed: 4 },
      ],
    }

    expect(keysOf(normalizeSpeedCurve(curve, 100))).toEqual([
      [0, 1],
      [50, 4],
      [100, 4],
    ])
  })

  it('pins a last key past the duration back onto it', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 150, speed: 4 },
      ],
    }

    expect(keysOf(normalizeSpeedCurve(curve, 100))).toEqual([
      [0, 1],
      [100, 4],
    ])
  })

  it('inserts a first key at frame 0 with the earliest key’s speed', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 20, speed: 2 },
        { frame: 100, speed: 4 },
      ],
    }

    expect(keysOf(normalizeSpeedCurve(curve, 100))).toEqual([
      [0, 2],
      [20, 2],
      [100, 4],
    ])
  })

  it('grows a one-key curve to two keys, so the segment between them exists', () => {
    expect(keysOf(normalizeSpeedCurve({ keys: [{ frame: 0, speed: 2 }] }, 100))).toEqual([
      [0, 2],
      [100, 2],
    ])
    expect(averageSpeed(normalizeSpeedCurve({ keys: [{ frame: 0, speed: 2 }] }, 100)!)).toBe(2)
  })

  it('rounds frames to integers, keeps the later key on a shared frame and clamps frames into the clip', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 10.4, speed: 2 },
        { frame: 10.6, speed: 3 },
        { frame: -5, speed: 1.5 },
        { frame: 100, speed: 1 },
      ],
    }

    expect(keysOf(normalizeSpeedCurve(curve, 100))).toEqual([
      [0, 1.5],
      [10, 2],
      [11, 3],
      [100, 1],
    ])
  })

  it('clamps every speed into the schema’s 0.1..10 range', () => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 0.01 },
        { frame: 50, speed: 20 },
        { frame: 100, speed: 1 },
      ],
    }

    expect(keysOf(normalizeSpeedCurve(curve, 100))).toEqual([
      [0, MIN_CURVE_SPEED],
      [50, MAX_CURVE_SPEED],
      [100, 1],
    ])
  })

  it('returns a curve that passes validateSpeedCurve', () => {
    const normalized = normalizeSpeedCurve(
      {
        keys: [
          { frame: 40, speed: 20 },
          { frame: 0, speed: 0.01 },
        ],
      },
      100,
    )

    expect(() => validateSpeedCurve(normalized!)).not.toThrow()
  })

  it('returns undefined when there is no curve', () => {
    expect(normalizeSpeedCurve(undefined, 100)).toBeUndefined()
  })

  it('returns undefined for data that is not a list of keys', () => {
    expect(normalizeSpeedCurve({ keys: [] }, 100)).toBeUndefined()
    expect(normalizeSpeedCurve({ keys: 'nope' } as unknown as SpeedCurve, 100)).toBeUndefined()
    expect(normalizeSpeedCurve({ keys: [null] } as unknown as SpeedCurve, 100)).toBeUndefined()
  })

  it('returns undefined when a key is not two finite numbers', () => {
    const broken = (key: unknown): SpeedCurve => ({ keys: [key] }) as unknown as SpeedCurve

    expect(normalizeSpeedCurve(broken({ frame: 0, speed: Number.NaN }), 100)).toBeUndefined()
    expect(
      normalizeSpeedCurve(broken({ frame: Number.POSITIVE_INFINITY, speed: 1 }), 100),
    ).toBeUndefined()
    expect(normalizeSpeedCurve(broken({ frame: 0 }), 100)).toBeUndefined()
    expect(normalizeSpeedCurve(broken({ frame: '0', speed: 1 }), 100)).toBeUndefined()
  })

  it('returns undefined for a clip too short to hold two keys', () => {
    expect(normalizeSpeedCurve(RAMP_600, 0)).toBeUndefined()
    expect(normalizeSpeedCurve(RAMP_600, Number.NaN)).toBeUndefined()
  })
})

describe('the ramp-length limit', () => {
  it('is 83,886 frames, the longest ramp whose cut speeds read back exactly (2^23 / 100)', () => {
    expect(MAX_RAMP_SEGMENT_FRAMES).toBe(83_886)
  })

  it('keeps a ramp of exactly the limit and refuses one a frame longer', () => {
    const ramp = (length: number) => ({
      keys: [
        { frame: 0, speed: 1 },
        { frame: length, speed: 2 },
      ],
    })
    expect(
      normalizeSpeedCurve(ramp(MAX_RAMP_SEGMENT_FRAMES), MAX_RAMP_SEGMENT_FRAMES),
    ).toBeDefined()
    expect(
      normalizeSpeedCurve(ramp(MAX_RAMP_SEGMENT_FRAMES + 1), MAX_RAMP_SEGMENT_FRAMES + 1),
    ).toBeUndefined()
  })

  it('has no limit for a hold, where a cut inserts the hold’s own speed', () => {
    const length = MAX_RAMP_SEGMENT_FRAMES * 3
    const hold = {
      keys: [
        { frame: 0, speed: 2 },
        { frame: length - 10, speed: 2 },
        { frame: length, speed: 1 },
      ],
    }
    expect(normalizeSpeedCurve(hold, length)).toBeDefined()
  })
})
