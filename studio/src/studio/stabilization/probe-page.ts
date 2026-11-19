// The page `probe.mjs` drives: Gyroflow's engine in its worker (as the editor runs it), and the stabilization stage
// under test from `./stage`, built from the assets the worker's `shaderAssets` gives back. It warps one frame of the
// clip with the stage, compares it with the module's own CPU warp, and measures what a frame costs. Everything it
// returns is plain JSON: the big buffers stay here, where the comparison happens.
import {
  createStabilizationStage,
  type StabilizationAssets,
  type StabilizationStage,
} from './stage'

interface GyroInfo {
  input: [number, number]
  output: [number, number]
  fps: number
  frames: number
  orientations: number
  lens: string
  lens_model: string
  bytes_read: number
}

interface FrameReply {
  frame: number
  fov: number
  minimalFov: number
  matrixStride: number
  matrices: Float32Array
  params: Uint8Array
  mesh: Float32Array
  ms: number
}

interface ShaderAssetsReply extends StabilizationAssets {
  lensModel: string
}

interface WarpResult {
  ms: number
  readbackMs: number
  format: GPUTextureFormat
  outputSha256: string
}

interface Comparison {
  psnrDb: number
  rms: number
  maxDifference: number
  pixelsDiffering: number
  share: number
}

const log = (text: string): void => {
  const line = document.createElement('div')
  line.textContent = text
  document.querySelector('#log')?.append(line)
}

const worker = new Worker('/gyroflow/wasm/js/gyro-worker.js', { type: 'module' })
let nextId = 1
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>()

worker.onmessage = (event: MessageEvent) => {
  const message = event.data as { type?: string; id: number; result?: unknown; error?: string }
  if (message.type === 'progress') return
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.error !== undefined) entry.reject(new Error(message.error))
  else entry.resolve(message.result)
}
worker.onerror = (event) => {
  for (const entry of pending.values())
    entry.reject(new Error(event.message || 'the worker failed'))
  pending.clear()
}

const call = <T>(
  type: string,
  payload: Record<string, unknown> = {},
  transfer: Transferable[] = [],
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve: (value) => resolve(value as T), reject })
    worker.postMessage({ id, type, ...payload }, transfer)
  })

const sha256 = async (bytes: ArrayBufferView | ArrayBuffer): Promise<string> =>
  // A typed array is a BufferSource at runtime; the type is narrower only because a view over a SharedArrayBuffer
  // is not one, and these are the worker's own arrays
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

// ---- the GPU ------------------------------------------------------------------------------------------------------
let device: GPUDevice | null = null

async function gpu(): Promise<GPUDevice> {
  if (device) return device
  if (!navigator.gpu) throw new Error('navigator.gpu is missing: this Chrome has no WebGPU')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('no WebGPU adapter')
  device = await adapter.requestDevice()
  device.onuncapturederror = (event) => log(`GPU error: ${event.error.message}`)
  const info = adapter.info
  log(`WebGPU: ${info.vendor} / ${info.architecture} / ${info.description}`)
  return device
}

// ---- the clip, the frame, the stage -------------------------------------------------------------------------------
let info: GyroInfo | null = null
let assets: StabilizationAssets | null = null
let currentFrame: FrameReply | null = null
let frameBytes: Uint8Array | null = null
const stages = new Map<GPUTextureFormat, StabilizationStage>()
const kept: { cpu: Uint8Array | null; last: Uint8Array | null; width: number; height: number } = {
  cpu: null,
  last: null,
  width: 0,
  height: 0,
}

function opened(): GyroInfo {
  if (!info) throw new Error('open the clip first')
  return info
}

function frameData(): FrameReply {
  if (!currentFrame) throw new Error('ask for the frame data first')
  return currentFrame
}

function getFrameBytes(): Uint8Array {
  if (!frameBytes) throw new Error('fetch the frame first')
  return frameBytes
}

async function stageFor(output: GPUTextureFormat): Promise<StabilizationStage> {
  const cached = stages.get(output)
  if (cached) return cached
  if (!assets) throw new Error('open the clip first')
  const stage = await createStabilizationStage(await gpu(), assets, { input: 'rgba8unorm', output })
  stages.set(output, stage)
  return stage
}

