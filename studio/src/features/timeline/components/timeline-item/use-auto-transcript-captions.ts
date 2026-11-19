import { useEffect, useRef } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { mediaTranscriptionService } from '../../deps/media-transcription-service'
import { useMediaLibraryStore } from '../../deps/media-library-store'
import { i18n } from '@/i18n'
import { createLogger } from '@/shared/logging/logger'
import type { CaptionDialogState } from './use-caption-dialog-state'

const logger = createLogger('AutoTranscriptCaptions')

interface UseAutoTranscriptCaptionsParams {
  item: TimelineItemType
  caption: CaptionDialogState
  hasGeneratedCaptions: boolean
  isBroken: boolean
}

/**
 * Auto-enables transcript-backed captions for a video/audio clip the first time
 * its media has a transcript and no captions yet. Runs once per item+media pair
 * (tracked by a ref). A failure is reported with a toast naming the clip: the
 * user never sees captions silently missing, and "Generate Captions" remains the
 * explicit way to insert real caption items.
 */
export function useAutoTranscriptCaptions({
  item,
  caption,
  hasGeneratedCaptions,
  isBroken,
}: UseAutoTranscriptCaptionsParams): void {
  const attemptRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      !caption.canManageCaptions ||
      !caption.mediaHasTranscript ||
      hasGeneratedCaptions ||
      isBroken ||
      (item.type !== 'video' && item.type !== 'audio') ||
      !item.mediaId
    ) {
      return
    }

    const attemptKey = `${item.id}:${item.mediaId}`
    if (attemptRef.current === attemptKey) {
      return
    }
    attemptRef.current = attemptKey

    void mediaTranscriptionService
      .enableTranscriptCaptions(item.mediaId, {
        clipIds: [item.id],
        replaceExisting: false,
        selectUpdatedClips: false,
      })
      .catch((error: unknown) => {
        logger.warn(
          `Transcript captions failed for clip "${item.label}" (${item.id}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        useMediaLibraryStore.getState().showNotification?.({
          type: 'error',
          message: i18n.t('timeline.captions.autoFailed', { clip: item.label }),
        })
      })
  }, [
    caption.canManageCaptions,
    caption.mediaHasTranscript,
    hasGeneratedCaptions,
    isBroken,
    item.id,
    item.label,
    item.mediaId,
    item.type,
  ])
}
