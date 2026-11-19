import type { MediaTranscriptModel } from '@/types/storage'
import { hasCachedModelEntries, TRANSFORMERS_CACHE_NAME } from '@/shared/utils/local-model-cache'
import { ONNX_MODEL_CACHE_NAME } from '@/shared/utils/onnx-model-cache'
import { BROWSER_WHISPER_MODEL_LABELS } from '@/shared/utils/browser-whisper-models'
import { DEFAULT_WHISPER_MODEL } from '@/shared/utils/whisper-settings'
import { useSettingsStore } from '@/features/media-library/deps/settings-contract'

export interface FirstUseDownload {
  cacheName: string
  cacheMatchFragments: readonly string[]
  sizeLabel: string
}

/**
 * Measured first-use downloads for the engines a user is expected to start with.
 * The other Whisper tiers have no measured size, so the UI stays quiet rather
 * than quoting an estimate as a fact. Parakeet's files live in the onnx-model
 * cache; Whisper's are written by transformers.js.
 */
export const TRANSCRIPTION_FIRST_USE_DOWNLOADS: Partial<
  Record<MediaTranscriptModel, FirstUseDownload>
> = {
  'parakeet-tdt-v3': {
    cacheName: ONNX_MODEL_CACHE_NAME,
    cacheMatchFragments: ['/parakeet-tdt-0.6b-v3-optimized-onnx/'],
    sizeLabel: '1.24 GB',
  },
  'whisper-base': {
    cacheName: TRANSFORMERS_CACHE_NAME,
    cacheMatchFragments: ['/onnx-community/whisper-base'],
    sizeLabel: '209 MB',
  },
}

export interface PendingTranscriptionDownload {
  modelLabel: string
  sizeLabel: string
}

/**
 * The download a transcription run with the default model would start right now,
 * or null when the model is already in Cache Storage (or has no measured size).
 */
export async function getPendingDefaultTranscriptionDownload(): Promise<PendingTranscriptionDownload | null> {
  const model = useSettingsStore.getState().defaultWhisperModel ?? DEFAULT_WHISPER_MODEL
  const download = TRANSCRIPTION_FIRST_USE_DOWNLOADS[model]
  if (!download) return null
  const cached = await hasCachedModelEntries(download.cacheName, download.cacheMatchFragments)
  if (cached) return null
  return { modelLabel: BROWSER_WHISPER_MODEL_LABELS[model], sizeLabel: download.sizeLabel }
}
