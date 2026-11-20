// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { makeTimelineVideoItem, resetTimelineItemsTestState } from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { fractionToNumber, toRate } from '@/studio/time'
import { areaAt, constantSpeed, frameAtArea, speedAt, validateSpeedCurve } from './curve'
import type { SpeedCurve } from './curve'
import {
  easeIntegral,
  easeValue,
  exactEaseArea,
  exactEaseValue,
  SPEED_EASES,
  type SpeedEase,
} from './ease'
import { windowSpeedCurve } from './edits'
import { exactAreaAt, exactSpeedAt } from './exact-curve'
import { sourceFrameAt, timelineFramesForSource } from './mapping'
import { normalizeSpeedCurve } from './normalize'

const RATE = toRate(30)
const EASED: readonly SpeedEase[] = ['smooth', 'ease-in', 'ease-out']

/** One segment from 1x to 4x over `length` frames with the given ease. */
function segment(ease: SpeedEase | undefined, length = 60): SpeedCurve {
  return {
    keys: [
      { frame: 0, speed: 1, ...(ease !== undefined ? { ease } : {}) },
      { frame: length, speed: 4 },
    ],
  }
}

describe('the unit shapes', () => {
  it.each(SPEED_EASES)('%s runs from 0 to 1 and never leaves that range', (ease) => {
    expect(easeValue(ease, 0)).toBe(0)
    expect(easeValue(ease, 1)).toBe(1)
    let previous = 0
    for (let step = 1; step <= 100; step++) {
      const value = easeValue(ease, step / 100)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeLessThanOrEqual(1)
      previous = value
    }
  })

  it.each(SPEED_EASES)('%s: the closed-form integral is the integral of the shape', (ease) => {
    // Midpoint rule over 20,000 steps against the closed form, at several x.
    for (const x of [0.1, 0.37, 0.5, 0.82, 1]) {
      const steps = 20_000
      let sum = 0
      for (let step = 0; step < steps; step++) sum += easeValue(ease, ((step + 0.5) / steps) * x)
      expect(easeIntegral(ease, x)).toBeCloseTo((sum * x) / steps, 8)
    }
  })

  it.each(SPEED_EASES)('%s: the exact integral and value are the double ones, exactly rational', (ease) => {
    for (const [t, length] of [
      [0, 7],
      [3, 7],
      [7, 7],
      [41, 90],
      [1, 83_886],
    ] as const) {
      expect(fractionToNumber(exactEaseArea(ease, t, length))).toBeCloseTo(
        length * easeIntegral(ease, t / length),
        9,
      )
      expect(fractionToNumber(exactEaseValue(ease, t, length))).toBeCloseTo(
        easeValue(ease, t / length),
        12,
      )
    }
  })
})

