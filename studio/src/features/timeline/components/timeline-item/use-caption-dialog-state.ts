import { useCallback, useMemo, useState } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useItemsStore } from '../../stores/items-store'
import { selectConsolidatableCaptionClipIds } from '../../stores/items-store-indexes'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { mediaTranscriptionService } from '@/features/timeline/deps/media-transcription-service'
import { i18n } from '@/i18n'
import {
  importMediaLibraryService,
  useEmbeddedSubtitlePickerStore,
} from '@/features/timeline/deps/media-library-service'

function isEmbeddedSubtitleContainer(fileName: string, mimeType: string): boolean {
  const name = fileName.toLowerCase()
  return (
    mimeType === 'video/x-matroska' ||
    mimeType === 'video/matroska' ||
    mimeType === 'video/webm' ||
    name.endsWith('.mkv') ||
    name.endsWith('.webm')
  )
}

interface UseCaptionDialogStateParams {
  item: TimelineItemType
  isBroken: boolean
  linkedItemsForCaptionOwnership: TimelineItemType[]
  hasGeneratedCaptions: boolean
}

type TranscriptProgress = NonNullable<
  ReturnType<typeof useMediaLibraryStore.getState>['transcriptProgress'] extends Map<
    string,
    infer V
  >
    ? V
    : never
>

export interface CaptionDialogState {
  canManageCaptions: boolean
  canExtractEmbeddedSubtitles: boolean
  hasConsolidatablePerCueCaptions: boolean
  mediaHasTranscript: boolean
  transcriptStatus: string
  transcriptProgress: TranscriptProgress | null
  mediaFileName: string
  dialogOpen: boolean
  openDialog: () => void
  setDialogOpen: (next: boolean) => void
  setDialogError: (message: string | null) => void
  dialogError: string | null
  /** "Generate Captions" / "Regenerate Captions": insert from the transcript, or ask for one. */
  handleGenerateCaptions: () => void
  handleExtractEmbeddedSubtitles: (() => Promise<void>) | undefined
  handleConsolidateCaptionsToSegment: (() => Promise<void>) | undefined
}

