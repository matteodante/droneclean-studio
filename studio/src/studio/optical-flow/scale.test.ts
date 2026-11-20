import { describe, expect, it } from 'vite-plus/test'
import { splatPackingFor } from './kernels'
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

  it('is twice as fine at high motion detail: the frame itself up to twice a 1080p frame, half above (design 11.24)', () => {
    expect(flowScaleFor({ width: 1920, height: 1080 }, 'high')).toBe(1)
    expect(flowScaleFor({ width: 3840, height: 2880 }, 'high')).toBe(2)
    expect(flowSizeFor({ width: 1920, height: 1080 }, 'high')).toEqual({ width: 1920, height: 1080 })
    expect(flowSizeFor({ width: 3840, height: 2880 }, 'high')).toEqual({ width: 1920, height: 1440 })
    expect(flowSizeFor({ width: 3840, height: 2880 }, 'normal')).toEqual(flowSizeFor({ width: 3840, height: 2880 }))
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

describe('the forward warp’s splat key (design 11.24)', () => {
  it('keeps 10 bits of difference at a quarter level for every normal-detail flow up to 8K UHD', () => {
    expect(splatPackingFor(960 * 720)).toEqual({ indexBits: 21, errorScale: 4, errorMax: 1023 })
    expect(splatPackingFor(1920 * 1080)).toEqual({ indexBits: 21, errorScale: 4, errorMax: 1023 })
    expect(splatPackingFor(flowSizeFor({ width: 7680, height: 4320 }).width * 1080)).toEqual({
      indexBits: 21,
      errorScale: 4,
      errorMax: 1023,
    })
  })

  it('takes a 22-bit index for the high-detail flow of the Avata 2 (1920x1440), with 9 bits at half a level', () => {
    expect(splatPackingFor(1920 * 1440)).toEqual({ indexBits: 22, errorScale: 2, errorMax: 511 })
  })

  it('refuses a flow it cannot address, and no key reaches the empty mark (0xffffffff)', () => {
    expect(() => splatPackingFor((1 << 22) + 1)).toThrowError(RangeError)
    for (const pixels of [1 << 21, 1 << 22]) {
      const { indexBits, errorScale, errorMax } = splatPackingFor(pixels)
      // the largest luma difference is 255 levels: quantized it stays under the cap, so the top key is below the mark
      const largest = Math.min(Math.trunc(255 * errorScale), errorMax)
      expect(largest).toBeLessThan(errorMax)
      expect(largest * 2 ** (indexBits + 1) + 2 ** indexBits + (pixels - 1)).toBeLessThan(2 ** 32 - 1)
    }
  })
})
