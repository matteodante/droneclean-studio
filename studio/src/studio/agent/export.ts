/**
 * `export` on the editor page (task 2.2, design §4.7).
 *
 * The MCP tool's script calls `window.studioAgent.export(request)`; this module
 * is what it finds there (`installAgentExport`). One call does one of three
 * things, always through the SDK: queue a job (`start`), read one (`jobId`) or
 * stop one (`jobId` + `cancel`). `waitMs` then waits for that job to reach a
 * finished state, for at most that long.
 *
 * The SDK's render queue is the job table: this module reads it with
 * `studio.export.jobs()` / `status()` and adds only what the tool's contract
 * needs on top of the SDK's own shapes:
 *
 * - one export at a time per project (a second `start` while one runs is
 *   `CONFLICT`, naming the running job);
 * - a `NOT_FOUND` for an unknown `jobId` that lists the ids the queue holds;
 * - a wait that answers the job itself when it ended cancelled or failed —
 *   `studio.export.wait` throws `EXPORT_FAILED` for those, which is right for
 *   a script but not for a poll.
 *
 * Nothing here renders: `export.start` only queues, and the app's render queue
 * runner (`RenderQueueRunner`, mounted at the app root in `src/routes/__root.tsx`)
 * drains it whichever route is open, so a call answers without waiting for the
 * render (design §4.7: `export` never blocks). A queued job carries its own
 * snapshot of the timeline, so an agent export never moves the window:
 * navigating to the editor route would reload the timeline from the project
 * file and clear the undo history.
 *
 * A start saves the project first (`studio.project.save()`, which neither
 * navigates nor touches the undo history). An agent's edits live only in the
 * page until a save writes them, and the app the MCP launcher starts has no
 * editor route and so no auto-save: on 19 Nov 2026 the page of the MCP tour
 * crashed during its first export and every edit of the session was lost. A
 * save that fails fails the start, and nothing is queued.
 */
import type { ExportJobJson, ExportRequest } from '../../../mcp/protocol'
import type { ExportJobInfo, ExportStartInput, Studio } from '../sdk/types'
import {
  StudioError,
  formatValidValues,
  formatValue,
  invalidArgumentError,
  studioError,
} from '../sdk/errors'

/** Longest `waitMs` the bridge accepts (design §4.7); the tool's schema caps it too. */
const MAX_WAIT_MS = 240_000

/** What `installAgentExport` puts on `globalThis.studioAgent`. */
interface AgentExportBridge {
  /** One `export` call of the MCP tool: queue, read or stop a job. */
  export(request: ExportRequest): Promise<ExportJobJson>
}

/** The page global the tool's script calls; other agent modules add their own keys. */
type AgentGlobal = typeof globalThis & {
  studioAgent?: Partial<AgentExportBridge>
}

/** The page's SDK, installed by `installStudio()` (`src/main.tsx`). */
type StudioGlobal = typeof globalThis & { studio?: Studio }

/** The current project id, or `undefined` while no project is open. */
function currentProjectId(studio: Studio): string | undefined {
  return studio.project.current()?.id
}

/** The job this project is rendering or waiting to render, if any. */
function runningJobFor(studio: Studio, projectId: string): ExportJobInfo | undefined {
  return studio.export
    .jobs()
    .find(
      (job) =>
        job.projectId === projectId && (job.status === 'queued' || job.status === 'rendering'),
    )
}

/** One project may render one job at a time; the queue serialises the rest. */
function conflictError(running: ExportJobInfo): StudioError {
  return studioError({
    code: 'CONFLICT',
    method: 'export.start',
    message:
      `job ${formatValue(running.id)} is already ${running.status} for this project ` +
      `(${Math.round(running.progress)}%); one export runs at a time`,
    hint: 'export({ jobId }) reports it; export({ jobId, cancel: true }) stops it before starting another.',
  })
}

/** The job with that id, or a `NOT_FOUND` that lists the queue's ids. */
function requireJob(studio: Studio, jobId: string): ExportJobInfo {
  const job = studio.export.status(jobId)
  if (job) return job
  const valid = studio.export.jobs().map((candidate) => candidate.id)
  throw studioError({
    code: 'NOT_FOUND',
    method: 'export',
    argument: 'jobId',
    valid,
    message: `"jobId" must be an existing export job id (got ${formatValue(jobId)})${
      valid.length > 0 ? `; valid: ${formatValidValues(valid)}` : '; the queue is empty'
    }`,
    hint: 'studio.export.jobs() lists the queue.',
  })
}

/** Whether the value is a JSON object, as every request and start option must be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An `INVALID_ARGUMENT` of this bridge, in the SDK's message form. */
function invalid(
  argument: string,
  expectation: string,
  value: unknown,
  hint?: string,
): StudioError {
  return invalidArgumentError({
    method: 'export',
    argument,
    expectation,
    value,
    ...(hint !== undefined && { hint }),
  })
}

/** A validated request: exactly one form, plus the optional wait. */
type ExportCall =
  | {
      /** Queue a job with these options. */
      form: 'start'
      start: Record<string, unknown>
      /** How long to wait for the job afterwards; `undefined` answers at once. */
      waitMs?: number
    }
  | {
      /** Read the job with this id. */
      form: 'read'
      jobId: string
      waitMs?: number
    }
  | {
      /** Stop the job with this id. */
      form: 'cancel'
      jobId: string
      waitMs?: number
    }

/** The fields of one request, each checked on its own. */
interface ExportFields {
  start?: Record<string, unknown>
  jobId?: string
  cancel: boolean
  waitMs?: number
}

/** `waitMs` as the contract allows it: a whole 0..240000 milliseconds. */
function requireWaitMs(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_WAIT_MS) {
    return value
  }
  throw invalid(
    'waitMs',
    `an integer from 0 to ${MAX_WAIT_MS}`,
    value,
    'Without waitMs the call answers as soon as the job is queued or read.',
  )
}

