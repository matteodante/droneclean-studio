/**
 * One undo step per SDK call (design §4.4).
 *
 * The helper uses only the command store's public API: it captures a snapshot
 * and a structural baseline before the callback, then puts the undo/redo stacks
 * back to what they were and commits exactly one entry — built from the
 * snapshot taken before the callback — only when the structural diff of
 * `changes.ts` is not empty. The store's actions replace arrays even when they
 * change nothing and `snapshotsEqual` compares those arrays by reference, so
 * the diff, not the snapshot, decides whether a call is an undo step: an update
 * that writes the values it already has adds no entry and needs no rollback.
 * Nested calls are depth-counted: only the outermost call puts the stacks back
 * and commits.
 *
 * A callback that throws is rolled back through `restoreSnapshot`, and nothing
 * is added to the history: a failed call leaves the project exactly as it was.
 * The rethrown error is the `StudioError` the callback threw, or an `INTERNAL`
 * one carrying the original message.
 *
 * The commands a call ran are read from the entries the store's actions push
 * while the callback runs — the same entries this helper then discards — so the
 * SDK reports "what ran" without observing any private store state. A nested
 * call leaves its entries in the stack until the outermost one clears them,
 * which keeps their order when a script mixes its own edits with namespaced
 * calls. A call whose diff is empty reports no commands either: nothing it ran
 * survives in the history.
 */

import type { CommandEntry } from '@/features/timeline/stores/commands/types'
import { captureSnapshot, restoreSnapshot } from '@/features/timeline/stores/commands/snapshot'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import type { Changes, CommandInfo, TransactionResult } from './types'
import { captureChangeBaseline, diffChangeBaselines } from './changes'
import { StudioError } from './errors'

/** How many transactions are open; only the outermost one commits. */
let depth = 0

/** The undo/redo stacks as they were when a transaction started. */
interface StackPair {
  undoStack: CommandEntry[]
  redoStack: CommandEntry[]
}

/** Put the stacks of a context back the way they were before the call. */
function restoreStacks(stacks: StackPair): void {
  useTimelineCommandStore.setState({
    undoStack: stacks.undoStack,
    redoStack: stacks.redoStack,
    canUndo: stacks.undoStack.length > 0,
    canRedo: stacks.redoStack.length > 0,
  })
}

/**
 * A command's payload in the SDK's own terms. The store's end-handle trim reads
 * a positive `trimAmount` as "extend right" (`trim-utils.ts`), while
 * `clips.trimEnd`, like `clips.trimStart` and the store's start handle, takes
 * positive as "shortens"; reported as stored, `trimEnd(id, 31)` read
 * `trimAmount: -31`. Both ends are reported in the SDK's sign.
 */
function sdkPayload(command: CommandEntry['command']): Record<string, unknown> | undefined {
  const payload = command.payload
  if (!payload) return undefined
  if (command.type === 'TRIM_ITEM_END' && typeof payload.trimAmount === 'number') {
    return { ...payload, trimAmount: -payload.trimAmount }
  }
  return payload
}

/** Entries the callback pushed into the undo stack since `known`, in order. */
function pushedCommands(known: ReadonlySet<CommandEntry>): CommandInfo[] {
  return useTimelineCommandStore
    .getState()
    .undoStack.filter((entry) => !known.has(entry))
    .map((entry) => {
      const payload = sdkPayload(entry.command)
      return { type: entry.command.type, ...(payload ? { payload } : {}) }
    })
}

/** The `StudioError` to rethrow: the callback's own, or an `INTERNAL` wrapper. */
function toStudioError(error: unknown): StudioError {
  if (error instanceof StudioError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new StudioError({ code: 'INTERNAL', message })
}

/**
 * Run `fn` as one undo step and return its value and what it changed.
 *
 * `label` becomes the undo entry's command type and follows the SDK's rule
 * `<NAMESPACE>_<METHOD>` in upper snake case (`CLIPS_SPLIT`, `TRACKS_REMOVE`),
 * so it reads well in `studio.history.undoLabel()`. Read-only methods do not
 * call this helper.
 *
 * @internal Used by the namespace implementations; `studio.transaction` calls it.
 * @example transaction('CLIPS_UPDATE', () => updateItem('c1', { volume: -6 }))
 */
export function transaction<T>(label: string, fn: () => T): TransactionResult<T> {
  const commandStore = useTimelineCommandStore.getState()
  const before = captureSnapshot()
  const baseline = captureChangeBaseline()
  const stacks: StackPair = {
    undoStack: commandStore.undoStack,
    redoStack: commandStore.redoStack,
  }
  const known = new Set(stacks.undoStack)
  depth += 1

  try {
    const value = fn()
    const outermost = depth === 1
    const diff = diffChangeBaselines(baseline, captureChangeBaseline())
    const changed = diff.added.length > 0 || diff.removed.length > 0 || diff.updated.length > 0
    const commands = changed ? pushedCommands(known) : []
    if (outermost) restoreStacks(stacks)
    const committed = outermost && changed
    if (committed) {
      useTimelineCommandStore.getState().addUndoEntry({ type: label }, before)
    }
    const changes: Changes = { ...diff, commands, undoSteps: committed ? 1 : 0 }
    depth -= 1
    return { value, changes }
  } catch (error) {
    depth -= 1
    restoreSnapshot(before)
    restoreStacks(stacks)
    throw toStudioError(error)
  }
}
