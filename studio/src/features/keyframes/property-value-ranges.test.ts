import { afterEach, describe, expect, it } from 'vite-plus/test'
import { PROPERTY_VALUE_RANGES, setPropertyRangeCanvas } from './property-value-ranges'

describe('PROPERTY_VALUE_RANGES', () => {
  it('covers the full text preset scale supported by the text inspector', () => {
    expect(PROPERTY_VALUE_RANGES.textStyleScale).toMatchObject({ min: 0.5, max: 6 })
  })

  it('covers scaled text preset shadows', () => {
    expect(PROPERTY_VALUE_RANGES.textShadowBlur).toMatchObject({ min: 0, max: 160 })
  })

  it('uses normalized graph ranges for path positions and bezier handles', () => {
    expect(PROPERTY_VALUE_RANGES['pathVertex:0:positionX']).toMatchObject({
      min: 0,
      max: 1,
      decimals: 3,
    })
    expect(PROPERTY_VALUE_RANGES['pathVertex:0:outY']).toMatchObject({
      min: -2,
      max: 2,
      decimals: 3,
    })
  })

  describe('pixel bounds follow the project size', () => {
    afterEach(() => setPropertyRangeCanvas({ width: 1920, height: 1080 }))

    it('keeps the original bounds for a 1920x1080 project', () => {
      setPropertyRangeCanvas({ width: 1920, height: 1080 })
      expect(PROPERTY_VALUE_RANGES.x).toMatchObject({ min: -1000, max: 2000 })
      expect(PROPERTY_VALUE_RANGES.width).toMatchObject({ min: 0, max: 2000 })
    })

    it('covers the frame of a 1440x2560 project with margin', () => {
      setPropertyRangeCanvas({ width: 1440, height: 2560 })
      for (const property of ['x', 'y', 'anchorX', 'anchorY'] as const) {
        expect(PROPERTY_VALUE_RANGES[property].min).toBeLessThanOrEqual(-1400)
        expect(PROPERTY_VALUE_RANGES[property].max).toBeGreaterThan(2560)
      }
      expect(PROPERTY_VALUE_RANGES.height.min).toBe(0)
      expect(PROPERTY_VALUE_RANGES.height.max).toBeGreaterThan(2560)
      expect(PROPERTY_VALUE_RANGES.cropTop.max).toBeGreaterThanOrEqual(2560)
    })

    it('leaves non-pixel-frame properties alone', () => {
      setPropertyRangeCanvas({ width: 3840, height: 2160 })
      expect(PROPERTY_VALUE_RANGES.rotation).toMatchObject({ min: -360, max: 360 })
      expect(PROPERTY_VALUE_RANGES.fontSize).toMatchObject({ min: 8, max: 500 })
    })
  })
})
