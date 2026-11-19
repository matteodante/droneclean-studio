// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { averageSpeed, type SpeedCurve } from '@/studio/speed'
import type { SmartCopyContext } from './smart-copy'
import { assessSmartCopyEligibility, trySmartCopyExport } from './smart-copy'

const { getMediaFileMock } = vi.hoisted(() => ({
  getMediaFileMock: vi.fn(),
}))

vi.mock('../deps/media-library', () => ({
  getMediaFileById: getMediaFileMock,
  getMediaMetadataById: vi.fn(() => undefined),
}))

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
  createdAt: Date.now(),
  updatedAt: Date.now(),
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

function context(overrides: Partial<SmartCopyContext> = {}): SmartCopyContext {
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
    tracks: [track],
    items: [video],
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    inPoint: null,
    outPoint: null,
    source,
    ...overrides,
  }
}

describe('smart copy eligibility', () => {
  it('accepts an unchanged full-source clip with matching output properties', () => {
    expect(assessSmartCopyEligibility(context())).toMatchObject({
      eligible: true,
      reason: 'eligible',
      mediaId: source.id,
    })
  })

  it('returns the original blob without invoking the encoder', async () => {
    const original = new Blob(['original-media-bytes'], { type: source.mimeType })
    getMediaFileMock.mockResolvedValueOnce(original)
    const onProgress = vi.fn()

    const outcome = await trySmartCopyExport(context(), new AbortController().signal, onProgress)

    expect(outcome.result?.blob).toBe(original)
    expect(outcome.result?.fileSize).toBe(original.size)
    expect(getMediaFileMock).toHaveBeenCalledWith(source.id)
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'finalizing', progress: 100 }),
    )
  })

  it('rejects in/out exports and trimmed clips', () => {
    expect(assessSmartCopyEligibility(context({ inPoint: 0, outPoint: 150 })).reason).toBe('range')

    const trimmed: VideoItem = { ...video, sourceStart: 30, durationInFrames: 270 }
    expect(assessSmartCopyEligibility(context({ items: [trimmed] as TimelineItem[] })).reason).toBe(
      'trimmed-or-retimed',
    )
  })

  it('rejects frame-rate, resolution, and format changes', () => {
    const conformedVideo: VideoItem = { ...video, durationInFrames: 600 }
    expect(
      assessSmartCopyEligibility(
        context({
          fps: 60,
          items: [conformedVideo],
          settings: { ...context().settings, fps: 60 },
        }),
      ).reason,
    ).toBe('project-mismatch')
    expect(
      assessSmartCopyEligibility(context({ settings: { ...context().settings, container: 'mov' } }))
        .reason,
    ).toBe('format-mismatch')
  })

  it('rejects visual and audio processing', () => {
    const processedVideo: VideoItem = { ...video, fadeIn: 0.5 }
    expect(
      assessSmartCopyEligibility(context({ items: [processedVideo] as TimelineItem[] })).reason,
    ).toBe('visual-processing')

    const processedTrack: TimelineTrack = { ...track, volume: -3 }
    expect(assessSmartCopyEligibility(context({ tracks: [processedTrack] })).reason).toBe(
      'audio-processing',
    )
  })

  it('rejects additional layers', () => {
    expect(
      assessSmartCopyEligibility(context({ items: [video, { ...video, id: 'video-2' }] })).reason,
    ).toBe('timeline-layout')
  })
})

/**
 * A speed curve is not the untouched source smart copy returns (design 7.1, section 4.5). The
 * clip's `speed` is the curve's average, so a symmetric ramp averages 1, passes the
 * `speed === 1` test, and would still be copied as one flat speed. The assessment has to say
 * why the dialog cannot offer the copy, so the reason is the existing `trimmed-or-retimed`.
 */
describe('smart copy and a speed curve', () => {
  const symmetricCurve: SpeedCurve = {
    keys: [
      { frame: 0, speed: 0.5 },
      { frame: 150, speed: 1.5 },
      { frame: 300, speed: 0.5 },
    ],
  }

  it('the curve averages exactly 1, so `speed === 1` holds', () => {
    expect(averageSpeed(symmetricCurve)).toBe(1)
    expect(assessSmartCopyEligibility(context()).eligible).toBe(true)
  })

  it('is given the reason the export dialog shows, with the source to name it', () => {
    const curved: VideoItem = { ...video, speed: 1, speedCurve: symmetricCurve }
    expect(
      assessSmartCopyEligibility(context({ items: [curved] as TimelineItem[] })),
    ).toMatchObject({
      eligible: false,
      reason: 'trimmed-or-retimed',
      mediaId: source.id,
    })
  })

  it('never copies the file of a curved clip', async () => {
    const curved: VideoItem = { ...video, speed: 1, speedCurve: symmetricCurve }
    getMediaFileMock.mockClear()
    const outcome = await trySmartCopyExport(
      context({ items: [curved] as TimelineItem[] }),
      new AbortController().signal,
      () => {},
    )
    expect(outcome.result).toBeUndefined()
    expect(getMediaFileMock).not.toHaveBeenCalled()
  })
})

/**
 * The source stages change the picture, so smart copy must not hand back the file (design 3.6 §2.3):
 * a stabilized clip is warped into another size, and an input transform maps every code value. Both
 * are visual processing, the reason the export dialog already shows for a clip whose picture changed.
 */
describe('smart copy and the source stages', () => {
  const stabilization: VideoItem['stabilization'] = {
    enabled: true,
    method: 'Default',
    params: { smoothness: 0.5 },
    fov: 1,
    horizonLockPercent: 0,
    horizonLockRoll: 0,
    adaptiveZoomSeconds: 4,
  }

  it('refuses a stabilized clip', () => {
    const stabilized: VideoItem = { ...video, stabilization }
    expect(assessSmartCopyEligibility(context({ items: [stabilized] }))).toMatchObject({
      eligible: false,
      reason: 'visual-processing',
      mediaId: source.id,
    })
  })

  it('refuses a clip with an input transform, and accepts the answer that there is none', () => {
    const coloured: VideoItem = { ...video, inputColor: 'dlog-m' }
    expect(assessSmartCopyEligibility(context({ items: [coloured] }))).toMatchObject({
      eligible: false,
      reason: 'visual-processing',
      mediaId: source.id,
    })
    const none: VideoItem = { ...video, inputColor: 'none' }
    expect(assessSmartCopyEligibility(context({ items: [none] })).eligible).toBe(true)
  })
})
