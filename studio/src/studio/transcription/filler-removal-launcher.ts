import { i18n } from '@/i18n'
import { toast } from 'sonner'
import { useFillerRemovalDialogStore } from '@/features/timeline/stores/filler-removal-dialog-store'
import {
  analyzeFillerWordsForItems,
  applyFillerPreviewOverlays,
  DEFAULT_FILLER_REMOVAL_SETTINGS,
} from '@/features/timeline/utils/filler-word-removal-preview'
import { getPendingTranscriptionDownload } from './transcription-download-gate'

/**
 * Opens the filler-word panel for these items. When the clip has no word-level
 * transcript yet and the default transcription model is not downloaded, the
 * panel opens empty and says which model it needs and how big it is; the
 * download starts only when the user presses Update Preview. Otherwise the clip
 * is analysed first, as before.
 */
export async function launchFillerRemoval(targetItemIds: string[]): Promise<void> {
  const pendingDownload = await getPendingTranscriptionDownload(targetItemIds, {
    needsWords: true,
  })
  if (pendingDownload) {
    useFillerRemovalDialogStore.getState().open({
      itemIds: targetItemIds,
      settings: DEFAULT_FILLER_REMOVAL_SETTINGS,
      pendingDownload,
    })
    return
  }

  const rangesByMediaId = await analyzeFillerWordsForItems(
    targetItemIds,
    DEFAULT_FILLER_REMOVAL_SETTINGS,
  )
  const summary = applyFillerPreviewOverlays(targetItemIds, rangesByMediaId)

  if (summary.rangeCount === 0) {
    toast.info(i18n.t('timeline.fillerRemoval.noRemovableDetectedShort'))
    return
  }

  useFillerRemovalDialogStore.getState().open({
    itemIds: targetItemIds,
    settings: DEFAULT_FILLER_REMOVAL_SETTINGS,
    rangesByMediaId,
    summary,
  })
}
