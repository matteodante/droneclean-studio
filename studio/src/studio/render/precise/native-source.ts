import { getDesktopBridge, type DesktopBridge } from '@/studio/desktop/bridge'
import {
  NATIVE_FRAME_READ_AHEAD,
  NATIVE_JOB_ID_PATTERN,
  preciseFrameUrl,
  type CancelRequest,
  type DecodeStartReply,
  type DecodeStartRequest,
  type NativeProgress,
} from '@/studio/media/native-protocol'
import { secondsToFrame } from '@/studio/time'
import {
  NativeEngineError,
  preciseFrameBytes,
  resolveSourceColourTags,
  type ColourTags,
  type NativeEngineCapabilities,
  type NativeEngineErrorPayload,
  type PreciseFrame,
  type PreciseInputFormat,
} from './contract'
import { createP010InPass, p010Supports } from './p010-in'
import {
  createSourcePass,
  preciseSourceTextureDescriptor,
  type PreciseSourceFrame,
} from './source-pass'

/**
 * The native decoder's page side (task 3.1, slice P4; design 3.6 section 2.16):
 * a source file decoded by the desktop shell's FFmpeg becomes, frame by frame,
 * an `rgba16float` source texture.
 *
 * **How a frame arrives.** `decode.start` (IPC, `native-protocol.ts`) asks the
 * shell for `frames` frames from `startSeconds` on, in `p010le` (the hardware
 * decoder's own planes, 3 bytes a pixel), and answers the source's size, exact
 * `rate`, colour, the format the frames really come in (`gbrp10le` for a source
 * `p010le` cannot carry) and the byte length of one frame. Each frame is then
 * one `GET` of `preciseFrameUrl`, read with a BYOB reader straight into one of a
 * few preallocated slots. Three frames are in flight at any time
 * (`NATIVE_FRAME_READ_AHEAD`, the shell's ring), and the GET for frame `k + 3`
 * goes out only once frame `k` is read whole: the shell reuses frame `k`'s
 * buffer on that signal.
 *
 * **What the caller gets.** `raw()` hands each frame's bytes over (valid until
 * the next frame is asked for), which the provider's native backend converts
 * straight into a texture of its own (`frames/backends/native.ts`). The async
 * iterator does the same into one texture of the source's own, overwritten by
 * the next frame: `p010-in.ts`'s pass for `p010le`, P3's `source-pass.ts` for
 * `gbrp10le`. Each frame's `PreciseFrame` carries the exact source index and the
 * source's rate.
 *
 * **Buffers.** A decode takes `NATIVE_SOURCE_PREFETCH + 1` slots for its whole
 * length (the frames in flight and the one handed over) from `options.slots`, a
 * pool a caller that opens many decodes shares, so a seek or a cut takes the
 * slots back instead of allocating new ones; a slot whose read was still in
 * flight when the decode stopped goes back only once that read has settled.
 */

/** The decoded frame format asked for: the GPU converts it (design 3.6 section 2.16, `p010-in.ts`). */
const NATIVE_SOURCE_FORMAT: PreciseInputFormat = 'p010le'

/** Frames kept in flight while the GPU works: the protocol's read-ahead (design §4.2, the shell's ring). */
export const NATIVE_SOURCE_PREFETCH = NATIVE_FRAME_READ_AHEAD

/**
 * One frame's bytes, allocated once and reused (design 3.6 section 2.4, slice 3). A frame is read into a slot with a
 * BYOB reader and uploaded straight from it. `bytes` is one byte longer than a frame so a body that is too long shows
 * itself as a byte that does not fit; a BYOB read hands its buffer over and gets it back, so the slot keeps the buffer
 * the reader returned.
 */
export interface FrameSlot {
  bytes: Uint8Array<ArrayBuffer>
}

/** A slot for frames of `frameBytes` bytes. */
export function createFrameSlot(frameBytes: number): FrameSlot {
  return { bytes: new Uint8Array(frameBytes + 1) }
}

