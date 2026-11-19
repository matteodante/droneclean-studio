/**
 * The encode stream of the native media engine (task 3.3, slice P5): the ring of
 * frame slots the page's readback fills and the FFmpeg process that drains it.
 *
 * **What it is for.** The page POSTs the readback to `droneclean-encode://encode/<jobId>`
 * as one body of bare frames (`preciseOutputFrameBytes` bytes each, no framing
 * header). The protocol handler hands the body's chunks, whatever size the
 * network stack cut them into, to `EncodeJobs.write`; they are copied into a ring
 * of `slots` preallocated buffers, and a writer feeds the full ones to FFmpeg's
 * stdin one after another.
 *
 * **The ring.** The slots are allocated once, when the job starts: a 4K `p010le`
 * frame is 25 MB, so one allocation per frame would be garbage at the encoder's
 * own rate. A slot returns to the free list only when stdin has taken its bytes
 * (the write's callback), because Node holds the buffer until then.
 *
 * **Backpressure.** `write` resolves when the whole chunk is inside the ring. When
 * every slot is full or in flight it waits for one to come back, so the handler
 * stops reading the body, which stops the page's stream: nothing is buffered
 * beyond the ring, however slow the encoder.
 *
 * **Accounting.** The frames FFmpeg muxed are reported on its stdout (`-progress`).
 * When the stream ends and FFmpeg has exited, the job compares them with the frames
 * it fed, and with the frame count the caller declared if it did: a file with a
 * missing frame is a failure, not an export. A body that ends in the middle of a
 * frame is one too.
 *
 * **Endings.** A cancel, a failure (including FFmpeg dying under the stream) and
 * a window that went away all kill the process and discard the partial file
 * (`EncodeStart.discard`).
 *
 * The process is injected (`SpawnEncode`) so `test/encode-stream.test.mjs` drives
 * a fake; `spawnEncode` is the real one.
 */
import { spawn } from 'node:child_process'
import { NativeEngineFailure, type EncodeReply } from '../../shared/native-media'
import { stderrTail } from './ffmpeg'

/** The slots of the ring (design 3.1 §4.1: two or three frames in). */
export const DEFAULT_ENCODE_RING_SLOTS = 3

/** How many ended job ids the shell remembers, so a late POST says what happened. */
export const MAX_REMEMBERED_ENDED_ENCODES = 16

/** How an FFmpeg process ended. */
export interface EncodeExit {
  readonly code: number | null
  readonly signal: string | null
}

/** FFmpeg's stdin as the job uses it. */
export interface EncodeStdin {
  /** Resolves once the OS pipe has the bytes (the buffer may be reused); rejects if the pipe is gone. */
  write(bytes: Uint8Array): Promise<void>
  /** Closes the pipe: FFmpeg sees the end of the readback. */
  end(): Promise<void>
}

/** What an encode job needs from its process; `spawnEncode` provides the real one. */
export interface EncodeProcess {
  /** The whole command line, for a failure report: the binary first. */
  readonly command: readonly string[]
  readonly stdin: EncodeStdin
  /** The frames FFmpeg says it muxed (its last `frame=` progress line); 0 before any. */
  framesReported(): number
  /** Resolves once the process is gone and its pipes are closed. */
  readonly exited: Promise<EncodeExit>
  /** Stops it now (SIGKILL). */
  kill(): void
  /** The last lines it logged. */
  stderrTail(): readonly string[]
}

/** Starts an encode process; the seam a test replaces. */
export type SpawnEncode = (input: {
  readonly ffmpeg: string
  readonly args: readonly string[]
}) => EncodeProcess

/** One encode to start. */
export interface EncodeStart {
  readonly jobId: string
  /** The fixed byte length of one readback frame. */
  readonly frameBytes: number
  /** The exact frame count when the caller knows it; the job refuses more and finishes with fewer. */
  readonly expectedFrames?: number
  readonly ffmpeg: string
  readonly args: readonly string[]
  /** The final file, echoed in the reply (the process writes a temporary file; see `commit`). */
  readonly path: string
  /** Called once per frame FFmpeg has taken, with how many. */
  readonly onFrame?: (framesDone: number) => void
  /** Removes the temporary file; called on cancel and on failure, once the process was spawned. */
  readonly discard?: () => Promise<void>
  /** Moves the temporary file to its final place; called only after FFmpeg exited 0 with every frame. */
  readonly commit?: () => Promise<void>
}

