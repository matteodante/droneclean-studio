import { describe, expect, it } from 'vite-plus/test'
import { flowLevels, flowScaleFor, flowSizeFor, levelWork } from './scale'

describe('the flow size', () => {
  it('is half the frame up to twice a 1080p frame, a quarter above (design 11.12)', () => {
    expect(flowScaleFor({ width: 1920, height: 1080 })).toBe(2)
    expect(flowScaleFor({ width: 2688, height: 1512 })).toBe(2)
    expect(flowScaleFor({ width: 3840, height: 2160 })).toBe(4)
    expect(flowScaleFor({ width: 3840, height: 2880 })).toBe(4)
    expect(flowSizeFor({ width: 1920, height: 1080 })).toEqual({ width: 960, height: 540 })
    expect(flowSizeFor({ width: 3840, height: 2880 })).toEqual({ width: 960, height: 720 })
  })

  it('is at least one pixel each way, and refuses a size that is not whole pixels', () => {
    expect(flowSizeFor({ width: 1, height: 3 })).toEqual({ width: 1, height: 1 })
    expect(() => flowScaleFor({ width: 0, height: 10 })).toThrowError(RangeError)
    expect(() => flowScaleFor({ width: 10.5, height: 10 })).toThrowError(RangeError)
  })
})

describe('the pyramid', () => {
  it('halves down to a short side of about 32, as the probe did (5 levels at 960x540, 6 at 1080p, 7 at 4K)', () => {
    expect(flowLevels({ width: 960, height: 540 })).toHaveLength(5)
    expect(flowLevels({ width: 1920, height: 1080 })).toHaveLength(6)
    expect(flowLevels({ width: 3840, height: 2160 })).toHaveLength(7)
    expect(flowLevels({ width: 960, height: 720 }).at(-1)).toEqual({ width: 60, height: 45 })
    expect(flowLevels({ width: 40, height: 20 })).toEqual([{ width: 40, height: 20 }])
  })

  it('gives the three coarsest levels six rounds, and a 7x7 window above level 1', () => {
    expect([4, 3, 2, 1, 0].map((level) => levelWork(level, 5))).toEqual([
      { rounds: 6, radius: 3 },
      { rounds: 6, radius: 3 },
      { rounds: 6, radius: 3 },
      { rounds: 3, radius: 2 },
      { rounds: 3, radius: 2 },
    ])
  })
})
