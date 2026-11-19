import { describe, expect, it } from 'vite-plus/test'
import { validateStabilization, type SmoothingMethod, type StabilizationSettings } from '../settings'
import {
  HORIZON_LOCK_PERCENT_RANGE,
  HORIZON_LOCK_ROLL_RANGE,
  applyChange,
  lensProfileName,
} from './changes'

const METHODS: SmoothingMethod[] = [
  {
    name: 'Default',
    params: [{ name: 'smoothness', description: 'Smoothness', default: 0.5, min: 0.001, max: 1, unit: '' }],
  },
]

const SETTINGS: StabilizationSettings = {
  enabled: true,
  method: 'Default',
  params: { smoothness: 0.5 },
  fov: 1,
  horizonLockPercent: 0,
  horizonLockRoll: 0,
  adaptiveZoomSeconds: 4,
}

describe('applyChange', () => {
  it('sets each control’s value and keeps the rest', () => {
    expect(applyChange(SETTINGS, { kind: 'smoothness', value: 0.8 }, METHODS)?.params.smoothness).toBe(0.8)
    expect(applyChange(SETTINGS, { kind: 'fov', value: 1.2 }, METHODS)?.fov).toBe(1.2)
    expect(applyChange(SETTINGS, { kind: 'horizonLockPercent', value: 50 }, METHODS)?.horizonLockPercent).toBe(50)
    expect(applyChange(SETTINGS, { kind: 'horizonLockRoll', value: -10 }, METHODS)?.horizonLockRoll).toBe(-10)
    expect(applyChange(SETTINGS, { kind: 'adaptiveZoomSeconds', value: 0 }, METHODS)?.adaptiveZoomSeconds).toBe(0)
  })

  it('refuses a value outside the allowed range, and one that is not a number', () => {
    expect(applyChange(SETTINGS, { kind: 'smoothness', value: 1.5 }, METHODS)).toBeNull()
    expect(applyChange(SETTINGS, { kind: 'smoothness', value: 0 }, METHODS)).toBeNull()
    expect(applyChange(SETTINGS, { kind: 'fov', value: 0 }, METHODS)).toBeNull()
    expect(applyChange(SETTINGS, { kind: 'fov', value: -1 }, METHODS)).toBeNull()
    expect(applyChange(SETTINGS, { kind: 'horizonLockPercent', value: 101 }, METHODS)).toBeNull()
    expect(applyChange(SETTINGS, { kind: 'horizonLockPercent', value: -1 }, METHODS)).toBeNull()
    expect(applyChange(SETTINGS, { kind: 'horizonLockRoll', value: 181 }, METHODS)).toBeNull()
    expect(applyChange(SETTINGS, { kind: 'adaptiveZoomSeconds', value: -0.5 }, METHODS)).toBeNull()
    expect(applyChange(SETTINGS, { kind: 'fov', value: Number.NaN }, METHODS)).toBeNull()
  })

  it('refuses smoothness for a method that has no such parameter', () => {
    expect(applyChange({ ...SETTINGS, method: 'No smoothing' }, { kind: 'smoothness', value: 0.5 }, METHODS)).toBeNull()
  })

  it('has horizon ranges that are the validator’s own', () => {
    const horizon = (horizonLockPercent: number, horizonLockRoll: number) => () =>
      validateStabilization({ ...SETTINGS, horizonLockPercent, horizonLockRoll })
    expect(horizon(HORIZON_LOCK_PERCENT_RANGE.min, HORIZON_LOCK_ROLL_RANGE.min)).not.toThrow()
    expect(horizon(HORIZON_LOCK_PERCENT_RANGE.max, HORIZON_LOCK_ROLL_RANGE.max)).not.toThrow()
    expect(horizon(HORIZON_LOCK_PERCENT_RANGE.max + 1, 0)).toThrow()
    expect(horizon(HORIZON_LOCK_PERCENT_RANGE.min - 1, 0)).toThrow()
    expect(horizon(0, HORIZON_LOCK_ROLL_RANGE.max + 1)).toThrow()
    expect(horizon(0, HORIZON_LOCK_ROLL_RANGE.min - 1)).toThrow()
  })
})

describe('lensProfileName', () => {
  it('reads the name of a profile file, and has none for anything else', () => {
    expect(lensProfileName('{"name":"Avata 2 4K"}')).toBe('Avata 2 4K')
    expect(lensProfileName('{}')).toBeNull()
    expect(lensProfileName('nope')).toBeNull()
    expect(lensProfileName(undefined)).toBeNull()
  })
})
