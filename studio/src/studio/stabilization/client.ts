// The stabilization client (task 6.3, slice C1): Gyroflow's engine, in workers, as the renderer (slice C2) and the clip
// panel (task 6.4) use it.
//
// One engine - a worker with one file open and one set of settings computed - per source file and settings (review
// finding S4; design 6.3 §4.2, §0.2): the engine blocks while it reads and smooths a clip, so it never runs on the page
// thread, and one `open`/`recompute` can never stall another engine's frames. Clips of one source with the same
// settings - a split clip's halves - share the engine and its memory, because the engine's answer is a function of the
// source frame and the settings alone: `getFrameData(clipId, sourceFrame)` is keyed by the integer source frame and
// turns it into that frame's own presentation time, `round(frame · 1e6 · den / num)`, from the source's exact rate
// (`@/studio/time`), never a float accumulation (design §4.3). A clip whose settings change moves to the engine for its
// new settings: the one that already has them, or the one it has to itself, recomputed (0.92-0.95 s, no file read), or
// a new one opened for it (the file read again, 3-6.5 s) when its engine serves other clips. An engine no clip uses any
// more - closed, moved away, never opened - is closed and its worker terminated (finding S7). Each clip keeps its own
// 8-behind/24-ahead window, so a split clip's halves do not empty one cache between them.
//
// A settings change is applied when the gesture ends: this client's timer waits until the changes a drag sends stop for
// its delay, so the engine recomputes once and the picture changes once (design §4.7). A frame the window does not have
// is asked for and a neighbour's is never shown in its place: the preview holds its previous output (`undefined` without
// `{ wait: true }`), an export waits (design §4.2). Every array handed out is a fresh copy - the engine's memory is
// reused, and a cached frame must not be written by a caller.
//
// The messages are the ones `gyroflow/wasm/js/gyro-messages.js` answers (`…/js/gyro-worker.d.ts`): this module mirrors
// the shapes it uses, as the stage probe does, because the wasm package is outside the editor's `src` tree, and
// `worker-contract.test.ts` holds the two together. The failures a clip panel shows are typed (`InvalidSettingsError`,
// `NoMotionDataError`, `NoLensProfileError`, `ClipUnreadableError`); anything else the engine fails with is a
// `StabilizationError` carrying the engine's own message.

import { withBase } from '@/studio/web/base-path'
import { ratesEqual, toRate, type Rate } from '@/studio/time'
import {
  engineSettingsKey,
  validateStabilization,
  sameAspect,
  type EngineSettings,
  type SmoothingMethod,
} from './settings'
import {
  createMotionCache,
  motionCacheKey,
  type MotionCache,
} from './motion-cache'
import type { StabilizationAssets, StabilizationFrame } from './stage'

/** Where the module's worker is served, beside the wasm package: the path the stage probe serves it at */
const DEFAULT_GYRO_WORKER_URL = withBase('gyroflow/wasm/js/gyro-worker.js')

/**
 * How many source frames either side of the one asked for are kept: 8 behind, so a re-render of the last frames is
 * answered from memory, and 24 ahead, so playback has the data before it gets there - 33 frames, about 5.8 MiB of
 * matrices per clip at 184,320 B a frame (design 6.3 §4.2).
 */
export const FRAMES_BEHIND = 8
export const FRAMES_AHEAD = 24

/** How long after the last settings change the one `recompute` runs, in ms (design 6.3 §4.7) */
const DEFAULT_RECOMPUTE_DELAY_MS = 250

/** What `open` and `info` report about the clip, as the worker's `GyroInfo` gives it (`gyroflow/wasm/js/gyro-worker.d.ts`) */
export interface StabilizationInfo {
  /** The clip's frame size in pixels */
  input: [number, number]
  /** The stabilized frame's size in pixels: the clip's intrinsic size for the transform stage (design 6.3 §4.4) */
  output: [number, number]
  /** The file's frame rate as the engine read it, in frames per second */
  fps: number
  /** How many frames the file has */
  frames: number
  /** How many motion samples the file carried; 0 means there is nothing to stabilize */
  orientations: number
  /** How many motion samples the smoothing produced */
  smoothed_orientations: number
  /** The lens profile the engine found for the clip, as `info().lens` labels it */
  lens: string
  /** The sensor's readout time as the engine used it, in ms */
  frame_readout_time_ms: number
  /** The smallest field of view over the clip */
  min_fov: number
  /** How many per-frame fields of view the engine computed */
  fovs: number
  /** What `open` read through the file, in bytes */
  bytes_read: number
}

/**
 * What `open` reports while it runs: the bytes it has read and the phase - never a percentage, because clip 0020 reads
 * 1.9 GB of a 3.76 GB file, so a panel shows the bytes and the phase and not a bar that stops at half
 * (`gyroflow/wasm/README.md`).
 */
export interface StabilizationProgress {
  /** What the engine has read through the file so far, in bytes */
  bytesRead: number
  /** The file's size in bytes */
  fileSize: number
  /** `reading`: the motion data is being read; `smoothing`: it is read and the engine is computing the stabilization */
  phase: 'reading' | 'smoothing'
  /** How many motion samples the file carried: known once the read is done, `null` before */
  orientations: number | null
}

/** One source frame's stabilization data, ready for `StabilizationStage.warp` */
export interface StabilizationFrameData extends StabilizationFrame {
  /** The source frame the data are for: the client checked that the engine answered the one it asked for */
  sourceFrame: number
}

/** The lens profile the engine holds for a clip: what the panel shows, and what the stage's shader is built from */
export interface StabilizationLens {
  /** The profile's name as `info().lens` gives it, read-only in the panel (design 6.3 §4.7) */
  name: string
  /** The profile's distortion model id (`opencv_fisheye`, `poly3`, ...), or `null` when it names none */
  model: string | null
}

/**
 * A file the desktop links by path (`storageType: 'path'`): the page holds no `File` for it, so the worker reads its
 * bytes from the shell's same-origin media route with `Range` (`LinkedClipFile` in `gyroflow/wasm/js/gyro-worker.d.ts`)
 */
export interface LinkedClipFile {
  /** The media route, `droneclean://app/__media/<id>` */
  url: string
  /** The file's size in bytes */
  size: number
  /** The file's name */
  name: string
  /** Its modification time, epoch ms: with the name and size, the motion cache's key */
  lastModified: number
}

/** The source the worker reads: a `File`, or a linked file it reads by URL */
export type ClipFile = File | LinkedClipFile

