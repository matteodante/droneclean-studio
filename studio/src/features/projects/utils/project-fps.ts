import {
  formatRate,
  LEGACY_RATES,
  RATES,
  rateValue,
  ratesEqual,
  toRate,
  type Rate,
} from '@/studio/time'

export interface ProjectFpsOption {
  label: string
  value: number
}

export interface AutoMatchedProjectFps {
  /** The offered rate the source is closest to. */
  rate: Rate
  /** `rateValue(rate)`, the number the project file holds for that rate. */
  fps: number
  /** Whether the source is exactly this rate; false when it is being rounded to it. */
  exact: boolean
}

const ALLOWED_PROJECT_RATES: readonly Rate[] = [...RATES, ...LEGACY_RATES]

const DEFAULT_PROJECT_RATE: Rate = toRate(30)

/**
 * A stored `fps` as a rate, or `null` when it is not one. `toRate` throws for a value that
 * is not a positive finite rate or cannot be expressed in millionths; a validator and a
 * select must not throw, so such a value is simply not a rate here.
 */
function toProjectRate(fps: number): Rate | null {
  try {
    return toRate(fps)
  } catch {
    return null
  }
}

function optionFor(rate: Rate, suffix = ''): ProjectFpsOption {
  return { label: `${formatRate(rate)} fps${suffix}`, value: rateValue(rate) }
}

/**
 * The number a project's rate is stored as: `rateValue(toRate(fps))`, the same double the
 * options offer (design 1.5, 4.6). A value that is not a rate is returned unchanged, so the
 * form can show it (and the schema reject it) without throwing.
 */
export function projectFpsValue(fps: number): number {
  const rate = toProjectRate(fps)
  return rate ? rateValue(rate) : fps
}

export function isAllowedProjectFps(value: number): boolean {
  const rate = toProjectRate(value)
  return rate !== null && ALLOWED_PROJECT_RATES.some((allowed) => ratesEqual(rate, allowed))
}

/**
 * The rates a project can be set to: the eight exact rates, plus 120 and 240 only for a
 * project that already has one (legacy projects keep their rate; a new project is never
 * offered them).
 */
export function getProjectFpsOptions(currentFps?: number): ProjectFpsOption[] {
  const options = RATES.map((rate) => optionFor(rate))
  const currentRate = currentFps === undefined ? null : toProjectRate(currentFps)
  if (!currentRate) {
    return options
  }

  for (const rate of LEGACY_RATES) {
    if (ratesEqual(currentRate, rate)) {
      options.push(optionFor(rate, ' (Legacy)'))
    }
  }
  return options
}

export function formatFpsValue(fps: number): string {
  if (!Number.isFinite(fps)) {
    return '0'
  }

  if (Number.isInteger(fps)) {
    return `${fps}`
  }

  return fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * The label a stored frame rate is shown with: `formatRate(toRate(fps))`, so
 * `59.94005994005994` reads "59.94" and matches the labels of the rate options. It is used
 * for a project's rate and for a composition's. A value that is not a rate falls back to
 * `formatFpsValue`, so a card or a settings row cannot throw.
 */
export function formatProjectFps(fps: number): string {
  const rate = toProjectRate(fps)
  return rate ? formatRate(rate) : formatFpsValue(fps)
}

/**
 * The project rate a source should be matched to. The closest of the eight offered rates
 * wins; it is `exact` when the source is that rate, which is the case for a 59.94, 29.97 or
 * 23.976 probe (mediabunny reports `60000/1001` and `60/1.001` one ulp apart, and `toRate`
 * unites them).
 */
export function resolveAutoMatchProjectFps(sourceFps: number): AutoMatchedProjectFps {
  const sourceRate = toProjectRate(sourceFps)
  if (!sourceRate) {
    return {
      rate: DEFAULT_PROJECT_RATE,
      fps: rateValue(DEFAULT_PROJECT_RATE),
      exact: false,
    }
  }

  const sourceValue = rateValue(sourceRate)
  let closest: Rate = RATES[0]
  for (const candidate of RATES) {
    if (Math.abs(sourceValue - rateValue(candidate)) < Math.abs(sourceValue - rateValue(closest))) {
      closest = candidate
    }
  }

  return {
    rate: closest,
    fps: rateValue(closest),
    exact: ratesEqual(sourceRate, closest),
  }
}
