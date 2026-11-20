// The stabilization settings a clip carries (task 6.3, slice C1): the video item's one optional field, the settings a
// clip starts with, and the validator a reader of the stored project puts them through.
//
// It is settings only. The engine's data - the motion samples, the smoothing and every frame's matrices - lives in a
// worker for the session (`client.ts`); the project keeps what the pilot chose, because the matrices are the engine's
// smoothing, which an update may change (design 6.3 §4.2).
//
// Nothing here is a number the engine could report instead: the panel's form is built from `smoothingMethods()`, which
// gives every method's parameters, their defaults, their limits and their units (§4.7), and a new clip's parameters are
// those defaults. The four controls that are not smoothing parameters have the engine's own defaults, cited below.
//
// The field is optional on a video item (`VideoItem.stabilization`) and the project schema keeps it unchanged (items are
// `.passthrough()`, `project-schema.ts`), so a project that holds it saves and loads as it was written: schema version
// 15, no migration (design 6.3 §3.2). `validateStabilization` is what a reader that wants the field typed calls; the
// client calls it on every clip it opens.

/** How a flag's boolean default is stored: the engine's `setSmoothing` takes numbers only (`gyroflow/wasm/src/lib.rs`,
 * `set_smoothing` reads every value with `as_f64`), so a flag is 1 or 0 on the wire. */
const FLAG_ON = 1
const FLAG_OFF = 0

/** One smoothing parameter, as the engine describes it: `Stabilizer.smoothingMethods()` in `gyroflow/wasm/README.md` */
export interface SmoothingParameter {
  /** The parameter's key: the name `setSmoothing` takes in its `params` object */
  name: string
  /** The engine's own description of the parameter, shown beside the control */
  description: string
  /** The value a new clip starts with: a number, or a boolean for a flag */
  default: number | boolean
  /** The smallest value the engine accepts, or `null` for a flag */
  min: number | null
  /** The largest value the engine accepts, or `null` for a flag */
  max: number | null
  /** The unit of the value for the control's label, or `null` when it has none */
  unit: string | null
}

/** One smoothing method, as the engine describes it */
export interface SmoothingMethod {
  /** The method's name: the one `setSmoothing` takes */
  name: string
  /** The method's parameters, in the order the engine lists them */
  params: SmoothingParameter[]
}

/** The stabilized picture's size: `info().output` as `open` reports it (design 6.3 §4.4) */
export interface StabilizationOutputSize {
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
}

/**
 * The stabilization of one clip: what the pilot chose. The size the engine reports is not stored here: it is a function
 * of (media, settings) and lives in the session's derived-size store (design 3.6 section 2.9; finding S5). An older
 * project's `output` field is kept as an unknown field and read by nothing.
 */
export interface StabilizationSettings {
  /** The clip panel's switch: whether this clip is stabilized at all; off on a clip that was never stabilized */
  enabled: boolean
  /** The smoothing method's name, one of the names `smoothingMethods()` reports */
  method: string
  /** The method's parameters, keyed by name: a flag is 1 or 0 because the engine's setters take numbers only */
  params: Record<string, number>
  /** The output's field of view as a zoom: 1 is the frame the engine fits (design 6.3 §4.7) */
  fov: number
  /** How much of the horizon to lock, in per cent: 0 leaves it unlocked (design 6.3 §4.7) */
  horizonLockPercent: number
  /** The roll a locked horizon takes, in degrees: 0 keeps the picture's own roll (design 6.3 §4.7) */
  horizonLockRoll: number
  /** How far either way the adaptive zoom looks to fit the correction, in seconds: 0 turns it off */
  adaptiveZoomSeconds: number
  /**
   * Where the stabilized window sits in the source picture, sideways: `-1` to `1`, a fraction of the room the
   * stabilization has to move it on that side without a black border (`reframe.ts`). Absent or 0 is the framing the
   * engine fits (a project saved before this field is unchanged). It is not part of the engine's key: the engine's
   * frames are the same, the warp reads the offset when it draws (preview and export alike).
   */
  framingX?: number
  /** The same, up and down: `-1` is the top of the room, `1` the bottom. Absent or 0 is today's framing */
  framingY?: number
  /**
   * The lens profile the pilot loaded for a clip whose file carries none (or a wrong one): the text of a Gyroflow
   * profile file, as `loadLensProfile` takes it. The engine gets it with `setLensProfile` before the clip's first
   * recompute, so a saved project opens with it. Absent when the file's own profile (or the engine's default pinhole)
   * is used.
   */
  lensProfile?: string
}

