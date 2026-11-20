/**
 * A remembered workspace folder that can no longer be written (moved, renamed, deleted: on 20 Nov 2026 a folder a test
 * had deleted) is not "open in another window": the guard says `unreachable`, and the gate shows the folder picker
 * with a message naming the folder. A folder another window does hold offers Choose another folder beside Close, so
 * the modal is never a dead end.
 */
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { WorkspaceOwnerGuard } from '@/studio/agent/workspace-owner'

const handle = { name: 'workspace' } as FileSystemDirectoryHandle
const released: string[] = []
const roots: unknown[] = []
let claimState: ReturnType<WorkspaceOwnerGuard['state']> = { kind: 'unreachable' } as never

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))
vi.mock('@/infrastructure/storage/handles-db', () => ({
  ensureKnownWorkspaceForCurrent: async () => undefined,
  getWorkspaceHandleRecord: async () => ({ handle, name: 'workspace', activeWorkspaceId: 'w1' }),
  isFileSystemAccessSupported: () => true,
  queryHandlePermission: async () => 'granted',
  requestHandlePermission: async () => 'granted',
  saveWorkspaceHandleRecord: async () => undefined,
}))
vi.mock('@/infrastructure/storage/workspace-fs/root', () => ({
  onPermissionLost: () => () => undefined,
  setWorkspaceRoot: (root: unknown) => {
    roots.push(root)
  },
}))
vi.mock('@/studio/agent/workspace-owner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/studio/agent/workspace-owner')>()),
  claimWorkspaceOwnership: async (): Promise<WorkspaceOwnerGuard> => ({
    state: () => claimState,
    watch: () => () => undefined,
    takeOver: async () => claimState,
    confirm: async () => false,
    close: () => undefined,
    release: () => {
      released.push('release')
    },
  }),
}))

import { WorkspaceGate } from './workspace-gate'

beforeEach(() => {
  released.length = 0
  roots.length = 0
  window.history.pushState({}, '', '/projects')
})

describe('the gate and a folder it cannot open', () => {
  it('shows the folder picker with a message naming the folder, not the other-window modal', async () => {
    claimState = { kind: 'unreachable' } as never
    const view = render(
      <WorkspaceGate>
        <p>project list</p>
      </WorkspaceGate>,
    )

    expect(await view.findByText('projects.workspaceGate.unreachableFolder')).toBeTruthy()
    expect(view.getByText('projects.workspaceGate.chooseFolder')).toBeTruthy()
    expect(view.queryByText('projects.workspaceOwner.title')).toBeNull()
    expect(view.queryByText('project list')).toBeNull()
    expect(roots).toEqual([])
    expect(released).toEqual(['release'])
  })

  it('offers Choose another folder on the other-window modal, which leaves the folder and shows the picker', async () => {
    claimState = { kind: 'blocked', stale: false }
    const view = render(
      <WorkspaceGate>
        <p>project list</p>
      </WorkspaceGate>,
    )

    expect(await view.findByText('projects.workspaceOwner.title')).toBeTruthy()
    fireEvent.click(view.getByText('projects.workspaceOwner.chooseAnother'))
    expect(await view.findByText('projects.workspaceGate.chooseFolder')).toBeTruthy()
    expect(view.queryByText('projects.workspaceOwner.title')).toBeNull()
    expect(released).toEqual(['release'])
    expect(roots).toEqual([])
  })
})
