import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'

const mediaStoreState = vi.hoisted(() => ({
  mediaById: {} as Record<string, unknown>,
  transcriptStatus: new Map<string, string>(),
  transcriptProgress: new Map<string, unknown>(),
  showNotification: vi.fn(),
}))

const getTranscriptMock = vi.hoisted(() => vi.fn())
const insertTranscriptAsCaptionsMock = vi.hoisted(() => vi.fn())

vi.mock('@/features/timeline/deps/media-library-store', () => {
  const useMediaLibraryStore = (selector: (state: typeof mediaStoreState) => unknown) =>
    selector(mediaStoreState)
  return {
    useMediaLibraryStore: Object.assign(useMediaLibraryStore, {
      getState: () => mediaStoreState,
    }),
  }
})

vi.mock('@/features/timeline/deps/media-transcription-service', () => ({
  mediaTranscriptionService: {
    getTranscript: getTranscriptMock,
    insertTranscriptAsCaptions: insertTranscriptAsCaptionsMock,
  },
}))

vi.mock('@/features/timeline/deps/media-library-service', () => ({
  importMediaLibraryService: vi.fn(),
  useEmbeddedSubtitlePickerStore: { getState: () => ({ open: vi.fn() }) },
}))

vi.mock('../../stores/items-store', () => ({
  useItemsStore: (selector: (state: { items: never[] }) => unknown) => selector({ items: [] }),
}))

vi.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
}))

import { useCaptionDialogState } from './use-caption-dialog-state'

const clip: VideoItem = {
  id: 'clip-1',
  type: 'video',
  trackId: 'track-video',
  from: 0,
  durationInFrames: 90,
  label: 'speech.wav',
  mediaId: 'media-1',
  src: 'blob:test',
  sourceStart: 0,
  sourceEnd: 90,
  sourceDuration: 90,
  sourceFps: 30,
  speed: 1,
}

const transcript = {
  id: 'media-1',
  mediaId: 'media-1',
  model: 'whisper-base' as const,
  language: 'en',
  quantization: 'q8' as const,
  text: 'Hello there',
  segments: [{ text: 'Hello there', start: 0, end: 2 }],
  createdAt: 1,
  updatedAt: 1,
}

function renderCaptionState(hasGeneratedCaptions = false) {
  return renderHook(() =>
    useCaptionDialogState({
      item: clip,
      isBroken: false,
      linkedItemsForCaptionOwnership: [],
      hasGeneratedCaptions,
    }),
  )
}

describe('useCaptionDialogState.generateCaptions', () => {
  beforeEach(() => {
    mediaStoreState.mediaById = {
      'media-1': { id: 'media-1', fileName: 'speech.wav', mimeType: 'audio/wav' },
    }
    mediaStoreState.transcriptStatus = new Map<string, string>()
    mediaStoreState.transcriptProgress = new Map<string, unknown>()
    mediaStoreState.showNotification.mockClear()
    getTranscriptMock.mockReset()
    insertTranscriptAsCaptionsMock.mockReset()
    insertTranscriptAsCaptionsMock.mockResolvedValue({
      insertedItemCount: 2,
      removedItemCount: 0,
    })
  })

  it('inserts caption items from an existing transcript without opening the dialog', async () => {
    getTranscriptMock.mockResolvedValue(transcript)
    const { result } = renderCaptionState(false)

    act(() => {
      result.current.handleGenerateCaptions()
    })

    await waitFor(() => expect(insertTranscriptAsCaptionsMock).toHaveBeenCalledTimes(1))
    expect(insertTranscriptAsCaptionsMock).toHaveBeenCalledWith('media-1', {
      clipIds: ['clip-1'],
      replaceExisting: false,
      selectUpdatedClips: true,
    })
    expect(result.current.dialogOpen).toBe(false)
    expect(mediaStoreState.showNotification).toHaveBeenCalledWith({
      type: 'success',
      message: 'timeline.captions.addedFromTranscript',
    })
  })

  it('replaces the clip caption items when the clip already has captions', async () => {
    getTranscriptMock.mockResolvedValue(transcript)
    const { result } = renderCaptionState(true)

    act(() => {
      result.current.handleGenerateCaptions()
    })

    await waitFor(() => expect(insertTranscriptAsCaptionsMock).toHaveBeenCalledTimes(1))
    expect(insertTranscriptAsCaptionsMock).toHaveBeenCalledWith(
      'media-1',
      expect.objectContaining({ replaceExisting: true }),
    )
    expect(mediaStoreState.showNotification).toHaveBeenCalledWith({
      type: 'success',
      message: 'timeline.captions.updatedFromTranscript',
    })
  })

  it('opens the transcription dialog first when the media has no transcript', async () => {
    getTranscriptMock.mockResolvedValue(null)
    const { result } = renderCaptionState(false)

    act(() => {
      result.current.handleGenerateCaptions()
    })

    await waitFor(() => expect(result.current.dialogOpen).toBe(true))
    expect(insertTranscriptAsCaptionsMock).not.toHaveBeenCalled()
  })

  it('reports an insertion failure instead of failing silently', async () => {
    getTranscriptMock.mockResolvedValue(transcript)
    insertTranscriptAsCaptionsMock.mockRejectedValue(new Error('No transcript found'))
    const { result } = renderCaptionState(false)

    act(() => {
      result.current.handleGenerateCaptions()
    })

    await waitFor(() =>
      expect(mediaStoreState.showNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 'No transcript found',
      }),
    )
  })
})
