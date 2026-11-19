/**
 * The one error the SDK throws (design §4.5).
 *
 * A `StudioError` says which argument was wrong, which values are valid, which
 * entity was not found and what the caller can do about it, and it serialises
 * to the JSON an MCP tool returns to its caller. Silent store failures become
 * typed errors instead of `false` / `null` / `''` return values.
 */

import type { EntityKind, EntityRef, StudioErrorCode, StudioErrorJson } from './types'

/** Every field a `StudioError` can carry. */
export interface StudioErrorOptions {
  /** The error code, see {@link StudioErrorCode}. */
  code: StudioErrorCode
  /** The full human-readable message. */
  message: string
  /** Name of the rejected argument, when one is to blame. */
  argument?: string
  /** Valid values for the rejected argument, when they are known. */
  valid?: readonly string[]
  /** The entity that was not found or that conflicts, when there is one. */
  entity?: EntityRef
  /** What the caller can do to fix it. */
  hint?: string
}

/** Options of {@link studioError}. Like {@link StudioErrorOptions} but with a method prefix. */
export interface StudioErrorInput extends Omit<StudioErrorOptions, 'message'> {
  /** Method that failed, e.g. `clips.move`; the message is prefixed with it. */
  method?: string
  /** Detail appended after the method prefix. */
  message: string
}

/** How many valid values a message lists before it summarises the rest. */
const MAX_LISTED_VALUES = 10

/**
 * One `StudioError`. One class for every failure, so a caller branches on
 * `code` and never on the message.
 */
export class StudioError extends Error {
  /** The error code. */
  readonly code: StudioErrorCode
  /** Name of the rejected argument, when one is to blame. */
  readonly argument?: string
  /** Valid values for the rejected argument, when they are known. */
  readonly valid?: readonly string[]
  /** The entity that was not found or that conflicts, when there is one. */
  readonly entity?: EntityRef
  /** What the caller can do to fix it. */
  readonly hint?: string

  constructor(options: StudioErrorOptions) {
    super(options.message)
    this.name = 'StudioError'
    this.code = options.code
    this.argument = options.argument
    this.valid = options.valid
    this.entity = options.entity
    this.hint = options.hint
  }

  /** The JSON form the MCP passes to its caller. */
  toJSON(): StudioErrorJson {
    return {
      name: 'StudioError',
      code: this.code,
      message: this.message,
      ...(this.argument !== undefined && { argument: this.argument }),
      ...(this.valid !== undefined && { valid: this.valid }),
      ...(this.entity !== undefined && { entity: this.entity }),
      ...(this.hint !== undefined && { hint: this.hint }),
    }
  }
}

/**
 * How a value appears in a message: `"v9"` for a string, JSON for anything
 * else, `undefined` for an absent value.
 * @example formatValue('v9') // '"v9"'
 */
export function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  const json = JSON.stringify(value)
  return json === undefined ? String(value) : json
}

/**
 * The valid values of an argument, quoted and comma separated, cut at ten with
 * `… and N more (source)`.
 * @param valid - the values, in the order they are offered
 * @param source - how to obtain them again, e.g. `studio.effects.types()`
 * @example formatValidValues(['v1', 'a1']) // '"v1", "a1"'
 */
export function formatValidValues(valid: readonly string[], source?: string): string {
  const listed = valid
    .slice(0, MAX_LISTED_VALUES)
    .map((value) => JSON.stringify(value))
    .join(', ')
  const remaining = valid.length - MAX_LISTED_VALUES
  if (remaining <= 0) return listed
  return `${listed}, … and ${remaining} more${source ? ` (${source})` : ''}`
}

/** Options shared by {@link invalidArgumentError} and {@link notFoundError}. */
export interface ArgumentErrorOptions {
  /** Method that rejected the argument, e.g. `clips.move`. */
  method: string
  /** Name of the argument, e.g. `trackId`. */
  argument: string
  /** What the argument had to be, e.g. `an existing track id on the main timeline`. */
  expectation: string
  /** The rejected value. */
  value?: unknown
  /** Valid values, when they are known. */
  valid?: readonly string[]
  /** How to obtain the valid values again, e.g. `studio.effects.types()`. */
  validSource?: string
  /** What the caller can do to fix it. */
  hint?: string
}

/** The standard `"<method>: "<argument>" must be <expectation> (got <value>)"` message. */
function argumentMessage(options: ArgumentErrorOptions): string {
  const prefix = options.method ? `${options.method}: ` : ''
  const got = `(got ${formatValue(options.value)})`
  const valid =
    options.valid && options.valid.length > 0
      ? `; valid: ${formatValidValues(options.valid, options.validSource)}`
      : ''
  const argument = JSON.stringify(options.argument)
  return `${prefix}${argument} must be ${options.expectation} ${got}${valid}`
}

/**
 * Build a `StudioError` with the method as the message prefix.
 * @example studioError({ code: 'CONFLICT', method: 'clips.split',
 *   message: 'frame 240 is outside clip "c1"' })
 */
export function studioError(input: StudioErrorInput): StudioError {
  return new StudioError({
    code: input.code,
    message: input.method ? `${input.method}: ${input.message}` : input.message,
    argument: input.argument,
    valid: input.valid,
    entity: input.entity,
    hint: input.hint,
  })
}

/**
 * A `NOT_FOUND` for an id that does not exist in the active context, with the
 * valid ids and the context hint.
 * @example notFoundError({ method: 'clips.move', argument: 'trackId', kind: 'track',
 *   id: 'v9', expectation: 'an existing track id on the main timeline',
 *   valid: ['v1', 'a1'] })
 */
export function notFoundError(
  options: Omit<ArgumentErrorOptions, 'value'> & { kind: EntityKind; id: string },
): StudioError {
  return new StudioError({
    code: 'NOT_FOUND',
    message: argumentMessage({ ...options, value: options.id }),
    argument: options.argument,
    valid: options.valid,
    entity: { kind: options.kind, id: options.id },
    hint: options.hint,
  })
}

/**
 * An `INVALID_ARGUMENT` for a rejected value, with the valid values when they
 * are known.
 * @example invalidArgumentError({ method: 'clips.move', argument: 'to',
 *   expectation: 'an integer frame >= 0', value: -3 })
 */
export function invalidArgumentError(options: ArgumentErrorOptions): StudioError {
  return new StudioError({
    code: 'INVALID_ARGUMENT',
    message: argumentMessage(options),
    argument: options.argument,
    valid: options.valid,
    hint: options.hint,
  })
}
