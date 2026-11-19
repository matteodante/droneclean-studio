// @vitest-environment node

/**
 * The packet remux copies a single untouched clip's samples into the export. A clip
 * with a cleaned shadow range is not that clip: part of its picture lives in another
 * file, so the remux has to refuse it and let the renderer read both files.
 */

import { describe, expect, it } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { ShadowRemoval } from '@/studio/shadow/model'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import type { ClientExportSettings } from './client-renderer'
import { clipBlocksRemux, getPacketRemuxPlan } from './packet-remux-plan'

const FPS = 30
const DURATION = 300

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
  id: 'clip-1',
  trackId: 'track-1',
  type: 'video',
  src: 'workspace://media/clip.mp4',
  label: 'clip',
  from: 0,
  durationInFrames: DURATION,
}

const track: TimelineTrack = {
  id: 'track-1',
  name: 'V1',
  height: 60,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [],
}

const settings: ClientExportSettings = {
  mode: 'video',
  codec: 'avc',
  container: 'mp4',
  quality: 'high',
  resolution: { width: 1920, height: 1080 },
  fps: FPS,
} as ClientExportSettings

function composition(item: VideoItem): CompositionInputProps {
  return {
    fps: FPS,
    width: 1920,
    height: 1080,
    durationInFrames: DURATION,
    tracks: [{ ...track, items: [item] }],
    transitions: [],
    keyframes: [],
  } as CompositionInputProps
}

describe('packet remux and a cleaned shadow range', () => {
  it('plans a remux for the same untouched clip without pieces', () => {
    expect(getPacketRemuxPlan(settings, composition(video))).toMatchObject({
      src: 'workspace://media/clip.mp4',
      trimStartSeconds: 0,
      trimEndSeconds: DURATION / FPS,
    })
  })

  it('refuses a clip that has cleaned pieces', () => {
    const cleaned: VideoItem = { ...video, shadowRemoval }
    expect(getPacketRemuxPlan(settings, composition(cleaned))).toBeNull()
    expect(clipBlocksRemux(cleaned, composition(cleaned))).toBe(true)
  })
})
