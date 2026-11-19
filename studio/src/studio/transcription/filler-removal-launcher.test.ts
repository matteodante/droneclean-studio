// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useFillerRemovalDialogStore } from '@/features/timeline/stores/filler-removal-dialog-store'

const mocks = vi.hoisted(() => ({
  getPendingTranscriptionDownload: vi.fn(),
  analyzeFillerWordsForItems: vi.fn(),
  applyFillerPreviewOverlays: vi.fn(),
}))

vi.mock('./transcription-download-gate', () => ({
  getPendingTranscriptionDownload: mocks.getPendingTranscriptionDownload,
}))

vi.mock('@/features/timeline/utils/filler-word-removal-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/timeline/utils/filler-word-removal-preview')>()
  return {
    ...actual,
    analyzeFillerWordsForItems: mocks.analyzeFillerWordsForItems,
    applyFillerPreviewOverlays: mocks.applyFillerPreviewOverlays,
  }
})

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }))

import { launchFillerRemoval } from './filler-removal-launcher'

describe('launchFillerRemoval', () => {
  beforeEach(() => {
    mocks.getPendingTranscriptionDownload.mockReset()
    mocks.analyzeFillerWordsForItems.mockReset()
    mocks.applyFillerPreviewOverlays.mockReset()
    useFillerRemovalDialogStore.getState().close()
  })

  it('opens the panel without transcribing when the model would have to be downloaded', async () => {
    mocks.getPendingTranscriptionDownload.mockResolvedValue({
      modelLabel: 'Parakeet',
      sizeLabel: '1.24 GB',
    })

    await launchFillerRemoval(['audio-1'])

    expect(mocks.analyzeFillerWordsForItems).not.toHaveBeenCalled()
    const state = useFillerRemovalDialogStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.pendingDownload).toEqual({ modelLabel: 'Parakeet', sizeLabel: '1.24 GB' })
  })

  it('analyses first, as before, when nothing has to be downloaded', async () => {
    mocks.getPendingTranscriptionDownload.mockResolvedValue(null)
    mocks.analyzeFillerWordsForItems.mockResolvedValue({ 'media-1': [{ start: 1, end: 2, text: 'um' }] })
    mocks.applyFillerPreviewOverlays.mockReturnValue({ rangeCount: 1, totalSeconds: 1 })

    await launchFillerRemoval(['audio-1'])

    expect(mocks.analyzeFillerWordsForItems).toHaveBeenCalledTimes(1)
    const state = useFillerRemovalDialogStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.pendingDownload).toBeNull()
    expect(state.summary.rangeCount).toBe(1)
  })
})
