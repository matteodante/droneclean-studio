// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { analyzeMediaBeats } from '@/studio/beats/analyze'
import { createClipsApi } from '@/studio/sdk/namespaces/clips'
import { StudioError } from '@/studio/sdk/errors'
import { smoothEditClip, smoothEditLength } from './action'
import { listSongs, previewSmoothEdit, startLengthFor } from './timeline'

vi.mock('@/studio/beats/analyze', () => ({ analyzeMediaBeats: vi.fn() }))
const analyze = vi.mocked(analyzeMediaBeats)

const clips = createClipsApi()

/** A 120 bpm song at 30 fps: a beat every half second, the first at 1 s, so a bar is 60 frames and the first downbeat frame 30. */
const BEAT_SECONDS = Array.from({ length: 40 }, (_, index) => 1 + index * 0.5)

function seed(options: { songFrames?: number; clipCount?: number; shortLast?: boolean } = {}): void {
  const { songFrames = 600, clipCount = 4, shortLast = false } = options
  useItemsStore.getState().setTracks([
    makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 0 }),
    makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 1 }),
  ])
  useItemsStore.getState().setItems([
    makeTimelineAudioItem({
      id: 'song',
      mediaId: 'song-media',
      from: 0,
      durationInFrames: songFrames,
      sourceStart: 0,
      sourceEnd: songFrames,
      sourceDuration: songFrames,
    }),
    ...Array.from({ length: clipCount }, (_, index) =>
      makeTimelineVideoItem({
        id: `v${index + 1}`,
        trackId: 'track-v1',
        mediaId: `media-${index + 1}`,
        from: index * 200,
        durationInFrames: 200,
        sourceStart: 100,
        sourceEnd: 300,
        sourceDuration: shortLast && index === clipCount - 1 ? 130 : 800,
        sourceFps: 30,
        speed: 1,
        sourceWidth: 1920,
        sourceHeight: 1080,
      }),
    ),
  ])
}

function videoItems() {
  return useItemsStore
    .getState()
    .items.filter((item) => item.type === 'video')
    .toSorted((a, b) => a.from - b.from)
}

describe('smoothEditLength', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useTimelineCommandStore.getState().clearHistory()
    useProjectStore.setState({ currentProject: null })
  })

  it.each([
    [30, 30, 150],
    [30, 30, 187],
    [60, 60, 300],
    [24, 30, 100],
    [60, 30, 240],
  ])('equals what the action leaves: project %i fps, source %i fps, %i frames', (projectFps, sourceFps, frames) => {
    useTimelineSettingsStore.getState().setFps(projectFps)
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'a',
        from: 0,
        durationInFrames: frames,
        sourceStart: 0,
        sourceEnd: Math.round((frames * sourceFps) / projectFps),
        sourceDuration: 5000,
        sourceFps,
        speed: 1,
        sourceWidth: 1920,
        sourceHeight: 1080,
      }),
    ])
    const item = useItemsStore.getState().itemById['a']!
    const predicted = smoothEditLength(
      item.durationInFrames,
      item.sourceEnd! - item.sourceStart!,
      sourceFps,
      projectFps,
    )

    smoothEditClip('a')

    expect(useItemsStore.getState().itemById['a']!.durationInFrames).toBe(predicted)
  })

  it('startLengthFor finds a start length the recipe turns into exactly the shot', () => {
    for (const shot of [60, 120, 240, 59, 61]) {
      const start = startLengthFor(shot, 30, 30)
      expect(smoothEditLength(start, start, 30, 30)).toBe(shot)
    }
  })
})

