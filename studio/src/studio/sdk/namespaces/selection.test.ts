// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Transition } from '@/types/transition'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { updateItem } from '@/features/timeline/stores/actions/item-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useSelectionStore } from '@/shared/state/selection'
import { StudioError } from '../errors'
import { createSelectionApi } from './selection'

const selection = createSelectionApi()

/** The transition the examples and the NOT_FOUND test use. */
const TRANSITION: Transition = {
  id: 'x1',
  type: 'crossfade',
  presentation: 'fade',
  timing: 'linear',
  leftClipId: 'c1',
  rightClipId: 'c2',
  trackId: 'v1',
  durationInFrames: 30,
}

/** Two clips on V1, an audio track, a marker and a transition. */
function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
    ])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'c1',
      trackId: 'v1',
      from: 0,
      durationInFrames: 120,
      sourceEnd: 120,
      sourceDuration: 240,
    }),
    makeTimelineVideoItem({
      id: 'c2',
      trackId: 'v1',
      from: 120,
      durationInFrames: 120,
      sourceStart: 120,
      sourceEnd: 240,
      sourceDuration: 240,
    }),
  ])
  useMarkersStore.getState().setMarkers([{ id: 'k1', frame: 60, color: '#3B82F6' }])
  useTransitionsStore.getState().setTransitions([TRANSITION])
}

/** Empty selection, whatever another test file left in the shared store. */
function emptySelection(): void {
  useSelectionStore.setState({
    selectedItemIds: [],
    selectedItemIdSet: new Set<string>(),
    expandedKeyframeLanes: new Set<string>(),
    selectedMarkerId: null,
    selectedTransitionId: null,
    selectedTrackId: null,
    selectedTrackIds: [],
    activeTrackId: null,
    selectionType: null,
    editKeyframePanelOpen: false,
  })
}

/** An undo entry to protect: selection calls must leave the history alone. */
function seedUndoEntry(): void {
  updateItem('c1', { volume: -3 })
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

/** Run `call` and check it left the undo and redo stacks untouched. */
function expectNoUndoStep(call: () => void): void {
  const before = useTimelineCommandStore.getState()
  call()
  const after = useTimelineCommandStore.getState()
  expect(after.undoStack).toBe(before.undoStack)
  expect(after.redoStack).toBe(before.redoStack)
  expect(after.undoStack.length).toBe(before.undoStack.length)
  expect(after.getLastCommandType()).toBe('UPDATE_ITEM')
}

function catchError(call: () => unknown): StudioError {
  try {
    call()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

describe('selection.get', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    emptySelection()
  })

  it('reports no selection before anything is selected', () => {
    expect(selection.get()).toEqual({ clips: [], tracks: [], marker: null, transition: null })
  })

  it('returns the store selection field by field', () => {
    useSelectionStore.getState().selectTracks(['v1', 'a1'])
    useSelectionStore.getState().selectItems(['c1', 'c2'])

    expect(selection.get()).toEqual({
      clips: ['c1', 'c2'],
      tracks: ['v1', 'a1'],
      marker: null,
      transition: null,
    })
  })

  it('returns copies, not the store arrays', () => {
    selection.set({ clips: ['c1'] })
    const state = useSelectionStore.getState()
    const info = selection.get()

    expect(info.clips).not.toBe(state.selectedItemIds)
    expect(info.tracks).not.toBe(state.selectedTrackIds)
    expect(info.clips).toEqual(['c1'])

    info.clips.push('c2')
    info.tracks.push('a1')
    expect(selection.get().clips).toEqual(['c1'])
    expect(selection.get().tracks).toEqual([])
  })

  it('returns a new object on every call', () => {
    expect(selection.get()).not.toBe(selection.get())
  })
})

