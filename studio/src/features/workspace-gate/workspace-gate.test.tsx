/**
 * The modal a blocked page shows (task 2.3, design `docs/designs/2.2-mcp.md`
 * §4.10 layer 2): the holder in plain words, **Close**, and **Take over** only
 * once the owner is stale.
 *
 * The copy comes from the language files (`projects.workspaceOwner.*`, reported
 * by the slice that adds them), so what is pinned here is the behaviour and the
 * number of things a person can do: one button while the owner is live, a second
 * one when it is stale, and the folder opened by itself when the owner lets go.
 */
import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import type {
  WorkspaceOwnerFileHolder,
  WorkspaceOwnerGuard,
  WorkspaceOwnerState,
} from '@/studio/agent/workspace-owner'
import { WorkspaceOwnerModal } from './workspace-gate'

const HANDLE = {} as FileSystemDirectoryHandle

/** A guard the test drives: its state, its calls, and a way to push a new state. */
function fakeGuard(initial: WorkspaceOwnerState) {
  let current = initial
  const calls: string[] = []
  const listeners = new Set<(state: WorkspaceOwnerState) => void>()
  const emit = (state: WorkspaceOwnerState): void => {
    current = state
    for (const listener of listeners) listener(state)
  }
  const guard: WorkspaceOwnerGuard = {
    state: () => current,
    watch: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    takeOver: async () => {
      calls.push('takeOver')
      emit({ kind: 'owned' })
      return current
    },
    close: () => {
      calls.push('close')
    },
    release: () => {
      calls.push('release')
    },
    confirm: async () => current.kind === 'owned',
  }
  return { guard, calls, emit }
}

const HOLDER: WorkspaceOwnerFileHolder = {
  app: 'desktop',
  startedAt: 1_700_000_000_000,
  heartbeatAt: 1_700_000_010_000,
}

function blocked(stale: boolean): WorkspaceOwnerState {
  return { kind: 'blocked', holder: HOLDER, stale }
}

describe('the workspace owner modal', () => {
  it('offers Close and another folder, and no way into this one, while the owner is live', () => {
    const { guard, calls } = fakeGuard(blocked(false))
    const chosen: string[] = []
    const view = render(
      <WorkspaceOwnerModal ownership={guard} handle={HANDLE} onOpen={async () => {}} onChooseAnother={() => chosen.push('another')} />,
    )

    expect(view.getByRole('heading').textContent?.trim().length ?? 0).toBeGreaterThan(0)
    const buttons = view.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1] as HTMLElement)
    expect(chosen).toEqual(['another'])
    expect(calls).toEqual([])
  })

  it('offers Take over once the owner is stale, and opens the folder after it', async () => {
    const { guard, calls } = fakeGuard(blocked(true))
    const opened: FileSystemDirectoryHandle[] = []
    const view = render(
      <WorkspaceOwnerModal ownership={guard} handle={HANDLE} onOpen={async (handle) => {
        opened.push(handle)
      }} onChooseAnother={() => {}} />,
    )

    const buttons = view.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    await act(async () => fireEvent.click(buttons[2] as HTMLElement))
    expect(calls).toEqual(['takeOver'])
    expect(opened).toEqual([HANDLE])
  })

  it('opens the folder by itself when the other owner lets go', async () => {
    const { guard, emit } = fakeGuard(blocked(false))
    const opened: FileSystemDirectoryHandle[] = []
    render(
      <WorkspaceOwnerModal ownership={guard} handle={HANDLE} onOpen={async (handle) => {
        opened.push(handle)
      }} onChooseAnother={() => {}} />,
    )

    await act(async () => emit({ kind: 'owned' }))
    expect(opened).toEqual([HANDLE])
  })

  it('closes the app instead of opening the folder', () => {
    const { guard, calls } = fakeGuard(blocked(false))
    const view = render(<WorkspaceOwnerModal ownership={guard} handle={HANDLE} onOpen={async () => {}} onChooseAnother={() => {}} />)

    fireEvent.click(view.getAllByRole('button')[0] as HTMLElement)
    expect(calls).toEqual(['close'])
  })
})
