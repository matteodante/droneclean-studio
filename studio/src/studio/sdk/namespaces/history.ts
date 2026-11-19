/**
 * `studio.history`: the undo history of the active editing context (design
 * §4.2, §4.4).
 *
 * The history lives in the command store, one undo/redo stack pair per editing
 * context (`timeline-command-store.ts:39-42`, `:253`); the stacks the store
 * exposes are always the active context's. `undo` and `redo` drive the store's
 * own actions, which restore the snapshot captured before each command — there
 * are no inverse commands. They are never wrapped in `transaction`: the helper
 * puts the stacks back afterwards, which would make the step disappear.
 *
 * Labels are the ones the undo button shows: the store formats the top entry
 * with `formatTimelineCommandLabel` (`commands/labels.ts`), so an SDK entry
 * labelled `CLIPS_SPLIT` reads as `Clips Split`, exactly like the UI tooltip.
 */

import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { invalidArgumentError } from '../errors'
import type { HistoryApi } from '../types'

/**
 * The number of steps a call asked for, which must be a positive integer.
 * @throws INVALID_ARGUMENT when it is not a positive integer
 */
function requireSteps(value: unknown, method: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  throw invalidArgumentError({
    method,
    argument: 'steps',
    expectation: 'a positive integer',
    value,
  })
}

/**
 * Take up to `count` entries off one of the store's stacks and return how many
 * were taken. `remaining` is the stack's length and `move` takes one entry off
 * it, so a stack shorter than `count` stops the loop with what it had.
 */
function stepHistory(count: number, remaining: () => number, move: () => void): number {
  let moved = 0
  while (moved < count && remaining() > 0) {
    move()
    moved += 1
  }
  return moved
}

/**
 * The history namespace, over the command store.
 * @example createHistoryApi().depth()
 */
export function createHistoryApi(): HistoryApi {
  return {
    undo(steps = 1) {
      return stepHistory(
        requireSteps(steps, 'history.undo'),
        () => useTimelineCommandStore.getState().undoStack.length,
        () => useTimelineCommandStore.getState().undo(),
      )
    },

    redo(steps = 1) {
      return stepHistory(
        requireSteps(steps, 'history.redo'),
        () => useTimelineCommandStore.getState().redoStack.length,
        () => useTimelineCommandStore.getState().redo(),
      )
    },

    canUndo() {
      return useTimelineCommandStore.getState().canUndo
    },

    canRedo() {
      return useTimelineCommandStore.getState().canRedo
    },

    undoLabel() {
      return useTimelineCommandStore.getState().getUndoLabel()
    },

    redoLabel() {
      return useTimelineCommandStore.getState().getRedoLabel()
    },

    clear() {
      useTimelineCommandStore.getState().clearHistory()
    },

    depth() {
      return useTimelineCommandStore.getState().undoStack.length
    },
  }
}
