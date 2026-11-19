import { describe, expect, it } from 'vite-plus/test'
import { hasFloat32Blendable, optionalDeviceFeatures } from './device-features'

describe('the optional device features', () => {
  it('asks for float32-blendable only when the adapter offers it', () => {
    expect(optionalDeviceFeatures({ features: new Set(['float32-blendable', 'shader-f16']) })).toEqual([
      'float32-blendable',
    ])
    expect(optionalDeviceFeatures({ features: new Set(['shader-f16']) })).toEqual([])
    expect(optionalDeviceFeatures({})).toEqual([])
  })

  it('reads whether a device has it', () => {
    expect(hasFloat32Blendable({ features: new Set(['float32-blendable']) })).toBe(true)
    expect(hasFloat32Blendable({ features: new Set() })).toBe(false)
    expect(hasFloat32Blendable({})).toBe(false)
  })
})