/** Where a decode's slots come from and go back to. */
export interface FrameSlotPool {
  /** A slot for frames of `frameBytes` bytes: a kept one, or a new one. */
  take(frameBytes: number): FrameSlot
  /** A slot no read uses any more. */
  give(slot: FrameSlot): void
  /** How many slots the pool has allocated since it was made. */
  readonly allocated: number
}

/**
 * A pool that keeps up to `keep` slots of the last frame size given back (a size change drops the others): two
 * decodes' worth by default, the most a window runs at once.
 */
export function createFrameSlotPool(keep = 2 * (NATIVE_SOURCE_PREFETCH + 1)): FrameSlotPool {
  let kept: FrameSlot[] = []
  let keptBytes = -1
  let allocated = 0
  return {
    take(frameBytes) {
      if (frameBytes === keptBytes) {
        const slot = kept.pop()
        if (slot !== undefined) return slot
      }
      allocated += 1
      return createFrameSlot(frameBytes)
    },
    give(slot) {
      const frameBytes = slot.bytes.byteLength - 1
      if (frameBytes !== keptBytes) {
        kept = []
        keptBytes = frameBytes
      }
      if (kept.length < keep) kept.push(slot)
    },
    get allocated() {
      return allocated
    },
  }
}

/**
 * The native media member of the desktop preload (`studio/desktop/src/shared/bridge.ts`,
 * bridge v1 plus task 3.1's addition).
 *
 * The answer is an envelope rather than a rejection because Electron's `invoke`
 * carries only an `Error`'s message back from a failed handler, and the payload's
 * command and log are what a bug report needs. `startNativeSource` turns
 * `{ ok: false }` into the contract's `NativeEngineError` before its caller sees it.
 */
export interface NativeMediaBridge {
  startDecode(request: DecodeStartRequest): Promise<NativeMediaAnswer<DecodeStartReply>>
  capabilities(): Promise<NativeMediaAnswer<NativeEngineCapabilities>>
  cancel(request: CancelRequest): void
  onProgress(listener: (progress: NativeProgress) => void): () => void
}

/** What an `invoke` answers: the reply, or the failure as the contract's plain payload. */
export type NativeMediaAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: NativeEngineErrorPayload }

/**
 * The preload's native media API. The page's `DesktopBridge` is v1's three
 * members; the member P4 added is read here through the same bridge, so an
 * editor running in a web page or in a shell that predates it gets a clear error
 * instead of a decode that silently does nothing.
 */
export function nativeMediaBridge(): NativeMediaBridge {
  const bridge = getDesktopBridge() as
    | (DesktopBridge & { readonly nativeMedia?: NativeMediaBridge })
    | undefined
  const nativeMedia = bridge?.nativeMedia
  if (nativeMedia === undefined) {
    throw new Error('the native decoder needs the desktop app: window.dronecleanDesktop.nativeMedia')
  }
  return nativeMedia
}

/** What a decode is for: the source range, the item it draws, and the device to upload with. */
export interface NativeSourceOptions {
  /** The renderer's device: the iterator's pass creates its staging planes and texture on it. */
  readonly device: GPUDevice
  /** The source file's absolute path. */
  readonly file: string
  /** Where the first frame is, as a source time: `-ss` gets exactly this. */
  readonly startSeconds: number
  /** How many frames follow it. */
  readonly frames: number
  /**
   * The source index of the first decoded frame. Defaults to
   * `secondsToFrame(rate, startSeconds)` once the shell has reported the rate, so
   * a caller that passes `frameToSeconds(rate, n)` gets frame `n` back.
   */
  readonly startIndex?: number
  /** The job's id in its frame URLs; generated when absent. */
  readonly jobId?: string
  /** The format to ask for: `p010le` (the default) or `gbrp10le`; the reply says which arrives. */
  readonly format?: 'p010le' | 'gbrp10le'
  /** The slots' pool; a pool of this decode's own when absent. */
  readonly slots?: FrameSlotPool
  /** The shell's decode IPC; the preload's by default (a worker gets the page's, relayed). */
  readonly bridge?: Pick<NativeMediaBridge, 'startDecode' | 'cancel'>
}

