/**
 * The page of P4's measurements (task 3.1): the native decoder, end to end, in
 * Electron.
 *
 * Built by `vite.config.mjs`, served from `droneclean://app` by `main.mjs` with
 * the real preload and the real frame protocol. The modes, chosen by the query
 * string, are `clip` and `ramp` (the two numbers of the slice) plus two
 * diagnostics that say where a rate goes:
 *
 * - `mode=clip` (the design's open measurement, §8 risk 1): a section of clip 0020
 *   is decoded by FFmpeg at 3840×2880, streamed to this page, assembled and
 *   uploaded through P3's source pass, and the page reports frames per second
 *   from the first frame in to the last frame uploaded. A second number waits for
 *   the GPU to finish the submitted work, so "uploaded" is not only "submitted".
 * - `mode=ramp` (3.2's evidence): the benchmark kit's 877-level grey ramp is
 *   decoded the same way, and one row of P3's source texture is copied back
 *   exactly — a `textureLoad` pass into an `rgba32uint` target, the float bits
 *   intact — to count how many of the 877 code values survived, as levels of 1023.
 * - `mode=protocol`: one frame's URL read again and again with the decoder idle,
 *   which measures the stream and the assembly copy and nothing else.
 * - `mode=transport`: the `clip` path with a device that drops the upload, which
 *   measures everything but the GPU's share.
 *
 * The page prints one `HARNESS_REPORT {json}` console line; `main.mjs` adds the
 * machine's load average and prints it.
 */
import {
  preciseFrameBytes,
  precisePlaneLayout,
  type PreciseFrame,
} from '@/studio/render/precise/contract'
import { createSourcePass } from '@/studio/render/precise/source-pass'
import { preciseFrameUrl } from '@/studio/media/native-protocol'
import {
  nativeMediaBridge,
  readFrameBody,
  startNativeSource,
} from '@/studio/render/precise/native-source'

const params = new URLSearchParams(location.search)

/** A parameter the harness cannot run without. */
function required(name: string): string {
  const value = params.get(name)
  if (value === null || value === '') throw new Error(`the harness needs ?${name}=…`)
  return value
}

/** A number parameter, checked. */
function numberParam(name: string, fallback: number): number {
  const raw = params.get(name)
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`?${name}=${raw} is not a number`)
  return value
}

async function requestDevice(): Promise<{ device: GPUDevice; info: unknown }> {
  if (navigator.gpu === undefined) throw new Error('this Electron has no WebGPU')
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (adapter === null) throw new Error('no WebGPU adapter on this machine')
  const device = await adapter.requestDevice()
  const withInfo = adapter as GPUAdapter & { readonly info?: unknown }
  return { device, info: withInfo.info ?? null }
}

/**
 * The design's open measurement: frames per second of clip 0020 from FFmpeg's
 * decode through the `droneclean-frame:` stream to P3's texture.
 */
async function measureClip(device: GPUDevice): Promise<Record<string, unknown>> {
  const file = required('file')
  const startSeconds = numberParam('start', 60)
  const frames = numberParam('frames', 600)

  // The shell's per-frame progress, as 3.4's export bar will read it: it must
  // follow the decode from 1 to `frames`.
  const progress: number[] = []
  const stopProgress = nativeMediaBridge().onProgress((event) => progress.push(event.framesDone))
  const startedAt = performance.now()
  const source = await startNativeSource({
    device,
    file,
    startSeconds,
    frames,
  })
  const decodingAt = performance.now()
  let firstAt = 0
  let lastAt = 0
  let count = 0
  for await (const frame of source) {
    const now = performance.now()
    if (count === 0) firstAt = now
    count += 1
    lastAt = now
    void frame
  }
  await device.queue.onSubmittedWorkDone()
  const gpuDoneAt = performance.now()
  stopProgress()

  const steadySeconds = (lastAt - firstAt) / 1000
  const gpuSeconds = (gpuDoneAt - firstAt) / 1000
  return {
    mode: params.get('mode') === 'transport' ? 'transport' : 'clip',
    file,
    width: source.width,
    height: source.height,
    rate: source.reply.rate,
    colour: source.reply.colour,
    frameBytes: source.frameBytes,
    startSeconds,
    framesRequested: frames,
    framesReceived: count,
    progressMessages: progress.length,
    lastProgressFrame: progress.at(-1) ?? null,
    startMs: Number((decodingAt - startedAt).toFixed(1)),
    firstFrameAfterMs: Number((firstAt - startedAt).toFixed(1)),
    secondsToLastUpload: Number(steadySeconds.toFixed(3)),
    framesPerSecond: Number(((count - 1) / steadySeconds).toFixed(2)),
    framesPerSecondWithGpu: Number((count / gpuSeconds).toFixed(2)),
    throughputMBPerSecond: Number(
      ((count * source.frameBytes) / 1e6 / steadySeconds).toFixed(1),
    ),
  }
}

