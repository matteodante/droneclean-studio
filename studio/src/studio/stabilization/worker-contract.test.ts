// @vitest-environment node

// The worker's contract (review finding S6): the client against the real worker's message switch
// (`gyroflow/wasm/js/gyro-messages.js`, which `gyro-worker.js` hands the package), with only the wasm faked at its
// boundary. A run of the client's own calls sends every request the client can send (`GYRO_REQUEST_TYPES`) and the
// switch answers each without an error; the fake worker every other test drives (`__fixtures__/fake-gyro-worker.ts`) answers each of
// those requests with replies of the same shape; and the fake wasm is held to the class `gyroflow/wasm/src/lib.rs`
// exports, so it cannot answer for a method the engine does not have.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import {
  serveGyroMessages,
  type GyroMessageScope,
} from '../../../../gyroflow/wasm/js/gyro-messages.js'
import { GYRO_REQUEST_TYPES, createStabilizationClient, type StabilizationClip } from './client'
import {
  INFO,
  METHODS,
  PROFILE,
  RATE,
  engineFrameOf,
  fakeFrameData,
  fakeWorker,
  openProgress,
  type GyroRequestMessage,
} from './__fixtures__/fake-gyro-worker'
import { stabilizationDefaults } from './settings'

/** A profile file a pilot loads for a clip whose file carries none */
const LOADED_PROFILE = JSON.stringify({
  name: 'the pilot’s profile',
  calib_dimension: { w: 3840, h: 2880 },
  distortion_model: 'opencv_fisheye',
  digital_lens: null,
})

/** `Stabilizer.shaderAssets`'s object, faked: the getters `lib.rs`'s `ShaderAssets` has, and wasm-bindgen's `free` */
function fakeShaderAssets(model: string | null) {
  return {
    lensModel: model ?? 'opencv_fisheye',
    kernelWgsl: 'kernel',
    lensWgsl: 'lens',
    digitalLensWgsl: 'digital',
    coeffs: new Float32Array(496),
    interpolation: 2,
    free() {},
  }
}

/** `Stabilizer.frameData`'s object, faked: the getters `lib.rs`'s `FrameData` has, and wasm-bindgen's `free` */
function fakeWasmFrameData(timestampUs: number) {
  return { ...fakeFrameData(engineFrameOf(timestampUs)), free() {} }
}

/**
 * The wasm package, faked: `init()`'s promise and the `Stabilizer` class, with the members `gyro-messages.js` calls,
 * answering with clip 0020's numbers. Like the real package, nothing may be called before `init()` has resolved, which
 * happens a task after the worker starts.
 */
function fakeWasm() {
  let initialized = false
  const requireInit = (): void => {
    if (!initialized) throw new Error('the wasm module was called before init() resolved')
  }

  class Stabilizer {
    private profile: Record<string, unknown> = { ...PROFILE }
    replayed = false

    static open(
      size: number,
      _filename: string,
      read: (offset: number, length: number) => Uint8Array,
      onProgress?: (progress: unknown) => void,
      trace?: Uint8Array,
    ): Stabilizer {
      requireInit()
      // The engine reads through the callback, synchronously, and reports as it goes
      if (read(0, Math.min(size, 4)).length !== Math.min(size, 4)) throw new Error('short read')
      for (const progress of openProgress(INFO)) onProgress?.(progress)
      const stabilizer = new Stabilizer()
      stabilizer.replayed = trace !== undefined
      return stabilizer
    }

    /** The trace an open recorded (the fake records a small one); an open given a trace has none */
    motionTrace(): Uint8Array | undefined {
      return this.replayed ? undefined : new Uint8Array([1, 2, 3])
    }

    static smoothingMethods(): unknown {
      requireInit()
      return METHODS
    }

    static shaderAssets(model: string | null): ReturnType<typeof fakeShaderAssets> {
      requireInit()
      return fakeShaderAssets(model)
    }

    info(): unknown {
      return INFO
    }

    lensProfile(): unknown {
      return this.profile
    }

    setSmoothing(): void {}

    setFov(): void {}

    setAdaptiveZoom(): void {}

    setHorizonLock(): void {}

    setOutputSize(): void {}

    setLensProfile(json: string): void {
      this.profile = JSON.parse(json) as Record<string, unknown>
    }

    recompute(): void {}

    frameData(timestampUs: number): ReturnType<typeof fakeWasmFrameData> {
      return fakeWasmFrameData(timestampUs)
    }

    free(): void {}
  }

  const ready = new Promise((resolve) => {
    setTimeout(() => {
      initialized = true
      resolve({ memory: { buffer: new ArrayBuffer(64) } })
    }, 0)
  })
  return { ready, Stabilizer }
}

/**
 * The real switch behind a `Worker`'s face: what the client posts reaches `gyro-messages.js`, and its replies come
 * back asynchronously, as a worker's do.
 */
class SwitchWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  readonly sent: GyroRequestMessage[] = []
  readonly posted: Array<{ id?: number; [key: string]: unknown }> = []
  terminated = false
  private readonly scope: GyroMessageScope

  constructor() {
    this.scope = {
      onmessage: null,
      postMessage: (message) => {
        this.posted.push(message as { id?: number })
        queueMicrotask(() => {
          if (!this.terminated) this.onmessage?.({ data: message } as MessageEvent)
        })
      },
    }
    const { ready, Stabilizer } = fakeWasm()
    serveGyroMessages(this.scope, {
      ready,
      Stabilizer,
      reader: { readAsArrayBuffer: (blob: Blob) => new ArrayBuffer(blob.size) },
    })
  }

  postMessage(message: GyroRequestMessage): void {
    this.sent.push(message)
    void this.scope.onmessage?.({ data: message })
  }

  terminate(): void {
    this.terminated = true
  }

  /** What the switch posted for one request: its progress reports, then its reply */
  postedFor(id: number): unknown[] {
    return this.posted.filter((message) => message.id === id)
  }
}

