// @vitest-environment node

/**
 * `studio.media` (task 2.1): the five methods over the media library.
 *
 * The media-processing worker cannot run in Node, so the tests mock the
 * boundary the library's own tests mock — the `mediaLibraryService` module and
 * the loader the store reaches it through (media-import-actions.test.ts,
 * media-library-service.test.ts) — and pass fake `FileSystemFileHandle`s that
 * resolve a real `File`. The library store itself is the real one, so an
 * import really lands in `mediaItems` and a removal really leaves it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { resolveMediaUrl } from '@/features/media-library/utils/media-resolver'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { StudioError } from '../errors'
import { createMediaApi } from './media'
import type { MediaApi, MediaInfo } from '../types'

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  importMediaWithHandle: vi.fn(),
  deleteMediaBatch: vi.fn(),
  deleteMediaBatchFromProject: vi.fn(),
  getMedia: vi.fn(),
  getMediaFile: vi.fn(),
  waitForMediaPreparation: vi.fn(),
}))

vi.mock('@/features/media-library/services/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
  // The resolver only names this class when its bytes are missing.
  FileAccessError: class FileAccessError extends Error {
    readonly type = 'file_missing'
  },
}))

vi.mock('@/features/media-library/stores/media-library-service-access', () => ({
  loadMediaLibraryService: async () => ({ mediaLibraryService: mediaLibraryServiceMocks }),
  // The real service loader registers itself on import; nothing may load it.
  registerMediaLibraryServiceLoader: () => () => {},
}))

const proxyServiceMocks = vi.hoisted(() => ({
  canGenerateProxy: vi.fn(() => false),
  setProxyKey: vi.fn(),
  clearProxyKey: vi.fn(),
  getProxyKey: vi.fn(),
  getProxyBlobUrl: vi.fn(() => null),
  loadExistingProxies: vi.fn(async () => undefined),
  onStatusChange: vi.fn(),
  setMediaResolver: vi.fn(),
  setFilmstripPrewarm: vi.fn(),
}))

vi.mock('@/features/media-library/services/proxy-service', () => ({
  proxyService: proxyServiceMocks,
}))

vi.mock('@/features/media-library/services/frame-interpolation-service', () => ({
  frameInterpolationService: {
    cancelAll: vi.fn(),
    onStatusChange: vi.fn(),
    onMediaCreated: vi.fn(),
  },
}))

vi.mock('@/features/media-library/services/upscale-service', () => ({
  upscaleService: {
    cancelAll: vi.fn(),
    onStatusChange: vi.fn(),
    onMediaCreated: vi.fn(),
  },
}))

vi.mock('@/infrastructure/storage', () => ({
  getTranscriptMediaIds: vi.fn(async () => new Set<string>()),
  hasMediaSource: vi.fn(async () => false),
  validateMediaHandle: vi.fn(async () => ({ kind: 'ok' })),
}))

const loggerMocks = vi.hoisted(() => ({
  startEvent: vi.fn(() => ({
    merge: vi.fn(),
    set: vi.fn(),
    success: vi.fn(),
    failure: vi.fn(),
  })),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => loggerMocks,
  createOperationId: () => 'op-test',
}))

// Keep the real resolver (its null/empty-string mapping is what `url` maps to
// `null`) but let one test make it reject, for the INTERNAL branch.
vi.mock('@/features/media-library/utils/media-resolver', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/media-library/utils/media-resolver')>()
  return { ...actual, resolveMediaUrl: vi.fn(actual.resolveMediaUrl) }
})

/** A browser that can read file handles; the Node test environment is not one. */
class FakeFileSystemFileHandle {}

/** One library record; every field a `MediaInfo` carries is spelled out. */
function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'm-1',
    storageType: 'handle',
    fileName: 'takeoff.mp4',
    fileSize: 2048,
    mimeType: 'video/mp4',
    duration: 12,
    width: 3840,
    height: 2160,
    fps: 60,
    codec: 'hvc1',
    bitrate: 50_000_000,
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_001,
    ...overrides,
  }
}

/** A fake handle whose file the import action can read. */
function createHandle(file: File): FileSystemFileHandle {
  return {
    name: file.name,
    getFile: vi.fn(async () => file),
  } as unknown as FileSystemFileHandle
}

function createVideoFile(name = 'takeoff.mp4'): File {
  return new File(['not really video'], name, { type: 'video/mp4' })
}

