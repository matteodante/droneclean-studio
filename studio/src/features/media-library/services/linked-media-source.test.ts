import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { DesktopBridge } from '@/studio/desktop/bridge'
import type { MediaSourceLink } from '../deps/storage'

const storageMocks = vi.hoisted(() => ({
  writeMediaSourceLink: vi.fn(async () => undefined),
}))

vi.mock('../deps/storage', () => storageMocks)

import {
  buildMediaSourceLink,
  getLinkedFilePath,
  persistMediaSourceLink,
} from './linked-media-source'

function makeFile(name = 'clip.mp4', size = 4096, lastModified = 1763206980000): File {
  return new File([new Uint8Array(size)], name, { type: 'video/mp4', lastModified })
}

beforeEach(() => {
  storageMocks.writeMediaSourceLink.mockReset().mockResolvedValue(undefined)
  delete window.dronecleanDesktop
})

afterEach(() => {
  delete window.dronecleanDesktop
})

describe('linked media source', () => {
  it('builds a link descriptor without a path in the browser', () => {
    const descriptor = buildMediaSourceLink(makeFile())

    expect(descriptor).toEqual({
      version: 1,
      fileName: 'clip.mp4',
      fileSize: 4096,
      fileLastModified: 1763206980000,
    })
    expect(descriptor).not.toHaveProperty('filePath')
  })

  it('builds a link descriptor with the desktop path', () => {
    const descriptor = buildMediaSourceLink(makeFile(), '/Volumes/Media/clip.mp4')

    expect(descriptor.filePath).toBe('/Volumes/Media/clip.mp4')
  })

  it('reads a desktop path only from a version 1 bridge', () => {
    const file = makeFile()
    expect(getLinkedFilePath(file)).toBeUndefined()

    window.dronecleanDesktop = {
      version: 2,
      platform: 'darwin',
      getPathForFile: vi.fn(() => '/Volumes/Media/clip.mp4'),
    } as unknown as DesktopBridge
    expect(getLinkedFilePath(file)).toBeUndefined()

    window.dronecleanDesktop = {
      version: 1,
      platform: 'darwin',
      getPathForFile: vi.fn(() => '/Volumes/Media/clip.mp4'),
    }
    expect(getLinkedFilePath(file)).toBe('/Volumes/Media/clip.mp4')

    window.dronecleanDesktop = {
      version: 1,
      platform: 'darwin',
      getPathForFile: vi.fn(() => ''),
    }
    expect(getLinkedFilePath(file)).toBeUndefined()
  })

  it('writes the descriptor for linked media', async () => {
    const file = makeFile()

    await persistMediaSourceLink('m1', file, '/Volumes/Media/clip.mp4')

    expect(storageMocks.writeMediaSourceLink).toHaveBeenCalledWith('m1', {
      version: 1,
      fileName: 'clip.mp4',
      fileSize: 4096,
      fileLastModified: 1763206980000,
      filePath: '/Volumes/Media/clip.mp4',
    } satisfies MediaSourceLink)
  })

  it('does not fail the import when the descriptor cannot be written', async () => {
    storageMocks.writeMediaSourceLink.mockRejectedValueOnce(new Error('permission lost'))

    await expect(persistMediaSourceLink('m1', makeFile())).resolves.toBeUndefined()
  })
})