/** A clip as the client opens it: the item, its source file and the source's exact rate */
export interface StabilizationClip {
  /** The timeline item's id: what `getFrameData`, `setSettings` and `close` name */
  id: string
  /**
   * The media the clip's picture comes from (the media library's id): two items of one source with the same settings
   * share one worker, one engine and one open, and are served the same frame data.
   */
  mediaId: string
  /** The source file, read by the worker itself in slices */
  file: ClipFile
  /** The source's exact rate: a source frame's own presentation time is computed from it, never from seconds */
  rate: Rate
}

/** What went wrong, for code that must tell the cases apart (the clip panel switches on `error.code`) */
export type StabilizationErrorCode =
  | 'invalid-settings'
  | 'no-motion-data'
  | 'no-lens-profile'
  | 'clip-unreadable'
  | 'engine'
  | 'closed'

/** A failure of the stabilization client; the three cases a pilot is shown have their own class below */
export class StabilizationError extends Error {
  readonly code: StabilizationErrorCode

  constructor(code: StabilizationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StabilizationError'
    this.code = code
  }
}

/**
 * The clip's stored settings are not what the engine takes (`validateStabilization` names the first field that is
 * wrong), or name a smoothing method the engine does not have. Nothing is sent to an engine for them: the clip is not
 * stabilized with a default in their place.
 */
export class InvalidSettingsError extends StabilizationError {
  constructor(reason: string) {
    super('invalid-settings', `The clip's stabilization settings cannot be used: ${reason}`)
    this.name = 'InvalidSettingsError'
  }
}

/**
 * The clip's file carries no motion data (`info().orientations` is 0): there is nothing to stabilize, so the clip panel
 * keeps the switch off and says so in plain words (design 6.3 §4.7).
 */
export class NoMotionDataError extends StabilizationError {
  constructor(message = 'This clip carries no motion data, so there is nothing to stabilize.') {
    super('no-motion-data', message)
    this.name = 'NoMotionDataError'
  }
}

/**
 * The clip's file carries no lens profile. The clip can still be stabilized - the engine then corrects the lens with
 * its default pinhole, f = 0.8 × the frame's width (`gyroflow/src/core/lens_profile.rs:331-350`) - so the panel shows
 * this and offers `loadLensProfile` for a clip whose file has none (design 6.3 §4.7).
 */
export class NoLensProfileError extends StabilizationError {
  constructor(
    message = 'This clip carries no lens profile: the lens correction uses the engine’s default pinhole until one is loaded.',
  ) {
    super('no-lens-profile', message)
    this.name = 'NoLensProfileError'
  }
}

/** The clip's file could not be read or understood by the engine; the engine's own words are in the message */
export class ClipUnreadableError extends StabilizationError {
  constructor(reason: string) {
    super('clip-unreadable', `The clip could not be opened: ${reason}`)
    this.name = 'ClipUnreadableError'
  }
}

/** What the client is built with; the tests change the worker and the coalescing window */
export interface StabilizationClientOptions {
  /** Starts a worker for one source file; the default is the module's worker at `DEFAULT_GYRO_WORKER_URL` */
  createWorker?: () => Worker
  /** How long after the last settings change the one `recompute` runs, in ms (default 250) */
  recomputeDelayMs?: number
  /** Where a clip's parsed motion data is kept between opens; the default keeps it in memory and in the app's OPFS */
  motionCache?: MotionCache
}

/** The client the renderer and the clip panel hold, one per page: one worker per source file and settings */
export interface StabilizationClient {
  /**
   * Opens a clip on the engine for its file and settings. The settings are validated first (`InvalidSettingsError`,
   * before any worker starts). A clip of a file already open with the same settings joins that engine without reading
   * the file again; otherwise a worker opens the file (3-6.5 s and 1.9 GB read for clip 0020), gets the settings - the
   * loaded lens profile first - and recomputes once. Progress reports the bytes read and the phase. Resolves with what
   * the engine found - its `output` is what the clip's `stabilization.output` records - or rejects with
   * `ClipUnreadableError` or `NoMotionDataError` (either closes the engine: neither can be stabilized), with a
   * `StabilizationError` when the engine fails or refuses a setting, or with a `closed` one when the clip was closed
   * meanwhile. A clip already open moves to the engine for the settings given.
   */
  open(
    clip: StabilizationClip,
    settings: EngineSettings,
    onProgress?: (progress: StabilizationProgress) => void,
  ): Promise<StabilizationInfo>
  /**
   * Whether the clip's file is open and its engine can answer frames. Until then the clip is the file's own picture at
   * the file's size, and says so (design 6.3 §4.2).
   */
  isOpen(clipId: string): boolean
  /**
   * The lens profile the engine holds for the clip, or `NoLensProfileError` when the file carried none - the clip is
   * stabilized either way. The name is what the panel shows, the model which lens functions the shader needs.
   */
  lensProfile(clipId: string): Promise<StabilizationLens>
  /**
   * Loads a lens profile (the text of a Gyroflow profile file) for a clip, now, as a settings change: the clip's
   * settings with `lensProfile` set to it. Resolves with the profile the engine then holds. The caller stores the same
   * `lensProfile` in the item's settings, so a saved project opens with it. The clip moves to an engine opened with the
   * profile, because a profile the engine refuses is left half-loaded in it (`lens_profile.rs`, `load_from_data`), and
   * an engine other clips use, or this clip's frames, must not depend on a file the pilot picked.
   */
  loadLensProfile(clipId: string, json: string): Promise<StabilizationLens>
  /**
   * The warp shader's assets for `createStabilizationStage` (slice C2): Gyroflow's kernel template, the profile's lens
   * functions, the identity digital lens and the coefficient table. Read once per lens model and kept: two clips whose
   * profiles name the same model get the same object, so the seat builds one stage for them.
   */
  stageAssets(clipId: string): Promise<StabilizationAssets>
  /**
   * The smoothing methods and their limits, as the engine describes them: the clip panel's form and a new clip's
   * defaults are built from this, never from numbers written in the editor. Answered by an open clip's worker, or by a
   * worker of its own when no clip is open.
   */
  smoothingMethods(): Promise<SmoothingMethod[]>
  /**
   * One source frame's data, from the window of `FRAMES_BEHIND` frames behind and `FRAMES_AHEAD` ahead, which every
   * call slides and fills. A frame the engine has not answered yet is requested; without `{ wait: true }` the call
   * returns `undefined` then (the preview holds its previous output), and with it the call waits for the answer (the
   * export).
   */
  getFrameData(
    clipId: string,
    sourceFrame: number,
    options?: { wait?: boolean },
  ): Promise<StabilizationFrameData | undefined>
  /**
   * Gives the clip new settings, when the gesture ends (the client's timer waits until a drag's changes stop): the clip
   * moves to the engine that has them, or recomputes the engine it has to itself, or gets an engine opened for them
   * when its own serves other clips; an engine left with no clip is closed. Resolves when the clip's frames are the
   * new settings'; until then they are the old ones'. Rejects with `InvalidSettingsError` for settings the validator or
   * the engine's list of methods refuses (nothing is sent), and with the engine's message when an engine fails; the
   * clip then keeps the engine and the frames it had. `enabled` and `output` are the item's, not the engine's.
   */
  setSettings(clipId: string, settings: EngineSettings): Promise<void>
  /**
   * What the clip's engine reports now: after `setSettings` resolves, its `output` is the size of the clip's frames for
   * the new settings (the output aspect moves it). `null` for a clip that is not open.
   */
  infoOf(clipId: string): StabilizationInfo | null
  /** Closes a clip, open or still opening; an engine no other clip uses goes with it, worker and memory */
  close(clipId: string): Promise<void>
  /** Terminates every worker: the page is going away (the tests use it too) */
  destroy(): void
}

