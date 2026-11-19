// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  StudioError,
  formatValidValues,
  formatValue,
  invalidArgumentError,
  notFoundError,
  studioError,
} from './errors'

describe('StudioError', () => {
  it('serialises to the JSON the MCP returns', () => {
    const error = new StudioError({
      code: 'NOT_FOUND',
      message: 'clips.move: "trackId" must be an existing track id (got "v9")',
      argument: 'trackId',
      valid: ['v1', 'a1'],
      entity: { kind: 'track', id: 'v9' },
      hint: 'studio.project.context() names the open context.',
    })

    const json = {
      name: 'StudioError',
      code: 'NOT_FOUND',
      message: 'clips.move: "trackId" must be an existing track id (got "v9")',
      argument: 'trackId',
      valid: ['v1', 'a1'],
      entity: { kind: 'track', id: 'v9' },
      hint: 'studio.project.context() names the open context.',
    }

    expect(error.toJSON()).toEqual(json)
    expect(JSON.parse(JSON.stringify(error))).toEqual(json)
  })

  it('omits the fields it does not carry', () => {
    const error = new StudioError({ code: 'INTERNAL', message: 'boom' })

    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'StudioError',
      code: 'INTERNAL',
      message: 'boom',
    })
  })

  it('is an Error with its own name', () => {
    const error = new StudioError({ code: 'UNSUPPORTED', message: 'no' })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('StudioError')
    expect(error.stack).toBeDefined()
  })
})

describe('error messages', () => {
  it('names the method, the argument and the valid ids', () => {
    const error = notFoundError({
      method: 'clips.move',
      argument: 'trackId',
      kind: 'track',
      id: 'v9',
      expectation: 'an existing track id on the main timeline',
      valid: ['v1', 'a1'],
    })

    expect(error.message).toBe(
      'clips.move: "trackId" must be an existing track id on the main timeline (got "v9"); ' +
        'valid: "v1", "a1"',
    )
    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('trackId')
    expect(error.valid).toEqual(['v1', 'a1'])
    expect(error.entity).toEqual({ kind: 'track', id: 'v9' })
  })

  it('cuts a long list at ten values and names how to get the rest', () => {
    const valid = Array.from({ length: 54 }, (_, index) => `gpu-effect-${index}`)

    expect(formatValidValues(valid, 'studio.effects.types()')).toBe(
      `${valid
        .slice(0, 10)
        .map((value) => JSON.stringify(value))
        .join(', ')}, … and 44 more (studio.effects.types())`,
    )
  })

  it('quotes strings and prints other values as JSON', () => {
    expect(formatValue('v9')).toBe('"v9"')
    expect(formatValue(12)).toBe('12')
    expect(formatValue(undefined)).toBe('undefined')
    expect(formatValue({ id: 'c1' })).toBe('{"id":"c1"}')
  })

  it('leaves the valid list out when nothing is offered', () => {
    const error = invalidArgumentError({
      method: 'clips.move',
      argument: 'to',
      expectation: 'an integer frame >= 0',
      value: -3,
    })

    expect(error.message).toBe('clips.move: "to" must be an integer frame >= 0 (got -3)')
    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.valid).toBeUndefined()
  })

  it('prefixes the method only when one is known', () => {
    expect(
      studioError({ code: 'CONFLICT', method: 'clips.split', message: 'too short' }).message,
    ).toBe('clips.split: too short')
    expect(studioError({ code: 'INTERNAL', message: 'boom' }).message).toBe('boom')
  })
})
