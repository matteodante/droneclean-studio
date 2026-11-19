/**
 * `export` on the page side (task 2.2, design §4.7).
 *
 * The MCP tool's script reaches `window.studioAgent.export`; these tests drive
 * the module behind it with a fake SDK so each rule the bridge adds over
 * `studio.export` is pinned: one job per project, a NOT_FOUND that lists the
 * queue, and a wait that answers a cancelled or failed job instead of throwing.
 * The SDK's own tests (`src/studio/sdk/namespaces/export.test.ts`) pin the
 * queue itself.
 */

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { router } from '@/app/router'
import type { ExportJobInfo, ExportWaitOptions, Studio } from '../sdk/types'
import { StudioError } from '../sdk/errors'
import type { ExportRequest } from '../../../mcp/protocol'
import { exportOnPage, installAgentExport } from './export'

vi.mock('@/app/router', () => ({ router: { navigate: vi.fn() } }))

/** One job as the SDK's queue holds it. */
function makeJob(overrides: Partial<ExportJobInfo> = {}): ExportJobInfo {
  return {
    id: 'job-1',
    name: 'Flight',
    projectId: 'project-1',
    status: 'queued',
    progress: 0,
    inPoint: 0,
    outPoint: 150,
    durationFrames: 150,
    exportMode: 'video',
    fileName: 'Flight.mp4',
    createdAt: 1,
    ...overrides,
  }
}

/** What the fake SDK holds and what the bridge asked it to do. */
interface FakeQueue {
  jobs: ExportJobInfo[]
  starts: unknown[]
  cancels: string[]
  waits: Array<{ id: string; options?: ExportWaitOptions }>
  /** How many times the bridge saved the project. */
  saves: number
  /** How many saves had happened when each start reached the queue. */
  savesAtStart: number[]
}

/** The fake SDK and the queue behind it. */
interface FakeStudio {
  studio: Studio
  queue: FakeQueue
}

/** Options of the fake SDK. */
interface FakeStudioOptions {
  /** Id of the open project; `null` for no open project. */
  projectId?: string | null
  /** Jobs already in the queue. */
  jobs?: ExportJobInfo[]
  /** What `export.start` throws instead of queueing. */
  startError?: Error
  /** What `project.save` throws instead of saving. */
  saveError?: Error
  /** Whether `export.cancel` reaches the runner at once (default `true`). */
  cancelLands?: boolean
  /** What `export.wait` does; the SDK's rules by default. */
  wait?: (id: string, options?: ExportWaitOptions) => Promise<ExportJobInfo>
}

/** A fake SDK that follows `studio.export`'s shapes for the bridge's rules. */
function createFakeStudio(options: FakeStudioOptions = {}): FakeStudio {
  const projectId = options.projectId === undefined ? 'project-1' : options.projectId
  const queue: FakeQueue = {
    jobs: options.jobs ?? [],
    starts: [],
    cancels: [],
    waits: [],
    saves: 0,
    savesAtStart: [],
  }
  let next = 1
  const find = (id: string): ExportJobInfo | undefined =>
    queue.jobs.find((job) => job.id === id)
  const exportApi = {
    jobs: () => queue.jobs.map((job) => ({ ...job })),
    start: async (input: unknown) => {
      queue.starts.push(input)
      queue.savesAtStart.push(queue.saves)
      if (options.startError) throw options.startError
      const job = makeJob({
        id: `job-${next++}`,
        ...(projectId === null ? { projectId: undefined } : { projectId }),
      })
      queue.jobs.push(job)
      return { ...job }
    },
    status: (id: string) => {
      const job = find(id)
      return job ? { ...job } : null
    },
    cancel: (id: string) => {
      queue.cancels.push(id)
      const job = find(id)
      if (job && options.cancelLands !== false && job.status !== 'completed') {
        job.status = 'cancelled'
        job.finishedAt = 2
      }
    },
    wait: async (id: string, waitOptions?: ExportWaitOptions) => {
      queue.waits.push({ id, ...(waitOptions !== undefined && { options: waitOptions }) })
      if (options.wait) return options.wait(id, waitOptions)
      const job = find(id)
      if (!job) {
        throw new StudioError({
          code: 'NOT_FOUND',
          message: `export.wait: "id" must be an existing export job id (got ${JSON.stringify(id)})`,
        })
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new StudioError({
          code: 'EXPORT_FAILED',
          message: `export.wait: job ${JSON.stringify(id)} ${
            job.status === 'cancelled' ? 'was cancelled' : 'failed'
          }`,
        })
      }
      // A job that is still rendering when the wait's timeout runs out.
      return { ...job }
    },
  }
  const studio = {
    project: {
      current: () => (projectId === null ? null : { id: projectId }),
      save: async () => {
        queue.saves += 1
        if (options.saveError) throw options.saveError
      },
    },
    export: exportApi,
  } as unknown as Studio
  return { studio, queue }
}

