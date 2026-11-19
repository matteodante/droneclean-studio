/**
 * The decode stream of the native media engine (task 3.1, slice P4): the ring of
 * decoded frames and the FFmpeg process that fills it.
 *
 * **What it is for.** Design §4.2: FFmpeg writes raw frames (`p010le`, or
 * `gbrp10le` for a source `p010le` cannot carry) to its stdout, the shell holds a
 * few of them, and the page reads them one HTTP response at a time
 * (`GET droneclean-frame://decode/<jobId>/<frameIndex>`). A frame is
 * `preciseInputFrameBytes(format, width, height)` bytes with no framing header,
 * so the ring never guesses where a frame ends: it cuts the pipe every
 * `frameBytes` bytes.
 *
 * **The ring.** `ringSize` frames (three by default, the design's prefetch). A
 * frame is *unsettled* until its GET has been answered; the pump waits before
 * adding a fourth unsettled frame, which stops reading the pipe, which fills
 * FFmpeg's write buffer, which blocks FFmpeg: that is the backpressure of design
 * §4.1, with no threads and no timer. A settled frame stays readable until the
 * window slides past it — that is what makes a `Range` resume of a broken read
 * possible — and is then dropped: a GET for it answers 410, exactly the frame the
 * page read too slowly.
 *
 * **The buffers** (design 3.6 section 2.16, review finding R5). A decode
 * allocates `decodeSlotCount(ringSize)` frame buffers, once, as it first needs
 * them, and never another: the ring's frames, the frames the page may still be
 * reading after the window slid past them, and the one the pipe is filling. A
 * frame's buffer is reused only once the page has read it whole, which the
 * page's read-ahead rule says (`FRAME_READ_AHEAD`: a GET for frame
 * `k + 3` means frame `k` arrived), so a response never streams from a buffer
 * the pipe is writing again. The response body is a stream over the buffer
 * (`frameBody`), not the buffer itself, because a `Response` built from bytes
 * copies them: that copy was a frame-sized allocation per GET.
 *
 * **The answers.** `take` resolves with a frame, or with a refusal the handler
 * turns into a status: an unknown job is 404; a frame past the end of the
 * requested count, a cancelled job, a crashed decoder and a dropped frame are all
 * 410 with a sentence that says which. A crashed decoder's 410 carries the last
 * lines FFmpeg logged (`NativeEngineFailure.log`), so a bad file is diagnosable
 * from the page.
 *
 * **What is *not* here.** Choosing the binary and the command line
 * (`ffmpeg.ts`), and the Electron protocol and IPC (`frame-protocol.ts`). The
 * process is injected (`SpawnDecode`) so `desktop/test/decode-stream.test.mjs`
 * drives a fake FFmpeg and asserts the ring's behaviour without decoding
 * anything.
 */
import { NativeEngineFailure, type DecodeStartReply } from '../../shared/native-media'

/** The frames of the ring a decode holds before it stops FFmpeg (design §4.1: 3 in). */
export const DEFAULT_DECODE_RING_SIZE = 3

/**
 * The page's read-ahead rule (`NATIVE_FRAME_READ_AHEAD` in `native-protocol.ts`): at
 * most this many frame GETs of a decode in flight, and the GET for frame `k + 3`
 * only once frame `k` was read whole. `native-wire.test.ts` holds the two equal
 * through `decodeSlotCount`.
 */
const FRAME_READ_AHEAD = 3

/**
 * The frame buffers a decode allocates, at most and once: the ring's `ringSize`,
 * the `FRAME_READ_AHEAD` frames the page may still be reading after the
 * window slid past them, and the one the pipe is filling. With fewer the pump
 * would wait for a buffer before the page asked for the next frame.
 */
export function decodeSlotCount(ringSize: number): number {
  return ringSize + FRAME_READ_AHEAD + 1
}

/**
 * The body of a frame's response: the frame's buffer, handed over as one chunk
 * and not copied. (`new Response(bytes)` copies the bytes, as the Fetch standard
 * says it must; a stream does not.) The buffer is the decode's and stays
 * untouched until the page has read the frame whole (see `DecodeJob`).
 */
