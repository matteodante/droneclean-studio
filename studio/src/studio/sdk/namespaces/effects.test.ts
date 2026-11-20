// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { buildTimelineFromStores } from '@/features/timeline/stores/timeline-persistence'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { GPU_EFFECT_REGISTRY } from '@/infrastructure/gpu-effects/registry'
import { StudioError, formatValidValues } from '../errors'
import type { EffectParamValue, EffectPatch, EffectsApi } from '../types'
import { createEffectsApi } from './effects'

/** The effect the first example targets: `gpu-brightness`, `amount` 0.2. */
function brightnessEffect(): ItemEffect {
  return {
    id: 'e1',
    effect: { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: { amount: 0.2 } },
    enabled: true,
  }
}

/** A second effect with a select parameter and a disabled flag, id `e2`. */
function powerWindowEffect(): ItemEffect {
  return {
    id: 'e2',
    effect: {
      type: 'gpu-effect',
      gpuEffectType: 'gpu-power-window',
      params: { shape: 'ellipse', centerX: 0.25, centerY: 0.5, exposure: 0 },
    },
    enabled: false,
  }
}

function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
    ])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'c1',
      trackId: 'track-v1',
      effects: [brightnessEffect(), powerWindowEffect()],
    }),
    makeTimelineAudioItem({ id: 'a1', trackId: 'track-a1' }),
  ])
}

