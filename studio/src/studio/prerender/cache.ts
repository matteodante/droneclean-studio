// The pre-render cache (design `docs/designs/prerender-preview.md` §0.3-§0.5): encoded frames in memory, grouped in runs
// (one run per stretch one encoder wrote, starting with a key frame), each frame stored with the hash it was rendered
// under. A frame is valid while its hash equals the hash the editor computes for it now (`fingerprint.ts`); a group of
// pictures none of whose frames is valid is freed at once. The cache belongs to one project and lives as long as
// the page: nothing is written to disk, and an export never reads it.

import { coalesceRanges, rangesOfFlags, type FrameRange } from './ranges'
import { usePrerenderStore } from './store'

/** The memory the encoded frames may use: about 4.5 minutes of 1080p60 at the codec's bitrate, 18 at 928x522 */
export const PRERENDER_MEMORY_LIMIT_BYTES = 1024 * 1024 * 1024

/** How long after the last change the ruler's ranges are brought up to date */
const REVALIDATE_DELAY_MS = 120

export interface CachedChunk {
  readonly data: Uint8Array
  readonly key: boolean
}

export interface CachedRun {
  readonly id: number
  readonly start: number
  /** The frame after the last frame whose chunk has arrived */
  end: number
  /** The decoder's configuration: the codec's, completed by the encoder's own description when it gives one */
  decoder: VideoDecoderConfig
  readonly keyInterval: number
  /** The hash each frame was rendered under, indexed from `start`, as long as the planned range */
  readonly hashes: Float64Array
  /** Each frame's chunk, `null` once its group of pictures was freed */
  readonly chunks: (CachedChunk | null)[]
  /** Whether each frame may be shown now (its chunk is there and its hash matches) */
  valid: Uint8Array
  bytes: number
}

/** The hashes of the frames of a range as the editor draws them now */
export type HashSource = (range: FrameRange) => Float64Array

/**
 * Set each frame of a run valid exactly when its chunk is held and the hash it was rendered under equals the
 * editor's hash for it now (`current`; none means no frame matches). Whether any flag changed.
 */
function updateValidity(run: CachedRun, current: Float64Array | undefined): boolean {
  let changed = false
  for (let index = 0; index < run.end - run.start; index += 1) {
    const matches = current !== undefined && current[index] === run.hashes[index]
    const valid = matches && run.chunks[index] !== null ? 1 : 0
    if (run.valid[index] === valid) continue
    run.valid[index] = valid
    changed = true
  }
  return changed
}

export class PrerenderCache {
  private runs: CachedRun[] = []
  private nextRunId = 1
  private projectId: string | null = null
  private hashSource: HashSource | null = null
  private dirty = false
  private revalidateTimer: ReturnType<typeof setTimeout> | null = null
  /** Bumped whenever the set of runs or a run's validity changes: the player drops what it decoded */
  private revision = 0
  /** Bumped on every change that may redraw a frame (a running job compares it between frames) */
  private changes = 0

  /** The function that hashes the editor's current state (`state.ts`); tests pass their own */
  setHashSource(source: HashSource | null): void {
    this.hashSource = source
    this.markDirty()
  }

  /** Forget everything when the open project changes */
  useProject(projectId: string | null): void {
    if (projectId === this.projectId) return
    this.projectId = projectId
    this.clear()
  }

  get currentRevision(): number {
    return this.revision
  }

  get changeCount(): number {
    return this.changes
  }

  get totalBytes(): number {
    return this.runs.reduce((total, run) => total + run.bytes, 0)
  }

  /** Something that draws frames may have changed: no frame is shown until the hashes are checked again */
  markDirty(): void {
    this.dirty = true
    this.changes += 1
    if (this.revalidateTimer !== null) return
    this.revalidateTimer = setTimeout(() => {
      this.revalidateTimer = null
      this.ensureFresh()
    }, REVALIDATE_DELAY_MS)
  }

  /** Check every run's hashes against the editor's state, if anything changed since the last check */
  ensureFresh(): void {
    if (!this.dirty) return
    this.dirty = false
    this.revalidate()
  }

