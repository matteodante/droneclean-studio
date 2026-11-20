import { describe, expect, it } from 'vitest'
import type { ItemKeyframes, Keyframe } from '@/types/keyframe'
import type { VideoItem } from '@/types/timeline'
import { PROPERTY_VALUE_RANGES } from '@/features/keyframes/property-value-ranges'
import { getAnimatablePropertiesForItem } from '@/features/keyframes/utils/animatable-properties'
import { getAnimatablePropertyBaseValue } from '@/features/keyframes/utils/animatable-property-base-value'
import { framingValueAt, hasFramingKeyframes, withAnimatedFraming } from './framing-keyframes'
import { applyFraming, framingOf, framingRoom, windowExtent, SAFE_FRACTION } from './reframe'
import { prepareFrame, type StabilizationFrame } from './stage'

const TRANSLATION_2D = 216

/** A 4:3 source (1920x1440) stabilized into a 9:16 window (810x1440): the room is 555 pixels each side */
function frame(): StabilizationFrame {
  const params = new Uint8Array(416)
  const view = new DataView(params.buffer)
  view.setInt32(0, 1920, true)
  view.setInt32(4, 1440, true)
  view.setInt32(12, 810, true)
  view.setInt32(16, 1440, true)
  view.setInt32(24, 1, true)
  view.setFloat32(64, 1000, true)
  view.setFloat32(68, 1000, true)
  view.setFloat32(72, 960, true)
  view.setFloat32(76, 720, true)
  view.setFloat32(176, 1, true)
  const matrices = new Float32Array(16)
  matrices.set([1, 0, 0, 0, 1, 0, 0, 0, 1])
  return { params, matrices, mesh: new Float32Array(0) }
}

const stabilization = {
  enabled: true,
  method: 'Default',
  params: {},
  fov: 1,
  horizonLockPercent: 0,
  horizonLockRoll: 0,
  adaptiveZoomSeconds: 4,
}

function clip(settings: Partial<VideoItem['stabilization']> = {}): VideoItem {
  return {
    id: 'c1',
    type: 'video',
    from: 100,
    durationInFrames: 100,
    stabilization: { ...stabilization, ...settings },
  } as unknown as VideoItem
}

const key = (id: string, frameNumber: number, value: number, easing: Keyframe['easing'] = 'linear'): Keyframe => ({
  id,
  frame: frameNumber,
  value,
  easing,
})

function lanes(...entries: [string, Keyframe[]][]): ItemKeyframes {
  return {
    itemId: 'c1',
    properties: entries.map(([property, keyframes]) => ({ property, keyframes })),
  } as ItemKeyframes
}

/** What the stage hands the warp for a clip at a clip frame: `framingOf` of the settings the frame is drawn with */
function warpFraming(item: VideoItem, keyframes: ItemKeyframes | undefined, clipFrame: number) {
  return framingOf(withAnimatedFraming(item, keyframes, clipFrame).stabilization)
}

const pan = (params: Uint8Array) => new DataView(params.buffer, params.byteOffset).getFloat32(TRANSLATION_2D, true)

describe('the framing as a keyframable property', () => {
  it('has the range -1..1, a base value from the stored setting, and is offered only while stabilization is on', () => {
    expect(PROPERTY_VALUE_RANGES.framingX).toMatchObject({ min: -1, max: 1 })
    expect(PROPERTY_VALUE_RANGES.framingY).toMatchObject({ min: -1, max: 1 })
    const canvas = { width: 810, height: 1440, fps: 30 }
    expect(getAnimatablePropertyBaseValue(clip({ framingX: 0.4 }), 'framingX', canvas)).toBe(0.4)
    expect(getAnimatablePropertyBaseValue(clip(), 'framingY', canvas)).toBe(0)
    expect(getAnimatablePropertiesForItem(clip())).toEqual(expect.arrayContaining(['framingX', 'framingY']))
    expect(getAnimatablePropertiesForItem(clip({ enabled: false }))).not.toContain('framingX')
    const plain = { ...clip(), stabilization: undefined } as unknown as VideoItem
    expect(getAnimatablePropertiesForItem(plain)).not.toContain('framingX')
  })
})

