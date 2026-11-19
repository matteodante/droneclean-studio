/**
 * The decode jobs of each window (review finding R6): how many it may hold, and
 * when they are stopped.
 *
 * FFmpeg is a process the shell started for a page. The page can go away without
 * saying so (a reload, a crash, a closed window, a script that stopped reading),
 * and a decoder paused on a full ring would then live until the app quits. So:
 *
 * - at most `MAX_JOBS_PER_WINDOW` decodes per window; one more is refused;
 * - a window's jobs are cancelled when its main frame navigates, when its
 *   renderer is gone, and when the window is destroyed;
 * - a job nobody has read from for `IDLE_MS` is cancelled (a read in flight is
 *   not idle: a late frame is awaited, not abandoned).
 *
 * No Electron import: a window is anything with an id and the three events, and
 * time is the caller's clock, so the tests drive all of it.
 */

export const MAX_JOBS_PER_WINDOW = 2
export const IDLE_MS = 30_000

/** The parts of a `WebContents` the tracker listens to. */
export interface TrackedWindow {
  readonly id: number
  on(event: string, listener: (...args: any[]) => void): unknown
  once(event: string, listener: (...args: any[]) => void): unknown
}

interface TrackedJob {
  readonly windowId: number
  lastActivity: number
  reads: number
}

export class WindowJobs {
  private readonly jobs = new Map<string, TrackedJob>()
  private readonly attached = new Set<number>()
  private readonly cancel: (jobId: string) => void
  private readonly now: () => number
  private readonly maxPerWindow: number
  private readonly idleMs: number
  private readonly call: string
  private readonly noun: string

  constructor(options: {
    readonly cancel: (jobId: string) => void
    readonly now?: () => number
    readonly maxPerWindow?: number
    readonly idleMs?: number
    /** What the refusal calls the call and the job; decode's by default. */
    readonly call?: string
    readonly noun?: string
  }) {
    this.call = options.call ?? 'decode.start'
    this.noun = options.noun ?? 'decodes'
    this.cancel = options.cancel
    this.now = options.now ?? Date.now
    this.maxPerWindow = options.maxPerWindow ?? MAX_JOBS_PER_WINDOW
    this.idleMs = options.idleMs ?? IDLE_MS
  }

  /** Whether a window may start one more job; the error says why not. */
  assertRoom(windowId: number): void {
    if (this.countOf(windowId) >= this.maxPerWindow) {
      throw new Error(
        `${this.call}: at most ${this.maxPerWindow} ${this.noun} per window; cancel one first`,
      )
    }
  }

  /** A job started for a window: it counts, and the window's events now stop it. */
  admit(window: TrackedWindow, jobId: string): void {
    this.assertRoom(window.id)
    this.jobs.set(jobId, { windowId: window.id, lastActivity: this.now(), reads: 0 })
    this.attach(window)
  }

  /** The page cancelled (or the job ended): it no longer counts. */
  release(jobId: string): void {
    this.jobs.delete(jobId)
  }

  /** A frame request for the job began. */
  readStarted(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (job === undefined) return
    job.reads += 1
    job.lastActivity = this.now()
  }

  /** That request was answered. */
  readFinished(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (job === undefined) return
    job.reads = Math.max(0, job.reads - 1)
    job.lastActivity = this.now()
  }

  /** Cancel every job that nobody has read from for the idle time. */
  sweep(): void {
    const now = this.now()
    for (const [jobId, job] of [...this.jobs]) {
      if (job.reads === 0 && now - job.lastActivity >= this.idleMs) this.stop(jobId)
    }
  }

  /** Cancel every job of a window. */
  cancelWindow(windowId: number): void {
    for (const [jobId, job] of [...this.jobs]) {
      if (job.windowId === windowId) this.stop(jobId)
    }
  }

  /** The number of jobs that count; the sweep timer runs while it is not zero. */
  get size(): number {
    return this.jobs.size
  }

  private countOf(windowId: number): number {
    let count = 0
    for (const job of this.jobs.values()) if (job.windowId === windowId) count += 1
    return count
  }

  private stop(jobId: string): void {
    this.jobs.delete(jobId)
    this.cancel(jobId)
  }

  private attach(window: TrackedWindow): void {
    if (this.attached.has(window.id)) return
    this.attached.add(window.id)
    const stopAll = (): void => this.cancelWindow(window.id)
    // A main-frame navigation to another document: a reload, a link, a crash page.
    // A hash change or a subframe leaves the page, and its decodes, in place.
    window.on('did-start-navigation', (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
      if (details?.isMainFrame === true && details.isSameDocument !== true) stopAll()
    })
    window.on('render-process-gone', stopAll)
    window.once('destroyed', () => {
      stopAll()
      this.attached.delete(window.id)
    })
  }
}