type JobState = 'running' | 'finishing' | 'done' | 'cancelled' | 'failed'

interface Slot {
  readonly bytes: Uint8Array
}

/** One encode, its ring and its process. */
class EncodeJob {
  private readonly start: EncodeStart
  private readonly process: EncodeProcess
  private readonly slots: Slot[] = []
  private readonly free: Slot[] = []
  private readonly ready: Slot[] = []
  private filling: { readonly slot: Slot; fill: number } | null = null
  private roomWaiters: Array<() => void> = []
  private writerRunning: Promise<void> | null = null
  private writing = false
  /** Frames stdin has taken. */
  private framesFed = 0
  /** Frames cut from the body, whether or not stdin has taken them yet. */
  private framesCut = 0
  private state: JobState = 'running'
  private failure: NativeEngineFailure | null = null
  /** How many slots were allocated: fixed at the ring's size, which a test pins. */
  readonly allocatedSlots: number

  constructor(start: EncodeStart, spawnProcess: SpawnEncode, slotCount: number) {
    this.start = start
    for (let index = 0; index < slotCount; index += 1) {
      const slot = { bytes: new Uint8Array(start.frameBytes) }
      this.slots.push(slot)
      this.free.push(slot)
    }
    this.allocatedSlots = slotCount
    this.process = spawnProcess({ ffmpeg: start.ffmpeg, args: start.args })
    void this.process.exited.then((exit) => this.onExit(exit))
  }

  /**
   * Copies a chunk of the body into the ring, cutting it into frames; resolves when
   * all of it is inside, which is when the ring had room for the end of it.
   */
  async write(chunk: Uint8Array): Promise<void> {
    if (this.writing) throw this.refusal('two writes at once: the body must be read in order')
    this.writing = true
    try {
      let offset = 0
      while (offset < chunk.byteLength) {
        this.assertRunning()
        if (this.filling === null) {
          if (this.start.expectedFrames !== undefined && this.framesCut >= this.start.expectedFrames) {
            throw this.fail(
              this.refusal(`the readback has more than the ${this.start.expectedFrames} frames declared`),
            )
          }
          const slot = await this.takeFreeSlot()
          this.filling = { slot, fill: 0 }
        }
        const filling = this.filling
        const take = Math.min(this.start.frameBytes - filling.fill, chunk.byteLength - offset)
        filling.slot.bytes.set(chunk.subarray(offset, offset + take), filling.fill)
        filling.fill += take
        offset += take
        if (filling.fill === this.start.frameBytes) {
          this.filling = null
          this.framesCut += 1
          this.ready.push(filling.slot)
          this.kick()
        }
      }
    } finally {
      this.writing = false
    }
  }

  /** The body ended: flush the ring, close stdin, wait for FFmpeg and check the count. */
  async finish(): Promise<EncodeReply> {
    this.assertRunning()
    if (this.filling !== null && this.filling.fill > 0) {
      throw this.fail(
        this.refusal(
          `the readback ended in the middle of frame ${this.framesCut}: ` +
            `${this.filling.fill} of ${this.start.frameBytes} bytes`,
        ),
      )
    }
    this.state = 'finishing'
    await this.writerRunning
    if (this.failure !== null) throw this.failure
    await this.process.stdin.end().catch(() => undefined)
    const exit = await this.process.exited
    if (this.failure !== null) throw this.failure
    if (exit.code !== 0 || exit.signal !== null) {
      throw this.fail(this.exitFailure(exit, `the encoder stopped after ${this.framesFed} frames`))
    }
    const reported = this.process.framesReported()
    if (this.framesFed === 0) throw this.fail(this.refusal('the readback had no frames'))
    if (this.start.expectedFrames !== undefined && this.framesFed !== this.start.expectedFrames) {
      throw this.fail(
        this.refusal(`the readback had ${this.framesFed} frames, ${this.start.expectedFrames} were declared`),
      )
    }
    if (reported !== this.framesFed) {
      throw this.fail(
        this.refusal(`the encoder wrote ${reported} of the ${this.framesFed} frames it was fed`),
      )
    }
    try {
      await this.start.commit?.()
    } catch (error) {
      throw this.fail(this.refusal(error instanceof Error ? error.message : String(error)))
    }
    this.state = 'done'
    return { framesWritten: this.framesFed, path: this.start.path }
  }

