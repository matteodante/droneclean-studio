import { describe, expect, it } from 'vitest'
import {
  applyFraming,
  framingOf,
  framingRoom,
  framingShift,
  SAFE_FRACTION,
  windowExtent,
} from './reframe'
import { prepareFrame, type StabilizationFrame } from './stage'
import { validateStabilization } from './settings'

const TRANSLATION_2D = 216

/** A 4:3 source (1920x1440) stabilized into a 9:16 window (810x1440), identity rotation, a pinhole of f=1000 */
function frame(options: { fov?: number; pan?: [number, number]; rotation?: number } = {}): StabilizationFrame {
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
  view.setFloat32(176, options.fov ?? 1, true)
  view.setFloat32(TRANSLATION_2D, options.pan?.[0] ?? 0, true)
  view.setFloat32(TRANSLATION_2D + 4, options.pan?.[1] ?? 0, true)
  const matrices = new Float32Array(16)
  const a = options.rotation ?? 0
  matrices.set([Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1])
  return { params, matrices, mesh: new Float32Array(0) }
}

const pan = (params: Uint8Array) => {
  const view = new DataView(params.buffer, params.byteOffset)
  return [view.getFloat32(TRANSLATION_2D, true), view.getFloat32(TRANSLATION_2D + 4, true)]
}

describe('framingOf', () => {
  it('is nothing for a clip without the fields or at 0 and 0', () => {
    expect(framingOf(undefined)).toBeUndefined()
    expect(framingOf({})).toBeUndefined()
    expect(framingOf({ framingX: 0, framingY: 0 })).toBeUndefined()
    expect(framingOf({ framingX: 0.5 })).toEqual({ x: 0.5, y: 0 })
  })
})

describe('the room', () => {
  it('is what is left of the picture beside the window (pinhole, no rotation)', () => {
    const { params, matrices } = frame()
    // The window is 810 wide at f=1000, fov 1: source x from 555 to 1365; the height fills the picture
    const extent = windowExtent(params, matrices)!
    expect(extent.minX).toBeCloseTo(555, 3)
    expect(extent.maxX).toBeCloseTo(1365, 3)
    const room = framingRoom(params, matrices)
    expect(room.left).toBeCloseTo(555, 3)
    expect(room.right).toBeCloseTo(555, 3)
    expect(room.up).toBeCloseTo(0, 3)
    expect(room.down).toBeCloseTo(0, 3)
  })

  it('shrinks with the zoom out and with a rotation, and has none behind the camera', () => {
    const wide = framingRoom(frame({ fov: 1.2 }).params, frame({ fov: 1.2 }).matrices)
    expect(wide.left).toBeLessThan(555)
    const turned = frame({ rotation: 0.1 })
    expect(framingRoom(turned.params, turned.matrices).left).toBeLessThan(555)
    const behind = frame()
    behind.matrices[8] = -1
    expect(framingRoom(behind.params, behind.matrices)).toEqual({ left: 0, right: 0, up: 0, down: 0 })
  })

  it('has none for an output projection other than rectilinear', () => {
    const odd = frame()
    new DataView(odd.params.buffer).setInt32(376, 2, true)
    expect(framingRoom(odd.params, odd.matrices).left).toBe(0)
  })
})

describe('the shift', () => {
  const room = { left: 100, right: 300, up: 10, down: 20 }
  it('is the fraction of the room on the side it moves toward, SAFE_FRACTION of it at most', () => {
    expect(framingShift(room, { x: 0.5, y: 0 })).toEqual({ x: 0.5 * 300 * SAFE_FRACTION, y: 0 })
    expect(framingShift(room, { x: -1, y: -1 })).toEqual({
      x: -100 * SAFE_FRACTION,
      y: -10 * SAFE_FRACTION,
    })
  })
  it('clamps a value outside -1..1', () => {
    expect(framingShift(room, { x: 7, y: 0 })).toEqual(framingShift(room, { x: 1, y: 0 }))
    expect(framingShift(room, { x: -7, y: 0 })).toEqual(framingShift(room, { x: -1, y: 0 }))
  })
})