// IEEE half -> double, for the 16-bit float readback (the format the precise path renders to)
function halfToFloat(half: number): number {
  const sign = (half & 0x8000) >> 15
  const exponent = (half >> 10) & 0x1f
  const fraction = half & 0x3ff
  if (exponent === 0) return (sign ? -1 : 1) * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction ? Number.NaN : sign ? -Infinity : Infinity
  return (sign ? -1 : 1) * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const BYTES_PER_PIXEL: Record<string, number> = { rgba8unorm: 4, rgba16float: 8, rgba32float: 16 }

function inputTexture(gpuDevice: GPUDevice): GPUTexture {
  const [width, height] = opened().input
  const texture = gpuDevice.createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  gpuDevice.queue.writeTexture(
    { texture },
    getFrameBytes(),
    { bytesPerRow: width * 4, rowsPerImage: height },
    {
      width,
      height,
    },
  )
  return texture
}

/** One frame through the stage, read back and turned into the 8-bit RGBA the comparison is on */
async function warpWithStage(format: GPUTextureFormat): Promise<WarpResult> {
  const gpuDevice = await gpu()
  const stage = await stageFor(format)
  const [outWidth, outHeight] = opened().output
  const input = inputTexture(gpuDevice)
  const target = gpuDevice.createTexture({
    size: { width: outWidth, height: outHeight },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })

  const t0 = performance.now()
  const encoder = gpuDevice.createCommandEncoder()
  stage.warp(encoder, input, target, frameData())
  gpuDevice.queue.submit([encoder.finish()])
  await gpuDevice.queue.onSubmittedWorkDone()
  const ms = performance.now() - t0

  const bytesPerRow = outWidth * (BYTES_PER_PIXEL[format] ?? 4)
  const readback = gpuDevice.createBuffer({
    size: bytesPerRow * outHeight,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const t1 = performance.now()
  const copy = gpuDevice.createCommandEncoder()
  copy.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow, rowsPerImage: outHeight },
    { width: outWidth, height: outHeight },
  )
  gpuDevice.queue.submit([copy.finish()])
  await readback.mapAsync(GPUMapMode.READ)
  const bytes = new Uint8Array(readback.getMappedRange().slice(0))
  readback.unmap()
  const readbackMs = performance.now() - t1

  let rgba8 = bytes
  if (format === 'rgba32float') {
    const floats = new Float32Array(bytes.buffer, bytes.byteOffset, outWidth * outHeight * 4)
    rgba8 = new Uint8Array(outWidth * outHeight * 4)
    for (let i = 0; i < rgba8.length; i++) {
      const value = floats[i] ?? 0
      rgba8[i] = Math.max(0, Math.min(255, Math.round(value * 255)))
    }
  } else if (format === 'rgba16float') {
    const halves = new Uint16Array(bytes.buffer, bytes.byteOffset, outWidth * outHeight * 4)
    rgba8 = new Uint8Array(outWidth * outHeight * 4)
    for (let i = 0; i < rgba8.length; i++)
      rgba8[i] = Math.max(0, Math.min(255, Math.round(halfToFloat(halves[i] ?? 0) * 255)))
  }
  kept.last = rgba8
  kept.width = outWidth
  kept.height = outHeight
  target.destroy()
  input.destroy()
  readback.destroy()
  return { ms, readbackMs, format, outputSha256: await sha256(rgba8) }
}

/** The per-frame cost: draws back to back into one target, no readback, the frame re-uploaded every time */
async function timeOnGpu(
  format: GPUTextureFormat,
  frames: number,
): Promise<{ msPerFrame: number; frames: number }> {
  const gpuDevice = await gpu()
  const stage = await stageFor(format)
  const [outWidth, outHeight] = opened().output
  const input = inputTexture(gpuDevice)
  const target = gpuDevice.createTexture({
    size: { width: outWidth, height: outHeight },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const draw = (): void => {
    const encoder = gpuDevice.createCommandEncoder()
    stage.warp(encoder, input, target, frameData())
    gpuDevice.queue.submit([encoder.finish()])
  }
  draw()
  await gpuDevice.queue.onSubmittedWorkDone()
  const t0 = performance.now()
  for (let i = 0; i < frames; i++) draw()
  await gpuDevice.queue.onSubmittedWorkDone()
  const msPerFrame = (performance.now() - t0) / frames
  target.destroy()
  input.destroy()
  return { msPerFrame, frames }
}

/** PSNR of the last frame the stage drew against the last CPU warp, over R, G and B of every pixel */
function compare(): Comparison {
  const { cpu, last, width, height } = kept
  if (!cpu || !last) throw new Error('warp both frames first')
  let squares = 0
  let max = 0
  let differ = 0
  for (let i = 0; i < width * height * 4; i += 4) {
    let pixelDiffers = false
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs((cpu[i + channel] ?? 0) - (last[i + channel] ?? 0))
      squares += difference * difference
      if (difference > max) max = difference
      if (difference > 0) pixelDiffers = true
    }
    if (pixelDiffers) differ++
  }
  const mse = squares / (width * height * 3)
  return {
    psnrDb: mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse),
    rms: Math.sqrt(mse),
    maxDifference: max,
    pixelsDiffering: differ,
    share: differ / (width * height),
  }
}

const probe = {
  async open() {
    const input = document.querySelector<HTMLInputElement>('#clip')
    const file = input?.files?.[0]
    if (!file) throw new Error('no clip chosen')
    const memoryBefore = await call<{ bytes: number | null }>('memory')
    const result = await call<{ info: GyroInfo; ms: number }>('open', { file, progress: true })
    info = result.info
    const profile = await call<Record<string, unknown>>('lensProfile')
    const shader = await call<ShaderAssetsReply>('shaderAssets', {
      model: profile.distortion_model ?? null,
      digitalLens: profile.digital_lens ?? null,
    })
    assets = {
      kernelWgsl: shader.kernelWgsl,
      lensWgsl: shader.lensWgsl,
      digitalLensWgsl: shader.digitalLensWgsl,
      coeffs: shader.coeffs,
      interpolation: shader.interpolation,
    }
    const memoryAfter = await call<{ bytes: number | null }>('memory')
    return {
      info: result.info,
      ms: result.ms,
      fileBytes: file.size,
      lensModel: shader.lensModel,
      coeffsSha256: await sha256(shader.coeffs),
      memoryBytes: memoryAfter.bytes,
      memoryBeforeBytes: memoryBefore.bytes,
    }
  },

  async frameData(timestampUs: number) {
    const result = await call<{ frames: FrameReply[]; ms: number }>('frameData', {
      timestampsUs: [timestampUs],
    })
    const frame = result.frames[0]
    if (!frame) throw new Error('the worker answered no frame')
    currentFrame = frame
    const params = new DataView(
      frame.params.buffer,
      frame.params.byteOffset,
      frame.params.byteLength,
    )
    return {
      frame: frame.frame,
      fov: frame.fov,
      minimalFov: frame.minimalFov,
      ms: result.ms,
      matrixCount: frame.matrices.length / frame.matrixStride,
      matricesSha256: await sha256(frame.matrices),
      paramsSha256: await sha256(frame.params),
      paramsBytes: frame.params.byteLength,
      matricesBytes: frame.matrices.byteLength,
      meshFloats: frame.mesh.length,
      kernel: {
        width: params.getInt32(0, true),
        height: params.getInt32(4, true),
        outputWidth: params.getInt32(12, true),
        outputHeight: params.getInt32(16, true),
        matrixCount: params.getInt32(24, true),
        interpolation: params.getInt32(28, true),
        flags: params.getInt32(36, true),
        maxPixelValue: params.getFloat32(352, true),
        pixelValueLimit: params.getFloat32(364, true),
      },
    }
  },

  /** The frame the comparison is on, decoded by ffmpeg in probe.mjs and served at `url` */
  async fetchFrame(url: string) {
    frameBytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    const [width, height] = opened().input
    if (frameBytes.byteLength !== width * height * 4) {
      throw new Error(`the frame is ${frameBytes.byteLength} bytes, not ${width}x${height} RGBA8`)
    }
    return { bytes: frameBytes.byteLength, sha256: await sha256(frameBytes) }
  },

  async cpuWarp(timestampUs: number) {
    const input = getFrameBytes().slice()
    const inputSha256 = await sha256(input)
    const result = await call<{
      output: ArrayBuffer
      fov: number
      minimal_fov: number
      backend: string
      ms: number
    }>('processRgba8', { timestampUs, input: input.buffer }, [input.buffer])
    const output = new Uint8Array(result.output)
    kept.cpu = output
    kept.width = opened().output[0]
    kept.height = opened().output[1]
    return {
      ms: result.ms,
      backend: result.backend,
      fov: result.fov,
      minimalFov: result.minimal_fov,
      inputSha256,
      outputSha256: await sha256(output),
      outputBytes: output.byteLength,
    }
  },

  warpWithStage,
  timeOnGpu,
  compare,

  /** A stage built from another lens model's assets: the transforms must assemble for every model, not just this clip's */
  async compileModel(model: string) {
    const shader = await call<ShaderAssetsReply>('shaderAssets', { model, digitalLens: null })
    const t0 = performance.now()
    await createStabilizationStage(
      await gpu(),
      {
        kernelWgsl: shader.kernelWgsl,
        lensWgsl: shader.lensWgsl,
        digitalLensWgsl: shader.digitalLensWgsl,
        coeffs: shader.coeffs,
        interpolation: shader.interpolation,
      },
      { input: 'rgba8unorm', output: 'rgba16float' },
    )
    return { lensModel: shader.lensModel, ms: performance.now() - t0 }
  },

  close: () => call<unknown>('close'),
}

;(window as unknown as { stageProbe: typeof probe }).stageProbe = probe
;(window as unknown as { stageProbeReady: boolean }).stageProbeReady = true
log('page ready')
