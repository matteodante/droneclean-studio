// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import type { AudioItem } from '@/types/timeline'

const mocks = vi.hoisted(() => ({
  getTranscript: vi.fn(),
  getPendingDefaultTranscriptionDownload: vi.fn(),
}))

vi.mock('@/features/timeline/deps/media-transcription-service', () => ({
  mediaTranscriptionService: { getTranscript: mocks.getTranscript },
  getPendingDefaultTranscriptionDownload: mocks.getPendingDefaultTranscriptionDownload,
}))

import { getPendingTranscriptionDownload } from './transcription-download-gate'

const download = { modelLabel: 'Parakeet', sizeLabel: '1.24 GB' }

function audioItem(): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 't',
    from: 0,
    durationInFrames: 30,
    label: 'a',
    src: 'blob:a',
    mediaId: 'media-1',
  } as AudioItem
}

describe('getPendingTranscriptionDownload', () => {
  beforeEach(() => {
    mocks.getTranscript.mockReset()
    mocks.getPendingDefaultTranscriptionDownload.mockReset()
    mocks.getPendingDefaultTranscriptionDownload.mockResolvedValue(download)
    useItemsStore.getState().setItems([audioItem()])
  })

  it('reports the download when the clip has no transcript and the model is missing', async () => {
    mocks.getTranscript.mockResolvedValue(null)
    await expect(getPendingTranscriptionDownload(['audio-1'], { needsWords: true })).resolves.toBe(
      download,
    )
  })

  it('reports nothing when the transcript already has words', async () => {
    mocks.getTranscript.mockResolvedValue({
      segments: [{ text: 'um', start: 0, end: 1, words: [{ text: 'um', start: 0, end: 1 }] }],
    })
    await expect(
      getPendingTranscriptionDownload(['audio-1'], { needsWords: true }),
    ).resolves.toBeNull()
  })

  it('needs words only when asked: a segment-only transcript is enough for silence', async () => {
    mocks.getTranscript.mockResolvedValue({ segments: [{ text: 'hi', start: 0, end: 1 }] })
    await expect(
      getPendingTranscriptionDownload(['audio-1'], { needsWords: false }),
    ).resolves.toBeNull()
    await expect(getPendingTranscriptionDownload(['audio-1'], { needsWords: true })).resolves.toBe(
      download,
    )
  })

  it('reports nothing when the model is already cached', async () => {
    mocks.getTranscript.mockResolvedValue(null)
    mocks.getPendingDefaultTranscriptionDownload.mockResolvedValue(null)
    await expect(
      getPendingTranscriptionDownload(['audio-1'], { needsWords: true }),
    ).resolves.toBeNull()
  })
})
