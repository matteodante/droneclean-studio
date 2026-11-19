// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ShadowRemoval } from '@/studio/shadow/model'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import {
  buildPreviewCompositionData,
  frameReadsCleanedPiece,
  mergeLiveItemPresentation,
  mergeLiveItemPreview,
} from './use-preview-composition-model'

describe('mergeLiveItemPreview', () => {
  it('merges live shape properties into the canvas renderer snapshot', () => {
    const shape = {
      id: 'shape-1',
      trackId: 'track-1',
      type: 'shape' as const,
      shapeType: 'path' as const,
      fillColor: '#000000',
      label: 'Path',
      from: 0,
      durationInFrames: 100,
      trimPathOffset: 0,
    }

    expect(
      mergeLiveItemPreview(shape, {
        properties: { trimPathOffset: 135, taperStartWidth: 20 },
      }),
    ).toMatchObject({ trimPathOffset: 135, taperStartWidth: 20 })
    expect(shape.trimPathOffset).toBe(0)
  })
})

describe('mergeLiveItemPresentation', () => {
  it('uses committed text styling with the live transform while retaining snapshot timing', () => {
    const snapshot = {
      id: 'text-1',
      trackId: 'track-1',
      type: 'text' as const,
      label: 'Title',
      text: 'CINEMA',
      color: '#ffffff',
      fontSize: 120,
      textSpans: [{ text: 'CINEMA', fontSize: 120 }],
      from: 10,
      durationInFrames: 100,
      transform: { x: 0, y: 0, width: 600, height: 180 },
    }
    const committed = {
      ...snapshot,
      fontSize: 84,
      textSpans: [{ text: 'CINEMA', fontSize: 84 }],
      from: 20,
      durationInFrames: 80,
      transform: { x: 20, y: 10, width: 420, height: 126 },
    }

    expect(mergeLiveItemPresentation(snapshot, committed)).toMatchObject({
      fontSize: 84,
      textSpans: [{ text: 'CINEMA', fontSize: 84 }],
      from: 10,
      durationInFrames: 100,
      transform: { x: 20, y: 10, width: 420, height: 126 },
    })
  })

  it('carries a cleaned shadow record written after the snapshot, so a fresh piece is drawn', () => {
    const snapshot = clip()
    const shadowRemoval = piece(130, 30)

    const merged = mergeLiveItemPresentation(snapshot, { ...snapshot, shadowRemoval })

    expect(merged.shadowRemoval).toBe(shadowRemoval)
    // The snapshot the renderer's composition was built from is not mutated.
    expect('shadowRemoval' in snapshot).toBe(false)
  })

  it('keeps the snapshot object when nothing presentation-side changed', () => {
    const snapshot = clip()

    expect(mergeLiveItemPresentation(snapshot, { ...snapshot })).toBe(snapshot)
  })
})