  /** Kills the process, frees the ring, discards the partial file and wakes every waiter. */
  cancel(): void {
    if (this.state === 'cancelled' || this.state === 'done' || this.state === 'failed') return
    this.state = 'cancelled'
    this.failure = this.refusal(`encode ${this.start.jobId} was cancelled`)
    this.teardown()
  }

  private async takeFreeSlot(): Promise<Slot> {
    for (;;) {
      this.assertRunning()
      const slot = this.free.pop()
      if (slot !== undefined) return slot
      await new Promise<void>((resolve) => this.roomWaiters.push(resolve))
    }
  }

  /** Starts the writer if it is not running. */
  private kick(): void {
    if (this.writerRunning !== null) return
    this.writerRunning = this.drain().finally(() => {
      this.writerRunning = null
    })
  }

  /** Feeds full slots to stdin, in order, returning each when the pipe has its bytes. */
  private async drain(): Promise<void> {
    for (;;) {
      const slot = this.ready.shift()
      if (slot === undefined) return
      try {
        await this.process.stdin.write(slot.bytes)
      } catch {
        // The pipe is gone: FFmpeg died or was killed. `onExit` says which.
        if (this.state === 'running' || this.state === 'finishing') {
          const exit = await this.process.exited
          this.fail(this.exitFailure(exit, `the encoder stopped after ${this.framesFed} frames`))
        }
        return
      }
      this.framesFed += 1
      this.free.push(slot)
      this.wake()
      this.start.onFrame?.(this.framesFed)
    }
  }

  private onExit(exit: EncodeExit): void {
    if (this.state !== 'running') return
    this.fail(this.exitFailure(exit, `the encoder stopped after ${this.framesFed} frames`))
  }

  private fail(failure: NativeEngineFailure): NativeEngineFailure {
    if (this.state === 'cancelled' || this.state === 'failed') return this.failure ?? failure
    this.state = 'failed'
    this.failure = failure
    this.teardown()
    return failure
  }

  private teardown(): void {
    this.process.kill()
    this.ready.length = 0
    this.filling = null
    this.wake()
    void this.start.discard?.().catch(() => undefined)
  }

  private wake(): void {
    const waiting = this.roomWaiters
    this.roomWaiters = []
    for (const resolve of waiting) resolve()
  }

  private assertRunning(): void {
    if (this.state === 'running') return
    if (this.failure !== null) throw this.failure
    throw this.refusal(`encode ${this.start.jobId} is already ${this.state}`)
  }

  private refusal(message: string): NativeEngineFailure {
    return new NativeEngineFailure({
      message,
      command: this.process.command,
      exitCode: null,
      signal: null,
      log: this.process.stderrTail(),
    })
  }

  private exitFailure(exit: EncodeExit, message: string): NativeEngineFailure {
    const how =
      exit.signal !== null
        ? `signal ${exit.signal}`
        : exit.code === null
          ? 'it never started'
          : `exit code ${exit.code}`
    return new NativeEngineFailure({
      message: `${message} (${how})`,
      command: this.process.command,
      exitCode: exit.code,
      signal: exit.signal,
      log: this.process.stderrTail(),
    })
  }
}

/**
 * The shell's encode jobs, by job id. A job leaves the map when it finishes, fails
 * or is cancelled, and its id is remembered for a while so a late POST is answered
 * with what happened rather than "unknown".
 */
export class EncodeJobs {
  private readonly jobs = new Map<string, EncodeJob>()
  private readonly ended = new Set<string>()
  private readonly spawn: SpawnEncode
  private readonly slots: number

  constructor(options: { readonly spawn: SpawnEncode; readonly slots?: number }) {
    this.spawn = options.spawn
    this.slots = options.slots ?? DEFAULT_ENCODE_RING_SLOTS
  }

  /** Starts the process and allocates the ring; throws if the id is already known. */
  start(start: EncodeStart): void {
    if (this.jobs.has(start.jobId) || this.ended.has(start.jobId)) {
      throw new Error(`an encode with job id ${JSON.stringify(start.jobId)} is already known`)
    }
    this.jobs.set(start.jobId, new EncodeJob(start, this.spawn, this.slots))
  }

