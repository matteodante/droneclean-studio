/**
 * `studio.effects`: the GPU effects applied to a clip (design §4.2, §4.3).
 *
 * The namespace adds no capability the editor lacks: it names, validates and
 * copies what the effects panel does. `GPU_EFFECT_REGISTRY` is the list of
 * effect types and their parameter definitions (`types()`), `useItemsStore`
 * holds the instances applied to a clip (`list()`), and `ADD_EFFECT` /
 * `UPDATE_EFFECT` / `REMOVE_EFFECT` make the edits, each as one undo step
 * (`effect-actions.ts:11,33,48`).
 *
 * Every parameter is checked against its definition before the store is
 * touched: an unknown name, a value of the wrong type or one outside
 * `min`/`max` is an `INVALID_ARGUMENT` naming the parameter and its range, and
 * an `update` patch that names a field other than `params` or `enabled` is
 * rejected the same way. The store generates the instance id
 * (`_addEffect`, items-store.ts:814), so `add` reads the new instance back out
 * of the clip it just wrote.
 *
 * The public signatures, their `@mapsTo`/`@throws`/`@example` contract and the
 * JSDoc of every method live in `types.ts`; the comments here say what this
 * implementation does beyond that contract.
 */

import type { EffectParam, GpuEffectDefinition } from '@/infrastructure/gpu-effects/types'
import type { ItemEffect, VisualEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import {
  GPU_EFFECT_REGISTRY,
  getGpuEffect,
  getGpuEffectDefaultParams,
} from '@/infrastructure/gpu-effects/registry'
import {
  addEffect,
  removeEffect,
  updateEffect,
} from '@/features/timeline/stores/actions/effect-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { requireClip } from '../context'
import { invalidArgumentError, notFoundError, studioError } from '../errors'
import { transaction } from '../transaction'
import type {
  ClipId,
  EffectId,
  EffectInfo,
  EffectParamInfo,
  EffectParamValue,
  EffectPatch,
  EffectsApi,
  EffectTypeInfo,
} from '../types'

/** The ids of every effect type the editor can apply, in registry order. */
function effectTypeIds(): string[] {
  return [...GPU_EFFECT_REGISTRY.keys()]
}

/**
 * The clip an effect is added to. Audio clips cannot carry effects: the store
 * silently skips them (`updateVisualItemEffects`, items-store.ts:125), so the
 * argument is rejected instead of returning an id that does not exist.
 */
function requireEffectClip(id: ClipId, method: string): TimelineItem {
  const item = requireClip(id, method, 'clip')
  if (item.type === 'audio') {
    throw invalidArgumentError({
      method,
      argument: 'clip',
      expectation: 'a visual clip id, not an audio clip',
      value: id,
    })
  }
  return item
}

/** The registry definition of an effect type, or a typed `INVALID_ARGUMENT`. */
function requireEffectType(type: string, method: string): GpuEffectDefinition {
  const definition = getGpuEffect(type)
  if (definition) return definition
  throw invalidArgumentError({
    method,
    argument: 'type',
    expectation: 'an effect type id',
    value: type,
    valid: effectTypeIds(),
    validSource: 'studio.effects.types()',
  })
}

/** One parameter of an effect type, as the SDK reports it. */
function toEffectParamInfo(param: EffectParam): EffectParamInfo {
  return {
    type: param.type,
    label: param.label,
    default: param.default,
    ...(param.min !== undefined && { min: param.min }),
    ...(param.max !== undefined && { max: param.max }),
    ...(param.step !== undefined && { step: param.step }),
    ...(param.options !== undefined && {
      options: param.options.map((option) => ({ value: option.value, label: option.label })),
    }),
    ...(param.animatable !== undefined && { animatable: param.animatable }),
  }
}

/** One effect type and its parameters, as the SDK reports it. */
function toEffectTypeInfo(definition: GpuEffectDefinition): EffectTypeInfo {
  const params: Record<string, EffectParamInfo> = {}
  for (const [name, param] of Object.entries(definition.params)) {
    params[name] = toEffectParamInfo(param)
  }
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    params,
  }
}

/** One effect instance on a clip, as the SDK reports it. */
function toEffectInfo(effect: ItemEffect): EffectInfo {
  return {
    id: effect.id,
    type: effect.effect.gpuEffectType,
    params: { ...effect.effect.params },
    enabled: effect.enabled,
  }
}

/**
 * The effect with this id on a clip, or a `NOT_FOUND` naming the effect ids
 * that clip does carry.
 */