export function frameBody(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  let sent = false
  return new ReadableStream<Uint8Array<ArrayBuffer>>(
    {
      pull(controller) {
        if (sent) {
          controller.close()
          return
        }
        sent = true
        controller.enqueue(bytes)
      },
    },
    { highWaterMark: 0 },
  )
}

/**
 * How many cancelled job ids the shell remembers. A cancelled job's frames must
 * answer 410, not 404 (the contract's `CancelRequest`), and a window cancels its
 * last decode or two before it reloads; sixteen is far more than that and still
 * bounds what a long session keeps.
 */
export const MAX_REMEMBERED_CANCELLED_JOBS = 16

/** How an FFmpeg process ended: its exit code, or the signal that killed it. */
export interface DecodeExit {
  readonly code: number | null
  readonly signal: string | null
}

/** What a decode job needs from its process; `ffmpeg.ts` provides the real one. */
export interface DecodeProcess {
  /** The whole command line, for a failure report: the binary first. */
  readonly command: readonly string[]
  /** The frames, as the pipe delivers them: arbitrary chunk boundaries, bare `rawvideo`. */
  readonly stdout: AsyncIterable<Uint8Array>
  /** Resolves once the process is gone and its pipes are closed. */
  readonly exited: Promise<DecodeExit>
  /** Stops it now (SIGKILL) and drops what it wrote. */
  kill(): void
  /** The last lines it logged, for a 410's body. */
  stderrTail(): readonly string[]
}

/** Starts a decode process; the seam a test replaces with a fake FFmpeg. */
export type SpawnDecode = (input: {
  readonly ffmpeg: string
  readonly args: readonly string[]
}) => DecodeProcess

/** What a frame's GET can be answered with, before the handler adds a status. */
export type FrameAnswer =
  | { readonly kind: 'frame'; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'unknown-job' }
  | { readonly kind: 'gone'; readonly reason: string }

/** One decode to start: the job's identity, the source's geometry and the process to run. */
export interface DecodeStart {
  readonly jobId: string
  /** How many frames the job decodes, from index 0: a GET for `frames` or more is 410. */
  readonly frames: number
  /** The fixed byte length of one frame. */
  readonly frameBytes: number
  readonly ffmpeg: string
  readonly args: readonly string[]
  /** What `decode.start` answers with (the probe's size, rate and colour). */
  readonly reply: DecodeStartReply
  /** Called once per decoded frame, with how many have been produced. */
  readonly onFrame?: (framesDone: number) => void
}

interface HeldFrame {
  /** One of the decode's frame buffers (see `DecodeJob`), sent without a copy. */
  readonly bytes: Uint8Array<ArrayBuffer>
  settled: boolean
}

type JobState = 'running' | 'ended' | 'cancelled' | 'failed'

/** One decode, its ring and its process. */
class DecodeJob {
  private readonly start: DecodeStart
  private readonly ringSize: number
  private readonly process: DecodeProcess
  private readonly held = new Map<number, HeldFrame>()
  /** Frames the window slid past whose buffer the page may still be reading, by index. */
  private readonly draining = new Map<number, Uint8Array<ArrayBuffer>>()
  /** Frame buffers no frame uses, ready for the pump. */
  private readonly free: Array<Uint8Array<ArrayBuffer>> = []
  private readonly maxSlots: number
  /** How many frame buffers this decode allocated: at most `maxSlots`, ever. */
  allocatedSlots = 0
  private slotWaiters: Array<() => void> = []
  /** Every frame below this index has been read whole by the page (its read-ahead rule). */
  private readThrough = 0
  private readonly waiters = new Map<number, Array<(answer: FrameAnswer) => void>>()
  private roomWaiters: Array<() => void> = []
  /** The index of the next frame to arrive; frames below `next` have been cut from the pipe. */
  private next = 0
  private state: JobState = 'running'
  private failure = ''
  /** The bytes of a frame the pipe ended in the middle of; always zero unless FFmpeg died. */
  private partialFrameBytes = 0

