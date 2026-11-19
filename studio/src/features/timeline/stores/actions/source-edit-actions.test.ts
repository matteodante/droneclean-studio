// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'

const mocks = vi.hoisted(() => ({
  mediaById: {} as Record<string, unknown>,
}))

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => ({ mediaById: mocks.mediaById }),
  },
}))

vi.mock('@/features/timeline/deps/projects', () => ({
  useProjectStore: {
    getState: () => ({
      currentProject: { metadata: { width: 1920, height: 1080, fps: 30 } },
    }),
  },
}))

vi.mock('@/features/timeline/deps/media-library-service', () => ({
  importMediaLibraryService: async () => ({
    mediaLibraryService: {
      getThumbnailBlobUrl: async () => null,
    },
  }),
}))

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  getMediaType: (mimeType: string) =>
    mimeType.startsWith('video')
      ? 'video'
      : mimeType.startsWith('audio')
        ? 'audio'
        : mimeType.startsWith('image')
          ? 'image'
          : 'unknown',
  resolveMediaUrl: async () => 'blob:source-media',
}))

import { makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { resetPlaybackPreviewState } from '@/shared/state/playback-preview-test-helpers'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { usePlaybackStore } from '@/shared/state/playback'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useSubclipsStore } from '@/studio/subclips'
import { performInsertEdit, performOverwriteEdit } from './source-edit-actions'

function setSourceMedia(overrides: Record<string, unknown> = {}) {
  mocks.mediaById = {
    'media-1': {
      id: 'media-1',
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      duration: 4, // seconds → 120 source frames at 30fps
      fps: 30,
      width: 1920,
      height: 1080,
      audioCodec: undefined, // video-only by default — keeps tests on one track
      ...overrides,
    },
  }
}

function trackItems(trackId: string): TimelineItem[] {
  return useItemsStore
    .getState()
    .items.filter((item) => item.trackId === trackId)
    .sort((a, b) => a.from - b.from)
}

