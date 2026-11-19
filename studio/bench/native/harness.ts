/**
 * The page of the native 10-bit path's measurements (design 3.6 slice 7, plan tasks 8.4 and 3.3): FFmpeg's `p010le`
 * through the provider's native backend and the GPU conversion, and the accumulator packed back to `p010le` into the
 * shell's encoder — in Electron, with the real preload, the real frame and encode protocols and the real FFmpeg.
 *
 * Built by `vite.config.mjs`, served from `droneclean://app` by `main.mjs`, driven by
 * `bench/measurements/native-export.mjs`. One mode per run, from the query string:
 *
 * - `fidelity`: decodes `frames` frames of the clip from `start` through the backend and sends the converted
 *   `rgba16float` textures of the frames in `pick` to the main process, which saves them; the measurement compares them
 *   with FFmpeg's own `gbrp10le` of the same frames. Also the decode leg's rate.
 * - `export`: the 10-bit export of a plain clip: provider frame → one draw into an accumulator (the composite of a
 *   one-clip project) → `p010-out` → the encoder, writing `out`. Rate, the stream's allocations, textures created,
 *   and the time the loop waited for frames and for the readback ring. With `sink=discard` the packed frames are read
 *   back and dropped instead of posted: everything but the upload and the encoder.
 * - `upload`: frames already in memory posted to a real encode job: the upload and the encoder, nothing else.
 * - `ramp`: the grey ramp through the backend; the levels of one row of the converted texture, counted exactly.
 * - `pack`: one clip frame (and a synthetic picture: full luma detail, smooth chroma) packed by `p010-out`; the
 *   accumulator and the packed bytes go to the main process, and the measurement decodes the bytes with FFmpeg.
 *
 * Prints one `HARNESS_REPORT {json}` console line.
 */
import { createNativeBackend } from '@/studio/render/frames/backends/native'
import { blitToSourceFrame, sourceFrameTextureDescriptor } from '@/studio/render/frames/blit'
import { createSourceFrameProvider } from '@/studio/render/frames/provider'
import type { FrameBackend } from '@/studio/render/frames/types'
import { halfToFloat } from '@/studio/render/half-float'
import { createFrameSlotPool } from '@/studio/render/precise/native-source'
import {
  createP010OutPass,
  openNativeEncodeStream,
  startNativeEncode,
} from '@/studio/render/precise/p010-out'
import { preciseReadbackBytes } from '@/studio/render/precise/contract'
import { preciseReadbackUrl } from '@/studio/media/native-protocol'
import type { PreciseExportFormatId } from '@/studio/render/precise/contract'
import { secondsToFrame, toRate } from '@/studio/time'
import type { VideoItem } from '@/types/timeline'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') ?? 'export'

function required(name: string): string {
  const value = params.get(name)
  if (value === null || value === '') throw new Error(`the harness needs ?${name}=…`)
  return value
}

function numberParam(name: string, fallback: number): number {
  const raw = params.get(name)
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`?${name}=${raw} is not a number`)
  return value
}

/** The device, wrapped so the harness counts every texture and buffer created on it. */
async function requestDevice() {
  if (navigator.gpu === undefined) throw new Error('this Electron has no WebGPU')
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (adapter === null) throw new Error('no WebGPU adapter on this machine')
  const real = await adapter.requestDevice()
  const created = { textures: 0, buffers: 0 }
  const device = new Proxy(real, {
    get(target, property) {
      if (property === 'createTexture') {
        return (descriptor: GPUTextureDescriptor) => {
          created.textures += 1
          return target.createTexture(descriptor)
        }
      }
      if (property === 'createBuffer') {
        return (descriptor: GPUBufferDescriptor) => {
          created.buffers += 1
          return target.createBuffer(descriptor)
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value
    },
  })
  return { device, real, created }
}

/** A clip of the file at `path`, at the rate the file runs at: what the provider asks the backend for. */
function clipOf(path: string, fps: number): VideoItem {
  return {
    id: 'harness-clip',
    type: 'video',
    label: 'harness',
    src: path,
    sourceFps: fps,
  } as unknown as VideoItem
}

/** The provider's other backend: the harness reads only files on disk, so nothing should reach it. */
const noFallback: FrameBackend = {
  origin: 'webcodecs',
  decode: () => Promise.reject(new Error('the harness has no WebCodecs backend')),
  destroy() {},
}

/** The texture's bytes, as `rgba16float` rows of `width * 8` bytes (no padding at a width that is a multiple of 32). */
async function readTexture(device: GPUDevice, texture: GPUTexture): Promise<Uint8Array> {
  const { width, height } = texture
  const bytesPerRow = Math.ceil((width * 8) / 256) * 256
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: height },
    { width, height },
  )
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(GPUMapMode.READ)
  const mapped = new Uint8Array(buffer.getMappedRange())
  const out = new Uint8Array(width * height * 8)
  for (let y = 0; y < height; y += 1)
    out.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 8), y * width * 8)
  buffer.unmap()
  buffer.destroy()
  return out
}

