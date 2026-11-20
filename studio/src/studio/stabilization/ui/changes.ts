// What the clip panel's controls may change on a clip's stabilization settings, and the one place that
// refuses a value outside what the engine and the stored format take (task 6.4).
//
// Nothing here is a number of its own: the smoothness range is the engine's (`smoothingMethods()`), the
// zoom and adaptive-zoom limits are the validator's (`settings.ts`: a zoom above 0, a window of 0 or more),
// and the two horizon ranges below are the validator's too - `changes.test.ts` fails if they drift apart.

import {
  FRAMING_RANGE,
  validateStabilization,
  type SmoothingMethod,
  type SmoothingParameter,
  type StabilizationSettings,
} from '../settings'

/** The horizon lock's amount in per cent: the range `validateStabilization` accepts */
export const HORIZON_LOCK_PERCENT_RANGE = { min: 0, max: 100 } as const
/** The roll a locked horizon takes, in degrees: the range `validateStabilization` accepts */
export const HORIZON_LOCK_ROLL_RANGE = { min: -180, max: 180 } as const

/** The framing sliders' range: the validator's (`settings.ts`) */
export const FRAMING_SLIDER_RANGE = FRAMING_RANGE

/** The smoothing parameter the panel's smoothness control sets */
const SMOOTHNESS_PARAMETER = 'smoothness'

/** One control's change to a clip's settings */
export type StabilizationChange =
  | { kind: 'smoothness'; value: number }
  | { kind: 'fov'; value: number }
  | { kind: 'horizonLockPercent'; value: number }
  | { kind: 'horizonLockRoll'; value: number }
  | { kind: 'adaptiveZoomSeconds'; value: number }
  | { kind: 'framingX'; value: number }
  | { kind: 'framingY'; value: number }

/** The engine's description of the smoothness parameter of the clip's smoothing method, or `null` when it has none */
export function smoothnessParameter(
  settings: StabilizationSettings,
  methods: readonly SmoothingMethod[],
): SmoothingParameter | null {
  const method = methods.find((candidate) => candidate.name === settings.method)
  return method?.params.find((parameter) => parameter.name === SMOOTHNESS_PARAMETER) ?? null
}

/**
 * The settings with the change applied, or `null` when the value is not one the clip can take: not a finite number,
 * outside the engine's smoothness range, or refused by the validator (a zoom of 0 or less, a horizon lock outside
 * 0-100 per cent, a roll outside -180 to 180 degrees, a negative adaptive-zoom window). Nothing is clamped here: a
 * value that is refused is not stored.
 */
export function applyChange(
  settings: StabilizationSettings,
  change: StabilizationChange,
  methods: readonly SmoothingMethod[],
): StabilizationSettings | null {
  if (!Number.isFinite(change.value)) return null
  let next: StabilizationSettings
  switch (change.kind) {
    case 'smoothness': {
      const parameter = smoothnessParameter(settings, methods)
      if (!parameter) return null
      if (parameter.min !== null && change.value < parameter.min) return null
      if (parameter.max !== null && change.value > parameter.max) return null
      next = { ...settings, params: { ...settings.params, [SMOOTHNESS_PARAMETER]: change.value } }
      break
    }
    case 'fov':
      next = { ...settings, fov: change.value }
      break
    case 'horizonLockPercent':
      next = { ...settings, horizonLockPercent: change.value }
      break
    case 'horizonLockRoll':
      next = { ...settings, horizonLockRoll: change.value }
      break
    case 'adaptiveZoomSeconds':
      next = { ...settings, adaptiveZoomSeconds: change.value }
      break
    case 'framingX':
      next = { ...settings, framingX: change.value }
      break
    case 'framingY':
      next = { ...settings, framingY: change.value }
      break
  }
  try {
    return validateStabilization(next)
  } catch {
    return null
  }
}

/** The name of a loaded Gyroflow lens profile file, or `null` when the text has none */
export function lensProfileName(profile: string | undefined): string | null {
  if (!profile) return null
  try {
    const parsed: unknown = JSON.parse(profile)
    if (typeof parsed === 'object' && parsed !== null && 'name' in parsed) {
      const name = (parsed as { name: unknown }).name
      if (typeof name === 'string' && name.length > 0) return name
    }
  } catch {
    // Not JSON: the validator refuses it when the clip opens; the panel just has no name to show
  }
  return null
}