/** Put records in the real library, as `loadMediaItems` would. */
function seedLibrary(items: MediaMetadata[]): void {
  useMediaLibraryStore.setState({
    currentProjectId: 'project-1',
    mediaItems: items,
    mediaById: Object.fromEntries(items.map((item) => [item.id, item])),
    error: null,
    notification: null,
    selectedMediaIds: [],
    importingIds: [],
  })
}

async function catchStudioError(promise: Promise<unknown>): Promise<StudioError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw a StudioError')
}

/** The JSON copy an import of `record` must return. */
function importedInfo(record: MediaMetadata): MediaInfo {
  return {
    id: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    type: 'video',
    fileSize: record.fileSize,
    duration: record.duration,
    width: record.width,
    height: record.height,
    fps: record.fps,
    codec: record.codec,
    bitrate: record.bitrate,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

let media: MediaApi

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('FileSystemFileHandle', FakeFileSystemFileHandle)
  blobUrlManager.releaseAll()
  useTimelineCommandStore.getState().clearHistory()
  seedLibrary([])
  media = createMediaApi()
})

afterEach(() => {
  useMediaLibraryStore.getState().clearNotification()
  blobUrlManager.releaseAll()
  vi.unstubAllGlobals()
})

describe('studio.media.list', () => {
  it('returns field-by-field JSON copies in library order', () => {
    const records = [
      makeMedia({ id: 'm-1' }),
      makeMedia({
        id: 'm-2',
        fileName: 'sea.png',
        mimeType: 'image/png',
        duration: 0,
        width: 800,
        height: 600,
        fps: 1,
        codec: 'png',
        bitrate: 0,
      }),
    ]
    seedLibrary(records)

    const listed = media.list()

    expect(listed).toHaveLength(2)
    expect(listed.map((item) => item.id)).toEqual(['m-1', 'm-2'])
    expect(listed[0]).toEqual({
      id: 'm-1',
      fileName: 'takeoff.mp4',
      mimeType: 'video/mp4',
      type: 'video',
      fileSize: 2048,
      duration: 12,
      width: 3840,
      height: 2160,
      fps: 60,
      codec: 'hvc1',
      bitrate: 50_000_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_001,
    })
    expect(listed[1]).toMatchObject({ id: 'm-2', type: 'image' })
    // A copy, not the store record: no storage plumbing leaks into the JSON.
    expect(listed[0]).not.toBe(records[0])
    expect(Object.keys(listed[0]!).sort()).toEqual(
      [
        'bitrate',
        'codec',
        'createdAt',
        'duration',
        'fileName',
        'fileSize',
        'fps',
        'height',
        'id',
        'mimeType',
        'type',
        'updatedAt',
        'width',
      ].sort(),
    )
  })

  it('filters by the kind derived from the MIME type', () => {
    seedLibrary([
      makeMedia({ id: 'm-video', mimeType: 'video/mp4' }),
      makeMedia({ id: 'm-audio', mimeType: 'audio/mpeg' }),
      makeMedia({ id: 'm-image', mimeType: 'image/jpeg' }),
      makeMedia({ id: 'm-lottie', mimeType: 'application/lottie+json' }),
      makeMedia({ id: 'm-other', mimeType: 'text/plain' }),
    ])

    expect(media.list({ type: 'video' }).map((item) => item.id)).toEqual(['m-video'])
    expect(media.list({ type: 'audio' }).map((item) => item.id)).toEqual(['m-audio'])
    expect(media.list({ type: 'image' }).map((item) => item.id)).toEqual(['m-image'])
    expect(media.list({ type: 'lottie' }).map((item) => item.id)).toEqual(['m-lottie'])
    expect(media.list({ type: 'unknown' }).map((item) => item.id)).toEqual(['m-other'])
  })

  it('returns an empty list for an empty library and for a filter nothing matches', () => {
    expect(media.list()).toEqual([])

    seedLibrary([makeMedia({ id: 'm-1' })])

    expect(media.list({ type: 'audio' })).toEqual([])
    // `@throws Nothing`: an unknown filter matches nothing instead of throwing.
    expect(media.list({ type: 'nope' as never })).toEqual([])
  })

  it('hands out a fresh copy on every call', () => {
    seedLibrary([makeMedia()])

    const first = media.list()[0]!
    first.fileName = 'edited by the caller'

    expect(media.list()[0]!.fileName).toBe('takeoff.mp4')
    expect(useMediaLibraryStore.getState().mediaItems[0]!.fileName).toBe('takeoff.mp4')
  })
})

