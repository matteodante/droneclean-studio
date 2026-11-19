// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import {
  makeTimelineVideoItem,
  resetTimelineItemsTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { timelineToSourceFrames } from '@/features/timeline/utils/source-calculations'
import { areaAt, averageSpeed, type SpeedCurve } from './curve'
import { sourceFramesAt } from './mapping'
import { setSpeedCurve } from './actions'

/** The 10-second ramp of design 7.1, section 5.2: 1x -> 4x, hold, 4x -> 1x over 600 frames. */
const RAMP_600: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}

/** What the ramp spends at equal rates: 2,310 source frames (design 7.1, section 5.2). */
const RAMP_SOURCE_FRAMES = 2_310

/** A video clip that plays the design's ramp over its whole 600 frames. */
function makeRampItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return makeTimelineVideoItem({
    id: 'ramp',
    durationInFrames: 600,
    sourceStart: 0,
    sourceEnd: RAMP_SOURCE_FRAMES,
    sourceDuration: 4_000,
    sourceFps: 30,
    speed: 3.85,
    speedCurve: RAMP_600,
    ...overrides,
  })
}

function storedItem(id = 'ramp'): TimelineItem {
  return useItemsStore.getState().itemById[id]!
}

function storedVideo(id = 'ramp'): VideoItem {
  return storedItem(id) as VideoItem
}