/** The readback of one row of an `rgba16float` texture: `textureLoad`, then its float bits. */
const READ_ROW_WGSL = /* wgsl */ `
struct Params {
  row: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
};

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4u {
  let pixel = vec2i(i32(position.x), i32(params.row));
  let sample = textureLoad(source, pixel, 0);
  // The bits, not a rounded value: the CPU turns them back into a float exactly.
  return vec4u(
    bitcast<u32>(sample.r),
    bitcast<u32>(sample.g),
    bitcast<u32>(sample.b),
    bitcast<u32>(sample.a),
  );
}
`

/** One row of the source texture, as 10-bit code values (the float times 1023, rounded). */
async function readRowCodes(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  row: number,
): Promise<{ codes: number[]; greyMismatches: number; alphaMismatches: number }> {
  const module = device.createShaderModule({ label: 'harness-read-row', code: READ_ROW_WGSL })
  const pipeline = device.createRenderPipeline({
    label: 'harness-read-row',
    layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba32uint' }] },
    primitive: { topology: 'triangle-list' },
  })
  const target = device.createTexture({
    label: 'harness-read-row-target',
    size: { width, height: 1 },
    format: 'rgba32uint',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })
  const readback = device.createBuffer({
    label: 'harness-read-row-buffer',
    size: width * 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const uniforms = device.createBuffer({
    label: 'harness-read-row-params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(uniforms, 0, new Uint32Array([row, 0, 0, 0]))
  const bindGroup = device.createBindGroup({
    label: 'harness-read-row',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: { buffer: uniforms } },
    ],
  })

  const encoder = device.createCommandEncoder({ label: 'harness-read-row' })
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target.createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(3)
  pass.end()
  // 3840 * 16 = 61440 bytes a row, a multiple of the 256 a copy needs.
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: width * 16, rowsPerImage: 1 },
    { width, height: 1 },
  )
  device.queue.submit([encoder.finish()])

  await readback.mapAsync(GPUMapMode.READ)
  const words = new Uint32Array(readback.getMappedRange().slice(0))
  readback.unmap()
  target.destroy()
  readback.destroy()
  uniforms.destroy()

  const floats = new Float32Array(1)
  const bits = new Uint32Array(floats.buffer)
  const codes: number[] = []
  let greyMismatches = 0
  let alphaMismatches = 0
  for (let x = 0; x < width; x += 1) {
    const code = (channel: number): number => {
      bits[0] = words[x * 4 + channel] ?? 0
      return Math.round(floats[0]! * 1023)
    }
    const r = code(0)
    const g = code(1)
    const b = code(2)
    if (r !== g || g !== b) greyMismatches += 1
    if (code(3) !== 1023) alphaMismatches += 1
    codes.push(r)
  }
  return { codes, greyMismatches, alphaMismatches }
}

/**
 * 3.2's evidence: how many of the ramp's 877 grey levels reach P3's source texture.
 * The benchmark kit's ramp holds 877 different luma values in every row from row 64
 * down; the source pass divides each by 1023 into a 16-bit float, which must give
 * them all back.
 */