  constructor(start: DecodeStart, spawn: SpawnDecode, ringSize: number) {
    this.start = start
    this.ringSize = ringSize
    this.maxSlots = decodeSlotCount(ringSize)
    this.process = spawn({ ffmpeg: start.ffmpeg, args: start.args })
  }

  /** Spawns the process (done in the constructor) and starts reading it. */
  begin(): void {
    void this.pump()
  }

  /**
   * Answers a frame's GET: its bytes when the ring has them (or has them before
   * the page could need them again), a refusal with the reason when it never
   * will. A frame that is only late is awaited, not refused: the page's prefetch
   * asks for frames the decoder has not reached yet.
   */
  async take(index: number): Promise<FrameAnswer> {
    if (index < this.start.frames) this.noteAsked(index)
    const frame = this.held.get(index)
    if (frame !== undefined) return { kind: 'frame', bytes: frame.bytes }
    if (index >= this.start.frames) {
      return {
        kind: 'gone',
        reason: `frame ${index} is past the ${this.start.frames} this job decodes`,
      }
    }
    switch (this.state) {
      case 'cancelled':
        return { kind: 'gone', reason: `decode ${this.start.jobId} was cancelled` }
      case 'failed':
        return { kind: 'gone', reason: this.failure }
      case 'ended':
        return { kind: 'gone', reason: this.endedReason() }
      case 'running':
        break
    }
    if (index < this.next - this.ringSize) {
      return {
        kind: 'gone',
        reason:
          `frame ${index} was dropped: the ring holds the last ${this.ringSize} frames ` +
          'and the reader fell behind the decoder',
      }
    }
    return new Promise<FrameAnswer>((resolve) => {
      const waiting = this.waiters.get(index) ?? []
      waiting.push(resolve)
      this.waiters.set(index, waiting)
    })
  }

  /** The handler built this frame's response; the frame no longer holds a place in the ring. */
  settle(index: number): void {
    const frame = this.held.get(index)
    if (frame === undefined) return
    frame.settled = true
    this.releaseRoom()
  }

  /**
   * Kills the process, drops the frames and answers every waiting GET with 410.
   * The buffers are left to the collector, never reused: a response may still be
   * streaming from one.
   */
  cancel(): void {
    if (this.state === 'cancelled') return
    this.state = 'cancelled'
    this.held.clear()
    this.draining.clear()
    this.free.length = 0
    this.process.kill()
    this.releaseRoom()
    this.wakeSlotWaiters()
    this.answerWaiters()
  }

  /**
   * Cuts the pipe into frames, each into one of the decode's buffers. The pump is
   * the only writer, so a frame's bytes are complete when it is added to the
   * ring, and its buffer is written again only after the page read it whole.
   */
  private async pump(): Promise<void> {
    const frameBytes = this.start.frameBytes
    let buffer = await this.takeSlot()
    let fill = 0
    try {
      for await (const chunk of this.process.stdout) {
        let offset = 0
        while (offset < chunk.byteLength) {
          if (buffer === null) return
          const take = Math.min(frameBytes - fill, chunk.byteLength - offset)
          buffer.set(chunk.subarray(offset, offset + take), fill)
          fill += take
          offset += take
          if (fill === frameBytes) {
            const frame = buffer
            fill = 0
            if (!(await this.hold(frame))) return
            buffer = await this.takeSlot()
          }
        }
      }
    } catch {
      // The pipe ended under the loop (a killed process destroys it); `end` reads
      // the exit code and decides what the job tells the page.
    }
    this.partialFrameBytes = fill
    await this.end()
  }