describe('selection.set', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    emptySelection()
  })

  it('selects clips and mirrors them in the store indexes', () => {
    selection.set({ clips: ['c1', 'c2'] })

    expect(selection.get()).toEqual({
      clips: ['c1', 'c2'],
      tracks: [],
      marker: null,
      transition: null,
    })
    const state = useSelectionStore.getState()
    expect(state.selectedItemIdSet).toEqual(new Set(['c1', 'c2']))
    expect(state.selectionType).toBe('item')
  })

  it('selects tracks and makes the first one active', () => {
    selection.set({ tracks: ['v1', 'a1'] })

    expect(selection.get()).toEqual({
      clips: [],
      tracks: ['v1', 'a1'],
      marker: null,
      transition: null,
    })
    const state = useSelectionStore.getState()
    expect(state.activeTrackId).toBe('v1')
    expect(state.selectedTrackId).toBe('v1')
    expect(state.selectionType).toBe('track')
  })

  it('selects a marker and clears the clip selection', () => {
    selection.set({ clips: ['c1'] })
    selection.set({ marker: 'k1' })

    expect(selection.get()).toEqual({ clips: [], tracks: [], marker: 'k1', transition: null })
    expect(useSelectionStore.getState().selectionType).toBe('marker')
  })

  it('selects a transition and clears the marker selection', () => {
    selection.set({ marker: 'k1' })
    selection.set({ transition: 'x1' })

    expect(selection.get()).toEqual({ clips: [], tracks: [], marker: null, transition: 'x1' })
    expect(useSelectionStore.getState().selectionType).toBe('transition')
  })

  it('keeps the fields the patch does not name', () => {
    selection.set({ tracks: ['v1', 'a1'] })
    // selectItems keeps a track selection, so the patch adds clips to it.
    selection.set({ clips: ['c1'] })
    // Clearing a marker that is not selected changes nothing else.
    selection.set({ marker: null })

    expect(selection.get()).toEqual({
      clips: ['c1'],
      tracks: ['v1', 'a1'],
      marker: null,
      transition: null,
    })

    // Clearing the track selection keeps the clip selection.
    selection.set({ tracks: [] })

    expect(selection.get()).toEqual({ clips: ['c1'], tracks: [], marker: null, transition: null })
  })

  it('clears one field with null or an empty list', () => {
    selection.set({ clips: ['c1'], tracks: ['v1'] })
    selection.set({ clips: [] })
    expect(selection.get()).toEqual({ clips: [], tracks: ['v1'], marker: null, transition: null })

    selection.set({ marker: 'k1' })
    selection.set({ marker: null })
    expect(selection.get()).toEqual({ clips: [], tracks: ['v1'], marker: null, transition: null })

    selection.set({ transition: 'x1' })
    selection.set({ transition: null })
    expect(selection.get()).toEqual({ clips: [], tracks: ['v1'], marker: null, transition: null })
  })

  it('replaces the previous primary selection', () => {
    selection.set({ clips: ['c1'] })
    selection.set({ marker: 'k1' })
    expect(selection.get().clips).toEqual([])

    selection.set({ clips: ['c2'] })
    expect(selection.get().marker).toBeNull()

    selection.set({ transition: 'x1' })
    expect(selection.get().clips).toEqual([])

    selection.set({ tracks: ['a1'] })
    expect(selection.get()).toEqual({
      clips: [],
      tracks: ['a1'],
      marker: null,
      transition: null,
    })
  })

  it('leaves the store untouched when nothing changes', () => {
    selection.set({ clips: ['c1'] })
    const before = useSelectionStore.getState()

    selection.set({ clips: ['c1'] })

    expect(useSelectionStore.getState()).toBe(before)
  })

  it('keeps the keyframe lanes on the single selected clip', () => {
    useSelectionStore.setState({ editKeyframePanelOpen: true })

    selection.set({ clips: ['c1'] })
    expect(useSelectionStore.getState().expandedKeyframeLanes).toEqual(new Set(['c1']))

    selection.set({ clips: ['c1', 'c2'] })
    expect(useSelectionStore.getState().expandedKeyframeLanes).toEqual(new Set())

    selection.set({ marker: 'k1' })
    expect(useSelectionStore.getState().expandedKeyframeLanes).toEqual(new Set())
  })
})

