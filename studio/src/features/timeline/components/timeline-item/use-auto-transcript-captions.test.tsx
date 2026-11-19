import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import type { CaptionDialogState } from './use-caption-dialog-state'

const enableTranscriptCaptionsMock = vi.hoisted(() => vi.fn())
const showNotificationMock = vi.hoisted(() => vi.fn())

vi.mock('../../deps/media-transcription-service', () => ({
  mediaTranscriptionService: {
    enableTranscriptCaptions: enableTranscriptCaptionsMock,
  },
}))

vi.mock('../../deps/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => ({ showNotification: showNotificationMock }),
  },
}))

vi.mock('@/i18n', () => ({
  i18n: {
    t: (key: string, options?: { clip?: string }) => `${key}|${options?.clip ?? ''}`,
  },
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({ warn: vi.fn() }),
}))

import { useAutoTranscriptCaptions } from './use-auto-transcript-captions'

const item: TimelineItemType = {
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

const caption = {
  canManageCaptions: true,
  mediaHasTranscript: true,
} as CaptionDialogState

describe('useAutoTranscriptCaptions', () => {
  beforeEach(() => {
    enableTranscriptCaptionsMock.mockReset()
    showNotificationMock.mockClear()
  })

  it('reports a failure with a toast naming the clip', async () => {
    enableTranscriptCaptionsMock.mockRejectedValue(
      new Error('Select a clip for this media, or place one on the timeline first'),
    )

    renderHook(() =>
      useAutoTranscriptCaptions({
        item,
        caption,
        hasGeneratedCaptions: false,
        isBroken: false,
      }),
    )

    await waitFor(() =>
      expect(showNotificationMock).toHaveBeenCalledWith({
        type: 'error',
        message: 'timeline.captions.autoFailed|speech.wav',
      }),
    )
  })

  it('enables the clip transcript captions once when it succeeds', async () => {
    enableTranscriptCaptionsMock.mockResolvedValue({ updatedClipCount: 1, removedItemCount: 0 })

    renderHook(() =>
      useAutoTranscriptCaptions({
        item,
        caption,
        hasGeneratedCaptions: false,
        isBroken: false,
      }),
    )

    await waitFor(() => expect(enableTranscriptCaptionsMock).toHaveBeenCalledTimes(1))
    expect(enableTranscriptCaptionsMock).toHaveBeenCalledWith('media-1', {
      clipIds: ['clip-1'],
      replaceExisting: false,
      selectUpdatedClips: false,
    })
    expect(showNotificationMock).not.toHaveBeenCalled()
  })
})