export function useCaptionDialogState({
  item,
  isBroken,
  linkedItemsForCaptionOwnership,
  hasGeneratedCaptions,
}: UseCaptionDialogStateParams): CaptionDialogState {
  const transcriptStatus = useMediaLibraryStore(
    useCallback(
      (s) => (item.mediaId ? (s.transcriptStatus.get(item.mediaId) ?? 'idle') : 'idle'),
      [item.mediaId],
    ),
  )
  const transcriptProgress = useMediaLibraryStore(
    useCallback(
      (s) => (item.mediaId ? (s.transcriptProgress.get(item.mediaId) ?? null) : null),
      [item.mediaId],
    ),
  )
  const mediaForItem = useMediaLibraryStore(
    useCallback((s) => (item.mediaId ? (s.mediaById[item.mediaId] ?? null) : null), [item.mediaId]),
  )
  const mediaFileName = mediaForItem?.fileName ?? ''
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const mediaHasTranscript = transcriptStatus === 'ready'

  const linkedVideoCaptionOwner = useMemo(() => {
    if (item.type !== 'audio' || !item.mediaId) {
      return null
    }
    return (
      linkedItemsForCaptionOwnership.find(
        (linkedItem) =>
          linkedItem.id !== item.id &&
          linkedItem.type === 'video' &&
          linkedItem.mediaId === item.mediaId,
      ) ?? null
    )
  }, [item.id, item.mediaId, item.type, linkedItemsForCaptionOwnership])

  const canManageCaptions =
    !!item.mediaId &&
    !isBroken &&
    item.isReversed !== true &&
    (item.type === 'video' || (item.type === 'audio' && linkedVideoCaptionOwner === null))

  const canExtractEmbeddedSubtitles = !!(
    mediaForItem &&
    !isBroken &&
    item.isReversed !== true &&
    isEmbeddedSubtitleContainer(mediaForItem.fileName, mediaForItem.mimeType)
  )

  const handleExtractEmbeddedSubtitles = useCallback(async () => {
    if (!mediaForItem) return
    const mediaStore = useMediaLibraryStore.getState()
    try {
      const handle = mediaForItem.fileHandle
      if (mediaForItem.storageType === 'handle' && handle) {
        const granted =
          (await handle.requestPermission({ mode: 'read' }).catch(() => 'denied' as const)) ===
          'granted'
        if (!granted) {
          mediaStore.showNotification?.({
            type: 'error',
            message: `DroneClean Studio needs permission to read "${mediaForItem.fileName}" before extracting subtitles.`,
          })
          return
        }
        const blob = await handle.getFile()
        useEmbeddedSubtitlePickerStore.getState().open(mediaForItem, blob)
        return
      }
      const { mediaLibraryService } = await importMediaLibraryService()
      const blob = await mediaLibraryService.getMediaFile(mediaForItem.id)
      if (!blob) {
        mediaStore.showNotification?.({
          type: 'error',
          message: `DroneClean Studio could not load "${mediaForItem.fileName}".`,
        })
        return
      }
      useEmbeddedSubtitlePickerStore.getState().open(mediaForItem, blob)
    } catch (error) {
      mediaStore.showNotification?.({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : `Failed to open "${mediaForItem.fileName}" for subtitle extraction.`,
      })
    }
  }, [mediaForItem])

  const hasConsolidatablePerCueCaptions = useItemsStore(
    useCallback(
      (s) => item.isReversed !== true && selectConsolidatableCaptionClipIds(s).has(item.id),
      [item.id, item.isReversed],
    ),
  )

  const handleConsolidateCaptionsToSegment = useCallback(async () => {
    const mediaStore = useMediaLibraryStore.getState()
    try {
      const { subtitleSidecarService } =
        await import('@/features/timeline/deps/subtitle-sidecar-service')
      const result = subtitleSidecarService.consolidatePerCueCaptionsToSegments({
        clipId: item.id,
      })
      mediaStore.showNotification?.({
        type: 'success',
        message:
          result.segmentsCreated > 0
            ? `Consolidated ${result.cuesConsolidated} caption${result.cuesConsolidated === 1 ? '' : 's'} into ${result.segmentsCreated} segment${result.segmentsCreated === 1 ? '' : 's'}.`
            : 'No per-cue captions found for this clip.',
      })
    } catch (error) {
      mediaStore.showNotification?.({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to consolidate captions to segment.',
      })
    }
  }, [item.id])

  const openDialog = useCallback(() => {
    setDialogError(null)
    setDialogOpen(true)
  }, [])

  const handleGenerateCaptions = useCallback(() => {
    if (!item.mediaId || !canManageCaptions) {
      return
    }

    const mediaId = item.mediaId
    const clipId = item.id
    const replaceExisting = hasGeneratedCaptions
    const mediaStore = useMediaLibraryStore.getState()

    void (async () => {
      try {
        const transcript = await mediaTranscriptionService.getTranscript(mediaId)
        if (!transcript) {
          // No transcript yet: the dialog asks for the model/language first, and its
          // completion inserts the caption items.
          openDialog()
          return
        }

        await mediaTranscriptionService.insertTranscriptAsCaptions(mediaId, {
          clipIds: [clipId],
          replaceExisting,
          selectUpdatedClips: true,
        })
        mediaStore.showNotification?.({
          type: 'success',
          message: i18n.t(
            replaceExisting
              ? 'timeline.captions.updatedFromTranscript'
              : 'timeline.captions.addedFromTranscript',
          ),
        })
      } catch (error) {
        mediaStore.showNotification?.({
          type: 'error',
          message:
            error instanceof Error
              ? error.message
              : i18n.t('timeline.captions.failedGenerateSegment'),
        })
      }
    })()
  }, [canManageCaptions, hasGeneratedCaptions, item.id, item.mediaId, openDialog])

  return {
    canManageCaptions,
    canExtractEmbeddedSubtitles,
    hasConsolidatablePerCueCaptions,
    mediaHasTranscript,
    transcriptStatus,
    transcriptProgress,
    mediaFileName,
    dialogOpen,
    openDialog,
    setDialogOpen,
    setDialogError,
    dialogError,
    handleGenerateCaptions,
    handleExtractEmbeddedSubtitles: canExtractEmbeddedSubtitles
      ? handleExtractEmbeddedSubtitles
      : undefined,
    handleConsolidateCaptionsToSegment: hasConsolidatablePerCueCaptions
      ? handleConsolidateCaptionsToSegment
      : undefined,
  }
}