describe('selection.set errors', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    emptySelection()
  })

  it('names the clip id that does not exist', () => {
    const error = catchError(() => selection.set({ clips: ['c9'] }))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('clips')
    expect(error.entity).toEqual({ kind: 'clip', id: 'c9' })
    expect(error.valid).toEqual(['c1', 'c2'])
    expect(error.message).toBe(
      'selection.set: "clips" must be an existing clip id on the main timeline (got "c9"); ' +
        'valid: "c1", "c2"',
    )
    expect(error.hint).toContain('studio.project.context()')
  })

  it('names the track id that does not exist', () => {
    const error = catchError(() => selection.set({ tracks: ['v9'] }))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('tracks')
    expect(error.entity).toEqual({ kind: 'track', id: 'v9' })
    expect(error.valid).toEqual(['v1', 'a1'])
    expect(error.message).toBe(
      'selection.set: "tracks" must be an existing track id on the main timeline (got "v9"); ' +
        'valid: "v1", "a1"',
    )
  })

  it('names the marker id that does not exist', () => {
    const error = catchError(() => selection.set({ marker: 'k9' }))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('marker')
    expect(error.entity).toEqual({ kind: 'marker', id: 'k9' })
    expect(error.valid).toEqual(['k1'])
    expect(error.message).toBe(
      'selection.set: "marker" must be an existing marker id on the main timeline (got "k9"); ' +
        'valid: "k1"',
    )
  })

  it('names the transition id that does not exist', () => {
    const error = catchError(() => selection.set({ transition: 'x9' }))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('transition')
    expect(error.entity).toEqual({ kind: 'transition', id: 'x9' })
    expect(error.valid).toEqual(['x1'])
    expect(error.message).toBe(
      'selection.set: "transition" must be an existing transition id on the main timeline ' +
        '(got "x9"); valid: "x1"',
    )
  })

  it('rejects a patch that names two primary selections at once', () => {
    const error = catchError(() => selection.set({ clips: ['c1'], marker: 'k1' }))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('marker')
    expect(error.message).toBe(
      'selection.set: "marker" must be named alone, because clips and marker cannot both be ' +
        'selected (got "clips and marker")',
    )
    // The rejected patch changed nothing.
    expect(selection.get()).toEqual({ clips: [], tracks: [], marker: null, transition: null })
  })

  it('rejects a field that is not an array of ids', () => {
    const error = catchError(() => selection.set({ clips: 'c1' as unknown as string[] }))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('clips')
    expect(error.message).toBe('selection.set: "clips" must be an array of ids (got "c1")')
  })
})

describe('selection.clear', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    emptySelection()
  })

  it('clears clips, tracks and the active track', () => {
    selection.set({ clips: ['c1'] })
    selection.set({ tracks: ['v1', 'a1'] })

    selection.clear()

    expect(selection.get()).toEqual({ clips: [], tracks: [], marker: null, transition: null })
    const state = useSelectionStore.getState()
    expect(state.activeTrackId).toBeNull()
    expect(state.selectedTrackId).toBeNull()
    expect(state.selectedItemIdSet).toEqual(new Set())
    expect(state.selectionType).toBeNull()
  })

  it('clears a marker and a transition', () => {
    selection.set({ marker: 'k1' })
    selection.clear()
    expect(selection.get().marker).toBeNull()

    selection.set({ transition: 'x1' })
    selection.clear()
    expect(selection.get().transition).toBeNull()
  })
})

describe('selection is never an undo step', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    emptySelection()
  })

  it('leaves the undo history alone for every method', () => {
    expect(undoDepth()).toBe(1)

    expectNoUndoStep(() => selection.get())
    expectNoUndoStep(() => selection.set({ clips: ['c1'] }))
    expectNoUndoStep(() => selection.set({ tracks: ['v1'] }))
    expectNoUndoStep(() => selection.set({ marker: 'k1' }))
    expectNoUndoStep(() => selection.set({ transition: 'x1' }))
    expectNoUndoStep(() => selection.clear())

    expect(undoDepth()).toBe(1)
  })
})

describe('selection examples', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
    seedUndoEntry()
    emptySelection()
  })

  it('runs every documented example as written', () => {
    const studio = { selection: createSelectionApi() }

    expect(studio.selection.get()).toEqual({
      clips: [],
      tracks: [],
      marker: null,
      transition: null,
    })

    studio.selection.set({ clips: ['c1'] })
    expect(studio.selection.get().clips).toEqual(['c1'])

    studio.selection.clear()
    expect(studio.selection.get().clips).toEqual([])
  })
})
