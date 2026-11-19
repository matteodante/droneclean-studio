/**
 * How `run`, `frame` and `export` answer a page that cannot take their script:
 * one mapping, so the three tools say the same thing.
 */
import { agentError } from '../errors'
import { PageBusyError, PageUnavailableError } from '../page'
import type { ToolOutcome } from '../types'

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
        hint: 'An earlier call timed out or was cancelled and its script has not finished; JavaScript cannot be interrupted. Wait for it, or reload the app from the Agent access panel.',
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
