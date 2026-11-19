/**
 * The one error an MCP tool answers with (task 2.2).
 *
 * The SDK's errors cross the page boundary as plain JSON (`StudioError.toJSON`
 * in `src/studio/sdk/errors.ts`); in the main process the page's JSON is passed
 * through untouched, and a failure main itself detects (an argument, a
 * timeout, a stub) becomes an `AgentError` carrying the same shape. The server
 * serialises either as the text of an `isError` tool result, and the agent log
 * records the code.
 */
import type {
  EntityRefJson,
  StudioErrorCode,
  StudioErrorJson,
} from '../../../../mcp/protocol'

/** The fields an `AgentError` sets beside the code and the message. */
export interface AgentErrorOptions {
  /** Name of the rejected argument, e.g. `script`. */
  argument?: string
  /** Valid values for the rejected argument, when they are known. */
  valid?: readonly string[]
  /** The entity that was not found or conflicted, when there is one. */
  entity?: EntityRefJson
  /** What the caller can do to fix it. */
  hint?: string
}

/**
 * A `StudioError`-shaped failure raised in the main process.
 *
 * `json` is exactly what the tool answers and what the log's `code` reads, so
 * callers never re-derive either from the message.
 */
export class AgentError extends Error {
  /** The JSON the tool answers; its `code` is the code the log records. */
  readonly json: StudioErrorJson

  constructor(json: StudioErrorJson) {
    super(json.message)
    this.name = 'StudioError'
    this.json = json
  }
}

/** Build the JSON form, with the optional fields present only when set. */
export function studioErrorJson(
  code: StudioErrorCode | 'TIMEOUT',
  message: string,
  options: AgentErrorOptions = {},
): StudioErrorJson {
  return {
    name: 'StudioError',
    code,
    message,
    ...(options.argument !== undefined && { argument: options.argument }),
    ...(options.valid !== undefined && { valid: options.valid }),
    ...(options.entity !== undefined && { entity: options.entity }),
    ...(options.hint !== undefined && { hint: options.hint }),
  }
}

/** Build an `AgentError`. */
export function agentError(
  code: StudioErrorCode | 'TIMEOUT',
  message: string,
  options: AgentErrorOptions = {},
): AgentError {
  return new AgentError(studioErrorJson(code, message, options))
}

/** Narrow an unknown value to the JSON form the page returns. */
export function isStudioErrorJson(value: unknown): value is StudioErrorJson {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.name === 'StudioError' &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string'
  )
}

/** The JSON a failed call answers: an `AgentError`'s own, or an `INTERNAL` wrapper. */
export function toStudioErrorJson(error: unknown): StudioErrorJson {
  if (error instanceof AgentError) return error.json
  const message = error instanceof Error ? error.message : String(error)
  return studioErrorJson('INTERNAL', message)
}