describe('buildPreviewCompositionData', () => {
  it('uses original media for playback and fast scrubbing when proxies are disabled', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'clip-1',
          trackId: 'track-1',
          type: 'video',
          mediaId: 'media-1',
          src: '',
          label: 'Clip',
          from: 10,
          durationInFrames: 60,
        },
      ],
    }

    const result = buildPreviewCompositionData({
      combinedTracks: [track],
      fps: 30,
      items: track.items,
      keyframes: [],
      transitions: [],
      resolvedUrls: new Map([['media-1', 'blob://video']]),
      useProxy: false,
      blobUrlVersion: 0,
      project: { width: 1920, height: 1080, backgroundColor: '#000000' },
      resolveProxyUrlFn: () => 'proxy://video',
    })

    expect(result.playbackVideoSourceSpans).toEqual([
      { src: 'blob://video', startFrame: 10, endFrame: 70 },
    ])
    expect(result.scrubVideoSourceSpans).toEqual([
      { src: 'blob://video', startFrame: 10, endFrame: 70 },
    ])
    expect(result.fastScrubBoundaryFrames).toEqual([10, 70])
    expect(result.fastScrubBoundarySources).toEqual([
      { frame: 10, srcs: ['blob://video'] },
      { frame: 70, srcs: ['blob://video'] },
    ])
    expect(result.totalFrames).toBe(220)
    const playbackVideoItem = result.inputProps.tracks[0]?.items[0]
    const scrubVideoItem = result.fastScrubInputProps.tracks[0]?.items[0]
    expect(playbackVideoItem?.type).toBe('video')
    expect(scrubVideoItem?.type).toBe('video')
    if (playbackVideoItem?.type === 'video' && scrubVideoItem?.type === 'video') {
      expect(playbackVideoItem.src).toBe('blob://video')
      expect(scrubVideoItem.src).toBe('blob://video')
      expect(playbackVideoItem.audioSrc).toBe('blob://video')
      expect(scrubVideoItem.audioSrc).toBe('blob://video')
    }
  })

  it('uses proxy media for playback and fast scrubbing when proxies are enabled', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'clip-1',
          trackId: 'track-1',
          type: 'video',
          mediaId: 'media-1',
          src: '',
          label: 'Clip',
          from: 10,
          durationInFrames: 60,
        },
      ],
    }

    const result = buildPreviewCompositionData({
      combinedTracks: [track],
      fps: 30,
      items: track.items,
      keyframes: [],
      transitions: [],
      resolvedUrls: new Map([['media-1', 'blob://video']]),
      useProxy: true,
      blobUrlVersion: 0,
      project: { width: 1920, height: 1080, backgroundColor: '#000000' },
      resolveProxyUrlFn: () => 'proxy://video',
    })

    expect(result.playbackVideoSourceSpans).toEqual([
      { src: 'proxy://video', startFrame: 10, endFrame: 70 },
    ])
    expect(result.scrubVideoSourceSpans).toEqual([
      { src: 'proxy://video', startFrame: 10, endFrame: 70 },
    ])
    expect(result.fastScrubBoundarySources).toEqual([
      { frame: 10, srcs: ['proxy://video'] },
      { frame: 70, srcs: ['proxy://video'] },
    ])
    const playbackVideoItem = result.inputProps.tracks[0]?.items[0]
    const scrubVideoItem = result.fastScrubInputProps.tracks[0]?.items[0]
    expect(playbackVideoItem?.type).toBe('video')
    expect(scrubVideoItem?.type).toBe('video')
    if (playbackVideoItem?.type === 'video' && scrubVideoItem?.type === 'video') {
      expect(playbackVideoItem.src).toBe('proxy://video')
      expect(scrubVideoItem.src).toBe('proxy://video')
      expect(playbackVideoItem.audioSrc).toBe('blob://video')
      expect(scrubVideoItem.audioSrc).toBe('blob://video')
    }
  })

  it('resolves a lottie item src from resolvedUrls (fixes stale blob URL after reload)', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Overlay',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'clip-1',
          trackId: 'track-1',
          type: 'lottie',
          mediaId: 'media-lottie',
          // Dead blob URL from a previous session, as loaded from disk.
          src: 'blob:stale-url',
          frameRate: 30,
          totalFrames: 90,
          label: 'spinner.lottie',
          from: 0,
          durationInFrames: 90,
        },
      ],
    }

    const result = buildPreviewCompositionData({
      combinedTracks: [track],
      fps: 30,
      items: track.items,
      keyframes: [],
      transitions: [],
      resolvedUrls: new Map([['media-lottie', 'blob://fresh-lottie']]),
      useProxy: false,
      blobUrlVersion: 0,
      project: { width: 1920, height: 1080, backgroundColor: '#000000' },
    })

    const lottieItem = result.inputProps.tracks[0]?.items[0]
    expect(lottieItem?.type).toBe('lottie')
    if (lottieItem && 'src' in lottieItem) {
      expect(lottieItem.src).toBe('blob://fresh-lottie')
    }
  })

  it('falls back to default duration for empty timelines', () => {
    const result = buildPreviewCompositionData({
      combinedTracks: [],
      fps: 30,
      items: [],
      keyframes: [],
      transitions: [],
      resolvedUrls: new Map(),
      useProxy: true,
      blobUrlVersion: 0,
      project: { width: 1280, height: 720 },
    })

    expect(result.totalFrames).toBe(900)
    expect(result.playerRenderSize).toEqual({ width: 1280, height: 720 })
    expect(result.renderSize).toEqual({ width: 1280, height: 720 })
  })

  it('keeps project coordinates while using a smaller physical preview target', () => {
    const result = buildPreviewCompositionData({
      combinedTracks: [],
      fps: 30,
      items: [],
      keyframes: [],
      transitions: [],
      resolvedUrls: new Map(),
      useProxy: false,
      blobUrlVersion: 0,
      project: { width: 3840, height: 2160 },
      previewRenderSize: { width: 1504, height: 846 },
    })

    expect(result.fastScrubInputProps).toMatchObject({ width: 3840, height: 2160 })
    expect(result.renderSize).toEqual({ width: 1504, height: 846 })
  })

  it('uses an already-acquired blob URL before resolvedUrls catches up', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'clip-1',
          trackId: 'track-1',
          type: 'video',
          mediaId: 'media-1',
          src: '',
          label: 'Clip',
          from: 0,
          durationInFrames: 90,
        },
      ],
    }

    const result = buildPreviewCompositionData({
      combinedTracks: [track],
      fps: 30,
      items: track.items,
      keyframes: [],
      transitions: [],
      resolvedUrls: new Map(),
      useProxy: false,
      blobUrlVersion: 1,
      project: { width: 1920, height: 1080 },
      getBlobUrlFn: (mediaId) => (mediaId === 'media-1' ? 'blob://warm-audio' : null),
    })

    const playbackVideoItem = result.inputProps.tracks[0]?.items[0]
    expect(playbackVideoItem?.type).toBe('video')
    if (playbackVideoItem?.type === 'video') {
      expect(playbackVideoItem.src).toBe('blob://warm-audio')
      expect(playbackVideoItem.audioSrc).toBe('blob://warm-audio')
    }
  })

  it('preserves bus and track EQ in preview composition props', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Audio 1',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      audioEq: {
        lowGainDb: 3,
        lowCutEnabled: true,
        lowCutFrequencyHz: 80,
      },
      items: [
        {
          id: 'clip-1',
          trackId: 'track-1',
          type: 'audio',
          mediaId: 'media-1',
          src: '',
          label: 'VO',
          from: 0,
          durationInFrames: 120,
        },
      ],
    }

    const busAudioEq = {
      highGainDb: -4,
      highCutEnabled: true,
      highCutFrequencyHz: 9000,
    }

    const result = buildPreviewCompositionData({
      combinedTracks: [track],
      fps: 30,
      items: track.items,
      keyframes: [],
      transitions: [],
      busAudioEq,
      resolvedUrls: new Map([['media-1', 'blob://audio']]),
      useProxy: false,
      blobUrlVersion: 0,
      project: { width: 1920, height: 1080, backgroundColor: '#000000' },
    })

    expect(result.inputProps.busAudioEq).toEqual(busAudioEq)
    expect(result.fastScrubInputProps.busAudioEq).toEqual(busAudioEq)
    expect(result.inputProps.tracks[0]?.audioEq).toEqual(track.audioEq)
    expect(result.fastScrubInputProps.tracks[0]?.audioEq).toEqual(track.audioEq)
  })
})

