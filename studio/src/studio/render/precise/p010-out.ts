// The 10-bit export's way out (design 3.6 section 2.16, plan tasks 3.3 and 8.4, review finding R5): the renderer's
// `rgba16float` accumulator is packed on the GPU into `p010le` — the format VideoToolbox encodes from, 3 bytes a pixel —
// read back through a ring of mapped buffers, and streamed into the desktop shell's encoder (`POST
// droneclean-encode://encode/<jobId>`, `desktop/src/main/media/encode-stream.ts`).
//
// **The packing** is the exact inverse of the decode's conversion (`p010-in.ts`), so a frame that comes in and goes out
// untouched keeps its codes, and FFmpeg decoding the packed bytes gives back the accumulator:
//
//   Y' = Kr R + Kg G + Kb B (BT.709), luma code = 64 + Y' · 1023 · 219/255,
//   chroma codes = 512 + (B − Y') / (2 (1 − Kb)) · 1023 · 224/255 and the same with R and Kr,
//
// each rounded to the nearest code, held to 0..1023 and written in the top ten bits of a 16-bit word. A value above 1.0
// (super-white) becomes a code above nominal white instead of being clipped. The chroma of each 2x2 block is the mean of
// its four pixels, sited at the block's centre, where FFmpeg's `scale` reads it back.
//
// **The buffers**, all allocated when the stream opens and never again: one storage buffer the compute pass writes and
// `P010_READBACK_RING` (4) mapped-read buffers it is copied into. The POST body is the mapped memory itself, not a copy
// of it: a buffer is unmapped (and free for the next frame) only once the body has asked for the frame two after the one
// it carried. `deliver` records the pack and the copy and returns once a buffer was free: the renderer composes frame
// n + 1 while frame n is mapped and sent.
//
// **Where it runs.** On the page or in the export worker (8.3): it needs only the GPU device and `fetch` of the encode
// scheme. Starting the job (`encode.start`) is IPC, which only the page has: `startNativeEncode` does both on the page,
// and a worker opens the stream (`openNativeEncodeStream`) on a job the page started for it.

import { getDesktopBridge, type DesktopBridge } from '@/studio/desktop/bridge'
import {
  preciseReadbackUrl,
  type EncodeReply,
  type EncodeStartReply,
  type EncodeStartRequest,
} from '@/studio/media/native-protocol'
import {
  NativeEngineError,
  OUTPUT_COLOUR_TAGS,
  preciseReadbackBytes,
  type ColourTags,
  type NativeEngineErrorPayload,
  type PreciseExportFormatId,
  type PreciseFrame,
  type PreciseOutputSink,
  type Rate,
} from './contract'
import {
  P010_CHROMA_SCALE,
  P010_CHROMA_ZERO,
  P010_FULL_CODE,
  P010_LUMA_BLACK,
  P010_LUMA_SCALE,
} from './p010-in'

/**
 * The mapped-read buffers a frame is read back through and sent from. The body asks for frame n only once frame n − 1
 * was taken whole (a pull stream with no queue); a buffer is unmapped when frame n + 2 is asked for, one frame of
 * margin, so two are held by the body and two are free for the frames being rendered and mapped.
 */
export const P010_READBACK_RING = 4

/** Frames between sending a buffer's frame and unmapping it: the body has asked for this many frames since. */
const UNMAP_AFTER = 2

const KR = 0.2126
const KB = 0.0722
const KG = 1 - KR - KB

const f = (value: number): string => {
  const text = String(value)
  return /[.e]/.test(text) ? text : `${text}.0`
}

/** The codes of one pixel's RGB (the accumulator's values) on the CPU: the tests' reference for the shader. */
export function p010CodesReference(r: number, g: number, b: number): [number, number, number] {
  const y = KR * r + KG * g + KB * b
  const code = (value: number) => Math.min(1023, Math.max(0, Math.floor(value + 0.5)))
  const scale = P010_FULL_CODE / P010_CHROMA_SCALE
  return [
    code(P010_LUMA_BLACK + (y * P010_FULL_CODE) / P010_LUMA_SCALE),
    code(P010_CHROMA_ZERO + ((b - y) / (2 * (1 - KB))) * scale),
    code(P010_CHROMA_ZERO + ((r - y) / (2 * (1 - KR))) * scale),
  ]
}