  /** Whether a job with this id is running. */
  has(jobId: string): boolean {
    return this.jobs.has(jobId)
  }

  /** The slots allocated for a running job (fixed at the ring's size); for tests. */
  allocatedSlots(jobId: string): number {
    return this.jobs.get(jobId)?.allocatedSlots ?? 0
  }

  /** One chunk of the readback body; resolves when the ring has taken it. */
  async write(jobId: string, chunk: Uint8Array): Promise<void> {
    await this.require(jobId).write(chunk)
  }

  /** The body ended: the reply when every frame is in the file. The job is gone afterwards. */
  async finish(jobId: string): Promise<EncodeReply> {
    const job = this.require(jobId)
    try {
      return await job.finish()
    } finally {
      this.forget(jobId)
    }
  }

  /** Stops an encode, removes its partial file and forgets it; a second cancel is a no-op. */
  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (job === undefined) return
    job.cancel()
    this.forget(jobId)
  }

  /** How many encodes are running. */
  get size(): number {
    return this.jobs.size
  }

  private require(jobId: string): EncodeJob {
    const job = this.jobs.get(jobId)
    if (job !== undefined) return job
    throw new Error(
      this.ended.has(jobId)
        ? `encode ${jobId} has ended (cancelled, failed or finished)`
        : `no encode job ${jobId}`,
    )
  }

  private forget(jobId: string): void {
    if (!this.jobs.delete(jobId)) return
    this.ended.add(jobId)
    while (this.ended.size > MAX_REMEMBERED_ENDED_ENCODES) {
      const oldest = this.ended.values().next().value
      if (oldest === undefined) break
      this.ended.delete(oldest)
    }
  }
}

/**
 * Starts FFmpeg for an encode.
 *
 * stdin is the readback; stdout carries `-progress` lines (`frame=N`); stderr is
 * kept as its last lines for a failure's report.
 */
export function spawnEncode(input: {
  readonly ffmpeg: string
  readonly args: readonly string[]
}): EncodeProcess {
  const command = [input.ffmpeg, ...input.args]
  const child = spawn(input.ffmpeg, [...input.args], { stdio: ['pipe', 'pipe', 'pipe'] })

  let log = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    log = `${log}${chunk}`.slice(-64 * 1024)
  })

  let reported = 0
  let pending = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    pending += chunk
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      const match = /^frame=(\d+)$/.exec(line.trim())
      if (match?.[1] !== undefined) reported = Number(match[1])
    }
  })

  // A broken pipe is reported through the write's callback and the exit code;
  // without a listener it would be an uncaught exception of the main process.
  child.stdin.on('error', () => undefined)

  const exited = new Promise<EncodeExit>((resolve) => {
    child.once('error', () => resolve({ code: null, signal: null }))
    child.once('close', (code, signal) => resolve({ code, signal: signal ?? null }))
  })

  return {
    command,
    stdin: {
      write(bytes) {
        return new Promise<void>((resolve, reject) => {
          if (child.stdin.destroyed) {
            reject(new Error('the encoder is gone'))
            return
          }
          child.stdin.write(bytes, (error) => (error ? reject(error) : resolve()))
        })
      },
      end() {
        return new Promise<void>((resolve) => {
          if (child.stdin.destroyed) {
            resolve()
            return
          }
          child.stdin.end(() => resolve())
        })
      },
    },
    framesReported: () => reported,
    exited,
    kill() {
      child.kill('SIGKILL')
      child.stdin.destroy()
    },
    stderrTail() {
      return stderrTail(log)
    },
  }
}

/**
 * Reads a readback body into a job, chunk by chunk, awaiting each so the ring's
 * room is the page's backpressure, then finishes it. Exported for the tests.
 */
export async function pipeBodyIntoJob(
  target: Pick<EncodeJobs, 'write' | 'finish'>,
  jobId: string,
  body: ReadableStream<Uint8Array>,
  onChunk?: { readonly started: () => void; readonly finished: () => void },
): Promise<EncodeReply> {
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    onChunk?.started()
    try {
      await target.write(jobId, value)
    } finally {
      onChunk?.finished()
    }
  }
  return target.finish(jobId)
}