/** The globals `installAgentExport` writes and reads. */
interface AgentTestGlobal {
  studio?: Studio
  studioAgent?: {
    export?: (request: ExportRequest) => Promise<unknown>
    corpus?: unknown
  }
}

/** `globalThis` without the SDK's own `declare global`, so the keys may be deleted. */
function pageGlobal(): AgentTestGlobal {
  return globalThis as unknown as AgentTestGlobal
}

afterEach(() => {
  vi.mocked(router.navigate).mockClear()
  useTimelineCommandStore.setState({ undoStack: [], canUndo: false })
  delete pageGlobal().studio
  delete pageGlobal().studioAgent
})


/** Run `run` and return the `StudioError` it threw. */
async function caught(run: () => Promise<unknown>): Promise<StudioError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('the call did not throw')
}

describe('export({ start })', () => {
  it('queues the job through the SDK and answers it', async () => {
    const fake = createFakeStudio()

    const job = await exportOnPage(
      fake.studio,
      { start: { inPoint: 0, outPoint: 150, name: 'Five seconds', settings: { codec: 'h265' } } },
    )

    expect(fake.queue.starts).toEqual([
      { inPoint: 0, outPoint: 150, name: 'Five seconds', settings: { codec: 'h265' } },
    ])
    expect(job).toMatchObject({ id: 'job-1', status: 'queued', projectId: 'project-1' })
  })

  it('refuses a second start while this project has a job, naming it', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'rendering', progress: 40 })] })

    const error = await caught(() => exportOnPage(fake.studio, { start: {} }))

    expect(error.code).toBe('CONFLICT')
    expect(error.message).toMatch(/^export\.start: /)
    expect(error.message).toContain('"job-1"')
    expect(error.message).toContain('rendering')
    expect(error.hint).toContain('jobId')
    expect(fake.queue.starts).toEqual([])
  })

  it('refuses a second start while this project has a queued job', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'queued' })] })

    const error = await caught(() => exportOnPage(fake.studio, { start: {} }))

    expect(error.code).toBe('CONFLICT')
  })

  it('allows a start once the project’s job finished', async () => {
    const fake = createFakeStudio({
      jobs: [makeJob({ status: 'completed', progress: 100 })],
    })

    const job = await exportOnPage(fake.studio, { start: {} })

    expect(job.id).toBe('job-1')
  })

  it('allows a start while a job of another project runs', async () => {
    const fake = createFakeStudio({
      jobs: [makeJob({ projectId: 'another-project', status: 'rendering' })],
    })

    const job = await exportOnPage(fake.studio, { start: {} })

    expect(job.id).toBe('job-1')
  })

  it('reports the SDK’s UNSUPPORTED for a page with no project open', async () => {
    const fake = createFakeStudio({
      projectId: null,
      startError: new StudioError({
        code: 'UNSUPPORTED',
        message: 'export.start: no project is open, so there is no editor to render the job',
      }),
    })

    const error = await caught(() => exportOnPage(fake.studio, { start: {} }))

    expect(error.code).toBe('UNSUPPORTED')
    expect(error.message).toMatch(/^export\.start: /)
  })

  it('waits for the job it just started when waitMs is given', async () => {
    const fake = createFakeStudio()

    const job = await exportOnPage(fake.studio, { start: {}, waitMs: 1500 })

    expect(fake.queue.waits).toEqual([{ id: 'job-1', options: { timeoutMs: 1500 } }])
    expect(job.id).toBe('job-1')
  })
})