  /** Start a run for frames `[start, start + hashes.length)`, rendered under `hashes` */
  beginRun(
    start: number,
    hashes: Float64Array,
    decoder: VideoDecoderConfig,
    keyInterval: number,
  ): CachedRun {
    const run: CachedRun = {
      id: this.nextRunId++,
      start,
      end: start,
      decoder,
      keyInterval,
      hashes,
      chunks: Array.from({ length: hashes.length }, () => null),
      valid: new Uint8Array(hashes.length),
      bytes: 0,
    }
    this.runs.push(run)
    this.revision += 1
    return run
  }

  /**
   * The next frame's chunk of a run, in display order. It is valid at once if nothing changed since the job hashed
   * it; the next check decides otherwise.
   */
  appendChunk(run: CachedRun, chunk: CachedChunk): void {
    const index = run.end - run.start
    if (index >= run.chunks.length || !this.runs.includes(run)) return
    run.chunks[index] = chunk
    run.valid[index] = 1
    run.bytes += chunk.data.byteLength
    run.end += 1
    // The ruler follows the job a group of pictures at a time, not on every frame
    if ((run.end - run.start) % run.keyInterval === 0) this.publish()
  }

  /** Bring the ruler's ranges and the size up to date (the job's end) */
  flush(): void {
    this.publish()
  }

  /** The valid run holding `frame`, after the hashes are checked if anything changed */
  validRunAt(frame: number): CachedRun | null {
    this.ensureFresh()
    for (const run of this.runs) {
      if (frame >= run.start && frame < run.end && run.valid[frame - run.start] === 1) return run
    }
    return null
  }

  /** Whether `run` is still one of the cache's runs */
  holds(run: CachedRun): boolean {
    return this.runs.includes(run)
  }

  /** The frames that play from the cache now, merged */
  validRanges(): FrameRange[] {
    this.ensureFresh()
    return this.computeRanges()
  }

  /** Drop every run */
  clear(): void {
    this.runs = []
    this.dirty = false
    this.revision += 1
    this.publish()
  }

  /** Drop one run (a job that could not start its encoder, a decoder that failed on it) */
  removeRun(run: CachedRun): void {
    const before = this.runs.length
    this.runs = this.runs.filter((candidate) => candidate !== run)
    if (this.runs.length === before) return
    this.revision += 1
    this.publish()
  }

  private revalidate(): void {
    let changed = false
    for (const run of this.runs) {
      if (run.end === run.start) continue
      const current = this.hashSource?.({ start: run.start, end: run.end })
      if (updateValidity(run, current)) changed = true
      if (this.freeStaleGroups(run)) changed = true
    }
    const kept = this.runs.filter((run) => run.end === run.start || run.bytes > 0)
    if (kept.length !== this.runs.length) {
      this.runs = kept
      changed = true
    }
    if (changed) this.revision += 1
    this.publish()
  }

  /** Free the groups of pictures of a run none of whose frames is valid; whether any was freed */
  private freeStaleGroups(run: CachedRun): boolean {
    const length = run.end - run.start
    let freed = false
    for (let group = 0; group < length; group += run.keyInterval) {
      const groupEnd = Math.min(length, group + run.keyInterval)
      let anyValid = false
      let anyHeld = false
      for (let index = group; index < groupEnd; index += 1) {
        if (run.valid[index] === 1) anyValid = true
        if (run.chunks[index] !== null) anyHeld = true
      }
      if (anyValid || !anyHeld) continue
      for (let index = group; index < groupEnd; index += 1) {
        run.bytes -= run.chunks[index]?.data.byteLength ?? 0
        run.chunks[index] = null
      }
      freed = true
    }
    return freed
  }

  private computeRanges(): FrameRange[] {
    return coalesceRanges(
      this.runs.flatMap((run) =>
        rangesOfFlags(
          Array.from(run.valid.subarray(0, run.end - run.start), (flag) => flag === 1),
          run.start,
        ),
      ),
    )
  }

  private publish(): void {
    usePrerenderStore.setState({ ranges: this.computeRanges(), bytes: this.totalBytes })
  }
}

/** The page's one cache */
export const prerenderCache = new PrerenderCache()
