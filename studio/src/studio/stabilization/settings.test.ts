// @vitest-environment node

// The clip's stabilization field (task 6.3, slice C1): the defaults the engine's own report gives, and the validator a
// stored project goes through - including the promise the design makes, that a project holding the field saves and loads
// unchanged (the item schema is `.passthrough()`, so version 15 needs no migration).

import { describe, expect, it } from 'vite-plus/test'
import { validateProject } from '@/features/project-bundle/schemas/project-schema'
import {
  DEFAULT_SMOOTHING_METHOD,
  aspectOf,
  engineSettingsKey,
  methodParams,
  stabilizationDefaults,
  validateStabilization,
  type SmoothingMethod,
  type StabilizationSettings,
} from './settings'

/**
 * `Stabilizer.smoothingMethods()`'s `No smoothing` and `Default` entries, as the module reported them for clip 0020
 * (build of 18 Nov 2026): a default is 0.5 for smoothness and 1 or 0 for the two flags, and the limits are the
 * engine's. The other three methods are the same shape; the client passes all of them on.
 */
const METHODS: SmoothingMethod[] = [
  { name: 'No smoothing', params: [] },
  {
    name: 'Default',
    params: [
      {
        name: 'smoothness',
        description: 'Smoothness',
        default: 0.5,
        min: 0.001,
        max: 1,
        unit: '',
      },
      {
        name: 'smoothness_pitch',
        description: 'Pitch smoothness',
        default: 0.5,
        min: 0.001,
        max: 1,
        unit: '',
      },
      {
        name: 'smoothness_yaw',
        description: 'Yaw smoothness',
        default: 0.5,
        min: 0.001,
        max: 1,
        unit: '',
      },
      {
        name: 'smoothness_roll',
        description: 'Roll smoothness',
        default: 0.5,
        min: 0.001,
        max: 1,
        unit: '',
      },
      {
        name: 'per_axis',
        description: 'Per axis',
        default: false,
        min: null,
        max: null,
        unit: null,
      },
      {
        name: 'trim_range_only',
        description: 'Only within trim range',
        default: true,
        min: null,
        max: null,
        unit: null,
      },
      {
        name: 'max_smoothness',
        description: 'Max smoothness',
        default: 1,
        min: 0.1,
        max: 5,
        unit: 's',
      },
      {
        name: 'alpha_0_1s',
        description: 'Max smoothness at high velocity',
        default: 0.1,
        min: 0.01,
        max: 1,
        unit: 's',
      },
    ],
  },
]

/** The settings of a clip that is stabilized */
function validSettings(): StabilizationSettings {
  return { ...stabilizationDefaults(METHODS), enabled: true }
}

describe('the settings a clip starts with', () => {
  it('are the engine’s own Default method and the design’s four other controls', () => {
    const defaults = stabilizationDefaults(METHODS)

    expect(defaults.method).toBe(DEFAULT_SMOOTHING_METHOD)
    expect(defaults.params).toEqual({
      smoothness: 0.5,
      smoothness_pitch: 0.5,
      smoothness_yaw: 0.5,
      smoothness_roll: 0.5,
      per_axis: 0,
      trim_range_only: 1,
      max_smoothness: 1,
      alpha_0_1s: 0.1,
    })
    expect(defaults.fov).toBe(1)
    expect(defaults.adaptiveZoomSeconds).toBe(4)
    expect(defaults.horizonLockPercent).toBe(0)
    expect(defaults.horizonLockRoll).toBe(0)
    expect(defaults.enabled).toBe(false)
    expect('output' in defaults).toBe(false)
  })

  it('takes a method’s parameters from the module’s report, a flag as 1 or 0', () => {
    expect(methodParams(METHODS, 'No smoothing')).toEqual({})
    expect(methodParams(METHODS, 'Default')).toMatchObject({ per_axis: 0, trim_range_only: 1 })
  })

  it('rejects a method the engine does not list, naming it and the ones it does', () => {
    expect(() => methodParams(METHODS, 'Optimal path')).toThrowError(RangeError)
    expect(() => methodParams(METHODS, 'Optimal path')).toThrowError(
      'no smoothing method named "Optimal path"; it has "No smoothing", "Default"',
    )
  })
})

