import {
  getPendingDefaultTranscriptionDownload,
  mediaTranscriptionService,
  type PendingTranscriptionDownload,
} from '@/features/timeline/deps/media-transcription-service'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { isAudioVideoItem } from '@/features/timeline/utils/removal-preview-overlays'

export type { PendingTranscriptionDownload }

function getMediaIdsForItems(itemIds: readonly string[]): string[] {
  const itemsById = useItemsStore.getState().itemById
  return Array.from(
    new Set(
      itemIds
        .map((id) => itemsById[id])
        .filter(isAudioVideoItem)
        .map((item) => item.mediaId),
    ),
  )
}

/**
 * What a transcription-based analysis of these items would download on its own
 * the moment it starts: the default model's first-use download, when some item
 * has no usable transcript yet and the model is not cached. Null means the run
 * would start no download, so the dialog may analyse at once.
 */
export async function getPendingTranscriptionDownload(
  itemIds: readonly string[],
  options: { needsWords: boolean },
): Promise<PendingTranscriptionDownload | null> {
  const mediaIds = getMediaIdsForItems(itemIds)
  const transcripts = await Promise.all(
    mediaIds.map((mediaId) => mediaTranscriptionService.getTranscript(mediaId).catch(() => null)),
  )
  const allTranscribed = transcripts.every((transcript) =>
    options.needsWords
      ? transcript?.segments.some((segment) => (segment.words?.length ?? 0) > 0)
      : (transcript?.segments.length ?? 0) > 0,
  )
  if (allTranscribed) return null
  return getPendingDefaultTranscriptionDownload()
}