async function measureRamp(device: GPUDevice): Promise<Record<string, unknown>> {
  const file = required('file')
  const row = numberParam('row', 1024)
  const frames = numberParam('frames', 10)
  const startedAt = performance.now()
  const source = await startNativeSource({
    device,
    file,
    startSeconds: 0,
    frames,
  })
  let last = null
  let count = 0
  for await (const frame of source) {
    last = frame
    count += 1
  }
  if (last === null) throw new Error('the ramp decoded no frames')
  const { codes, greyMismatches, alphaMismatches } = await readRowCodes(
    device,
    last.texture,
    source.width,
    row,
  )
  const levels = new Set(codes)
  const sorted = [...levels].sort((a, b) => a - b)
  return {
    mode: 'ramp',
    file,
    width: source.width,
    height: source.height,
    row,
    framesReceived: count,
    levelsInRow: levels.size,
    lowestLevel: sorted[0] ?? null,
    highestLevel: sorted.at(-1) ?? null,
    greyMismatches,
    alphaMismatches,
    firstCodes: codes.slice(0, 16),
    lastCodes: codes.slice(-16),
    levelsOfCodeMax: 1023,
    milliseconds: Number((performance.now() - startedAt).toFixed(1)),
  }
}

/**
 * A `GPUDevice` that accepts P3's pass and drops its upload: the transport and the
 * assembly with no GPU work at all, so the end-to-end number can be split into
 * "the stream carries this many frames" and "the upload costs the rest".
 */
function fakeDevice(): GPUDevice {
  const texture = (): unknown => ({
    createView: () => ({}),
    destroy: () => {},
  })
  // One mapping per buffer, kept for the run: the same memory every frame, so this
  // variant measures the stream without the GPU's own staging churn.
  const buffer = (size: number): unknown => {
    const mapping = new ArrayBuffer(size)
    return {
      size,
      mapAsync: async () => {},
      getMappedRange: () => mapping,
      unmap: () => {},
      destroy: () => {},
    }
  }
  const device = {
    createTexture: texture,
    createBuffer: (descriptor: { size: number }) => buffer(descriptor.size),
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
      copyBufferToTexture: () => {},
      finish: () => ({}),
    }),
    queue: { writeTexture: () => {}, submit: () => {}, onSubmittedWorkDone: async () => {} },
  }
  return device as unknown as GPUDevice
}

/**
 * The upload leg alone: one frame's bytes through P3's pass, over and over, with no
 * fetch and no decoder. What it measures is `writeTexture` and the conversion pass,
 * which is the page's own share of the end-to-end rate.
 */