/** A buffer's bytes (a copy source), read back. */
async function readBuffer(device: GPUDevice, source: GPUBuffer, size: number): Promise<Uint8Array> {
  const buffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const encoder = device.createCommandEncoder()
  encoder.copyBufferToBuffer(source, 0, buffer, 0, size)
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(GPUMapMode.READ)
  const out = new Uint8Array(buffer.getMappedRange()).slice()
  buffer.unmap()
  buffer.destroy()
  return out
}

/** Hands bytes to the main process, which writes them into the run's folder. */
async function save(name: string, bytes: Uint8Array): Promise<void> {
  const answer = await fetch(`/__harness/save/${name}`, {
    method: 'POST',
    body: bytes as Uint8Array<ArrayBuffer>,
  })
  if (!answer.ok) throw new Error(`saving ${name}: ${answer.status} ${await answer.text()}`)
}

const rateOf = () => toRate(Number(required('fps')))

/** The first source frame: `startIndex` when given (the frame FFmpeg's `-ss start` lands on), else `start` s rounded. */
const firstIndex = (): number =>
  params.has('startIndex')
    ? numberParam('startIndex', 0)
    : secondsToFrame(rateOf(), numberParam('start', 60))

async function measureFidelity(): Promise<Record<string, unknown>> {
  const { device } = await requestDevice()
  const file = required('file')
  const fps = Number(required('fps'))
  const startIndex = firstIndex()
  const frames = numberParam('frames', 300)
  const pick = new Set(required('pick').split(',').map(Number))
  const slots = createFrameSlotPool()
  const backend = createNativeBackend(device, { slots })
  const fileRef = { key: `source:${file}`, src: file, path: file, rate: rateOf() }
  const startedAt = performance.now()
  let firstAt = 0
  const saved: number[] = []
  for (let k = 0; k < frames; k += 1) {
    const decoded = await backend.decode(fileRef, startIndex + k)
    if (k === 0) firstAt = performance.now()
    if (decoded.index !== startIndex + k)
      throw new Error(`asked frame ${startIndex + k}, got ${decoded.index}`)
    if (pick.has(k)) {
      await save(`fidelity-${k}.rgba16f`, await readTexture(device, decoded.texture))
      saved.push(k)
    }
    decoded.texture.destroy()
  }
  await device.queue.onSubmittedWorkDone()
  const doneAt = performance.now()
  backend.destroy()
  return {
    mode,
    file,
    fps,
    startIndex,
    frames,
    saved,
    firstFrameAfterMs: Number((firstAt - startedAt).toFixed(1)),
    // Readbacks of the picked frames are inside this figure; the export mode measures the leg without them.
    framesPerSecond: Number(((frames - 1) / ((doneAt - firstAt) / 1000)).toFixed(2)),
    pageSlotsAllocated: slots.allocated,
  }
}