describe('applyFraming', () => {
  it('moves the sampled window by the expected source pixels (fov 1: one output pixel is one source pixel)', () => {
    const { params, matrices } = frame()
    applyFraming(params, matrices, { x: 0.5, y: 0 })
    const expected = 0.5 * 555 * SAFE_FRACTION
    expect(pan(params)[0]).toBeCloseTo(expected, 3)
    expect(pan(params)[1]).toBeCloseTo(0, 6)
    // The window really is `expected` source pixels further right
    expect(windowExtent(params, matrices)!.minX).toBeCloseTo(555 + expected, 2)
  })

  it('converts through the zoom: the translation is in output pixels, the shift in source pixels', () => {
    const { params, matrices } = frame({ fov: 1.1 })
    const room = framingRoom(params, matrices)
    applyFraming(params, matrices, { x: 1, y: 0 })
    expect(pan(params)[0]).toBeCloseTo((room.right * SAFE_FRACTION) / 1.1, 3)
  })

  it('never leaves the picture, at the extremes and with values beyond them', () => {
    for (const x of [-1, 1, -9, 9]) {
      const { params, matrices } = frame({ rotation: 0.05, pan: [20, 0] })
      applyFraming(params, matrices, { x, y: 0 })
      const extent = windowExtent(params, matrices)!
      expect(extent.minX).toBeGreaterThanOrEqual(-1e-3)
      expect(extent.maxX).toBeLessThanOrEqual(1920 + 1e-3)
    }
  })

  it('adds to the pan the engine already has', () => {
    const { params, matrices } = frame({ pan: [30, 0] })
    const room = framingRoom(params, matrices)
    applyFraming(params, matrices, { x: -1, y: 0 })
    expect(pan(params)[0]).toBeCloseTo(30 - room.left * SAFE_FRACTION, 3)
  })

  it('leaves the bytes alone at 0, undefined and a framing with nothing in it', () => {
    const base = frame()
    for (const framing of [undefined, { x: 0, y: 0 }]) {
      const copy = frame()
      applyFraming(copy.params, copy.matrices, framing)
      expect(copy.params).toEqual(base.params)
    }
  })
})

describe('prepareFrame with a framing', () => {
  it('is byte-identical to today without one (an old project), and moves only the translation with one', () => {
    const base = prepareFrame(frame())
    expect(prepareFrame(frame(), undefined, undefined).params).toEqual(base.params)
    expect(prepareFrame(frame(), undefined, { x: 0, y: 0 }).params).toEqual(base.params)
    const moved = prepareFrame(frame(), undefined, { x: 1, y: 0 })
    const differing = Array.from(moved.params).flatMap((byte, index) => (byte === base.params[index] ? [] : [index]))
    expect(differing.length).toBeGreaterThan(0)
    expect(differing.every((index) => index >= TRANSLATION_2D && index < TRANSLATION_2D + 4)).toBe(true)
    expect(moved.matrices).toEqual(base.matrices)
  })
})

describe('the stored field', () => {
  const stored = {
    enabled: true,
    method: 'Default',
    params: {},
    fov: 1,
    horizonLockPercent: 0,
    horizonLockRoll: 0,
    adaptiveZoomSeconds: 4,
  }
  it('is optional: a project without it loads as it was written', () => {
    expect(validateStabilization(stored)).toEqual(stored)
  })
  it('keeps a valid pair and refuses one outside -1..1 or not a number', () => {
    expect(validateStabilization({ ...stored, framingX: -0.4, framingY: 1 })).toMatchObject({
      framingX: -0.4,
      framingY: 1,
    })
    expect(() => validateStabilization({ ...stored, framingX: 1.01 })).toThrow('stabilization.framingX')
    expect(() => validateStabilization({ ...stored, framingY: '0' })).toThrow('stabilization.framingY')
  })
})