async function measureUpload(device: GPUDevice): Promise<Record<string, unknown>> {
  const width = numberParam('width', 3840)
  const height = numberParam('height', 2880)
  const repeats = numberParam('repeats', 300)
  const frameBytes = preciseFrameBytes('gbrp10le', width, height)
  const bytes = new Uint8Array(frameBytes)
  // A ramp so the pass does real work and nothing can be constant-folded away.
  for (let index = 0; index < frameBytes; index += 2) bytes[index] = (index >> 1) & 1023
  const pass = createSourcePass(device, {
    width,
    height,
    colour: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
  })
  const variant = params.get('upload') ?? 'write'
  const started = performance.now()
  if (variant === 'write') {
    for (let index = 0; index < repeats; index += 1) {
      const frame: PreciseFrame = { index, rate: { num: 30, den: 1 }, durationFrames: 1 }
      pass.uploadFrame(bytes, frame)
    }
  } else {
    // The same three planes, but filled by one blit per plane from a buffer the
    // page writes into, instead of `writeTexture`'s per-row staging copy.
    const layout = precisePlaneLayout('gbrp10le', width, height)
    const planes = layout.map((plane) =>
      device.createTexture({
        size: { width: plane.width, height: plane.height },
        format: 'r16uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }),
    )
    const buffer = device.createBuffer({
      size: frameBytes,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
    })
    for (let index = 0; index < repeats; index += 1) {
      await buffer.mapAsync(GPUMapMode.WRITE)
      new Uint8Array(buffer.getMappedRange()).set(bytes)
      buffer.unmap()
      const encoder = device.createCommandEncoder()
      layout.forEach((plane, planeIndex) => {
        encoder.copyBufferToTexture(
          { buffer, offset: plane.offset, bytesPerRow: plane.stride, rowsPerImage: plane.height },
          { texture: planes[planeIndex] as GPUTexture },
          { width: plane.width, height: plane.height },
        )
      })
      device.queue.submit([encoder.finish()])
    }
  }
  const submittedAt = performance.now()
  await device.queue.onSubmittedWorkDone()
  const seconds = (submittedAt - started) / 1000
  pass.destroy()
  return {
    mode: 'upload',
    width,
    height,
    frameBytes,
    uploads: repeats,
    seconds: Number(seconds.toFixed(3)),
    uploadsPerSecond: Number((repeats / seconds).toFixed(2)),
    millisecondsPerUpload: Number(((seconds * 1000) / repeats).toFixed(2)),
    throughputMBPerSecond: Number(((repeats * frameBytes) / 1e6 / seconds).toFixed(1)),
    variant,
    note: 'one frame’s bytes into the three planes, no fetch, no decoder (the conversion pass only in the write variant)',
  }
}

/**
 * The transport alone: one decoded frame's URL, read again and again with the
 * decoder idle (the job decodes a single frame, which the ring keeps). What it
 * measures is the `droneclean-frame:` stream and the assembly copy — no FFmpeg
 * work and no GPU — so the end-to-end number can be attributed: the stream carries
 * this much, and the decode and the upload cost the rest.
 */
async function measureProtocol(): Promise<Record<string, unknown>> {
  const file = required('file')
  const repeats = numberParam('repeats', 200)
  const api = nativeMediaBridge()
  const jobId = `harness-${crypto.randomUUID()}`
  const answer = await api.startDecode({
    jobId,
    file,
    startSeconds: numberParam('start', 60),
    frames: 1,
    format: 'gbrp10le',
  })
  if (!answer.ok) throw new Error(answer.error.message)
  const reply = answer.value
  const bodyMode = params.get('body') ?? 'stream-reader'
  // `discard` reads the body without keeping it: the transfer alone, so the
  // assembly copy can be attributed.
  const sink = new Uint8Array(reply.frameBytes)
  let totalBytes = 0
  const started = performance.now()
  for (let index = 0; index < repeats; index += 1) {
    const response = await fetch(preciseFrameUrl({ jobId, frameIndex: 0 }))
    if (!response.ok) throw new Error(`frame 0: ${response.status} ${await response.text()}`)
    if (bodyMode === 'discard') {
      const reader = response.body?.getReader()
      if (reader === undefined || reader === null) throw new Error('no body')
      let filled = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        sink.set(value.subarray(0, 0), 0)
        filled += value.byteLength
      }
      reader.releaseLock()
      if (filled !== reply.frameBytes) throw new Error(`the frame is ${filled} bytes`)
      totalBytes += filled
      continue
    }
    const frame =
      bodyMode === 'arraybuffer'
        ? new Uint8Array(await response.arrayBuffer())
        : await readFrameBody(response, reply.frameBytes)
    if (frame.byteLength !== reply.frameBytes) throw new Error(`the frame is ${frame.byteLength} bytes`)
    totalBytes += frame.byteLength
  }
  const seconds = (performance.now() - started) / 1000
  api.cancel({ jobId })
  return {
    mode: 'protocol',
    file,
    width: reply.width,
    height: reply.height,
    frameBytes: reply.frameBytes,
    reads: repeats,
    seconds: Number(seconds.toFixed(3)),
    framesPerSecond: Number((repeats / seconds).toFixed(2)),
    throughputMBPerSecond: Number((totalBytes / 1e6 / seconds).toFixed(1)),
    body: bodyMode,
    note: 'one frame’s URL read again with the decoder idle: the stream and the read only',
  }
}

async function main(): Promise<void> {
  const mode = params.get('mode') ?? 'clip'
  const { device, info } = await requestDevice()
  const result =
    mode === 'ramp'
      ? await measureRamp(device)
      : mode === 'transport'
        ? {
            ...(await measureClip(fakeDevice())),
            mode: 'transport',
            note: 'the same page path with a device that drops the upload',
          }
        : mode === 'protocol'
          ? await measureProtocol()
          : mode === 'upload'
            ? await measureUpload(device)
            : await measureClip(device)
  console.log(`HARNESS_REPORT ${JSON.stringify({ adapter: info, ...result })}`)
}

main().catch((error: unknown) => {
  console.log(
    `HARNESS_REPORT ${JSON.stringify({
      mode: params.get('mode') ?? 'clip',
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
    })}`,
  )
})
