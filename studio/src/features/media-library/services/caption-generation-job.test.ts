import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaTranscript } from '@/types/storage'

const getTranscriptMock = vi.hoisted(() => vi.fn())
const insertTranscriptAsCaptionsMock = vi.hoisted(() => vi.fn())
const runMediaTranscriptionJobMock = vi.hoisted(() => vi.fn())
const storeMock = vi.hoisted(() => ({
  showNotification: vi.fn(),
  setTranscriptStatus: vi.fn(),
  clearTranscriptProgress: vi.fn(),
}))

vi.mock('./media-transcription-service', () => ({
  mediaTranscriptionService: {
    getTranscript: getTranscriptMock,
    insertTranscriptAsCaptions: insertTranscriptAsCaptionsMock,
  },
}))

vi.mock('./media-transcription-runner', () => ({
  runMediaTranscriptionJob: runMediaTranscriptionJobMock,
}))

vi.mock('../stores/media-library-store', () => ({
  useMediaLibraryStore: { getState: () => storeMock },
}))

vi.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
}))

import { generateCaptionItemsForClip } from './caption-generation-job'

const transcript: MediaTranscript = {
  id: 'media-1',
  mediaId: 'media-1',
  model: 'whisper-base',
  language: 'en',
  quantization: 'q8',
  text: 'Hello there',
  segments: [{ text: 'Hello there', start: 0, end: 2 }],
  createdAt: 1,
  updatedAt: 1,
}

describe('generateCaptionItemsForClip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertTranscriptAsCaptionsMock.mockResolvedValue({ insertedItemCount: 1, removedItemCount: 0 })
    runMediaTranscriptionJobMock.mockResolvedValue({ status: 'completed', transcript })
  })

  it('inserts caption items straight from a stored transcript', async () => {
    getTranscriptMock.mockResolvedValue(transcript)
    const onSuccess = vi.fn()

    await generateCaptionItemsForClip('media-1', 'clip-1', {
      model: 'whisper-base',
      onSuccess,
    })

    expect(runMediaTranscriptionJobMock).not.toHaveBeenCalled()
    expect(insertTranscriptAsCaptionsMock).toHaveBeenCalledWith('media-1', {
      clipIds: ['clip-1'],
      replaceExisting: false,
      selectUpdatedClips: true,
    })
    expect(storeMock.showNotification).toHaveBeenCalledWith({
      type: 'success',
      message: 'timeline.captions.addedFromTranscript',
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('transcribes first when the media has no transcript, then inserts', async () => {
    getTranscriptMock.mockResolvedValue(null)

    await generateCaptionItemsForClip('media-1', 'clip-1', {
      model: 'parakeet-tdt-v3',
      language: 'en',
      replaceExisting: true,
    })

    expect(runMediaTranscriptionJobMock).toHaveBeenCalledWith('media-1', {
      model: 'parakeet-tdt-v3',
      quantization: undefined,
      language: 'en',
    })
    expect(insertTranscriptAsCaptionsMock).toHaveBeenCalledWith(
      'media-1',
      expect.objectContaining({ replaceExisting: true }),
    )
    expect(storeMock.showNotification).toHaveBeenCalledWith({
      type: 'success',
      message: 'timeline.captions.updatedFromTranscript',
    })
  })

  it('does not insert anything when the transcription is cancelled', async () => {
    getTranscriptMock.mockResolvedValue(null)
    runMediaTranscriptionJobMock.mockResolvedValue({ status: 'cancelled' })
    const onSuccess = vi.fn()
    const onError = vi.fn()

    await generateCaptionItemsForClip('media-1', 'clip-1', {
      model: 'whisper-base',
      onSuccess,
      onError,
    })

    expect(insertTranscriptAsCaptionsMock).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a failure to the caller and with a notification', async () => {
    getTranscriptMock.mockResolvedValue(transcript)
    insertTranscriptAsCaptionsMock.mockRejectedValue(new Error('No transcript found'))
    const onSuccess = vi.fn()
    const onError = vi.fn()

    await generateCaptionItemsForClip('media-1', 'clip-1', {
      model: 'whisper-base',
      onSuccess,
      onError,
    })

    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(storeMock.showNotification).toHaveBeenCalledWith({
      type: 'error',
      message: 'No transcript found',
    })
  })

  it('shows the out-of-memory hint for an allocation failure', async () => {
    getTranscriptMock.mockResolvedValue(transcript)
    insertTranscriptAsCaptionsMock.mockRejectedValue(new Error('OOM while allocating buffer'))

    await generateCaptionItemsForClip('media-1', 'clip-1', { model: 'whisper-base' })

    const notification = storeMock.showNotification.mock.calls[0]?.[0] as { message: string }
    expect(notification.message).not.toBe('OOM while allocating buffer')
  })
})
