/**
 * One scheduler for the work an import leads to (task 8.7, design section 4.1): filmstrips, thumbnails, proxies,
 * waveforms, motion data. Before it every producer had its own queue, one job wide whatever the machine, and nothing
 * put the clip the pilot is looking at before a proxy of a clip he never opened.
 *
 * Work runs in **lanes**, by what it waits for:
 *  - `transcode`: the media engine's encoder and decoder together (proxies). Width: what the engine-lane probe measured;
 *  - `decode`: seek-and-decode of a few frames (filmstrips, thumbnails). Mostly waiting on the file and the engine's
 *    start-up, so it is wider than `transcode`;
 *  - `cpu`: parsing and audio decode on a core (waveforms, post-import jobs). Width: the cores left over and the
 *    memory an engine of the gyro kind needs;
 *  - `motion`: opens of a clip on a gyro engine (about 1.6 GB each while it parses and smooths). Width: bounded by the
 *    machine's memory alone (`motionLaneWidth`), so a wide cpu lane never means that many engines.
 *
 * Each job has a priority: `interactive` (the clip the pilot is looking at), `import` (the clips just imported) or
 * `background` (everything else, proxies among it). A job starts when fewer jobs of its own priority or a more urgent
 * one are running in its lane than the lane is wide, so a proxy running in the lane never keeps a filmstrip from
 * starting, and an interactive job never waits for an import job. While the pilot plays or exports the scheduler is
 * **held**: nothing but interactive jobs starts, and running jobs are told to yield (`shouldYield`) at their next
 * safe point. A job that was cancelled before it started never runs; one that was cancelled while running gets its
 * abort signal.
 *
 * The scheduler has no timers and no browser dependency: widths, the hold and the clock are inputs, so it is tested
 * as plain code. `index.ts` builds the one the app uses.
 */

export type Lane = 'transcode' | 'decode' | 'cpu' | 'motion'
export type Priority = 'interactive' | 'import' | 'background'

const LANES: readonly Lane[] = ['transcode', 'decode', 'cpu', 'motion']
const RANK: Record<Priority, number> = { interactive: 0, import: 1, background: 2 }

export interface JobSpec {
  lane: Lane
  priority: Priority
  /** Among jobs of one priority, the lower goes first; ties go in the order they were queued. */
  order?: number
  /** A name for logs and stats. */
  label?: string
  /** Aborting it removes the job from the queue, or tells a running job to stop. */
  signal?: AbortSignal
}

export interface JobContext {
  signal: AbortSignal
  /** True when this job should pause or stop at its next safe point: the scheduler is held, or a more urgent job waits. */
  shouldYield: () => boolean
}

export interface LaneStats {
  width: number
  running: number
  queued: number
  runningByPriority: Record<Priority, number>
}

export class JobCancelledError extends Error {
  constructor(message = 'The side-work job was cancelled before it started') {
    super(message)
    this.name = 'AbortError'
  }
}

interface QueuedJob {
  id: number
  spec: JobSpec
  work: (context: JobContext) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  controller: AbortController
  detach: () => void
}

interface RunningJob {
  id: number
  priority: Priority
}

export type WidthSource = number | (() => number)

export class SideWorkScheduler {
  private readonly widths = new Map<Lane, WidthSource>()
  private readonly queues = new Map<Lane, QueuedJob[]>(LANES.map((lane) => [lane, []]))
  private readonly running = new Map<Lane, RunningJob[]>(LANES.map((lane) => [lane, []]))
  private readonly holds = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private nextId = 1
  private nextSequence = 1
  private readonly sequence = new WeakMap<QueuedJob, number>()

  constructor(widths: Partial<Record<Lane, WidthSource>> = {}) {
    for (const lane of LANES) this.widths.set(lane, widths[lane] ?? 1)
  }

  /** How many jobs the lane runs at once. At least 1. */
  width(lane: Lane): number {
    const source = this.widths.get(lane) ?? 1
    const value = typeof source === 'function' ? source() : source
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
  }

  setWidth(lane: Lane, width: WidthSource): void {
    this.widths.set(lane, width)
    this.pump()
    this.notify()
  }

  /** Stop starting background and import work (the pilot is playing or exporting). Returns the release. */
  hold(reason: string): () => void {
    this.holds.add(reason)
    this.notify()
    let released = false
    return () => {
      if (released) return
      released = true
      this.holds.delete(reason)
      this.pump()
      this.notify()
    }
  }

  /** Set or clear a named hold (for a source that reports on/off, like a store subscription). */
  setHeld(reason: string, held: boolean): void {
    if (held === this.holds.has(reason)) return
    if (held) this.holds.add(reason)
    else this.holds.delete(reason)
    if (!held) this.pump()
    this.notify()
  }

  isHeld(): boolean {
    return this.holds.size > 0
  }