/** The packing shader: one invocation per 2x2 block writes two luma words and one chroma word. */
export const P010_OUT_WGSL = /* wgsl */ `
override WIDTH: u32;
override HEIGHT: u32;

@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> packed: array<u32>;

const K = vec3f(${f(KR)}, ${f(KG)}, ${f(KB)});

fn code(value: f32) -> u32 {
  return u32(clamp(floor(value + 0.5), 0.0, 1023.0)) << 6u;
}

fn lumaCode(rgb: vec3f) -> u32 {
  return code(${f(P010_LUMA_BLACK)} + dot(rgb, K) * ${f(P010_FULL_CODE / P010_LUMA_SCALE)});
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let pairs = WIDTH / 2u;
  if (id.x >= pairs || id.y >= HEIGHT / 2u) {
    return;
  }
  let p = vec2i(id.xy * 2u);
  let a = textureLoad(picture, p, 0).rgb;
  let b = textureLoad(picture, p + vec2i(1, 0), 0).rgb;
  let c = textureLoad(picture, p + vec2i(0, 1), 0).rgb;
  let d = textureLoad(picture, p + vec2i(1, 1), 0).rgb;

  let top = id.y * 2u * pairs + id.x;
  packed[top] = lumaCode(a) | (lumaCode(b) << 16u);
  packed[top + pairs] = lumaCode(c) | (lumaCode(d) << 16u);

  let mean = (a + b + c + d) * 0.25;
  let y = dot(mean, K);
  let u = code(${f(P010_CHROMA_ZERO)} + (mean.b - y) * ${f(P010_FULL_CODE / P010_CHROMA_SCALE / (2 * (1 - KB)))});
  let v = code(${f(P010_CHROMA_ZERO)} + (mean.r - y) * ${f(P010_FULL_CODE / P010_CHROMA_SCALE / (2 * (1 - KR)))});
  packed[WIDTH * HEIGHT / 2u + id.y * pairs + id.x] = u | (v << 16u);
}
`

// The WebGPU flags, as the spec numbers them (the module loads where there is no GPU).
const BUFFER_MAP_READ = 0x0001
const BUFFER_COPY_SRC = 0x0004
const BUFFER_COPY_DST = 0x0008
const BUFFER_STORAGE = 0x0080
const SHADER_STAGE_COMPUTE = 0x4
const MAP_MODE_READ = 0x0001

/** The pack pass of one export size. */
export interface P010OutPass {
  /** The packed frame's bytes: `preciseReadbackBytes('p010le', width, height)`. */
  readonly frameBytes: number
  /** The storage buffer the pass writes (a copy source). */
  readonly buffer: GPUBuffer
  /** Records the pack of `picture` (`rgba16float`, the export's size) into `buffer`. */
  encode(encoder: GPUCommandEncoder, picture: GPUTexture): void
  destroy(): void
}

/** Creates the pack pass for an export of `width` x `height` (both even: 4:2:0 has whole chroma blocks). */
export function createP010OutPass(device: GPUDevice, width: number, height: number): P010OutPass {
  if (
    !Number.isInteger(width) ||
    width < 2 ||
    width % 2 !== 0 ||
    !Number.isInteger(height) ||
    height < 2 ||
    height % 2 !== 0
  ) {
    throw new Error(`p010 out: the size must be even, got ${width}x${height}`)
  }
  const frameBytes = preciseReadbackBytes('p010le', width, height)
  const buffer = device.createBuffer({
    label: 'p010-out-packed',
    size: frameBytes,
    usage: BUFFER_STORAGE | BUFFER_COPY_SRC,
  })
  const layout = device.createBindGroupLayout({
    label: 'p010-out-layout',
    entries: [
      {
        binding: 0,
        visibility: SHADER_STAGE_COMPUTE,
        texture: { sampleType: 'unfilterable-float' as const },
      },
      { binding: 1, visibility: SHADER_STAGE_COMPUTE, buffer: { type: 'storage' as const } },
    ],
  })
  const pipeline = device.createComputePipeline({
    label: 'p010-out',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ label: 'p010-out', code: P010_OUT_WGSL }),
      entryPoint: 'main',
      constants: { WIDTH: width, HEIGHT: height },
    },
  })
  /** One bind group per accumulator texture: the renderer reuses its textures, so this stays small. */
  const bindGroups = new WeakMap<GPUTexture, GPUBindGroup>()

  return {
    frameBytes,
    buffer,
    encode(encoder, picture) {
      if (picture.width !== width || picture.height !== height) {
        throw new Error(
          `p010 out: the picture is ${picture.width}x${picture.height}, the export ${width}x${height}`,
        )
      }
      let bindGroup = bindGroups.get(picture)
      if (bindGroup === undefined) {
        bindGroup = device.createBindGroup({
          label: 'p010-out-bindings',
          layout,
          entries: [
            { binding: 0, resource: picture.createView() },
            { binding: 1, resource: { buffer } },
          ],
        })
        bindGroups.set(picture, bindGroup)
      }
      const pass = encoder.beginComputePass({ label: 'p010-out' })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.dispatchWorkgroups(Math.ceil(width / 2 / 8), Math.ceil(height / 2 / 8))
      pass.end()
    },
    destroy() {
      buffer.destroy()
    },
  }
}

