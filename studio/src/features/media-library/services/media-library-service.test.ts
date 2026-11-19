// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const indexedDbMocks = vi.hoisted(() => ({
  getAllMedia: vi.fn(),
  getAllMediaMetadata: vi.fn(),
  getMedia: vi.fn(),
  createMedia: vi.fn(),
  updateMedia: vi.fn(),
  deleteMedia: vi.fn(),
  saveThumbnail: vi.fn(),
  getThumbnailByMediaId: vi.fn(),
  deleteThumbnailsByMediaId: vi.fn(),
  incrementContentRef: vi.fn(),
  decrementContentRef: vi.fn(),
  deleteContent: vi.fn(),
  associateMediaWithProject: vi.fn(),
  removeMediaBatchFromProject: vi.fn(),
  removeMediaFromProject: vi.fn(),
  getProjectMediaIds: vi.fn(),
  getProjectsUsingMedia: vi.fn(),
  getMediaForProject: vi.fn(),
  deleteTranscript: vi.fn(),
  readAiOutput: vi.fn(),
  saveCaptions: vi.fn(async () => []),
  deleteCaptions: vi.fn(async () => undefined),
  deleteScenes: vi.fn(async () => undefined),
  hasMediaSource: vi.fn(async () => false),
  readMediaSource: vi.fn(async (): Promise<Blob | null> => null),
  writeMediaSource: vi.fn(async () => undefined),
}))

const captionsStorageMocks = {
  saveCaptions: indexedDbMocks.saveCaptions,
  deleteCaptions: indexedDbMocks.deleteCaptions,
}

const linkedMediaMocks = vi.hoisted(() => ({
  persistMediaSourceLink: vi.fn(async () => undefined),
}))

const opfsMocks = vi.hoisted(() => ({
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
  getFile: vi.fn(),
  getFileBlob: vi.fn(),
}))

const proxyMocks = vi.hoisted(() => ({
  deleteProxy: vi.fn(),
  clearProxyKey: vi.fn(),
}))

const mediaProcessorMocks = vi.hoisted(() => ({
  processMedia: vi.fn(),
  processMediaFromUrl: vi.fn(),
  hasUnsupportedAudioCodec: vi.fn(),
}))

const compositionRuntimeMocks = vi.hoisted(() => ({
  needsCustomAudioDecoder: vi.fn(() => false),
  startPreviewAudioConform: vi.fn(async () => undefined),
  startPreviewAudioStartupWarm: vi.fn(async () => undefined),
}))

const previewAudioConformMocks = vi.hoisted(() => ({
  deletePreviewAudioConform: vi.fn(async () => undefined),
}))

const gifFrameCacheMocks = vi.hoisted(() => ({
  getGifFrames: vi.fn(),
  clearMedia: vi.fn(),
}))

const filmstripCacheMocks = vi.hoisted(() => ({
  prewarmPriorityWindow: vi.fn(async () => undefined),
  getFilmstrip: vi.fn(async () => undefined),
  abort: vi.fn(),
  clearMedia: vi.fn(async () => undefined),
}))

const waveformCacheMocks = vi.hoisted(() => ({
  getWaveform: vi.fn(async () => undefined),
  prepareOverviewWaveform: vi.fn(async () => undefined),
  clearMedia: vi.fn(async () => undefined),
}))

const backgroundMediaWorkMocks = vi.hoisted(() => ({
  enqueueBackgroundMediaWork: vi.fn((run: () => unknown) => {
    const result = run()
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void (result as PromiseLike<unknown>)
    }
    return vi.fn()
  }),
}))

vi.mock('@/infrastructure/storage', () => indexedDbMocks)

// The path import writes the link descriptor through the workspace-fs module
// directly; the workspace itself is mocked out, so only the write is stubbed.
const linkedPathMocks = vi.hoisted(() => ({
  writeMediaSourceLink: vi.fn(async () => undefined),
}))

vi.mock('@/infrastructure/storage/workspace-fs/media-source', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/infrastructure/storage/workspace-fs/media-source')>()
  return { ...actual, writeMediaSourceLink: linkedPathMocks.writeMediaSourceLink }
})

// Keep the real path/descriptor builders (they are pure); only the workspace
// write is mocked, so a test can assert it without a workspace handle.
vi.mock('./linked-media-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./linked-media-source')>()
  return { ...actual, persistMediaSourceLink: linkedMediaMocks.persistMediaSourceLink }
})

vi.mock('./opfs-service', () => ({
  opfsService: opfsMocks,
}))

vi.mock('./proxy-service', () => ({
  proxyService: proxyMocks,
}))

vi.mock('./background-media-work', () => backgroundMediaWorkMocks)

const importSideWorkMocks = vi.hoisted(() => ({ queueImportSideWork: vi.fn() }))
vi.mock('@/studio/side-work/import-media', () => importSideWorkMocks)

vi.mock('./media-processor-service', () => ({
  mediaProcessorService: mediaProcessorMocks,
}))

vi.mock('@/runtime/composition-runtime/utils/audio-codec-detection', () => ({
  needsCustomAudioDecoder: compositionRuntimeMocks.needsCustomAudioDecoder,
}))

vi.mock('@/runtime/composition-runtime/utils/audio-decode-cache', () => ({
  startPreviewAudioConform: compositionRuntimeMocks.startPreviewAudioConform,
  startPreviewAudioStartupWarm: compositionRuntimeMocks.startPreviewAudioStartupWarm,
}))

vi.mock('@/runtime/composition-runtime/utils/preview-audio-conform', () => ({
  deletePreviewAudioConform: previewAudioConformMocks.deletePreviewAudioConform,
}))

vi.mock('@/features/media-library/deps/timeline-services', () => ({
  gifFrameCache: gifFrameCacheMocks,
  importGifFrameCache: vi.fn(async () => ({ gifFrameCache: gifFrameCacheMocks })),
  filmstripCache: filmstripCacheMocks,
  importFilmstripCache: vi.fn(async () => ({ filmstripCache: filmstripCacheMocks })),
  MAX_FILMSTRIP_TARGET_FRAMES: 72,
  IMPORT_FILMSTRIP_HUGE_FILE_BYTES: 1000 * 1024 * 1024,
  IMPORT_FILMSTRIP_LARGE_FILE_BYTES: 500 * 1024 * 1024,
  IMPORT_FILMSTRIP_LARGE_TARGET_FRAMES: 16,
  IMPORT_FILMSTRIP_LONG_DURATION_SEC: 900,
  IMPORT_FILMSTRIP_MEDIUM_TARGET_FRAMES: 32,
  IMPORT_FILMSTRIP_NORMAL_TARGET_FRAMES: 48,
  IMPORT_FILMSTRIP_PREP_TIMEOUT_MS: 8000,
  IMPORT_FILMSTRIP_SLOW_CONTAINER_MIME_TYPES: new Set([
    'video/webm',
    'video/x-matroska',
    'video/matroska',
  ]),
  IMPORT_FILMSTRIP_SLOW_PREP_TIMEOUT_MS: 6000,
  IMPORT_FILMSTRIP_TINY_TARGET_FRAMES: 8,
  IMPORT_FILMSTRIP_VERY_LONG_DURATION_SEC: 1800,
  waveformCache: waveformCacheMocks,
  importWaveformCache: vi.fn(async () => ({ waveformCache: waveformCacheMocks })),
}))

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/x-m4a',
  '.wav': 'audio/wav',
  '.png': 'image/png',
}