describe('an eased segment', () => {
  it('without an ease is the line it always was', () => {
    const line = segment(undefined)
    const explicit = segment('linear')
    expect(areaAt(explicit, 37)).toBe(areaAt(line, 37))
    expect(speedAt(explicit, 37)).toBe(speedAt(line, 37))
    expect(areaAt(line, 60)).toBe(150)
  })

  it.each(EASED)('%s: starts and ends on its keys and moves between them', (ease) => {
    const curve = segment(ease)
    expect(speedAt(curve, 0)).toBe(1)
    expect(speedAt(curve, 60)).toBe(4)
    expect(speedAt(curve, 30)).toBeGreaterThan(1)
    expect(speedAt(curve, 30)).toBeLessThan(4)
  })

  it('smooth leaves and arrives slowly: at a fifth of the way it has moved less than a fifth', () => {
    const curve = segment('smooth', 100)
    expect(speedAt(curve, 20) - 1).toBeLessThan((4 - 1) * 0.2)
    expect(speedAt(curve, 50)).toBeCloseTo(2.5, 12)
  })

  it('ease-in stays near the first speed, ease-out near the last', () => {
    expect(speedAt(segment('ease-in', 100), 50)).toBeCloseTo(1.75, 12)
    expect(speedAt(segment('ease-out', 100), 50)).toBeCloseTo(3.25, 12)
  })

  it.each(EASED)('%s: the area is the integral of the speed, with no jump at a key', (ease) => {
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 0.5, ease },
        { frame: 40, speed: 3 },
        { frame: 70, speed: 3, ease },
        { frame: 130, speed: 0.8 },
      ],
    }
    // A fine midpoint sum of the speed: 200 steps a frame.
    let sum = 0
    for (let frame = 0; frame < 130; frame++) {
      for (let step = 0; step < 200; step++) sum += speedAt(curve, frame + (step + 0.5) / 200) / 200
      expect(areaAt(curve, frame + 1)).toBeCloseTo(sum, 6)
    }
    expect(areaAt(curve, 40)).toBeCloseTo(exactAreaAtNumber(curve, 40), 9)
    expect(areaAt(curve, 40 + 1e-9) - areaAt(curve, 40)).toBeLessThan(1e-6)
  })

  it.each(EASED)('%s: the exact area at an integer frame is the double one', (ease) => {
    const curve = segment(ease, 83)
    for (let frame = 0; frame <= 83; frame++) {
      expect(exactAreaAtNumber(curve, frame)).toBeCloseTo(areaAt(curve, frame), 9)
    }
    expect(exactAreaAtNumber(curve, 120)).toBeCloseTo(areaAt(curve, 120), 9)
    expect(fractionToNumber(exactSpeedAt(curve, 25))).toBeCloseTo(speedAt(curve, 25), 12)
  })

  it('has a rational exact area: smooth over 6 frames from 1x to 4x is 15 at the end', () => {
    // area(L) = L·(v0 + dv/2) for smooth and linear alike.
    expect(exactAreaAt(segment('smooth', 6), 6)).toEqual({ num: 15n, den: 1n })
    // ease-in: L·(v0 + dv/3) = 6·2 = 12; ease-out: L·(v0 + 2dv/3) = 6·3 = 18.
    expect(exactAreaAt(segment('ease-in', 6), 6)).toEqual({ num: 12n, den: 1n })
    expect(exactAreaAt(segment('ease-out', 6), 6)).toEqual({ num: 18n, den: 1n })
  })

  it.each(EASED)('%s: the inverse of the area returns the frame', (ease) => {
    const curve = segment(ease, 83)
    for (const frame of [0, 1, 17.5, 40, 82.999, 83, 100]) {
      expect(frameAtArea(curve, areaAt(curve, frame))).toBeCloseTo(frame, 9)
    }
  })

  it.each(EASED)('%s: a clip spends its source span in the frames the exact area says', (ease) => {
    const curve = segment(ease, 83)
    for (let source = 0; source <= 250; source++) {
      const frames = timelineFramesForSource(curve, source, RATE, RATE)
      // The smallest whole number of frames whose area reaches the span.
      expect(areaAt(curve, frames)).toBeGreaterThanOrEqual(source - 1e-9)
      if (frames > 0) expect(areaAt(curve, frames - 1)).toBeLessThan(source)
    }
  })

  it('maps frames through the exact integral', () => {
    const curve = segment('smooth', 60)
    // area(60) = 150 at equal rates, and the last frame shows the floor of its position.
    expect(sourceFrameAt(curve, 60, 100, RATE, RATE)).toBe(250)
    expect(sourceFrameAt(curve, 0, 100, RATE, RATE)).toBe(100)
  })

  it('one speed on both keys is the constant it holds, whatever the ease', () => {
    const flat: SpeedCurve = {
      keys: [
        { frame: 0, speed: 2, ease: 'smooth' },
        { frame: 50, speed: 2 },
      ],
    }
    expect(constantSpeed(flat)).toBe(2)
    expect(areaAt(flat, 50)).toBe(100)
  })
})

describe('validating an eased curve', () => {
  it('accepts every ease and names a bad one', () => {
    for (const ease of SPEED_EASES) validateSpeedCurve(segment(ease))
    const broken = { keys: [{ frame: 0, speed: 1, ease: 'bounce' }, { frame: 10, speed: 2 }] }
    expect(() => validateSpeedCurve(broken as unknown as SpeedCurve)).toThrow(/keys\[0\]\.ease/)
  })

  it('refuses a slice that does not fit its segment or sits on a linear key', () => {
    const slice = { offset: 50, length: 60, from: 1, to: 4 }
    expect(() =>
      validateSpeedCurve({
        keys: [
          { frame: 0, speed: 1, ease: 'smooth', easeSlice: slice },
          { frame: 20, speed: 2 },
        ],
      }),
    ).toThrow(/keys\[0\]\.easeSlice/)
    expect(() =>
      validateSpeedCurve({
        keys: [
          { frame: 0, speed: 1, easeSlice: { ...slice, offset: 0 } },
          { frame: 20, speed: 2 },
        ],
      }),
    ).toThrow(/keys\[0\]\.easeSlice/)
  })
})