describe('studio.media.get', () => {
  it('returns one item as a copy', () => {
    const record = makeMedia({ id: 'm-7' })
    seedLibrary([record])

    const found = media.get('m-7')

    expect(found).toEqual(importedInfo(record))
    expect(found).not.toBe(record)

    found!.duration = 99

    expect(media.get('m-7')!.duration).toBe(12)
  })

  it('returns null for an id that is not in the library', () => {
    seedLibrary([makeMedia()])

    expect(media.get('m-9')).toBeNull()
    expect(media.get('' as never)).toBeNull()
  })
})

describe('studio.media.import', () => {
  it('passes the storage mode through and returns the imported items', async () => {
    const file = createVideoFile()
    const handle = createHandle(file)
    const record = makeMedia({ id: 'm-9' })
    mediaLibraryServiceMocks.importMediaWithHandle.mockResolvedValue(record)

    const imported = await media.import([handle], { storageMode: 'link' })

    expect(imported).toEqual([importedInfo(record)])
    expect(imported[0]).not.toBe(useMediaLibraryStore.getState().mediaById['m-9'])
    expect(mediaLibraryServiceMocks.importMediaWithHandle).toHaveBeenCalledWith(
      handle,
      'project-1',
      { storageMode: 'link' },
    )
    expect(media.get('m-9')).toEqual(importedInfo(record))
  })

  it("leaves the app's default storage mode alone when none is given", async () => {
    const handle = createHandle(createVideoFile())
    mediaLibraryServiceMocks.importMediaWithHandle.mockResolvedValue(makeMedia({ id: 'm-9' }))
    const importHandles = vi.spyOn(useMediaLibraryStore.getState(), 'importHandles')

    await media.import([handle])

    expect(importHandles).toHaveBeenCalledWith([handle], undefined)
    importHandles.mockRestore()
  })

  it('imports nothing and calls no service for an empty list of handles', async () => {
    await expect(media.import([])).resolves.toEqual([])
    expect(mediaLibraryServiceMocks.importMediaWithHandle).not.toHaveBeenCalled()
  })

  it('returns the items that were read when some files fail', async () => {
    const good = createHandle(createVideoFile('good.mp4'))
    const bad = createHandle(createVideoFile('bad.mp4'))
    const record = makeMedia({ id: 'm-9', fileName: 'good.mp4' })
    mediaLibraryServiceMocks.importMediaWithHandle
      .mockResolvedValueOnce(record)
      .mockRejectedValueOnce(new Error('decode failed'))

    const imported = await media.import([good, bad])

    expect(imported).toEqual([importedInfo(record)])
    expect(mediaLibraryServiceMocks.importMediaWithHandle).toHaveBeenCalledTimes(2)
  })

  it('throws UNSUPPORTED when the page cannot read file handles', async () => {
    vi.unstubAllGlobals()

    const error = await catchStudioError(media.import([createHandle(createVideoFile())]))

    expect(error.code).toBe('UNSUPPORTED')
    expect(error.message).toBe(
      'media.import: this browser cannot read file handles (File System Access is missing)',
    )
    expect(error.hint).toContain('studio.media.import')
    expect(mediaLibraryServiceMocks.importMediaWithHandle).not.toHaveBeenCalled()
  })

  it('throws MEDIA_UNAVAILABLE when no handle produced a library item', async () => {
    mediaLibraryServiceMocks.importMediaWithHandle.mockRejectedValue(new Error('decode failed'))

    const error = await catchStudioError(media.import([createHandle(createVideoFile())]))

    expect(error.code).toBe('MEDIA_UNAVAILABLE')
    expect(error.message).toBe('media.import: the file could not be read, so nothing was imported')
    // The optimistic placeholder and its preparation task are gone.
    expect(useMediaLibraryStore.getState().mediaItems).toEqual([])
    expect(useMediaLibraryStore.getState().importingIds).toEqual([])
  })

  it('names how many files could not be read', async () => {
    mediaLibraryServiceMocks.importMediaWithHandle.mockRejectedValue(new Error('nope'))

    const error = await catchStudioError(
      media.import([
        createHandle(createVideoFile('a.mp4')),
        createHandle(createVideoFile('b.mp4')),
      ]),
    )

    expect(error.message).toBe(
      'media.import: all 2 files could not be read, so nothing was imported',
    )
  })

  it('throws UNSUPPORTED when no project is open', async () => {
    useMediaLibraryStore.setState({ currentProjectId: null })
    const handle = createHandle(createVideoFile())

    const error = await catchStudioError(media.import([handle]))

    expect(error.code).toBe('UNSUPPORTED')
    expect(error.message).toBe(
      'media.import: no project is open, so the media library has nothing to import into',
    )
    expect(error.hint).toBe(
      'Open the project first with studio.project.open(id); after studio.project.create, pass the id it returned.',
    )
    expect(handle.getFile).not.toHaveBeenCalled()
  })

  it('throws INTERNAL when the import action itself fails', async () => {
    const importHandles = vi
      .spyOn(useMediaLibraryStore.getState(), 'importHandles')
      .mockRejectedValueOnce(new Error('loader missing'))

    const error = await catchStudioError(media.import([createHandle(createVideoFile())]))

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toBe('media.import: the import failed: loader missing')
    importHandles.mockRestore()
  })

  it('rejects a handles argument that is not an array', async () => {
    const error = await catchStudioError(media.import('takeoff.mp4' as never))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('handles')
    expect(error.message).toBe(
      'media.import: "handles" must be an array of FileSystemFileHandle (got "takeoff.mp4")',
    )
  })

  it('rejects an unknown storage mode', async () => {
    const error = await catchStudioError(
      media.import([createHandle(createVideoFile())], { storageMode: 'move' as never }),
    )

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('storageMode')
    expect(error.valid).toEqual(['copy', 'link'])
    expect(error.message).toBe(
      'media.import: "storageMode" must be one of "copy" or "link" (got "move"); ' +
        'valid: "copy", "link"',
    )
  })
})

