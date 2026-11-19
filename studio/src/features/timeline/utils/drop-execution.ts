import type { TimelineItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import {
  extractValidMediaFileEntriesFromDataTransfer,
  formatMediaDropRejectionMessage,
  getMediaType,
} from '@/features/timeline/deps/media-library-resolver'
import {
  readDroppedSourceRange,
  type DroppableMediaType,
  type DroppedSourceRange,
} from './dropped-media'
import { isDroppableMediaType, isValidDragMediaItem, type DragMediaItem } from './drag-drop-preview'
import { preflightFirstTimelineVideoProjectMatch } from './external-file-project-match'

export interface DroppedMediaEntry {
  media: MediaMetadata
  mediaId: string
  mediaType: DroppableMediaType
  label: string
  /** The frames of `media` this entry plays, when it comes from a subclip or a marked range. */
  sourceRange?: DroppedSourceRange
}

interface DropLogger {
  error: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
}

interface DropNotifications {
  error: (message: string, options?: { description?: string }) => void
  warning: (message: string) => void
}

interface ResolveDroppedMediaEntriesFromExternalFilesOptions {
  dataTransfer: DataTransfer
  importHandlesForPlacement: (handles: FileSystemFileHandle[]) => Promise<MediaMetadata[]>
  notify: DropNotifications
}

interface ApplyResolvedTimelineDropOptions<TTracks> {
  addItem: (item: TimelineItem) => void
  addItems: (items: TimelineItem[]) => void
  currentTracks: TTracks
  dropResult: {
    items: TimelineItem[]
    tracks: TTracks
  }
  emptyMessage: string
  /** Replaces the generic "no compatible track" sentence when the caller knows the reason. */
  emptyDetail?: string
  notify: DropNotifications
  partialFailureLabel: string
  requestedCount: number
  setTracks: (tracks: TTracks) => void
}

function isParsedMediaItemPayload(payload: unknown): payload is {
  type: 'media-item'
  mediaId: string
  mediaType: unknown
  fileName: string
  sourceStart?: unknown
  sourceEnd?: unknown
  subclipId?: unknown
} {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Record<string, unknown>
  return (
    candidate.type === 'media-item' &&
    typeof candidate.mediaId === 'string' &&
    typeof candidate.fileName === 'string'
  )
}

export function resolveDroppedMediaEntriesFromPayload(
  payload: unknown,
  mediaItems: MediaMetadata[],
  logger: DropLogger,
): DroppedMediaEntry[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const mediaById = new Map(mediaItems.map((media) => [media.id, media]))
  const candidate = payload as Record<string, unknown>

  if (candidate.type === 'media-items') {
    const rawItems = Array.isArray(candidate.items) ? candidate.items : []
    const validItems = rawItems.filter(isValidDragMediaItem)
    if (validItems.length !== rawItems.length) {
      logger.warn('Skipping invalid media-items payload entries', {
        invalidCount: rawItems.length - validItems.length,
      })
    }

    return validItems.flatMap((dragItem: DragMediaItem) => {
      const media = mediaById.get(dragItem.mediaId)
      if (!media) {
        logger.error('Media not found:', dragItem.mediaId)
        return []
      }

      const { range } = readDroppedSourceRange(dragItem, dragItem.mediaType)
      return [
        {
          media,
          mediaId: dragItem.mediaId,
          mediaType: dragItem.mediaType,
          label: dragItem.fileName,
          ...(range ? { sourceRange: range } : {}),
        },
      ]
    })
  }

  if (isParsedMediaItemPayload(candidate) && isDroppableMediaType(candidate.mediaType)) {
    const media = mediaById.get(candidate.mediaId)
    if (!media) {
      logger.error('Media not found:', candidate.mediaId)
      return []
    }

    const { range, invalid } = readDroppedSourceRange(candidate, candidate.mediaType)
    if (invalid) {
      logger.warn('Skipping media-item payload with an invalid source range', {
        mediaId: candidate.mediaId,
      })
      return []
    }

    return [
      {
        media,
        mediaId: candidate.mediaId,
        mediaType: candidate.mediaType,
        label: candidate.fileName,
        ...(range ? { sourceRange: range } : {}),
      },
    ]
  }

  return []
}

export function buildDroppedMediaEntriesFromImportedMedia(
  importedMedia: MediaMetadata[],
): DroppedMediaEntry[] {
  return importedMedia.flatMap((media) => {
    const mediaType = getMediaType(media.mimeType)
    if (!isDroppableMediaType(mediaType)) {
      return []
    }

    return [
      {
        media,
        mediaId: media.id,
        mediaType,
        label: media.fileName,
      },
    ]
  })
}

export async function resolveDroppedMediaEntriesFromExternalFiles({
  dataTransfer,
  importHandlesForPlacement,
  notify,
}: ResolveDroppedMediaEntriesFromExternalFilesOptions): Promise<DroppedMediaEntry[] | null> {
  const { supported, entries, errors } =
    await extractValidMediaFileEntriesFromDataTransfer(dataTransfer)
  if (!supported) {
    notify.warning('Drag-drop not supported in this browser. Use Chrome or Edge.')
    return null
  }

  if (errors.length > 0) {
    notify.error(formatMediaDropRejectionMessage(errors))
  }

  if (entries.length === 0) {
    return null
  }

  try {
    await preflightFirstTimelineVideoProjectMatch(entries)
  } catch (error) {
    notify.error('Unable to inspect dropped file.', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
    return null
  }

  let importedMedia: Awaited<ReturnType<typeof importHandlesForPlacement>>
  try {
    importedMedia = await importHandlesForPlacement(entries.map((entry) => entry.handle))
  } catch (error) {
    notify.error('Unable to import dropped files.', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
    return null
  }
  if (importedMedia.length === 0) {
    notify.error('Unable to import dropped files')
    return null
  }

  const droppedEntries = buildDroppedMediaEntriesFromImportedMedia(importedMedia)
  if (droppedEntries.length === 0) {
    notify.warning('Dropped files were imported, but none could be placed on the timeline.')
    return null
  }

  return droppedEntries
}

function buildTimelinePlacementFailureMessage(params: {
  emptyMessage?: string
  emptyDetail?: string
  placedCount: number
  requestedCount: number
  label: string
}): string {
  const failedCount = Math.max(0, params.requestedCount - params.placedCount)
  if (params.placedCount === 0) {
    const detail =
      params.emptyDetail ??
      `No compatible track or open space was available for ${params.requestedCount} ${params.label}.`
    return `${params.emptyMessage ?? 'Unable to add dropped items'}. ${detail}`
  }

  return `Added ${params.placedCount} of ${params.requestedCount} ${params.label}. ${failedCount} could not be placed because no compatible track or open space was available.`
}

const AUDIO_NEEDS_AUDIO_TRACK =
  'Audio goes on an audio track: drop it on an audio track (A1, below the video tracks), not on a video track.'

/**
 * FreeCut keeps audio off video tracks on purpose, and on an empty timeline the video track is
 * the one that is in reach, so the generic "no compatible track" message does not say what to
 * do. Returns the sentence that does when the drop is audio-only and aimed at a video track or
 * zone, otherwise undefined (the generic message stays).
 */
export function getAudioOnVideoDropDetail(
  entries: ReadonlyArray<Pick<DroppedMediaEntry, 'mediaType'>>,
  targetKind: 'video' | 'audio' | null,
  translate: (key: string, options: { defaultValue: string }) => string,
): string | undefined {
  const audioOnly = entries.length > 0 && entries.every((entry) => entry.mediaType === 'audio')
  return targetKind === 'video' && audioOnly
    ? translate('timeline.track.audioNeedsAudioTrack', { defaultValue: AUDIO_NEEDS_AUDIO_TRACK })
    : undefined
}

export function applyResolvedTimelineDrop<TTracks>({
  addItem,
  addItems,
  currentTracks,
  dropResult,
  emptyMessage,
  emptyDetail,
  notify,
  partialFailureLabel,
  requestedCount,
  setTracks,
}: ApplyResolvedTimelineDropOptions<TTracks>): boolean {
  if (dropResult.items.length === 0) {
    notify.error(
      buildTimelinePlacementFailureMessage({
        emptyMessage,
        emptyDetail,
        placedCount: 0,
        requestedCount,
        label: partialFailureLabel,
      }),
    )
    return false
  }

  if (dropResult.tracks !== currentTracks) {
    setTracks(dropResult.tracks)
  }

  if (dropResult.items.length < requestedCount) {
    notify.warning(
      buildTimelinePlacementFailureMessage({
        placedCount: dropResult.items.length,
        requestedCount,
        label: partialFailureLabel,
      }),
    )
  }

  if (dropResult.items.length === 1) {
    addItem(dropResult.items[0]!)
  } else {
    addItems(dropResult.items)
  }

  return true
}
