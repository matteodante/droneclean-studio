/**
 * `studio.media`: the media library (design §4.2).
 *
 * The library is workspace state, not timeline state: importing and removing
 * media never runs a command and never enters the timeline's undo history
 * (design §3.4), so no method here comes from `transaction` and none of them
 * adds an undo step.
 *
 * Reads build plain JSON copies field by field from the library's records
 * (`MediaMetadata`); a caller never gets a store object it could mutate.
 */

import type { MediaMetadata } from '@/types/storage'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { getMediaType } from '@/features/media-library/utils/validation'
import { resolveMediaUrl } from '@/features/media-library/utils/media-resolver'
import { requireMedia } from '../context'
import { invalidArgumentError, studioError } from '../errors'
import type { MediaApi, MediaFilter, MediaInfo } from '../types'

/** The message of a failed promise, for an `INTERNAL` error. */
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The JSON copy of one library record (design §4.2: never a store object). */
function toMediaInfo(media: MediaMetadata): MediaInfo {
  return {
    id: media.id,
    fileName: media.fileName,
    mimeType: media.mimeType,
    type: getMediaType(media.mimeType),
    fileSize: media.fileSize,
    duration: media.duration,
    width: media.width,
    height: media.height,
    fps: media.fps,
    codec: media.codec,
    bitrate: media.bitrate,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
  }
}

/**
 * The handles as an array, rejecting a caller that sent something else (the
 * MCP passes JSON, so the type alone does not protect the import).
 */
function requireHandles(value: unknown): FileSystemFileHandle[] {
  if (!Array.isArray(value)) {
    throw invalidArgumentError({
      method: 'media.import',
      argument: 'handles',
      expectation: 'an array of FileSystemFileHandle',
      value,
    })
  }
  return value as FileSystemFileHandle[]
}

/**
 * The storage mode to pass to the library, or `undefined` to leave the app's
 * default in place (design §0, decision 7; task 1.2 makes `link` the default).
 */
function requireStorageMode(value: unknown): 'copy' | 'link' | undefined {
  if (value === undefined) return undefined
  if (value === 'copy' || value === 'link') return value
  throw invalidArgumentError({
    method: 'media.import',
    argument: 'storageMode',
    expectation: 'one of "copy" or "link"',
    value,
    valid: ['copy', 'link'],
  })
}

/** The ids as an array, rejecting a caller that sent something else. */
function requireMediaIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw invalidArgumentError({
      method: 'media.remove',
      argument: 'ids',
      expectation: 'an array of media ids',
      value,
    })
  }
  return value as string[]
}

/**
 * Throw unless this page can read a file handle at all. A page without the
 * File System Access API cannot resolve a handle into a file, so the import
 * never starts; the caller needs the desktop app or a Chromium browser.
 */
function requireFileHandleSupport(): void {
  if (typeof FileSystemFileHandle !== 'undefined') return
  throw studioError({
    code: 'UNSUPPORTED',
    method: 'media.import',
    message: 'this browser cannot read file handles (File System Access is missing)',
    hint: 'Import needs the desktop app or a Chromium browser; studio.media.import takes FileSystemFileHandles.',
  })
}

/** The number of handles, as the subject of an import failure message. */
function importSubject(count: number): string {
  if (count === 1) return 'the file'
  return `all ${count} files`
}

/**
 * The `studio.media` namespace: `list`, `get`, `import`, `remove` and `url`
 * over `useMediaLibraryStore`, `importHandles`, `deleteMediaBatch` and
 * `resolveMediaUrl`. None of them is an undo step.
 * @example const media = createMediaApi()
 */
export function createMediaApi(): MediaApi {
  return {
    list(filter?: MediaFilter): MediaInfo[] {
      const type = filter?.type
      return useMediaLibraryStore
        .getState()
        .mediaItems.filter((item) => type === undefined || getMediaType(item.mimeType) === type)
        .map(toMediaInfo)
    },

    get(id): MediaInfo | null {
      const media = useMediaLibraryStore.getState().mediaById[id]
      return media ? toMediaInfo(media) : null
    },

    async import(handles, options) {
      const requested = requireHandles(handles)
      const storageMode = requireStorageMode(options?.storageMode)
      // An empty import asks the browser to read nothing, so it is a no-op
      // wherever the SDK runs.
      if (requested.length === 0) return []
      requireFileHandleSupport()

      if (!useMediaLibraryStore.getState().currentProjectId) {
        throw studioError({
          code: 'UNSUPPORTED',
          method: 'media.import',
          message: 'no project is open, so the media library has nothing to import into',
          hint: 'Open the project first with studio.project.open(id); after studio.project.create, pass the id it returned.',
        })
      }

      let imported: MediaMetadata[]
      try {
        imported = await useMediaLibraryStore
          .getState()
          .importHandles(requested, storageMode === undefined ? undefined : { storageMode })
      } catch (error) {
        throw studioError({
          code: 'INTERNAL',
          method: 'media.import',
          message: `the import failed: ${failureMessage(error)}`,
        })
      }

      // The import action skips handles it cannot read (permission denied, file
      // gone, the worker rejected the file) and resolves with what it imported.
      // Nothing imported is a failure the caller must see, not an empty list.
      if (imported.length === 0) {
        throw studioError({
          code: 'MEDIA_UNAVAILABLE',
          method: 'media.import',
          message: `${importSubject(requested.length)} could not be read, so nothing was imported`,
          hint: 'A handle needs permission on its file; the library imports video, audio, images and Lottie.',
        })
      }

      return imported.map(toMediaInfo)
    },

    async remove(ids) {
      const requested = [...new Set(requireMediaIds(ids))]
      // Validate every id first: a batch that names one missing item deletes
      // nothing, so the caller fixes the list and retries.
      for (const id of requested) requireMedia(id, 'media.remove', 'ids')
      if (requested.length === 0) return

      try {
        await useMediaLibraryStore.getState().deleteMediaBatch(requested)
      } catch (error) {
        throw studioError({
          code: 'INTERNAL',
          method: 'media.remove',
          message: `the removal failed: ${failureMessage(error)}`,
        })
      }
    },

    async url(id) {
      requireMedia(id, 'media.url', 'id')
      let resolved: string
      try {
        resolved = await resolveMediaUrl(id)
      } catch (error) {
        throw studioError({
          code: 'INTERNAL',
          method: 'media.url',
          message: `could not resolve media ${JSON.stringify(id)}: ${failureMessage(error)}`,
        })
      }
      // The resolver answers an empty string when the record exists but its
      // bytes do not; the SDK's contract calls that null.
      return resolved === '' ? null : resolved
    },
  }
}
