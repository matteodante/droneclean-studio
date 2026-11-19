// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useSelectionStore } from '@/shared/state/selection'
import { StudioError } from '../errors'
import { transaction } from '../transaction'
import type { TrackId, TrackKind, TrackPatch, TracksApi } from '../types'
import { createTracksApi } from './tracks'

/** The namespace under test, as `studio.tracks` will expose it. */
const api: TracksApi = createTracksApi()

/** Four tracks, top to bottom, plus one clip on `a1` and one on `v1`/`a2`. */
function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'v1', name: 'Top video', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'v2', name: 'Bottom video', kind: 'video', order: 1 }),
      makeTimelineTrack({ id: 'a1', name: 'Top audio', kind: 'audio', order: 2 }),
      makeTimelineTrack({ id: 'a2', name: 'Bottom audio', kind: 'audio', order: 3 }),
    ])
  useItemsStore
    .getState()
    .setItems([
      makeTimelineVideoItem({ id: 'clip-v1', trackId: 'v1', durationInFrames: 60, sourceEnd: 60 }),
      makeTimelineAudioItem({ id: 'clip-a1', trackId: 'a1', durationInFrames: 60, sourceEnd: 60 }),
      makeTimelineVideoItem({ id: 'clip-a2', trackId: 'a2', durationInFrames: 30, sourceEnd: 30 }),
    ])
}

/** What a call may change: the SDK's view of the tracks and the stored clips. */
function timelineState(): { tracks: ReturnType<TracksApi['list']>; items: unknown } {
  return { tracks: api.list(), items: useItemsStore.getState().items }
}

/** How many undo entries the history holds. */
function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

/** The command type of the newest undo entry, i.e. the label a call pushed. */
function lastCommandType(): string | undefined {
  return useTimelineCommandStore.getState().undoStack.at(-1)?.command.type
}