describe('setSpeedCurve', () => {
  beforeEach(() => {
    resetTimelineItemsTestState()
    useTimelineCommandStore.getState().clearHistory()
  })

  it('edits the curve as one undo entry, and undo puts the previous curve back', () => {
    useItemsStore.getState().setItems([makeRampItem()])
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)

    // A flat 2x shape: the clip spends its 2,310 source frames at 2x, so its length halves. A
    // curve that holds one speed is that speed (review finding T6): no curve is stored.
    setSpeedCurve('ramp', { keys: [{ frame: 0, speed: 2 }] })

    const edited = storedVideo()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(edited.durationInFrames).toBe(1_155)
    expect(edited.speed).toBe(2)
    expect(edited.sourceStart).toBe(0)
    expect(edited.sourceEnd).toBe(RAMP_SOURCE_FRAMES)
    expect(edited.speedCurve).toBeUndefined()
    // Every length calculation still reads `speed` and gets the span the curve spends.
    expect(timelineToSourceFrames(1_155, edited.speed!, 30, 30)).toBe(RAMP_SOURCE_FRAMES)

    useTimelineCommandStore.getState().undo()

    const restored = storedVideo()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    expect(restored.durationInFrames).toBe(600)
    expect(restored.sourceEnd).toBe(RAMP_SOURCE_FRAMES)
    expect(restored.speed).toBe(averageSpeed(RAMP_600))
    expect(restored.speedCurve?.keys).toEqual(RAMP_600.keys)
  })

  it('keeps the source span and moves the length by the shape, its keys scaled with it', () => {
    useItemsStore.getState().setItems([makeRampItem()])
    // 0.5x for half the clip then 2x: 525 speed-frames over 600, so the average is 0.875 and
    // the same 2,310 source frames take 2,640 frames.
    const shape: SpeedCurve = {
      keys: [
        { frame: 0, speed: 0.5 },
        { frame: 300, speed: 0.5 },
        { frame: 600, speed: 2 },
      ],
    }
    expect(areaAt(shape, 600)).toBe(525)

    setSpeedCurve('ramp', shape)

    const edited = storedVideo()
    expect(edited.durationInFrames).toBe(2_640)
    expect(edited.speed).toBe(0.875)
    expect(edited.speedCurve?.keys).toEqual([
      { frame: 0, speed: 0.5 },
      { frame: 1_320, speed: 0.5 },
      { frame: 2_640, speed: 2 },
    ])
    expect(edited.sourceEnd).toBe(RAMP_SOURCE_FRAMES)
    // The design's rule for the source end: the new curve's integral at the new length.
    expect(
      Math.round(
        sourceFramesAt(edited.speedCurve!, 2_640, { num: 30, den: 1 }, { num: 30, den: 1 }),
      ),
    ).toBe(RAMP_SOURCE_FRAMES)
  })

  it('puts a curve on a constant clip and gives it the length the shape needs', () => {
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'ramp',
        durationInFrames: 600,
        sourceStart: 0,
        sourceEnd: 600,
        sourceDuration: 4_000,
        sourceFps: 30,
        speed: 1,
      }),
    ])

    setSpeedCurve('ramp', RAMP_600)

    const edited = storedVideo()
    // 600 source frames at the ramp's 3.85x take 156 frames, and the shape's keys land on
    // whole frames: 30/600 -> 8, 570/600 -> 148.
    expect(edited.durationInFrames).toBe(156)
    expect(edited.speed).toBe(averageSpeed(edited.speedCurve!))
    expect(edited.speedCurve?.keys).toEqual([
      { frame: 0, speed: 1 },
      { frame: 8, speed: 4 },
      { frame: 148, speed: 4 },
      { frame: 156, speed: 1 },
    ])
    expect(edited.sourceEnd).toBe(600)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('reads the span of a curved clip that has no explicit source bounds from its curve', () => {
    useItemsStore.getState().setItems([makeRampItem({ sourceEnd: undefined })])

    setSpeedCurve('ramp', { keys: [{ frame: 0, speed: 2 }] })

    const edited = storedVideo()
    expect(edited.durationInFrames).toBe(1_155)
    expect(edited.speed).toBe(2)
    expect(edited.sourceEnd).toBe(RAMP_SOURCE_FRAMES)
  })

  it('drops the cut remainder on a curve edit, which re-authors the mapping, the first frame unchanged', () => {
    // The time-core brief's rule: a curve edit re-authors the mapping, so the remainder goes;
    // `floor(rem) = 0`, so the clip's first frame still shows `sourceStart`.
    useItemsStore.getState().setItems([makeRampItem({ sourceFrameOffset: { num: 1, den: 2 } })])
    expect(storedVideo().sourceFrameOffset).toEqual({ num: 1, den: 2 })

    setSpeedCurve('ramp', {
      keys: [
        { frame: 0, speed: 2 },
        { frame: 600, speed: 3 },
      ],
    })

    const edited = storedVideo()
    expect(edited.speedCurve).toBeDefined()
    expect(edited.sourceFrameOffset).toBeUndefined()
    expect(edited.sourceStart).toBe(0)

    useItemsStore.getState().setItems([makeRampItem({ sourceFrameOffset: { num: 1, den: 2 } })])
    setSpeedCurve('ramp', null)

    expect(storedVideo().speedCurve).toBeUndefined()
    expect(storedVideo().sourceFrameOffset).toBeUndefined()
  })

  it('removes the curve with null, leaving one speed at its average and the same length', () => {
    useItemsStore.getState().setItems([makeRampItem()])

    setSpeedCurve('ramp', null)

    const cleared = storedVideo()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(cleared.speedCurve).toBeUndefined()
    expect(cleared.durationInFrames).toBe(600)
    expect(cleared.speed).toBe(averageSpeed(RAMP_600))
    expect(cleared.sourceEnd).toBe(RAMP_SOURCE_FRAMES)

    useTimelineCommandStore.getState().undo()
    expect(storedVideo().speedCurve?.keys).toEqual(RAMP_600.keys)
  })

  it('leaves a reversed clip alone: v1 hides a curve there, it does not map it', () => {
    useItemsStore.getState().setItems([makeRampItem({ isReversed: true })])
    expect(storedItem().speedCurve).toBeUndefined()

    setSpeedCurve('ramp', RAMP_600)

    expect(storedVideo().speedCurve).toBeUndefined()
    expect(storedVideo().durationInFrames).toBe(600)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('leaves a clip of a kind the renderer never maps the curve for', () => {
    const title: TextItem = {
      id: 'title',
      type: 'text',
      trackId: 'track-text',
      from: 0,
      durationInFrames: 60,
      label: 'Title',
      text: 'Title',
      color: '#ffffff',
    }
    useItemsStore.getState().setItems([title])

    setSpeedCurve('title', RAMP_600)

    expect(storedItem('title').speedCurve).toBeUndefined()
    expect(storedItem('title').durationInFrames).toBe(60)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })
})
