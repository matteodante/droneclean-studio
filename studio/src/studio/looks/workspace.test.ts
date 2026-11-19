// @vitest-environment node
//
// The looks library in the workspace folder (design 5.1 §4.4, §6 slice 5.2b): `looks/index.json`,
// one folder per look with its `.cube` file, an index reader that never trusts the file blindly,
// and the hash an entry records.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  exists,
  writeBlob,
  writeJsonAtomic,
} from '@/infrastructure/storage/workspace-fs/fs-primitives'
import {
  asHandle,
  createRoot,
  readFileText,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import type { LookEntry } from './types'

// The saved-workspace record the gate wrote, which a realm with no root (the export's worker) reads the library from.
const savedRecord = vi.hoisted(() => ({ current: null as { handle: unknown } | null }))
vi.mock('@/infrastructure/storage/handles-db', () => ({
  getWorkspaceHandleRecord: async () => savedRecord.current,
}))

import {
  hashLookText,
  readLookText,
  readLooksIndex,
  removeLookFiles,
  writeLookText,
  writeLooksIndex,
} from './workspace'

const ENTRY: LookEntry = {
  id: 'look-1',
  name: 'Warm evening',
  fileName: 'Warm evening.cube',
  filePath: 'Warm evening.cube',
  size: 2,
  hasShaper: false,
  entryOrder: 'red-fastest',
  hash: 'a'.repeat(64),
  addedAt: 1_700_000_000_000,
}

const TEXT = [
  'LUT_3D_SIZE 2',
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '1 1 0',
  '0 0 1',
  '1 0 1',
  '0 1 1',
  '1 1 1',
].join('\n')

let root: MemDir

beforeEach(() => {
  root = createRoot()
  setWorkspaceRoot(asHandle(root))
})

afterEach(() => {
  setWorkspaceRoot(null)
  savedRecord.current = null
})

describe('the looks library in the workspace', () => {
  it('is empty before anything was added', async () => {
    await expect(readLooksIndex()).resolves.toEqual([])
  })

  it('writes the index and a look’s file, and reads them back', async () => {
    await writeLooksIndex([ENTRY])
    await writeLookText(ENTRY, TEXT)

    await expect(readLooksIndex()).resolves.toEqual([ENTRY])
    await expect(readLookText(ENTRY)).resolves.toBe(TEXT)
    await expect(readFileText(root, 'looks', 'look-1', 'Warm evening.cube')).resolves.toBe(TEXT)
  })

  it('drops an index entry it cannot trust instead of failing the whole library', async () => {
    const malformed = [
      { ...ENTRY, id: '' },
      { ...ENTRY, name: '' },
      { ...ENTRY, fileName: '' },
      { ...ENTRY, filePath: '' },
      { ...ENTRY, hash: '' },
      { ...ENTRY, entryOrder: 'red-fastest-ish' },
      { ...ENTRY, size: 1 },
      { ...ENTRY, size: 66 },
      { ...ENTRY, size: 2.5 },
      { ...ENTRY, hasShaper: 'yes' },
      { ...ENTRY, addedAt: 'yesterday' },
      'not an entry',
      null,
    ]
    await writeJsonAtomic(asHandle(root), ['looks', 'index.json'], {
      version: 1,
      looks: [ENTRY, ...malformed],
    })

    await expect(readLooksIndex()).resolves.toEqual([ENTRY])
  })

  it('reports a corrupt index instead of pretending the library is empty', async () => {
    await writeBlob(asHandle(root), ['looks', 'index.json'], '{ not json')

    await expect(readLooksIndex()).rejects.toThrow()
  })

  it('removes a look’s folder with its file', async () => {
    await writeLooksIndex([ENTRY])
    await writeLookText(ENTRY, TEXT)

    await removeLookFiles(ENTRY.id)

    await expect(exists(asHandle(root), ['looks', 'look-1'])).resolves.toBe(false)
    await expect(exists(asHandle(root), ['looks', 'index.json'])).resolves.toBe(true)
  })

  it('hashes the same text the same way, and different text differently', async () => {
    const first = await hashLookText(TEXT)
    const again = await hashLookText(TEXT)
    const other = await hashLookText(`${TEXT}\n`)

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(again).toBe(first)
    expect(other).not.toBe(first)
  })
})

describe('reading the library in a realm that has no workspace root (the export worker)', () => {
  /** A handle that answers the permission query the way the browser does for a granted folder. */
  function grantedHandle(dir: MemDir, state: PermissionState = 'granted') {
    return Object.assign(asHandle(dir), { queryPermission: async () => state })
  }

  it('reads the index and a look’s file from the saved workspace, and leaves the realm without a root', async () => {
    await writeLooksIndex([ENTRY])
    await writeLookText(ENTRY, TEXT)
    setWorkspaceRoot(null)
    savedRecord.current = { handle: grantedHandle(root) }

    await expect(readLooksIndex()).resolves.toEqual([ENTRY])
    await expect(readLookText(ENTRY)).resolves.toBe(TEXT)
    // Reading did not make the saved folder this realm's root: a write still has no root.
    await expect(writeLooksIndex([ENTRY])).rejects.toThrow(/Workspace root is not set/)
  })

  it('says the workspace is not open when nothing was saved', async () => {
    setWorkspaceRoot(null)

    await expect(readLooksIndex()).rejects.toThrow(/Workspace root is not set/)
  })

  it('does not read a saved folder the browser no longer grants', async () => {
    await writeLooksIndex([ENTRY])
    setWorkspaceRoot(null)
    savedRecord.current = { handle: grantedHandle(root, 'prompt') }

    await expect(readLooksIndex()).rejects.toThrow(/Workspace root is not set/)
  })
})
