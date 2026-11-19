/**
 * The project's sound on its way to an export's FFmpeg (the native audio hand-off).
 *
 * **Why a file.** The page mixes the project's sound (`src/studio/export/native-audio.ts`) before it starts the
 * encode, and sends it here in chunks. FFmpeg reads it as a second input (`-f f32le -ar 48000 -ac 2`), which it can
 * open only when the whole mix is there, so the chunks land in a temporary file under `os.tmpdir()` and
 * `encode.start` finds it by the job id. Neither the page nor the shell ever holds the whole mix in memory.
 *
 * **The chunks.** Each is the interleaved stereo `float32` little-endian samples of the next stretch of the mix,
 * numbered from 0; a chunk is accepted only as the next number, so the order is the file's order. `end` closes the
 * file and says how many chunks the page sent, which must be all of them.
 *
 * **Endings.** The encode that takes the file removes it when it ends (`remove`); a cancel removes it, a job that
 * never reaches `encode.start` is removed by the idle sweep, and the folder is emptied when the shell registers.
 * No Electron import: a test loads this under plain Node.
 */
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Bytes of one stereo `float32` sample frame. */
export const AUDIO_FRAME_BYTES = 8

/** The largest mix the shell stages: three hours of stereo float at 48 kHz, 8.3 GB. */
export const MAX_STAGED_AUDIO_BYTES = 3 * 60 * 60 * 48_000 * AUDIO_FRAME_BYTES

/** How many mixes the shell stages at once. */
export const MAX_STAGED_AUDIO_JOBS = 2

/** A staged mix nobody has written to for this long, and that no encode took, is removed. */
export const STAGED_AUDIO_IDLE_MS = 5 * 60_000

/** The folder the shell's staged mixes live in. */
export const AUDIO_STAGE_FOLDER = 'droneclean-export-audio'

interface Staged {
  readonly file: string
  handle: FileHandle | null
  next: number
  bytes: number
  ended: boolean
  lastActivity: number
  /** Chunks are written one after another, whatever order their requests arrive in. */
  tail: Promise<unknown>
}

/** What `end` and `take` answer: the file and what is in it. */
export interface StagedAudio {
  readonly file: string
  readonly samples: number
  readonly chunks: number
}

/** The mixes being handed over, by job id. */
export class AudioStage {
  private readonly staged = new Map<string, Staged>()
  private readonly folder: string
  private readonly now: () => number

  constructor(options: { readonly folder?: string; readonly now?: () => number } = {}) {
    this.folder = options.folder ?? path.join(os.tmpdir(), AUDIO_STAGE_FOLDER)
    this.now = options.now ?? Date.now
  }

  /** Empties the folder of mixes a crashed shell left behind; call once at start. */
  async clearFolder(): Promise<void> {
    await fs.rm(this.folder, { recursive: true, force: true }).catch(() => undefined)
  }

  /** Whether a mix (finished or not) is staged for this job. */
  has(jobId: string): boolean {
    return this.staged.has(jobId)
  }

  /** Appends chunk number `index` of the job's mix; it must be the next one. */
  async append(jobId: string, index: number, bytes: Uint8Array): Promise<void> {
    let entry = this.staged.get(jobId)
    if (entry === undefined) {
      if (index !== 0) throw new Error(`audio ${jobId}: chunk ${index} came before chunk 0`)
      if (this.staged.size >= MAX_STAGED_AUDIO_JOBS) {
        throw new Error(`audio ${jobId}: the shell stages ${MAX_STAGED_AUDIO_JOBS} mixes at most`)
      }
      entry = {
        file: path.join(this.folder, `${jobId}.f32`),
        handle: null,
        next: 0,
        bytes: 0,
        ended: false,
        lastActivity: this.now(),
        tail: Promise.resolve(),
      }
      this.staged.set(jobId, entry)
    }
    const target = entry
    if (target.ended) throw new Error(`audio ${jobId}: the mix has ended, chunk ${index} is too late`)
    if (index !== target.next) {
      throw new Error(`audio ${jobId}: chunk ${index} arrived where chunk ${target.next} is next`)
    }
    if (bytes.byteLength === 0 || bytes.byteLength % AUDIO_FRAME_BYTES !== 0) {
      throw new Error(
        `audio ${jobId}: a chunk is whole stereo float samples (${AUDIO_FRAME_BYTES} bytes each), got ${bytes.byteLength} bytes`,
      )
    }
    if (target.bytes + bytes.byteLength > MAX_STAGED_AUDIO_BYTES) {
      await this.remove(jobId)
      throw new Error(`audio ${jobId}: the mix is longer than three hours`)
    }
    target.next += 1
    target.bytes += bytes.byteLength
    target.lastActivity = this.now()
    const written = target.tail.then(async () => {
      if (target.handle === null) {
        await fs.mkdir(this.folder, { recursive: true })
        target.handle = await fs.open(target.file, 'w')
      }
      await target.handle.write(bytes)
    })
    target.tail = written.catch(() => undefined)
    try {
      await written
    } catch (error) {
      await this.remove(jobId)
      throw error
    }
  }

  /** Closes the mix: the page says how many chunks it sent. */
  async end(jobId: string, chunks: number): Promise<StagedAudio> {
    const entry = this.staged.get(jobId)
    if (entry === undefined) throw new Error(`audio ${jobId}: no mix was sent`)
    if (entry.ended) throw new Error(`audio ${jobId}: the mix has already ended`)
    if (chunks !== entry.next) {
      await this.remove(jobId)
      throw new Error(`audio ${jobId}: the page sent ${chunks} chunks, the shell took ${entry.next}`)
    }
    await entry.tail
    await entry.handle?.close()
    entry.handle = null
    entry.ended = true
    entry.lastActivity = this.now()
    return { file: entry.file, samples: entry.bytes / AUDIO_FRAME_BYTES, chunks: entry.next }
  }

  /**
   * The finished mix of a job for `encode.start`: null when the page sent none (a project with no sound), a
   * refusal when it sent one it did not finish.
   */
  take(jobId: string): StagedAudio | null {
    const entry = this.staged.get(jobId)
    if (entry === undefined) return null
    if (!entry.ended) throw new Error(`audio ${jobId}: encode.start came before the mix ended`)
    return { file: entry.file, samples: entry.bytes / AUDIO_FRAME_BYTES, chunks: entry.next }
  }

  /** Removes a job's mix and its file; a job with none is a no-op. */
  async remove(jobId: string): Promise<void> {
    const entry = this.staged.get(jobId)
    if (entry === undefined) return
    this.staged.delete(jobId)
    await entry.tail
    await entry.handle?.close().catch(() => undefined)
    entry.handle = null
    await fs.rm(entry.file, { force: true }).catch(() => undefined)
  }

  /** Removes the mixes nobody has touched for the idle time. */
  async sweep(): Promise<void> {
    const now = this.now()
    for (const [jobId, entry] of [...this.staged]) {
      if (now - entry.lastActivity >= STAGED_AUDIO_IDLE_MS) await this.remove(jobId)
    }
  }
}

/** The shell's stage. */
export const audioStage = new AudioStage()
