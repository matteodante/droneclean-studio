import { memo } from 'react'
import { cancelMediaTranscriptionJob } from '@/features/timeline/deps/media-transcription-service'
import {
  TranscribeDialog,
  type TranscribeDialogValues,
} from '@/features/timeline/deps/transcribe-dialog'
import {
  getTranscriptionProgressDetail,
  getTranscriptionProgressLabel,
  isIndeterminateTranscriptionProgress,
} from '@/shared/utils/transcription-progress'
import {
  isTranscriptionOutOfMemoryError,
  TRANSCRIPTION_OOM_HINT,
} from '@/shared/utils/transcription-cancellation'
import type { CaptionDialogState } from './use-caption-dialog-state'

export interface CaptionGenerationCallbacks {
  /** Called after the captions were inserted, so the dialog can close. */
  onSuccess?: () => void
  /** Called with the failure; the dialog stays open and shows it. */
  onError?: (error: unknown) => void
}

interface TranscribeDialogControllerProps {
  itemMediaId: string | undefined
  hasGeneratedCaptions: boolean
  caption: CaptionDialogState
  onGenerate: (
    values: TranscribeDialogValues,
    hasExistingCaptions: boolean,
    callbacks?: CaptionGenerationCallbacks,
  ) => void
}

export const TranscribeDialogController = memo(function TranscribeDialogController({
  itemMediaId,
  hasGeneratedCaptions,
  caption,
  onGenerate,
}: TranscribeDialogControllerProps) {
  if (!caption.canManageCaptions || !itemMediaId) {
    return null
  }

  const { dialogOpen, setDialogOpen, mediaFileName, mediaHasTranscript, transcriptStatus, transcriptProgress, dialogError, setDialogError } = caption

  return (
    <TranscribeDialog
      open={dialogOpen}
      onOpenChange={(next) => {
        if (!next) setDialogError(null)
        setDialogOpen(next)
      }}
      fileName={mediaFileName}
      hasTranscript={mediaHasTranscript}
      isRunning={transcriptStatus === 'queued' || transcriptStatus === 'transcribing'}
      // The bar tracks the *current stage*, not the whole job. Overall percent (which the
      // collapsed media-library bar still uses, having room for only one number) would crawl
      // across the first tenth of the track for a multi-minute download and read as a hang.
      progressPercent={transcriptProgress ? Math.round(transcriptProgress.progress * 100) : null}
      progressIndeterminate={
        transcriptProgress ? isIndeterminateTranscriptionProgress(transcriptProgress) : false
      }
      progressLabel={
        transcriptProgress ? getTranscriptionProgressLabel(transcriptProgress) : 'Transcribing...'
      }
      progressDetail={
        transcriptProgress ? getTranscriptionProgressDetail(transcriptProgress) : null
      }
      errorMessage={dialogError}
      onStart={(values: TranscribeDialogValues) => {
        setDialogError(null)
        const handleError = (error: unknown) => {
          const baseMessage = error instanceof Error ? error.message : 'Failed to generate captions'
          setDialogError(
            isTranscriptionOutOfMemoryError(error) ? TRANSCRIPTION_OOM_HINT : baseMessage,
          )
        }
        try {
          onGenerate(values, hasGeneratedCaptions, {
            onError: handleError,
            // The dialog closes only on a completed insertion. A failure or a user Stop
            // leaves it open, showing the error or the model picker.
            onSuccess: () => setDialogOpen(false),
          })
        } catch (error) {
          handleError(error)
        }
      }}
      onCancel={() => {
        cancelMediaTranscriptionJob(itemMediaId)
      }}
    />
  )
})
