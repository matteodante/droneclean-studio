import { describe, expect, it } from 'vite-plus/test'
import { restrictToSourceRange } from './source-range'
import { planMotionBlur } from './weights'

const quarter = (frames: number[]) => frames.map((sourceFrame) => ({ sourceFrame, weight: 1 / frames.length }))
const sum = (list: readonly { weight: number }[]) => list.reduce((t, s) => t + s.weight, 0)

describe('restrictToSourceRange', () => {
  it('leaves a blend inside the file as it is', () => {
    const samples = quarter([10, 11, 12, 13])
    expect(restrictToSourceRange(samples, 1199)).toBe(samples)
  })

  it('4x on a 1199 frame source: the last output frame uses 1196-1198 at 1/3 each', () => {
    const plan = planMotionBlur({
      clip: { type: 'video', sourceStart: 0, sourceFps: 60, speed: 4 },
      timelineFrame: 299,
      projectRate: { num: 60, den: 1 },
      shutterDegrees: 360,
    })
    expect(plan.samples.map((s) => s.sourceFrame)).toEqual([1196, 1197, 1198, 1199])
    const kept = restrictToSourceRange(plan.samples, 1199)
    expect(kept.map((s) => s.sourceFrame)).toEqual([1196, 1197, 1198])
    for (const s of kept) expect(s.weight).toBeCloseTo(1 / 3, 12)
    expect(sum(kept)).toBeCloseTo(1, 12)
  })

  it('a reversed clip starting at frame 0 drops the samples below it', () => {
    const kept = restrictToSourceRange(quarter([-2, -1, 0, 1]), 100)
    expect(kept.map((s) => s.sourceFrame)).toEqual([0, 1])
    expect(kept.map((s) => s.weight)).toEqual([0.5, 0.5])
  })

  it('a ramp ending at the file end keeps unequal weights in proportion', () => {
    const samples = [
      { sourceFrame: 98, weight: 0.5 },
      { sourceFrame: 99, weight: 0.3 },
      { sourceFrame: 100, weight: 0.2 },
    ]
    const kept = restrictToSourceRange(samples, 100)
    expect(kept.map((s) => s.sourceFrame)).toEqual([98, 99])
    expect(kept[0]!.weight).toBeCloseTo(0.625, 12)
    expect(kept[1]!.weight).toBeCloseTo(0.375, 12)
    expect(sum(kept)).toBeCloseTo(1, 12)
  })

  it('with nothing left, the nearest frame that exists at weight 1', () => {
    expect(restrictToSourceRange(quarter([100, 101]), 100)).toEqual([{ sourceFrame: 99, weight: 1 }])
    expect(restrictToSourceRange(quarter([-3, -2]), 100)).toEqual([{ sourceFrame: 0, weight: 1 }])
  })

  it('refuses a bad count and an empty plan', () => {
    expect(() => restrictToSourceRange(quarter([1]), 0)).toThrow(RangeError)
    expect(() => restrictToSourceRange(quarter([1]), 1.5)).toThrow(RangeError)
    expect(() => restrictToSourceRange([], 10)).toThrow(RangeError)
  })
})
