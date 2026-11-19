/**
 * `run`: a script against the editor's SDK (task 2.2, design §4.4).
 *
 * The script is evaluated in the editor page (where `window.studio` lives) with
 * `studio` in scope, inside `studio.transaction('agent: <label>', …)`, so a
 * synchronous script is exactly one undo step labelled `agent: …`, and Ctrl+Z
 * takes it back in one go. A function expression is called with the SDK
 * (`s => s.clips.list()`); any other expression is its own value
 * (`studio.clips.list()`). When the script returns a promise, the transaction
 * commits the synchronous part first and each awaited SDK call then makes its
 * own entry, exactly as `src/studio/sdk/transaction.ts` documents; `undoSteps`
 * therefore counts the entries of the whole call, while `changes` describes the
 * synchronous part.
 *
 * Timeouts stop waiting, not the script: JavaScript in the page cannot be
 * interrupted. The page races an async value against the call's `timeoutMs`,
 * and main waits at most `timeoutMs + 5000` for the page's answer (a blocked
 * main thread cannot answer at all). The error codes are `TIMEOUT` for both.
 *
 * An abandoned call — a timeout, or an MCP `notifications/cancelled` whose
 * signal aborts the handler — is closed the way design §4.4 says: the tool
 * stops waiting, the script keeps running, and the edits the synchronous part
 * already made are **kept** as the one `agent: <label>` undo entry (they are
 * not rolled back; Ctrl+Z or `studio.history.undo()` takes them back). The
 * timeout answer names how many entries exist when it is produced, and any
 * edit the script makes after the answer is its own later undo entry, labelled
 * by the SDK call that made it. A cancelled call is answered exactly like a
 * timeout (`TIMEOUT`), so the log line says why the tool stopped waiting.
 */
import type { RunRequest, RunResult, StudioErrorJson } from '../../../../../mcp/protocol'
import {
  DEFAULT_RUN_TIMEOUT_MS,
  MAX_RESULT_BYTES,
  MAX_RUN_LABEL_CHARS,
  MAX_RUN_TIMEOUT_MS,
  MAX_SCRIPT_BYTES,
  RUN_TIMEOUT_GRACE_MS,
} from '../protocol'
import { agentError, isStudioErrorJson } from '../errors'
import { PageTimeoutError, RUN_BUSY_GLOBAL } from '../page'
import { pageFailureOutcome } from './page-failure'
import type { PageBridge, ToolOutcome } from '../types'

/** What the page script is called with. */
export interface RunPageScriptOptions {
  /** The script the caller wrote: a function expression or an expression. */
  script: string
  /** Label of the undo entry, without the `agent: ` prefix. */
  label: string
  /** How long the page races an awaited value before it answers `TIMEOUT`. */
  timeoutMs: number
}

/**
 * The JSON an `agent: <label>` undo entry carries (the SDK's command label
 * rule is `<NAMESPACE>_<METHOD>`; the literal `agent: ` marks the origin).
 */
export function agentUndoLabel(label: string): string {
  return `agent: ${label}`
}

/**
 * The JavaScript expression sent to the editor page. It is a self-contained
 * IIFE returning a promise of plain JSON: no identifier of this file is visible
 * in the page, and `globalThis.studio` is task 2.1's SDK.
 *
 * The page-side race is what makes `timeoutMs` work for an awaited script; a
 * synchronous script is not interruptible and main's own timeout is the only
 * guard for it.
 */
