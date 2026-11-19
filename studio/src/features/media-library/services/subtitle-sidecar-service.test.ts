import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type { EmbeddedSubtitleTrack } from '@/shared/utils/matroska-subtitles'

const itemsStateMock = vi.hoisted(() => vi.fn())
const setTracksMock = vi.hoisted(() => vi.fn())
const addItemsMock = vi.hoisted(() => vi.fn())
const removeItemsMock = vi.hoisted(() => vi.fn())
const removeTimelineItemsExactMock = vi.hoisted(() => vi.fn())
const selectItemsMock = vi.hoisted(() => vi.fn())
const projectStateMock = vi.hoisted(() => vi.fn())
const getEmbeddedSubtitleSidecarMock = vi.hoisted(() => vi.fn())
const saveEmbeddedSubtitleSidecarMock = vi.hoisted(() => vi.fn())

vi.mock('@/features/media-library/deps/projects', () => ({
  useProjectStore: {
    getState: projectStateMock,
  },
}))

vi.mock('@/features/media-library/deps/timeline-stores', () => ({
  addItems: addItemsMock,
  removeItems: removeItemsMock,
  removeTimelineItemsExact: removeTimelineItemsExactMock,
  setTracks: setTracksMock,
  useItemsStore: {
    getState: itemsStateMock,
  },
  useTimelineSettingsStore: {
    getState: itemsStateMock,
  },
}))

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: {
    getState: () => ({ selectItems: selectItemsMock }),
  },
}))

vi.mock('@/infrastructure/storage', () => ({
  getEmbeddedSubtitleSidecar: getEmbeddedSubtitleSidecarMock,
  saveEmbeddedSubtitleSidecar: saveEmbeddedSubtitleSidecarMock,
}))

import { subtitleSidecarService } from './subtitle-sidecar-service'

const media: MediaMetadata = {
  id: 'media-1',
  storageType: 'handle',
  fileName: 'movie.mkv',
  fileSize: 1024,
  mimeType: 'video/x-matroska',
  duration: 3,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  bitrate: 5000,
  tags: [],
  createdAt: 1,
  updatedAt: 1,
}

const embeddedTrack: EmbeddedSubtitleTrack = {
  trackNumber: 1,
  codecId: 'S_TEXT/UTF8',
  language: 'eng',
  name: 'English',
  default: true,
  forced: false,
  cues: [{ id: 'cue-1', startSeconds: 1, endSeconds: 2, text: 'Hello' }],
}

function makeTrack(id: string, order: number, kind: 'video' | 'audio' = 'video'): TimelineTrack {
  return {
    id,
    name: id,
    kind,
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
  }
}