describe('an agent export never moves the window', () => {
  it('starts a job from the projects page without navigating or touching the undo history', async () => {
    window.history.pushState({}, '', '/projects')
    useTimelineCommandStore.setState({
      undoStack: [{ command: { type: 'CLIPS_SPLIT' }, beforeSnapshot: {} as never, timestamp: 1 }],
      canUndo: true,
    })
    const fake = createFakeStudio()

    const job = await exportOnPage(fake.studio, { start: {} })

    expect(router.navigate).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/projects')
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(fake.queue.starts).toEqual([{}])
    expect(job.id).toBe('job-1')
  })

  it('leaves a window on another project’s editor page where it is', async () => {
    window.history.pushState({}, '', '/editor/another-project')
    const fake = createFakeStudio()

    await exportOnPage(fake.studio, { start: {} })

    expect(router.navigate).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/editor/another-project')
  })

  it('leaves the SDK’s UNSUPPORTED standing when no project is open', async () => {
    const fake = createFakeStudio({
      projectId: null,
      startError: new StudioError({
        code: 'UNSUPPORTED',
        message: 'export.start: no project is open, so there is no editor to render the job',
      }),
    })

    const error = await caught(() => exportOnPage(fake.studio, { start: {} }))

    expect(error.code).toBe('UNSUPPORTED')
    expect(router.navigate).not.toHaveBeenCalled()
  })

  it('refuses a second start with a CONFLICT before anything else happens', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'rendering', progress: 40 })] })

    const error = await caught(() => exportOnPage(fake.studio, { start: {} }))

    expect(error.code).toBe('CONFLICT')
    expect(fake.queue.starts).toEqual([])
  })
})

describe('export({ jobId })', () => {
  it('answers the job as the queue holds it, progress included', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'rendering', progress: 10 })] })

    const first = await exportOnPage(fake.studio, { jobId: 'job-1' })
    fake.queue.jobs[0]!.progress = 45
    const second = await exportOnPage(fake.studio, { jobId: 'job-1' })

    expect(first.progress).toBe(10)
    expect(second.progress).toBe(45)
    expect(fake.queue.waits).toEqual([])
  })

  it('answers NOT_FOUND with the ids the queue holds', async () => {
    const fake = createFakeStudio({
      jobs: [makeJob({ id: 'job-1' }), makeJob({ id: 'job-2', status: 'completed' })],
    })

    const error = await caught(() => exportOnPage(fake.studio, { jobId: 'job-9' }))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('jobId')
    expect(error.valid).toEqual(['job-1', 'job-2'])
    expect(error.message).toContain('"job-9"')
    expect(error.message).toContain('"job-1", "job-2"')
  })

  it('says the queue is empty when it is', async () => {
    const fake = createFakeStudio()

    const error = await caught(() => exportOnPage(fake.studio, { jobId: 'job-9' }))

    expect(error.message).toContain('the queue is empty')
  })
})