function requireItemEffect(item: TimelineItem, effect: EffectId, method: string): ItemEffect {
  const effects = item.effects ?? []
  const found = effects.find((candidate) => candidate.id === effect)
  if (found) return found
  throw notFoundError({
    method,
    argument: 'effect',
    kind: 'effect',
    id: effect,
    expectation: `an existing effect id on clip ${JSON.stringify(item.id)}`,
    valid: effects.map((candidate) => candidate.id),
  })
}

/** How a non-numeric parameter's accepted values read in a message. */
const PARAM_EXPECTATIONS = {
  number: 'a number',
  boolean: 'true or false',
  select: 'one of its options',
  color: 'a colour string',
  point: 'a point string',
  json: 'a JSON string',
  text: 'a string',
} satisfies Record<EffectParam['type'], string>

/** How a parameter's accepted values read in an `INVALID_ARGUMENT` message. */
function paramExpectation(param: EffectParam): string {
  if (param.type !== 'number') return PARAM_EXPECTATIONS[param.type]
  if (param.min === undefined && param.max === undefined) return PARAM_EXPECTATIONS.number
  if (param.min === undefined) return `a number <= ${param.max}`
  if (param.max === undefined) return `a number >= ${param.min}`
  return `a number between ${param.min} and ${param.max}`
}

/** Throw `INVALID_ARGUMENT` for one parameter value that its definition rejects. */
function rejectParamValue(
  param: EffectParam,
  name: string,
  value: unknown,
  method: string,
  valid?: readonly string[],
): never {
  throw invalidArgumentError({
    method,
    argument: `params.${name}`,
    expectation: paramExpectation(param),
    value,
    ...(valid !== undefined && { valid }),
  })
}

/** Throw unless `value` is a finite number in the parameter's range. */
function checkNumberParamValue(
  param: EffectParam,
  name: string,
  value: unknown,
  method: string,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    rejectParamValue(param, name, value, method)
  }
  if (param.min !== undefined && value < param.min) {
    rejectParamValue(param, name, value, method)
  }
  if (param.max !== undefined && value > param.max) {
    rejectParamValue(param, name, value, method)
  }
}

/** Throw unless `value` is one of the parameter's select options. */
function checkSelectParamValue(
  param: EffectParam,
  name: string,
  value: unknown,
  method: string,
): void {
  const options = (param.options ?? []).map((option) => option.value)
  if (typeof value !== 'string' || !options.includes(value)) {
    rejectParamValue(param, name, value, method, options)
  }
}

/** Throw unless `value` is a string: a colour, point, JSON payload or text. */
function checkStringParamValue(
  param: EffectParam,
  name: string,
  value: unknown,
  method: string,
): void {
  if (typeof value !== 'string') {
    rejectParamValue(param, name, value, method)
  }
}

/** Throw unless `value` is a boolean. */
function checkBooleanParamValue(
  param: EffectParam,
  name: string,
  value: unknown,
  method: string,
): void {
  if (typeof value !== 'boolean') {
    rejectParamValue(param, name, value, method)
  }
}

/** The check for each parameter type's value, keyed by `EffectParam.type`. */
const PARAM_VALUE_CHECKS: Record<
  EffectParam['type'],
  (param: EffectParam, name: string, value: unknown, method: string) => void
> = {
  number: checkNumberParamValue,
  boolean: checkBooleanParamValue,
  select: checkSelectParamValue,
  color: checkStringParamValue,
  point: checkStringParamValue,
  json: checkStringParamValue,
  text: checkStringParamValue,
}

/** Throw `INVALID_ARGUMENT` unless a parameter value matches its definition. */
function checkParamValue(param: EffectParam, name: string, value: unknown, method: string): void {
  PARAM_VALUE_CHECKS[param.type](param, name, value, method)
}

/** Check every named parameter of a patch against the type's definition. */
function validateEffectParams(
  definition: GpuEffectDefinition,
  params: unknown,
  method: string,
): void {
  if (params === undefined) return
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw invalidArgumentError({
      method,
      argument: 'params',
      expectation: `an object of ${JSON.stringify(definition.id)} parameter values`,
      value: params,
    })
  }
  const names = Object.keys(definition.params)
  for (const [name, value] of Object.entries(params)) {
    const param = definition.params[name]
    if (!param) {
      throw invalidArgumentError({
        method,
        argument: `params.${name}`,
        expectation: `a parameter of effect ${JSON.stringify(definition.id)}`,
        value,
        valid: names,
      })
    }
    checkParamValue(param, name, value, method)
  }
}