async function measureExport(): Promise<Record<string, unknown>> {
  const { device, created } = await requestDevice()
  const file = required('file')
  const fps = Number(required('fps'))
  const rate = rateOf()
  const startIndex = firstIndex()
  const frames = numberParam('frames', 600)
  const format = required('format') as PreciseExportFormatId
  const out = required('out')
  const width = numberParam('width', 3840)
  const height = numberParam('height', 2880)
  const slots = createFrameSlotPool()
  const provider = createSourceFrameProvider({
    backend: noFallback,
    native: createNativeBackend(device, { slots }),
    maxSamples: 1,
    capacity: 3,
    mode: 'export',
    projectRate: rate,
  })
  const clip = clipOf(file, fps)
  // The composite of a one-clip project: one draw of the staged picture into the float accumulator.
  const accumulator = device.createTexture({
    ...sourceFrameTextureDescriptor(width, height),
    label: 'harness-accumulator',
  })
  const discard = params.get('sink') === 'discard'
  const sink = discard
    ? openNativeEncodeStream({
        device,
        jobId: 'discard',
        width,
        height,
        frameBytes: preciseReadbackBytes('p010le', width, height),
        fetch: (async (_url: string, init: RequestInit) => {
          const reader = (init.body as ReadableStream<Uint8Array>).getReader()
          let frames = 0
          for (let step = await reader.read(); step.done !== true; step = await reader.read())
            frames += 1
          return new Response(JSON.stringify({ framesWritten: frames, path: 'discarded' }))
        }) as unknown as typeof fetch,
      })
    : await startNativeEncode({
        device,
        path: out,
        format,
        bitrate: numberParam('bitrate', 120_000_000),
        fps: rate,
        width,
        height,
      })
  let waitFrameMs = 0
  let waitDeliverMs = 0
  const startedAt = performance.now()
  let firstAt = 0
  const allocationsAt: Record<
    string,
    { textures: number; buffers: number; pageSlots: number; sink: number }
  > = {}
  for (let k = 0; k < frames; k += 1) {
    const askedAt = performance.now()
    const frame = await provider.frameAt(clip, startIndex + k)
    const gotAt = performance.now()
    if (k === 0) firstAt = gotAt
    else waitFrameMs += gotAt - askedAt
    blitToSourceFrame(device, frame.texture, accumulator)
    provider.release(frame)
    const deliverAt = performance.now()
    await sink.deliver(accumulator, { index: k, rate, durationFrames: 1 })
    waitDeliverMs += performance.now() - deliverAt
    if (k === 9 || k === frames - 1) {
      allocationsAt[String(k + 1)] = {
        textures: created.textures,
        buffers: created.buffers,
        pageSlots: slots.allocated,
        sink: sink.counters.allocations,
      }
    }
  }
  const deliveredAt = performance.now()
  const reply = await sink.finish()
  const doneAt = performance.now()
  provider.destroy()
  accumulator.destroy()
  return {
    mode,
    file,
    format,
    out,
    reply,
    frames,
    firstFrameAfterMs: Number((firstAt - startedAt).toFixed(1)),
    framesPerSecond: Number((frames / ((doneAt - firstAt) / 1000)).toFixed(2)),
    framesPerSecondToLastDelivery: Number(
      ((frames - 1) / ((deliveredAt - firstAt) / 1000)).toFixed(2),
    ),
    finishMs: Number((doneAt - deliveredAt).toFixed(1)),
    sink: discard ? 'discard' : 'encoder',
    waitForFrameMsPerFrame: Number((waitFrameMs / (frames - 1)).toFixed(2)),
    waitForReadbackRingMsPerFrame: Number((waitDeliverMs / frames).toFixed(2)),
    sinkCounters: sink.counters,
    allocationsAt,
  }
}

async function measureRamp(): Promise<Record<string, unknown>> {
  const { device } = await requestDevice()
  const file = required('file')
  const rows = required('rows').split(',').map(Number)
  const backend = createNativeBackend(device)
  const decoded = await backend.decode(
    { key: `source:${file}`, src: file, path: file, rate: rateOf() },
    0,
  )
  const bytes = await readTexture(device, decoded.texture)
  const halves = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
  const { width } = decoded
  const perRow = rows.map((row) => {
    const seen = new Set<number>()
    let min = Infinity
    let max = -Infinity
    for (let x = 0; x < width; x += 1) {
      const bits = halves[(row * width + x) * 4 + 1]! // green: equal to red and blue on a grey ramp
      seen.add(bits)
      const value = halfToFloat(bits)
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    return { row, levels: seen.size, min, max }
  })
  decoded.texture.destroy()
  backend.destroy()
  return { mode, file, width, height: decoded.height, perRow }
}

/** A picture whose 4:2:0 chroma loses nothing: luma noise on every pixel, chroma a smooth gradient. */
function syntheticPicture(width: number, height: number): Uint16Array {
  const halves = new Uint16Array(width * height * 4)
  const scratch = new Float32Array(1)
  const bits = new Uint32Array(scratch.buffer)
  const toHalf = (value: number): number => {
    scratch[0] = value
    const x = bits[0]!
    const sign = (x >>> 16) & 0x8000
    const exponent = ((x >>> 23) & 0xff) - 127 + 15
    if (exponent <= 0) return sign
    const mantissa = x & 0x7fffff
    // round to nearest, ties to even
    let half = sign | (exponent << 10) | (mantissa >>> 13)
    const rest = mantissa & 0x1fff
    if (rest > 0x1000 || (rest === 0x1000 && (half & 1) === 1)) half += 1
    return half
  }
  let seed = 12345
  const random = () => {
    seed = (seed * 1103515245 + 12345) >>> 0
    return seed / 2 ** 32
  }
  // FFmpeg's convention (p010-in.ts): full-range codes / 1023, luma (D-64)*255/219, chroma (C-512)*255/224.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const luma = 100 + random() * 800 // codes 100..900
      const cb = 512 + 300 * (x / width - 0.5)
      const cr = 512 + 300 * (y / height - 0.5)
      const Y = ((luma - 64) * 255) / 219
      const U = ((cb - 512) * 255) / 224
      const V = ((cr - 512) * 255) / 224
      const r = (Y + 1.5748 * V) / 1023
      const g = (Y - 0.187324 * U - 0.468124 * V) / 1023
      const b = (Y + 1.8556 * U) / 1023
      const i = (y * width + x) * 4
      halves[i] = toHalf(r)
      halves[i + 1] = toHalf(g)
      halves[i + 2] = toHalf(b)
      halves[i + 3] = toHalf(1)
    }
  }
  return halves
}