/** One decoded frame's bytes, as the shell sent them. */
export interface NativeRawFrame {
  /** The frame in `NativeSource.format`, packed; valid until the next frame is asked for. */
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly frame: PreciseFrame
}

/** A running decode, as the page drives it. */
export interface NativeSource extends AsyncIterable<PreciseSourceFrame> {
  /** The id every frame URL of this decode carries. */
  readonly jobId: string
  /** What the shell reported: size, exact rate, colour, format and the length of one frame. */
  readonly reply: DecodeStartReply
  readonly width: number
  readonly height: number
  /** The format the frames arrive in. */
  readonly format: PreciseInputFormat
  readonly frameBytes: number
  /** The colour to convert with: the reply's, with the contract's BT.709 default filled in. */
  readonly colour: ColourTags
  /** The frames' bytes, one after another; the decode is cancelled when the iteration ends. Call it once. */
  raw(): AsyncIterator<NativeRawFrame>
  /** Stops the decode: the shell kills FFmpeg and frees the frames. Idempotent. */
  cancel(): void
  /** Releases the iterator's pass and its texture. Call it once the frames are no longer drawn. */
  destroy(): void
}

/**
 * Starts a decode and returns its frames. Rejects with the contract's
 * `NativeEngineError` when the shell has no FFmpeg, cannot probe the file, or
 * reports a frame length that disagrees with the contract's layout — a frame the
 * page would otherwise upload shifted.
 */
