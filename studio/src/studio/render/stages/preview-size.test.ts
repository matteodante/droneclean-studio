import { describe, expect, it } from 'vite-plus/test'
import { naturalOf, PREVIEW_REDUCTIONS, previewReducer, previewReduction } from './preview-size'

// Clip 0020: a 3840x2880 frame, stabilized into a 3840x2160 picture for a 16:9 project
const FRAME = { width: 3840, height: 2880 }
const STAGED = { width: 3840, height: 2160 }

describe('previewReduction', () => {
  it('is the largest level that keeps a staged pixel for every preview pixel', () => {
    // The preview of design 8.10's measurement: about 928x522 for the picture, 4.14 staged pixels a preview pixel
    expect(previewReduction(STAGED, { width: 928, height: 522 })).toBe(4)
    expect(previewReduction(STAGED, { width: 1920, height: 1080 })).toBe(2)
    expect(previewReduction(STAGED, { width: 1280, height: 720 })).toBe(3)
    expect(previewReduction(STAGED, { width: 2600, height: 1462 })).toBe(1)
    expect(previewReduction(STAGED, { width: 200, height: 112 })).toBe(8)
  })

  it('never reduces a picture shown at its size or larger, nor for a box that is no box', () => {
    expect(previewReduction(STAGED, STAGED)).toBe(1)
    expect(previewReduction(STAGED, { width: 7680, height: 4320 })).toBe(1)
    expect(previewReduction(STAGED, { width: 0, height: 0 })).toBe(1)
    expect(previewReduction(STAGED, { width: Number.NaN, height: 100 })).toBe(1)
  })

  it('reads the box as FreeCut contains the picture in it: the tighter side decides', () => {
    // A 16:9 picture in a tall box is shown at the box's width
    expect(previewReduction(STAGED, { width: 960, height: 2000 })).toBe(4)
    expect(previewReduction(STAGED, { width: 2000, height: 540 })).toBe(4)
  })

  it('picks from a few levels only, so a box that grows a little each frame keeps its sizes', () => {
    expect(PREVIEW_REDUCTIONS).toEqual([1, 1.5, 2, 3, 4, 6, 8])
    const levels = new Set(Array.from({ length: 50 }, (_, step) => previewReduction(STAGED, { width: 1000 + step, height: 562 + step })))
    expect([...levels]).toEqual([3])
  })
})

describe('previewReducer', () => {
  const quarter = previewReducer(STAGED, { width: 960, height: 540 })

  it('divides the staged picture, and every picture of its size, by the level', () => {
    expect(quarter(STAGED)).toEqual({ width: 960, height: 540, natural: STAGED })
  })

  it('divides the decoded frame by the level too: its pixels are the stabilized picture’s', () => {
    expect(quarter(FRAME)).toEqual({ width: 960, height: 720, natural: FRAME })
  })

  it('divides a finer frame by more and a coarser one (a proxy) by less, and leaves one alone below 1.25', () => {
    expect(quarter({ width: 7680, height: 5760 })).toEqual({ width: 960, height: 720, natural: { width: 7680, height: 5760 } })
    // A proxy at a third of the frame: 4 / 3 of a reduction
    expect(quarter({ width: 1280, height: 960 })).toEqual({ width: 960, height: 720, natural: { width: 1280, height: 960 } })
    // A proxy at a quarter: nothing left to reduce
    expect(quarter({ width: 960, height: 720 })).toEqual({ width: 960, height: 720, natural: { width: 960, height: 720 } })
  })

  it('reduces nothing at level 1, and gives whole pixels, one at least, at any level', () => {
    const none = previewReducer(STAGED, STAGED)
    expect(none(FRAME)).toEqual({ width: 3840, height: 2880, natural: FRAME })
    const smallest = previewReducer({ width: 10, height: 3 }, { width: 1, height: 1 })
    expect(smallest({ width: 10, height: 3 })).toEqual({ width: 1, height: 1, natural: { width: 10, height: 3 } })
    const third = previewReducer({ width: 1000, height: 562 }, { width: 333, height: 187 })
    expect(third({ width: 1000, height: 562 })).toEqual({ width: 333, height: 187, natural: { width: 1000, height: 562 } })
  })
})

describe('naturalOf', () => {
  it('is the size a reduced picture stands for, and a plain size itself', () => {
    expect(naturalOf({ width: 960, height: 540, natural: STAGED })).toEqual(STAGED)
    expect(naturalOf(STAGED)).toBe(STAGED)
  })
})
