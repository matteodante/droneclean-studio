import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const files = new Set<string>()

vi.mock('./root', () => ({
  getWorkspaceRoot: () => null,
  requireWorkspaceRoot: () => ({}),
}))
vi.mock('./fs-primitives', () => ({
  exists: async (_root: unknown, path: string[]) => files.has(path.join('/')),
  writeBlob: async (_root: unknown, path: string[]) => {
    files.add(path.join('/'))
  },
  readBlob: vi.fn(),
  readDirectoryFiles: vi.fn(),
  removeEntry: vi.fn(),
}))

import { saveExportFile } from './exports'

describe('saveExportFile', () => {
  beforeEach(() => files.clear())

  it('keeps the name it was given when no such file exists', async () => {
    const saved = await saveExportFile('p1', 'Reel Domenica - finale.mp4', new Blob(['x']))

    expect(saved.fileName).toBe('Reel Domenica - finale.mp4')
    expect(saved.relPath).toBe('projects/p1/exports/Reel Domenica - finale.mp4')
  })

  it('numbers the name only when that file already exists', async () => {
    await saveExportFile('p1', 'finale.mp4', new Blob(['x']))
    const second = await saveExportFile('p1', 'finale.mp4', new Blob(['y']))
    const third = await saveExportFile('p1', 'finale.mp4', new Blob(['z']))

    expect(second.fileName).toBe('finale (2).mp4')
    expect(third.fileName).toBe('finale (3).mp4')
  })
})