export function buildRunScript(options: RunPageScriptOptions): string {
  const script = JSON.stringify(options.script)
  const label = JSON.stringify(agentUndoLabel(options.label))
  const timeoutMs = String(options.timeoutMs)
  return `(async () => {
  const STUDIO = globalThis.studio
  const agentLabel = ${label}
  const startedAt = Date.now()
  const failure = (code, message, extra) =>
    Object.assign({ name: 'StudioError', code, message }, extra || {})
  if (!STUDIO || typeof STUDIO.transaction !== 'function') {
    return { error: failure('UNSUPPORTED', 'run: the editor is still starting; window.studio is not installed yet', { hint: 'Wait a few seconds and call run again.' }) }
  }
  let scriptFn
  try {
    scriptFn = new Function('studio', '"use strict";return (' + ${script} + ')')
  } catch (error) {
    return { error: failure('INVALID_ARGUMENT', 'run: the script could not be parsed: ' + String(error && error.message ? error.message : error), { argument: 'script', hint: 'Pass a function expression such as "s => s.clips.list()", or an expression such as "studio.clips.list()".' }) }
  }
  const evaluate = (studio) => {
    const evaluated = scriptFn(studio)
    return typeof evaluated === 'function' ? evaluated(studio) : evaluated
  }
  const before = STUDIO.history.depth()
  try {
    const outcome = STUDIO.transaction(${label}, (studio) => evaluate(studio))
    let value = outcome.value
    if (value && typeof value.then === 'function') {
      // The page's report that the script is not finished: the bridge refuses a
      // new call while this is set, even after this call answered TIMEOUT.
      globalThis.${RUN_BUSY_GLOBAL} = true
      Promise.resolve(value).then(
        () => { globalThis.${RUN_BUSY_GLOBAL} = false },
        () => { globalThis.${RUN_BUSY_GLOBAL} = false },
      )
      const raced = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ state: 'timeout' }), ${timeoutMs})
        Promise.resolve(value).then(
          (resolved) => { clearTimeout(timer); resolve({ state: 'value', value: resolved }) },
          (rejected) => { clearTimeout(timer); resolve({ state: 'error', error: rejected }) },
        )
      })
      if (raced.state === 'timeout') {
        const kept = Math.max(0, STUDIO.history.depth() - before)
        return {
          error: failure('TIMEOUT', 'run: the script is still running after ' + ${timeoutMs} + ' ms; the tool stopped waiting but the script keeps running', {
            hint: 'The script is not interrupted. ' + (kept > 0 ? 'The ' + kept + ' undo ' + (kept === 1 ? 'entry' : 'entries') + ' it already made ' + (kept === 1 ? 'is' : 'are') + ' kept (its synchronous part is under "' + agentLabel + '"); ' : '') + 'later edits appear as their own undo entries. Make the script resolve sooner, or pass a larger timeoutMs (max 600000).',
          }),
          undoSteps: kept,
          durationMs: Date.now() - startedAt,
        }
      }
      if (raced.state === 'error') throw raced.error
      value = raced.value
    }
    const plain = (input) => {
      try { return JSON.parse(JSON.stringify(input)) } catch { return null }
    }
    return plain({
      value: value === undefined ? null : value,
      changes: outcome.changes || { commands: [], added: [], removed: [], updated: [], undoSteps: 0 },
      undoSteps: Math.max(0, STUDIO.history.depth() - before),
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const json = error && typeof error.toJSON === 'function'
      ? error.toJSON()
      : { name: 'StudioError', code: 'INTERNAL', message: String(error && error.message ? error.message : error) }
    return { error: json, durationMs: Date.now() - startedAt }
  }
})()`
}

/** Narrow the page's answer to a `RunResult`. */
function isRunResult(value: unknown): value is RunResult {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.changes === 'object' &&
    candidate.changes !== null &&
    typeof candidate.undoSteps === 'number' &&
    typeof candidate.durationMs === 'number'
  )
}

/** The `TIMEOUT` a page that never answered maps to. */
function timeoutError(timeoutMs: number): StudioErrorJson {
  return agentError(
    'TIMEOUT',
    `run: the editor did not answer within ${timeoutMs + RUN_TIMEOUT_GRACE_MS} ms; its main thread is busy or the script never returns`,
    {
      hint: 'The app may be busy rendering; try again, or reload it from the Agent access panel if it stays unresponsive. Edits the script already made stay in the undo history.',
    },
  ).json
}

/** The `TIMEOUT` an MCP `notifications/cancelled` maps to (design §4.4). */
function cancelledError(label: string, elapsedMs: number): StudioErrorJson {
  return agentError(
    'TIMEOUT',
    `run: the call was cancelled after ${elapsedMs} ms; the tool stopped waiting but the script keeps running`,
    {
      hint: `The script is not interrupted. The edits it made stay in the undo history (the synchronous part under "agent: ${label}"), and later edits appear as their own entries.`,
    },
  ).json
}

/** The rejection that says the call's signal aborted while main was waiting. */
class RunCancelledError extends Error {
  constructor() {
    super('the run call was cancelled')
    this.name = 'RunCancelledError'
  }
}

