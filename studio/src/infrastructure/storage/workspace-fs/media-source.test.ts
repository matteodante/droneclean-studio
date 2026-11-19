// @vitest-environment node

import { afterEach, describe, expect, it } from 'vite-plus/test'
import { readMediaSource, writeMediaSourceLink } from './media-source'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

afterEach(() => {
  setWorkspaceRoot(null)
})

const DESKTOP_DESCRIPTOR = {
  version: 1 as const,
  fileName: 'DJI_20261115114020_0019_D.MP4',
  fileSize: 2420049099,
  fileLastModified: 1763206980000,
  filePath:
    '/Volumes/Footage/2026-01-01_Flight/DJI_20261115114020_0019_D.MP4',
}

describe('workspace-fs media link descriptor', () => {
  it('writes media/{id}/source.link.json with the linked file details', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))

    await writeMediaSourceLink('m1', DESKTOP_DESCRIPTOR)

    const text = await readFileText(root, 'media', 'm1', 'source.link.json')
    expect(text).not.toBeNull()
    expect(JSON.parse(text!)).toEqual(DESKTOP_DESCRIPTOR)
  })

  it('omits filePath in the browser', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const { filePath: _filePath, ...browserDescriptor } = DESKTOP_DESCRIPTOR

    await writeMediaSourceLink('m1', browserDescriptor)

    const parsed = JSON.parse((await readFileText(root, 'media', 'm1', 'source.link.json'))!)
    expect(parsed).toEqual(browserDescriptor)
    expect(parsed).not.toHaveProperty('filePath')
  })

  it('is not mistaken for source bytes and refreshes on relink', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))

    await writeMediaSourceLink('m1', DESKTOP_DESCRIPTOR)
    expect(await readMediaSource('m1')).toBeNull()

    await writeMediaSourceLink('m1', {
      ...DESKTOP_DESCRIPTOR,
      fileName: 'renamed.MP4',
      fileSize: 42,
      filePath: '/Volumes/Other/renamed.MP4',
    })
    const parsed = JSON.parse((await readFileText(root, 'media', 'm1', 'source.link.json'))!)
    expect(parsed.fileName).toBe('renamed.MP4')
    expect(parsed.fileSize).toBe(42)
    expect(parsed.filePath).toBe('/Volumes/Other/renamed.MP4')
  })
})
