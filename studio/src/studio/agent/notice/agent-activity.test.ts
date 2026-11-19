/**
 * The activity notice (task 2.2, design §4.4): while an agent edits, the page
 * shows "Agent: N edits" at the start and at the end of the run, and clears it
 * on the next user action. It is derived from the command store alone, from
 * entries whose label starts with `agent: `.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import type { CommandEntry } from '@/features/timeline/stores/commands/types'
import { createAgentActivityNotice, type NoticeToast } from './agent-activity'

const QUIET_MS = 1500

let clock = 1000

/** Push one entry the way the command store does, with a fresh timestamp. */
function push(type: string): CommandEntry {
  clock += 1
  const entry: CommandEntry = { command: { type }, beforeSnapshot: {} as never, timestamp: clock }
  useTimelineCommandStore.setState((state) => ({
    undoStack: [...state.undoStack, entry],
    canUndo: true,
  }))
  return entry
}

function fakeToast(): NoticeToast & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    show: (id, message, phase) => calls.push(`${phase} ${id}: ${message}`),
    dismiss: (id) => calls.push(`dismiss ${id}`),
  }
}

let stop: (() => void) | undefined

function start(toast: NoticeToast) {
  const notice = createAgentActivityNotice({
    store: useTimelineCommandStore,
    toast,
    message: (count) => `Agent: ${count} ${count === 1 ? 'edit' : 'edits'}`,
    quietMs: QUIET_MS,
  })
  stop = notice.start()
  return notice
}

beforeEach(() => {
  vi.useFakeTimers()
  useTimelineCommandStore.setState({ undoStack: [], redoStack: [], stacksByContext: {} })
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
})

describe('the agent activity notice', () => {
  it('shows nothing for the user’s own edits', () => {
    const toast = fakeToast()
    start(toast)

    push('CLIPS_SPLIT')
    vi.advanceTimersByTime(QUIET_MS * 2)

    expect(toast.calls).toEqual([])
  })

  it('shows "Agent: 1 edit" when the first agent entry lands, and the end of the run after a quiet moment', () => {
    const toast = fakeToast()
    start(toast)

    push('agent: trim the clips')
    expect(toast.calls).toEqual(['start agent-activity: Agent: 1 edit'])

    vi.advanceTimersByTime(QUIET_MS)
    expect(toast.calls).toEqual([
      'start agent-activity: Agent: 1 edit',
      'end agent-activity: Agent: 1 edit',
    ])
  })

  it('counts every agent entry of one run and ignores the other entries between them', () => {
    const toast = fakeToast()
    start(toast)

    push('agent: one')
    vi.advanceTimersByTime(QUIET_MS - 1)
    push('CLIPS_SPLIT')
    push('agent: two')
    vi.advanceTimersByTime(QUIET_MS - 1)
    push('agent: three')
    vi.advanceTimersByTime(QUIET_MS)

    expect(toast.calls.at(-1)).toBe('end agent-activity: Agent: 3 edits')
    expect(toast.calls.filter((call) => call.startsWith('end'))).toHaveLength(1)
  })

  it('does not take a redo of an agent entry for an agent edit', () => {
    const toast = fakeToast()
    start(toast)
    const entry = push('agent: trim')
    vi.advanceTimersByTime(QUIET_MS)
    toast.calls.length = 0

    useTimelineCommandStore.setState({ undoStack: [], redoStack: [entry] })
    useTimelineCommandStore.setState({
      undoStack: [{ ...entry, beforeSnapshot: {} as never }],
      redoStack: [],
    })
    vi.advanceTimersByTime(QUIET_MS)

    expect(toast.calls).toEqual([])
  })

  it('clears the notice on the next user action and starts counting again from zero', () => {
    const toast = fakeToast()
    const notice = start(toast)
    push('agent: one')
    push('agent: two')
    vi.advanceTimersByTime(QUIET_MS)
    toast.calls.length = 0

    notice.userAction()
    expect(toast.calls).toEqual(['dismiss agent-activity'])

    push('agent: next run')
    expect(toast.calls.at(-1)).toBe('start agent-activity: Agent: 1 edit')
  })

  it('has nothing to clear on a user action when no agent has edited', () => {
    const toast = fakeToast()
    const notice = start(toast)

    notice.userAction()

    expect(toast.calls).toEqual([])
  })

  it('ignores the history that was there before it started', () => {
    push('agent: from before')
    const toast = fakeToast()
    start(toast)

    vi.advanceTimersByTime(QUIET_MS)

    expect(toast.calls).toEqual([])
  })

  it('stops reacting once stopped', () => {
    const toast = fakeToast()
    start(toast)
    stop?.()
    stop = undefined

    push('agent: late')

    expect(toast.calls).toEqual([])
  })
})