/**
 * The page's answer, or `RunCancelledError` as soon as the MCP call is
 * cancelled. The page promise is not cancelled (JavaScript cannot be
 * interrupted); the tool simply stops waiting for it, exactly like a timeout.
 */
function untilCancelled<T>(answer: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return answer
  if (signal.aborted) return Promise.reject(new RunCancelledError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new RunCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    answer.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Validate the call, run the script through the page, and answer the result or
 * the `StudioError` JSON. The page bridge's deadline is the call's timeout plus
 * the design's five-second grace for the page's own race. `signal` is the MCP
 * handler's abort signal: when it fires, the tool stops waiting at once and
 * answers `TIMEOUT`, as a timeout does (the script keeps running; see the file
 * comment for what happens to its edits).
 */
export async function runScript(
  request: RunRequest,
  page: PageBridge,
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  const startedAt = Date.now()
  const scriptBytes = Buffer.byteLength(request.script, 'utf8')
  if (scriptBytes > MAX_SCRIPT_BYTES) {
    return {
      error: agentError(
        'INVALID_ARGUMENT',
        `run: "script" is ${scriptBytes} bytes; the limit is ${MAX_SCRIPT_BYTES}`,
        { argument: 'script', hint: 'Split the work into several run calls.' },
      ).json,
    }
  }
  const label = request.label ?? 'script'
  if (label.length > MAX_RUN_LABEL_CHARS) {
    return {
      error: agentError(
        'INVALID_ARGUMENT',
        `run: "label" is ${label.length} characters; the limit is ${MAX_RUN_LABEL_CHARS}`,
        { argument: 'label' },
      ).json,
    }
  }
  const timeoutMs = request.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RUN_TIMEOUT_MS) {
    return {
      error: agentError(
        'INVALID_ARGUMENT',
        `run: "timeoutMs" must be an integer from 1 to ${MAX_RUN_TIMEOUT_MS} (got ${timeoutMs})`,
        { argument: 'timeoutMs', valid: [`1..${MAX_RUN_TIMEOUT_MS}`] },
      ).json,
    }
  }

  let answer: unknown
  try {
    if (signal?.aborted === true) throw new RunCancelledError()
    const execution = page.execute(
      buildRunScript({ script: request.script, label, timeoutMs }),
      timeoutMs + RUN_TIMEOUT_GRACE_MS,
    )
    answer = await untilCancelled(execution, signal)
  } catch (error) {
    if (error instanceof RunCancelledError) {
      return { error: cancelledError(label, Date.now() - startedAt) }
    }
    if (error instanceof PageTimeoutError) return { error: timeoutError(timeoutMs) }
    const failure = pageFailureOutcome('run', error)
    if (failure !== null) return failure
    throw error
  }

  if (typeof answer !== 'object' || answer === null) {
    return {
      error: agentError('INTERNAL', 'run: the editor answered no result', {
        hint: 'Try again; if it keeps happening, reload the app.',
      }).json,
    }
  }
  const record = answer as Record<string, unknown>
  if (record.error !== undefined) {
    const undoSteps = typeof record.undoSteps === 'number' ? record.undoSteps : undefined
    if (isStudioErrorJson(record.error)) {
      return { error: record.error, ...(undoSteps !== undefined && { undoSteps }) }
    }
    return {
      error: agentError('INTERNAL', `run: the editor answered an unknown error ${JSON.stringify(record.error)}`).json,
    }
  }
  if (!isRunResult(answer)) {
    return {
      error: agentError('INTERNAL', 'run: the editor answered a result this build does not understand').json,
    }
  }
  const text = JSON.stringify(answer)
  if (Buffer.byteLength(text, 'utf8') > MAX_RESULT_BYTES) {
    return {
      result: {
        value: null,
        changes: {
          commands: [],
          added: [],
          removed: [],
          updated: [],
          undoSteps: answer.changes.undoSteps,
        },
        undoSteps: answer.undoSteps,
        durationMs: answer.durationMs,
        truncated: true,
        hint: `The result was over ${MAX_RESULT_BYTES} bytes; return less from the script (ids or counts instead of whole lists).`,
      },
      undoSteps: answer.undoSteps,
    }
  }
  return { result: answer, undoSteps: answer.undoSteps }
}
