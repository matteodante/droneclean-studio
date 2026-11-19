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
  execute(code: string, timeoutMs: number): Promise<unknown>
}

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
