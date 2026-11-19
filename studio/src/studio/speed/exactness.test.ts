/**
 * The review's reproductions of the timing findings (docs/reviews/2026-11-18-findings.md, T1,
 * T3, T4, T6, T7, T8), as fixed cases: each one failed on the code the review read, and each
 * compares what a reader shows — the preview's and the export's own mapping — with what the
 * clip showed before the edit.
 */

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { resetTimelineItemsTestState } from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { rateStretchItemWithoutHistory } from '@/features/timeline/stores/actions/item-actions'
import {
  joinItems,
  splitItem,
  trimItemStart,
} from '@/features/timeline/stores/actions/item-edit-actions'
import { convertTimelineToComposition } from '@/features/export/utils/timeline-to-composition'
import { getVideoTargetTimeSeconds } from '@/runtime/composition-runtime/utils/video-timing'
import {
  getItemRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
} from '@/runtime/renderer/render-span'
import { secondsToFrame, toRate } from '@/studio/time'
import { createClipsApi } from '@/studio/sdk/namespaces/clips'
import { keySourceFrame } from './panel/curve-on-item'
import { setSpeedCurve } from './actions'
import type { SpeedCurve } from './curve'
import { MAX_RAMP_SEGMENT_FRAMES } from './normalize'

/** The source frame the preview's mapping shows at a clip frame. */
function previewFrame(item: VideoItem, clipFrame: number, fps: number): number {
  const sourceFps = item.sourceFps ?? fps
  const seconds = getVideoTargetTimeSeconds(
    item.sourceStart ?? 0,
    sourceFps,
    clipFrame,
    item.speed ?? 1,
    fps,
    0,
    false,
    undefined,
    item.speedCurve,
    item.sourceFrameOffset,
  )
  return secondsToFrame(toRate(sourceFps), seconds)
}

/** The source frame the export's (canvas) mapping shows at a clip frame. */
function exportFrame(item: VideoItem, clipFrame: number, fps: number): number {
  const sourceFps = item.sourceFps ?? fps
  const seconds = resolveVideoRenderSourceTimeSeconds(
    item,
    getItemRenderTimelineSpan(item),
    item.from + clipFrame,
    fps,
  )
  return secondsToFrame(toRate(sourceFps), seconds)
}

function videoItem(overrides: Partial<VideoItem>): VideoItem {
  return {
    id: 'clip',
    type: 'video',
    trackId: 'track-v',
    from: 0,
    durationInFrames: 100,
    label: 'clip.mp4',
    src: 'blob:clip',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceDuration: 1_000_000,
    ...overrides,
  }
}

/** The parent's frames through both readers, which must agree before anything is compared. */
function parentFrames(item: VideoItem, fps: number): number[] {
  return Array.from({ length: item.durationInFrames }, (_, frame) => {
    const shown = previewFrame(item, frame, fps)
    expect(exportFrame(item, frame, fps), `parent frame ${frame}`).toBe(shown)
    return shown
  })
}

function split(id: string, clipFrame: number): { left: VideoItem; right: VideoItem } {
  const item = useItemsStore.getState().itemById[id]!
  const result = useItemsStore.getState()._splitItem(id, item.from + clipFrame)!
  return { left: result.leftItem as VideoItem, right: result.rightItem as VideoItem }
}

