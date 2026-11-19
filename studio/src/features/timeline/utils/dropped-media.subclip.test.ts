// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import { createDefaultClassicTracks } from './classic-tracks'
import { buildDroppedMediaTimelineItems, getDroppedMediaDurationInFrames } from './dropped-media'
import { resolveDroppedMediaEntriesFromPayload } from './drop-execution'
import {
  buildGhostPreviewsFromTrackMediaDropPlan,
  planTrackMediaDropPlacements,
} from './track-media-drop'
import { isValidDragMediaItem } from './drag-drop-preview'

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  extractValidMediaFileEntriesFromDataTransfer: vi.fn(),
  formatMediaDropRejectionMessage: vi.fn(),
  getMediaType: vi.fn(),
}))

const logger = { error: vi.fn(), warn: vi.fn() }

function makeMedia(fps: number, duration: number, id = 'media-1'): MediaMetadata {
  return {
    id,
    storageType: 'handle',
    fileHandle: {} as FileSystemFileHandle,
    fileName: 'clip.mp4',
    fileSize: 1024,
    fileLastModified: 1,
    mimeType: 'video/mp4',
    duration,
    width: 1280,
    height: 720,
    fps,
    codec: 'h264',
    audioCodec: 'aac',
    bitrate: 1000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

/** The placement the timeline track runs for a drop: payload, entries, plan, builder. */
function dropOnTrack(params: {
  payload: unknown
  media: MediaMetadata[]
  projectFps: number
  existing?: Array<{ id: string; trackId: string; from: number; durationInFrames: number }>
  dropFrame?: number
}): TimelineItem[] {
  const entries = resolveDroppedMediaEntriesFromPayload(params.payload, params.media, logger)
  const { plannedItems } = planTrackMediaDropPlacements({
    entries: entries.map((entry) => ({
      payload: entry,
      label: entry.label,
      mediaType: entry.mediaType,
      durationInFrames: getDroppedMediaDurationInFrames(
        entry.media,
        entry.mediaType,
        params.projectFps,
        entry.sourceRange,
      ),
      hasLinkedAudio: entry.mediaType === 'video' && !!entry.media.audioCodec,
    })),
    dropFrame: params.dropFrame ?? 0,
    tracks: createDefaultClassicTracks(80),
    existingItems: params.existing ?? [],
    dropTargetTrackId: 'track-1',
  })
  return plannedItems.flatMap((planned) => {
    const dropped = planned.entry.payload
    const primary = planned.placements.find((p) => p.mediaType !== 'audio')!
    const audio = planned.placements.find((p) => p.mediaType === 'audio')
    return buildDroppedMediaTimelineItems({
      media: dropped.media,
      mediaId: dropped.mediaId,
      mediaType: planned.entry.mediaType,
      label: planned.entry.label,
      timelineFps: params.projectFps,
      blobUrl: 'blob:test',
      canvasWidth: 1920,
      canvasHeight: 1080,
      placement: {
        primary: {
          trackId: primary.trackId,
          from: primary.from,
          durationInFrames: primary.durationInFrames,
        },
        linkedAudio: audio
          ? { trackId: audio.trackId, from: audio.from, durationInFrames: audio.durationInFrames }
          : undefined,
      },
      linkVideoAudio: planned.linkVideoAudio,
      sourceRange: dropped.sourceRange,
    })
  })
}

const single = (media: MediaMetadata, range: object, duration = 1) => ({
  type: 'media-item',
  mediaId: media.id,
  mediaType: 'video',
  fileName: 'clip.mp4',
  duration,
  ...range,
})

describe('dropping a media range on a track', () => {
  // [clip fps, project fps, start, end (exclusive), expected clip length in project frames]
  const cases: Array<[string, number, number, number, number, number]> = [
    ['30 in 30', 30, 30, 30, 90, 60],
    ['59.94 in 59.94', 60000 / 1001, 60000 / 1001, 1001, 2002, 1001],
    ['25 clip in a 30 project', 25, 30, 25, 75, 60],
    ['60 clip in a 59.94 project', 60, 59.94, 0, 600, 600],
  ]

  it.each(cases)('%s: range and length', (_name, clipFps, projectFps, start, end, frames) => {
    const media = makeMedia(clipFps, 20)
    const items = dropOnTrack({
      payload: single(media, { sourceStart: start, sourceEnd: end, subclipId: 's1' }),
      media: [media],
      projectFps,
    })
    expect(items).toHaveLength(2)
    const [video, audio] = items as [TimelineItem, TimelineItem]
    expect(video.type).toBe('video')
    expect(video.mediaId).toBe(media.id)
    expect(video.sourceStart).toBe(start)
    expect(video.sourceEnd).toBe(end)
    expect(video.durationInFrames).toBe(frames)
    expect(video.sourceFps).toBe(clipFps)
    expect(audio.type).toBe('audio')
    expect(audio.sourceStart).toBe(start)
    expect(audio.sourceEnd).toBe(end)
    expect(audio.durationInFrames).toBe(frames)
    expect(audio.linkedGroupId).toBe(video.linkedGroupId)
    expect(video.linkedGroupId).toBeDefined()
  })

  it('moves past an overlap and keeps the range', () => {
    const media = makeMedia(30, 20)
    const items = dropOnTrack({
      payload: single(media, { sourceStart: 30, sourceEnd: 90 }),
      media: [media],
      projectFps: 30,
      existing: [{ id: 'x', trackId: 'track-1', from: 10, durationInFrames: 100 }],
      dropFrame: 24,
    })
    const video = items[0]!
    expect(video.from).toBeGreaterThanOrEqual(110)
    expect(video.sourceStart).toBe(30)
    expect(video.sourceEnd).toBe(90)
    expect(video.durationInFrames).toBe(60)
  })

  it('places each entry of media-items with its own range, a plain one unchanged', () => {
    const a = makeMedia(30, 20, 'a')
    const b = makeMedia(30, 20, 'b')
    const entry = (m: MediaMetadata, range: object) => ({
      mediaId: m.id,
      mediaType: 'video',
      fileName: `${m.id}.mp4`,
      duration: 1,
      ...range,
    })
    const items = dropOnTrack({
      payload: {
        type: 'media-items',
        items: [entry(a, { sourceStart: 60, sourceEnd: 120 }), entry(b, {})],
      },
      media: [a, b],
      projectFps: 30,
    })
    const videos = items.filter((i) => i.type === 'video')
    expect(videos).toHaveLength(2)
    expect(videos[0]).toMatchObject({
      mediaId: 'a',
      sourceStart: 60,
      sourceEnd: 120,
      durationInFrames: 60,
    })
    expect(videos[1]).toMatchObject({
      mediaId: 'b',
      sourceStart: 0,
      sourceEnd: 600,
      durationInFrames: 600,
    })
  })

  it('a payload without a range plays the whole file as before', () => {
    const media = makeMedia(30, 4)
    const items = dropOnTrack({ payload: single(media, {}, 4), media: [media], projectFps: 30 })
    expect(items[0]).toMatchObject({ sourceStart: 0, sourceEnd: 120, durationInFrames: 120 })
    expect(items[1]).toMatchObject({ sourceStart: 0, sourceEnd: 120, durationInFrames: 120 })
    expect(getDroppedMediaDurationInFrames(media, 'video', 30)).toBe(120)
  })

  it('refuses a malformed range instead of playing other frames', () => {
    const media = makeMedia(30, 20)
    for (const range of [
      { sourceStart: 10 },
      { sourceEnd: 10 },
      { sourceStart: 10.5, sourceEnd: 20 },
      { sourceStart: 20, sourceEnd: 20 },
      { sourceStart: -1, sourceEnd: 20 },
    ]) {
      expect(
        dropOnTrack({ payload: single(media, range), media: [media], projectFps: 30 }),
      ).toEqual([])
      expect(
        isValidDragMediaItem({
          mediaId: 'media-1',
          mediaType: 'video',
          fileName: 'c.mp4',
          duration: 1,
          ...range,
        }),
      ).toBe(false)
    }
  })

  it('ignores a range on an image', () => {
    const media = { ...makeMedia(30, 0), mimeType: 'image/png' }
    const entries = resolveDroppedMediaEntriesFromPayload(
      { ...single(media, { sourceStart: 0, sourceEnd: 10 }), mediaType: 'image' },
      [media],
      logger,
    )
    expect(entries[0]!.sourceRange).toBeUndefined()
  })
})

describe('the drop ghost of a media range', () => {
  it('has the length of the range, the same as the dropped clip', () => {
    const media = makeMedia(25, 20)
    const range = { sourceStart: 25, sourceEnd: 75 }
    const { plannedItems } = planTrackMediaDropPlacements({
      entries: [
        {
          payload: null,
          label: 'clip.mp4',
          mediaType: 'video' as const,
          // what the ghost entry carries: the payload's seconds, the media's rate, the range
          durationInFrames: getDroppedMediaDurationInFrames(
            { duration: 2, fps: media.fps },
            'video',
            30,
            range,
          ),
          hasLinkedAudio: true,
        },
      ],
      dropFrame: 0,
      tracks: createDefaultClassicTracks(80),
      existingItems: [],
      dropTargetTrackId: 'track-1',
    })
    const ghosts = buildGhostPreviewsFromTrackMediaDropPlan({
      plannedItems,
      frameToPixels: (frame) => frame,
    })
    expect(ghosts.map((g) => g.width)).toEqual([60, 60])
    const items = dropOnTrack({ payload: single(media, range, 2), media: [media], projectFps: 30 })
    expect(items[0]!.durationInFrames).toBe(60)
  })
})
