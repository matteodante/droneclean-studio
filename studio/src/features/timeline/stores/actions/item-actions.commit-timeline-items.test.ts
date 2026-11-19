// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'

import type { SubtitleSegmentItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { commitTimelineItems } from './item-actions'

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

const clip: VideoItem = {
  id: 'clip-1',
  type: 'video',
  trackId: 'track-video',
  from: 0,
  durationInFrames: 90,
  label: 'speech.wav',
  mediaId: 'media-1',
  src: 'blob:test',
  transcriptCaptions: {
    type: 'transcript',
    mediaId: 'media-1',
    enabled: true,
    updatedAt: 1,
    cues: [{ id: 'cue-1', startSeconds: 0, endSeconds: 2, text: 'Hello there' }],
  },
}

function makeSegment(id: string, trackId: string): SubtitleSegmentItem {
  return {
    id,
    type: 'subtitle',
    trackId,
    from: 0,
    durationInFrames: 60,
    label: 'Transcript',
    mediaId: 'media-1',
    source: { type: 'transcript', mediaId: 'media-1', clipId: 'clip-1' },
    cues: [{ id: 'new-cue', startSeconds: 0, endSeconds: 2, text: 'Hello there' }],
    color: '#fff',
  }
}

describe('commitTimelineItems', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore.getState().setItems([clip, makeSegment('caption-old', 'track-video')])
    useItemsStore.getState().setTracks([makeTrack('track-video', 1)])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
  })

  it('applies the track, removal, patch and insertion as a single undo step', () => {
    const captionTrack = makeTrack('track-captions', 0)

    commitTimelineItems({
      tracks: [captionTrack, makeTrack('track-video', 1)],
      removeIds: ['caption-old'],
      patches: [{ id: 'clip-1', updates: { transcriptCaptions: undefined } }],
      items: [makeSegment('caption-new', captionTrack.id)],
    })

    const state = useItemsStore.getState()
    expect(state.tracks.map((track) => track.id)).toEqual(['track-captions', 'track-video'])
    expect(state.items.map((item) => item.id).sort()).toEqual(['caption-new', 'clip-1'])
    expect((state.itemById['clip-1'] as VideoItem).transcriptCaptions).toBeUndefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    useTimelineCommandStore.getState().undo()

    const undone = useItemsStore.getState()
    expect(undone.tracks.map((track) => track.id)).toEqual(['track-video'])
    expect(undone.items.map((item) => item.id).sort()).toEqual(['caption-old', 'clip-1'])
    expect((undone.itemById['clip-1'] as VideoItem).transcriptCaptions?.enabled).toBe(true)
  })
})
