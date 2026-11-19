import { describe, expect, it, vi } from 'vite-plus/test'
import { renderHook } from '@testing-library/react'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'

const itemsState = vi.hoisted(() => ({
  items: [] as TimelineItem[],
  linkedItemsByItemId: {} as Record<string, TimelineItem[]>,
}))

const captionDialogStateMock = vi.hoisted(() => vi.fn(() => ({})))
const autoTranscriptCaptionsMock = vi.hoisted(() => vi.fn())

vi.mock('../../stores/items-store', () => {
  const useItemsStore = Object.assign(
    (selector: (state: typeof itemsState) => unknown) => selector(itemsState),
    { getState: () => itemsState },
  )
  return { useItemsStore }
})

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: (
    selector: (state: {
      brokenMediaIds: string[]
      orphanedClips: Array<{ itemId: string }>
    }) => unknown,
  ) => selector({ brokenMediaIds: [], orphanedClips: [] }),
}))

vi.mock('@/shared/state/editor', () => ({
  useEditorStore: () => true,
}))

vi.mock('../../stores/timeline-item-overlay-store', () => ({
  useTimelineItemOverlayStore: () => undefined,
}))

vi.mock('../../stores/keyframes-store', () => ({
  useKeyframesStore: () => null,
}))

vi.mock('./use-caption-dialog-state', () => ({
  useCaptionDialogState: captionDialogStateMock,
}))

vi.mock('./use-auto-transcript-captions', () => ({
  useAutoTranscriptCaptions: autoTranscriptCaptionsMock,
}))

import { useItemMetadata } from './use-item-metadata'

function makeClip(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
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
    ...overrides,
  }
}

function renderMetadata(item: TimelineItem, items: TimelineItem[]) {
  itemsState.items = items
  itemsState.linkedItemsByItemId = {}
  return renderHook(() => useItemMetadata(item))
}

describe('useItemMetadata caption menu label', () => {
  it('does not count the automatic virtual transcript track as generated captions', () => {
    const clip = makeClip({
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'media-1',
        enabled: true,
        updatedAt: 1,
        cues: [{ id: 'cue-1', startSeconds: 0, endSeconds: 1, text: 'Hello' }],
      },
    })

    const { result } = renderMetadata(clip, [clip])

    expect(result.current.hasGeneratedCaptions).toBe(false)
    // The replace flag still sees captions of some kind, so inserting real
    // items over the virtual track replaces instead of stacking a copy.
    expect(captionDialogStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasGeneratedCaptions: true }),
    )
    expect(autoTranscriptCaptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasGeneratedCaptions: true }),
    )
  })

  it('reports generated captions once a real caption item exists', () => {
    const clip = makeClip()
    const caption: TextItem = {
      id: 'caption-1',
      type: 'text',
      trackId: 'track-captions',
      from: 0,
      durationInFrames: 30,
      label: 'Hello',
      text: 'Hello',
      mediaId: 'media-1',
      color: '#fff',
      captionSource: { type: 'transcript', mediaId: 'media-1', clipId: 'clip-1' },
    }

    const { result } = renderMetadata(clip, [clip, caption])

    expect(result.current.hasGeneratedCaptions).toBe(true)
  })
})
