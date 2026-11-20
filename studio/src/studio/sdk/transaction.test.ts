// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { addEffect, updateEffect } from '@/features/timeline/stores/actions/effect-actions'
import { updateItem } from '@/features/timeline/stores/actions/item-actions'
import { addMarker } from '@/features/timeline/stores/actions/marker-actions'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { buildTimelineFromStores } from '@/features/timeline/stores/timeline-persistence'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { StudioError } from './errors'
import { transaction } from './transaction'
import type {
  Changes,
  ClipId,
  ClipsApi,
  EffectsApi,
  ExportApi,
  ExportJobInfo,
  Frame,
  HistoryApi,
  WorkspaceApi,
  KeyframesApi,
  MarkersApi,
  MediaApi,
  SubclipsApi,
  PlaybackApi,
  ProjectApi,
  ProjectCreateInput,
  ProjectInfo,
  Rate,
  SelectionApi,
  Studio,
  TimelineContext,
  TitlesApi,
  TracksApi,
  TransactionResult,
  TransitionsApi,
} from './types'

/** Two clips and a track, seeded through the stores the actions write. */
function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'clip-1',
      trackId: 'track-v1',
      durationInFrames: 120,
      sourceEnd: 120,
      sourceDuration: 240,
      volume: 0,
    }),
  ])
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

