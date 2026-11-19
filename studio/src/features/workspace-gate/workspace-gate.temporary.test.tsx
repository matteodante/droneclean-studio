/**
 * A workspace in a temporary folder is not opened (review finding E1): the
 * desktop shell answers `temporary` to the claim, and the gate shows the message
 * with the folder picker instead of the project list. Nothing is read from the
 * folder, and the picker offers another one.
 */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { WorkspaceOwnerGuard } from '@/studio/agent/workspace-owner'

const handle = { name: 'workspace' } as FileSystemDirectoryHandle
const released: string[] = []
const roots: unknown[] = []
let claimState: ReturnType<WorkspaceOwnerGuard['state']> = { kind: 'temporary' } as never

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

describe('the gate and a temporary folder', () => {
  it('shows the temporary-folder message with the folder picker, and opens nothing', async () => {
    claimState = { kind: 'temporary' } as never
    const view = render(
      <WorkspaceGate>
        <p>project list</p>
      </WorkspaceGate>,
    )

    expect(await view.findByText('projects.workspaceGate.temporaryFolder')).toBeTruthy()
    expect(view.getByText('projects.workspaceGate.chooseFolder')).toBeTruthy()
    expect(view.queryByText('project list')).toBeNull()
    expect(roots).toEqual([])
    expect(released).toEqual(['release'])
  })

  it('still opens a folder the shell holds', async () => {
    claimState = { kind: 'owned' }
    const view = render(
      <WorkspaceGate>
        <p>project list</p>
      </WorkspaceGate>,
    )

    expect(await view.findByText('project list')).toBeTruthy()
    expect(roots).toEqual([handle])
  })
})
