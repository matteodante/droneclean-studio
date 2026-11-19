// The test double of `gyroflow/wasm/js/gyro-worker.js` that `client.test.ts` and `seat.test.ts` drive: a worker that
// answers the module's messages as the engine would, asynchronously, with clip 0020's numbers. `worker-contract.test.ts`
// holds it to the real worker's message switch, reply for reply, so the two cannot drift apart.

import type { StabilizationInfo, StabilizationProgress } from '../client'
import type { SmoothingMethod } from '../settings'

/** A request as the client sends it: the worker's `{ id, type, ... }` */
export interface GyroRequestMessage {
  id: number
  type: string
  [key: string]: unknown
}

/** The rate of clip 0020, exact: 59.94 frames per second */
export const RATE = { num: 60000, den: 1001 }
const FPS = 60000 / 1001

/** What the engine reports for clip 0020 (`gyroflow/wasm/test/reference/clip-0020.json`) */
export const INFO: StabilizationInfo = {
  input: [3840, 2880],
  output: [3840, 2160],
  fps: FPS,
  frames: 13839,
  orientations: 461674,
  smoothed_orientations: 461674,
  lens: 'DJI_Avata2___4k_4by3_3840x2880-0.00fps',
  frame_readout_time_ms: 10.5175,
  min_fov: 0.7884,
  fovs: 13839,
  bytes_read: 1896500750,
}

/**
 * The frame the engine makes for an aspect: the largest frame of that aspect inside the input, both sides even
 * (`StabilizationManager::set_output_size` in `gyroflow/src/core/lib.rs`).
 */
export function outputFor(
  input: readonly [number, number],
  aspectWidth: number,
  aspectHeight: number,
): [number, number] {
  const scale = Math.min(input[0] / aspectWidth, input[1] / aspectHeight)
  let width = Math.round(aspectWidth * scale)
  let height = Math.round(aspectHeight * scale)
  if (width % 2 !== 0) width -= 1
  if (height % 2 !== 0) height -= 1
  return [width, height]
}

/** The profile the engine holds for clip 0020, as `lensProfile()` gives it (its `name` is empty, its calibration is not) */
export const PROFILE: Record<string, unknown> = {
  name: '',
  calib_dimension: { w: 3840, h: 2880 },
  distortion_model: null,
  digital_lens: null,
}

/** The `Default` method, as `Stabilizer.smoothingMethods()` describes it; the client only passes its values on */
export const METHODS: SmoothingMethod[] = [
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
        name: 'per_axis',
        description: 'Per axis',
        default: false,
        min: null,
        max: null,
        unit: null,
      },
    ],
  },
  { name: 'Optimal path', params: [] },
]

/** The two progress reports `open` posts for clip 0020, before its reply */
export function openProgress(info: StabilizationInfo): StabilizationProgress[] {
  return [
    { bytesRead: 67_108_864, fileSize: 3_764_360_098, phase: 'reading', orientations: null },
    {
      bytesRead: info.bytes_read,
      fileSize: 3_764_360_098,
      phase: 'smoothing',
      orientations: info.orientations,
    },
  ]
}

/** The frame a timestamp names at clip 0020's rate, as the engine computes it */
export function engineFrameOf(timestampUs: number): number {
  return Math.round((timestampUs * FPS) / 1e6)
}

/** One frame's data as the fake engine answers it: every value is the frame's number, so a test can read it back */
export function fakeFrameData(frame: number): {
  frame: number
  fov: number
  minimalFov: number
  matrixStride: number
  matrices: Float32Array
  params: Uint8Array
  mesh: Float32Array
} {
  return {
    frame,
    fov: 1,
    minimalFov: 1,
    matrixStride: 16,
    matrices: new Float32Array(16).fill(frame),
    params: new Uint8Array(416).fill(frame % 256),
    mesh: new Float32Array([frame]),
  }
}

/** What the fake worker does differently from the engine; everything else it answers as the module does */
export interface FakeOptions {
  /** Fields of `info` to override, e.g. `{ orientations: 0 }` for a clip without motion data */
  info?: Partial<StabilizationInfo>
  /** The profile `lensProfile` answers; the default is clip 0020's */
  profile?: Record<string, unknown>
  /** Requests by type that the worker answers with this error instead of a result; mutable, so a test can start one later */
  fail?: Record<string, string>
  /** The frame a timestamp names, when it is not the one the engine would compute from the rate */
  frameOf?: (timestampUs: number) => number
}