/**
 * The aspect ratio of the stabilized frame, as whole numbers in lowest terms (`16:9` is 16 and 9, whatever the project's
 * pixels). The engine makes the largest frame of that aspect that fits inside the video (`setOutputSize`).
 */
export interface OutputAspect {
  width: number
  height: number
}

/**
 * What an engine is asked for: the clip's settings and the aspect of the project's frame. The aspect is not the pilot's
 * choice and is never stored in the project: it is the project's frame, read when the engine is asked (design: a
 * stabilized clip fills the project's frame, a 4:3 clip in a 4:3 project is 4:3). Without it the engine keeps the output
 * its lens profile names (a 16:9 frame for the Avata 2's 4:3 footage).
 */
export interface EngineSettings extends StabilizationSettings {
  outputAspect?: OutputAspect
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Whether two aspects are the same shape (both unknown counts) */
export function sameAspect(a: OutputAspect | undefined, b: OutputAspect | undefined): boolean {
  return a?.width === b?.width && a?.height === b?.height
}

/**
 * The aspect of a project frame in lowest terms, so that 1920x1080 and 3840x2160 are the same engine; `undefined` for a
 * frame that is not two whole numbers above 0 (nothing is asked of the engine then).
 */
export function aspectOf(width: number, height: number): OutputAspect | undefined {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return undefined
  }
  const divisor = gcd(width, height)
  return { width: width / divisor, height: height / divisor }
}

/**
 * What the engine computes from, as one string: two clips of one file whose settings have the same key get the same
 * frames, so they share one engine (`client.ts`). `enabled` is the item's, not the engine's, and is not part of it; the parameters are taken in name order.
 * The output aspect is part of it: the zoom is computed for the output frame, so a frame of another aspect is other frames.
 */
export function engineSettingsKey(settings: EngineSettings): string {
  const params = Object.keys(settings.params)
    .sort()
    .map((name) => [name, settings.params[name]])
  return JSON.stringify([
    settings.method,
    params,
    settings.fov,
    settings.adaptiveZoomSeconds,
    settings.horizonLockPercent,
    settings.horizonLockRoll,
    settings.lensProfile ?? null,
    settings.outputAspect ? [settings.outputAspect.width, settings.outputAspect.height] : null,
  ])
}

/**
 * The smoothing method the engine starts on: `Smoothing::default().current_id` is 1, and the list's second entry is
 * `Default` (`gyroflow/src/core/smoothing/mod.rs:73`) - so the list's first entry, `No smoothing`, is not the default.
 * Restoring `Default` with its own defaults and the other defaults below reproduces the reference frame bit for bit
 * (`gyroflow/wasm/test/chrome-worker.test.mjs:165-206`, design 6.3 §3.1).
 */
export const DEFAULT_SMOOTHING_METHOD = 'Default'

/** The range of the framing offsets: the validator and the panel's slider share it (`ui/changes.ts`) */
export const FRAMING_RANGE = { min: -1, max: 1 } as const

/** The engine's default output zoom: `setFov(1)` restores the reference (design 6.3 §4.7) */
const DEFAULT_FOV = 1
/** The engine's default adaptive-zoom window, in seconds (`stabilization_params.rs:163`, design 6.3 §4.7) */
const DEFAULT_ADAPTIVE_ZOOM_SECONDS = 4
/** No horizon lock by default (`setHorizonLock(0, 0)` restores the reference, design 6.3 §4.7) */
const DEFAULT_HORIZON_LOCK_PERCENT = 0
/** With no horizon lock there is no roll to take */
const DEFAULT_HORIZON_LOCK_ROLL = 0

/**
 * The parameters a method starts with, from the engine's own report: each parameter's `default`, with a flag as 1 or 0.
 * Throws when the engine does not list the method, naming it and the methods it does list, so a method that an update
 * renamed fails where it is chosen instead of in the engine.
 */
export function methodParams(
  methods: readonly SmoothingMethod[],
  method: string,
): Record<string, number> {
  const found = methods.find((candidate) => candidate.name === method)
  if (!found) {
    const known = methods.map((candidate) => JSON.stringify(candidate.name)).join(', ')
    throw new RangeError(
      `methodParams: the engine has no smoothing method named ${JSON.stringify(method)}; it has ${known}`,
    )
  }
  const params: Record<string, number> = {}
  for (const parameter of found.params) {
    params[parameter.name] =
      typeof parameter.default === 'boolean'
        ? parameter.default
          ? FLAG_ON
          : FLAG_OFF
        : parameter.default
  }
  return params
}

/**
 * The settings a clip starts with (design 6.3 §4.7): the switch off, the engine's `Default` smoothing with its own
 * parameter defaults (smoothness 0.5 and the method's others), fov 1, the adaptive zoom's 4 s window and no horizon
 * lock.
 */