describe('a split shows the parent’s source frames (T3, T4)', () => {
  beforeEach(() => resetTimelineItemsTestState())

  it('the review’s ramp: keys (0, 5.02) (171, 2.46) cut at 1 shows source frame 482 at parent frame 114', () => {
    useTimelineSettingsStore.setState({ fps: 30 })
    const parent = videoItem({
      id: 'ramp',
      durationInFrames: 171,
      sourceStart: 7,
      sourceFps: 30,
      speedCurve: {
        keys: [
          { frame: 0, speed: 5.02 },
          { frame: 171, speed: 2.46 },
        ],
      },
    })
    useItemsStore.getState().setItems([parent])
    const frames = parentFrames(useItemsStore.getState().itemById['ramp'] as VideoItem, 30)
    expect(frames[114]).toBe(482)

    const { right } = split('ramp', 1)
    expect(previewFrame(right, 113, 30)).toBe(482)
    expect(exportFrame(right, 113, 30)).toBe(482)
    for (let frame = 1; frame < 171; frame++) {
      expect(previewFrame(right, frame - 1, 30), `parent frame ${frame}`).toBe(frames[frame])
      expect(exportFrame(right, frame - 1, 30), `parent frame ${frame}`).toBe(frames[frame])
    }
  })

  it('a constant 29.97 clip in a 59.94 project split at an odd frame keeps every frame', () => {
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useItemsStore.getState().setItems([videoItem({ durationInFrames: 199, sourceFps: 29.97 })])
    const frames = parentFrames(useItemsStore.getState().itemById['clip'] as VideoItem, 59.94)

    const { left, right } = split('clip', 99)
    for (let frame = 0; frame < 99; frame++) {
      expect(previewFrame(left, frame, 59.94), `left frame ${frame}`).toBe(frames[frame])
    }
    for (let frame = 99; frame < 199; frame++) {
      expect(previewFrame(right, frame - 99, 59.94), `parent frame ${frame}`).toBe(frames[frame])
      expect(exportFrame(right, frame - 99, 59.94), `parent frame ${frame}`).toBe(frames[frame])
    }
  })

  it('an in/out export of a constant 29.97 clip in a 59.94 project starting on an odd frame keeps every frame', () => {
    const track: TimelineTrack = {
      id: 'track-v',
      name: 'V1',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    }
    const parent = videoItem({ durationInFrames: 199, sourceFps: 29.97, sourceEnd: 100 })
    const frames = parentFrames(parent, 59.94)
    const composition = convertTimelineToComposition(
      [track],
      [parent],
      [],
      59.94,
      1920,
      1080,
      99,
      199,
    )
    const exported = composition.tracks[0]!.items[0] as VideoItem
    for (let frame = 99; frame < 199; frame++) {
      expect(exportFrame(exported, frame - 99, 59.94), `parent frame ${frame}`).toBe(frames[frame])
    }
  })
})

describe('a curve edit reaches the clip’s linked audio (T1)', () => {
  beforeEach(() => resetTimelineItemsTestState())

  it('gives the linked audio clip the same curve, length and source span as its video', () => {
    useTimelineSettingsStore.setState({ fps: 30 })
    const video = videoItem({
      linkedGroupId: 'group',
      durationInFrames: 120,
      sourceEnd: 120,
      sourceFps: 30,
    })
    const audio: AudioItem = {
      id: 'clip-audio',
      type: 'audio',
      trackId: 'track-a',
      from: 0,
      durationInFrames: 120,
      label: 'clip.mp4',
      src: 'blob:clip',
      mediaId: 'media-1',
      linkedGroupId: 'group',
      sourceStart: 0,
      sourceEnd: 120,
      sourceDuration: 1_000_000,
      sourceFps: 30,
    }
    useItemsStore.getState().setItems([video, audio])

    setSpeedCurve('clip', {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 60, speed: 3 },
        { frame: 120, speed: 1 },
      ],
    })

    const after = useItemsStore.getState().itemById
    const videoAfter = after['clip']!
    const audioAfter = after['clip-audio']!
    expect(videoAfter.speedCurve).toBeDefined()
    expect(audioAfter.speedCurve).toEqual(videoAfter.speedCurve)
    expect(audioAfter.durationInFrames).toBe(videoAfter.durationInFrames)
    expect(audioAfter.sourceEnd).toBe(videoAfter.sourceEnd)
    expect(audioAfter.speed).toBe(videoAfter.speed)
  })
})

