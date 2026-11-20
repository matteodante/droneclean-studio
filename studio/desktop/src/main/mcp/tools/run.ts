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
 * therefore counts the entries of the whole call, and `changes` describes the
 * whole call too: the SDK's `transaction` reports it through `settled` once the
 * promise resolves (`sdk/transaction.ts`).
 *
 * JavaScript in the page cannot be interrupted, so a timeout tells the script to
 * stop (an abort signal the SDK reads: its next SDK call fails) and releases the
 * lock, instead of leaving the editor held. The page races an async value
 * against the call's `timeoutMs`; main waits at most `timeoutMs + 5000` for the
 * page's answer. A page that does not answer at all (a blocked main thread) is
 * recovered by the bridge: it is asked to abort and, with no answer, to save,
 * and the editor window is reloaded (`page.ts`). The error code is `TIMEOUT`
 * for all of them, and says what was done.
 *
 * An awaited script that throws after some of its SDK calls keeps their
 * entries (only a synchronous script is rolled back whole by its transaction):
 * the error then says how many are kept, saves them, and carries `undoSteps`.
 *
 * An abandoned call — a timeout, or an MCP `notifications/cancelled` whose
 * signal aborts the handler — keeps the edits the synchronous part already made
 * as the one `agent: <label>` undo entry (they are not rolled back; Ctrl+Z or
 * `studio.history.undo()` takes them back). The timeout answer names how many
 * entries exist when it is produced. A cancelled call is answered like a
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
import { PageTimeoutError, RUN_ABORT_GLOBAL, RUN_BUSY_GLOBAL } from '../page'
import { pageFailureOutcome, timeoutOutcome } from './page-failure'
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
  // The project is written after every call that changed it, so a crash or a reload of a stuck editor loses
  // nothing the agent did (the editor's own auto-save runs only every 5-30 minutes). null: nothing to save.
  const saveAfterEdits = async (made) => {
    if (made <= 0 || !STUDIO.project || typeof STUDIO.project.current !== 'function') return null
    try {
      if (STUDIO.project.current() === null) return null
      await STUDIO.project.save()
      return true
    } catch {
      return false
    }
  }
  const evaluate = (studio) => {
    const evaluated = scriptFn(studio)
    return typeof evaluated === 'function' ? evaluated(studio) : evaluated
  }
  const before = STUDIO.history.depth()
  // The signal the SDK reads (sdk/context.ts): once it is aborted, the script's
  // next SDK call fails instead of editing on.
  const abortController = new AbortController()
  globalThis.${RUN_ABORT_GLOBAL} = abortController
  const runId = (globalThis.__droneAgentRunId || 0) + 1
  globalThis.__droneAgentRunId = runId
  try {
    const outcome = STUDIO.transaction(${label}, (studio) => evaluate(studio))
    let value = outcome.value
    let changes = outcome.changes
    if (value && typeof value.then === 'function') {
      // The page's report that the script is not finished: the bridge refuses a
      // new call while this is set, even after this call answered TIMEOUT.
      globalThis.${RUN_BUSY_GLOBAL} = true
      // Only the latest run clears the flag: an abandoned script that settles
      // late must not release the lock of the call that came after it.
      const release = () => { if (globalThis.__droneAgentRunId === runId) globalThis.${RUN_BUSY_GLOBAL} = false }
      Promise.resolve(value).then(release, release)
      const raced = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ state: 'timeout' }), ${timeoutMs})
        abortController.signal.addEventListener('abort', () => { clearTimeout(timer); resolve({ state: 'aborted' }) }, { once: true })
        Promise.resolve(value).then(
          (resolved) => { clearTimeout(timer); resolve({ state: 'value', value: resolved }) },
          (rejected) => { clearTimeout(timer); resolve({ state: 'error', error: rejected }) },
        )
      })
      if (raced.state === 'timeout' || raced.state === 'aborted') {
        // The script cannot be interrupted, but it is told to stop and the lock is
        // released: its next SDK call fails, and the next call runs.
        abortController.abort()
        globalThis.${RUN_BUSY_GLOBAL} = false
        const kept = Math.max(0, STUDIO.history.depth() - before)
        const keptSaved = await saveAfterEdits(kept)
        return {
          error: failure('TIMEOUT', raced.state === 'timeout'
            ? 'run: the script was still running after ' + ${timeoutMs} + ' ms, so it was stopped and the editor is free again'
            : 'run: the script was stopped before it finished and the editor is free again', {
            hint: 'The script is told to stop: its next SDK call fails. ' + (kept > 0 ? 'The ' + kept + ' undo ' + (kept === 1 ? 'entry' : 'entries') + ' it already made ' + (kept === 1 ? 'is' : 'are') + ' kept (its synchronous part is under "' + agentLabel + '"; studio.history.undo() takes them back). ' : '') + 'Make the script resolve sooner, or pass a larger timeoutMs (max 600000).',
          }),
          undoSteps: kept,
          ...(keptSaved !== null && { saved: keptSaved }),
          durationMs: Date.now() - startedAt,
        }
      }
      if (raced.state === 'error') throw raced.error
      value = raced.value
      // The whole call, awaited edits included (the synchronous part alone is outcome.changes).
      if (outcome.settled) changes = await outcome.settled
    }
    const plain = (input) => {
      try { return JSON.parse(JSON.stringify(input)) } catch { return null }
    }
    const undoSteps = Math.max(0, STUDIO.history.depth() - before)
    const saved = await saveAfterEdits(undoSteps)
    return plain({
      value: value === undefined ? null : value,
      changes: changes || { commands: [], added: [], removed: [], updated: [], undoSteps: 0 },
      undoSteps,
      ...(saved !== null && { saved }),
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const json = error && typeof error.toJSON === 'function'
      ? error.toJSON()
      : { name: 'StudioError', code: 'INTERNAL', message: String(error && error.message ? error.message : error) }
    // A synchronous script that throws is rolled back by its transaction; an awaited one keeps the entries its SDK
    // calls made before the error. Those are saved and named, so the agent does not take the project for unchanged.
    const kept = Math.max(0, STUDIO.history.depth() - before)
    if (kept === 0) return { error: json, durationMs: Date.now() - startedAt }
    const keptSaved = await saveAfterEdits(kept)
    const keptHint = 'The ' + kept + ' undo ' + (kept === 1 ? 'entry' : 'entries') + ' the script made before the error ' + (kept === 1 ? 'is' : 'are') + ' kept and saved (studio.history.undo() takes ' + (kept === 1 ? 'it' : 'them') + ' back): read the project before trying again.'
    return {
      error: Object.assign({}, json, { hint: json.hint ? json.hint + ' ' + keptHint : keptHint }),
      undoSteps: kept,
      ...(keptSaved !== null && { saved: keptSaved }),
      durationMs: Date.now() - startedAt,
    }
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

/** The `TIMEOUT` an MCP `notifications/cancelled` maps to (design §4.4). */
function cancelledError(label: string, elapsedMs: number): StudioErrorJson {
  return agentError(
    'TIMEOUT',
    `run: the call was cancelled after ${elapsedMs} ms; the tool stopped waiting and told the script to stop`,
    {
      hint: `The edits it made stay in the undo history (the synchronous part under "agent: ${label}"; studio.history.undo() takes them back); its next SDK call fails.`,
    },
  ).json
}

/** What `run` advises after a timeout. */
const RUN_RETRY = 'make the script lighter, split it into several run calls, or pass a larger timeoutMs (max 600000).'

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
      { recover: true },
    )
    answer = await untilCancelled(execution, signal)
  } catch (error) {
    if (error instanceof RunCancelledError) {
      // The script is still running in the page: stop it and give the page back
      // before the next call, which the server queues behind this one.
      await page.recover?.()
      return { error: cancelledError(label, Date.now() - startedAt) }
    }
    if (error instanceof PageTimeoutError) {
      return timeoutOutcome('run', error, timeoutMs + RUN_TIMEOUT_GRACE_MS, RUN_RETRY)
    }
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
        ...(answer.saved !== undefined && { saved: answer.saved }),
        durationMs: answer.durationMs,
        truncated: true,
        hint: `The result was over ${MAX_RESULT_BYTES} bytes; return less from the script (ids or counts instead of whole lists).`,
      },
      undoSteps: answer.undoSteps,
    }
  }
  return { result: answer, undoSteps: answer.undoSteps }
}