describe('the smooth edit of the timeline', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useTimelineCommandStore.getState().clearHistory()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useMarkersStore.getState().setMarkers([])
    useTransitionsStore.getState().setTransitions([])
    analyze.mockReset()
    analyze.mockResolvedValue(BEAT_SECONDS)
  })

  it('lists the songs: audio clips that are not the sound of a video clip', () => {
    seed()
    useItemsStore.getState().setItems([
      ...useItemsStore.getState().items,
      makeTimelineAudioItem({ id: 'sound', linkedGroupId: 'g' }),
      makeTimelineVideoItem({ id: 'withSound', linkedGroupId: 'g', from: 900 }),
    ])

    expect(listSongs().map((song) => song.id)).toEqual(['song'])
  })

  it('says there is no song, and changes nothing, when the timeline has only video', async () => {
    seed()
    useItemsStore.getState().setItems(videoItems())
    const before = useItemsStore.getState().items

    await expect(clips.smoothEditTimeline()).rejects.toMatchObject({
      code: 'CONFLICT',
      hint: 'Add a song to the timeline first.',
    })
    expect(useItemsStore.getState().items).toBe(before)
    expect(analyze).not.toHaveBeenCalled()
  })

  it('lays the clips on the bars from the first downbeat, as one undo step, with the look and crossfades', async () => {
    seed()
    const depth = useTimelineCommandStore.getState().undoStack.length

    const result = await clips.smoothEditTimeline({ bars: 1, crossfade: true })

    expect(result.firstDownbeat).toBe(30)
    // The song is 600 frames long: the last two hits of the 40 fall after its end.
    expect(result.beats).toBe(38)
    expect(result.shots.map((shot) => [shot.clipId, shot.from, shot.durationInFrames])).toEqual([
      ['v1', 30, 60],
      ['v2', 90, 60],
      ['v3', 150, 60],
      ['v4', 210, 60],
    ])
    expect(result.crossfades).toBe(3)
    expect(useTimelineCommandStore.getState().undoStack.length).toBe(depth + 1)
    expect(useTimelineCommandStore.getState().undoStack.at(-1)?.command.type).toBe(
      'CLIPS_SMOOTH_EDIT_TIMELINE',
    )

    for (const item of videoItems()) {
      expect(item.speedCurve?.keys).toHaveLength(4)
      expect(item.motionBlur?.smoothSlowMotion).toBe('optical-flow')
      expect(item.sourceStart).toBe(100)
    }
    expect(useMarkersStore.getState().markers.map((marker) => marker.frame)).toHaveLength(38)
    expect(useTransitionsStore.getState().transitions).toHaveLength(3)
  })

  it('undoes whole with one Ctrl+Z', async () => {
    seed()
    const before = useItemsStore.getState().items.map((item) => ({ ...item }))

    await clips.smoothEditTimeline()
    useTimelineCommandStore.getState().undo()

    expect(useItemsStore.getState().items).toEqual(before)
    expect(useMarkersStore.getState().markers).toEqual([])
    expect(useTransitionsStore.getState().transitions).toEqual([])
  })

  it('adds no crossfade when it is off, and cuts two bars', async () => {
    seed()

    const result = await clips.smoothEditTimeline({ bars: 2, crossfade: false })

    expect(result.crossfades).toBe(0)
    expect(result.shots.map((shot) => [shot.from, shot.durationInFrames])).toEqual([
      [30, 120],
      [150, 120],
      [270, 120],
      [390, 120],
    ])
    expect(useTransitionsStore.getState().transitions).toEqual([])
  })

  it('keeps every clip, leaves what does not fit after the song, and a stabilized clip stays stabilized', async () => {
    seed({ songFrames: 210, clipCount: 5, shortLast: true })
    useItemsStore
      .getState()
      ._updateItem('v1', { stabilization: { smoothness: 0.5 } } as never)
    const ids = videoItems().map((item) => item.id)

    const result = await clips.smoothEditTimeline({ crossfade: false })

    expect(videoItems().map((item) => item.id).toSorted()).toEqual(ids.toSorted())
    expect(result.shots.map((shot) => shot.clipId)).toEqual(['v1', 'v2', 'v3'])
    expect(result.afterSong).toEqual(['v4', 'v5'])
    const after = videoItems().filter((item) => item.id === 'v4' || item.id === 'v5')
    expect(after[0]!.from).toBeGreaterThanOrEqual(210)
    expect(after[1]!.from).toBe(after[0]!.from + after[0]!.durationInFrames)
    expect(after[0]!.speedCurve).toBeUndefined()
    expect((useItemsStore.getState().itemById['v1'] as { stabilization?: unknown }).stabilization).toEqual({
      smoothness: 0.5,
    })
  })

  it('leaves a clip with too little footage as it is', async () => {
    seed({ clipCount: 3, shortLast: true })

    const result = await clips.smoothEditTimeline({ bars: 1, crossfade: false })

    // v3 has 30 frames of footage past its in-point: not enough for a one-bar shot.
    expect(result.tooShort).toEqual(['v3'])
    expect(useItemsStore.getState().itemById['v3']!.speedCurve).toBeUndefined()
    expect(result.shots.map((shot) => shot.clipId)).toEqual(['v1', 'v2'])
  })

  it('ends each shot on its beat for footage at another frame rate than the project', async () => {
    seed({ clipCount: 3 })
    for (const id of ['v1', 'v2', 'v3']) {
      useItemsStore.getState()._updateItem(id, { sourceFps: 24, sourceStart: 120, sourceEnd: 280 } as never)
    }

    const result = await clips.smoothEditTimeline({ crossfade: false })

    expect(result.shots.map((shot) => [shot.from, shot.durationInFrames])).toEqual([
      [30, 60],
      [90, 60],
      [150, 60],
    ])
    for (const shot of result.shots) {
      const item = useItemsStore.getState().itemById[shot.clipId]!
      expect(item.from + item.durationInFrames).toBeLessThanOrEqual(
        shot.from + shot.durationInFrames,
      )
    }
  })

  it('reports how many clips it will change before it changes any', async () => {
    seed({ songFrames: 210, clipCount: 5 })
    const before = useItemsStore.getState().items

    const preview = previewSmoothEdit('song', BEAT_SECONDS.map((seconds) => Math.round(seconds * 30)), 1)

    expect(preview.plan.shots).toHaveLength(3)
    expect(preview.plan.afterSong).toHaveLength(2)
    expect(preview.clipCount).toBe(5)
    expect(useItemsStore.getState().items).toBe(before)
  })

  it('refuses an option out of range or a clip that is not a song, changing nothing', async () => {
    seed()

    await expect(clips.smoothEditTimeline({ bars: 3 as never })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
    await expect(clips.smoothEditTimeline({ crossfade: 'yes' as never })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
    await expect(clips.smoothEditTimeline({ songId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(clips.smoothEditTimeline({ songId: 'v1' })).rejects.toBeInstanceOf(StudioError)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })
})