async function measurePack(): Promise<Record<string, unknown>> {
  const { device } = await requestDevice()
  const file = required('file')
  const rate = rateOf()
  const index = firstIndex() + numberParam('frame', 10)
  const backend = createNativeBackend(device)
  const decoded = await backend.decode(
    { key: `source:${file}`, src: file, path: file, rate },
    index,
  )
  const { width, height } = decoded
  const pass = createP010OutPass(device, width, height)
  const pack = async (texture: GPUTexture): Promise<Uint8Array> => {
    const encoder = device.createCommandEncoder()
    pass.encode(encoder, texture)
    device.queue.submit([encoder.finish()])
    return readBuffer(device, pass.buffer, pass.frameBytes)
  }
  await save('pack-clip.rgba16f', await readTexture(device, decoded.texture))
  await save('pack-clip.p010le', await pack(decoded.texture))

  const synthetic = device.createTexture({
    ...sourceFrameTextureDescriptor(width, height),
    usage: sourceFrameTextureDescriptor(width, height).usage | GPUTextureUsage.COPY_DST,
  })
  const halves = syntheticPicture(width, height)
  device.queue.writeTexture(
    { texture: synthetic },
    halves,
    { bytesPerRow: width * 8, rowsPerImage: height },
    { width, height },
  )
  await save('pack-synthetic.rgba16f', await readTexture(device, synthetic))
  await save('pack-synthetic.p010le', await pack(synthetic))
  synthetic.destroy()
  decoded.texture.destroy()
  pass.destroy()
  backend.destroy()
  return { mode, file, index, width, height, frameBytes: pass.frameBytes }
}

/** Frames already in memory, posted to a real encode job: the upload and the encoder alone. */
async function measureUpload(): Promise<Record<string, unknown>> {
  const frames = numberParam('frames', 600)
  const width = numberParam('width', 3840)
  const height = numberParam('height', 2880)
  const frameBytes = preciseReadbackBytes('p010le', width, height)
  const bridge = (
    window as unknown as {
      dronecleanDesktop: {
        nativeMedia: {
          encodeStart(
            r: unknown,
          ): Promise<{ ok: boolean; value?: { frameBytes: number }; error?: unknown }>
        }
      }
    }
  ).dronecleanDesktop.nativeMedia
  const jobId = 'upload-leg'
  const answer = await bridge.encodeStart({
    jobId,
    path: required('out'),
    format: required('format'),
    readback: 'p010le',
    bitrate: 120_000_000,
    fps: rateOf(),
    tags: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
    width,
    height,
  })
  if (!answer.ok) throw new Error(`encode.start: ${JSON.stringify(answer.error)}`)
  // Mid-grey, neutral chroma: a valid picture, allocated once.
  const frame = new Uint8Array(frameBytes)
  new Uint16Array(frame.buffer).fill(512 << 6)
  let sent = 0
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent === frames) controller.close()
        else {
          sent += 1
          controller.enqueue(frame)
        }
      },
    },
    { highWaterMark: 0 },
  )
  const startedAt = performance.now()
  const response = await fetch(preciseReadbackUrl(jobId), {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/octet-stream' },
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  const reply = await response.text()
  const seconds = (performance.now() - startedAt) / 1000
  return {
    mode,
    frames,
    status: response.status,
    reply,
    framesPerSecond: Number((frames / seconds).toFixed(2)),
  }
}

const measurements: Record<string, () => Promise<Record<string, unknown>>> = {
  upload: measureUpload,
  fidelity: measureFidelity,
  export: measureExport,
  ramp: measureRamp,
  pack: measurePack,
}

async function main(): Promise<void> {
  const measure = measurements[mode]
  if (measure === undefined) throw new Error(`unknown mode ${mode}`)
  console.log(`HARNESS_REPORT ${JSON.stringify(await measure())}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  console.log(`HARNESS_REPORT ${JSON.stringify({ mode, error: message })}`)
})