  /** Adds one decoded frame to the ring, waiting while all `ringSize` of its places are unsettled. */
  private async hold(bytes: Uint8Array<ArrayBuffer>): Promise<boolean> {
    while (this.state === 'running' && this.unsettledFrames() >= this.ringSize) {
      await new Promise<void>((resolve) => this.roomWaiters.push(resolve))
    }
    if (this.state !== 'running') return false

    const index = this.next
    this.next += 1
    this.held.set(index, { bytes, settled: false })
    // The place of `index - ringSize` is now taken: a GET for it is a dropped frame.
    const leaving = this.held.get(index - this.ringSize)
    if (leaving !== undefined) {
      this.held.delete(index - this.ringSize)
      this.retire(index - this.ringSize, leaving.bytes)
    }
    this.start.onFrame?.(this.next)
    this.answerWaiters(index)
    return true
  }

  /** A free frame buffer, a new one while fewer than `maxSlots` exist, or null once the job stopped. */
  private async takeSlot(): Promise<Uint8Array<ArrayBuffer> | null> {
    for (;;) {
      if (this.state !== 'running') return null
      const slot = this.free.pop()
      if (slot !== undefined) return slot
      if (this.allocatedSlots < this.maxSlots) {
        this.allocatedSlots += 1
        return new Uint8Array(this.start.frameBytes)
      }
      await new Promise<void>((resolve) => this.slotWaiters.push(resolve))
    }
  }

  /** A frame left the window: its buffer is free once the page has read it, and waits until then. */
  private retire(index: number, bytes: Uint8Array<ArrayBuffer>): void {
    if (index < this.readThrough) this.release(bytes)
    else this.draining.set(index, bytes)
  }

  /** A GET for `index` arrived: by the read-ahead rule, every frame up to `index - READ_AHEAD` was read whole. */
  private noteAsked(index: number): void {
    const readThrough = index - FRAME_READ_AHEAD + 1
    if (readThrough <= this.readThrough) return
    this.readThrough = readThrough
    for (const [drained, bytes] of this.draining) {
      if (drained >= readThrough) continue
      this.draining.delete(drained)
      this.release(bytes)
    }
  }

  private release(bytes: Uint8Array<ArrayBuffer>): void {
    if (this.state === 'cancelled') return
    this.free.push(bytes)
    this.wakeSlotWaiters()
  }

  private wakeSlotWaiters(): void {
    const waiting = this.slotWaiters
    this.slotWaiters = []
    for (const resolve of waiting) resolve()
  }

  /** The end of the pipe: the job reports a crash, or that the source ran out of frames. */
  private async end(): Promise<void> {
    const exit = await this.process.exited
    if (this.state !== 'running') return
    if (exit.code !== 0 || exit.signal !== null) {
      this.fail(
        new NativeEngineFailure({
          message:
            `the decoder stopped after ${this.next} of ${this.start.frames} frames ` +
            `(${exit.signal !== null ? `signal ${exit.signal}` : exit.code === null ? 'it never started' : `exit code ${exit.code}`})`,
          command: this.process.command,
          exitCode: exit.code,
          signal: exit.signal,
          log: this.process.stderrTail(),
        }),
      )
      return
    }
    if (this.partialFrameBytes > 0) {
      this.fail(
        new NativeEngineFailure({
          message:
            `the decoder stopped in the middle of frame ${this.next}: ` +
            `${this.partialFrameBytes} of ${this.start.frameBytes} bytes`,
          command: this.process.command,
          exitCode: exit.code,
          signal: exit.signal,
          log: this.process.stderrTail(),
        }),
      )
      return
    }
    this.state = 'ended'
    this.answerWaiters()
  }

  private fail(failure: NativeEngineFailure): void {
    if (this.state === 'cancelled') return
    this.state = 'failed'
    const log = failure.log.length === 0 ? '' : `\n${failure.log.join('\n')}`
    this.failure = `${failure.message}${log}`
    this.answerWaiters()
  }

  private endedReason(): string {
    return `the source ended after ${this.next} of the ${this.start.frames} frames this job asked for`
  }

  private unsettledFrames(): number {
    let count = 0
    for (const frame of this.held.values()) if (!frame.settled) count += 1
    return count
  }

  private releaseRoom(): void {
    if (this.unsettledFrames() >= this.ringSize) return
    const waiting = this.roomWaiters
    this.roomWaiters = []
    for (const resolve of waiting) resolve()
  }

