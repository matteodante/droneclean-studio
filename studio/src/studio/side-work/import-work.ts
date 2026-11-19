/**
 * The work an import leads to, put through the scheduler (task 8.7, design sections 4.1 and 4.3, slice I1).
 *
 * Each imported clip gets, in this order of urgency:
 *  - its filmstrip (`decode` lane) and, when it can be stabilized, its motion data (`motion` lane: the engine reads and
 *    records the gyro trace once, so opening the clip for stabilization later reads the trace and not the file). The
 *    first clip of an import, the one the pilot is waiting for, goes at `interactive` priority; the others at `import`.
 *
 * Proxies are not queued here: they are made when the pilot asks for them.
 *
 * "First" is the clip that arrives when no earlier clip still has work pending: the first of a batch of six, and also
 * a clip imported later on a quiet scheduler. A job's failure is logged and never the import's.
 *
 * Nothing here knows the media library or the engines: the runners and the questions (does the clip carry gyro data,
 * does the pilot want proxies) are inputs, so the queueing is tested as plain code. The media library builds the one
 * the app uses (`import-media.ts`, beside this file).
 */
import { createLogger } from '@/shared/logging/logger'
import type { Priority, SideWorkScheduler } from './scheduler'

const logger = createLogger('ImportSideWork')

export interface ImportWorkRunners<T> {
  /** Extracts the clip's filmstrip into the filmstrip cache */
  filmstrip(clip: T, signal: AbortSignal): Promise<void>
  /** Opens the clip's file on the gyro engine so its parsed motion data is cached, then lets the engine go */
  motionData(clip: T, signal: AbortSignal): Promise<void>
}

export interface ImportWorkOptions<T> {
  scheduler: SideWorkScheduler
  runners: ImportWorkRunners<T>
  /** Whether the clip is worth any work (a video) */
  isVideo(clip: T): boolean
  /** Whether the clip carries motion data the gyro engine can use */
  canStabilize(clip: T): boolean
  /** The user's filmstrip settings */
  wantsFilmstrips(): boolean
  /** A name for logs */
  nameOf(clip: T): string
}

export interface ImportWork<T> {
  /** Queues the work of one imported clip. Returns when the clip's jobs are queued, not when they are done. */
  queue(clip: T): void
  /** Resolves when every job queued so far has finished (the tests and the bench use it) */
  idle(): Promise<void>
}

export function createImportWork<T>(options: ImportWorkOptions<T>): ImportWork<T> {
  const { scheduler, runners } = options
  let pendingClips = 0
  let order = 0
  const settled = new Set<Promise<unknown>>()

  const track = (promise: Promise<unknown>): Promise<unknown> => {
    const safe = promise.catch(() => {})
    settled.add(safe)
    void safe.then(() => settled.delete(safe))
    return safe
  }

  return {
    queue(clip) {
      if (!options.isVideo(clip)) return
      const first = pendingClips === 0
      const priority: Priority = first ? 'interactive' : 'import'
      const sequence = order++
      const label = options.nameOf(clip)
      const jobs: Promise<unknown>[] = []

      const submit = (
        kind: string,
        lane: 'decode' | 'motion',
        jobPriority: Priority,
        run: (signal: AbortSignal) => Promise<void>,
      ) => {
        jobs.push(
          scheduler
            .run(
              { lane, priority: jobPriority, order: sequence, label: `${kind}:${label}` },
              (ctx) => run(ctx.signal),
            )
            .catch((error: unknown) => {
              logger.warn(`${kind} of ${label} did not finish`, {
                error: error instanceof Error ? error.message : String(error),
              })
            }),
        )
      }

      if (options.wantsFilmstrips()) {
        submit('filmstrip', 'decode', priority, (signal) => runners.filmstrip(clip, signal))
      }
      if (options.canStabilize(clip)) {
        submit('motion-data', 'motion', priority, (signal) => runners.motionData(clip, signal))
      }

      if (jobs.length === 0) return
      pendingClips += 1
      track(
        Promise.all(jobs).finally(() => {
          pendingClips -= 1
        }),
      )
    },
    async idle() {
      while (settled.size > 0) await Promise.all([...settled])
    },
  }
}