describe('transaction', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.getState().setFps(30)
    seedTimeline()
  })

  it('commits two store changes as one undo entry', () => {
    const depthBefore = undoDepth()

    const { value, changes } = transaction('CLIPS_UPDATE', () => {
      updateItem('clip-1', { volume: -6 })
      updateItem('clip-1', { label: 'renamed' })
      return 'done'
    })

    expect(value).toBe('done')
    expect(undoDepth()).toBe(depthBefore + 1)
    expect(changes.undoSteps).toBe(1)
    expect(changes.commands.map((command) => command.type)).toEqual(['UPDATE_ITEM', 'UPDATE_ITEM'])
    expect(useItemsStore.getState().itemById['clip-1']).toMatchObject({
      volume: -6,
      label: 'renamed',
    })

    useTimelineCommandStore.getState().undo()

    expect(useItemsStore.getState().itemById['clip-1']).toMatchObject({
      volume: 0,
      label: 'clip.mp4',
    })
    expect(undoDepth()).toBe(depthBefore)
  })

  it('adds no entry when a call writes the values it already has', () => {
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    const { changes } = transaction('CLIPS_UPDATE', () => {
      // The store replaces the item and its array even for an equal value.
      updateItem('clip-1', { volume: 0 })
    })

    expect(undoDepth()).toBe(depthBefore)
    expect(changes).toEqual({
      commands: [],
      added: [],
      removed: [],
      updated: [],
      undoSteps: 0,
    })
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('adds no entry when an effect is updated with its current values', () => {
    transaction('EFFECTS_ADD', () => {
      addEffect('clip-1', { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: {} })
    })
    const effect = useItemsStore.getState().itemById['clip-1']?.effects?.[0]
    expect(effect).toBeDefined()
    const depthBefore = undoDepth()

    const { changes } = transaction('EFFECTS_UPDATE', () => {
      updateEffect('clip-1', effect!.id, { effect: effect!.effect, enabled: effect!.enabled })
    })

    expect(undoDepth()).toBe(depthBefore)
    expect(changes).toEqual({
      commands: [],
      added: [],
      removed: [],
      updated: [],
      undoSteps: 0,
    })
  })

  it('adds one entry when the same effect is updated with a different value', () => {
    transaction('EFFECTS_ADD', () => {
      addEffect('clip-1', { type: 'gpu-effect', gpuEffectType: 'gpu-brightness', params: {} })
    })
    const effect = useItemsStore.getState().itemById['clip-1']?.effects?.[0]
    expect(effect).toBeDefined()
    const depthBefore = undoDepth()

    const { changes } = transaction('EFFECTS_UPDATE', () => {
      updateEffect('clip-1', effect!.id, { enabled: !effect!.enabled })
    })

    expect(undoDepth()).toBe(depthBefore + 1)
    expect(changes.undoSteps).toBe(1)
    expect(changes.updated).toEqual([
      { kind: 'clip', id: 'clip-1', fields: ['effects'] },
      { kind: 'effect', id: effect!.id, clip: 'clip-1', fields: ['enabled'] },
    ])
  })

  it('restores the project and adds nothing when the callback throws', () => {
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    let thrown: unknown
    try {
      transaction('CLIPS_UPDATE', () => {
        updateItem('clip-1', { volume: -6 })
        throw new Error('boom')
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(StudioError)
    expect((thrown as StudioError).code).toBe('INTERNAL')
    expect((thrown as StudioError).message).toBe('boom')
    expect(buildTimelineFromStores()).toEqual(before)
    expect(undoDepth()).toBe(depthBefore)
    expect(useTimelineCommandStore.getState().canUndo).toBe(false)
  })

  it('rethrows a StudioError unchanged and restores the project', () => {
    const before = buildTimelineFromStores()
    const failure = new StudioError({ code: 'CONFLICT', message: 'clips.split: no' })

    let thrown: unknown
    try {
      transaction('CLIPS_SPLIT', () => {
        updateItem('clip-1', { volume: -6 })
        throw failure
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(failure)
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('commits a nested transaction once, at the outermost level', () => {
    const depthBefore = undoDepth()

    const { changes } = transaction('OUTER', () => {
      updateItem('clip-1', { volume: -6 })
      return transaction('INNER', () => {
        addMarker(30)
      })
    })

    expect(undoDepth()).toBe(depthBefore + 1)
    expect(changes.undoSteps).toBe(1)
    expect(changes.commands.map((command) => command.type)).toEqual(['UPDATE_ITEM', 'ADD_MARKER'])

    useTimelineCommandStore.getState().undo()

    expect(useItemsStore.getState().itemById['clip-1']).toMatchObject({ volume: 0 })
    expect(useMarkersStore.getState().markers).toHaveLength(0)
  })

  it('reports the commands of interleaved outer and inner calls in order', () => {
    const { changes } = transaction('OUTER', () => {
      updateItem('clip-1', { volume: -6 })
      transaction('INNER', () => {
        addMarker(30)
      })
      updateItem('clip-1', { label: 'nested' })
    })

    expect(changes.commands.map((command) => command.type)).toEqual([
      'UPDATE_ITEM',
      'ADD_MARKER',
      'UPDATE_ITEM',
    ])
  })

  it('reports the inner transaction as no undo step of its own', () => {
    const outer = transaction('OUTER', () =>
      transaction('INNER', () => updateItem('clip-1', { volume: -6 })),
    )

    expect(outer.value.changes.undoSteps).toBe(0)
    expect(outer.value.changes.updated).toEqual([
      { kind: 'clip', id: 'clip-1', fields: ['volume'] },
    ])
    expect(outer.changes.undoSteps).toBe(1)
  })

  it('reports the edits made after an await in settled, as the history counts them', async () => {
    const depthBefore = undoDepth()

    const result = transaction('ASYNC', async () => {
      updateItem('clip-1', { volume: -6 })
      await Promise.resolve()
      // An awaited SDK call is an outermost transaction of its own.
      transaction('LATER', () => {
        addMarker(30)
      })
      await Promise.resolve()
      return 'done'
    })

    // The synchronous part alone.
    expect(result.changes.undoSteps).toBe(1)
    expect(result.changes.added).toEqual([])
    const settled = await result.settled
    expect(await result.value).toBe('done')

    expect(undoDepth() - depthBefore).toBe(2)
    expect(settled?.undoSteps).toBe(2)
    expect(settled?.updated).toEqual([{ kind: 'clip', id: 'clip-1', fields: ['volume'] }])
    expect(settled?.added).toEqual([expect.objectContaining({ kind: 'marker' })])
    expect(settled?.commands.map((command) => command.type)).toEqual(['UPDATE_ITEM', 'ADD_MARKER'])
  })

  it('settles with the changes made so far when the promise rejects, and stops observing', async () => {
    const result = transaction('ASYNC_FAIL', async () => {
      updateItem('clip-1', { volume: -6 })
      await Promise.resolve()
      throw new Error('later failure')
    })
    await expect(result.value).rejects.toThrow('later failure')
    const settled = await result.settled
    expect(settled?.undoSteps).toBe(1)

    // A later, unrelated call is not added to the finished scope.
    transaction('AFTER', () => {
      addMarker(10)
    })
    expect((await result.settled)?.undoSteps).toBe(1)
  })

  it('gives a synchronous callback no settled', () => {
    expect(transaction('SYNC', () => 1).settled).toBeUndefined()
  })

  it('adds no entry when the callback changes nothing', () => {
    const depthBefore = undoDepth()

    const { value, changes } = transaction('NOOP', () => 42)

    expect(value).toBe(42)
    expect(changes.undoSteps).toBe(0)
    expect(changes.commands).toEqual([])
    expect(changes.added).toEqual([])
    expect(changes.removed).toEqual([])
    expect(changes.updated).toEqual([])
    expect(undoDepth()).toBe(depthBefore)
  })
})

// ---------------------------------------------------------------------------
// The public interface: every namespace and method of design §4.2 and §0.
// The annotations below are compile-time assertions: a missing or renamed
// method, or a namespace that is not on `Studio`, fails `vp run check`.
// ---------------------------------------------------------------------------

/** Method names of an interface that are callable. */
type MethodName<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never
}[keyof T]

const NAMESPACES = [
  'project',
  'media',
  'subclips',
  'tracks',
  'clips',
  'titles',
  'effects',
  'keyframes',
  'transitions',
  'markers',
  'selection',
  'playback',
  'export',
  'history',
  'workspace',
] as const satisfies ReadonlyArray<keyof Studio>

const PROJECT_METHODS = [
  'current',
  'list',
  'create',
  'rate',
  'context',
  'duration',
  'set',
  'save',
  'open',
] as const satisfies ReadonlyArray<MethodName<ProjectApi>>

const SUBCLIPS_METHODS = [
  'list',
  'get',
  'create',
  'rename',
  'remove',
] as const satisfies ReadonlyArray<MethodName<SubclipsApi>>

const MEDIA_METHODS = ['list', 'get', 'import', 'remove', 'url'] as const satisfies ReadonlyArray<
  MethodName<MediaApi>
>

const TRACKS_METHODS = [
  'list',
  'add',
  'update',
  'remove',
  'reorder',
] as const satisfies ReadonlyArray<MethodName<TracksApi>>

const CLIPS_METHODS = [
  'list',
  'get',
  'add',
  'addMany',
  'update',
  'move',
  'remove',
  'duplicate',
  'split',
  'trimStart',
  'trimEnd',
  'setSpeed',
] as const satisfies ReadonlyArray<MethodName<ClipsApi>>

const TITLES_METHODS = ['list', 'add', 'update'] as const satisfies ReadonlyArray<
  MethodName<TitlesApi>
>

const EFFECTS_METHODS = [
  'types',
  'list',
  'add',
  'update',
  'remove',
] as const satisfies ReadonlyArray<MethodName<EffectsApi>>

const KEYFRAMES_METHODS = [
  'properties',
  'list',
  'add',
  'update',
  'remove',
  'removeAll',
] as const satisfies ReadonlyArray<MethodName<KeyframesApi>>

const TRANSITIONS_METHODS = [
  'presentations',
  'list',
  'add',
  'update',
  'remove',
] as const satisfies ReadonlyArray<MethodName<TransitionsApi>>

const MARKERS_METHODS = [
  'list',
  'add',
  'update',
  'remove',
  'clear',
  'range',
  'setIn',
  'setOut',
  'clearRange',
] as const satisfies ReadonlyArray<MethodName<MarkersApi>>

const SELECTION_METHODS = ['get', 'set', 'clear'] as const satisfies ReadonlyArray<
  MethodName<SelectionApi>
>

const PLAYBACK_METHODS = [
  'get',
  'seek',
  'play',
  'pause',
  'setRate',
  'setLoop',
] as const satisfies ReadonlyArray<MethodName<PlaybackApi>>

const EXPORT_METHODS = [
  'settings',
  'setSettings',
  'start',
  'jobs',
  'status',
  'wait',
  'cancel',
] as const satisfies ReadonlyArray<MethodName<ExportApi>>

const HISTORY_METHODS = [
  'undo',
  'redo',
  'canUndo',
  'canRedo',
  'undoLabel',
  'redoLabel',
  'clear',
  'depth',
] as const satisfies ReadonlyArray<MethodName<HistoryApi>>

const WORKSPACE_METHODS = ['isOpen'] as const satisfies ReadonlyArray<MethodName<WorkspaceApi>>

/** `Studio` also carries the two members the design lists outside the namespaces. */
const STUDIO_METHODS = ['transaction', 'reference'] as const satisfies ReadonlyArray<
  MethodName<Studio>
>

/** True only when two types are identical, so a signature check cannot drift. */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** The signatures of the decisions in §0, checked at compile time. */
const projectCreateTakesInput: Equals<Parameters<ProjectApi['create']>, [ProjectCreateInput]> = true
const projectCreateReturnsInfo: Equals<
  ReturnType<ProjectApi['create']>,
  Promise<ProjectInfo>
> = true
const projectListReturnsInfos: Equals<ReturnType<ProjectApi['list']>, Promise<ProjectInfo[]>> = true
const projectCreateTakesRate: Equals<ProjectCreateInput['fps'], Rate> = true
const projectRateReturnsRate: Equals<ReturnType<ProjectApi['rate']>, Rate> = true
const projectContextReturnsContext: Equals<
  ReturnType<ProjectApi['context']>,
  TimelineContext
> = true
const projectDurationReturnsFrame: Equals<ReturnType<ProjectApi['duration']>, Frame> = true
const exportStartReturnsJob: Equals<ReturnType<ExportApi['start']>, Promise<ExportJobInfo>> = true
const transactionTakesLabel: Equals<Parameters<Studio['transaction']>[0], string> = true
const transactionTakesStudioCallback: Equals<
  Parameters<Studio['transaction']>[1],
  (studio: Studio) => unknown
> = true
const transactionReturnsResult: Equals<
  ReturnType<Studio['transaction']>,
  TransactionResult<unknown>
> = true
const changesFields: Equals<
  keyof Changes,
  'commands' | 'added' | 'removed' | 'updated' | 'undoSteps'
> = true
const clipIdIsString: Equals<ClipId, string> = true
const frameIsNumber: Equals<Frame, number> = true

const SIGNATURE_CHECKS = [
  projectCreateTakesInput,
  projectCreateReturnsInfo,
  projectListReturnsInfos,
  projectCreateTakesRate,
  projectRateReturnsRate,
  projectContextReturnsContext,
  projectDurationReturnsFrame,
  exportStartReturnsJob,
  transactionTakesLabel,
  transactionTakesStudioCallback,
  transactionReturnsResult,
  changesFields,
  clipIdIsString,
  frameIsNumber,
]

describe('the Studio interface', () => {
  it('declares fifteen namespaces', () => {
    expect(NAMESPACES).toHaveLength(15)
  })

  it('declares every method of the design', () => {
    const methodCount =
      PROJECT_METHODS.length +
      MEDIA_METHODS.length +
      SUBCLIPS_METHODS.length +
      TRACKS_METHODS.length +
      CLIPS_METHODS.length +
      TITLES_METHODS.length +
      EFFECTS_METHODS.length +
      KEYFRAMES_METHODS.length +
      TRANSITIONS_METHODS.length +
      MARKERS_METHODS.length +
      SELECTION_METHODS.length +
      PLAYBACK_METHODS.length +
      EXPORT_METHODS.length +
      HISTORY_METHODS.length +
      WORKSPACE_METHODS.length +
      STUDIO_METHODS.length

    expect(methodCount).toBe(91)
    expect(NAMESPACES).toContain('export')
    expect(NAMESPACES).toContain('history')
  })

  it('types the decisions of §0 as designed', () => {
    expect(SIGNATURE_CHECKS.every((check) => check)).toBe(true)
  })
})