describe('validateStabilization', () => {
  it('returns a valid record as it is', () => {
    expect(validateStabilization(validSettings())).toStrictEqual(validSettings())
  })

  it('keeps the fields this version does not know, at every level', () => {
    const stored = {
      ...validSettings(),
      future: 'written by a newer version',
      params: { ...validSettings().params, future_parameter: 2 },
    }

    expect(validateStabilization(stored)).toStrictEqual(stored)
  })

  it('keeps an older project’s output size as a field nobody reads (the size lives in the session, finding S5)', () => {
    const older = { ...validSettings(), output: { width: 3840, height: 2160 } }

    expect(validateStabilization(older)).toStrictEqual(older)
  })

  /** A stored value that is the valid record with `patch` laid over it */
  function patched(patch: Record<string, unknown>): unknown {
    return { ...validSettings(), ...patch }
  }

  it.each([
    { field: 'stabilization', what: 'null', stored: null },
    { field: 'stabilization', what: 'an array', stored: [] },
    { field: 'stabilization.enabled', what: 'a string', stored: patched({ enabled: 'true' }) },
    { field: 'stabilization.method', what: 'empty', stored: patched({ method: '' }) },
    { field: 'stabilization.method', what: 'missing', stored: patched({ method: undefined }) },
    { field: 'stabilization.params', what: 'an array', stored: patched({ params: [] }) },
    { field: 'stabilization.params', what: 'null', stored: patched({ params: null }) },
    {
      field: 'stabilization.params.smoothness',
      what: 'NaN',
      stored: patched({ params: { smoothness: NaN } }),
    },
    {
      field: 'stabilization.params.smoothness',
      what: 'a string',
      stored: patched({ params: { smoothness: '0.5' } }),
    },
    { field: 'stabilization.fov', what: 'zero', stored: patched({ fov: 0 }) },
    { field: 'stabilization.fov', what: 'negative', stored: patched({ fov: -1 }) },
    { field: 'stabilization.fov', what: 'infinite', stored: patched({ fov: Infinity }) },
    {
      field: 'stabilization.horizonLockPercent',
      what: 'negative',
      stored: patched({ horizonLockPercent: -1 }),
    },
    {
      field: 'stabilization.horizonLockPercent',
      what: 'above 100',
      stored: patched({ horizonLockPercent: 101 }),
    },
    { field: 'stabilization.horizonLockRoll', what: 'below -180', stored: patched({ horizonLockRoll: -181 }) },
    { field: 'stabilization.horizonLockRoll', what: 'above 180', stored: patched({ horizonLockRoll: 181 }) },
    {
      field: 'stabilization.adaptiveZoomSeconds',
      what: 'negative',
      stored: patched({ adaptiveZoomSeconds: -0.1 }),
    },
    { field: 'stabilization.lensProfile', what: 'empty', stored: patched({ lensProfile: '' }) },
    { field: 'stabilization.lensProfile', what: 'not JSON', stored: patched({ lensProfile: 'DJI Avata 2' }) },
    { field: 'stabilization.lensProfile', what: 'a JSON array', stored: patched({ lensProfile: '[]' }) },
    { field: 'stabilization.lensProfile', what: 'an object', stored: patched({ lensProfile: {} }) },
  ])('rejects $field as $what, naming it', ({ field, stored }) => {
    expect(() => validateStabilization(stored)).toThrowError(TypeError)
    expect(() => validateStabilization(stored)).toThrowError(field)
  })
})