describe('the linked audio keeps the video’s mapping through every edit (T1)', () => {
  beforeEach(() => resetTimelineItemsTestState())

  /** The timing fields a video and its linked audio must share after any edit. */
  function timingOf(id: string): unknown {
    const item = useItemsStore.getState().itemById[id]!
    return {
      from: item.from,
      durationInFrames: item.durationInFrames,
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
      speed: item.speed,
      speedCurve: item.speedCurve,
      sourceFrameOffset: item.sourceFrameOffset,
    }
  }

  function linkedPair(): void {
    useTimelineSettingsStore.setState({ fps: 59.94 })
    const shared = {
      from: 0,
      durationInFrames: 171,
      label: 'clip.mp4',
      src: 'blob:clip',
      mediaId: 'media-1',
      linkedGroupId: 'group',
      sourceStart: 7,
      sourceEnd: 7 + 171,
      sourceDuration: 1_000_000,
      sourceFps: 29.97,
    }
    useItemsStore
      .getState()
      .setItems([
        { ...shared, id: 'clip', type: 'video', trackId: 'track-v' } as VideoItem,
        { ...shared, id: 'clip-audio', type: 'audio', trackId: 'track-a' } as AudioItem,
      ])
    setSpeedCurve('clip', {
      keys: [
        { frame: 0, speed: 5.02 },
        { frame: 171, speed: 2.46 },
      ],
    })
  }

  it('splits, trims and joins both clips to the same timing, remainder and curve', () => {
    linkedPair()
    expect(timingOf('clip-audio')).toEqual(timingOf('clip'))

    const halves = splitItem('clip', 37)!
    const items = useItemsStore.getState().items
    const rightVideo = halves.rightItem
    const rightAudio = items.find(
      (item) => item.type === 'audio' && item.from === rightVideo.from && item.id !== 'clip-audio',
    )!
    expect(rightVideo.sourceFrameOffset).toBeDefined()
    expect({ ...(timingOf(rightAudio.id) as object) }).toEqual(timingOf(rightVideo.id))
    expect(timingOf('clip-audio')).toEqual(timingOf('clip'))

    trimItemStart(rightVideo.id, 11)
    expect(timingOf(rightAudio.id)).toEqual(timingOf(rightVideo.id))

    trimItemStart(rightVideo.id, -11)
    joinItems(['clip', rightVideo.id])
    expect(timingOf('clip-audio')).toEqual(timingOf('clip'))
  })
})

describe('the ramp-length limit at the curve edit (option G)', () => {
  beforeEach(() => resetTimelineItemsTestState())

  it('refuses a curve whose ramp is longer than 83,886 frames, leaving the clip as it was', () => {
    useTimelineSettingsStore.setState({ fps: 60 })
    const length = MAX_RAMP_SEGMENT_FRAMES + 1
    useItemsStore
      .getState()
      .setItems([videoItem({ durationInFrames: length, sourceEnd: length, sourceFps: 60 })])

    setSpeedCurve('clip', {
      keys: [
        { frame: 0, speed: 1 },
        { frame: length, speed: 1.01 },
      ],
    })

    const item = useItemsStore.getState().itemById['clip']!
    expect(item.speedCurve).toBeUndefined()
    expect(item.durationInFrames).toBe(length)
    expect(item.sourceEnd).toBe(length)
  })
})

describe('re-authoring the mapping drops the remainder, through the SDK too', () => {
  beforeEach(() => resetTimelineItemsTestState())

  it('clears the curve and the cut remainder when clips.setSpeed sets the speed a curved clip averages', () => {
    useTimelineSettingsStore.setState({ fps: 30 })
    useItemsStore.getState().setItems([
      videoItem({
        durationInFrames: 100,
        sourceStart: 12,
        sourceEnd: 212,
        sourceFps: 30,
        speedCurve: {
          keys: [
            { frame: 0, speed: 1 },
            { frame: 100, speed: 3 },
          ],
        },
        sourceFrameOffset: { num: 1, den: 4 },
      }),
    ])
    const before = useItemsStore.getState().itemById['clip']!
    expect(before.speed).toBe(2)

    createClipsApi().setSpeed('clip', 2)

    const after = useItemsStore.getState().itemById['clip']!
    expect(after.speedCurve).toBeUndefined()
    expect(after.sourceFrameOffset).toBeUndefined()
    expect(after.sourceStart).toBe(12)
  })
})