/** The encode member of the desktop preload (`desktop/src/shared/bridge.ts`), as the page reads it. */
export interface NativeEncodeBridge {
  encodeStart(
    request: EncodeStartRequest,
  ): Promise<
    | { readonly ok: true; readonly value: EncodeStartReply }
    | { readonly ok: false; readonly error: NativeEngineErrorPayload }
  >
  cancel(request: { readonly jobId: string }): void
}

/** The preload's encode member; an error outside the desktop shell. */
function nativeEncodeBridge(): NativeEncodeBridge {
  const bridge = getDesktopBridge() as
    | (DesktopBridge & { readonly nativeMedia?: NativeEncodeBridge })
    | undefined
  const nativeMedia = bridge?.nativeMedia
  if (nativeMedia === undefined) {
    throw new Error(
      'the native encoder needs the desktop app: window.dronecleanDesktop.nativeMedia',
    )
  }
  return nativeMedia
}

/** What an export's encode is: the file, the format, the rate and the picture size. */
export interface NativeEncodeOptions {
  /** The renderer's device: the accumulators are its textures. */
  readonly device: GPUDevice
  /** A path the user chose in a save dialog (the shell refuses any other). */
  readonly path: string
  readonly format: PreciseExportFormatId
  /** Bits per second. */
  readonly bitrate: number
  readonly fps: Rate
  readonly width: number
  readonly height: number
  /** The tags the file carries; BT.709 limited range by default. */
  readonly tags?: ColourTags
  readonly jobId?: string
  /** The shell's IPC; the preload's by default. */
  readonly bridge?: NativeEncodeBridge
}

/** What the stream counts, so a check can see that nothing is allocated per frame. */
export interface NativeEncodeCounters {
  readonly framesDelivered: number
  readonly framesSent: number
  /** GPU buffers and page buffers created since the stream opened: fixed when it opens. */
  readonly allocations: number
}

/** A running export's way out: deliver every frame in order, then `finish`. */
export interface NativeEncodeSink extends PreciseOutputSink {
  readonly jobId: string
  readonly counters: NativeEncodeCounters
  /** No more frames: waits for the last ones to be sent and for the encoder to write the file. */
  finish(): Promise<EncodeReply>
  /** Stops the encode; the shell removes the partial file. */
  cancel(): void
}

