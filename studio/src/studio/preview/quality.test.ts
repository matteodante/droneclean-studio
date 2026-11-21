// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { isPreviewQualityLevel, scalePreviewRenderSize } from './quality'

describe('scalePreviewRenderSize', () => {
  it('renders a quarter of the pixels at 1/2 and a sixteenth at 1/4', () => {
    expect(scalePreviewRenderSize({ width: 1920, height: 1080 }, 0.5)).toEqual({
      width: 960,
      height: 540,
    })
    expect(scalePreviewRenderSize({ width: 1920, height: 1080 }, 0.25)).toEqual({
      width: 480,
      height: 270,
    })
  })

  it('keeps full quality as it is, and both sides even', () => {
    expect(scalePreviewRenderSize({ width: 1504, height: 846 }, 1)).toEqual({
      width: 1504,
      height: 846,
    })
    const vertical = scalePreviewRenderSize({ width: 1080, height: 1920 }, 0.25)
    expect(vertical).toEqual({ width: 270, height: 480 })
    expect(scalePreviewRenderSize({ width: 1504, height: 846 }, 0.25)).toEqual({
      width: 376,
      height: 212,
    })
  })
})

describe('isPreviewQualityLevel', () => {
  it('accepts the levels the menu offers', () => {
    expect([1, 0.5, 0.25].every(isPreviewQualityLevel)).toBe(true)
    expect([0.33, 0, 2, '1'].some(isPreviewQualityLevel)).toBe(false)
  })
})
