/**
 * The agent activity notice (task 2.2, design §4.4), as a controller with no
 * React and no toast library in it.
 *
 * `run` labels the undo entry of a script `agent: <label>`
 * (`src/studio/sdk/transaction.ts` uses the label as the entry's command type).
 * The page sees those entries in the timeline command store, so the notice is
 * derived from the store alone and the desktop needs no signal of its own:
 *
 * - the first agent entry after a quiet moment starts a run and shows
 *   "Agent: N edits";
 * - every further agent entry of that run updates N;
 * - when no agent entry has come for `quietMs`, the run has ended and the same
 *   notice is shown again as the end of the run;
 * - the next user action clears it, and the next agent entry starts a new run
 *   from zero.
 */
import type { CommandEntry } from '@/features/timeline/stores/commands/types'

/** The label prefix `run` gives its undo entries. */
const AGENT_LABEL_PREFIX = 'agent: '

/** Longest quiet moment inside one run: an awaiting script's calls come closer than this. */
const DEFAULT_QUIET_MS = 1500

/** The id every notice of the page shares, so a run updates one toast. */
const NOTICE_ID = 'agent-activity'

/** Whether the notice shows a run in progress or a run that has ended. */
export type NoticePhase = 'start' | 'end'

/** The toast the controller drives: one id, shown again to update. */
export interface NoticeToast {
  show(id: string, message: string, phase: NoticePhase): void
  dismiss(id: string): void
}

/** The part of the command store the controller reads. */
export interface CommandHistorySource {
  getState(): {
    undoStack: CommandEntry[]
    stacksByContext: Record<string, { undoStack: CommandEntry[] }>
  }
  subscribe(listener: () => void): () => void
}

export interface AgentActivityNoticeOptions {
  store: CommandHistorySource
  toast: NoticeToast
  /** The words of the notice for `count` edits. */
  message(count: number): string
  /** How long without an agent entry ends a run (default `DEFAULT_QUIET_MS`). */
  quietMs?: number
}

export interface AgentActivityNotice {
  /** Start watching the store; the returned function stops it. */
  start(): () => void
  /** The user did something: clear the notice. */
  userAction(): void
}

/**
 * An entry's identity across undo and redo. Redo puts the entry back as a new
 * object that keeps its timestamp and command, so the object itself cannot say
 * whether the agent made it just now or the user brought it back.
 */
function entryKey(entry: CommandEntry): string {
  return `${entry.timestamp}|${entry.command.type}`
}

/** Every entry of every context's history. */
function allEntries(state: ReturnType<CommandHistorySource['getState']>): CommandEntry[] {
  const parked = Object.values(state.stacksByContext).flatMap((stacks) => stacks.undoStack)
  return [...state.undoStack, ...parked]
}

export function createAgentActivityNotice(
  options: AgentActivityNoticeOptions,
): AgentActivityNotice {
  const { store, toast, message } = options
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS
  const seen = new Set<string>()
  let editCount = 0
  let showing = false
  let quietTimer: ReturnType<typeof setTimeout> | undefined

  function clearTimer(): void {
    if (quietTimer !== undefined) clearTimeout(quietTimer)
    quietTimer = undefined
  }

  function endRun(): void {
    quietTimer = undefined
    toast.show(NOTICE_ID, message(editCount), 'end')
  }

  function onStoreChange(): void {
    let added = 0
    for (const entry of allEntries(store.getState())) {
      const key = entryKey(entry)
      if (seen.has(key)) continue
      seen.add(key)
      if (entry.command.type.startsWith(AGENT_LABEL_PREFIX)) added += 1
    }
    if (added === 0) return
    editCount += added
    showing = true
    toast.show(NOTICE_ID, message(editCount), 'start')
    clearTimer()
    quietTimer = setTimeout(endRun, quietMs)
  }

  return {
    start() {
      for (const entry of allEntries(store.getState())) seen.add(entryKey(entry))
      const unsubscribe = store.subscribe(onStoreChange)
      return () => {
        unsubscribe()
        clearTimer()
      }
    },
    userAction() {
      clearTimer()
      editCount = 0
      if (!showing) return
      showing = false
      toast.dismiss(NOTICE_ID)
    },
  }
}
