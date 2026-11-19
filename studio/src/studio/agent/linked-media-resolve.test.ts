import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  getMedia: vi.fn(),
  getMediaFile: vi.fn(),
  pathMediaUrl: vi.fn(),
  markMediaHealthy: vi.fn(),
  markMediaBroken: vi.fn(),
  urls: new Map<string, string>(),
}))

vi.mock('@/features/media-library/stores/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => ({ markMediaHealthy: mocks.markMediaHealthy, markMediaBroken: mocks.markMediaBroken }),
  },
}))
vi.mock('@/features/media-library/services/proxy-service', () => ({ proxyService: {} }))
vi.mock('@/features/media-library/utils/proxy-key', () => ({ getSharedProxyKey: () => '' }))
vi.mock('@/shared/utils/keyframe-index-registry', () => ({ registerKeyframeIndex: vi.fn() }))
vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: {
    get: (id: string) => mocks.urls.get(id),
    acquire: (id: string) => {
      const url = `blob:${id}`
      mocks.urls.set(id, url)
      return url
    },
  },
}))
vi.mock('@/features/media-library/services/media-library-service', () => ({
  mediaLibraryService: { getMedia: mocks.getMedia, getMediaFile: mocks.getMediaFile },
  FileAccessError: class FileAccessError extends Error {},
}))
vi.mock('@/studio/agent/media', () => ({ pathMediaUrl: mocks.pathMediaUrl }))

const { resolveMediaUrl } = await import('@/features/media-library/utils/media-resolver')

const LINKED = {
  id: 'linked',
  storageType: 'path',
  filePath: '/Volumes/Flights/DJI_0020.MP4',
  fileName: 'DJI_0020.MP4',
}

describe('resolving a media URL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.urls.clear()
  })

  it('registers a file linked by path on the spot, so a reopened project does not show it missing', async () => {
    mocks.getMedia.mockResolvedValue(LINKED)
    mocks.getMediaFile.mockResolvedValue(null)
    mocks.pathMediaUrl.mockResolvedValue('droneclean://app/__media/abc')

    await expect(resolveMediaUrl('linked')).resolves.toBe('droneclean://app/__media/abc')
    expect(mocks.pathMediaUrl).toHaveBeenCalledWith({ id: 'linked', filePath: LINKED.filePath })
    expect(mocks.markMediaHealthy).toHaveBeenCalledWith('linked')
    expect(mocks.markMediaBroken).not.toHaveBeenCalled()
  })

  it('marks a linked file that did not come back as missing', async () => {
    mocks.getMedia.mockResolvedValue(LINKED)
    mocks.getMediaFile.mockResolvedValue(null)
    mocks.pathMediaUrl.mockResolvedValue(null)

    await expect(resolveMediaUrl('linked')).resolves.toBe('')
    expect(mocks.markMediaBroken).toHaveBeenCalledWith('linked', expect.objectContaining({ errorType: 'file_missing' }))
  })

  it('gives a stored file its blob URL and never asks the shell', async () => {
    mocks.getMedia.mockResolvedValue({ id: 'stored', storageType: 'workspace', fileName: 'a.mp4', fileSize: 4 })
    mocks.getMediaFile.mockResolvedValue(new Blob(['abcd']))

    await expect(resolveMediaUrl('stored')).resolves.toBe('blob:stored')
    expect(mocks.pathMediaUrl).not.toHaveBeenCalled()
    expect(mocks.markMediaHealthy).toHaveBeenCalledWith('stored')
  })
})