/** The fields an `update` patch can change, in the order a message offers them. */
const PATCH_FIELDS: ReadonlyArray<keyof EffectPatch> = ['params', 'enabled']

/**
 * Check the shape of an `update` patch: it names only known fields, `enabled`
 * is a boolean and every named parameter is checked against the effect type's
 * definition.
 */
function validateEffectPatch(current: ItemEffect, patch: unknown, method: string): void {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw invalidArgumentError({
      method,
      argument: 'patch',
      expectation: 'an object with optional "params" and "enabled" fields',
      value: patch,
    })
  }
  const fields = patch as Record<string, unknown>
  const unknown = Object.keys(fields).find(
    (field) => !PATCH_FIELDS.includes(field as keyof EffectPatch),
  )
  if (unknown !== undefined) {
    throw invalidArgumentError({
      method,
      argument: `patch.${unknown}`,
      expectation: 'a field of an effects.update patch',
      value: fields[unknown],
      valid: PATCH_FIELDS,
    })
  }
  const { params, enabled } = fields as EffectPatch
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw invalidArgumentError({
      method,
      argument: 'enabled',
      expectation: 'true or false',
      value: enabled,
    })
  }
  if (params === undefined) return
  const definition = getGpuEffect(current.effect.gpuEffectType)
  if (!definition) {
    throw invalidArgumentError({
      method,
      argument: 'params',
      expectation: 'the parameter values of an effect type this build knows',
      value: params,
      valid: effectTypeIds(),
      validSource: 'studio.effects.types()',
      hint: `The stored effect type ${JSON.stringify(current.effect.gpuEffectType)} is not in studio.effects.types().`,
    })
  }
  validateEffectParams(definition, params, method)
}

/** Every effect type the editor can apply, with its parameter definitions. */
function types(): EffectTypeInfo[] {
  return [...GPU_EFFECT_REGISTRY.values()].map(toEffectTypeInfo)
}

/** The effects on a clip, in application order, as copies. */
function list(clip: ClipId): EffectInfo[] {
  const item = requireClip(clip, 'effects.list', 'clip')
  return (item.effects ?? []).map(toEffectInfo)
}

/**
 * Add an effect with the type's defaults plus `params`, in one undo step, and
 * return the id of the instance the store created.
 */
function add(clip: ClipId, type: string, params?: Record<string, EffectParamValue>): EffectId {
  const item = requireEffectClip(clip, 'effects.add')
  const definition = requireEffectType(type, 'effects.add')
  validateEffectParams(definition, params, 'effects.add')

  const effect: VisualEffect = {
    type: 'gpu-effect',
    gpuEffectType: definition.id,
    params: { ...getGpuEffectDefaultParams(definition.id), ...(params ?? {}) },
  }

  const { value } = transaction('EFFECTS_ADD', () => {
    const known = new Set((item.effects ?? []).map((candidate) => candidate.id))
    addEffect(clip, effect)
    const created = (useItemsStore.getState().itemById[clip]?.effects ?? []).find(
      (candidate) => !known.has(candidate.id),
    )
    if (!created) {
      throw studioError({
        code: 'INTERNAL',
        method: 'effects.add',
        message: `the store did not append the effect to clip ${JSON.stringify(clip)}`,
      })
    }
    return created.id
  })
  return value
}

/**
 * Replace the parameters named in the patch and set the enabled flag, in one
 * undo step. Each named parameter is replaced, the others are kept.
 */
function update(clip: ClipId, effect: EffectId, patch: EffectPatch): void {
  const item = requireClip(clip, 'effects.update', 'clip')
  const current = requireItemEffect(item, effect, 'effects.update')
  validateEffectPatch(current, patch, 'effects.update')

  transaction('EFFECTS_UPDATE', () => {
    updateEffect(clip, effect, {
      ...(patch.params !== undefined && {
        effect: {
          ...current.effect,
          params: { ...current.effect.params, ...patch.params },
        },
      }),
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
    })
  })
}

/** Remove one effect from a clip, in one undo step. */
function remove(clip: ClipId, effect: EffectId): void {
  const item = requireClip(clip, 'effects.remove', 'clip')
  requireItemEffect(item, effect, 'effects.remove')

  transaction('EFFECTS_REMOVE', () => {
    removeEffect(clip, effect)
  })
}

/** The `studio.effects` namespace. */
export function createEffectsApi(): EffectsApi {
  return { types, list, add, update, remove }
}