export async function startNativeSource(options: NativeSourceOptions): Promise<NativeSource> {
  const api = options.bridge ?? nativeMediaBridge()
  const jobId = options.jobId ?? generatedJobId()
  if (!NATIVE_JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`native source: not a job id: ${JSON.stringify(jobId)}`)
  }
  if (!Number.isSafeInteger(options.frames) || options.frames < 1) {
    throw new Error(`native source: the frame count must be a positive integer, got ${options.frames}`)
  }

  const requested = options.format ?? NATIVE_SOURCE_FORMAT
  const answer = await api.startDecode({
    jobId,
    file: options.file,
    startSeconds: options.startSeconds,
    frames: options.frames,
    format: requested,
  })
  if (!answer.ok) throw new NativeEngineError(answer.error)
  const reply = answer.value
  const format = reply.format
  const colour = resolveSourceColourTags(reply.colour)

  const refuse = (message: string): never => {
    api.cancel({ jobId })
    throw new Error(`native source: ${message}`)
  }
  if (format !== requested && format !== 'gbrp10le') {
    refuse(`asked for ${requested} frames, the shell answers ${format}`)
  }
  if (format === 'p010le' && !p010Supports(colour)) {
    refuse(`the shell sends p010le for a ${colour.matrix} ${colour.range}-range source the GPU does not convert`)
  }
  const frameBytes = preciseFrameBytes(format, reply.width, reply.height)
  if (reply.frameBytes !== frameBytes) {
    refuse(
      `the shell reports ${reply.frameBytes}-byte frames, ` +
        `the contract ${frameBytes} for ${reply.width}x${reply.height} ${format}`,
    )
  }

  const startIndex = options.startIndex ?? secondsToFrame(reply.rate, options.startSeconds)
  const pool = options.slots ?? createFrameSlotPool(NATIVE_SOURCE_PREFETCH + 1)
  let cancelled = false
  let rawStarted = false

  const cancel = (): void => {
    if (cancelled) return
    cancelled = true
    api.cancel({ jobId })
  }

  async function* rawFrames(): AsyncGenerator<NativeRawFrame, void, undefined> {
    // The prefetch is this array: `NATIVE_SOURCE_PREFETCH` GETs are in flight, in
    // frame order, and the next is issued once a frame is read whole (the
    // protocol's read-ahead rule), so the window never shrinks.
    const inFlight: Array<{ slot: FrameSlot; pending: Promise<Uint8Array<ArrayBuffer>> }> = []
    const handedOver: FrameSlot[] = []
    let issued = 0
    const issue = (): void => {
      if (issued >= options.frames || cancelled) return
      const slot = pool.take(frameBytes)
      const pending = readFrame(jobId, issued, frameBytes, slot)
      issued += 1
      inFlight.push({ slot, pending })
      // A frame that fails before its turn is awaited is this promise's business:
      // without a handler the failure would be reported as unhandled first.
      void pending.catch(() => {})
    }

    try {
      for (let ahead = 0; ahead < NATIVE_SOURCE_PREFETCH; ahead += 1) issue()
      for (let index = 0; index < options.frames; index += 1) {
        const next = inFlight.shift()
        if (next === undefined) break
        const bytes = await next.pending
        // Frame `index` is read whole: the GET for `index + PREFETCH` may go.
        issue()
        handedOver.push(next.slot)
        yield { bytes, frame: { index: startIndex + index, rate: reply.rate, durationFrames: 1 } }
        // The caller asked for the next frame: the bytes it was handed are free.
        const done = handedOver.shift()
        if (done !== undefined) pool.give(done)
      }
    } finally {
      cancel()
      for (const slot of handedOver) pool.give(slot)
      // A read still in flight writes into its slot until it settles; the cancel makes it settle soon.
      const pending = inFlight.splice(0)
      void Promise.allSettled(pending.map((entry) => entry.pending)).then(() => {
        for (const entry of pending) pool.give(entry.slot)
      })
    }
  }

  /** The iterator's conversion into one texture of the source's own; built on its first frame. */
  interface IteratorPass {
    upload(bytes: Uint8Array, frame: PreciseFrame): PreciseSourceFrame
    destroy(): void
  }
  let pass: IteratorPass | null = null
  const iteratorPass = (): IteratorPass => {
    if (pass !== null) return pass
    const { width, height } = reply
    if (format === 'p010le') {
      const p010 = createP010InPass(options.device, { width, height, colour })
      const texture = options.device.createTexture(preciseSourceTextureDescriptor(width, height))
      const view = texture.createView()
      pass = {
        upload(bytes, frame) {
          p010.convert(bytes, texture)
          return { texture, view, width, height, frame, colour }
        },
        destroy() {
          p010.destroy()
          texture.destroy()
        },
      }
    } else {
      const source = createSourcePass(options.device, { width, height, colour })
      pass = { upload: (bytes, frame) => source.uploadFrame(bytes, frame), destroy: () => source.destroy() }
    }
    return pass
  }

  const takeRaw = (): AsyncGenerator<NativeRawFrame, void, undefined> => {
    if (rawStarted) throw new Error('native source: the frames of a decode can be read once')
    rawStarted = true
    return rawFrames()
  }

  return {
    jobId,
    reply,
    width: reply.width,
    height: reply.height,
    format,
    frameBytes,
    colour,
    raw: takeRaw,
    cancel,
    destroy() {
      cancel()
      pass?.destroy()
      pass = null
    },
    async *[Symbol.asyncIterator]() {
      const frames = takeRaw()
      try {
        for (;;) {
          const step = await frames.next()
          if (step.done === true) return
          yield iteratorPass().upload(step.value.bytes, step.value.frame)
        }
      } finally {
        await frames.return(undefined)
      }
    },
  }
}

/** A job id for a decode nobody named: `decode-` and a UUID, which the contract's pattern accepts. */
function generatedJobId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return `decode-${random ?? Math.random().toString(36).slice(2)}`
}

