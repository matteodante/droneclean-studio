import { describe, expect, it } from 'vite-plus/test'
import { computeAverageBitrate } from './average-bitrate'

describe('computeAverageBitrate', () => {
  it('is file size x 8 / duration', () => {
    // 3.76 GB over 300 s is about 100 Mbps.
    expect(computeAverageBitrate(3_760_000_000, 300)).toBe(100_266_667)
    expect(computeAverageBitrate(1_250_000, 10)).toBe(1_000_000)
  })

  it('is 0 when the size or duration is unknown or invalid', () => {
    expect(computeAverageBitrate(null, 10)).toBe(0)
    expect(computeAverageBitrate(undefined, 10)).toBe(0)
    expect(computeAverageBitrate(0, 10)).toBe(0)
    expect(computeAverageBitrate(1000, 0)).toBe(0)
    expect(computeAverageBitrate(1000, Number.NaN)).toBe(0)
    expect(computeAverageBitrate(Number.POSITIVE_INFINITY, 10)).toBe(0)
  })
})