const CLIP: StabilizationClip = {
  id: 'clip-1',
  mediaId: 'media-1',
  file: new File([new Uint8Array(8)], 'DJI_20261115124704_0020_D.MP4'),
  rate: RATE,
}

/** Every call of the client, once, against the real switch; the workers it started, with what went back and forth */
async function runEveryCall(): Promise<SwitchWorker[]> {
  const workers: SwitchWorker[] = []
  const client = createStabilizationClient({
    createWorker: () => {
      const worker = new SwitchWorker()
      workers.push(worker)
      return worker as unknown as Worker
    },
    recomputeDelayMs: 1,
  })
  const settings = stabilizationDefaults(METHODS)

  // Before any clip is open the methods are read from a worker of their own
  await client.smoothingMethods()
  // The project's frame is part of what an engine is asked for: the open sets it, and a change of it moves the engine
  await client.open(CLIP, { ...settings, outputAspect: { width: 16, height: 9 } }, () => {})
  await client.lensProfile(CLIP.id)
  await client.stageAssets(CLIP.id)
  await client.getFrameData(CLIP.id, 100, { wait: true })
  await client.setSettings(CLIP.id, {
    ...settings,
    method: 'Optimal path',
    params: {},
    fov: 1.2,
    horizonLockPercent: 50,
    horizonLockRoll: 10,
    adaptiveZoomSeconds: 6,
    outputAspect: { width: 4, height: 3 },
  })
  await client.loadLensProfile(CLIP.id, LOADED_PROFILE)
  await client.close(CLIP.id)
  client.destroy()
  return workers
}

/** A value's shape: its keys and the kind of every value, at every level; typed arrays by their class */
function shape(value: unknown): unknown {
  if (value === null) return 'null'
  if (ArrayBuffer.isView(value)) return value.constructor.name
  if (Array.isArray(value)) return value.map(shape)
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, shape(record[key])]),
    )
  }
  return typeof value
}

describe('the client against the real worker’s message switch', () => {
  it('sends every request it can send, and each is answered without an error', async () => {
    const workers = await runEveryCall()

    const sent = workers.flatMap((worker) => worker.sent)
    expect([...new Set(sent.map((message) => message.type))].sort()).toEqual(
      [...GYRO_REQUEST_TYPES].sort(),
    )
    const errors = workers.flatMap((worker) => worker.posted.filter((message) => 'error' in message))
    expect(errors).toEqual([])
  })

  it('gets from the fake worker replies of the same shape as the real switch’s, request for request', async () => {
    const workers = await runEveryCall()

    for (const worker of workers) {
      // The fake answers the same requests in the same order, so its state (a loaded profile) moves as the engine's
      const fake = fakeWorker()
      for (const message of worker.sent) {
        expect({ type: message.type, replies: shape(fake.replies(message)) }).toEqual({
          type: message.type,
          replies: shape(worker.postedFor(message.id)),
        })
      }
    }
  })
})

/** The members a `#[wasm_bindgen] impl` block of `lib.rs` exports, by their JavaScript names */
function exportedMembers(
  source: string,
  struct: string,
): { statics: string[]; methods: string[]; getters: string[] } {
  const start = source.indexOf(`impl ${struct} {`)
  if (start < 0) throw new Error(`lib.rs has no impl ${struct}`)
  const block = source.slice(start, source.indexOf('\n}\n', start))
  const statics: string[] = []
  const methods: string[] = []
  const getters: string[] = []
  for (const match of block.matchAll(
    /(?:#\[wasm_bindgen\(([^)]*)\)\]\s*)?pub fn (\w+)\s*\(([^)]*)\)/g,
  )) {
    const [, attribute = '', rustName = '', parameters = ''] = match
    const name = /js_name\s*=\s*(\w+)/.exec(attribute)?.[1] ?? rustName
    if (/\bgetter\b/.test(attribute)) getters.push(name)
    else if (/^\s*&(mut\s+)?self\b/.test(parameters)) methods.push(name)
    else statics.push(name)
  }
  return { statics, methods, getters }
}

describe('the fake wasm', () => {
  const source = readFileSync(
    new URL('../../../../gyroflow/wasm/src/lib.rs', import.meta.url),
    'utf8',
  )
  /** wasm-bindgen gives every exported struct a `free` that is not in `lib.rs` */
  const generated = ['free']

  it('has only the members lib.rs’s Stabilizer exports, static and instance alike', () => {
    const exported = exportedMembers(source, 'Stabilizer')
    const { Stabilizer } = fakeWasm()
    const statics = Object.getOwnPropertyNames(Stabilizer).filter(
      (name) => !['length', 'name', 'prototype'].includes(name),
    )
    const methods = Object.getOwnPropertyNames(Stabilizer.prototype).filter(
      (name) => name !== 'constructor',
    )

    expect(statics.filter((name) => !exported.statics.includes(name))).toEqual([])
    expect(
      methods.filter((name) => !exported.methods.includes(name) && !generated.includes(name)),
    ).toEqual([])
  })

  it('answers frames and shader assets with only the getters lib.rs exports', () => {
    const frameGetters = exportedMembers(source, 'FrameData').getters
    const assetGetters = exportedMembers(source, 'ShaderAssets').getters

    expect(
      Object.keys(fakeWasmFrameData(0)).filter(
        (name) => !frameGetters.includes(name) && !generated.includes(name),
      ),
    ).toEqual([])
    expect(
      Object.keys(fakeShaderAssets(null)).filter(
        (name) => !assetGetters.includes(name) && !generated.includes(name),
      ),
    ).toEqual([])
  })
})