vi.mock('../utils/validation', () => ({
  validateMediaFile: vi.fn(() => ({ valid: true })),
  validateMediaFileContent: vi.fn(async () => ({ valid: true })),
  getMimeType: vi.fn((file: { name: string; type: string }) => {
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    return file.type || MIME_BY_EXTENSION[extension] || 'application/octet-stream'
  }),
  getMediaType: vi.fn((mimeType: string) => {
    const family = mimeType.split('/')[0]
    return family === 'video' || family === 'audio' || family === 'image' ? family : 'unknown'
  }),
  isLottieMime: vi.fn(() => false),
}))

vi.mock('../utils/proxy-key', () => ({
  getSharedProxyKey: vi.fn((media: { id: string }) => `proxy-${media.id}`),
}))

import { mediaLibraryService, FileAccessError } from './media-library-service'
import type { MediaMetadata } from '@/types/storage'
import { useMediaPreparationStore } from '../stores/media-preparation-store'

const fetchMock = vi.fn()

function makeMediaMetadata(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileName: 'video.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'avc1',
    bitrate: 5000,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeFileHandle(file: File): FileSystemFileHandle {
  return {
    name: file.name,
    getFile: vi.fn().mockResolvedValue(file),
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('granted'),
  } as unknown as FileSystemFileHandle
}

describe('MediaLibraryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    useMediaPreparationStore.getState().clearAll()
    compositionRuntimeMocks.needsCustomAudioDecoder.mockReturnValue(false)
    compositionRuntimeMocks.startPreviewAudioStartupWarm.mockResolvedValue(undefined)
    filmstripCacheMocks.prewarmPriorityWindow.mockResolvedValue(undefined)
    filmstripCacheMocks.getFilmstrip.mockResolvedValue(undefined)
    waveformCacheMocks.getWaveform.mockResolvedValue(undefined)
    waveformCacheMocks.prepareOverviewWaveform.mockResolvedValue(undefined)
    backgroundMediaWorkMocks.enqueueBackgroundMediaWork.mockImplementation((run: () => unknown) => {
      const result = run()
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void (result as PromiseLike<unknown>)
      }
      return vi.fn()
    })
    indexedDbMocks.getAllMedia.mockResolvedValue([])
    indexedDbMocks.getAllMediaMetadata.mockImplementation(() => indexedDbMocks.getAllMedia())
    indexedDbMocks.getProjectMediaIds.mockResolvedValue([])
    indexedDbMocks.readAiOutput.mockResolvedValue(undefined)
  })

  describe('getAllMedia', () => {
    it('returns all media from IndexedDB', async () => {
      const media = [makeMediaMetadata({ id: 'm1' }), makeMediaMetadata({ id: 'm2' })]
      indexedDbMocks.getAllMedia.mockResolvedValue(media)

      const result = await mediaLibraryService.getAllMedia()
      expect(result).toEqual(media)
      expect(indexedDbMocks.getAllMedia).toHaveBeenCalledTimes(1)
    })
  })

  describe('getMedia', () => {
    it('returns media by ID', async () => {
      const media = makeMediaMetadata({ id: 'm1' })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      const result = await mediaLibraryService.getMedia('m1')
      expect(result).toEqual(media)
    })

    it('returns null when media not found', async () => {
      indexedDbMocks.getMedia.mockResolvedValue(undefined)

      const result = await mediaLibraryService.getMedia('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('importMediaWithHandle', () => {
    it('imports a media file via handle and associates with project', async () => {
      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4' })
      const mockHandle = makeFileHandle(mockFile)
      const frameRateMetrics = {
        underlyingFrameRate: 30000 / 1001,
        bestGuessFrameRate: 30000 / 1001,
        minFrameRate: 30000 / 1001,
        maxFrameRate: 30000 / 1001,
        averageFrameRate: 30000 / 1001,
        medianFrameRate: 30000 / 1001,
        frameRateIsConstant: true,
        probedPacketCount: 256,
      }

      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 10,
          width: 1920,
          height: 1080,
          fps: 30000 / 1001,
          frameRateMetrics,
          codec: 'avc1',
          audioCodec: undefined,
          audioCodecSupported: true,
          bitrate: 5000,
        },
        thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
      })
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false })
      indexedDbMocks.getAllMedia.mockResolvedValue([])
      indexedDbMocks.getMediaForProject.mockResolvedValue([])

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1')

      expect(result.storageType).toBe('handle')
      expect(result.fileName).toBe('video.mp4')
      expect(result.fps).toBe(30000 / 1001)
      expect(result.frameRateMetrics).toEqual(frameRateMetrics)
      expect(result.isDuplicate).toBeUndefined()
      expect(mediaProcessorMocks.processMedia).toHaveBeenCalledWith(mockFile, 'video/mp4', {
        thumbnailTimestamp: 1,
        fastMetadata: true,
      })
      expect(indexedDbMocks.createMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          fps: 30000 / 1001,
          frameRateMetrics,
        }),
      )
      expect(indexedDbMocks.createMedia).toHaveBeenCalledTimes(1)
      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-1', result.id)
      expect(indexedDbMocks.saveThumbnail).toHaveBeenCalledTimes(1)
      expect(filmstripCacheMocks.prewarmPriorityWindow).not.toHaveBeenCalled()
      // Link is the default: the source stays where it is and never enters the
      // workspace-mirror path (`hasMediaSource` is only read by the mirror).
      expect(result.filePath).toBeUndefined()
      expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalled()
      expect(indexedDbMocks.hasMediaSource).not.toHaveBeenCalled()
      expect(linkedMediaMocks.persistMediaSourceLink).toHaveBeenCalledWith(
        result.id,
        mockFile,
        undefined,
      )
    })

    it('records the desktop path of a linked file when the bridge is present', async () => {
      const mockFile = new File(['data'], 'clip.mp4', { type: 'video/mp4' })
      const mockHandle = makeFileHandle(mockFile)
      const desktopPath = '/Volumes/Footage/clip.mp4'
      vi.stubGlobal('window', {
        dronecleanDesktop: {
          version: 1,
          platform: 'darwin',
          getPathForFile: vi.fn(() => desktopPath),
        },
      })
      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 10,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'avc1',
          audioCodec: undefined,
          audioCodecSupported: true,
          bitrate: 5000,
        },
        thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
      })
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false })
      indexedDbMocks.getAllMedia.mockResolvedValue([])
      indexedDbMocks.getMediaForProject.mockResolvedValue([])

      try {
        const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1')

        expect(result.filePath).toBe(desktopPath)
        expect(indexedDbMocks.createMedia).toHaveBeenCalledWith(
          expect.objectContaining({ filePath: desktopPath }),
        )
        expect(linkedMediaMocks.persistMediaSourceLink).toHaveBeenCalledWith(
          result.id,
          mockFile,
          desktopPath,
        )
        expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('does not mirror or copy a duplicate that is already a linked file', async () => {
      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4' })
      const mockHandle = makeFileHandle(mockFile)
      const existing = makeMediaMetadata({
        id: 'linked-existing',
        storageType: 'handle',
        fileName: 'video.mp4',
        fileSize: mockFile.size,
        fileLastModified: mockFile.lastModified,
      })
      indexedDbMocks.getAllMedia.mockResolvedValue([existing])
      indexedDbMocks.updateMedia.mockImplementation(async (_id, updates) => ({
        ...existing,
        ...updates,
      }))
      indexedDbMocks.getProjectMediaIds.mockResolvedValue([])

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1')

      expect(result.id).toBe('linked-existing')
      expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalled()
      expect(linkedMediaMocks.persistMediaSourceLink).toHaveBeenCalledWith(
        'linked-existing',
        mockFile,
        undefined,
      )
    })

    it('copies handle-picked media into the workspace folder when requested', async () => {
      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4' })
      const mockHandle = makeFileHandle(mockFile)

      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 10,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'avc1',
          audioCodec: undefined,
          audioCodecSupported: true,
          bitrate: 5000,
        },
        thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
      })
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false })
      indexedDbMocks.getMediaForProject.mockResolvedValue([])

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1', {
        storageMode: 'copy',
      })

      expect(result.storageType).toBe('workspace')
      expect(result.fileHandle).toBeUndefined()
      expect(result.opfsPath).toBeUndefined()
      expect(result.fileName).toBe('video.mp4')
      // Durable source goes to the workspace folder, NOT OPFS.
      expect(opfsMocks.saveFile).not.toHaveBeenCalled()
      expect(indexedDbMocks.writeMediaSource).toHaveBeenCalledWith(
        result.id,
        mockFile,
        'video.mp4',
        {
          strict: true,
        },
      )
      expect(indexedDbMocks.createMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          id: result.id,
          storageType: 'workspace',
          fileName: 'video.mp4',
        }),
      )
      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-1', result.id)
      // Copy mode is a fresh import too: its side work is queued with the file the import read
      expect(importSideWorkMocks.queueImportSideWork).toHaveBeenCalledWith({
        media: expect.objectContaining({ id: result.id }),
        file: mockFile,
      })
    })

    it('does not queue filmstrip or waveform preparation during import', async () => {
      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4' })
      const mockHandle = makeFileHandle(mockFile)

      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 10,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'avc1',
          audioCodec: 'aac',
          audioCodecSupported: true,
          bitrate: 5000,
        },
        thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
      })
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false })
      indexedDbMocks.getAllMedia.mockResolvedValue([])
      indexedDbMocks.getMediaForProject.mockResolvedValue([])

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1')

      expect(result.id).toBeTruthy()
      expect(filmstripCacheMocks.prewarmPriorityWindow).not.toHaveBeenCalled()
      expect(filmstripCacheMocks.getFilmstrip).not.toHaveBeenCalled()
      expect(waveformCacheMocks.prepareOverviewWaveform).not.toHaveBeenCalled()
      expect(waveformCacheMocks.getWaveform).not.toHaveBeenCalled()
      expect([...useMediaPreparationStore.getState().tasks.values()]).toEqual([])
    })

    it('queues the side work of a fresh linked import (the picker and the drop), with the file the import read', async () => {
      const mockFile = new File(['data'], 'DJI_0020_D.MP4', { type: 'video/mp4' })
      const mockHandle = makeFileHandle(mockFile)
      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 10,
          width: 3840,
          height: 2160,
          fps: 59.94,
          codec: 'hvc1',
          audioCodec: undefined,
          audioCodecSupported: true,
          bitrate: 5000,
          droneModel: 'DJI Avata2',
        },
        thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
      })
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false })
      indexedDbMocks.getAllMedia.mockResolvedValue([])
      indexedDbMocks.getMediaForProject.mockResolvedValue([])

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1')

      expect(importSideWorkMocks.queueImportSideWork).toHaveBeenCalledTimes(1)
      expect(importSideWorkMocks.queueImportSideWork).toHaveBeenCalledWith({
        media: expect.objectContaining({ id: result.id, droneModel: 'DJI Avata2' }),
        file: mockFile,
      })
    })

    it('queues no side work for a duplicate: its caches already exist', async () => {
      const existingMedia = makeMediaMetadata({
        id: 'existing-1',
        fileName: 'video.mp4',
        fileSize: 4,
      })
      indexedDbMocks.getAllMedia.mockResolvedValue([existingMedia])
      indexedDbMocks.getProjectMediaIds.mockResolvedValue(['existing-1'])
      indexedDbMocks.updateMedia.mockResolvedValue(existingMedia)
      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4' })

      const result = await mediaLibraryService.importMediaWithHandle(
        makeFileHandle(mockFile),
        'project-1',
      )

      expect(result.isDuplicate).toBe(true)
      expect(importSideWorkMocks.queueImportSideWork).not.toHaveBeenCalled()
    })

    it('skips import-time waveform extraction for long media', async () => {
      const mockFile = new File(['data'], 'long-video.mp4', { type: 'video/mp4' })
      const mockHandle = makeFileHandle(mockFile)

      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 60 * 60,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'avc1',
          audioCodec: 'aac',
          audioCodecSupported: true,
          bitrate: 5000,
        },
        thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
      })
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false })
      indexedDbMocks.getAllMedia.mockResolvedValue([])
      indexedDbMocks.getMediaForProject.mockResolvedValue([])

      await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1')
      await Promise.resolve()

      expect(waveformCacheMocks.prepareOverviewWaveform).not.toHaveBeenCalled()
      expect(waveformCacheMocks.getWaveform).not.toHaveBeenCalled()
      expect([...useMediaPreparationStore.getState().tasks.values()]).toEqual([])
    })

    it('refreshes legacy project duplicate source when file already in project', async () => {
      const existingMedia = makeMediaMetadata({
        id: 'existing-1',
        fileName: 'video.mp4',
        fileSize: 4,
      })
      const refreshedMedia = {
        ...existingMedia,
        fileHandle: {} as FileSystemFileHandle,
        fileLastModified: 1234,
      }
      indexedDbMocks.getAllMedia.mockResolvedValue([existingMedia])
      indexedDbMocks.getProjectMediaIds.mockResolvedValue(['existing-1'])
      indexedDbMocks.updateMedia.mockResolvedValue(refreshedMedia)

      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4', lastModified: 1234 })
      const mockHandle = {
        name: 'video.mp4',
        getFile: vi.fn().mockResolvedValue(mockFile),
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn().mockResolvedValue('granted'),
      } as unknown as FileSystemFileHandle

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1')

      expect(indexedDbMocks.updateMedia).toHaveBeenCalledWith(
        'existing-1',
        expect.objectContaining({
          storageType: 'handle',
          fileHandle: mockHandle,
          fileName: 'video.mp4',
          fileSize: 4,
          fileLastModified: 1234,
        }),
      )
      expect(result.isDuplicate).toBe(true)
      expect(result.id).toBe('existing-1')
      expect(indexedDbMocks.createMedia).not.toHaveBeenCalled()
    })

    it('refreshes the stored handle when reusing a workspace duplicate', async () => {
      const existingMedia = makeMediaMetadata({
        id: 'existing-1',
        fileName: 'video.mp4',
        fileSize: 4,
        fileLastModified: 1234,
        storageType: 'handle',
      })
      const refreshedMedia = {
        ...existingMedia,
        fileHandle: {} as FileSystemFileHandle,
      }
      indexedDbMocks.getAllMedia.mockResolvedValue([existingMedia])
      indexedDbMocks.getProjectMediaIds.mockResolvedValue([])
      indexedDbMocks.updateMedia.mockResolvedValue(refreshedMedia)

      const mockFile = new File(['data'], 'video.mp4', {
        type: 'video/mp4',
        lastModified: 1234,
      })
      const mockHandle = {
        name: 'video.mp4',
        getFile: vi.fn().mockResolvedValue(mockFile),
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn().mockResolvedValue('granted'),
      } as unknown as FileSystemFileHandle

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-2')

      expect(indexedDbMocks.updateMedia).toHaveBeenCalledWith(
        'existing-1',
        expect.objectContaining({
          fileHandle: mockHandle,
          fileName: 'video.mp4',
          fileSize: 4,
          fileLastModified: 1234,
        }),
      )
      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith(
        'project-2',
        'existing-1',
      )
      expect(result.id).toBe('existing-1')
      expect(result.isDuplicate).toBe(false)
    })

    it('starts preview audio conform in background for custom-decoded imports', async () => {
      const mockFile = new File(['audio'], 'clip.webm', { type: 'video/webm' })
      const mockHandle = makeFileHandle(mockFile)

      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 10,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'vp9',
          audioCodec: 'vorbis',
          audioCodecSupported: true,
          bitrate: 5000,
        },
      })
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false })
      indexedDbMocks.getAllMedia.mockResolvedValue([])
      indexedDbMocks.getMediaForProject.mockResolvedValue([])
      compositionRuntimeMocks.needsCustomAudioDecoder.mockReturnValue(true)

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1')
      await Promise.resolve()

      expect(result.id).toBeTruthy()
      expect(compositionRuntimeMocks.startPreviewAudioStartupWarm).toHaveBeenCalledWith(
        result.id,
        mockFile,
      )
      expect(compositionRuntimeMocks.startPreviewAudioConform).toHaveBeenCalledWith(
        result.id,
        mockFile,
      )
    })

    it('throws FileAccessError when permission is denied', async () => {
      const mockHandle = {
        name: 'video.mp4',
        queryPermission: vi.fn().mockResolvedValue('denied'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      } as unknown as FileSystemFileHandle

      await expect(
        mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1'),
      ).rejects.toThrow(FileAccessError)
    })
  })

  describe('importLinkedPaths', () => {
    const linkedSource = (name: string, overrides: Record<string, unknown> = {}) => ({
      path: `/Volumes/Footage/2026-01-01_Flight/${name}`,
      name,
      size: 3_764_360_098,
      lastModified: 1_763_000_000_000,
      url: `droneclean://app/__media/${name}`,
      ...overrides,
    })

    const videoProbe = () => ({
      metadata: {
        type: 'video' as const,
        duration: 237.5,
        width: 3840,
        height: 2880,
        fps: 30,
        codec: 'hevc',
        bitrate: 100_000_000,
        audioCodec: 'aac',
        audioCodecSupported: true,
        videoCodecSupported: true,
        keyframeTimestamps: [0, 1, 2],
        gopInterval: 1,
      },
      thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
    })

    beforeEach(() => {
      indexedDbMocks.createMedia.mockImplementation(async (metadata) => metadata)
      linkedPathMocks.writeMediaSourceLink.mockResolvedValue(undefined)
    })

    it('records each path as a path media, probing the URL the shell serves', async () => {
      mediaProcessorMocks.processMediaFromUrl.mockResolvedValue(videoProbe())
      indexedDbMocks.getAllMedia.mockResolvedValue([])
      const sources = [linkedSource('DJI_0019_D.MP4'), linkedSource('DJI_0020_D.MP4')]

      const records = await mediaLibraryService.importLinkedPaths(sources, 'project-1')

      expect(records).toHaveLength(2)
      for (const [index, record] of records.entries()) {
        const source = sources[index]!
        expect(record.storageType).toBe('path')
        expect(record.filePath).toBe(source.path)
        expect(record.fileName).toBe(source.name)
        expect(record.fileSize).toBe(source.size)
        expect(record.fileLastModified).toBe(source.lastModified)
        expect(record.mimeType).toBe('video/mp4')
        expect(record.duration).toBe(237.5)
        expect(record.width).toBe(3840)
        expect(record.height).toBe(2880)
        expect(record.keyframeTimestamps).toEqual([0, 1, 2])
        expect(record.thumbnailId).toBeTruthy()
      }
      expect(mediaProcessorMocks.processMediaFromUrl).toHaveBeenNthCalledWith(
        1,
        sources[0]!.url,
        'video/mp4',
        { thumbnailTimestamp: 1, fastMetadata: true },
      )
      expect(indexedDbMocks.createMedia).toHaveBeenCalledTimes(2)
      expect(indexedDbMocks.saveThumbnail).toHaveBeenCalledTimes(2)
      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith(
        'project-1',
        records[0]!.id,
      )
      expect(linkedPathMocks.writeMediaSourceLink).toHaveBeenCalledWith(records[0]!.id, {
        version: 1,
        fileName: sources[0]!.name,
        fileSize: sources[0]!.size,
        fileLastModified: sources[0]!.lastModified,
        filePath: sources[0]!.path,
      })
      // The bytes never enter the workspace: the record is the only copy, and
      // the workspace gets the small link descriptor instead.
      expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalled()
      expect(indexedDbMocks.hasMediaSource).not.toHaveBeenCalled()
      // The agent's import by path queues the side work of each new clip with the shell URL, not a File
      expect(importSideWorkMocks.queueImportSideWork).toHaveBeenCalledTimes(2)
      expect(importSideWorkMocks.queueImportSideWork).toHaveBeenNthCalledWith(1, {
        media: expect.objectContaining({ id: records[0]!.id, storageType: 'path' }),
        url: sources[0]!.url,
      })
    })

    it('queues no side work for a path that is already in the library', async () => {
      mediaProcessorMocks.processMediaFromUrl.mockResolvedValue(videoProbe())
      indexedDbMocks.getAllMedia.mockResolvedValue([])
      const source = linkedSource('DJI_0019_D.MP4')
      const [first] = await mediaLibraryService.importLinkedPaths([source], 'project-1')
      importSideWorkMocks.queueImportSideWork.mockClear()
      indexedDbMocks.getAllMedia.mockResolvedValue([first!])

      await mediaLibraryService.importLinkedPaths([source], 'project-1')

      expect(importSideWorkMocks.queueImportSideWork).not.toHaveBeenCalled()
    })

    it('writes no record when a file cannot be probed, and names the file', async () => {
      mediaProcessorMocks.processMediaFromUrl
        .mockResolvedValueOnce(videoProbe())
        .mockRejectedValueOnce(new Error('Media processing timeout'))
      indexedDbMocks.getAllMedia.mockResolvedValue([])

      await expect(
        mediaLibraryService.importLinkedPaths(
          [linkedSource('a.mp4'), linkedSource('b.mp4')],
          'project-1',
        ),
      ).rejects.toThrow(/"b\.mp4" could not be read/)

      expect(indexedDbMocks.createMedia).not.toHaveBeenCalled()
      expect(linkedPathMocks.writeMediaSourceLink).not.toHaveBeenCalled()
      expect(indexedDbMocks.associateMediaWithProject).not.toHaveBeenCalled()
    })

    it('reuses an existing path record for the same file instead of re-probing it', async () => {
      const source = linkedSource('DJI_0020_D.MP4')
      const existing = makeMediaMetadata({
        id: 'existing-path',
        storageType: 'path',
        filePath: source.path,
        fileName: source.name,
      })
      indexedDbMocks.getAllMedia.mockResolvedValue([existing])

      const records = await mediaLibraryService.importLinkedPaths([source], 'project-1')

      expect(records).toEqual([existing])
      expect(mediaProcessorMocks.processMediaFromUrl).not.toHaveBeenCalled()
      expect(indexedDbMocks.createMedia).not.toHaveBeenCalled()
      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith(
        'project-1',
        'existing-path',
      )
    })

    it('reuses a record the picker imported when name, size and modification time match', async () => {
      const source = linkedSource('DJI_0021_D.MP4')
      const picked = makeMediaMetadata({
        id: 'picked-handle',
        storageType: 'handle',
        fileName: source.name,
        fileSize: source.size,
        fileLastModified: source.lastModified,
      })
      indexedDbMocks.getAllMedia.mockResolvedValue([picked])

      const records = await mediaLibraryService.importLinkedPaths([source], 'project-1')

      expect(records).toEqual([picked])
      expect(mediaProcessorMocks.processMediaFromUrl).not.toHaveBeenCalled()
      expect(indexedDbMocks.createMedia).not.toHaveBeenCalled()
    })

    it('imports nothing from an empty list', async () => {
      expect(await mediaLibraryService.importLinkedPaths([], 'project-1')).toEqual([])
      expect(mediaProcessorMocks.processMediaFromUrl).not.toHaveBeenCalled()
      expect(indexedDbMocks.createMedia).not.toHaveBeenCalled()
    })

    it('records an audio clip with its codec and no thumbnail', async () => {
      mediaProcessorMocks.processMediaFromUrl.mockResolvedValue({
        metadata: {
          type: 'audio',
          duration: 161.77,
          codec: 'aac',
          channels: 2,
          sampleRate: 48000,
          bitrate: 128000,
        },
      })
      indexedDbMocks.getAllMedia.mockResolvedValue([])
      const source = linkedSource('ridgeclub - where am i supposed to go.m4a')

      const [record] = await mediaLibraryService.importLinkedPaths([source], 'project-1')

      expect(record?.mimeType).toBe('audio/x-m4a')
      expect(record?.codec).toBe('aac')
      expect(record?.bitrate).toBe(128000)
      expect(record?.duration).toBe(161.77)
      expect(record?.width).toBe(0)
      expect(record?.height).toBe(0)
      expect(record?.thumbnailId).toBeUndefined()
      expect(indexedDbMocks.saveThumbnail).not.toHaveBeenCalled()
      expect(linkedPathMocks.writeMediaSourceLink).toHaveBeenCalledWith(record?.id, {
        version: 1,
        fileName: source.name,
        fileSize: source.size,
        fileLastModified: source.lastModified,
        filePath: source.path,
      })
    })
  })

  describe('importMediaFromUrl', () => {
    it('downloads a direct media URL and persists it as OPFS-backed media', async () => {
      const remoteBlob = new Blob(['remote-video'], { type: 'video/mp4' })
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://cdn.example.com/assets/clip.mp4?token=123',
        headers: new Headers({
          'content-type': 'video/mp4',
        }),
        blob: vi.fn().mockResolvedValue(remoteBlob),
      } satisfies Partial<Response>)

      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 10,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'avc1',
          audioCodec: 'aac',
          audioCodecSupported: true,
          bitrate: 5000,
        },
        thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
      })
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false })
      indexedDbMocks.getMediaForProject.mockResolvedValue([])
      indexedDbMocks.createMedia.mockImplementation(async (metadata) => metadata)

      const result = await mediaLibraryService.importMediaFromUrl(
        'https://cdn.example.com/assets/clip.mp4?token=123',
        'project-1',
      )

      expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/assets/clip.mp4?token=123')
      expect(result.storageType).toBe('workspace')
      expect(result.fileName).toBe('clip.mp4')
      expect(opfsMocks.saveFile).not.toHaveBeenCalled()
      expect(indexedDbMocks.writeMediaSource).toHaveBeenCalledWith(
        result.id,
        expect.any(File),
        'clip.mp4',
        { strict: true },
      )
      expect(indexedDbMocks.createMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          id: result.id,
          storageType: 'workspace',
          fileName: 'clip.mp4',
          mimeType: 'video/mp4',
        }),
      )
      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-1', result.id)
      // A downloaded clip is a fresh import: its side work is queued with the downloaded file
      expect(importSideWorkMocks.queueImportSideWork).toHaveBeenCalledWith({
        media: expect.objectContaining({ id: result.id }),
        file: expect.any(File),
      })
      expect(filmstripCacheMocks.prewarmPriorityWindow).not.toHaveBeenCalled()
    })

    it('returns an existing project media item when the downloaded file matches by name and size', async () => {
      const existing = makeMediaMetadata({
        id: 'existing-remote',
        storageType: 'opfs',
        fileName: 'clip.mp4',
        fileSize: 12,
      })
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://cdn.example.com/assets/clip.mp4',
        headers: new Headers({
          'content-type': 'video/mp4',
        }),
        blob: vi.fn().mockResolvedValue(new Blob(['remote-video'], { type: 'video/mp4' })),
      } satisfies Partial<Response>)
      indexedDbMocks.getMediaForProject.mockResolvedValue([existing])

      const result = await mediaLibraryService.importMediaFromUrl(
        'https://cdn.example.com/assets/clip.mp4',
        'project-1',
      )

      expect(result).toMatchObject({
        id: 'existing-remote',
        isDuplicate: true,
      })
      expect(indexedDbMocks.createMedia).not.toHaveBeenCalled()
    })

    it('rejects YouTube-style page URLs with a direct media hint', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://www.youtube.com/watch?v=abc123',
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
        }),
        blob: vi.fn(),
      } satisfies Partial<Response>)

      await expect(
        mediaLibraryService.importMediaFromUrl(
          'https://www.youtube.com/watch?v=abc123',
          'project-1',
        ),
      ).rejects.toThrow(/YouTube and similar page URLs/)
    })
  })

  describe('deleteMediaFromProject', () => {
    it('removes association and deletes media when no other projects use it', async () => {
      const media = makeMediaMetadata({ id: 'm1', storageType: 'handle' })
      indexedDbMocks.getMedia.mockResolvedValue(media)
      indexedDbMocks.getProjectsUsingMedia.mockResolvedValue([])
      indexedDbMocks.getAllMedia.mockResolvedValue([])

      await mediaLibraryService.deleteMediaFromProject('project-1', 'm1')

      expect(indexedDbMocks.removeMediaFromProject).toHaveBeenCalledWith('project-1', 'm1')
      expect(indexedDbMocks.deleteMedia).toHaveBeenCalledWith('m1')
      expect(previewAudioConformMocks.deletePreviewAudioConform).toHaveBeenCalledWith(media, {
        clearMetadata: false,
      })
    })

    it('only removes association when other projects still use the media', async () => {
      const media = makeMediaMetadata({ id: 'm1', storageType: 'handle' })
      indexedDbMocks.getMedia.mockResolvedValue(media)
      indexedDbMocks.getProjectsUsingMedia.mockResolvedValue(['project-2'])

      await mediaLibraryService.deleteMediaFromProject('project-1', 'm1')

      expect(indexedDbMocks.removeMediaFromProject).toHaveBeenCalledWith('project-1', 'm1')
      expect(indexedDbMocks.deleteMedia).not.toHaveBeenCalled()
    })

    it('deletes OPFS content when ref count reaches zero', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        contentHash: 'abc123',
        opfsPath: 'content/ab/cd/m1/data',
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)
      indexedDbMocks.getProjectsUsingMedia.mockResolvedValue([])
      indexedDbMocks.decrementContentRef.mockResolvedValue(0)
      indexedDbMocks.getAllMedia.mockResolvedValue([])

      await mediaLibraryService.deleteMediaFromProject('project-1', 'm1')

      expect(opfsMocks.deleteFile).toHaveBeenCalledWith('content/ab/cd/m1/data')
      expect(indexedDbMocks.deleteContent).toHaveBeenCalledWith('abc123')
    })

    it('throws when media not found', async () => {
      indexedDbMocks.getMedia.mockResolvedValue(undefined)

      await expect(
        mediaLibraryService.deleteMediaFromProject('project-1', 'nonexistent'),
      ).rejects.toThrow('Media not found')
    })
  })

  describe('deleteMediaBatchFromProject', () => {
    it('deletes multiple media items in parallel', async () => {
      const media1 = makeMediaMetadata({ id: 'm1', storageType: 'handle' })
      const media2 = makeMediaMetadata({ id: 'm2', storageType: 'handle' })
      indexedDbMocks.getMedia.mockImplementation((id: string) =>
        id === 'm1' ? Promise.resolve(media1) : Promise.resolve(media2),
      )
      indexedDbMocks.getProjectsUsingMedia.mockResolvedValue([])
      indexedDbMocks.getAllMedia.mockResolvedValue([])

      await mediaLibraryService.deleteMediaBatchFromProject('project-1', ['m1', 'm2'])

      expect(indexedDbMocks.deleteMedia).toHaveBeenCalledTimes(2)
    })

    it('throws when all deletions fail', async () => {
      indexedDbMocks.getMedia.mockRejectedValue(new Error('not found'))

      await expect(
        mediaLibraryService.deleteMediaBatchFromProject('project-1', ['m1', 'm2']),
      ).rejects.toThrow('Failed to delete all')
    })
  })

  describe('getMediaFile', () => {
    it('returns file from FileSystemFileHandle', async () => {
      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4' })
      const mockHandle = {
        getFile: vi.fn().mockResolvedValue(mockFile),
        queryPermission: vi.fn().mockResolvedValue('granted'),
      }
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      const result = await mediaLibraryService.getMediaFile('m1')
      expect(result).toBe(mockFile)
      // Linked media is read through the handle, never mirrored into the workspace.
      expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalled()
      expect(indexedDbMocks.hasMediaSource).not.toHaveBeenCalled()
      expect(indexedDbMocks.readMediaSource).not.toHaveBeenCalled()
    })

    it('returns blob from OPFS storage', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
        mimeType: 'video/mp4',
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)
      opfsMocks.getFileBlob.mockResolvedValue(
        new File(['data'], 'video.mp4', { type: 'video/mp4' }),
      )

      const result = await mediaLibraryService.getMediaFile('m1')
      expect(result).toBeInstanceOf(Blob)
      expect(result?.type).toBe('video/mp4')
    })

    it('returns null for a path record: only the shell’s media route reads it', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'path',
        filePath: '/Volumes/Footage/clip.mp4',
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      const result = await mediaLibraryService.getMediaFile('m1')

      expect(result).toBeNull()
      expect(opfsMocks.getFileBlob).not.toHaveBeenCalled()
      // It does not look for a workspace copy either: a path record has none.
      expect(indexedDbMocks.readMediaSource).not.toHaveBeenCalled()
      expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalled()
    })

    it('falls back to ArrayBuffer OPFS reads when direct file access fails', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
        mimeType: 'video/mp4',
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)
      opfsMocks.getFileBlob.mockRejectedValue(new Error('direct file unsupported'))
      opfsMocks.getFile.mockResolvedValue(new ArrayBuffer(1024))

      const result = await mediaLibraryService.getMediaFile('m1')
      expect(result).toBeInstanceOf(Blob)
      expect(opfsMocks.getFileBlob).toHaveBeenCalledWith('content/ab/cd/m1/data')
      expect(opfsMocks.getFile).toHaveBeenCalledWith('content/ab/cd/m1/data')
    })

    it('returns null when media not found', async () => {
      indexedDbMocks.getMedia.mockResolvedValue(undefined)

      const result = await mediaLibraryService.getMediaFile('nonexistent')
      expect(result).toBeNull()
    })

    it('throws FileAccessError when handle permission is denied', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('denied'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      }
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      await expect(mediaLibraryService.getMediaFile('m1')).rejects.toThrow(FileAccessError)
    })

    it('reports a linked file without permission instead of reading a workspace copy', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('denied'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      }
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)
      // A stale copy from an older build must not hide the lost permission.
      indexedDbMocks.readMediaSource.mockResolvedValue(new Blob(['stale']))

      const error = await mediaLibraryService.getMediaFile('m1').catch((e: unknown) => e)

      expect(error).toBeInstanceOf(FileAccessError)
      expect((error as FileAccessError).type).toBe('permission_denied')
      expect(indexedDbMocks.readMediaSource).not.toHaveBeenCalled()
      expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalled()
    })

    it('reports a missing linked file instead of falling back to a workspace copy', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('granted'),
        getFile: vi.fn().mockRejectedValue(new DOMException('gone', 'NotFoundError')),
      }
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)
      indexedDbMocks.readMediaSource.mockResolvedValue(new Blob(['stale']))

      const error = await mediaLibraryService.getMediaFile('m1').catch((e: unknown) => e)

      expect(error).toBeInstanceOf(FileAccessError)
      expect((error as FileAccessError).type).toBe('file_missing')
      expect(indexedDbMocks.readMediaSource).not.toHaveBeenCalled()
    })
  })

  describe('copyMediaToProject', () => {
    it('creates association and increments OPFS ref count', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        contentHash: 'abc123',
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      await mediaLibraryService.copyMediaToProject('m1', 'project-2')

      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-2', 'm1')
      expect(indexedDbMocks.incrementContentRef).toHaveBeenCalledWith('abc123')
    })

    it('creates association without incrementing ref for handle storage', async () => {
      const media = makeMediaMetadata({ id: 'm1', storageType: 'handle' })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      await mediaLibraryService.copyMediaToProject('m1', 'project-2')

      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-2', 'm1')
      expect(indexedDbMocks.incrementContentRef).not.toHaveBeenCalled()
    })

    it('throws when media not found', async () => {
      indexedDbMocks.getMedia.mockResolvedValue(undefined)

      await expect(
        mediaLibraryService.copyMediaToProject('nonexistent', 'project-2'),
      ).rejects.toThrow('Media not found')
    })
  })

  describe('updateMediaCaptions', () => {
    it('preserves existing analysis metadata on partial caption rewrites', async () => {
      const media = makeMediaMetadata({ id: 'm1' })
      indexedDbMocks.readAiOutput.mockResolvedValue({
        service: 'lfm-captioning',
        model: 'lfm-2.5-vl',
        params: { sampleIntervalSec: 3 },
        data: {
          sampleIntervalSec: 3,
          embeddingModel: 'embed-old',
          embeddingDim: 384,
          imageEmbeddingModel: 'clip-old',
          imageEmbeddingDim: 512,
          contentHash: 'hash-abc',
          captions: [{ timeSec: 0, text: 'old' }],
        },
      })
      indexedDbMocks.updateMedia.mockResolvedValue({
        ...media,
        aiCaptions: [{ timeSec: 0, text: 'new' }],
      })

      await mediaLibraryService.updateMediaCaptions('m1', [{ timeSec: 0, text: 'new' }])

      expect(captionsStorageMocks.saveCaptions).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaId: 'm1',
          sampleIntervalSec: 3,
          embeddingModel: 'embed-old',
          embeddingDim: 384,
          imageEmbeddingModel: 'clip-old',
          imageEmbeddingDim: 512,
          contentHash: 'hash-abc',
          service: 'lfm-captioning',
          model: 'lfm-2.5-vl',
        }),
      )
      expect(indexedDbMocks.updateMedia).toHaveBeenCalledWith('m1', {
        aiCaptions: [{ timeSec: 0, text: 'new' }],
      })
    })
  })

  describe('thumbnail caching', () => {
    beforeEach(() => {
      // Clear singleton cache between tests
      mediaLibraryService.clearThumbnailCache('thumb-m1')
      mediaLibraryService.clearThumbnailCache('thumb-m2')
    })

    it('caches thumbnail blob URLs', async () => {
      const blob = new Blob(['thumb'], { type: 'image/webp' })
      indexedDbMocks.getThumbnailByMediaId.mockResolvedValue({ blob })

      const url1 = await mediaLibraryService.getThumbnailBlobUrl('thumb-m1')
      const url2 = await mediaLibraryService.getThumbnailBlobUrl('thumb-m1')

      expect(url1).toBe(url2)
      expect(indexedDbMocks.getThumbnailByMediaId).toHaveBeenCalledTimes(1)
    })

    it('clears thumbnail cache', async () => {
      const blob = new Blob(['thumb'], { type: 'image/webp' })
      indexedDbMocks.getThumbnailByMediaId.mockResolvedValue({ blob })

      await mediaLibraryService.getThumbnailBlobUrl('thumb-m2')
      mediaLibraryService.clearThumbnailCache('thumb-m2')

      // After clearing, next call should fetch again
      await mediaLibraryService.getThumbnailBlobUrl('thumb-m2')
      expect(indexedDbMocks.getThumbnailByMediaId).toHaveBeenCalledTimes(2)
    })

    it('returns null when no thumbnail exists', async () => {
      indexedDbMocks.getThumbnailByMediaId.mockResolvedValue(null)

      const result = await mediaLibraryService.getThumbnailBlobUrl('thumb-nope')
      expect(result).toBeNull()
    })

    it('re-reads when the change-marker differs (regenerated thumbnail)', async () => {
      indexedDbMocks.getThumbnailByMediaId.mockResolvedValue({
        blob: new Blob(['thumb'], { type: 'image/webp' }),
      })

      await mediaLibraryService.getThumbnailBlobUrl('thumb-m1', 'v1')
      // Same marker → cache hit, no second disk read.
      await mediaLibraryService.getThumbnailBlobUrl('thumb-m1', 'v1')
      expect(indexedDbMocks.getThumbnailByMediaId).toHaveBeenCalledTimes(1)

      // New marker (thumbnail regenerated) → must bypass the stale cache.
      await mediaLibraryService.getThumbnailBlobUrl('thumb-m1', 'v2')
      expect(indexedDbMocks.getThumbnailByMediaId).toHaveBeenCalledTimes(2)
    })

    it('serves a marker-less request from a marked cache entry', async () => {
      indexedDbMocks.getThumbnailByMediaId.mockResolvedValue({
        blob: new Blob(['thumb'], { type: 'image/webp' }),
      })

      await mediaLibraryService.getThumbnailBlobUrl('thumb-m1', 'v1')
      // A caller without a marker accepts whatever is cached — no extra read.
      await mediaLibraryService.getThumbnailBlobUrl('thumb-m1')
      expect(indexedDbMocks.getThumbnailByMediaId).toHaveBeenCalledTimes(1)
    })
  })

  describe('needsPermission', () => {
    it('returns true when handle permission is not granted', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('denied'),
      }
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      const result = await mediaLibraryService.needsPermission('m1')
      expect(result).toBe(true)
    })

    it('returns false when handle permission is granted', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('granted'),
      }
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      const result = await mediaLibraryService.needsPermission('m1')
      expect(result).toBe(false)
    })

    it('returns false for non-handle storage', async () => {
      const media = makeMediaMetadata({ id: 'm1', storageType: 'opfs' })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      const result = await mediaLibraryService.needsPermission('m1')
      expect(result).toBe(false)
    })
  })

  describe('validateSync', () => {
    it('identifies orphaned metadata entries', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
      })
      indexedDbMocks.getAllMedia.mockResolvedValue([media])
      opfsMocks.getFile.mockRejectedValue(new Error('not found'))

      const result = await mediaLibraryService.validateSync()
      expect(result.orphanedMetadata).toContain('m1')
    })

    it('returns empty for healthy storage', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
      })
      indexedDbMocks.getAllMedia.mockResolvedValue([media])
      opfsMocks.getFile.mockResolvedValue(new ArrayBuffer(1024))

      const result = await mediaLibraryService.validateSync()
      expect(result.orphanedMetadata).toHaveLength(0)
    })
  })

  describe('repairSync', () => {
    it('cleans up orphaned metadata', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
      })
      indexedDbMocks.getAllMedia.mockResolvedValue([media])
      opfsMocks.getFile.mockRejectedValue(new Error('not found'))

      const result = await mediaLibraryService.repairSync()
      expect(result.cleaned).toBe(1)
      expect(indexedDbMocks.deleteMedia).toHaveBeenCalledWith('m1')
    })
  })

  describe('relinkMediaHandle', () => {
    it('updates media with new file handle', async () => {
      const media = makeMediaMetadata({ id: 'm1' })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      const newFile = new File(['data'], 'renamed.mp4', { type: 'video/mp4' })
      const newHandle = {
        name: 'renamed.mp4',
        getFile: vi.fn().mockResolvedValue(newFile),
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn().mockResolvedValue('granted'),
      } as unknown as FileSystemFileHandle

      indexedDbMocks.updateMedia.mockResolvedValue({ ...media, fileName: 'renamed.mp4' })

      const result = await mediaLibraryService.relinkMediaHandle('m1', newHandle)
      expect(result.fileName).toBe('renamed.mp4')
      expect(indexedDbMocks.updateMedia).toHaveBeenCalledTimes(1)
    })

    it('throws when permission denied for new handle', async () => {
      const media = makeMediaMetadata({ id: 'm1' })
      indexedDbMocks.getMedia.mockResolvedValue(media)

      const newHandle = {
        name: 'file.mp4',
        queryPermission: vi.fn().mockResolvedValue('denied'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      } as unknown as FileSystemFileHandle

      await expect(mediaLibraryService.relinkMediaHandle('m1', newHandle)).rejects.toThrow(
        FileAccessError,
      )
    })
  })

  describe('mirrorOpfsMediaToWorkspace', () => {
    it('mirrors a legacy OPFS source that is missing from the workspace folder', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
        fileName: 'clip.mp4',
      })
      indexedDbMocks.hasMediaSource.mockResolvedValue(false)
      const blob = new Blob(['bytes'], { type: 'video/mp4' })
      opfsMocks.getFileBlob.mockResolvedValue(blob)

      const result = await mediaLibraryService.mirrorOpfsMediaToWorkspace([media])

      expect(opfsMocks.getFileBlob).toHaveBeenCalledWith('content/ab/cd/m1/data')
      expect(indexedDbMocks.writeMediaSource).toHaveBeenCalledWith('m1', blob, 'clip.mp4', {
        strict: true,
      })
      expect(result).toEqual({ mirrored: 1 })
    })

    it('skips OPFS media already present in the workspace folder', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
      })
      indexedDbMocks.hasMediaSource.mockResolvedValue(true)

      const result = await mediaLibraryService.mirrorOpfsMediaToWorkspace([media])

      expect(opfsMocks.getFileBlob).not.toHaveBeenCalled()
      expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalled()
      expect(result).toEqual({ mirrored: 0 })
    })

    it('ignores handle- and workspace-backed media', async () => {
      const handleMedia = makeMediaMetadata({ id: 'm1', storageType: 'handle' })
      const workspaceMedia = makeMediaMetadata({ id: 'm2', storageType: 'workspace' })

      const result = await mediaLibraryService.mirrorOpfsMediaToWorkspace([
        handleMedia,
        workspaceMedia,
      ])

      expect(indexedDbMocks.hasMediaSource).not.toHaveBeenCalled()
      expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalled()
      expect(result).toEqual({ mirrored: 0 })
    })

    it('continues past an item whose OPFS copy is missing on this origin', async () => {
      const gone = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
        fileName: 'gone.mp4',
      })
      const ok = makeMediaMetadata({
        id: 'm2',
        storageType: 'opfs',
        opfsPath: 'content/ef/gh/m2/data',
        fileName: 'ok.mp4',
      })
      indexedDbMocks.hasMediaSource.mockResolvedValue(false)
      const blob = new Blob(['bytes'], { type: 'video/mp4' })
      opfsMocks.getFileBlob.mockImplementation(async (path: string) => {
        if (path === 'content/ab/cd/m1/data') throw new Error('not found on this origin')
        return blob
      })

      const result = await mediaLibraryService.mirrorOpfsMediaToWorkspace([gone, ok])

      expect(indexedDbMocks.writeMediaSource).toHaveBeenCalledWith('m2', blob, 'ok.mp4', {
        strict: true,
      })
      expect(indexedDbMocks.writeMediaSource).not.toHaveBeenCalledWith(
        'm1',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      )
      expect(result).toEqual({ mirrored: 1 })
    })
  })
})