export function stabilizationDefaults(
  methods: readonly SmoothingMethod[],
): StabilizationSettings {
  return {
    enabled: false,
    method: DEFAULT_SMOOTHING_METHOD,
    params: methodParams(methods, DEFAULT_SMOOTHING_METHOD),
    fov: DEFAULT_FOV,
    horizonLockPercent: DEFAULT_HORIZON_LOCK_PERCENT,
    horizonLockRoll: DEFAULT_HORIZON_LOCK_ROLL,
    adaptiveZoomSeconds: DEFAULT_ADAPTIVE_ZOOM_SECONDS,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The validator

/** A field must be an object; the error names it */
function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

/** A switch must be a boolean */
function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${path} must be a boolean`)
  }
  return value
}

/** A non-empty string */
function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`)
  }
  return value
}

/** A finite number, within `min` and `max` when they are given */
function requireNumber(value: unknown, path: string, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`)
  }
  if (min !== undefined && value < min) {
    throw new TypeError(`${path} must be at least ${min}`)
  }
  if (max !== undefined && value > max) {
    throw new TypeError(`${path} must be at most ${max}`)
  }
  return value
}

/** A finite number greater than zero: a zoom of 0 has no frame to fit */
function requirePositiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a finite number greater than 0`)
  }
  return value
}

/** The text of a Gyroflow lens profile file: a JSON object (the engine checks the rest when it loads it) */
function requireLensProfile(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be the text of a Gyroflow lens profile file`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new TypeError(`${path} must be the text of a Gyroflow lens profile file, and it is not JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${path} must be the text of a Gyroflow lens profile file: a JSON object`)
  }
  return value
}

/**
 * The validated fields over the stored object: a field this version does not know, written by a newer one, is kept, so
 * a load and a save do not lose it (the same rule the shadow removal's validator follows).
 */
function keepUnknownFields<T extends object>(stored: Record<string, unknown>, known: T): T {
  return { ...stored, ...known } as T
}

/**
 * Reads a stored stabilization field, or throws a `TypeError` naming the first field that is wrong.
 *
 * Rejects a switch that is not a boolean, an empty method name, a parameter that is not a finite number, a zoom that is
 * not positive, a horizon lock outside 0-100 per cent, a roll outside -180 to 180 degrees, a negative adaptive-zoom
 * window, a framing offset that is not a number from -1 to 1 and a lens profile that is not the text of a JSON object. Opening a clip puts its settings through this first (`client.ts`), so a stored field the engine cannot
 * take is refused by name, never replaced by a default. What the engine's limits are for a smoothing
 * parameter is the engine's to say (`smoothingMethods()`), and the panel enforces it; a project written by another
 * version is not refused for a value this version would not offer.
 *
 * Returns a copy: the declared fields validated, and the fields this version does not know kept, at every level, so a
 * field written by a newer version survives a load and a save.
 */
export function validateStabilization(value: unknown): StabilizationSettings {
  const root = requireObject(value, 'stabilization')

  const paramsValue = requireObject(root.params, 'stabilization.params')
  const params: Record<string, number> = {}
  for (const [name, parameter] of Object.entries(paramsValue)) {
    params[name] = requireNumber(parameter, `stabilization.params.${name}`)
  }

  const known: StabilizationSettings = {
    enabled: requireBoolean(root.enabled, 'stabilization.enabled'),
    method: requireString(root.method, 'stabilization.method'),
    params: keepUnknownFields(paramsValue, params),
    fov: requirePositiveNumber(root.fov, 'stabilization.fov'),
    horizonLockPercent: requireNumber(root.horizonLockPercent, 'stabilization.horizonLockPercent', 0, 100),
    horizonLockRoll: requireNumber(root.horizonLockRoll, 'stabilization.horizonLockRoll', -180, 180),
    adaptiveZoomSeconds: requireNumber(
      root.adaptiveZoomSeconds,
      'stabilization.adaptiveZoomSeconds',
      0,
    ),
  }

  if (root.framingX !== undefined) {
    known.framingX = requireNumber(root.framingX, 'stabilization.framingX', FRAMING_RANGE.min, FRAMING_RANGE.max)
  }
  if (root.framingY !== undefined) {
    known.framingY = requireNumber(root.framingY, 'stabilization.framingY', FRAMING_RANGE.min, FRAMING_RANGE.max)
  }

  if (root.lensProfile !== undefined) {
    known.lensProfile = requireLensProfile(root.lensProfile, 'stabilization.lensProfile')
  }

  return keepUnknownFields(root, known)
}