describe('source edit actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore.getState().setTracks([
      makeTimelineTrack({
        id: 'track-v1',
        name: 'V1',
        kind: 'video',
        order: 0,
      }),
      makeTimelineTrack({
        id: 'track-a1',
        name: 'A1',
        kind: 'audio',
        order: 1,
      }),
    ])
    useItemsStore.getState().setItems([])
    useTransitionsStore.getState().setTransitions([])
    useSelectionStore.getState().setActiveTrack(null)
    useEditorStore.setState({
      sourcePreviewMediaId: 'media-1',
      sourcePatchVideoEnabled: true,
      sourcePatchAudioEnabled: true,
      sourcePatchVideoTrackId: null,
      sourcePatchAudioTrackId: null,
    })
    useSubclipsStore.getState().reset()
    useSourcePlayerStore.setState({
      inPoint: 30,
      outPoint: 90,
      marksByKey: {},
      activeSubclipId: null,
      activeWindow: null,
    })
    resetPlaybackPreviewState(0)
    setSourceMedia()
  })

  describe('performInsertEdit', () => {
    it('inserts the in/out range at the playhead on an empty track', async () => {
      usePlaybackStore.setState({ currentFrame: 10 })

      await performInsertEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        from: 10,
        durationInFrames: 60,
        sourceStart: 30,
        sourceEnd: 90,
        mediaId: 'media-1',
      })
      // Playhead advances to the end of the inserted clip
      expect(usePlaybackStore.getState().currentFrame).toBe(70)
      expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
    })

    it('splits a straddling clip and shifts downstream items right', async () => {
      useItemsStore.getState().setItems([
        makeTimelineVideoItem({
          id: 'existing',
          from: 0,
          durationInFrames: 120,
          sourceEnd: 120,
          sourceDuration: 120,
        }),
      ])
      usePlaybackStore.setState({ currentFrame: 50 })

      await performInsertEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(3)
      // Left half of the split stays put
      expect(items[0]).toMatchObject({ from: 0, durationInFrames: 50 })
      // Inserted clip occupies the cut
      expect(items[1]).toMatchObject({
        from: 50,
        durationInFrames: 60,
        mediaId: 'media-1',
      })
      // Right half shifted by the inserted duration
      expect(items[2]).toMatchObject({ from: 110, durationInFrames: 70 })
    })

    it('is undoable as a single entry', async () => {
      usePlaybackStore.setState({ currentFrame: 0 })
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      await performInsertEdit()
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

      useTimelineCommandStore.getState().undo()
      expect(useItemsStore.getState().items).toHaveLength(0)
    })

    it('does nothing when no source is open in the source monitor', async () => {
      useEditorStore.setState({ sourcePreviewMediaId: null })

      await performInsertEdit()

      expect(useItemsStore.getState().items).toHaveLength(0)
    })

    it('auto-creates a new track instead of editing onto a locked one', async () => {
      useItemsStore.getState().setTracks([
        makeTimelineTrack({
          id: 'track-v1',
          name: 'V1',
          kind: 'video',
          order: 0,
          locked: true,
        }),
        makeTimelineTrack({
          id: 'track-a1',
          name: 'A1',
          kind: 'audio',
          order: 1,
        }),
      ])
      usePlaybackStore.setState({ currentFrame: 0 })

      await performInsertEdit()

      // The locked track is skipped — a fresh video track receives the clip
      expect(trackItems('track-v1')).toHaveLength(0)
      const items = useItemsStore.getState().items
      expect(items).toHaveLength(1)
      const newTrack = useItemsStore.getState().tracks.find((t) => t.id === items[0]?.trackId)
      expect(newTrack?.locked).toBeFalsy()
      expect(newTrack?.id).not.toBe('track-v1')
    })

    it('creates a linked audio companion when the source has audio', async () => {
      setSourceMedia({ audioCodec: 'aac' })
      usePlaybackStore.setState({ currentFrame: 0 })

      await performInsertEdit()

      const videoItems = trackItems('track-v1')
      const audioItems = trackItems('track-a1')
      expect(videoItems).toHaveLength(1)
      expect(audioItems).toHaveLength(1)
      expect(videoItems[0]?.linkedGroupId).toBeTruthy()
      expect(audioItems[0]?.linkedGroupId).toBe(videoItems[0]?.linkedGroupId)
      expect(audioItems[0]).toMatchObject({ from: 0, durationInFrames: 60 })
    })
  })

  describe('performOverwriteEdit', () => {
    it('overwrites the middle of a clip, preserving head and tail', async () => {
      useItemsStore.getState().setItems([
        makeTimelineVideoItem({
          id: 'existing',
          from: 0,
          durationInFrames: 120,
          sourceEnd: 120,
          sourceDuration: 120,
        }),
      ])
      usePlaybackStore.setState({ currentFrame: 30 })

      await performOverwriteEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(3)
      expect(items[0]).toMatchObject({ from: 0, durationInFrames: 30 })
      expect(items[1]).toMatchObject({
        from: 30,
        durationInFrames: 60,
        mediaId: 'media-1',
      })
      expect(items[2]).toMatchObject({ from: 90, durationInFrames: 30 })
      // Timeline length unchanged — overwrite never shifts downstream content
      const last = items[2]!
      expect(last.from + last.durationInFrames).toBe(120)
      expect(usePlaybackStore.getState().currentFrame).toBe(90)
    })

    it('removes clips fully covered by the overwrite region', async () => {
      useItemsStore.getState().setItems([
        makeTimelineVideoItem({
          id: 'covered',
          from: 10,
          durationInFrames: 40,
        }),
      ])
      usePlaybackStore.setState({ currentFrame: 0 })

      await performOverwriteEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        from: 0,
        durationInFrames: 60,
        mediaId: 'media-1',
      })
      expect(items.find((item) => item.id === 'covered')).toBeUndefined()
    })

    it('trims only the overlapped tail of a preceding clip', async () => {
      useItemsStore.getState().setItems([
        makeTimelineVideoItem({
          id: 'head',
          from: 0,
          durationInFrames: 60,
          sourceEnd: 60,
        }),
      ])
      usePlaybackStore.setState({ currentFrame: 40 })

      await performOverwriteEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ from: 0, durationInFrames: 40 })
      expect(items[1]).toMatchObject({
        from: 40,
        durationInFrames: 60,
        mediaId: 'media-1',
      })
    })
  })

  describe('inside a subclip window', () => {
    // media-1 is 120 frames at 30 fps; the subclip is frames [40, 100) of it.
    function openSubclip(marks: { in: number | null; out: number | null }) {
      const subclip = useSubclipsStore.getState().create({
        mediaId: 'media-1',
        name: 'Gap',
        startFrame: 40,
        endFrame: 100,
        sourceFps: 30,
      })
      useSourcePlayerStore.setState({
        activeSubclipId: subclip.id,
        activeWindow: { start: 40, end: 100 },
        inPoint: marks.in,
        outPoint: marks.out,
      })
      return subclip
    }

    it('inserts exactly the window, with the parent frame numbers and the subclip name', async () => {
      openSubclip({ in: null, out: null })
      usePlaybackStore.setState({ currentFrame: 10 })

      await performInsertEdit()

      const items = trackItems('track-v1')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        from: 10,
        durationInFrames: 60,
        sourceStart: 40,
        sourceEnd: 100,
        mediaId: 'media-1',
        label: 'Gap',
      })
    })

    it('overwrites exactly the window', async () => {
      openSubclip({ in: null, out: null })
      useItemsStore.getState().setItems([
        makeTimelineVideoItem({
          id: 'covered',
          from: 0,
          durationInFrames: 200,
        }),
      ])
      usePlaybackStore.setState({ currentFrame: 20 })

      await performOverwriteEdit()

      const placed = trackItems('track-v1').find((item) => item.label === 'Gap')
      expect(placed).toMatchObject({
        from: 20,
        durationInFrames: 60,
        sourceStart: 40,
        sourceEnd: 100,
      })
    })

    it('places the marked range inside the window and keeps the file name for it', async () => {
      openSubclip({ in: 50, out: 70 })
      usePlaybackStore.setState({ currentFrame: 0 })

      await performInsertEdit()

      expect(trackItems('track-v1')[0]).toMatchObject({
        durationInFrames: 20,
        sourceStart: 50,
        sourceEnd: 70,
        label: 'clip.mp4',
      })
    })

    it('clamps stale marks that fall outside the window', async () => {
      openSubclip({ in: 10, out: 115 })
      usePlaybackStore.setState({ currentFrame: 0 })

      await performInsertEdit()

      expect(trackItems('track-v1')[0]).toMatchObject({
        sourceStart: 40,
        sourceEnd: 100,
      })
    })

    it('is one undo step', async () => {
      openSubclip({ in: null, out: null })
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      await performInsertEdit()
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

      useTimelineCommandStore.getState().undo()
      expect(trackItems('track-v1')).toHaveLength(0)
    })

    it('ignores a window that belongs to another media', async () => {
      const subclip = openSubclip({ in: null, out: null })
      useSubclipsStore.setState({
        subclips: [{ ...subclip, mediaId: 'other' }],
      })
      useSourcePlayerStore.setState({ inPoint: null, outPoint: null })

      await performInsertEdit()

      expect(trackItems('track-v1')[0]).toMatchObject({
        sourceStart: 0,
        sourceEnd: 120,
      })
    })
  })
})