// ---------------------------------------------------------------------------------------------------------------------
// The worker, as the messages go back and forth

/** A message the worker posts: a reply to a request's `id`, or a progress report (which carries a `type`) */
type WorkerMessage =
  | { type: 'progress'; id: number; progress: StabilizationProgress }
  | { id: number; result: unknown }
  | { id: number; error: string }

/**
 * Every request this client sends (`gyroflow/wasm/js/gyro-messages.js`, the worker's switch): `worker-contract.test.ts`
 * sends each of them to the real switch, so a request the worker does not answer fails a test, not a clip.
 */
export const GYRO_REQUEST_TYPES = [
  'open',
  'info',
  'lensProfile',
  'shaderAssets',
  'setSmoothing',
  'setFov',
  'setAdaptiveZoom',
  'setHorizonLock',
  'setLensProfile',
  'setOutputSize',
  'recompute',
  'frameData',
  'smoothingMethods',
] as const

/** The requests this client sends */
type WorkerRequestType = (typeof GYRO_REQUEST_TYPES)[number]

/** One frame as the worker replies it (`FrameData` in `gyroflow/wasm/js/gyro-worker.d.ts`) */
interface RawFrameData {
  frame: number
  fov: number
  minimalFov: number
  matrixStride: number
  matrices: Float32Array
  params: Uint8Array
  mesh: Float32Array
  ms: number
}

/** The `shaderAssets` reply: the stage's assets and the lens model the engine used */
interface ShaderAssetsReply extends StabilizationAssets {
  lensModel: string
}

/** One request in flight: how to settle it, and where its progress reports go */
interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  progress?: (progress: StabilizationProgress) => void
}

/** One request to put an engine's settings in place, as the settings differ from what it holds */
interface Setter {
  type: WorkerRequestType
  fields: Record<string, unknown>
}

/** One worker and the requests in flight, with the messages `gyroflow/wasm/js/gyro-worker.js` speaks */
class GyroEngine {
  private readonly worker: Worker
  private nextId = 1
  private readonly pending = new Map<number, PendingCall>()
  private closed = false

  constructor(worker: Worker) {
    this.worker = worker
    worker.onmessage = (event: MessageEvent) => {
      this.receive(event.data as WorkerMessage)
    }
    worker.onerror = (event: ErrorEvent) => {
      this.failAll(new StabilizationError('engine', workerFailureMessage(event)))
    }
    worker.onmessageerror = () => {
      this.failAll(
        new StabilizationError('engine', 'the stabilization worker sent a message that cannot be read'),
      )
    }
  }

  call<T>(
    type: WorkerRequestType,
    fields: Record<string, unknown> = {},
    progress?: (progress: StabilizationProgress) => void,
    transfer: Transferable[] = [],
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new StabilizationError('closed', 'The stabilization worker is closed.'))
    }
    const id = this.nextId
    this.nextId += 1
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, progress })
      this.worker.postMessage({ id, type, ...fields }, transfer)
    })
  }

  /**
   * Terminates the worker and rejects what is in flight with a `closed` error: the engine's memory goes with the
   * worker, so a closed file costs nothing afterwards.
   */
  close(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.onmessageerror = null
    this.worker.terminate()
    this.failAll(new StabilizationError('closed', reason))
  }

  private receive(message: WorkerMessage): void {
    if ('type' in message) {
      this.pending.get(message.id)?.progress?.(message.progress)
      return
    }
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    if ('error' in message) entry.reject(new StabilizationError('engine', message.error))
    else entry.resolve(message.result)
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error)
    this.pending.clear()
  }
}

/** A worker's failure (a script that could not be loaded, a crash) as a message for the error */
function workerFailureMessage(event: ErrorEvent): string {
  return event.message
    ? `the stabilization worker failed: ${event.message}`
    : 'the stabilization worker failed'
}

// ---------------------------------------------------------------------------------------------------------------------
// The source frame's time

/**
 * A source frame's presentation time in µs, exactly: `round(frame · 1e6 · den / num)` from the source's rate. The
 * module's own reference holds it: at 59.94 frames 0, 1, 2 and 1000 are 0, 16,683, 33,367 and 16,683,333 µs
 * (`gyroflow/wasm/test/reference/clip-0020.json`), and the engine answers each of those frames for them. One integer
 * computation from the frame index, never accumulated seconds, so nothing drifts (design 6.3 §4.3).
 *
 * @throws RangeError when the rate is not a rate of positive integers, or the frame is not an integer >= 0.
 */
export function sourceFrameToMicroseconds(rate: Rate, frame: number): number {
  const exact = toRate(rate)
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError(`sourceFrameToMicroseconds: frame must be an integer >= 0, got ${frame}`)
  }
  return Math.round((frame * 1_000_000 * exact.den) / exact.num)
}

// ---------------------------------------------------------------------------------------------------------------------
// The client

/** The frames one clip has from its engine; replaced, never cleared, so a reply for a replaced one is dropped */
interface FrameCache {
  readonly window: Map<number, StabilizationFrameData>
  readonly inFlight: Set<number>
  readonly batches: Set<Promise<void>>
}

function newCache(): FrameCache {
  return { window: new Map(), inFlight: new Set(), batches: new Set() }
}

/** One engine: a worker with one file open and one set of settings computed */
interface EngineState {
  /**
   * What the client finds the engine by: the file and the settings it holds (`engineKey`). Empty once the engine can no
   * longer say what it holds (a recompute that failed half-way): it then serves the clip it has and nothing else.
   */
  key: string
  readonly mediaId: string
  readonly rate: Rate
  /** The file, kept to open another engine of it when a clip of a shared engine changes its settings */
  readonly file: ClipFile
  readonly engine: GyroEngine
  /** The clips this engine serves, and the ones on their way to it (an open, a move): it closes when none is left */
  readonly users: Set<string>
  readonly progress: Set<(progress: StabilizationProgress) => void>
  /** Resolves once the engine holds `settings` and has computed with them */
  ready: Promise<StabilizationInfo>
  info: StabilizationInfo | null
  profile: Promise<Record<string, unknown>> | null
  /** The settings the engine holds and has computed with */
  settings: EngineSettings
  /** The last failure of a frame request, reported by the next call; cleared by a reply that arrives */
  failure: Error | null
  closed: boolean
}