function makeClip(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-v2',
    from: 0,
    durationInFrames: 90,
    label: 'movie.mkv',
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

function seedTimeline(tracks: TimelineTrack[], items: TimelineItem[]): void {
  timelineState = { fps: 30, tracks, items }
  itemsStateMock.mockImplementation(() => timelineState)
}

function insertedSegments(): TimelineItem[] {
  return addItemsMock.mock.calls[0]?.[0] as TimelineItem[]
}

let timelineState: { fps: number; tracks: TimelineTrack[]; items: TimelineItem[] }

describe('subtitleSidecarService.insertEmbeddedSubtitleTrack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectStateMock.mockReturnValue({
      currentProject: { metadata: { width: 1920, height: 1080 } },
    })
    timelineState = { fps: 30, tracks: [], items: [] }
    removeTimelineItemsExactMock.mockImplementation((ids: string[]) => {
      timelineState.items = timelineState.items.filter((item) => !ids.includes(item.id))
    })
  })

  it('places the caption track in front of every picture track instead of on an empty one below', () => {
    const pictureTrack = makeTrack('track-v2', 0)
    const emptyTrackBelow = makeTrack('track-v1', 1)
    seedTimeline([pictureTrack, emptyTrackBelow], [makeClip()])

    const result = subtitleSidecarService.insertEmbeddedSubtitleTrack(media, embeddedTrack)

    expect(result).toEqual({
      insertedItemCount: 1,
      cueCount: 1,
      trackLabel: 'English / eng',
    })

    const updatedTracks = setTracksMock.mock.calls[0]?.[0] as TimelineTrack[]
    expect(updatedTracks).toBeDefined()
    const captionTrack = updatedTracks.find(
      (track) => track.id !== pictureTrack.id && track.id !== emptyTrackBelow.id,
    )
    expect(captionTrack).toBeDefined()
    expect(captionTrack!.order).toBeLessThan(pictureTrack.order)

    const segments = insertedSegments()
    expect(segments).toHaveLength(1)
    expect(segments[0]?.type).toBe('subtitle')
    expect(segments[0]?.trackId).toBe(captionTrack!.id)
    expect(segments[0]?.trackId).not.toBe(emptyTrackBelow.id)
    expect(selectItemsMock).toHaveBeenCalledWith([segments[0]?.id])
  })

  it('reuses a caption track that already sits in front of the picture', () => {
    const captionTrack = makeTrack('track-captions', -1)
    const pictureTrack = makeTrack('track-v2', 0)
    const previousSegment: TimelineItem = {
      id: 'old-segment',
      type: 'subtitle',
      trackId: 'track-captions',
      from: 30,
      durationInFrames: 30,
      label: 'movie.mkv — English / eng',
      mediaId: 'media-1',
      source: {
        type: 'embedded-subtitles',
        mediaId: 'media-1',
        clipId: 'clip-1',
        trackNumber: 1,
        importedAt: 1,
      },
      cues: [{ id: 'old-cue', startSeconds: 0, endSeconds: 1, text: 'Old' }],
      color: '#fff',
    }
    seedTimeline([captionTrack, pictureTrack], [makeClip(), previousSegment])

    subtitleSidecarService.insertEmbeddedSubtitleTrack(media, embeddedTrack)

    expect(removeTimelineItemsExactMock).toHaveBeenCalledWith(['old-segment'])
    expect(setTracksMock).not.toHaveBeenCalled()
    expect(insertedSegments()[0]?.trackId).toBe(captionTrack.id)
  })

  it('does not reuse a caption track that sits below the picture track', () => {
    const pictureTrack = makeTrack('track-v2', 0)
    const hiddenBehindPicture = makeTrack('track-captions', 1)
    seedTimeline([pictureTrack, hiddenBehindPicture], [makeClip()])

    subtitleSidecarService.insertEmbeddedSubtitleTrack(media, embeddedTrack)

    const updatedTracks = setTracksMock.mock.calls[0]?.[0] as TimelineTrack[]
    const captionTrack = updatedTracks.find(
      (track) => track.id !== pictureTrack.id && track.id !== hiddenBehindPicture.id,
    )
    expect(captionTrack).toBeDefined()
    expect(captionTrack!.order).toBeLessThan(pictureTrack.order)
    expect(insertedSegments()[0]?.trackId).toBe(captionTrack!.id)
  })

  it('keeps the append-to-bottom placement when the edit has no picture track', () => {
    const audioTrack = makeTrack('track-a1', 0, 'audio')
    const audioClip: TimelineItem = {
      id: 'clip-1',
      type: 'audio',
      trackId: 'track-a1',
      from: 0,
      durationInFrames: 90,
      label: 'movie.mkv',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 90,
      sourceDuration: 90,
      sourceFps: 30,
      speed: 1,
    }
    seedTimeline([audioTrack], [audioClip])

    subtitleSidecarService.insertEmbeddedSubtitleTrack(media, embeddedTrack)

    const updatedTracks = setTracksMock.mock.calls[0]?.[0] as TimelineTrack[]
    const captionTrack = updatedTracks.find(
      (track) => track.id !== audioTrack.id,
    )
    expect(captionTrack).toBeDefined()
    expect(captionTrack!.order).toBeGreaterThan(audioTrack.order)
    expect(insertedSegments()[0]?.trackId).toBe(captionTrack!.id)
  })
})