describe('a constant curve is a constant speed (T6)', () => {
  beforeEach(() => resetTimelineItemsTestState())

  it('stores a curve whose keys all hold one speed as that speed and no curve', () => {
    useTimelineSettingsStore.setState({ fps: 30 })
    useItemsStore
      .getState()
      .setItems([videoItem({ durationInFrames: 120, sourceEnd: 240, sourceFps: 30, speed: 2 })])

    setSpeedCurve('clip', {
      keys: [
        { frame: 0, speed: 2 },
        { frame: 120, speed: 2 },
      ],
    })

    const item = useItemsStore.getState().itemById['clip']!
    expect(item.speedCurve).toBeUndefined()
    expect(item.speed).toBe(2)
  })
})

describe('dragging the edge of a curved clip (T7)', () => {
  beforeEach(() => resetTimelineItemsTestState())

  const ramp: SpeedCurve = {
    keys: [
      { frame: 0, speed: 1 },
      { frame: 37, speed: 4 },
      { frame: 100, speed: 1 },
    ],
  }

  function curvedClip(): VideoItem {
    useItemsStore
      .getState()
      .setItems([
        videoItem({ durationInFrames: 100, sourceStart: 10, sourceFps: 30, speedCurve: ramp }),
      ])
    // The store writes the curve's own source span when the clip is set up through the action.
    const item = useItemsStore.getState().itemById['clip'] as VideoItem
    const end = previewFrame(item, 100, 30)
    useItemsStore.getState()._updateItem('clip', { sourceEnd: end })
    return useItemsStore.getState().itemById['clip'] as VideoItem
  }

  it('recomputes the source end from the stretched curve', () => {
    useTimelineSettingsStore.setState({ fps: 30 })
    const before = curvedClip()
    rateStretchItemWithoutHistory('clip', 0, 73, before.speed!, { keepSpeedCurve: true })

    const after = useItemsStore.getState().itemById['clip'] as VideoItem
    expect(after.durationInFrames).toBe(73)
    expect(after.speedCurve).toBeDefined()
    // The clip plays exactly to its source end: the frame after its last is the end.
    expect(after.sourceEnd).toBe(previewFrame(after, 73, 30))
    expect(exportFrame(after, 72, 30)).toBeLessThanOrEqual(after.sourceEnd!)
  })

  it('refuses a stretch that would push a key past the speed limit, instead of clamping it', () => {
    useTimelineSettingsStore.setState({ fps: 30 })
    const before = curvedClip()
    // Into a third of its length: the 4x key would need 12x, past the 10x limit.
    rateStretchItemWithoutHistory('clip', 0, 33, before.speed! * 3, { keepSpeedCurve: true })

    const after = useItemsStore.getState().itemById['clip'] as VideoItem
    expect(after.durationInFrames).toBe(100)
    expect(after.speedCurve).toEqual(before.speedCurve)
    expect(after.sourceEnd).toBe(before.sourceEnd)
  })
})

describe('every reader asks the same mapping (T8)', () => {
  beforeEach(() => resetTimelineItemsTestState())

  it('the curve panel’s key rows show the frame the preview shows, remainder included', () => {
    useTimelineSettingsStore.setState({ fps: 30 })
    useItemsStore.getState().setItems([
      videoItem({
        id: 'ramp',
        durationInFrames: 171,
        sourceStart: 7,
        sourceFps: 30,
        speedCurve: {
          keys: [
            { frame: 0, speed: 5.02 },
            { frame: 171, speed: 2.46 },
          ],
        },
      }),
    ])
    const { right } = split('ramp', 1)
    // A key can sit on any frame of the clip: the row's source frame is the preview's at each.
    for (let frame = 0; frame < right.durationInFrames; frame++) {
      expect(keySourceFrame(right.speedCurve!, frame, right, 30), `frame ${frame}`).toBe(
        previewFrame(right, frame, 30),
      )
    }
  })

  it('a curve edit writes the source end the mapping reaches, not a rounded one', () => {
    useTimelineSettingsStore.setState({ fps: 30 })
    useItemsStore
      .getState()
      .setItems([videoItem({ durationInFrames: 100, sourceEnd: 100, sourceFps: 30 })])

    setSpeedCurve('clip', {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 33, speed: 2.17 },
        { frame: 100, speed: 1.41 },
      ],
    })

    const item = useItemsStore.getState().itemById['clip'] as VideoItem
    expect(item.sourceEnd).toBe(previewFrame(item, item.durationInFrames, 30))
  })
})
