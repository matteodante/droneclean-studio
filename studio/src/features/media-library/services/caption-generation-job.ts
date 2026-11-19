import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage'
import { i18n } from '@/i18n'
import {
  isTranscriptionOutOfMemoryError,
  TRANSCRIPTION_OOM_HINT,
} from '@/shared/utils/transcription-cancellation'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { mediaTranscriptionService } from './media-transcription-service'
import { runMediaTranscriptionJob } from './media-transcription-runner'
import type { MediaLibraryNotification } from '../types'

export interface GenerateCaptionItemsOptions {
  /** Model to transcribe with when the media has no usable transcript yet. */
  model: MediaTranscriptModel
  quantization?: MediaTranscriptQuantization
  language?: string
  /** Re-transcribe even when a transcript exists (the dialog always asks for a fresh one). */
  forceTranscription?: boolean
  /** Replace the clip's existing transcript caption items. */
  replaceExisting?: boolean
  /** Called after the caption items were inserted. */
  onSuccess?: () => void
  /** Called with the failure; the caller decides how to show it. */
  onError?: (error: unknown) => void
}

/**
 * "Generate Captions" / "Regenerate Captions" from the clip menu: make sure the media has a
 * transcript, then insert real caption items for the clip, replacing its previous transcript
 * captions when asked. Shared by the menu path (transcript already stored) and the dialog path
 * (the user picked a model), so both end with the same one-undo insertion.
 */
export async function generateCaptionItemsForClip(
  mediaId: string,
  clipId: string,
  options: GenerateCaptionItemsOptions,
): Promise<void> {
  const store = useMediaLibraryStore.getState()
  const { model, quantization, language, forceTranscription = false, replaceExisting = false } = options

  try {
    const existingTranscript = await mediaTranscriptionService.getTranscript(mediaId)
    const needsTranscription =
      forceTranscription || !existingTranscript || existingTranscript.model !== model

    if (needsTranscription) {
      const result = await runMediaTranscriptionJob(mediaId, { model, quantization, language })
      if (result.status === 'cancelled') {
        return
      }
    } else {
      store.setTranscriptStatus(mediaId, 'ready')
      store.clearTranscriptProgress(mediaId)
    }

    await mediaTranscriptionService.insertTranscriptAsCaptions(mediaId, {
      clipIds: [clipId],
      replaceExisting,
      selectUpdatedClips: true,
    })

    store.showNotification({
      type: 'success',
      message: i18n.t(
        replaceExisting
          ? 'timeline.captions.updatedFromTranscript'
          : 'timeline.captions.addedFromTranscript',
      ),
    })
    options.onSuccess?.()
  } catch (error) {
    store.showNotification({
      type: 'error',
      message: captionFailureMessage(error),
    })
    options.onError?.(error)
  }
}

function captionFailureMessage(error: unknown): MediaLibraryNotification['message'] {
  if (isTranscriptionOutOfMemoryError(error)) {
    return TRANSCRIPTION_OOM_HINT
  }
  return error instanceof Error
    ? error.message
    : i18n.t('timeline.captions.failedGenerateSegment')
}
