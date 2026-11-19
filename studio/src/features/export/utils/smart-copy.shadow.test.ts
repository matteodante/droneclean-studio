// @vitest-environment node

/**
 * A clip with a cleaned shadow range must never leave the editor as a copy of its
 * source: the copy would carry the uncleaned frames the user paid to replace. Smart copy
 * copies the file byte for byte, so it has to refuse the clip, and it says why in its
 * own words: `shadow-pieces`, not the bucket trims and speed changes share.
 */

import { describe, expect, it } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { ShadowRemoval } from '@/studio/shadow/model'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type { SmartCopyContext } from './smart-copy'
import { assessSmartCopyEligibility } from './smart-copy'

const source: MediaMetadata = {
  id: 'media-1',
  storageType: 'workspace',
  fileName: 'source.mp4',
  fileSize: 4_000_000,
  mimeType: 'video/mp4',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'avc1.640028',
  bitrate: 3_000_000,
  tags: [],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

const shadowRemoval: ShadowRemoval = {
  mark: { x: 960, y: 540, sourceFrame: 30, radius: 80 },
  ranges: [{ startFrame: 30, endFrame: 60, credits: 45, jobId: 'job-1', passJobId: 'pass-1' }],
  pieces: [
    {
      jobId: 'job-1',
      path: 'media/media-1/shadow/30_30.mp4',
      src: 'blob:cleaned-30-59',
      startFrame: 30,
      frames: 30,
    },
  ],
}

const video: VideoItem = {
  id: 'video-1',
  trackId: 'track-1',
  type: 'video',
  src: 'blob:source',
  label: 'source.mp4',
  mediaId: source.id,
  from: 0,
  durationInFrames: 300,
  sourceStart: 0,
  sourceEnd: 300,
  sourceDuration: 300,
  sourceFps: 30,
  trimStart: 0,
  trimEnd: 0,
  transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 },
}

const track: TimelineTrack = {
  id: 'track-1',
  name: 'Video',
  height: 64,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [video],
}

function context(items: TimelineItem[]): SmartCopyContext {
  return {
    settings: {
      mode: 'video',
      codec: 'avc',
      container: 'mp4',
      quality: 'medium',
      resolution: { width: 1920, height: 1080 },
      fps: 30,
      videoBitrate: 3_000_000,
      smartCopy: true,
    },
    tracks: [{ ...track, items }],
    items,
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    inPoint: null,
    outPoint: null,
    source,
  }
}

describe('smart copy and a cleaned shadow range', () => {
  it('is available for the same untouched clip without pieces', () => {
    expect(assessSmartCopyEligibility(context([video]))).toMatchObject({
      eligible: true,
      reason: 'eligible',
    })
  })

  it('refuses a full-length clip that has cleaned pieces, with its own reason', () => {
    const cleaned: VideoItem = { ...video, shadowRemoval }
    // Its own reason, not the bucket a trimmed, split, reversed or retimed clip shares: the file
    // is the whole source, and part of its picture was replaced by the paid clean.
    expect(assessSmartCopyEligibility(context([cleaned]))).toMatchObject({
      eligible: false,
      reason: 'shadow-pieces',
      mediaId: source.id,
    })
  })

  it('keeps the trimmed-or-retimed reason for a clip that is actually trimmed', () => {
    const trimmed: VideoItem = { ...video, sourceStart: 30, durationInFrames: 270 }
    expect(assessSmartCopyEligibility(context([trimmed]))).toMatchObject({
      eligible: false,
      reason: 'trimmed-or-retimed',
    })
  })
})
