/**
 * The small types the MCP server's pieces share (task 2.2).
 *
 * They are runtime-free: the wire contract is `studio/mcp/protocol.d.ts`, and
 * these describe how the main-process modules hand work to each other.
 */
import type { StudioErrorJson } from '../../../../mcp/protocol'
import type { SearchDocument } from './search/bm25'

/**
 * The way a tool reaches the editor page: one JavaScript expression in, its
 * JSON-serialisable value out, or `PageUnavailableError` / `PageTimeoutError`.
 */
export interface PageBridge {
  /**
   * Run `code` in the page. With `recover`, a call that outlives its deadline
   * is not left holding the page: the bridge stops its script and, when the
   * page does not answer, reloads the editor window (`PageTimeoutError.recovery`
   * says which). The calls that wait on a script of the page's own (`run`,
   * `frame`) ask for it; a poll such as `export`'s does not.
   */
  execute(code: string, timeoutMs: number, options?: ExecuteOptions): Promise<unknown>
  /**
   * Stop the call that is running in the page and give the page back, the way a
   * timeout does; `null` when there is nothing to recover (no window).
   */
  recover?(): Promise<PageRecovery | null>
}

/** What `PageBridge.execute` may be asked besides the code. */
export interface ExecuteOptions {
  /** Stop the script and, if the page does not answer, reload it when the call times out. */
  recover?: boolean
}

/**
 * What the bridge did about a page that did not settle a call. `aborted`: the
 * page answered the abort request, so its script was stopped and the editor is
 * as it was (unsaved edits are still in it). `reloaded`: the page did not
 * answer, so the editor window was reloaded; `unsavedEditsKept` says whether a
 * save went through first, and `back` whether the new page was ready again
 * before the call answered.
 */
export type PageRecovery =
  | { readonly action: 'aborted' }
  | { readonly action: 'reloaded'; readonly unsavedEditsKept: boolean; readonly back: boolean }

/**
 * What a tool handler answers to the server: either a JSON result with the
 * undo entries it added (for the log), or a `StudioError` JSON. The server
 * turns the first into a normal tool result and the second into `isError`.
 */
export type ToolOutcome =
  | { readonly result: unknown; readonly undoSteps?: number }
  | { readonly error: StudioErrorJson; readonly undoSteps?: number }

/** Loads the documents of the three corpora `search` indexes. */
export type LoadSearchDocuments = () => Promise<SearchDocument[]>
