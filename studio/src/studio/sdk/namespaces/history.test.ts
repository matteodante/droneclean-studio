// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { splitItem } from '@/features/timeline/stores/actions/edit/split-actions'
import { updateItem } from '@/features/timeline/stores/actions/item-actions'
import { addMarker } from '@/features/timeline/stores/actions/marker-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { StudioError } from '../errors'
import { transaction } from '../transaction'
import type { HistoryApi } from '../types'
import { createHistoryApi } from './history'

/** A V1 track and one 120-frame clip, seeded through the stores the actions write. */
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

/** Add one undo entry with a real store action, the way an SDK write method does. */
function edit(volume: number, label = 'CLIPS_UPDATE'): void {
  transaction(label, () => updateItem('clip-1', { volume }))
}

/** `count` undo entries, each with its own volume so the snapshot changes. */
function editTimes(count: number, firstVolume = -1): void {
  for (let index = 0; index < count; index += 1) {
    edit(firstVolume - index)
  }
}

function clipVolume(): number | undefined {
  return useItemsStore.getState().itemById['clip-1']?.volume
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

const history: HistoryApi = createHistoryApi()

describe('studio.history', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useTimelineSettingsStore.getState().setFps(30)
    seedTimeline()
  })

  describe('undo and redo', () => {
    it('undoes one entry by default and reports it', () => {
      editTimes(2)

      expect(history.undo()).toBe(1)
      expect(history.depth()).toBe(1)
      expect(clipVolume()).toBe(-1)

      expect(history.redo()).toBe(1)
      expect(history.depth()).toBe(2)
      expect(clipVolume()).toBe(-2)
    })

    it('undoes two entries and returns 2', () => {
      editTimes(3)

      expect(history.undo(2)).toBe(2)
      expect(history.depth()).toBe(1)
      expect(clipVolume()).toBe(-1)
      expect(history.canUndo()).toBe(true)
      expect(history.canRedo()).toBe(true)
    })

    it('undoes what a shorter stack holds: 3 of the 5 asked', () => {
      editTimes(3)

      expect(history.undo(5)).toBe(3)
      expect(history.depth()).toBe(0)
      expect(clipVolume()).toBe(0)
      expect(history.canUndo()).toBe(false)
      expect(history.canRedo()).toBe(true)
    })

    it('redoes two entries and returns 2', () => {
      editTimes(3)
      history.undo(3)
      expect(clipVolume()).toBe(0)

      expect(history.redo(2)).toBe(2)
      expect(history.depth()).toBe(2)
      expect(clipVolume()).toBe(-2)
      expect(history.canRedo()).toBe(true)
    })

    it('redoes what the redo stack holds: 3 of the 5 asked', () => {
      editTimes(3)
      history.undo(3)

      expect(history.redo(5)).toBe(3)
      expect(history.depth()).toBe(3)
      expect(clipVolume()).toBe(-3)
      expect(history.canRedo()).toBe(false)
    })

    it('returns 0 when there is nothing to move', () => {
      expect(history.undo()).toBe(0)
      expect(history.redo(3)).toBe(0)
      expect(history.depth()).toBe(0)
      expect(clipVolume()).toBe(0)
    })
  })

  describe('labels', () => {
    it('is null when there is nothing to undo or redo', () => {
      expect(history.undoLabel()).toBeNull()
      expect(history.redoLabel()).toBeNull()
    })

    it('names the top entry the way the UI tooltip does', () => {
      transaction('CLIPS_SPLIT', () => splitItem('clip-1', 60))

      expect(useItemsStore.getState().items).toHaveLength(2)
      expect(history.undoLabel()).toBe('Clips Split')
      expect(history.redoLabel()).toBeNull()

      history.undo()

      expect(useItemsStore.getState().items).toHaveLength(1)
      expect(history.undoLabel()).toBeNull()
      expect(history.redoLabel()).toBe('Clips Split')
    })

    it('reads the label of the entry the next call would move', () => {
      transaction('MARKERS_ADD', () => addMarker(30))
      edit(-6)

      expect(history.undoLabel()).toBe('Clips Update')

      history.undo()

      expect(history.undoLabel()).toBe('Markers Add')
      expect(history.redoLabel()).toBe('Clips Update')
    })
  })

  describe('clear', () => {
    it('drops the undo and redo stacks of the active context', () => {
      editTimes(2)
      history.undo()

      history.clear()

      expect(history.depth()).toBe(0)
      expect(history.canUndo()).toBe(false)
      expect(history.canRedo()).toBe(false)
      expect(history.undoLabel()).toBeNull()
      expect(history.redoLabel()).toBeNull()
    })

    it('drops the history of every editing context', () => {
      const commandStore = useTimelineCommandStore
      editTimes(1)
      commandStore.getState().setActiveContext('comp-1')
      edit(-2)
      expect(history.depth()).toBe(1)
      commandStore.getState().setActiveContext(null)
      expect(history.depth()).toBe(1)

      history.clear()

      expect(history.depth()).toBe(0)
      // The parked composition stack is gone too, not just the active one.
      commandStore.getState().setActiveContext('comp-1')
      expect(history.depth()).toBe(0)
    })
  })

  describe('depth', () => {
    it('counts the entries that can be undone', () => {
      expect(history.depth()).toBe(0)
      editTimes(3)
      expect(history.depth()).toBe(3)

      history.undo(2)
      expect(history.depth()).toBe(1)

      history.redo()
      expect(history.depth()).toBe(2)
    })
  })

  describe('canUndo and canRedo', () => {
    it('follows the stacks', () => {
      expect(history.canUndo()).toBe(false)
      expect(history.canRedo()).toBe(false)

      editTimes(1)
      expect(history.canUndo()).toBe(true)
      expect(history.canRedo()).toBe(false)

      history.undo()
      expect(history.canUndo()).toBe(false)
      expect(history.canRedo()).toBe(true)

      history.redo()
      expect(history.canUndo()).toBe(true)
      expect(history.canRedo()).toBe(false)
    })
  })

  describe('steps', () => {
    const rejected: Array<{ value: unknown; shown: string }> = [
      { value: 0, shown: '0' },
      { value: -2, shown: '-2' },
      { value: 1.5, shown: '1.5' },
      { value: '2', shown: '"2"' },
    ]

    it('rejects a value that is not a positive integer, for undo, with its message', () => {
      editTimes(1)

      for (const { value, shown } of rejected) {
        const error = catchError(() => history.undo(value as number))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('steps')
        expect(error.message).toBe(
          `history.undo: "steps" must be a positive integer (got ${shown})`,
        )
      }

      // A rejected call changed nothing.
      expect(history.depth()).toBe(1)
      expect(clipVolume()).toBe(-1)
    })

    it('rejects a value that is not a positive integer, for redo, with its message', () => {
      editTimes(1)
      history.undo()

      for (const { value, shown } of rejected) {
        const error = catchError(() => history.redo(value as number))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('steps')
        expect(error.message).toBe(
          `history.redo: "steps" must be a positive integer (got ${shown})`,
        )
      }

      // A rejected call left the redo stack as it was.
      expect(history.canRedo()).toBe(true)
      expect(history.depth()).toBe(0)
    })
  })

  describe('the examples of HistoryApi', () => {
    it('runs every @example as written', () => {
      const studio = { history: createHistoryApi() }
      editTimes(3)

      expect(studio.history.undo(2)).toBe(2)
      expect(studio.history.redo()).toBe(1)
      expect(studio.history.canUndo()).toBe(true)
      expect(studio.history.canRedo()).toBe(true)
      expect(studio.history.undoLabel()).toBe('Clips Update')
      expect(studio.history.redoLabel()).toBe('Clips Update')
      studio.history.clear()
      expect(studio.history.depth()).toBe(0)
    })
  })
})