describe('export({ jobId, cancel })', () => {
  it('stops the job and answers it cancelled', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'rendering', progress: 30 })] })

    const job = await exportOnPage(fake.studio, { jobId: 'job-1', cancel: true })

    expect(fake.queue.cancels).toEqual(['job-1'])
    expect(job.status).toBe('cancelled')
  })

  it('answers the job as it is when the abort has not reached the runner yet', async () => {
    const fake = createFakeStudio({
      jobs: [makeJob({ status: 'rendering', progress: 30 })],
      cancelLands: false,
    })

    const job = await exportOnPage(fake.studio, { jobId: 'job-1', cancel: true })

    expect(fake.queue.cancels).toEqual(['job-1'])
    expect(job.status).toBe('rendering')
  })

  it('waits for the cancellation when waitMs is given', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'rendering', progress: 30 })] })

    const job = await exportOnPage(fake.studio, { jobId: 'job-1', cancel: true, waitMs: 4000 })

    expect(fake.queue.cancels).toEqual(['job-1'])
    expect(fake.queue.waits).toEqual([{ id: 'job-1', options: { timeoutMs: 4000 } }])
    expect(job.status).toBe('cancelled')
  })

  it('does not cancel an unknown id', async () => {
    const fake = createFakeStudio()

    const error = await caught(() => exportOnPage(fake.studio, { jobId: 'job-9', cancel: true }))

    expect(error.code).toBe('NOT_FOUND')
    expect(fake.queue.cancels).toEqual([])
  })
})

describe('export({ jobId, waitMs })', () => {
  it('answers the job when the wait times out while it is still rendering', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'rendering', progress: 55 })] })

    const job = await exportOnPage(fake.studio, { jobId: 'job-1', waitMs: 250 })

    expect(job.progress).toBe(55)
    expect(fake.queue.waits).toEqual([{ id: 'job-1', options: { timeoutMs: 250 } }])
  })

  it('answers a job that ended cancelled instead of throwing EXPORT_FAILED', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'cancelled', finishedAt: 2 })] })

    const job = await exportOnPage(fake.studio, { jobId: 'job-1', waitMs: 1000 })

    expect(job.status).toBe('cancelled')
  })

  it('answers a job that failed, with its error', async () => {
    const fake = createFakeStudio({
      jobs: [makeJob({ status: 'failed', error: 'the encoder gave up', finishedAt: 2 })],
    })

    const job = await exportOnPage(fake.studio, { jobId: 'job-1', waitMs: 1000 })

    expect(job.status).toBe('failed')
    expect(job.error).toBe('the encoder gave up')
  })

  it('lets the SDK’s other errors through', async () => {
    const fake = createFakeStudio({
      wait: async () => {
        throw new StudioError({ code: 'INTERNAL', message: 'export.wait: the queue is unreadable' })
      },
    })

    const error = await caught(() => exportOnPage(fake.studio, { jobId: 'job-1', waitMs: 10 }))

    expect(error.code).toBe('INTERNAL')
  })
})

describe('the request', () => {
  it.each([
    [{}, /nothing to do/],
    [{ start: {}, jobId: 'job-1' }, /"jobId" must be absent from a call that starts a job/],
    [{ cancel: true }, /"jobId" must be given when "cancel" is true/],
    [{ jobId: '' }, /"jobId" must be a non-empty job id/],
    [{ start: 'yes' }, /"start" must be an object of export\.start options/],
    [{ jobId: 'job-1', cancel: 'yes' }, /"cancel" must be a boolean/],
    [{ waitMs: -1 }, /"waitMs" must be an integer from 0 to 240000/],
    [{ waitMs: 1.5 }, /"waitMs" must be an integer from 0 to 240000/],
    [{ waitMs: 240_001 }, /"waitMs" must be an integer from 0 to 240000/],
    [{ start: {}, waitMs: 'soon' }, /"waitMs" must be an integer from 0 to 240000/],
  ] as Array<[unknown, RegExp]>)('rejects %j', async (request, message) => {
    const fake = createFakeStudio()

    const error = await caught(() => exportOnPage(fake.studio, request))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.message).toMatch(/^export: /)
    expect(error.message).toMatch(message)
    expect(fake.queue.starts).toEqual([])
    expect(fake.queue.cancels).toEqual([])
    expect(fake.queue.waits).toEqual([])
  })

  it('accepts waitMs 0, the shortest wait', async () => {
    const fake = createFakeStudio()

    await exportOnPage(fake.studio, { start: {}, waitMs: 0 })

    expect(fake.queue.waits).toEqual([{ id: 'job-1', options: { timeoutMs: 0 } }])
  })

  it('accepts waitMs 240000, the longest wait', async () => {
    const fake = createFakeStudio({ jobs: [makeJob()] })

    await exportOnPage(fake.studio, { jobId: 'job-1', waitMs: 240_000 })

    expect(fake.queue.waits).toEqual([{ id: 'job-1', options: { timeoutMs: 240_000 } }])
  })

  it.each([[null], [[]], ['start']])('rejects a request that is not an object (%j)', async (request) => {
    const fake = createFakeStudio()

    const error = await caught(() => exportOnPage(fake.studio, request))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('request')
  })
})