describe('studio.media.remove', () => {
  it('removes the items from the library', async () => {
    seedLibrary([makeMedia({ id: 'm-1' }), makeMedia({ id: 'm-2' })])
    mediaLibraryServiceMocks.deleteMediaBatchFromProject.mockResolvedValue(undefined)

    await expect(media.remove(['m-1', 'm-2'])).resolves.toBeUndefined()

    expect(useMediaLibraryStore.getState().mediaItems).toEqual([])
    expect(mediaLibraryServiceMocks.deleteMediaBatchFromProject).toHaveBeenCalledWith('project-1', [
      'm-1',
      'm-2',
    ])
  })

  it('deletes a repeated id once', async () => {
    seedLibrary([makeMedia({ id: 'm-1' })])
    mediaLibraryServiceMocks.deleteMediaBatchFromProject.mockResolvedValue(undefined)

    await media.remove(['m-1', 'm-1'])

    expect(mediaLibraryServiceMocks.deleteMediaBatchFromProject).toHaveBeenCalledWith('project-1', [
      'm-1',
    ])
  })

  it('does nothing for an empty list', async () => {
    await expect(media.remove([])).resolves.toBeUndefined()
    expect(mediaLibraryServiceMocks.deleteMediaBatchFromProject).not.toHaveBeenCalled()
    expect(mediaLibraryServiceMocks.deleteMediaBatch).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND and deletes nothing when an id is not in the library', async () => {
    seedLibrary([makeMedia({ id: 'm-1' }), makeMedia({ id: 'm-2' })])

    const error = await catchStudioError(media.remove(['m-1', 'm-9']))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('ids')
    expect(error.entity).toEqual({ kind: 'media', id: 'm-9' })
    expect(error.valid).toEqual(['m-1', 'm-2'])
    expect(error.message).toBe(
      'media.remove: "ids" must be an existing media id in the media library (got "m-9"); ' +
        'valid: "m-1", "m-2"',
    )
    expect(mediaLibraryServiceMocks.deleteMediaBatchFromProject).not.toHaveBeenCalled()
    expect(media.list().map((item) => item.id)).toEqual(['m-1', 'm-2'])
  })

  it('throws INTERNAL and keeps the library when the removal fails', async () => {
    seedLibrary([makeMedia({ id: 'm-1' })])
    mediaLibraryServiceMocks.deleteMediaBatchFromProject.mockRejectedValue(
      new Error('permission denied'),
    )

    const error = await catchStudioError(media.remove(['m-1']))

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toBe('media.remove: the removal failed: permission denied')
    expect(media.get('m-1')).not.toBeNull()
  })

  it('rejects an ids argument that is not an array', async () => {
    const error = await catchStudioError(media.remove('m-1' as never))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('ids')
    expect(error.message).toBe('media.remove: "ids" must be an array of media ids (got "m-1")')
  })
})

