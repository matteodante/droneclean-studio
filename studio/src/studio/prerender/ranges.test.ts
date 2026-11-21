// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { coalesceRanges, rangesOfFlags, resolvePrerenderRange, subtractRanges } from './ranges'

describe('resolvePrerenderRange', () => {
  it('renders the In/Out range when one is set', () => {
    expect(resolvePrerenderRange({ inPoint: 30, outPoint: 90, timelineEnd: 300 })).toEqual({
      start: 30,
      end: 90,
    })
  })

  it('renders the whole timeline without an In/Out range', () => {
    expect(resolvePrerenderRange({ inPoint: null, outPoint: null, timelineEnd: 300 })).toEqual({
      start: 0,
      end: 300,
    })
    // An out point before the in point is no range
    expect(resolvePrerenderRange({ inPoint: 90, outPoint: 30, timelineEnd: 300 })).toEqual({
      start: 0,
      end: 300,
    })
  })

  it("lets the caller's bounds replace either end, and clamps the end to the timeline", () => {
    expect(
      resolvePrerenderRange({ startFrame: 40, inPoint: 30, outPoint: 90, timelineEnd: 300 }),
    ).toEqual({ start: 40, end: 90 })
    expect(
      resolvePrerenderRange({ endFrame: 500, inPoint: null, outPoint: null, timelineEnd: 300 }),
    ).toEqual({ start: 0, end: 300 })
  })

  it('covers nothing on an empty timeline or with bounds out of order', () => {
    expect(resolvePrerenderRange({ inPoint: null, outPoint: null, timelineEnd: 0 })).toBeNull()
    expect(
      resolvePrerenderRange({
        startFrame: 100,
        endFrame: 50,
        inPoint: null,
        outPoint: null,
        timelineEnd: 300,
      }),
    ).toBeNull()
    expect(
      resolvePrerenderRange({ startFrame: 1.5, inPoint: null, outPoint: null, timelineEnd: 300 }),
    ).toBeNull()
  })
})

describe('coalesceRanges and subtractRanges', () => {
  it('merges overlapping and touching ranges in order', () => {
    expect(
      coalesceRanges([
        { start: 50, end: 60 },
        { start: 0, end: 10 },
        { start: 10, end: 20 },
        { start: 55, end: 70 },
        { start: 30, end: 30 },
      ]),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 50, end: 70 },
    ])
  })

  it('leaves the frames no cached range holds', () => {
    expect(
      subtractRanges({ start: 0, end: 100 }, [
        { start: 20, end: 30 },
        { start: 25, end: 40 },
        { start: 90, end: 120 },
      ]),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 40, end: 90 },
    ])
    expect(subtractRanges({ start: 10, end: 20 }, [{ start: 0, end: 50 }])).toEqual([])
    expect(subtractRanges({ start: 10, end: 20 }, [])).toEqual([{ start: 10, end: 20 }])
  })
})

describe('rangesOfFlags', () => {
  it('turns a run of valid flags into frame ranges', () => {
    expect(rangesOfFlags([true, true, false, true, false, false, true], 100)).toEqual([
      { start: 100, end: 102 },
      { start: 103, end: 104 },
      { start: 106, end: 107 },
    ])
    expect(rangesOfFlags([], 0)).toEqual([])
  })
})