/** The settings change a gesture waits to apply */
interface Gesture {
  settings: EngineSettings
  key: string
  timer: ReturnType<typeof setTimeout>
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

/** One open clip: the engine it is served by, its own window, and its settings changes */
interface ClipState {
  readonly id: string
  engine: EngineState
  cache: FrameCache
  /** The engine the clip is moving to, while that engine opens: closing the clip lets it go */
  moving: EngineState | null
  /** The settings of the last change handed over to be applied, and their key: asking for them again does nothing */
  target: EngineSettings
  targetKey: string
  /** The last change's application, as its caller sees it, and the chain the next one waits on */
  applied: Promise<void>
  applying: Promise<void>
  gesture: Gesture | null
}

/** The key an engine is found by: the file and the settings the engine computes from */
function engineKey(mediaId: string, settings: EngineSettings): string {
  return `${JSON.stringify(mediaId)}:${engineSettingsKey(settings)}`
}

/** The settings, validated: a typed error naming the first field that is wrong, never a default in its place */
function validSettings(settings: EngineSettings): EngineSettings {
  try {
    const valid: EngineSettings = validateStabilization(settings)
    // The project's frame is not a stored field: the validator keeps it as an unknown one, so it is checked here
    const aspect = settings.outputAspect
    if (aspect === undefined) {
      delete valid.outputAspect
      return valid
    }
    const { width, height } = aspect
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new TypeError('stabilization.outputAspect must be a width and a height of whole numbers above 0')
    }
    return { ...valid, outputAspect: { width, height } }
  } catch (error) {
    throw new InvalidSettingsError(error instanceof Error ? error.message : String(error))
  }
}