/** A worker that speaks `gyroflow/wasm/js/gyro-worker.js`'s messages, asynchronously, as a real one answers */
export interface FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  /** Every request the client posted, in order */
  readonly sent: GyroRequestMessage[]
  /** Requests by type that are answered with this error; a test may add one later */
  readonly fail: Record<string, string>
  terminated: boolean
  /** The profile `lensProfile` answers, replaced by a `setLensProfile` */
  profile: Record<string, unknown>
  /** The frame size `info` reports: the open's, then the one a `setOutputSize` gave */
  output: [number, number]
  postMessage(message: GyroRequestMessage): void
  terminate(): void
  /** The requests of one type the client posted */
  requests(type: string): GyroRequestMessage[]
  /** The answers one request gets, in the order the worker posts them; the progress ones come before the reply */
  replies(message: GyroRequestMessage): unknown[]
}

/** A new fake worker; what it does differently from the engine is in `options` */
export function fakeWorker(options: FakeOptions = {}): FakeWorker {
  /** The engine's answer per request type; a type not here is answered with `null`, as the setters are */
  const answers: Record<string, (message: GyroRequestMessage) => unknown[]> = {
    open: (message) => {
      const info: StabilizationInfo = { ...INFO, ...options.info }
      return [
        ...openProgress(info).map((progress) => ({ type: 'progress', id: message.id, progress })),
        {
          id: message.id,
          // An open that was not given a motion trace records one, as the engine does
          result: {
            info,
            ms: 3779,
            ...(message.motionTrace ? {} : { motionTrace: new Uint8Array([9, 9, 9]).buffer }),
          },
        },
      ]
    },
    lensProfile: (message) => [{ id: message.id, result: worker.profile }],
    shaderAssets: (message) => [
      {
        id: message.id,
        result: {
          lensModel: message.model ?? 'opencv_fisheye',
          kernelWgsl: 'kernel',
          lensWgsl: 'lens',
          digitalLensWgsl: 'digital',
          coeffs: new Float32Array(496),
          interpolation: 2,
        },
      },
    ],
    smoothingMethods: (message) => [{ id: message.id, result: METHODS }],
    info: (message) => [
      { id: message.id, result: { ...INFO, ...options.info, output: worker.output } },
    ],
    setOutputSize: (message) => {
      const input = { ...INFO, ...options.info }.input
      worker.output = outputFor(input, Number(message.width), Number(message.height))
      return [{ id: message.id, result: null }]
    },
    setLensProfile: (message) => {
      worker.profile = JSON.parse(String(message.json)) as Record<string, unknown>
      return [{ id: message.id, result: null }]
    },
    frameData: (message) => {
      const frameOf = options.frameOf ?? engineFrameOf
      const frames = (message.timestampsUs as number[]).map((timestampUs) => ({
        ...fakeFrameData(frameOf(timestampUs)),
        ms: 0.4,
      }))
      return [{ id: message.id, result: { frames, ms: frames.length * 0.4 } }]
    },
    recompute: (message) => [{ id: message.id, result: { ms: 940 } }],
  }
  const worker: FakeWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    sent: [],
    fail: { ...options.fail },
    terminated: false,
    profile: options.profile ?? { ...PROFILE },
    output: [...({ ...INFO, ...options.info }.output)] as [number, number],
    postMessage(message) {
      worker.sent.push(message)
      if (worker.terminated) return
      for (const reply of worker.replies(message)) {
        queueMicrotask(() => worker.onmessage?.({ data: reply } as MessageEvent))
      }
    },
    terminate() {
      worker.terminated = true
    },
    requests(type) {
      return worker.sent.filter((message) => message.type === type)
    },
    replies(message) {
      const failure = worker.fail[message.type]
      if (failure !== undefined) return [{ id: message.id, error: failure }]
      const answer = answers[message.type]
      return answer ? answer(message) : [{ id: message.id, result: null }]
    },
  }
  return worker
}