  /** Called whenever a width, a hold or the queues change (a producer with a queue of its own re-checks it). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  stats(): Record<Lane, LaneStats> {
    const result = {} as Record<Lane, LaneStats>
    for (const lane of LANES) {
      const running = this.running.get(lane) ?? []
      const byPriority: Record<Priority, number> = { interactive: 0, import: 0, background: 0 }
      for (const job of running) byPriority[job.priority] += 1
      result[lane] = {
        width: this.width(lane),
        running: running.length,
        queued: this.queues.get(lane)?.length ?? 0,
        runningByPriority: byPriority,
      }
    }
    return result
  }

  /**
   * Queue `work` in its lane. Resolves with its result. Rejects with `JobCancelledError` when the signal fired before
   * the job started; a job that already runs gets the signal and decides itself.
   */
  run<T>(spec: JobSpec, work: (context: JobContext) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (spec.signal?.aborted) {
        reject(new JobCancelledError())
        return
      }
      const controller = new AbortController()
      const job: QueuedJob = {
        id: this.nextId++,
        spec,
        work: work as (context: JobContext) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        controller,
        detach: () => {},
      }
      this.sequence.set(job, this.nextSequence++)
      if (spec.signal) {
        const onAbort = () => {
          const queue = this.queues.get(spec.lane) ?? []
          const index = queue.indexOf(job)
          if (index === -1) {
            controller.abort(spec.signal?.reason)
            return
          }
          queue.splice(index, 1)
          job.detach()
          reject(new JobCancelledError())
          this.notify()
        }
        spec.signal.addEventListener('abort', onAbort, { once: true })
        job.detach = () => spec.signal?.removeEventListener('abort', onAbort)
      }
      const queue = this.queues.get(spec.lane)
      if (!queue) {
        reject(new Error(`Unknown side-work lane ${spec.lane}`))
        return
      }
      queue.push(job)
      queue.sort((a, b) => this.compare(a, b))
      this.pump()
      this.notify()
    })
  }

  private compare(a: QueuedJob, b: QueuedJob): number {
    const byPriority = RANK[a.spec.priority] - RANK[b.spec.priority]
    if (byPriority !== 0) return byPriority
    const byOrder = (a.spec.order ?? 0) - (b.spec.order ?? 0)
    if (byOrder !== 0) return byOrder
    return (this.sequence.get(a) ?? 0) - (this.sequence.get(b) ?? 0)
  }

  /** True when a job of strictly higher priority waits in the lane. */
  private moreUrgentWaiting(lane: Lane, priority: Priority): boolean {
    return (this.queues.get(lane) ?? []).some((job) => RANK[job.spec.priority] < RANK[priority])
  }

  private canStart(lane: Lane, priority: Priority): boolean {
    if (this.isHeld() && priority !== 'interactive') return false
    const running = this.running.get(lane) ?? []
    const rank = RANK[priority]
    const sameOrMoreUrgent = running.filter((job) => RANK[job.priority] <= rank).length
    return sameOrMoreUrgent < this.width(lane)
  }

  private pump(): void {
    for (const lane of LANES) {
      const queue = this.queues.get(lane) ?? []
      let progressed = true
      while (progressed) {
        progressed = false
        for (let i = 0; i < queue.length; i++) {
          const job = queue[i]
          if (job && this.canStart(lane, job.spec.priority)) {
            queue.splice(i, 1)
            this.start(lane, job)
            progressed = true
            break
          }
        }
      }
    }
  }

  private start(lane: Lane, job: QueuedJob): void {
    const running = this.running.get(lane) ?? []
    const entry: RunningJob = { id: job.id, priority: job.spec.priority }
    running.push(entry)
    const context: JobContext = {
      signal: job.controller.signal,
      shouldYield: () =>
        (this.isHeld() && job.spec.priority !== 'interactive') ||
        this.moreUrgentWaiting(lane, job.spec.priority),
    }
    this.notify()
    let promise: Promise<unknown>
    try {
      promise = Promise.resolve(job.work(context))
    } catch (error) {
      promise = Promise.reject(error)
    }
    promise
      .then(job.resolve, job.reject)
      .finally(() => {
        job.detach()
        const index = running.indexOf(entry)
        if (index !== -1) running.splice(index, 1)
        this.pump()
        this.notify()
      })
      .catch(() => {})
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/** Width of the `cpu` lane: the cores left over, and the memory an engine of the gyro kind (1.6 GB) needs. */
export function cpuLaneWidth(cores: number, memoryGb: number, engineGb = 1.6): number {
  const byCores = Math.max(1, cores - 2)
  const byMemory = Math.max(1, Math.floor((memoryGb * 0.5) / engineGb))
  return Math.min(byCores, byMemory)
}

/** Width of the `decode` lane: a third of the cores, between 2 and 4 (filmstrips are mostly waiting, not computing). */
export function decodeLaneWidth(cores: number): number {
  return Math.max(2, Math.min(4, Math.floor(cores / 3)))
}

/** Width of the `motion` lane: one gyro open per 8 GB of the machine's memory, between 1 and 4 (2 on a 16 GB Mac). */
export function motionLaneWidth(totalMemoryGb: number): number {
  const byMemory = Number.isFinite(totalMemoryGb) ? Math.floor(totalMemoryGb / 8) : 1
  return Math.min(4, Math.max(1, byMemory))
}