/** Starts an encode through the shell (`encode.start`) and opens its stream. Page only: it needs the IPC. */
export async function startNativeEncode(options: NativeEncodeOptions): Promise<NativeEncodeSink> {
  const bridge = options.bridge ?? nativeEncodeBridge()
  const jobId =
    options.jobId ??
    `encode-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  const answer = await bridge.encodeStart({
    jobId,
    path: options.path,
    format: options.format,
    readback: 'p010le',
    bitrate: options.bitrate,
    fps: options.fps,
    tags: options.tags ?? OUTPUT_COLOUR_TAGS,
    width: options.width,
    height: options.height,
  })
  if (!answer.ok) throw new NativeEngineError(answer.error)
  if (answer.value.readback !== 'p010le') {
    bridge.cancel({ jobId })
    throw new Error(
      `native encode: the shell takes ${answer.value.readback}, and the GPU packs p010le`,
    )
  }
  return openNativeEncodeStream({
    device: options.device,
    jobId,
    width: options.width,
    height: options.height,
    frameBytes: answer.value.frameBytes,
    cancel: () => bridge.cancel({ jobId }),
  })
}

/** What a stream on a started job needs; a worker gets these from the page. */
export interface NativeEncodeStreamOptions {
  readonly device: GPUDevice
  readonly jobId: string
  readonly width: number
  readonly height: number
  /** The shell's frame length (`EncodeStartReply.frameBytes`), checked against the packing. */
  readonly frameBytes: number
  /** Stops the job; the page's IPC, relayed in a worker. */
  readonly cancel?: () => void
  /** `fetch`, replaceable in a test. */
  readonly fetch?: typeof fetch
}

interface ReadbackBuffer {
  readonly buffer: GPUBuffer
  /** Resolves when the buffer is mapped with the frame recorded into it; null while the buffer is free. */
  mapped: Promise<void> | null
  /** The frame the body was handed from this buffer's mapped memory, until the buffer is unmapped. */
  sentFrame: number | null
}

/** Opens the POST stream of a started encode job and returns the sink the renderer delivers to. */
export function openNativeEncodeStream(options: NativeEncodeStreamOptions): NativeEncodeSink {
  const { device, jobId, width, height } = options
  const doFetch = options.fetch ?? fetch
  const pass = createP010OutPass(device, width, height)
  const { frameBytes } = pass
  if (options.frameBytes !== frameBytes) {
    pass.destroy()
    options.cancel?.()
    throw new Error(
      `native encode: the shell takes ${options.frameBytes}-byte frames, the packing makes ${frameBytes}`,
    )
  }
  let allocations = 1
  const ring: ReadbackBuffer[] = Array.from({ length: P010_READBACK_RING }, (_, index) => {
    allocations += 1
    return {
      buffer: device.createBuffer({
        label: `p010-out-readback-${index}`,
        size: frameBytes,
        usage: BUFFER_MAP_READ | BUFFER_COPY_DST,
      }),
      mapped: null,
      sentFrame: null,
    }
  })

  /** The read buffers holding frames not yet sent, in frame order. */
  const queued: ReadbackBuffer[] = []
  let nextRing = 0
  let delivered = 0
  let sent = 0
  let ended = false
  let failure: Error | null = null
  let wakeSender: (() => void) | null = null
  let wakeDeliver: (() => void) | null = null

  const fail = (error: unknown): Error => {
    failure ??= error instanceof Error ? error : new Error(String(error))
    wakeSender?.()
    wakeDeliver?.()
    return failure
  }

  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        for (;;) {
          if (failure !== null) throw failure
          // Frame `sent` is asked for: frame `sent - 1` was taken whole, and the ones before it surely are.
          for (const entry of ring) {
            if (entry.sentFrame === null || entry.sentFrame > sent - UNMAP_AFTER) continue
            entry.buffer.unmap()
            entry.sentFrame = null
            entry.mapped = null
            wakeDeliver?.()
          }
          const next = queued[0]
          if (next !== undefined) {
            await next.mapped
            queued.shift()
            next.sentFrame = sent
            sent += 1
            controller.enqueue(new Uint8Array(next.buffer.getMappedRange(), 0, frameBytes))
            return
          }
          if (ended) {
            controller.close()
            return
          }
          await new Promise<void>((resolve) => {
            wakeSender = resolve
          })
          wakeSender = null
        }
      },
      cancel(reason) {
        fail(new Error(`native encode: the readback stream was cancelled (${String(reason)})`))
      },
    },
    { highWaterMark: 0 },
  )

  const response = doFetch(preciseReadbackUrl(jobId), {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/octet-stream' },
    duplex: 'half',
  } as RequestInit & { duplex: 'half' }).then(
    async (answer) => {
      const text = await answer.text()
      if (!answer.ok) {
        let payload: NativeEngineErrorPayload
        try {
          payload = JSON.parse(text) as NativeEngineErrorPayload
        } catch {
          payload = {
            message: `encode ${jobId}: ${answer.status} ${text.trim()}`,
            command: [],
            exitCode: null,
            signal: null,
            log: [],
          }
        }
        throw fail(new NativeEngineError(payload))
      }
      return JSON.parse(text) as EncodeReply
    },
    (error: unknown) => {
      throw fail(error)
    },
  )
  // The rejection is `finish`'s to report; until then the next `deliver` sees `failure`.
  void response.catch(() => {})

  const destroy = (): void => {
    for (const entry of ring) entry.buffer.destroy()
    pass.destroy()
  }

  return {
    jobId,
    get counters() {
      return { framesDelivered: delivered, framesSent: sent, allocations }
    },

    async deliver(texture: GPUTexture, frame: PreciseFrame): Promise<void> {
      if (ended) throw new Error('native encode: a frame was delivered after finish')
      if (frame.index !== delivered) {
        throw new Error(
          `native encode: frame ${frame.index} was delivered where frame ${delivered} is next`,
        )
      }
      const target = ring[nextRing]!
      while (target.mapped !== null || target.sentFrame !== null) {
        if (failure !== null) throw failure
        await new Promise<void>((resolve) => {
          wakeDeliver = resolve
        })
        wakeDeliver = null
      }
      if (failure !== null) throw failure
      const encoder = device.createCommandEncoder({ label: 'p010-out' })
      pass.encode(encoder, texture)
      encoder.copyBufferToBuffer(pass.buffer, 0, target.buffer, 0, frameBytes)
      device.queue.submit([encoder.finish()])
      target.mapped = target.buffer.mapAsync(MAP_MODE_READ)
      queued.push(target)
      nextRing = (nextRing + 1) % P010_READBACK_RING
      delivered += 1
      wakeSender?.()
    },

    async finish(): Promise<EncodeReply> {
      ended = true
      wakeSender?.()
      try {
        return await response
      } finally {
        destroy()
      }
    },

    cancel() {
      if (ended && failure === null) return
      ended = true
      fail(new Error(`native encode ${jobId} was cancelled`))
      options.cancel?.()
      destroy()
    },
  }
}
