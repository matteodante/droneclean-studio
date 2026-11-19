// The optional WebGPU features DroneClean asks for when it creates a GPU device (the one place that decides them:
// `EffectsPipeline.requestCachedDevice` passes `optionalDeviceFeatures(adapter)` to `requestDevice`, so the preview,
// the export worker, the headless export and the benchmark pages all get the same device).
//
// `float32-blendable` lets a 32-bit float render target be blended. The motion blur's accumulator adds each sample
// with the blend unit; in 16-bit float each add rounds to 11 significant bits, which near the top of the range is up
// to ~0.3 level of 1023 a step (design 7.2, measurement of 19 Nov 2026: 1.29 levels from the CPU's mean).

/** The feature that makes `rgba32float` blendable. */
const FLOAT32_BLENDABLE = 'float32-blendable'

/** What a device or an adapter exposes of its features. */
interface HasFeatures {
  readonly features?: { has(name: string): boolean }
}

/** The optional features this adapter offers and DroneClean uses: the `requiredFeatures` of its device. */
export function optionalDeviceFeatures(adapter: HasFeatures): GPUFeatureName[] {
  return adapter.features?.has(FLOAT32_BLENDABLE) === true ? [FLOAT32_BLENDABLE] : []
}

/** Whether a device was created with `float32-blendable` (a fake device in a test may have no features at all). */
export function hasFloat32Blendable(device: HasFeatures): boolean {
  return device.features?.has(FLOAT32_BLENDABLE) === true
}