function effectsOf(clip: string): ItemEffect[] {
  return useItemsStore.getState().itemById[clip]?.effects ?? []
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

function lastCommandType(): string | undefined {
  return useTimelineCommandStore.getState().undoStack.at(-1)?.command.type
}

function catchError(fn: () => unknown): StudioError {
  try {
    fn()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

const api: EffectsApi = createEffectsApi()

describe('studio.effects', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.getState().setFps(30)
    seedTimeline()
  })

  describe('types', () => {
    it('lists every effect of the registry, in registry order', () => {
      expect(api.types().map((entry) => entry.id)).toEqual([...GPU_EFFECT_REGISTRY.keys()])
      expect(api.types()).toHaveLength(55)
    })

    it("describes a type's parameters with their range, step and options", () => {
      const brightness = api.types().find((entry) => entry.id === 'gpu-brightness')

      expect(brightness).toEqual({
        id: 'gpu-brightness',
        name: 'Brightness',
        category: 'color',
        params: {
          amount: {
            type: 'number',
            label: 'Amount',
            default: 0,
            min: -1,
            max: 1,
            step: 0.01,
            animatable: true,
          },
        },
      })

      expect(api.types().find((entry) => entry.id === 'gpu-power-window')?.params.shape).toEqual({
        type: 'select',
        label: 'Shape',
        default: 'ellipse',
        options: [
          { value: 'ellipse', label: 'Ellipse' },
          { value: 'rectangle', label: 'Rectangle' },
        ],
      })
    })

    it('returns copies: changing a description does not touch the registry', () => {
      const amount = api.types().find((entry) => entry.id === 'gpu-brightness')?.params.amount
      if (!amount) throw new Error('expected the amount parameter')
      amount.default = 1
      amount.min = 0

      const shape = api.types().find((entry) => entry.id === 'gpu-power-window')?.params.shape
      const option = shape?.options?.[0]
      if (!option) throw new Error('expected the shape options')
      option.label = 'changed'

      const again = api.types().find((entry) => entry.id === 'gpu-brightness')?.params.amount
      expect(again?.default).toBe(0)
      expect(again?.min).toBe(-1)
      expect(
        api.types().find((entry) => entry.id === 'gpu-power-window')?.params.shape?.options?.[0]
          ?.label,
      ).toBe('Ellipse')
    })

    it('is not an undo step', () => {
      api.types()
      expect(undoDepth()).toBe(0)
    })
  })

  describe('list', () => {
    it('lists the effects on a clip in application order', () => {
      expect(api.list('c1')).toEqual([
        { id: 'e1', type: 'gpu-brightness', params: { amount: 0.2 }, enabled: true },
        {
          id: 'e2',
          type: 'gpu-power-window',
          params: { shape: 'ellipse', centerX: 0.25, centerY: 0.5, exposure: 0 },
          enabled: false,
        },
      ])
    })

    it('returns copies of the store effects', () => {
      const [listed] = api.list('c1')
      if (!listed) throw new Error('expected one effect')
      listed.params.amount = 0.9
      listed.enabled = false

      expect(effectsOf('c1')[0]).toMatchObject({
        enabled: true,
        effect: { params: { amount: 0.2 } },
      })
    })

    it('is an empty list for a clip that carries no effects', () => {
      expect(api.list('a1')).toEqual([])
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => api.list('nope'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('clip')
      expect(error.entity).toEqual({ kind: 'clip', id: 'nope' })
      expect(error.message).toBe(
        'effects.list: "clip" must be an existing clip id on the main timeline (got "nope"); ' +
          'valid: "c1", "a1"',
      )
    })

    it('is not an undo step', () => {
      api.list('c1')
      expect(undoDepth()).toBe(0)
    })
  })

  describe('add', () => {
    it('applies the type defaults plus the given parameters and returns the id', () => {
      const id = api.add('c1', 'gpu-brightness', { amount: 0.1 })

      const effects = effectsOf('c1')
      expect(effects).toHaveLength(3)
      expect(effects[2]?.id).toBe(id)
      expect(effects[2]).toMatchObject({
        effect: {
          type: 'gpu-effect',
          gpuEffectType: 'gpu-brightness',
          params: { amount: 0.1 },
        },
        enabled: true,
      })
      expect(typeof id).toBe('string')
      expect(id).not.toBe('')
    })

    it('uses the registry defaults for the parameters a call does not give', () => {
      api.add('c1', 'gpu-power-window')

      expect(effectsOf('c1')[2]?.effect.params).toMatchObject({
        shape: 'ellipse',
        centerX: 0.5,
        centerY: 0.5,
        invertMask: false,
      })

      api.add('c1', 'gpu-power-window', { shape: 'rectangle' })

      expect(effectsOf('c1')[3]?.effect.params).toMatchObject({
        shape: 'rectangle',
        centerX: 0.5,
        centerY: 0.5,
        invertMask: false,
      })
    })

    it('is one undo entry, undone in one step', () => {
      const before = buildTimelineFromStores()

      api.add('c1', 'gpu-brightness', { amount: 0.1 })

      expect(undoDepth()).toBe(1)
      expect(lastCommandType()).toBe('EFFECTS_ADD')
      expect(effectsOf('c1')).toHaveLength(3)

      useTimelineCommandStore.getState().undo()

      expect(buildTimelineFromStores()).toEqual(before)
      expect(undoDepth()).toBe(0)
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => api.add('nope', 'gpu-brightness'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toBe(
        'effects.add: "clip" must be an existing clip id on the main timeline (got "nope"); ' +
          'valid: "c1", "a1"',
      )
    })

    it('throws INVALID_ARGUMENT for an unknown effect type, listing the valid ids', () => {
      const ids = [...GPU_EFFECT_REGISTRY.keys()]

      const error = catchError(() => api.add('c1', 'gpu-nope'))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('type')
      expect(error.valid).toEqual(ids)
      expect(error.message).toBe(
        'effects.add: "type" must be an effect type id (got "gpu-nope"); ' +
          `valid: ${formatValidValues(ids, 'studio.effects.types()')}`,
      )
      expect(error.message).toContain('… and 45 more (studio.effects.types())')
    })

    it('rejects an unknown parameter name', () => {
      const error = catchError(() => api.add('c1', 'gpu-brightness', { glow: 0.3 }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('params.glow')
      expect(error.valid).toEqual(['amount'])
      expect(error.message).toBe(
        'effects.add: "params.glow" must be a parameter of effect "gpu-brightness" ' +
          '(got 0.3); valid: "amount"',
      )
    })

    it('rejects a parameter of the wrong type', () => {
      const error = catchError(() =>
        api.add('c1', 'gpu-brightness', {
          amount: '0.1' as unknown as EffectParamValue,
        }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('params.amount')
      expect(error.message).toBe(
        'effects.add: "params.amount" must be a number between -1 and 1 (got "0.1")',
      )
    })

    it('rejects a parameter outside its range, naming the range', () => {
      const error = catchError(() => api.add('c1', 'gpu-brightness', { amount: 2 }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.message).toBe(
        'effects.add: "params.amount" must be a number between -1 and 1 (got 2)',
      )
    })

    it('rejects a select value that is not one of its options', () => {
      const error = catchError(() => api.add('c1', 'gpu-power-window', { shape: 'blob' }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.valid).toEqual(['ellipse', 'rectangle'])
      expect(error.message).toBe(
        'effects.add: "params.shape" must be one of its options (got "blob"); ' +
          'valid: "ellipse", "rectangle"',
      )
    })

    it('rejects a parameter map that is not an object', () => {
      const error = catchError(() =>
        api.add('c1', 'gpu-brightness', [] as unknown as Record<string, EffectParamValue>),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('params')
    })

    it('rejects an audio clip instead of returning an id that does not exist', () => {
      const error = catchError(() => api.add('a1', 'gpu-brightness'))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('clip')
      expect(error.message).toBe(
        'effects.add: "clip" must be a visual clip id, not an audio clip (got "a1")',
      )
      expect(undoDepth()).toBe(0)
    })
  })

  describe('update', () => {
    it('replaces the named parameters and only those', () => {
      api.update('c1', 'e2', { params: { shape: 'rectangle' } })

      expect(effectsOf('c1')[1]).toMatchObject({
        enabled: false,
        effect: {
          params: { shape: 'rectangle', centerX: 0.25, centerY: 0.5, exposure: 0 },
        },
      })
      expect(effectsOf('c1')[0]?.effect.params).toEqual({ amount: 0.2 })
    })

    it('sets the enabled flag without touching the parameters', () => {
      api.update('c1', 'e1', { enabled: false })

      expect(effectsOf('c1')[0]).toMatchObject({
        enabled: false,
        effect: { params: { amount: 0.2 } },
      })
    })

    it('is one undo entry, undone in one step', () => {
      const before = buildTimelineFromStores()

      api.update('c1', 'e1', { params: { amount: 0.5 }, enabled: false })

      expect(undoDepth()).toBe(1)
      expect(lastCommandType()).toBe('EFFECTS_UPDATE')
      expect(effectsOf('c1')[0]).toMatchObject({
        enabled: false,
        effect: { params: { amount: 0.5 } },
      })

      useTimelineCommandStore.getState().undo()

      expect(buildTimelineFromStores()).toEqual(before)
      expect(undoDepth()).toBe(0)
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => api.update('nope', 'e1', { enabled: false }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toBe(
        'effects.update: "clip" must be an existing clip id on the main timeline (got "nope"); ' +
          'valid: "c1", "a1"',
      )
    })

    it('throws NOT_FOUND for an effect of another clip', () => {
      const error = catchError(() => api.update('c1', 'e9', { enabled: false }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('effect')
      expect(error.entity).toEqual({ kind: 'effect', id: 'e9' })
      expect(error.valid).toEqual(['e1', 'e2'])
      expect(error.message).toBe(
        'effects.update: "effect" must be an existing effect id on clip "c1" (got "e9"); ' +
          'valid: "e1", "e2"',
      )
    })

    it('rejects an unknown parameter name', () => {
      const error = catchError(() => api.update('c1', 'e1', { params: { glow: 0.3 } }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.message).toBe(
        'effects.update: "params.glow" must be a parameter of effect "gpu-brightness" ' +
          '(got 0.3); valid: "amount"',
      )
    })

    it('rejects a parameter outside its range, naming the range', () => {
      const error = catchError(() => api.update('c1', 'e2', { params: { centerX: 2 } }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.message).toBe(
        'effects.update: "params.centerX" must be a number between 0 and 1 (got 2)',
      )
    })

    it('rejects a non-boolean enabled flag', () => {
      const error = catchError(() => api.update('c1', 'e1', { enabled: 1 as unknown as boolean }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('enabled')
      expect(error.message).toBe('effects.update: "enabled" must be true or false (got 1)')
    })

    it('rejects a patch field effects.update does not know', () => {
      const error = catchError(() =>
        api.update('c1', 'e1', { enable: false } as unknown as EffectPatch),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('patch.enable')
      expect(error.valid).toEqual(['params', 'enabled'])
      expect(error.message).toBe(
        'effects.update: "patch.enable" must be a field of an effects.update patch ' +
          '(got false); valid: "params", "enabled"',
      )
      expect(effectsOf('c1')[0]?.enabled).toBe(true)
      expect(undoDepth()).toBe(0)
    })

    it('rejects a patch that is not an object', () => {
      const error = catchError(() => api.update('c1', 'e1', null as unknown as EffectPatch))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('patch')
      expect(error.message).toBe(
        'effects.update: "patch" must be an object with optional "params" and "enabled" ' +
          'fields (got null)',
      )
    })

    it('rejects parameter updates on an effect type this build does not know', () => {
      useItemsStore.getState().setItems([
        makeTimelineVideoItem({
          id: 'c1',
          trackId: 'track-v1',
          effects: [
            {
              id: 'e-old',
              effect: { type: 'gpu-effect', gpuEffectType: 'gpu-retired', params: { amount: 0.5 } },
              enabled: true,
            },
          ],
        }),
      ])

      const error = catchError(() => api.update('c1', 'e-old', { params: { amount: 0.6 } }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('params')
      expect(error.valid).toEqual([...GPU_EFFECT_REGISTRY.keys()])
      expect(error.hint).toContain('"gpu-retired" is not in studio.effects.types()')
      expect(effectsOf('c1')[0]?.effect.params).toEqual({ amount: 0.5 })
      expect(undoDepth()).toBe(0)

      // The enabled flag is a plain field of the instance: no definition needed.
      api.update('c1', 'e-old', { enabled: false })

      expect(effectsOf('c1')[0]?.enabled).toBe(false)
      expect(lastCommandType()).toBe('EFFECTS_UPDATE')
    })
  })

  describe('remove', () => {
    it('removes the effect from the clip', () => {
      api.remove('c1', 'e1')

      expect(effectsOf('c1').map((effect) => effect.id)).toEqual(['e2'])
    })

    it('is one undo entry, undone in one step', () => {
      const before = buildTimelineFromStores()

      api.remove('c1', 'e1')

      expect(undoDepth()).toBe(1)
      expect(lastCommandType()).toBe('EFFECTS_REMOVE')
      expect(effectsOf('c1').map((effect) => effect.id)).toEqual(['e2'])

      useTimelineCommandStore.getState().undo()

      expect(buildTimelineFromStores()).toEqual(before)
      expect(undoDepth()).toBe(0)
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => api.remove('nope', 'e1'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toBe(
        'effects.remove: "clip" must be an existing clip id on the main timeline (got "nope"); ' +
          'valid: "c1", "a1"',
      )
    })

    it('throws NOT_FOUND for an effect of another clip', () => {
      const error = catchError(() => api.remove('c1', 'e9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.entity).toEqual({ kind: 'effect', id: 'e9' })
      expect(error.message).toBe(
        'effects.remove: "effect" must be an existing effect id on clip "c1" (got "e9"); ' +
          'valid: "e1", "e2"',
      )
    })
  })

  it('leaves the project unchanged when a call is rejected', () => {
    const before = buildTimelineFromStores()

    catchError(() => api.add('c1', 'gpu-nope'))
    catchError(() => api.add('c1', 'gpu-brightness', { amount: 9 }))
    catchError(() => api.update('c1', 'e1', { params: { amount: 9 } }))
    catchError(() => api.update('c1', 'e1', { enable: false } as unknown as EffectPatch))
    catchError(() => api.remove('c1', 'e9'))

    expect(buildTimelineFromStores()).toEqual(before)
    expect(undoDepth()).toBe(0)
  })

  describe('the @example of every method', () => {
    it('runs as written', () => {
      const studio = { effects: api }

      // types.ts: @example studio.effects.types()
      expect(studio.effects.types().length).toBe(55)

      // types.ts: @example studio.effects.list('c1')
      expect(studio.effects.list('c1')).toHaveLength(2)

      // types.ts: @example const id = studio.effects.add('c1', 'gpu-brightness', { amount: 0.1 })
      const id = studio.effects.add('c1', 'gpu-brightness', { amount: 0.1 })
      expect(effectsOf('c1').at(-1)?.id).toBe(id)

      // types.ts: @example studio.effects.update('c1', 'e1', { enabled: false })
      studio.effects.update('c1', 'e1', { enabled: false })
      expect(effectsOf('c1')[0]?.enabled).toBe(false)

      // types.ts: @example studio.effects.remove('c1', 'e1')
      studio.effects.remove('c1', 'e1')
      expect(effectsOf('c1').map((effect) => effect.id)).not.toContain('e1')
    })
  })
})