describe('installAgentExport', () => {
  it('puts the bridge on window.studioAgent for the tool’s script', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'completed', progress: 100 })] })
    pageGlobal().studio = fake.studio

    installAgentExport()

    const bridge = pageGlobal().studioAgent?.export
    expect(typeof bridge).toBe('function')
    const job = await bridge?.({ jobId: 'job-1' })
    expect(job).toMatchObject({ id: 'job-1', status: 'completed' })
  })

  it('keeps a key another agent module installed', () => {
    pageGlobal().studio = createFakeStudio().studio
    pageGlobal().studioAgent = { corpus: () => 'text' }

    installAgentExport()

    expect(pageGlobal().studioAgent?.corpus).toBeDefined()
    expect(typeof pageGlobal().studioAgent?.export).toBe('function')
  })

  it('answers UNSUPPORTED while the page has no SDK yet', async () => {
    installAgentExport()

    const error = await caught(
      async () => await pageGlobal().studioAgent?.export?.({ jobId: 'job-1' }),
    )

    expect(error.code).toBe('UNSUPPORTED')
    expect(error.message).toMatch(/^export: the editor SDK is not installed/)
  })
})

describe('an agent export saves the project first', () => {
  // The MCP tour (19 Nov 2026): the hidden app has no editor route and no auto-save, the page crashed during the
  // export, and every edit of the session was lost; the tool's description promised a save that never happened.
  it('saves the open project once, before the job is queued', async () => {
    const fake = createFakeStudio()

    await exportOnPage(fake.studio, { start: { inPoint: 0, outPoint: 89 } })

    expect(fake.queue.saves).toBe(1)
    expect(fake.queue.savesAtStart).toEqual([1])
  })

  it('queues nothing when the save fails, and says why', async () => {
    const fake = createFakeStudio({
      saveError: new StudioError({
        code: 'INTERNAL',
        message: 'project.save: the project could not be written: disk full',
      }),
    })

    const error = await caught(() => exportOnPage(fake.studio, { start: {} }))

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toBe('project.save: the project could not be written: disk full')
    expect(fake.queue.starts).toEqual([])
  })

  it('saves nothing when no project is open, and leaves the SDK to say so', async () => {
    const fake = createFakeStudio({
      projectId: null,
      startError: new StudioError({
        code: 'UNSUPPORTED',
        message: 'export.start: no project is open, so there is no editor to render the job',
      }),
    })

    const error = await caught(() => exportOnPage(fake.studio, { start: {} }))

    expect(error.code).toBe('UNSUPPORTED')
    expect(fake.queue.saves).toBe(0)
  })

  it('saves nothing for a second start the CONFLICT refuses, nor for a read', async () => {
    const fake = createFakeStudio({ jobs: [makeJob({ status: 'rendering', progress: 40 })] })

    await caught(() => exportOnPage(fake.studio, { start: {} }))
    await exportOnPage(fake.studio, { jobId: 'job-1' })

    expect(fake.queue.saves).toBe(0)
  })
})
