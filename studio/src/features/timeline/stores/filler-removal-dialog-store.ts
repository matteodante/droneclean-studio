import { create } from 'zustand'
import type { PendingTranscriptionDownload } from '@/studio/transcription/transcription-download-gate'
import {
  DEFAULT_FILLER_REMOVAL_SETTINGS,
  type FillerPreviewSummary,
  type FillerRangesByMediaId,
  type FillerRemovalSettings,
} from '../utils/filler-word-removal-preview'

interface FillerRemovalDialogState {
  isOpen: boolean
  itemIds: string[]
  settings: FillerRemovalSettings
  rangesByMediaId: FillerRangesByMediaId
  summary: FillerPreviewSummary
  /** Set when the first analysis would start a model download the user has not asked for yet. */
  pendingDownload: PendingTranscriptionDownload | null
}

interface FillerRemovalDialogActions {
  open: (request: {
    itemIds: string[]
    settings?: FillerRemovalSettings
    rangesByMediaId?: FillerRangesByMediaId
    summary?: FillerPreviewSummary
    pendingDownload?: PendingTranscriptionDownload | null
  }) => void
  updatePreview: (request: {
    settings: FillerRemovalSettings
    rangesByMediaId: FillerRangesByMediaId
    summary: FillerPreviewSummary
  }) => void
  close: () => void
}

export const useFillerRemovalDialogStore = create<
  FillerRemovalDialogState & FillerRemovalDialogActions
>((set) => ({
  isOpen: false,
  itemIds: [],
  settings: DEFAULT_FILLER_REMOVAL_SETTINGS,
  rangesByMediaId: {},
  summary: { rangeCount: 0, totalSeconds: 0 },
  pendingDownload: null,

  open: (request) =>
    set({
      isOpen: true,
      itemIds: request.itemIds,
      settings: request.settings ?? DEFAULT_FILLER_REMOVAL_SETTINGS,
      rangesByMediaId: request.rangesByMediaId ?? {},
      summary: request.summary ?? { rangeCount: 0, totalSeconds: 0 },
      pendingDownload: request.pendingDownload ?? null,
    }),

  updatePreview: (request) =>
    set({
      settings: request.settings,
      rangesByMediaId: request.rangesByMediaId,
      summary: request.summary,
      pendingDownload: null,
    }),

  close: () =>
    set({
      isOpen: false,
      itemIds: [],
      rangesByMediaId: {},
      summary: { rangeCount: 0, totalSeconds: 0 },
      pendingDownload: null,
    }),
}))