/** One frame's `GET`, as the contract's URL and statuses describe it. */
async function readFrame(
  jobId: string,
  frameIndex: number,
  sizeBytes: number,
  slot: FrameSlot,
): Promise<Uint8Array<ArrayBuffer>> {
  const url = preciseFrameUrl({ jobId, frameIndex })
  const response = await fetch(url)
  if (!response.ok) {
    const reason = (await response.text()).trim()
    throw new NativeEngineError({
      message: `decode ${jobId}, frame ${frameIndex}: ${response.status}${reason === '' ? '' : ` ${reason}`}`,
      command: [],
      exitCode: null,
      signal: null,
      log: [],
    })
  }
  return readFrameBody(response, sizeBytes, slot)
}

/**
 * Assembles one frame from a response's chunks: exactly `expectedBytes` of them,
 * in the contract's packed layout, with no header to skip. A body of any other
 * length is refused here rather than uploaded shifted — the one check that makes
 * a wrong ring size or a truncated read visible.
 *
 * With a `slot` the frame is read into the slot's buffer with a BYOB reader and
 * the result is a view of it: no buffer is allocated for the frame. Without one,
 * a fresh buffer is allocated (the shape the tests and the harness use).
 */
export async function readFrameBody(
  response: Response,
  expectedBytes: number,
  slot?: FrameSlot,
): Promise<Uint8Array<ArrayBuffer>> {
  const body = response.body
  if (body === null) throw new Error(`native source: a ${expectedBytes}-byte frame had no body`)
  if (slot !== undefined) {
    if (slot.bytes.byteLength < expectedBytes + 1) {
      throw new Error(`native source: a slot of ${slot.bytes.byteLength} bytes cannot hold a ${expectedBytes}-byte frame`)
    }
    const byob = tryByobReader(body)
    if (byob !== undefined) return readIntoSlot(byob, expectedBytes, slot)
  }
  const reader = body.getReader()
  const bytes = slot?.bytes ?? new Uint8Array(expectedBytes)
  let filled = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (filled + value.byteLength > expectedBytes) {
        throw new Error(
          `native source: the frame is longer than the ${expectedBytes} bytes the contract fixes`,
        )
      }
      bytes.set(value, filled)
      filled += value.byteLength
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  if (filled !== expectedBytes) {
    throw new Error(`native source: the frame is ${filled} of the ${expectedBytes} bytes it must be`)
  }
  return slot === undefined ? bytes : bytes.subarray(0, expectedBytes)
}

/** A BYOB reader on the body, or undefined when the stream is not a byte stream (the reader throws a TypeError). */
function tryByobReader(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
): ReadableStreamBYOBReader | undefined {
  try {
    return body.getReader({ mode: 'byob' })
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}

/**
 * Reads the body into the slot's buffer. Each `read` transfers the buffer to the stream and gets it back in the
 * result, so the slot's `bytes` is replaced by the view the reader returns; one byte more than a frame is asked for,
 * and a body that fills it is too long.
 */
async function readIntoSlot(
  reader: ReadableStreamBYOBReader,
  expectedBytes: number,
  slot: FrameSlot,
): Promise<Uint8Array<ArrayBuffer>> {
  const capacity = expectedBytes + 1
  let buffer = slot.bytes.buffer
  let filled = 0
  try {
    while (filled < capacity) {
      const { done, value } = await reader.read(new Uint8Array(buffer, filled, capacity - filled))
      if (value !== undefined) {
        buffer = value.buffer as ArrayBuffer
        filled += value.byteLength
      }
      if (done) break
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
    slot.bytes = new Uint8Array(buffer, 0, capacity)
  }
  if (filled > expectedBytes) {
    throw new Error(
      `native source: the frame is longer than the ${expectedBytes} bytes the contract fixes`,
    )
  }
  if (filled !== expectedBytes) {
    throw new Error(`native source: the frame is ${filled} of the ${expectedBytes} bytes it must be`)
  }
  return slot.bytes.subarray(0, expectedBytes)
}