/** Whether two parameter objects hold the same values, key for key */
function sameParams(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

/** The setter for the output aspect when the settings ask for one the engine does not hold; none otherwise */
function outputSetter(current: EngineSettings, settings: EngineSettings): Setter[] {
  // An engine that holds an aspect and is asked for none keeps it: the engine has no way back to its profile's frame,
  // and the project's frame is only ever unknown before the project loads
  const aspect = settings.outputAspect
  if (aspect === undefined || sameAspect(current.outputAspect, aspect)) return []
  return [{ type: 'setOutputSize', fields: { width: aspect.width, height: aspect.height } }]
}

/** The setters that turn what the engine holds into the settings asked for; none when it already holds them */
function settingsSetters(current: EngineSettings, settings: EngineSettings): Setter[] {
  const setters: Setter[] = []
  if (current.method !== settings.method || !sameParams(current.params, settings.params)) {
    setters.push({
      type: 'setSmoothing',
      fields: { method: settings.method, params: settings.params },
    })
  }
  if (current.fov !== settings.fov) {
    setters.push({ type: 'setFov', fields: { fov: settings.fov } })
  }
  if (current.adaptiveZoomSeconds !== settings.adaptiveZoomSeconds) {
    setters.push({ type: 'setAdaptiveZoom', fields: { windowSeconds: settings.adaptiveZoomSeconds } })
  }
  if (
    current.horizonLockPercent !== settings.horizonLockPercent ||
    current.horizonLockRoll !== settings.horizonLockRoll
  ) {
    setters.push({
      type: 'setHorizonLock',
      fields: { lockPercent: settings.horizonLockPercent, rollDegrees: settings.horizonLockRoll },
    })
  }
  return [...setters, ...outputSetter(current, settings)]
}

/** Every setting, for an engine that has just opened the file */
function allSetters(settings: EngineSettings): Setter[] {
  const setters: Setter[] = [
    { type: 'setSmoothing', fields: { method: settings.method, params: settings.params } },
    { type: 'setFov', fields: { fov: settings.fov } },
    { type: 'setAdaptiveZoom', fields: { windowSeconds: settings.adaptiveZoomSeconds } },
    {
      type: 'setHorizonLock',
      fields: { lockPercent: settings.horizonLockPercent, rollDegrees: settings.horizonLockRoll },
    },
  ]
  if (settings.outputAspect !== undefined) {
    setters.push({
      type: 'setOutputSize',
      fields: { width: settings.outputAspect.width, height: settings.outputAspect.height },
    })
  }
  return setters
}

/**
 * Whether an engine that only this clip uses can be recomputed for the new settings instead of a new one being opened:
 * not when the lens profile changes, because a profile the engine refuses is left half-loaded in it
 * (`gyroflow/src/core/lens_profile.rs`, `load_from_data` assigns the profile before it checks it), and the file's own
 * profile cannot be put back once another was loaded.
 */
function canRecompute(current: EngineSettings, settings: EngineSettings): boolean {
  return current.lensProfile === settings.lensProfile
}

/** The clip's two ids must be there: an empty one names neither a timeline item nor a file */
function requireClipIds(clip: StabilizationClip): void {
  if (typeof clip.id !== 'string' || clip.id.length === 0) {
    throw new TypeError('open: clip.id must be a non-empty string')
  }
  if (typeof clip.mediaId !== 'string' || clip.mediaId.length === 0) {
    throw new TypeError('open: clip.mediaId must be a non-empty string')
  }
}

/** A source frame the clip has: a whole number from 0 to the file's last frame */
function requireSourceFrame(info: StabilizationInfo, sourceFrame: number): void {
  if (!Number.isSafeInteger(sourceFrame) || sourceFrame < 0) {
    throw new RangeError(`getFrameData: sourceFrame must be an integer >= 0, got ${sourceFrame}`)
  }
  if (sourceFrame >= info.frames) {
    throw new RangeError(
      `getFrameData: source frame ${sourceFrame} is past the ${info.frames} frames of the clip`,
    )
  }
}

/** A frame the caller may keep: the cache's arrays are never handed out, because a caller may write to its copy */
function copyFrame(frame: StabilizationFrameData): StabilizationFrameData {
  return {
    matrices: frame.matrices.slice(),
    params: new Uint8Array(frame.params),
    mesh: frame.mesh.slice(),
    sourceFrame: frame.sourceFrame,
  }
}

/** A promise's reason as a `StabilizationError`, keeping the typed ones as they are */
function asStabilizationError(error: unknown): StabilizationError {
  if (error instanceof StabilizationError) return error
  return new StabilizationError('engine', error instanceof Error ? error.message : String(error))
}

/** The error a call gets for a clip that was closed under it */
function closedError(): StabilizationError {
  return new StabilizationError('closed', 'The clip was closed.')
}

/**
 * Creates the client: an engine per source file and settings, opened when a clip's stabilization is switched on and
 * closed when no clip uses it any more.
 */
export function createStabilizationClient(
  options: StabilizationClientOptions = {},
): StabilizationClient {
  return new Client(
    options.createWorker ?? (() => new Worker(DEFAULT_GYRO_WORKER_URL, { type: 'module' })),
    options.recomputeDelayMs ?? DEFAULT_RECOMPUTE_DELAY_MS,
    options.motionCache ?? createMotionCache(),
  )
}

class Client implements StabilizationClient {
  private readonly createWorker: () => Worker
  private readonly recomputeDelayMs: number
  /** The engines a clip can be put on, by their key */
  private readonly engines = new Map<string, EngineState>()
  /** The open clips */
  private readonly clips = new Map<string, ClipState>()
  /** The clips whose open is under way, with the engine each opens on */
  private readonly opening = new Map<
    string,
    { engine: EngineState; promise: Promise<StabilizationInfo> }
  >()
  /** The engine's methods and limits: the same for every clip, so they are read once */
  private methods: Promise<SmoothingMethod[]> | null = null
  /** The stage's assets per lens model and digital lens: the same for every clip whose profile names them */
  private readonly assets = new Map<string, Promise<StabilizationAssets>>()

  /** The files whose first open is reading them: a second engine of the same file waits for the motion data it records */
  private readonly parsing = new Map<string, Promise<unknown>>()
  private readonly motionCache: MotionCache

  constructor(createWorker: () => Worker, recomputeDelayMs: number, motionCache: MotionCache) {
    this.motionCache = motionCache
    this.createWorker = createWorker
    this.recomputeDelayMs = recomputeDelayMs
  }

  async open(
    clip: StabilizationClip,
    settings: EngineSettings,
    onProgress?: (progress: StabilizationProgress) => void,
  ): Promise<StabilizationInfo> {
    requireClipIds(clip)
    const valid = validSettings(settings)
    const rate = toRate(clip.rate)
    const pending = this.opening.get(clip.id)
    if (pending) {
      this.requireSameMedia(clip, pending.engine)
      await pending.promise.catch(() => {})
    }
    const known = this.clips.get(clip.id)
    if (known) {
      this.requireSameMedia(clip, known.engine)
      await this.applyNow(known, valid)
      return this.requireInfo(known.engine)
    }
    this.requireRate(clip.mediaId, rate)
    const key = engineKey(clip.mediaId, valid)
    const engine = this.engines.get(key) ?? this.startEngine(clip.mediaId, rate, clip.file, valid, key)
    engine.users.add(clip.id)
    const promise = this.join(engine, clip.id, onProgress)
    this.opening.set(clip.id, { engine, promise })
    try {
      return await promise
    } finally {
      if (this.opening.get(clip.id)?.promise === promise) this.opening.delete(clip.id)
    }
  }

  isOpen(clipId: string): boolean {
    return this.clips.has(clipId)
  }

  async lensProfile(clipId: string): Promise<StabilizationLens> {
    return this.lensOf(this.requireClip(clipId).engine)
  }

  async loadLensProfile(clipId: string, json: string): Promise<StabilizationLens> {
    const clip = this.requireClip(clipId)
    if (typeof json !== 'string' || json.length === 0) {
      throw new TypeError('loadLensProfile: json must be the text of a Gyroflow profile file')
    }
    // The gesture's settings, if one waits, are this change's, profile aside: it ends with it
    await this.applyNow(
      clip,
      validSettings({ ...(clip.gesture?.settings ?? clip.target), lensProfile: json }),
    )
    return this.lensOf(clip.engine)
  }

  async stageAssets(clipId: string): Promise<StabilizationAssets> {
    const { engine } = this.requireClip(clipId)
    const profile = await this.profileOf(engine)
    const model = typeof profile.distortion_model === 'string' ? profile.distortion_model : null
    const digitalLens = typeof profile.digital_lens === 'string' ? profile.digital_lens : null
    const key = JSON.stringify([model, digitalLens])
    const known = this.assets.get(key)
    if (known) return known
    const read = this.loadAssets(engine, model, digitalLens)
    read.catch(() => {
      if (this.assets.get(key) === read) this.assets.delete(key)
    })
    this.assets.set(key, read)
    return read
  }

  async smoothingMethods(): Promise<SmoothingMethod[]> {
    if (this.methods) return this.methods
    const first = this.engines.values().next()
    if (!first.done) return this.loadMethods(first.value.engine)
    const engine = new GyroEngine(this.createWorker())
    try {
      return await this.loadMethods(engine)
    } finally {
      engine.close('the smoothing methods were read')
    }
  }

  async getFrameData(
    clipId: string,
    sourceFrame: number,
    options: { wait?: boolean } = {},
  ): Promise<StabilizationFrameData | undefined> {
    const clip = this.requireClip(clipId)
    requireSourceFrame(this.requireInfo(clip.engine), sourceFrame)
    const pending = this.fillWindow(clip, sourceFrame)
    const cached = clip.cache.window.get(sourceFrame)
    if (cached) {
      // The window's other frames are on their way for the next calls; a failure is reported by `engine.failure`
      void pending.catch(() => {})
      return copyFrame(cached)
    }
    if (options.wait !== true) {
      void pending.catch(() => {})
      return undefined
    }
    await pending
    return this.answeredFrame(clip, sourceFrame)
  }

  /** The frame a waiting caller gets: the engine's answer, or the reason there is none */
  private async answeredFrame(clip: ClipState, sourceFrame: number): Promise<StabilizationFrameData> {
    if (clip.engine.failure) throw clip.engine.failure
    if (!clip.cache.window.has(sourceFrame)) {
      // A recompute or a move landed while the frame was in flight and dropped it with the old settings: ask again
      await this.fillWindow(clip, sourceFrame)
    }
    if (clip.engine.failure) throw clip.engine.failure
    const answered = clip.cache.window.get(sourceFrame)
    if (!answered) {
      throw new StabilizationError('engine', `the engine did not answer source frame ${sourceFrame}`)
    }
    return copyFrame(answered)
  }

  async setSettings(clipId: string, settings: EngineSettings): Promise<void> {
    const clip = this.requireClip(clipId)
    const valid = validSettings(settings)
    const key = engineKey(clip.engine.mediaId, valid)
    const gesture = clip.gesture
    if (gesture) {
      if (gesture.key !== key) {
        gesture.settings = valid
        gesture.key = key
        this.restartGesture(clip, gesture)
      }
      return gesture.promise
    }
    if (key === clip.targetKey) return clip.applied
    return this.startGesture(clip, valid, key)
  }

  infoOf(clipId: string): StabilizationInfo | null {
    return this.clips.get(clipId)?.engine.info ?? null
  }

  async close(clipId: string): Promise<void> {
    const pending = this.opening.get(clipId)
    if (pending) {
      this.opening.delete(clipId)
      pending.engine.users.delete(clipId)
      this.release(pending.engine)
    }
    const clip = this.clips.get(clipId)
    if (clip) this.forgetClip(clip, 'the clip was closed')
  }

  destroy(): void {
    const engines = new Set([
      ...this.engines.values(),
      ...[...this.clips.values()].map((clip) => clip.engine),
      ...[...this.opening.values()].map((pending) => pending.engine),
    ])
    for (const engine of engines) this.discard(engine, 'the stabilization client was destroyed')
    this.engines.clear()
    this.clips.clear()
    this.opening.clear()
    this.methods = null
    this.assets.clear()
  }

  // -- the engines ----------------------------------------------------------------------------------------------------

  /** A clip already open, or opening, stays on its file */
  private requireSameMedia(clip: StabilizationClip, engine: EngineState): void {
    if (engine.mediaId !== clip.mediaId) {
      throw new RangeError(
        `open: the clip ${JSON.stringify(clip.id)} is already open on media ${JSON.stringify(engine.mediaId)}`,
      )
    }
  }

  /** Every engine of a file must read it at one rate: the source frames' times are computed from it */
  private requireRate(mediaId: string, rate: Rate): void {
    const engines = [...this.engines.values(), ...[...this.clips.values()].map((clip) => clip.engine)]
    for (const engine of engines) {
      if (engine.mediaId === mediaId && !ratesEqual(engine.rate, rate)) {
        throw new RangeError(
          `open: media ${JSON.stringify(mediaId)} is open at ${engine.rate.num}/${engine.rate.den} fps, not ${rate.num}/${rate.den}`,
        )
      }
    }
  }

  /** Waits for the engine and registers the clip on it, once it has answered and if the clip is still wanted there */
  private async join(
    engine: EngineState,
    clipId: string,
    onProgress?: (progress: StabilizationProgress) => void,
  ): Promise<StabilizationInfo> {
    let info: StabilizationInfo
    try {
      info = onProgress ? await this.readyWith(engine, onProgress) : await engine.ready
    } catch (error) {
      engine.users.delete(clipId)
      this.release(engine)
      throw error
    }
    if (engine.closed || !engine.users.has(clipId)) {
      throw new StabilizationError('closed', 'The clip was closed while it opened.')
    }
    this.clips.set(clipId, {
      id: clipId,
      engine,
      cache: newCache(),
      moving: null,
      target: engine.settings,
      targetKey: engine.key,
      applied: Promise.resolve(),
      applying: Promise.resolve(),
      gesture: null,
    })
    return info
  }

  /** Starts a worker for a file and settings; the engine is findable by its key before its open has answered */
  private startEngine(
    mediaId: string,
    rate: Rate,
    file: ClipFile,
    settings: EngineSettings,
    key: string,
  ): EngineState {
    const state: EngineState = {
      key,
      mediaId,
      rate,
      file,
      engine: new GyroEngine(this.createWorker()),
      users: new Set(),
      progress: new Set(),
      ready: Promise.resolve(null as unknown as StabilizationInfo),
      info: null,
      profile: null,
      settings,
      failure: null,
      closed: false,
    }
    this.engines.set(key, state)
    state.ready = this.openEngine(state)
    // A caller that never awaits must not leave an unhandled rejection behind: the callers attach to `ready`
    state.ready.catch(() => {})
    return state
  }

  /**
   * The engine's `open`, its file's own lens profile, the loaded one when the settings carry it, every setter and one
   * recompute; the two answers that mean a clip cannot be stabilized close the engine, as does a refused setting.
   */
  private async openEngine(state: EngineState): Promise<StabilizationInfo> {
    let info: StabilizationInfo
    try {
      info = (await this.openWithMotionCache(state)).info
    } catch (error) {
      this.discard(state, 'the clip could not be opened')
      if (error instanceof StabilizationError && error.code === 'closed') throw error
      throw new ClipUnreadableError(error instanceof Error ? error.message : String(error))
    }
    if (info.orientations === 0) {
      this.discard(state, 'the clip carries no motion data')
      throw new NoMotionDataError()
    }
    state.info = info
    try {
      // Read now, so the panel and the stage have it without a second wait
      await this.profileOf(state)
      const { lensProfile } = state.settings
      if (lensProfile !== undefined) {
        await state.engine.call<null>('setLensProfile', { json: lensProfile })
        state.profile = null
        await this.profileOf(state)
      }
      await Promise.all(
        allSetters(state.settings).map((setter) => state.engine.call<null>(setter.type, setter.fields)),
      )
      await state.engine.call<{ ms: number }>('recompute')
      info = await this.refreshOutput(state, info)
    } catch (error) {
      this.discard(state, 'the engine refused the clip’s settings')
      throw asStabilizationError(error)
    }
    return info
  }

  /**
   * The engine's frame size after a recompute: `setOutputSize` changes it, and `info.output` is what the stage and the
   * layout size the staged picture by. Only `output` is read again; the rest of the open's report stays as it was.
   */
  private async refreshOutput(state: EngineState, info: StabilizationInfo): Promise<StabilizationInfo> {
    if (state.settings.outputAspect === undefined) return info
    const { output } = await state.engine.call<{ output: [number, number] }>('info')
    const next: StabilizationInfo = { ...info, output }
    state.info = next
    return next
  }

  /**
   * The worker's `open` of the engine's file, from the motion data cached for it when there is some. One parse per file
   * per session: engines of the same file open one after the other as far as the motion data goes, so the second finds
   * what the first recorded. `turn` is registered before anything is awaited, and is released when this engine's motion
   * data is in the cache (or it has failed, or it did not need to record any).
   */
  private async openWithMotionCache(
    state: EngineState,
  ): Promise<{ info: StabilizationInfo; ms: number; motionTrace?: ArrayBuffer }> {
    const fileKey = motionCacheKey(state.file)
    const before = this.parsing.get(fileKey)
    let release: () => void = () => {}
    const turn = new Promise<void>((resolve) => {
      release = resolve
    })
    this.parsing.set(fileKey, turn)
    void turn.then(() => {
      if (this.parsing.get(fileKey) === turn) this.parsing.delete(fileKey)
    })
    try {
      await before
      const trace = await this.motionCache.get(state.file)
      const open = state.engine.call<{ info: StabilizationInfo; ms: number; motionTrace?: ArrayBuffer }>(
        'open',
        { file: state.file, progress: true, ...(trace ? { motionTrace: trace } : {}) },
        (progress) => this.reportProgress(state, progress),
        trace ? [trace] : [],
      )
      const reply = await open
      if (!trace && reply.motionTrace) await this.motionCache.put(state.file, reply.motionTrace)
      return reply
    } finally {
      release()
    }
  }

  /** A progress report goes to every clip that is waiting for this open; a listener's own failure is not the clip's */
  private reportProgress(engine: EngineState, progress: StabilizationProgress): void {
    for (const listener of engine.progress) {
      try {
        listener(progress)
      } catch {
        // `gyroflow/wasm`'s own rule: a host callback that throws does not fail the open (lib.rs, `Progress::send`)
      }
    }
  }

  /** Waits for an engine with a progress listener attached for its duration */
  private async readyWith(
    engine: EngineState,
    onProgress: (progress: StabilizationProgress) => void,
  ): Promise<StabilizationInfo> {
    engine.progress.add(onProgress)
    try {
      return await engine.ready
    } finally {
      engine.progress.delete(onProgress)
    }
  }

  /** The engine's lens profile, read once and kept until another one is loaded */
  private profileOf(engine: EngineState): Promise<Record<string, unknown>> {
    const known = engine.profile
    if (known) return known
    const read = engine.engine.call<Record<string, unknown>>('lensProfile')
    read.catch(() => {
      if (engine.profile === read) engine.profile = null
    })
    engine.profile = read
    return read
  }

  /** The clip's lens profile, or the typed error that says the file carried none */
  private async lensOf(engine: EngineState): Promise<StabilizationLens> {
    const profile = await this.profileOf(engine)
    const calibration = profile.calib_dimension as { w?: unknown; h?: unknown } | undefined
    if (!(Number(calibration?.w) > 0) || !(Number(calibration?.h) > 0)) {
      throw new NoLensProfileError()
    }
    const model = profile.distortion_model
    return {
      name: this.requireInfo(engine).lens,
      model: typeof model === 'string' ? model : null,
    }
  }

  /** `shaderAssets` for a lens model: Gyroflow's shader, with that model's functions */
  private async loadAssets(
    engine: EngineState,
    model: string | null,
    digitalLens: string | null,
  ): Promise<StabilizationAssets> {
    const assets = await engine.engine.call<ShaderAssetsReply>('shaderAssets', { model, digitalLens })
    return {
      kernelWgsl: assets.kernelWgsl,
      lensWgsl: assets.lensWgsl,
      digitalLensWgsl: assets.digitalLensWgsl,
      coeffs: assets.coeffs,
      interpolation: assets.interpolation,
    }
  }

  private loadMethods(engine: GyroEngine): Promise<SmoothingMethod[]> {
    const read = engine.call<SmoothingMethod[]>('smoothingMethods')
    read.catch(() => {
      if (this.methods === read) this.methods = null
    })
    this.methods = read
    return read
  }

  /** Closes an engine nobody uses or waits for */
  private release(engine: EngineState): void {
    if (engine.users.size === 0) this.discard(engine, 'no clip uses it any more')
  }

  /** Terminates an engine's worker and its memory; a clip it still served is closed with it */
  private discard(engine: EngineState, reason: string): void {
    if (engine.closed) return
    engine.closed = true
    if (this.engines.get(engine.key) === engine) this.engines.delete(engine.key)
    engine.engine.close(reason)
    for (const clip of [...this.clips.values()]) {
      if (clip.engine === engine) this.forgetClip(clip, reason)
    }
  }

  // -- the settings ---------------------------------------------------------------------------------------------------

  /** One settings change when the gesture ends: every change until the changes stop for the delay shares it */
  private startGesture(clip: ClipState, settings: EngineSettings, key: string): Promise<void> {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((settle, fail) => {
      resolve = settle
      reject = fail
    })
    // A caller that does not wait for the gesture must not leave an unhandled rejection; one that waits gets it
    promise.catch(() => {})
    const gesture: Gesture = {
      settings,
      key,
      timer: setTimeout(() => this.endGesture(clip, gesture), this.recomputeDelayMs),
      promise,
      resolve,
      reject,
    }
    clip.gesture = gesture
    return promise
  }

  private restartGesture(clip: ClipState, gesture: Gesture): void {
    clearTimeout(gesture.timer)
    gesture.timer = setTimeout(() => this.endGesture(clip, gesture), this.recomputeDelayMs)
  }

  private endGesture(clip: ClipState, gesture: Gesture): void {
    if (clip.gesture !== gesture) return
    clip.gesture = null
    this.applySettings(clip, gesture.settings).then(gesture.resolve, gesture.reject)
  }

  /** Applies a settings change now: a gesture waiting to apply other settings ends with this one instead */
  private applyNow(clip: ClipState, settings: EngineSettings): Promise<void> {
    const gesture = clip.gesture
    if (gesture) {
      clearTimeout(gesture.timer)
      clip.gesture = null
    }
    const applied = this.applySettings(clip, settings)
    if (gesture) applied.then(gesture.resolve, gesture.reject)
    return applied
  }

  /** Applies a settings change after the ones before it; what the clip asks for from now on is these settings */
  private applySettings(clip: ClipState, settings: EngineSettings): Promise<void> {
    clip.target = settings
    clip.targetKey = engineKey(clip.engine.mediaId, settings)
    const run = clip.applying.then(() => this.moveClip(clip, settings))
    clip.applying = run.catch(() => {})
    clip.applied = run
    run.catch(() => {})
    return run
  }

  /** Puts the clip on the engine for its settings: the one that has them, its own recomputed, or a new one */
  private async moveClip(clip: ClipState, settings: EngineSettings): Promise<void> {
    if (this.clips.get(clip.id) !== clip) throw closedError()
    const from = clip.engine
    const key = engineKey(from.mediaId, settings)
    if (from.key === key) return
    try {
      const existing = this.engines.get(key)
      if (existing) {
        await this.transfer(clip, existing)
      } else if (from.users.size === 1 && from.key !== '' && canRecompute(from.settings, settings)) {
        await this.recomputeAs(from, settings, key)
      } else {
        await this.transfer(clip, this.startEngine(from.mediaId, from.rate, from.file, settings, key))
      }
    } catch (error) {
      // The clip keeps what it has: asking for these settings again tries again
      if (clip.targetKey === key) {
        clip.target = clip.engine.settings
        clip.targetKey = clip.engine.key
      }
      throw error
    }
  }

  /** Moves a clip to another engine once that engine is ready; the one it leaves closes if no clip uses it */
  private async transfer(clip: ClipState, to: EngineState): Promise<void> {
    to.users.add(clip.id)
    clip.moving = to
    try {
      await to.ready
    } catch (error) {
      to.users.delete(clip.id)
      this.release(to)
      throw error
    } finally {
      if (clip.moving === to) clip.moving = null
    }
    if (this.clips.get(clip.id) !== clip || to.closed) {
      to.users.delete(clip.id)
      this.release(to)
      throw closedError()
    }
    const from = clip.engine
    clip.engine = to
    clip.cache = newCache()
    from.users.delete(clip.id)
    this.release(from)
  }

  /**
   * Recomputes an engine only this clip uses for its new settings, without reading the file again. The engine is
   * findable by the new settings at once, so a clip opened with them waits for this instead of opening another. A
   * method the engine does not list is refused before anything is sent; a setter or recompute that fails anyway leaves
   * the engine holding part of the new settings, computed with none: it keeps serving its clip the frames it has, and
   * no other clip is put on it.
   */
  private async recomputeAs(
    engine: EngineState,
    settings: EngineSettings,
    key: string,
  ): Promise<void> {
    const previous = engine.settings
    if (previous.method !== settings.method) await this.requireMethod(settings.method)
    if (this.engines.get(engine.key) === engine) this.engines.delete(engine.key)
    engine.key = key
    this.engines.set(key, engine)
    engine.settings = settings
    const info = this.requireInfo(engine)
    const run = (async (): Promise<StabilizationInfo> => {
      await Promise.all(
        settingsSetters(previous, settings).map((setter) =>
          engine.engine.call<null>(setter.type, setter.fields),
        ),
      )
      await engine.engine.call<{ ms: number }>('recompute')
      const refreshed = await this.refreshOutput(engine, info)
      engine.failure = null
      this.invalidate(engine)
      return refreshed
    })()
    engine.ready = run
    try {
      await run
    } catch (error) {
      if (!engine.closed) {
        if (this.engines.get(engine.key) === engine) this.engines.delete(engine.key)
        engine.key = ''
        // What it has computed with, and so the frames it serves, are still the previous settings'
        engine.settings = previous
        engine.ready = Promise.resolve(info)
      }
      throw asStabilizationError(error)
    }
  }

  /** A smoothing method the engine lists (`smoothingMethods`), or the typed error naming the ones it does */
  private async requireMethod(method: string): Promise<void> {
    const methods = await this.smoothingMethods()
    if (methods.some((candidate) => candidate.name === method)) return
    throw new InvalidSettingsError(
      `stabilization.method ${JSON.stringify(method)} is not one of the engine's methods (${methods
        .map((candidate) => JSON.stringify(candidate.name))
        .join(', ')})`,
    )
  }

  /** The engine's answers changed (a recompute): every clip of it drops the frames of the old settings */
  private invalidate(engine: EngineState): void {
    for (const clip of this.clips.values()) {
      if (clip.engine === engine) clip.cache = newCache()
    }
  }

  // -- the frames -----------------------------------------------------------------------------------------------------

  /** Slides the clip's window to the frame asked for and requests what is missing; resolves when those requests did */
  private fillWindow(clip: ClipState, sourceFrame: number): Promise<void> {
    const { cache, engine } = clip
    const info = this.requireInfo(engine)
    const first = Math.max(0, sourceFrame - FRAMES_BEHIND)
    const last = Math.min(info.frames - 1, sourceFrame + FRAMES_AHEAD)
    for (const frame of [...cache.window.keys()]) {
      if (frame < first || frame > last) cache.window.delete(frame)
    }
    const missing: number[] = []
    for (let frame = first; frame <= last; frame += 1) {
      if (!cache.window.has(frame) && !cache.inFlight.has(frame)) missing.push(frame)
    }
    if (missing.length === 0) {
      // Every frame of the window is here or on its way: a caller that waits waits for the ones in flight
      return Promise.all([...cache.batches]).then(() => undefined)
    }
    return this.requestFrames(clip, engine, cache, missing)
  }

  /** One `frameData` request for the frames the window misses: the worker answers all of them in one reply */
  private requestFrames(
    clip: ClipState,
    engine: EngineState,
    cache: FrameCache,
    frames: number[],
  ): Promise<void> {
    for (const frame of frames) cache.inFlight.add(frame)
    const timestampsUs = frames.map((frame) => sourceFrameToMicroseconds(engine.rate, frame))
    const batch = (async (): Promise<void> => {
      try {
        const reply = await engine.engine.call<{ frames: RawFrameData[]; ms: number }>('frameData', {
          timestampsUs,
        })
        engine.failure = null
        // A recompute or a move replaced the clip's cache: the answer belongs to other settings
        if (clip.cache !== cache) return
        frames.forEach((frame, index) => {
          const answer = reply.frames[index]
          if (!answer) {
            throw new StabilizationError(
              'engine',
              `the engine answered no data for source frame ${frame}`,
            )
          }
          if (answer.frame !== frame) {
            throw new StabilizationError(
              'engine',
              `the engine answered source frame ${answer.frame} for ${frame}: the source's rate and the engine's disagree`,
            )
          }
          cache.window.set(frame, {
            matrices: answer.matrices,
            params: answer.params,
            mesh: answer.mesh,
            sourceFrame: frame,
          })
        })
      } catch (error) {
        engine.failure = asStabilizationError(error)
        throw error
      } finally {
        for (const frame of frames) cache.inFlight.delete(frame)
      }
    })()
    cache.batches.add(batch)
    void batch.then(
      () => cache.batches.delete(batch),
      () => cache.batches.delete(batch),
    )
    return batch
  }

  // -- the bookkeeping ------------------------------------------------------------------------------------------------

  /** The open clip, or an error naming the clip the client does not serve */
  private requireClip(clipId: string): ClipState {
    const clip = this.clips.get(clipId)
    if (!clip) throw new Error(`the clip ${JSON.stringify(clipId)} is not open`)
    return clip
  }

  private requireInfo(engine: EngineState): StabilizationInfo {
    if (!engine.info) throw new StabilizationError('closed', 'The clip is not open.')
    return engine.info
  }

  /** Closes a clip: its gesture is dropped, and an engine it leaves with no clip closes */
  private forgetClip(clip: ClipState, reason: string): void {
    if (this.clips.get(clip.id) !== clip) return
    this.clips.delete(clip.id)
    const gesture = clip.gesture
    if (gesture) {
      clip.gesture = null
      clearTimeout(gesture.timer)
      gesture.promise.catch(() => {})
      gesture.reject(new StabilizationError('closed', reason))
    }
    const moving = clip.moving
    if (moving) {
      clip.moving = null
      moving.users.delete(clip.id)
      this.release(moving)
    }
    clip.engine.users.delete(clip.id)
    this.release(clip.engine)
  }
}
