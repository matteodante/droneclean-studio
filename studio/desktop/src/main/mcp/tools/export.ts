/**
 * `export`: start a render, report its progress and stop it (task 2.2, design
 * §4.7).
 *
 * The MCP contract (`ExportRequest` / `ExportResult` in `studio/mcp/protocol.d.ts`)
 * is the SDK's own export shape: a `start` queues a job and answers it at once,
 * a `jobId` reads the job, `jobId` + `cancel` stops it, and `waitMs` waits for
 * it. The page side is `src/studio/agent/export.ts`, installed as
 * `window.studioAgent.export`; this tool sends it the request as JSON and
 * carries the answer back untouched. Nothing renders here: the editor's own
 * render queue does, so an export that takes minutes never holds the call open
 * (design §4.7).
 *
 * Timing is the contract's other half: without `waitMs` a read or a cancel
 * answers within a second or fails as `TIMEOUT` — the agent polls instead of
 * blocking, because Codex gives a tool 60 s and Claude Code drops a silent HTTP
 * call at 5 min. A start saves the project before it queues
 * (`src/studio/agent/export.ts`), and a save writes a cover picture, which in
 * the hidden app (no preview to copy) is a render of a frame: a start has
 * `START_DEADLINE_MS`. With `waitMs` the call may wait as long as the caller
 * asked (at most `MAX_WAIT_MS`), plus the same five-second grace `run` uses.
 */
import path from 'node:path'
import type { ExportRequest, ExportResult } from '../../../../../mcp/protocol'
import { agentError, isStudioErrorJson } from '../errors'
import { PageTimeoutError, RUN_ABORT_GLOBAL } from '../page'
import { pageFailureOutcome } from './page-failure'
import { MAX_EXPORT_WAIT_MS } from '../protocol'
import type { PageBridge, ToolOutcome } from '../types'

/** Longest a read or a cancel may wait for the page when the caller named no `waitMs`. */
const CALL_DEADLINE_MS = 1000

/** Longest a start may take to save the project and queue its job, before any `waitMs`. */
const START_DEADLINE_MS = 30_000

/** Added to a caller's `waitMs`, as `run` adds the contract's `RunTimeoutGraceMs`. */
const WAIT_GRACE_MS = 5000

/** Whether the value is a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * How long the page has to answer this call: the caller's own wait when it is
 * a valid one, otherwise the second a polling call is allowed (design §4.7);
 * a start has its save's time on top of either.
 */
function deadlineFor(request: ExportRequest): number {
  const { waitMs } = request
  const save = request.start !== undefined ? START_DEADLINE_MS : 0
  if (
    typeof waitMs === 'number' &&
    Number.isInteger(waitMs) &&
    waitMs >= 0 &&
    waitMs <= MAX_EXPORT_WAIT_MS
  ) {
    return save + waitMs + WAIT_GRACE_MS
  }
  return save > 0 ? save : CALL_DEADLINE_MS
}

/**
 * The JavaScript expression sent to the editor page. It is a self-contained
 * IIFE: no identifier of this file is visible in the page, and
 * `globalThis.studioAgent.export` is the page side
 * (`src/studio/agent/export.ts`), installed with the SDK.
 */
export function buildExportScript(request: ExportRequest): string {
  return `(async () => {
  const bridge = globalThis.studioAgent
  if (!bridge || typeof bridge.export !== 'function') {
    return { error: { name: 'StudioError', code: 'UNSUPPORTED', message: 'export: the editor is still starting; window.studioAgent is not installed yet', hint: 'Wait a few seconds and call export again.' } }
  }
  // A fresh signal: an earlier call that was stopped must not stop this one's SDK calls.
  globalThis.${RUN_ABORT_GLOBAL} = new AbortController()
  try {
    const job = await bridge.export(${JSON.stringify(request)})
    return { job }
  } catch (error) {
    const json = error && typeof error.toJSON === 'function'
      ? error.toJSON()
      : { name: 'StudioError', code: 'INTERNAL', message: String(error && error.message ? error.message : error) }
    return { error: json }
  }
})()`
}

/** The `TIMEOUT` a page that never answered maps to. */
function timeoutError(deadline: number, starting: boolean): ToolOutcome {
  return {
    error: agentError('TIMEOUT', `export: the editor did not answer within ${deadline} ms`, {
      hint: starting
        ? 'The save or the queue may still finish in the page: start again once the page answers, and a CONFLICT names the job if it was queued.'
        : 'The app may be busy; call again, or pass waitMs to allow a longer wait (max 240000).',
    }).json,
  }
}

/** Narrow the page's answer to an export job. */
function isExportJob(value: unknown): value is ExportResult {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.progress === 'number'
  )
}

/**
 * The job with `absolutePath` beside its `savedPath` when the workspace folder is known and the saved path lies inside
 * it; the job as the page answered it otherwise.
 */
function withAbsolutePath(job: ExportResult, workspaceFolder: string | null): ExportResult {
  if (workspaceFolder === null || typeof job.savedPath !== 'string' || job.savedPath.length === 0) return job
  const absolute = path.resolve(workspaceFolder, job.savedPath)
  const relative = path.relative(workspaceFolder, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return job
  return { ...job, absolutePath: absolute }
}

/**
 * Send one `export` call to the page and answer its result or the
 * `StudioError` JSON it threw. `page` is the server's bridge to the editor; the
 * tool answers `UNSUPPORTED` without one, so a server that forgets to wire it
 * fails as a typed error rather than as a crash.
 */
export async function exportTool(
  request: ExportRequest,
  page?: PageBridge,
  workspaceFolder: () => string | null = () => null,
): Promise<ToolOutcome> {
  if (!page) {
    return {
      error: agentError('UNSUPPORTED', 'export: the MCP server has no editor page to send this call to', {
        hint: 'Restart the app; if it keeps happening, this build does not connect the export tool to the editor.',
      }).json,
    }
  }
  const deadline = deadlineFor(request)
  let answer: unknown
  try {
    answer = await page.execute(buildExportScript(request), deadline)
  } catch (error) {
    if (error instanceof PageTimeoutError) return timeoutError(deadline, request.start !== undefined)
    const failure = pageFailureOutcome('export', error)
    if (failure !== null) return failure
    throw error
  }

  if (!isRecord(answer)) {
    return {
      error: agentError('INTERNAL', 'export: the editor answered no result', {
        hint: 'Try again; if it keeps happening, reload the app.',
      }).json,
    }
  }
  if (answer.error !== undefined) {
    if (isStudioErrorJson(answer.error)) return { error: answer.error }
    return {
      error: agentError(
        'INTERNAL',
        `export: the editor answered an unknown error ${JSON.stringify(answer.error)}`,
      ).json,
    }
  }
  if (!isExportJob(answer.job)) {
    return {
      error: agentError('INTERNAL', 'export: the editor answered a job this build does not understand').json,
    }
  }
  return { result: withAbsolutePath(answer.job, workspaceFolder()) }
}