/** The `start` options as the SDK will take them: an object when present. */
function requireStart(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw invalid('start', 'an object of export.start options', value)
  return value
}

/** The job id a call reads or stops: a non-empty string when present. */
function requireJobId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '') {
    throw invalid('jobId', 'a non-empty job id', value)
  }
  return value
}

/** Whether the call stops the job it names. */
function requireCancel(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw invalid('cancel', 'a boolean', value)
  return value
}

/**
 * The fields of one request, each checked on its own. The start options
 * themselves are left to `studio.export.start`, which validates each of them
 * and says what it wants.
 * @throws INVALID_ARGUMENT when the request or one of its fields has the wrong type
 */
function requireFields(request: unknown): ExportFields {
  if (!isRecord(request)) {
    throw invalid('request', 'an object with start, jobId or both jobId and cancel', request)
  }
  const start = requireStart(request.start)
  const jobId = requireJobId(request.jobId)
  const cancel = requireCancel(request.cancel)
  const waitMs = requireWaitMs(request.waitMs)
  return {
    ...(start !== undefined && { start }),
    ...(jobId !== undefined && { jobId }),
    cancel,
    ...(waitMs !== undefined && { waitMs }),
  }
}

/**
 * The request as one of the three forms the contract has: a start, a read, or
 * a read with `cancel`. `waitMs` may ride along with any of them.
 * @throws INVALID_ARGUMENT when no form, or more than one, is given
 */
function requireCall(request: unknown): ExportCall {
  const { start, jobId, cancel, waitMs } = requireFields(request)
  const wait = waitMs === undefined ? {} : { waitMs }
  if (start !== undefined) {
    if (jobId !== undefined) {
      throw invalid(
        'jobId',
        'absent from a call that starts a job',
        jobId,
        'A call starts one job or reads one; use the jobId that start returned.',
      )
    }
    return { form: 'start', start, ...wait }
  }
  if (jobId === undefined) {
    if (cancel) {
      throw invalid(
        'jobId',
        'given when "cancel" is true',
        jobId,
        'Pass the jobId a start returned, then cancel that job.',
      )
    }
    throw studioError({
      code: 'INVALID_ARGUMENT',
      method: 'export',
      message:
        'nothing to do: pass "start" to queue a job, "jobId" to read one, or "jobId" with "cancel": true to stop one',
      hint: 'export({ start: {} }) queues; export({ jobId }) reports; export({ jobId, cancel: true }) stops.',
    })
  }
  return cancel ? { form: 'cancel', jobId, ...wait } : { form: 'read', jobId, ...wait }
}

/**
 * One project may render one job at a time: a second start is the `CONFLICT`
 * naming the running job.
 */
function requireStartable(studio: Studio): void {
  const projectId = currentProjectId(studio)
  const running = projectId === undefined ? undefined : runningJobFor(studio, projectId)
  if (running) throw conflictError(running)
}

/**
 * Wait for `jobId` when the caller asked to, then answer the job as it is.
 *
 * `studio.export.wait` returns a job that is still rendering when its timeout
 * runs out, and throws `EXPORT_FAILED` when the job ended cancelled or failed;
 * both are ordinary outcomes for a poll, so the job's own status is what the
 * caller gets back.
 */
async function waitForJob(
  studio: Studio,
  jobId: string,
  waitMs: number | undefined,
): Promise<ExportJobInfo> {
  if (waitMs === undefined) return requireJob(studio, jobId)
  try {
    return await studio.export.wait(jobId, { timeoutMs: waitMs })
  } catch (error) {
    if (error instanceof StudioError && error.code === 'EXPORT_FAILED') {
      return requireJob(studio, jobId)
    }
    throw error
  }
}

/**
 * One `export` call of the MCP tool, answered from the page's SDK.
 *
 * A start saves the open project and queues; a read and a cancel use the
 * queue as it is.
 * @throws StudioError of the SDK (INVALID_ARGUMENT, NOT_FOUND, UNSUPPORTED for
 * no open project, INTERNAL of a save that failed, EXPORT_FAILED of a wait) or
 * `CONFLICT` for a second start
 */
export async function exportOnPage(studio: Studio, request: unknown): Promise<ExportJobJson> {
  const call = requireCall(request)
  if (call.form === 'start') {
    requireStartable(studio)
    // With no project open, `export.start` says so itself; there is nothing to save.
    if (studio.project.current() !== null) await studio.project.save()
    const started = await studio.export.start(call.start as ExportStartInput)
    return call.waitMs === undefined ? started : waitForJob(studio, started.id, call.waitMs)
  }
  if (call.form === 'cancel') {
    requireJob(studio, call.jobId)
    studio.export.cancel(call.jobId)
  }
  return waitForJob(studio, call.jobId, call.waitMs)
}

/** The page's SDK, or the `UNSUPPORTED` a page that is still starting raises. */
function pageStudio(): Studio {
  const { studio } = globalThis as StudioGlobal
  if (!studio) {
    throw studioError({
      code: 'UNSUPPORTED',
      method: 'export',
      message: 'the editor SDK is not installed on this page yet',
      hint: 'Wait for the editor to finish loading and call export again.',
    })
  }
  return studio
}

/**
 * Expose `exportOnPage` as `window.studioAgent.export` for the MCP tool's
 * script. The SDK is read at call time, so installing before `installStudio()`
 * is harmless; a key another agent module installed is kept.
 */
export function installAgentExport(): void {
  const page = globalThis as AgentGlobal
  page.studioAgent = {
    ...page.studioAgent,
    export: (request: ExportRequest) => exportOnPage(pageStudio(), request),
  }
}