describe('normalising an eased curve', () => {
  it('keeps an ease, drops linear, an unknown name and an ease on the last key', () => {
    const normalized = normalizeSpeedCurve(
      {
        keys: [
          { frame: 0, speed: 1, ease: 'smooth' },
          { frame: 20, speed: 2, ease: 'linear' },
          { frame: 40, speed: 3, ease: 'bounce' as SpeedEase },
          { frame: 60, speed: 2, ease: 'ease-in' },
        ],
      },
      60,
    )
    expect(normalized?.keys).toEqual([
      { frame: 0, speed: 1, ease: 'smooth' },
      { frame: 20, speed: 2 },
      { frame: 40, speed: 3 },
      { frame: 60, speed: 2 },
    ])
  })

  it('leaves a curve without eases as the same keys', () => {
    expect(
      normalizeSpeedCurve({ keys: [{ frame: 0, speed: 1 }, { frame: 10, speed: 2 }] }, 10)?.keys,
    ).toEqual([
      { frame: 0, speed: 1 },
      { frame: 10, speed: 2 },
    ])
  })

  it('keeps a slice that fits and drops one that does not', () => {
    const fits = { offset: 10, length: 60, from: 1, to: 4 }
    const kept = normalizeSpeedCurve(
      {
        keys: [
          { frame: 0, speed: 1.2, ease: 'smooth', easeSlice: fits },
          { frame: 20, speed: 2 },
        ],
      },
      20,
    )
    expect(kept?.keys[0]?.easeSlice).toEqual(fits)
    const dropped = normalizeSpeedCurve(
      {
        keys: [
          { frame: 0, speed: 1.2, ease: 'smooth', easeSlice: { ...fits, offset: 50 } },
          { frame: 20, speed: 2 },
        ],
      },
      20,
    )
    expect(dropped?.keys[0]).toEqual({ frame: 0, speed: 1.2, ease: 'smooth' })
  })
})

describe('cutting an eased curve', () => {
  it.each(EASED)('%s: both halves keep the parent’s ramp as slices', (ease) => {
    const parent = segment(ease, 60)
    const left = windowSpeedCurve(parent, 0, 25)
    const right = windowSpeedCurve(parent, 25, 60)
    expect(left.keys[0]?.easeSlice).toEqual({ offset: 0, length: 60, from: 1, to: 4 })
    expect(right.keys[0]?.easeSlice).toEqual({ offset: 25, length: 60, from: 1, to: 4 })
    for (let frame = 0; frame <= 25; frame++) {
      expect(exactAreaAtNumber(left, frame)).toBeCloseTo(areaAt(parent, frame), 9)
    }
    for (let frame = 0; frame <= 35; frame++) {
      expect(exactAreaAtNumber(right, frame)).toBeCloseTo(
        areaAt(parent, 25 + frame) - areaAt(parent, 25),
        9,
      )
    }
  })

  it('a window that is the whole segment keeps it plain', () => {
    const parent = segment('smooth', 60)
    expect(windowSpeedCurve(parent, 0, 60).keys).toEqual(parent.keys)
  })

  it('cutting a slice again composes: the parent ramp stays the parent', () => {
    const parent = segment('smooth', 60)
    const middle = windowSpeedCurve(windowSpeedCurve(parent, 10, 60), 15, 30)
    expect(middle.keys[0]?.easeSlice).toEqual({ offset: 25, length: 60, from: 1, to: 4 })
  })
})

describe('splitting and joining an eased clip in the store', () => {
  it('puts back the parent’s curve, the cut’s key gone', () => {
    resetTimelineItemsTestState()
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1, ease: 'smooth' },
        { frame: 60, speed: 4, ease: 'ease-out' },
        { frame: 100, speed: 0.5 },
      ],
    }
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'clip',
        durationInFrames: 100,
        sourceStart: 0,
        sourceEnd: 200,
        sourceDuration: 4_000,
        sourceFps: 30,
        speed: 2,
        speedCurve: curve,
      }),
    ])
    const parentKeys = useItemsStore.getState().itemById['clip']!.speedCurve!.keys

    // One cut inside the smooth segment, one inside the ease-out one.
    for (const cut of [25, 80]) {
      const { rightItem } = useItemsStore.getState()._splitItem(cut < 60 ? 'clip' : useItemsStore.getState().items.at(-1)!.id, cut)!
      expect(rightItem.speedCurve?.keys[0]?.easeSlice).toBeDefined()
    }
    const ids = useItemsStore.getState().items.map((item) => item.id)
    expect(ids).toHaveLength(3)
    useItemsStore.getState()._joinItems(ids)

    const joined = useItemsStore.getState().itemById['clip']!
    expect(joined.durationInFrames).toBe(100)
    expect(joined.speedCurve?.keys).toEqual(parentKeys)
  })
})

/** The exact area as a double, for comparing with the double maths. */
function exactAreaAtNumber(curve: SpeedCurve, frame: number): number {
  return fractionToNumber(exactAreaAt(curve, frame))
}
