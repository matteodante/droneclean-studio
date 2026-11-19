import { describe, expect, it } from 'vite-plus/test'
import { boxForStabilization } from './frame-box'

/** Clip 0020: 3840x2880 (4:3) */
const FILE = { width: 3840, height: 2880 }
/** A vertical project */
const VERTICAL = { width: 1080, height: 1920 }
/** The 4:3 file fitted into the vertical frame, as the clip was placed */
const FILE_FIT = { x: 0, y: 0, width: 1080, height: 810, rotation: 0 }

describe('the box of a clip whose stabilization is switched', () => {
  it('takes the whole frame when switched on, from the file’s untouched fit, and goes back when switched off', () => {
    const on = boxForStabilization(FILE_FIT, true, FILE, VERTICAL)
    expect(on).toEqual({ x: 0, y: 0, width: 1080, height: 1920, rotation: 0 })
    expect(boxForStabilization(on!, false, FILE, VERTICAL)).toEqual(FILE_FIT)
  })

  it('leaves a box the pilot sized, moved or turned', () => {
    // A real fill of the frame: 2560x1920
    expect(boxForStabilization({ ...FILE_FIT, width: 2560, height: 1920 }, true, FILE, VERTICAL)).toBeNull()
    expect(boxForStabilization({ ...FILE_FIT, x: 40 }, true, FILE, VERTICAL)).toBeNull()
    expect(boxForStabilization({ ...FILE_FIT, rotation: 90 }, true, FILE, VERTICAL)).toBeNull()
  })

  it('changes nothing for a file of the project’s own aspect, a clip with no box, or an unknown size', () => {
    const landscape = { width: 1920, height: 1440 }
    expect(boxForStabilization({ x: 0, y: 0, width: 1920, height: 1440 }, true, FILE, landscape)).toBeNull()
    expect(boxForStabilization(undefined, true, FILE, VERTICAL)).toBeNull()
    expect(boxForStabilization(FILE_FIT, true, undefined, VERTICAL)).toBeNull()
    expect(boxForStabilization(FILE_FIT, true, FILE, undefined)).toBeNull()
  })
})