  /** Answers the waiters of `index` (all of them) with the frame that arrived, if it did. */
  private answerWaiters(index?: number): void {
    for (const [wanted, waiting] of this.waiters) {
      if (index !== undefined && wanted !== index) continue
      const frame = this.held.get(wanted)
      const answer: FrameAnswer =
        frame === undefined ? { kind: 'gone', reason: this.refusalReason(wanted) } : { kind: 'frame', bytes: frame.bytes }
      this.waiters.delete(wanted)
      for (const resolve of waiting) resolve(answer)
    }
  }

  /** Why a frame that is not in the ring will never be: the job's state says which. */
  private refusalReason(index: number): string {
    switch (this.state) {
      case 'cancelled':
        return `decode ${this.start.jobId} was cancelled`
      case 'failed':
        return this.failure
      case 'ended':
        return index >= this.next ? this.endedReason() : `frame ${index} was dropped from the ring`
      case 'running':
        return `frame ${index} is not in the ring`
    }
  }
}

/**
 * The shell's decode jobs, by job id: `frame-protocol.ts` starts one per
 * `decode.start` and answers the frame URLs from here.
 *
 * A job stays in the map after it ends, so a late GET is still a 410 that says
 * why rather than a 404; the page's `cancel` (or its window closing) releases it.
 * A cancelled job's id is remembered for a while (`MAX_REMEMBERED_CANCELLED_JOBS`)
 * so its frames are the contract's 410 and not a 404 — nothing of the job itself
 * survives the cancel.
 */
export class DecodeJobs {
  private readonly jobs = new Map<string, DecodeJob>()
  /** The ids of recently cancelled jobs, oldest first: their frames answer 410, not 404. */
  private readonly cancelled = new Set<string>()
  private readonly spawn: SpawnDecode
  private readonly ringSize: number

  constructor(options: { readonly spawn: SpawnDecode; readonly ringSize?: number }) {
    this.spawn = options.spawn
    this.ringSize = options.ringSize ?? DEFAULT_DECODE_RING_SIZE
  }

  /** Starts a decode and answers what `decode.start` replies with. */
  start(start: DecodeStart): DecodeStartReply {
    if (this.jobs.has(start.jobId) || this.cancelled.has(start.jobId)) {
      throw new NativeEngineFailure({
        message: `a decode with job id ${JSON.stringify(start.jobId)} is already known`,
        command: [],
        exitCode: null,
        signal: null,
        log: [],
      })
    }
    const job = new DecodeJob(start, this.spawn, this.ringSize)
    this.jobs.set(start.jobId, job)
    job.begin()
    return start.reply
  }

  /** A frame's bytes, or why there will never be any. */
  take(jobId: string, index: number): Promise<FrameAnswer> {
    const job = this.jobs.get(jobId)
    if (job !== undefined) return job.take(index)
    if (this.cancelled.has(jobId)) {
      return Promise.resolve({ kind: 'gone', reason: `decode ${jobId} was cancelled` })
    }
    return Promise.resolve({ kind: 'unknown-job' })
  }

  /** The frame's response has been built: the ring may slide past it. */
  settle(jobId: string, index: number): void {
    this.jobs.get(jobId)?.settle(index)
  }

  /** The frame buffers a job has allocated (at most `decodeSlotCount`, once); for tests and the report. */
  allocatedSlots(jobId: string): number {
    return this.jobs.get(jobId)?.allocatedSlots ?? 0
  }

  /** Stops a decode and forgets it; a second cancel is a no-op. */
  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (job === undefined) return
    job.cancel()
    this.jobs.delete(jobId)
    this.cancelled.add(jobId)
    while (this.cancelled.size > MAX_REMEMBERED_CANCELLED_JOBS) {
      const oldest = this.cancelled.values().next().value
      if (oldest === undefined) break
      this.cancelled.delete(oldest)
    }
  }

  /** How many decodes the shell holds, running or recently ended; for tests and the report. */
  get size(): number {
    return this.jobs.size
  }
}