describe('withAnimatedFraming', () => {
  it('is the same clip, not a copy, without a framing keyframe (an old project is not touched)', () => {
    const item = clip({ framingX: 0.3 })
    expect(withAnimatedFraming(item, undefined, 40)).toBe(item)
    expect(withAnimatedFraming(item, lanes(['opacity', [key('o', 0, 1)]]), 40)).toBe(item)
    expect(withAnimatedFraming(item, lanes(['framingX', []]), 40)).toBe(item)
    const unstabilized = { ...item, stabilization: undefined } as unknown as VideoItem
    expect(withAnimatedFraming(unstabilized, lanes(['framingX', [key('a', 0, 1)]]), 40)).toBe(unstabilized)
  })

  it('gives the interpolated value at a middle frame, each lane on its own', () => {
    const keyframes = lanes(['framingX', [key('a', 0, -1), key('b', 100, 1)]])
    const framed = withAnimatedFraming(clip({ framingY: -0.5 }), keyframes, 50)
    expect(framed.stabilization?.framingX).toBeCloseTo(0, 9)
    // Y has no keyframe: its stored setting
    expect(framed.stabilization?.framingY).toBe(-0.5)
    expect(withAnimatedFraming(clip(), keyframes, 25).stabilization?.framingX).toBeCloseTo(-0.5, 9)
    // The clip's other fields and the stored setting are untouched
    expect(framed.id).toBe('c1')
    expect(clip().stabilization?.framingX).toBeUndefined()
  })

  it('holds the first and last keyframe outside them, and one keyframe everywhere', () => {
    const two = lanes(['framingY', [key('a', 20, 0.2), key('b', 60, 0.8)]])
    expect(framingValueAt({}, two, 0, 'framingY')).toBe(0.2)
    expect(framingValueAt({}, two, 99, 'framingY')).toBe(0.8)
    const one = lanes(['framingX', [key('a', 30, -0.6)]])
    expect(framingValueAt({ framingX: 0.9 }, one, 0, 'framingX')).toBe(-0.6)
    expect(hasFramingKeyframes(one)).toBe(true)
    expect(hasFramingKeyframes(undefined)).toBe(false)
  })

  it('holds a curve that overshoots to -1..1', () => {
    const spring = lanes([
      'framingX',
      [{ ...key('a', 0, 0.9, 'cubic-bezier'), easingConfig: { type: 'cubic-bezier', bezier: { x1: 0.2, y1: 3, x2: 0.8, y2: 3 } } }, key('b', 100, 1)],
    ])
    for (let at = 0; at <= 100; at += 5) {
      const value = framingValueAt({}, spring, at, 'framingX')
      expect(value).toBeLessThanOrEqual(1)
      expect(value).toBeGreaterThanOrEqual(-1)
    }
  })
})

describe('in the warp parameters', () => {
  it('two keyframes put the interpolated offset in translation2d at a middle frame', () => {
    const keyframes = lanes(['framingX', [key('a', 0, 0), key('b', 100, 1)]])
    const base = frame()
    const middle = prepareFrame(base, undefined, warpFraming(clip(), keyframes, 50))
    // Half way is a framing of 0.5, which is what a constant 0.5 gives
    expect(middle.params).toEqual(prepareFrame(frame(), undefined, { x: 0.5, y: 0 }).params)
    expect(pan(middle.params)).toBeCloseTo(0.5 * 555 * SAFE_FRACTION, 3)
    // The ends are 0 (no shift: today's bytes) and the full 1
    expect(prepareFrame(frame(), undefined, warpFraming(clip(), keyframes, 0)).params).toEqual(
      prepareFrame(frame()).params,
    )
    expect(pan(prepareFrame(frame(), undefined, warpFraming(clip(), keyframes, 100)).params)).toBeCloseTo(
      555 * SAFE_FRACTION,
      3,
    )
  })

  it('no keyframes is byte-identical to the stored framing, and to today with none stored', () => {
    expect(prepareFrame(frame(), undefined, warpFraming(clip(), undefined, 50)).params).toEqual(
      prepareFrame(frame()).params,
    )
    const stored = clip({ framingX: -0.4, framingY: 0.2 })
    expect(prepareFrame(frame(), undefined, warpFraming(stored, undefined, 50)).params).toEqual(
      prepareFrame(frame(), undefined, framingOf(stored.stabilization)).params,
    )
  })

  it('the clamp still holds with the animated value, at the extremes of the lane', () => {
    const keyframes = lanes(['framingX', [key('a', 0, -1), key('b', 100, 1)]])
    for (const at of [0, 10, 50, 90, 100]) {
      const { params, matrices } = frame()
      applyFraming(params, matrices, warpFraming(clip(), keyframes, at))
      const extent = windowExtent(params, matrices)!
      expect(extent.minX).toBeGreaterThanOrEqual(-1e-3)
      expect(extent.maxX).toBeLessThanOrEqual(1920 + 1e-3)
    }
    // The room is measured per frame: at the extreme the window stays a tenth of the room from the edge
    const full = frame()
    applyFraming(full.params, full.matrices, warpFraming(clip(), keyframes, 100))
    expect(framingRoom(full.params, full.matrices).right).toBeGreaterThan(0)
  })
})
