// The messages of js/gyro-worker.js. Import them as types:
//
//   import type { GyroRequest, GyroReply, GyroInfo } from './gyro-worker.js'
//
// A reply carries the request's `id` and either a `result` or an `error` (the message of the exception the worker
// threw). The typed arrays of a `frameData` reply and the `output` of a `processRgba8` reply arrive transferred.

/** What `open` and `info` report about the clip */
export interface GyroInfo {
  /** The clip's frame size in pixels */
  input: [number, number]
  /** The stabilized frame's size in pixels */
  output: [number, number]
  fps: number
  frames: number
  /** How many motion samples the file carried */
  orientations: number
  smoothed_orientations: number
  /** The lens profile the engine found in or for the clip */
  lens: string
  lens_model: string
  frame_readout_time_ms: number
  min_fov: number
  fovs: number
  /** What `open` read through the File, in bytes */
  bytes_read: number
  /** `recorded`: the open read the file and kept a motion trace; `replayed`: it was served from a trace given to it */
  motion_trace: 'recorded' | 'replayed'
}

/**
 * A smoothing parameter as the engine describes it: what it accepts and what a new clip starts with. A flag's
 * `default` is a boolean and its `min`, `max` and `unit` are `null` (`lib.rs`, `smoothing_methods`).
 */
export interface SmoothingParameter {
  name: string
  description: string
  default: number | boolean
  min: number | null
  max: number | null
  unit: string | null
}

export interface SmoothingMethod {
  name: string
  params: SmoothingParameter[]
}

/** What `open` reports while it runs, when it was asked to (`{ type: 'open', file, progress: true }`) */
export interface GyroProgress {
  /** What `open` has read through the File so far, in bytes (the count `info().bytes_read` ends with) */
  bytesRead: number
  /** The File's size in bytes */
  fileSize: number
  /** `reading`: the motion data is being read; `smoothing`: it is read and the engine is computing the stabilization */
  phase: 'reading' | 'smoothing'
  /** How many motion samples the file carried: known once the read is done, `null` before */
  orientations: number | null
}

/** Gyroflow's warp shader and the coefficients table it reads, as `shaderAssets` returns them (task 6.3's stage) */
export interface ShaderAssets {
  /** The lens model whose functions `lensWgsl` holds: the one asked for, or the engine's default */
  lensModel: string
  /** `gpu/wgpu_undistort.wgsl` as it is: `LENS_MODEL_FUNCTIONS;`, `SCALAR` and `{buffer_input}` still to fill in */
  kernelWgsl: string
  /** The lens model's functions, where `LENS_MODEL_FUNCTIONS;` goes */
  lensWgsl: string
  /** The digital lens's functions (the identity pair when the profile has none) */
  digitalLensWgsl: string
  /** The `coeffs` storage buffer's contents, 496 floats, transferred */
  coeffs: Float32Array
  /** The `interpolation` pipeline constant the shader's sampling loop is compiled for (bilinear, 2) */
  interpolation: number
}

/** What `memory` reports: the engine's wasm heap */
export interface MemoryResult {
  /** The heap's size in bytes, or `null` when the module couldn't be asked */
  bytes: number | null
}

/** One frame's stabilization data: the row matrices and the kernel parameters, as the GPU warp is fed */
export interface FrameData {
  frame: number
  fov: number
  minimalFov: number
  /** Floats per row matrix: 16 */
  matrixStride: number
  /** Every sensor row's matrix, flattened: `matrixStride` floats per row */
  matrices: Float32Array
  /** The bytes of Gyroflow's `KernelParams`, as its wgpu path uploads them */
  params: Uint8Array
  /** The frame's undistortion mesh, empty when it has none */
  mesh: Float32Array
  /** How long the engine took for this frame, in ms */
  ms: number
}

export interface OpenResult {
  info: GyroInfo
  ms: number
  /** The bytes the parsers consumed, transferred, when this open recorded them (`info.motion_trace === 'recorded'`) */
  motionTrace?: ArrayBuffer
}

export interface FrameDataResult {
  frames: FrameData[]
  /** How long the engine took for all of them, in ms */
  ms: number
}

export interface ProcessResult {
  /** The stabilized frame, RGBA8, `output[0] * output[1] * 4` bytes */
  output: ArrayBuffer
  fov: number
  minimal_fov: number
  backend: string
  /** How long the engine took, in ms */
  ms: number
}

export interface RecomputeResult {
  ms: number
}

/** A file the desktop links by path: no `File`, its bytes read from the shell's same-origin media route with `Range` */
export interface LinkedClipFile {
  /** The media route, `droneclean://app/__media/<id>` */
  url: string
  /** The file's size in bytes */
  size: number
  /** The file's name, which the engine's parsers look at */
  name: string
  /** Its modification time, epoch ms: with the name and size, the key a parse is cached under */
  lastModified: number
}

/** What each request answers */
export interface GyroResults {
  open: OpenResult
  info: GyroInfo
  lensProfile: Record<string, unknown>
  shaderAssets: ShaderAssets
  smoothingMethods: SmoothingMethod[]
  memory: MemoryResult
  setSmoothing: null
  setFov: null
  setAdaptiveZoom: null
  setHorizonLock: null
  setLensProfile: null
  setOutputSize: null
  recompute: RecomputeResult
  frameData: FrameDataResult
  processRgba8: ProcessResult
  close: null
}

export type GyroRequest =
  | { id: number; type: 'open'; file: File | LinkedClipFile; progress?: boolean; motionTrace?: ArrayBuffer }
  | { id: number; type: 'info' }
  | { id: number; type: 'lensProfile' }
  | { id: number; type: 'shaderAssets'; model?: string | null; digitalLens?: string | null }
  | { id: number; type: 'smoothingMethods' }
  | { id: number; type: 'memory' }
  | { id: number; type: 'setSmoothing'; method: string; params: Record<string, number> }
  | { id: number; type: 'setFov'; fov: number }
  | { id: number; type: 'setAdaptiveZoom'; windowSeconds: number }
  | { id: number; type: 'setHorizonLock'; lockPercent: number; rollDegrees: number }
  | { id: number; type: 'setLensProfile'; json: string }
  | { id: number; type: 'setOutputSize'; width: number; height: number }
  | { id: number; type: 'recompute' }
  | { id: number; type: 'frameData'; timestampsUs: number[] }
  | { id: number; type: 'processRgba8'; timestampUs: number; input: ArrayBuffer }
  | { id: number; type: 'close' }

/** A progress report `open` posts while it runs, when the request asked for one (`progress: true`) */
export interface GyroProgressMessage {
  type: 'progress'
  /** The `id` of the `open` request it belongs to */
  id: number
  progress: GyroProgress
}

/** A reply to one of the requests above, or a progress report (which has a `type`) */
export type GyroReply<T = unknown> = { id: number; result: T } | { id: number; error: string } | GyroProgressMessage