describe('studio.media.url', () => {
  it('returns a URL the browser can play the media from', async () => {
    seedLibrary([makeMedia({ id: 'm-1' })])
    mediaLibraryServiceMocks.getMedia.mockResolvedValue(makeMedia({ id: 'm-1' }))
    mediaLibraryServiceMocks.getMediaFile.mockResolvedValue(new Blob(['bytes']))

    const url = await media.url('m-1')

    expect(url).toMatch(/^blob:/)
    expect(blobUrlManager.get('m-1')).toBe(url)
    expect(mediaLibraryServiceMocks.getMedia).toHaveBeenCalledWith('m-1')
  })

  it('returns null when the record exists but its bytes do not', async () => {
    seedLibrary([makeMedia({ id: 'm-1' })])
    mediaLibraryServiceMocks.getMedia.mockResolvedValue(makeMedia({ id: 'm-1' }))
    mediaLibraryServiceMocks.getMediaFile.mockResolvedValue(null)

    await expect(media.url('m-1')).resolves.toBeNull()
  })

  it('returns null when the storage has no record of the media', async () => {
    seedLibrary([makeMedia({ id: 'm-1' })])
    mediaLibraryServiceMocks.getMedia.mockResolvedValue(undefined)

    await expect(media.url('m-1')).resolves.toBeNull()
  })

  it('throws NOT_FOUND for an id that is not in the library', async () => {
    seedLibrary([makeMedia({ id: 'm-1' })])

    const error = await catchStudioError(media.url('m-9'))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('id')
    expect(error.entity).toEqual({ kind: 'media', id: 'm-9' })
    expect(error.message).toBe(
      'media.url: "id" must be an existing media id in the media library (got "m-9"); ' +
        'valid: "m-1"',
    )
    expect(mediaLibraryServiceMocks.getMedia).not.toHaveBeenCalled()
  })

  it('throws INTERNAL when the resolver fails', async () => {
    seedLibrary([makeMedia({ id: 'm-1' })])
    vi.mocked(resolveMediaUrl).mockRejectedValueOnce(new Error('worker gone'))

    const error = await catchStudioError(media.url('m-1'))

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toBe('media.url: could not resolve media "m-1": worker gone')
  })
})

describe('the library is not the timeline', () => {
  it('leaves the undo history untouched', async () => {
    seedLibrary([makeMedia({ id: 'm-1' })])
    mediaLibraryServiceMocks.importMediaWithHandle.mockResolvedValue(makeMedia({ id: 'm-9' }))
    mediaLibraryServiceMocks.getMedia.mockResolvedValue(makeMedia({ id: 'm-1' }))
    mediaLibraryServiceMocks.getMediaFile.mockResolvedValue(new Blob(['bytes']))
    mediaLibraryServiceMocks.deleteMediaBatchFromProject.mockResolvedValue(undefined)

    expect(useTimelineCommandStore.getState().undoStack).toEqual([])

    media.list()
    media.get('m-1')
    await media.import([createHandle(createVideoFile())])
    await media.url('m-1')
    await media.remove(['m-1'])

    const history = useTimelineCommandStore.getState()
    expect(history.undoStack).toEqual([])
    expect(history.redoStack).toEqual([])
    expect(history.canUndo).toBe(false)
    expect(history.stacksByContext).toEqual({})
    expect(media.list().map((item) => item.id)).toEqual(['m-9'])
  })
})

describe('the JSDoc examples', () => {
  it('run as written', async () => {
    seedLibrary([makeMedia({ id: 'm-1' })])
    mediaLibraryServiceMocks.importMediaWithHandle.mockResolvedValue(makeMedia({ id: 'm-2' }))
    mediaLibraryServiceMocks.getMedia.mockResolvedValue(makeMedia({ id: 'm-1' }))
    mediaLibraryServiceMocks.getMediaFile.mockResolvedValue(new Blob(['bytes']))
    mediaLibraryServiceMocks.deleteMediaBatchFromProject.mockResolvedValue(undefined)
    const studio = { media: createMediaApi() }
    const handle = createHandle(createVideoFile())

    expect(studio.media.list({ type: 'video' }).map((item) => item.id)).toEqual(['m-1'])
    expect(studio.media.get('m-1')!.id).toBe('m-1')
    await expect(studio.media.import([handle], { storageMode: 'link' })).resolves.toHaveLength(1)
    await expect(studio.media.url('m-1')).resolves.toMatch(/^blob:/)
    await expect(studio.media.remove(['m-1'])).resolves.toBeUndefined()
  })
})