describe('the project’s save and load', () => {
  /** A project of the schema's version 15 with one video item, the field on it when one is given */
  function projectWith(stabilization?: StabilizationSettings): Record<string, unknown> {
    return {
      id: 'project-1',
      name: 'Drone flight',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 0,
      schemaVersion: 15,
      metadata: { width: 3840, height: 2160, fps: 60000 / 1001 },
      timeline: {
        tracks: [
          {
            id: 'track-1',
            name: 'Video',
            height: 80,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
          },
        ],
        items: [
          {
            id: 'clip-1',
            trackId: 'track-1',
            type: 'video',
            src: 'blob:clip-1',
            label: 'clip 0020',
            from: 0,
            durationInFrames: 1200,
            sourceWidth: 3840,
            sourceHeight: 2880,
            ...(stabilization === undefined ? {} : { stabilization }),
          },
        ],
      },
    }
  }

  it('keeps the field unchanged through the schema', () => {
    const saved = JSON.parse(
      JSON.stringify(projectWith(validSettings())),
    ) as Record<string, unknown>

    const loaded = validateProject(saved)

    expect(loaded.success).toBe(true)
    expect(loaded.data).toEqual(saved)
    const item = (loaded.data?.timeline?.items?.[0] ?? {}) as { stabilization?: unknown }
    expect(item.stabilization).toEqual(validSettings())
  })

  it('adds nothing to a project whose clips have no stabilization', () => {
    const saved = JSON.parse(JSON.stringify(projectWith())) as Record<string, unknown>

    const loaded = validateProject(saved)

    expect(loaded.success).toBe(true)
    expect(loaded.data).toEqual(saved)
    const item = (loaded.data?.timeline?.items?.[0] ?? {}) as Record<string, unknown>
    expect('stabilization' in item).toBe(false)
  })

  it('keeps a loaded lens profile through a save and a load, so the clip opens with it', () => {
    const settings: StabilizationSettings = {
      ...validSettings(),
      lensProfile: JSON.stringify({ name: 'the pilot’s profile', calib_dimension: { w: 3840, h: 2880 } }),
    }
    const loaded = validateProject(JSON.parse(JSON.stringify(projectWith(settings))) as Record<string, unknown>)

    expect(loaded.success).toBe(true)
    const item = (loaded.data?.timeline?.items?.[0] ?? {}) as { stabilization?: unknown }
    expect(validateStabilization(item.stabilization)).toStrictEqual(settings)
  })

  it('survives a save, a load and a save again with the field’s own shape read back', () => {
    const first = JSON.parse(JSON.stringify(projectWith(validSettings()))) as Record<string, unknown>
    const loaded = validateProject(first)
    expect(loaded.success).toBe(true)

    const again = validateProject(JSON.parse(JSON.stringify(loaded.data)) as Record<string, unknown>)
    expect(again.success).toBe(true)

    const item = (again.data?.timeline?.items?.[0] ?? {}) as { stabilization?: unknown }
    expect(validateStabilization(item.stabilization)).toStrictEqual(validSettings())
  })
})

describe('engineSettingsKey', () => {
  it('is the same for settings the engine computes alike, whatever the item’s own fields', () => {
    const settings = validSettings()

    expect(engineSettingsKey({ ...settings, enabled: !settings.enabled })).toBe(engineSettingsKey(settings))
    // The parameters in another order are the same parameters
    const reordered = Object.fromEntries(Object.entries(settings.params).reverse())
    expect(engineSettingsKey({ ...settings, params: reordered })).toBe(engineSettingsKey(settings))
  })

  it('differs for every setting the engine computes from, the lens profile included', () => {
    const settings = validSettings()
    const keys = [
      settings,
      { ...settings, method: 'Optimal path' },
      { ...settings, params: { ...settings.params, smoothness: 0.6 } },
      { ...settings, fov: 1.1 },
      { ...settings, adaptiveZoomSeconds: 2 },
      { ...settings, horizonLockPercent: 10 },
      { ...settings, horizonLockRoll: 5 },
      { ...settings, lensProfile: '{"name":"loaded"}' },
      { ...settings, outputAspect: { width: 16, height: 9 } },
      { ...settings, outputAspect: { width: 4, height: 3 } },
      { ...settings, outputAspect: { width: 9, height: 16 } },
    ].map(engineSettingsKey)

    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('aspectOf', () => {
  it('is the project frame in lowest terms, so frames of one shape are one engine', () => {
    expect(aspectOf(1920, 1080)).toEqual({ width: 16, height: 9 })
    expect(aspectOf(3840, 2160)).toEqual({ width: 16, height: 9 })
    expect(aspectOf(3840, 2880)).toEqual({ width: 4, height: 3 })
    expect(aspectOf(1080, 1920)).toEqual({ width: 9, height: 16 })
    expect(aspectOf(1080, 1080)).toEqual({ width: 1, height: 1 })
  })

  it('is undefined for a frame that is not two whole numbers above 0', () => {
    expect(aspectOf(0, 1080)).toBeUndefined()
    expect(aspectOf(1920, -1)).toBeUndefined()
    expect(aspectOf(1920.5, 1080)).toBeUndefined()
    expect(aspectOf(Number.NaN, 1080)).toBeUndefined()
  })

  it('is never stored: an old project’s stabilization validates without it and keeps no outputAspect of its own', () => {
    const stored = validateStabilization(validSettings())
    expect('outputAspect' in stored).toBe(false)
  })
})
