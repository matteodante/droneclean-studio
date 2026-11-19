// @vitest-environment node

import { afterEach, describe, expect, it } from 'vite-plus/test'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { createWorkspaceApi } from './workspace'

const workspace = createWorkspaceApi()

afterEach(() => setWorkspaceRoot(null))

describe('workspace.isOpen', () => {
  it('is false until a workspace folder is chosen', () => {
    setWorkspaceRoot(null)
    expect(workspace.isOpen()).toBe(false)
  })

  it('is true while a workspace folder is the active root, and false again once it is cleared', () => {
    setWorkspaceRoot({ name: 'Studio workspace' } as FileSystemDirectoryHandle)
    expect(workspace.isOpen()).toBe(true)
    setWorkspaceRoot(null)
    expect(workspace.isOpen()).toBe(false)
  })
})
