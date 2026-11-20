/**
 * How `run`, `frame` and `export` answer a page that cannot take their script:
 * one mapping, so the three tools say the same thing.
 */
import { agentError } from '../errors'
import { PageBusyError, PageUnavailableError, type PageTimeoutError } from '../page'
import type { PageRecovery, ToolOutcome } from '../types'

/** What an agent does after the page went away: the new page knows nothing of the old one. */
const PAGE_GONE_HINT =
  'Call again: the next call waits for the reloaded editor. Open the project again with studio.project.open(id); ' +
  'edits are kept only by studio.project.save() (export saves too), so redo the ones made since the last save.'

/**
 * `UNSUPPORTED` for a missing window, a starting editor or a missing workspace
 * folder; `INTERNAL` for a page that crashed or reloaded under the call;
 * `CONFLICT` for a script that is still running. `null` for any other error,
 * which the caller rethrows.
 */
export function pageFailureOutcome(tool: string, error: unknown): ToolOutcome | null {
  if (error instanceof PageBusyError) {
    return {
      error: agentError('CONFLICT', `${tool}: ${error.message}`, {
        hint: 'An earlier call timed out or was cancelled and its script has not finished. Call run or frame: they stop that script and, if the editor stays stuck, reload the editor window.',
      }).json,
    }
  }
  if (
    error instanceof PageUnavailableError &&
    (error.reason === 'crashed' || error.reason === 'reloaded')
  ) {
    return { error: agentError('INTERNAL', `${tool}: ${error.message}`, { hint: PAGE_GONE_HINT }).json }
  }
  if (error instanceof PageUnavailableError) {
    const hint =
      error.reason === 'starting'
        ? 'the editor is still starting'
        : error.reason === 'no-workspace'
          ? 'Choose a workspace folder in the app window, then call again.'
          : 'Open DroneClean Studio, then call again.'
    return { error: agentError('UNSUPPORTED', `${tool}: ${error.message}`, { hint }).json }
  }
  return null
}

/**
 * `TIMEOUT` for a call whose page did not answer in time, saying what the app
 * did about it (`PageTimeoutError.recovery`) and what the caller can do next,
 * in terms of the tools only. `retry` is the tool's own advice for the retry.
 */
export function timeoutOutcome(
  tool: string,
  error: PageTimeoutError,
  timeoutMs: number,
  retry: string,
): ToolOutcome {
  const recovery: PageRecovery | undefined = error.recovery
  const waited = `${tool}: the editor did not answer within ${timeoutMs} ms`
  if (recovery?.action === 'aborted') {
    return {
      error: agentError('TIMEOUT', `${waited}; the app stopped the script and the editor is free again`, {
        hint: `The editor was not restarted: edits made before the stop are still in it, unsaved until studio.project.save(). Check the timeline with run, then ${retry}`,
      }).json,
    }
  }
  if (recovery?.action === 'reloaded') {
    const state = recovery.back
      ? 'reopened the project'
      : 'is still reopening the project (the next call waits for the editor; check studio.project.current() and studio.project.open(id) it if it is not open)'
    const edits = recovery.unsavedEditsKept
      ? 'The project was saved before the reload, so no edit was lost.'
      : 'The editor could not save before the reload: what earlier calls changed was saved after each of them (their results said saved: true) and is in the reopened project, but what this call changed before it stuck is lost.'
    return {
      error: agentError(
        'TIMEOUT',
        `${waited}, so the app reloaded the editor window and ${state}`,
        { hint: `${edits} Check the timeline with run, then ${retry}` },
      ).json,
    }
  }
  return {
    error: agentError('TIMEOUT', `${waited}; its main thread is busy or the call never returns`, {
      hint: `Edits already made stay in the editor. Try again: ${retry}`,
    }).json,
  }
}
