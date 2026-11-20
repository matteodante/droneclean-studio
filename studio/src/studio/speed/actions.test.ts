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

  it('keeps the start of a clip cut from the middle of its file', () => {
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'ramp',
        durationInFrames: 600,
        sourceStart: 1_200,
        sourceEnd: 1_800,
        sourceDuration: 4_000,
        sourceFps: 30,
        speed: 1,
      }),
    ])

    setSpeedCurve('ramp', RAMP_600)

    const edited = storedVideo()
    expect(edited.sourceStart).toBe(1_200)
    expect(edited.sourceEnd).toBe(1_800)
    expect(edited.durationInFrames).toBe(156)
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

  describe('ripple (task 11.3)', () => {
    /** The ramp clip, with a clip `gap` frames after its end on the same track and one more behind it. */
    function withClipsAfter(gap: number): void {
      useItemsStore.getState().setItems([
        makeRampItem(),
        makeTimelineVideoItem({ id: 'next', from: 600 + gap, durationInFrames: 100 }),
        makeTimelineVideoItem({ id: 'later', from: 800 + gap, durationInFrames: 100 }),
      ])
    }

    it('moves nothing when the clip grows into a gap that fits it', () => {
      withClipsAfter(500)
      // A flat 2.3x shape spends the 2,310 source frames in 1,004 frames, so the clip ends at
      // 1,004: inside the gap that runs to the next clip at 1,100.
      setSpeedCurve('ramp', { keys: [{ frame: 0, speed: 2.3 }] })

      expect(storedVideo().durationInFrames).toBe(1_004)
      expect(storedItem('next').from).toBe(1_100)
      expect(storedItem('later').from).toBe(1_300)
    })

    it('pushes the clips after it only by how far it passes the next clip', () => {
      withClipsAfter(100)
      // The clip now ends at 1,155 and the next one starts at 700: it passes it by 455.
      setSpeedCurve('ramp', { keys: [{ frame: 0, speed: 2 }] })

      expect(storedVideo().durationInFrames).toBe(1_155)
      expect(storedItem('next').from).toBe(1_155)
      expect(storedItem('later').from).toBe(1_355)
    })

    it('leaves the clips after it where they are when the clip gets shorter', () => {
      withClipsAfter(100)
      setSpeedCurve('ramp', { keys: [{ frame: 0, speed: 8 }] })

      expect(storedVideo().durationInFrames).toBeLessThan(600)
      expect(storedItem('next').from).toBe(700)
      expect(storedItem('later').from).toBe(900)
    })
  })

  it('stores the ease of a segment and sizes the clip by the eased average', () => {
    useItemsStore.getState().setItems([makeRampItem()])
    // 1x to 4x smooth over 600 frames averages 2.5x (smoothstep is symmetric), then holds: the
    // same 2,310 source frames take 2,310 / 2.5 frames.
    const eased: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1, ease: 'smooth' },
        { frame: 600, speed: 4 },
      ],
    }

    setSpeedCurve('ramp', eased)

    const edited = storedVideo()
    expect(edited.speedCurve?.keys[0]?.ease).toBe('smooth')
    expect(edited.speed).toBeCloseTo(2.5, 12)
    expect(edited.durationInFrames).toBe(Math.round(RAMP_SOURCE_FRAMES / 2.5))
    expect(edited.sourceEnd).toBe(RAMP_SOURCE_FRAMES)

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
