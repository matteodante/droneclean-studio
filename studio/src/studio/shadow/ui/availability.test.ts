import { describe, expect, it } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { TextItem, VideoItem } from '@/types/timeline'
import { isFeatureShown } from '@/studio/feature-switches'
import { shadowAvailability } from './availability'

/** Clip 0020's media record: workspace storage, 3840×2880 at 60000/1001. */
const MEDIA: MediaMetadata = {
  id: 'media-1',
  storageType: 'workspace',
  fileName: 'DJI_20261115124704_0020_D.MP4',
  fileSize: 3_764_360_098,
  mimeType: 'video/mp4',
  duration: 230.88065,
  width: 3840,
  height: 2880,
  fps: 59.94,
  codec: 'hevc',
  bitrate: 129_885_000,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
}

const VIDEO: VideoItem = {
  id: 'clip-1',
  trackId: 'track-1',
  type: 'video',
  label: 'DJI_0020',
  mediaId: MEDIA.id,
  src: 'blob:clip-1',
  from: 0,
  durationInFrames: 600,
}

const TEXT: TextItem = {
  id: 'text-1',
  trackId: 'track-1',
  type: 'text',
  label: 'Title',
  text: 'Hello',
  color: '#ffffff',
  from: 0,
  durationInFrames: 60,
}

describe('shadow availability', () => {
  it('is ready for a video clip whose source is stored and measured', () => {
    expect(shadowAvailability(VIDEO, MEDIA)).toEqual({
      state: 'ready',
      canClean: isFeatureShown('shadowRemovalClean'),
    })
  })

  it('hides itself for anything that is not a video clip', () => {
    expect(shadowAvailability(TEXT, MEDIA)).toEqual({ state: 'hidden', reason: 'not-a-video' })
    expect(shadowAvailability(null, MEDIA)).toEqual({ state: 'hidden', reason: 'not-a-video' })
  })

  it('hides itself on a reversed clip: v1 does not offer shadow removal there', () => {
    expect(shadowAvailability({ ...VIDEO, isReversed: true }, MEDIA)).toEqual({
      state: 'hidden',
      reason: 'reversed',
    })
  })

  it('has no source when the clip has no media record, or the library reports it broken', () => {
    expect(shadowAvailability(VIDEO, undefined)).toEqual({ state: 'no-source' })
    expect(shadowAvailability(VIDEO, MEDIA, { broken: true })).toEqual({ state: 'no-source' })
  })

  it('has no source when the record no longer points at readable bytes', () => {
    expect(shadowAvailability(VIDEO, { ...MEDIA, storageType: 'handle' })).toEqual({
      state: 'no-source',
    })
    expect(
      shadowAvailability(VIDEO, { ...MEDIA, storageType: 'opfs', opfsPath: undefined }),
    ).toEqual({ state: 'no-source' })
    expect(shadowAvailability(VIDEO, { ...MEDIA, fileSize: 0 })).toEqual({ state: 'no-source' })
    expect(shadowAvailability(VIDEO, { ...MEDIA, duration: 0 })).toEqual({ state: 'no-source' })
    expect(shadowAvailability(VIDEO, { ...MEDIA, width: 0 })).toEqual({ state: 'no-source' })
    expect(shadowAvailability(VIDEO, { ...MEDIA, fps: 0 })).toEqual({ state: 'no-source' })
    expect(shadowAvailability(VIDEO, { ...MEDIA, storageType: 'path', filePath: undefined })).toEqual({
      state: 'no-source',
    })
  })

  it('is ready for an original the desktop links by path, the way a pilot imports', () => {
    expect(
      shadowAvailability(VIDEO, { ...MEDIA, storageType: 'path', filePath: '/Volumes/Flights/DJI_0020.MP4' }),
    ).toEqual({ state: 'ready', canClean: true })
  })

  it('offers paid cleaning since the live flow was verified (19 Nov 2026)', () => {
    expect(isFeatureShown('shadowRemovalClean')).toBe(true)
    const availability = shadowAvailability(VIDEO, MEDIA)
    expect(availability.state).toBe('ready')
    expect(availability.state === 'ready' && availability.canClean).toBe(true)
  })
})