/** Run `fn` and return the `StudioError` it threw. */
function catchError(fn: () => unknown): StudioError {
  try {
    fn()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

describe('studio.tracks', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.getState().setFps(30)
    useSelectionStore.getState().clearSelection()
    seedTimeline()
  })

  describe('list', () => {
    it('returns the tracks from top to bottom with their stack position', () => {
      expect(api.list()).toEqual([
        {
          id: 'v1',
          name: 'Top video',
          kind: 'video',
          height: 100,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          volume: 0,
          order: 0,
        },
        {
          id: 'v2',
          name: 'Bottom video',
          kind: 'video',
          height: 100,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          volume: 0,
          order: 1,
        },
        {
          id: 'a1',
          name: 'Top audio',
          kind: 'audio',
          height: 100,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          volume: 0,
          order: 2,
        },
        {
          id: 'a2',
          name: 'Bottom audio',
          kind: 'audio',
          height: 100,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          volume: 0,
          order: 3,
        },
      ])
    })

    it('omits the optional fields the store does not set', () => {
      useItemsStore
        .getState()
        .setTracks([makeTimelineTrack({ id: 'plain', name: 'Plain', order: 0 })])

      const [track] = api.list()

      expect(track).toEqual({
        id: 'plain',
        name: 'Plain',
        height: 100,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        volume: 0,
        order: 0,
      })
      expect(track && 'kind' in track).toBe(false)
      expect(track && 'syncLock' in track).toBe(false)
    })

    it('returns fresh JSON copies, never store objects', () => {
      const first = api.list()[0]!
      first.name = 'changed'
      first.locked = true

      expect(useItemsStore.getState().tracks[0]).toMatchObject({
        name: 'Top video',
        locked: false,
      })
      expect(api.list()[0]).not.toBe(first)
      expect(JSON.parse(JSON.stringify(api.list()))).toEqual(api.list())
    })
  })

  describe('add', () => {
    it('appends a track at the bottom and is one undo step', () => {
      const before = timelineState()
      const depth = undoDepth()

      const id = api.add({ kind: 'audio', name: 'Music' })

      expect(id).toMatch(/^track-/)
      expect(api.list().map((track) => track.id)).toEqual(['v1', 'v2', 'a1', 'a2', id])
      expect(api.list().find((track) => track.id === id)).toMatchObject({
        name: 'Music',
        kind: 'audio',
        order: 4,
      })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('TRACKS_ADD')

      useTimelineCommandStore.getState().undo()

      expect(timelineState()).toEqual(before)
      expect(undoDepth()).toBe(depth)
    })

    it('reports the new track as added', () => {
      const { changes } = transaction('TEST', () => {
        api.add({ kind: 'video', position: 0 })
      })

      expect(changes.added).toEqual([{ kind: 'track', id: api.list()[0]!.id }])
      expect(changes.updated).toEqual([])
      expect(changes.removed).toEqual([])
      expect(changes.commands.map((command) => command.type)).toEqual(['SET_TRACKS'])
      expect(changes.undoSteps).toBe(1)
    })

    it('inserts at a position and names a video track V1', () => {
      const id = api.add({ kind: 'video', position: 1 })

      expect(api.list().map((track) => track.id)).toEqual(['v1', id, 'v2', 'a1', 'a2'])
      expect(api.list()[1]).toMatchObject({ kind: 'video', name: 'V1', order: 1 })
    })

    it('builds the new track the way the track header does', () => {
      const id = api.add({ kind: 'audio', position: 0 })

      expect(api.list()[0]).toEqual({
        id,
        name: 'A1',
        kind: 'audio',
        height: 100,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        volume: 0,
        order: 0,
      })
      expect(api.list().map((track) => track.order)).toEqual([0, 1, 2, 3, 4])
    })

    it('rejects a position outside the stack without touching the project', () => {
      const before = timelineState()
      const depth = undoDepth()

      for (const position of [-1, 5, 1.5, Number.NaN]) {
        const error = catchError(() => api.add({ kind: 'video', position }))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('position')
        expect(error.message).toContain('an integer from 0 to 4 (0 = top)')
      }

      expect(timelineState()).toEqual(before)
      expect(undoDepth()).toBe(depth)
      expect(catchError(() => api.add({ kind: 'video', position: -1 })).message).toBe(
        'tracks.add: "position" must be an integer from 0 to 4 (0 = top) (got -1)',
      )
    })

    it('rejects a kind the stack does not have', () => {
      const error = catchError(() => api.add({ kind: 'music' as TrackKind }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('kind')
      expect(error.message).toBe(
        'tracks.add: "kind" must be a track kind (got "music"); valid: "video", "audio"',
      )
    })

    it('rejects a name that is not a string', () => {
      const error = catchError(() => api.add({ kind: 'video', name: 42 as never }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('name')
      expect(error.message).toBe('tracks.add: "name" must be a string (got 42)')
    })
  })

  describe('update', () => {
    it('changes name and controls as one undo step', () => {
      const before = timelineState()
      const depth = undoDepth()

      api.update('a1', {
        name: 'Voice',
        muted: true,
        volume: -6,
        locked: true,
        syncLock: false,
        visible: false,
        solo: true,
        color: '#ff0000',
      })

      expect(api.list().find((track) => track.id === 'a1')).toMatchObject({
        name: 'Voice',
        muted: true,
        volume: -6,
        locked: true,
        syncLock: false,
        visible: false,
        solo: true,
        color: '#ff0000',
        order: 2,
      })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('TRACKS_UPDATE')

      useTimelineCommandStore.getState().undo()

      expect(timelineState()).toEqual(before)
      expect(undoDepth()).toBe(depth)
    })

    it('reports the changed fields and the SET_TRACKS command', () => {
      const { changes } = transaction('TEST', () => {
        api.update('a1', { name: 'Voice', muted: true })
      })

      expect(changes.commands.map((command) => command.type)).toEqual(['SET_TRACKS'])
      expect(changes.updated).toHaveLength(1)
      expect(changes.updated[0]).toMatchObject({ kind: 'track', id: 'a1' })
      expect(changes.updated[0]?.fields.sort()).toEqual(['muted', 'name'])
      expect(changes.added).toEqual([])
      expect(changes.removed).toEqual([])
      expect(changes.undoSteps).toBe(1)
    })

    it('rejects a track that does not exist', () => {
      const error = catchError(() => api.update('v9', { muted: true }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.entity).toEqual({ kind: 'track', id: 'v9' })
      expect(error.message).toBe(
        'tracks.update: "id" must be an existing track id on the main timeline (got "v9"); ' +
          'valid: "v1", "v2", "a1", "a2"',
      )
    })

    it('rejects a volume outside -60..12 before applying the rest of the patch', () => {
      const before = timelineState()
      const depth = undoDepth()

      for (const volume of [-61, 13, Number.NaN, 'loud' as never]) {
        const error = catchError(() => api.update('a1', { name: 'Voice', volume }))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('volume')
        expect(error.message).toContain('a number from -60 to 12')
      }
      expect(catchError(() => api.update('a1', { volume: 13 })).message).toBe(
        'tracks.update: "volume" must be a number from -60 to 12 (got 13)',
      )

      expect(timelineState()).toEqual(before)
      expect(undoDepth()).toBe(depth)
    })

    it('rejects a height because track height is a view preference', () => {
      const before = timelineState()
      const depth = undoDepth()

      const error = catchError(() =>
        api.update('a1', { height: 120 } as TrackPatch & {
          height?: number
        }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('height')
      expect(error.message).toBe(
        'tracks.update: "height" must be absent: track height is a view preference ' +
          'the SDK does not change (got 120)',
      )
      expect(timelineState()).toEqual(before)
      expect(undoDepth()).toBe(depth)
    })
  })

  describe('remove', () => {
    it('deletes the track and its clips in one undo step', () => {
      const before = timelineState()
      const depth = undoDepth()

      api.remove('a1')

      expect(api.list().map((track) => track.id)).toEqual(['v1', 'v2', 'a2'])
      expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['clip-v1', 'clip-a2'])
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('TRACKS_REMOVE')

      useTimelineCommandStore.getState().undo()

      expect(timelineState()).toEqual(before)
      expect(useItemsStore.getState().itemById['clip-a1']).toMatchObject({ trackId: 'a1' })
      expect(undoDepth()).toBe(depth)
    })

    it('reports REMOVE_ITEMS and SET_TRACKS and the removed entities', () => {
      const { changes } = transaction('TEST', () => {
        api.remove('a1')
      })

      expect(changes.commands.map((command) => command.type)).toEqual([
        'REMOVE_ITEMS',
        'SET_TRACKS',
      ])
      expect(changes.removed).toEqual([
        { kind: 'track', id: 'a1' },
        { kind: 'clip', id: 'clip-a1' },
      ])
      expect(changes.updated).toEqual([])
      expect(changes.undoSteps).toBe(1)
    })

    it('pushes SET_TRACKS alone for a track without clips', () => {
      useItemsStore
        .getState()
        .setTracks([makeTimelineTrack({ id: 'empty', name: 'Empty', kind: 'video', order: 0 })])
      useItemsStore.getState().setItems([])

      const { changes } = transaction('TEST', () => {
        api.remove('empty')
      })

      expect(changes.commands.map((command) => command.type)).toEqual(['SET_TRACKS'])
      expect(api.list()).toEqual([])
    })

    it('drops the removed track and its clips from the selection', () => {
      const selection = useSelectionStore.getState()
      selection.selectTracks(['a1', 'v1'])
      selection.selectItems(['clip-a1', 'clip-v1'])

      api.remove('a1')

      const after = useSelectionStore.getState()
      expect(after.selectedTrackIds).toEqual(['v1'])
      expect(after.activeTrackId).toBe('v1')
      expect(after.selectedItemIds).toEqual([])
      expect(after.selectedItemIdSet.size).toBe(0)
    })

    it('moves the active track to the first remaining track', () => {
      useSelectionStore.getState().selectTracks(['a1'])

      api.remove('a1')

      const after = useSelectionStore.getState()
      expect(after.selectedTrackIds).toEqual(['v1'])
      expect(after.activeTrackId).toBe('v1')
    })

    it('drops a removed clip from the item selection and keeps the active track', () => {
      // Clips can be selected while another track is active (`selectItems`
      // preserves the track selection); the removed track itself is not.
      useSelectionStore.setState({
        selectedTrackIds: [],
        selectedTrackId: 'v1',
        activeTrackId: 'v1',
        selectedItemIds: ['clip-a1', 'clip-v1'],
        selectedItemIdSet: new Set(['clip-a1', 'clip-v1']),
        selectionType: 'item',
      })

      api.remove('a1')

      const after = useSelectionStore.getState()
      expect(after.activeTrackId).toBe('v1')
      expect(after.selectedItemIds).toEqual(['clip-v1'])
      expect(after.selectedItemIdSet.size).toBe(1)
    })

    it('rejects a track that does not exist without touching the project', () => {
      const before = timelineState()
      const depth = undoDepth()

      const error = catchError(() => api.remove('v9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.entity).toEqual({ kind: 'track', id: 'v9' })
      expect(error.message).toBe(
        'tracks.remove: "id" must be an existing track id on the main timeline (got "v9"); ' +
          'valid: "v1", "v2", "a1", "a2"',
      )
      expect(timelineState()).toEqual(before)
      expect(undoDepth()).toBe(depth)
    })
  })

  describe('reorder', () => {
    it('sets the stack order and is one undo step', () => {
      const before = timelineState()
      const depth = undoDepth()

      const { changes } = transaction('TEST', () => {
        api.reorder(['v2', 'v1', 'a2', 'a1'])
      })

      expect(api.list().map((track) => track.id)).toEqual(['v2', 'v1', 'a2', 'a1'])
      expect(api.list().map((track) => track.order)).toEqual([0, 1, 2, 3])
      expect(changes.updated).toEqual([
        { kind: 'track', id: 'v2', fields: ['order'] },
        { kind: 'track', id: 'v1', fields: ['order'] },
        { kind: 'track', id: 'a2', fields: ['order'] },
        { kind: 'track', id: 'a1', fields: ['order'] },
      ])
      expect(changes.commands.map((command) => command.type)).toEqual(['SET_TRACKS'])
      expect(changes.undoSteps).toBe(1)
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(timelineState()).toEqual(before)
      expect(undoDepth()).toBe(depth)
    })

    it('labels the undo entry TRACKS_REORDER', () => {
      api.reorder(['a1', 'a2', 'v1', 'v2'])

      expect(lastCommandType()).toBe('TRACKS_REORDER')
    })

    it('rejects a list that is not a permutation of the current tracks', () => {
      const before = timelineState()
      const depth = undoDepth()
      const invalidLists: unknown[] = [
        ['v1', 'v2', 'a1'],
        ['v1', 'v2', 'a1', 'a1'],
        ['v1', 'v2', 'a1', 'nope'],
        ['v1', 'v2', 'a1', 'a2', 'extra'],
        [],
        null,
        'v1',
        { 0: 'v1' },
      ]

      for (const ids of invalidLists) {
        const error = catchError(() => api.reorder(ids as TrackId[]))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('ids')
        expect(error.valid).toEqual(['v1', 'v2', 'a1', 'a2'])
        expect(error.message).toContain('a permutation of the 4 current track ids')
      }

      expect(timelineState()).toEqual(before)
      expect(undoDepth()).toBe(depth)
      expect(catchError(() => api.reorder(['v1', 'v2', 'a1'])).message).toBe(
        'tracks.reorder: "ids" must be a permutation of the 4 current track ids ' +
          '(got ["v1","v2","a1"]); valid: "v1", "v2", "a1", "a2"',
      )
    })
  })

  describe('the documented examples', () => {
    /** The object the JSDoc examples are written against. */
    const studio = { tracks: api }

    it('runs studio.tracks.list()', () => {
      expect(studio.tracks.list().map((track) => track.id)).toEqual(['v1', 'v2', 'a1', 'a2'])
    })

    it("runs studio.tracks.add({ kind: 'audio', name: 'Music' })", () => {
      const id = studio.tracks.add({ kind: 'audio', name: 'Music' })

      expect(studio.tracks.list().find((track) => track.id === id)?.name).toBe('Music')
    })

    it("runs studio.tracks.update('a1', { muted: true })", () => {
      studio.tracks.update('a1', { muted: true })

      expect(studio.tracks.list().find((track) => track.id === 'a1')?.muted).toBe(true)
    })

    it("runs studio.tracks.remove('a1')", () => {
      studio.tracks.remove('a1')

      expect(studio.tracks.list().map((track) => track.id)).toEqual(['v1', 'v2', 'a2'])
    })

    it("runs studio.tracks.reorder(['v2', 'v1', 'a2', 'a1'])", () => {
      studio.tracks.reorder(['v2', 'v1', 'a2', 'a1'])

      expect(studio.tracks.list().map((track) => track.id)).toEqual(['v2', 'v1', 'a2', 'a1'])
    })
  })
})