/** A clip of `frames` source frames at `sourceFps`, starting at timeline frame `from`. */
function clip(extra: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'video',
    mediaId: 'media-1',
    src: 'blob:source',
    label: 'Clip',
    from: 10,
    durationInFrames: 90,
    sourceStart: 100,
    sourceFps: 30,
    ...extra,
  }
}

function trackOf(items: VideoItem[], visible = true): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Video',
    height: 80,
    locked: false,
    visible,
    muted: false,
    solo: false,
    order: 0,
    items,
  }
}

/** A cleaned piece covering source frames `[startFrame, startFrame + frames)`. */
function piece(startFrame: number, frames: number): ShadowRemoval {
  return {
    mark: { x: 160, y: 90, sourceFrame: startFrame, radius: 6 },
    ranges: [],
    pieces: [
      {
        jobId: 'job-1',
        path: 'media/media-1/shadow/0_72.mp4',
        src: 'blob:cleaned-piece',
        startFrame,
        frames,
      },
    ],
  }
}

describe('frameReadsCleanedPiece', () => {
  it('is true only on the frames the piece covers, in source frames', () => {
    // Timeline 45 is the clip's local frame 35, source frame 135: inside the piece 130..159.
    const record = piece(130, 30)
    const item = clip({ shadowRemoval: record })
    const tracks = [trackOf([item])]

    expect(frameReadsCleanedPiece(tracks, 45, 30)).toBe(true)
    // Local frames 5 and 65 are source frames 105 and 165: outside the piece.
    expect(frameReadsCleanedPiece(tracks, 15, 30)).toBe(false)
    expect(frameReadsCleanedPiece(tracks, 75, 30)).toBe(false)
  })

  it('keeps the renderer mapping: a 24 fps source in a 30 fps project', () => {
    // Timeline frame 30 is 1 s in, so source frame 24 at 24 fps; timeline 50 is source frame 40.
    const item = clip({ sourceStart: 0, sourceFps: 24, from: 0, shadowRemoval: piece(24, 12) })
    const tracks = [trackOf([item])]

    expect(frameReadsCleanedPiece(tracks, 30, 30)).toBe(true)
    expect(frameReadsCleanedPiece(tracks, 50, 30)).toBe(false)
  })

  it('is false outside the clip, on a hidden track, and without a piece', () => {
    const cleaned = clip({ shadowRemoval: piece(130, 30) })

    expect(frameReadsCleanedPiece([trackOf([cleaned])], 9, 30)).toBe(false)
    expect(frameReadsCleanedPiece([trackOf([cleaned])], 100, 30)).toBe(false)
    expect(frameReadsCleanedPiece([trackOf([cleaned], false)], 45, 30)).toBe(false)
    expect(frameReadsCleanedPiece([trackOf([clip()])], 45, 30)).toBe(false)
  })
})
