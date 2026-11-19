// @vitest-environment node

import { describe, it, expect, beforeEach } from 'vite-plus/test'
import {
  areaAt,
  clipSourcePosition,
  sourceFramesAt,
  type SourceRemainder,
  type SpeedCurve,
} from '@/studio/speed'
import type { Rate } from '@/studio/time'
import { clampToAdjacentItems, clampTrimAmount, calculateTrimSourceUpdate } from './trim-utils'
import { useCompositionsStore } from '../stores/compositions-store'
import type { TimelineItem } from '@/types/timeline'

const RATE_30: Rate = { num: 30, den: 1 }

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

function makeItem(
  overrides: Partial<TimelineItem> & {
    id: string
    trackId: string
    from: number
    durationInFrames: number
  },
): TimelineItem {
  return {
    type: 'image',
    label: 'test',
    src: '',
    ...overrides,
  } as TimelineItem
}

describe('clampToAdjacentItems', () => {
  const trackId = 'track-1'

  describe('end handle (extending right)', () => {
    it('passes through when no neighbors exist', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 })
      const result = clampToAdjacentItems(item, 'end', 50, [item])
      expect(result).toBe(50)
    })

    it('clamps to gap before next item', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 })
      const neighbor = makeItem({ id: 'b', trackId, from: 120, durationInFrames: 50 })
      // Gap is 20 frames, requesting 50
      const result = clampToAdjacentItems(item, 'end', 50, [item, neighbor])
      expect(result).toBe(20)
    })

    it('returns 0 when neighbor is exactly touching', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 })
      const neighbor = makeItem({ id: 'b', trackId, from: 100, durationInFrames: 50 })
      const result = clampToAdjacentItems(item, 'end', 10, [item, neighbor])
      expect(result).toBe(0)
    })

    it('passes through when trimAmount fits within gap', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 })
      const neighbor = makeItem({ id: 'b', trackId, from: 150, durationInFrames: 50 })
      // Gap is 50, requesting 30
      const result = clampToAdjacentItems(item, 'end', 30, [item, neighbor])
      expect(result).toBe(30)
    })

    it('picks the nearest neighbor when multiple exist', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 })
      const far = makeItem({ id: 'b', trackId, from: 200, durationInFrames: 50 })
      const near = makeItem({ id: 'c', trackId, from: 110, durationInFrames: 50 })
      // Nearest gap is 10
      const result = clampToAdjacentItems(item, 'end', 50, [item, far, near])
      expect(result).toBe(10)
    })

    it('ignores items on different tracks', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 })
      const otherTrack = makeItem({ id: 'b', trackId: 'track-2', from: 100, durationInFrames: 50 })
      const result = clampToAdjacentItems(item, 'end', 50, [item, otherTrack])
      expect(result).toBe(50)
    })
  })

  describe('start handle (extending left)', () => {
    it('passes through when no neighbors exist to the left', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 })
      const result = clampToAdjacentItems(item, 'start', -50, [item])
      expect(result).toBe(-50)
    })

    it('clamps to gap after previous item', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 })
      const neighbor = makeItem({ id: 'b', trackId, from: 0, durationInFrames: 80 })
      // Gap is 20 frames, requesting -50
      const result = clampToAdjacentItems(item, 'start', -50, [item, neighbor])
      expect(result).toBe(-20)
    })

    it('returns 0 when neighbor is exactly touching', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 })
      const neighbor = makeItem({ id: 'b', trackId, from: 0, durationInFrames: 100 })
      const result = clampToAdjacentItems(item, 'start', -10, [item, neighbor])
      expect(result).toBe(0)
    })

    it('passes through when trimAmount fits within gap', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 })
      const neighbor = makeItem({ id: 'b', trackId, from: 0, durationInFrames: 50 })
      // Gap is 50, requesting -30
      const result = clampToAdjacentItems(item, 'start', -30, [item, neighbor])
      expect(result).toBe(-30)
    })

    it('ignores items on different tracks', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 })
      const otherTrack = makeItem({ id: 'b', trackId: 'track-2', from: 50, durationInFrames: 100 })
      const result = clampToAdjacentItems(item, 'start', -80, [item, otherTrack])
      expect(result).toBe(-80)
    })
  })

  describe('clampTrimAmount for composition items', () => {
    beforeEach(() => {
      useCompositionsStore.setState({
        compositions: [],
        compositionById: {},
        mediaDependencyIds: [],
        mediaDependencyVersion: 0,
      })
    })

    it('uses live sub-comp duration instead of stale cached sourceDuration when extending', () => {
      useCompositionsStore.getState().addComposition({
        id: 'sub-1',
        name: 'Sub',
        items: [],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 10800,
      })

      const wrapper = {
        type: 'composition',
        id: 'wrap-1',
        trackId,
        compositionId: 'sub-1',
        from: 0,
        durationInFrames: 3902,
        sourceStart: 0,
        sourceEnd: 3902,
        sourceDuration: 3902,
        sourceFps: 30,
        speed: 1,
      } as unknown as TimelineItem

      const result = clampTrimAmount(wrapper, 'end', 3000, 30)
      expect(result.clampedAmount).toBe(3000)
      expect(result.maxExtend).toBe(10800 - 3902)
    })

    it('uses live sub-comp duration for composition audio wrapper (type=audio with compositionId)', () => {
      useCompositionsStore.getState().addComposition({
        id: 'sub-audio',
        name: 'Sub',
        items: [],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 10800,
      })

      const audioWrapper = {
        type: 'audio',
        id: 'wrap-audio',
        trackId,
        compositionId: 'sub-audio',
        linkedGroupId: 'lg-1',
        from: 0,
        durationInFrames: 3902,
        sourceStart: 0,
        sourceEnd: 3902,
        sourceDuration: 3902,
        sourceFps: 30,
        speed: 1,
      } as unknown as TimelineItem

      const result = clampTrimAmount(audioWrapper, 'end', 3000, 30)
      expect(result.clampedAmount).toBe(3000)
      expect(result.maxExtend).toBe(10800 - 3902)
    })

    it('calculateTrimSourceUpdate respects live sub-comp duration when clamping sourceEnd', () => {
      useCompositionsStore.getState().addComposition({
        id: 'sub-2',
        name: 'Sub',
        items: [],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 10800,
      })

      const wrapper = {
        type: 'composition',
        id: 'wrap-2',
        trackId,
        compositionId: 'sub-2',
        from: 0,
        durationInFrames: 3902,
        sourceStart: 0,
        sourceEnd: 3902,
        sourceDuration: 3902,
        sourceFps: 30,
        speed: 1,
      } as unknown as TimelineItem

      const update = calculateTrimSourceUpdate(wrapper, 'end', 3000, 6902, 30)
      expect(update?.sourceEnd).toBe(6902)
    })
  })

  describe('shrinking (no clamping needed)', () => {
    it('passes through end handle shrinking (negative trimAmount)', () => {
      const item = makeItem({ id: 'a', trackId, from: 0, durationInFrames: 100 })
      const neighbor = makeItem({ id: 'b', trackId, from: 100, durationInFrames: 50 })
      const result = clampToAdjacentItems(item, 'end', -20, [item, neighbor])
      expect(result).toBe(-20)
    })

    it('passes through start handle shrinking (positive trimAmount)', () => {
      const item = makeItem({ id: 'a', trackId, from: 100, durationInFrames: 100 })
      const neighbor = makeItem({ id: 'b', trackId, from: 0, durationInFrames: 100 })
      const result = clampToAdjacentItems(item, 'start', 20, [item, neighbor])
      expect(result).toBe(20)
    })
  })

  describe('reversed media source bounds', () => {
    const reversed = makeItem({
      id: 'reversed',
      trackId,
      from: 0,
      durationInFrames: 60,
      type: 'video',
      isReversed: true,
      sourceStart: 60,
      sourceEnd: 120,
      sourceDuration: 180,
      sourceFps: 30,
      speed: 1,
    })

    it('trimming the timeline start moves sourceEnd backward', () => {
      expect(calculateTrimSourceUpdate(reversed, 'start', 15, 45, 30)).toEqual({
        sourceEnd: 105,
      })
    })

    it('extending the timeline end moves sourceStart backward and clamps at zero', () => {
      expect(calculateTrimSourceUpdate(reversed, 'end', 30, 90, 30)).toEqual({
        sourceStart: 30,
      })
      expect(clampTrimAmount(reversed, 'end', 100, 30).clampedAmount).toBe(60)
    })

    it('clamps the end of a reversed clip that has no source duration', () => {
      const noDuration = { ...reversed, id: 'reversed-no-duration', sourceDuration: undefined }
      expect(clampTrimAmount(noDuration, 'end', 100, 30).clampedAmount).toBe(60)
    })

    it('extending the timeline start moves sourceEnd toward source duration', () => {
      expect(calculateTrimSourceUpdate(reversed, 'start', -30, 90, 30)).toEqual({
        sourceEnd: 150,
      })
      expect(clampTrimAmount(reversed, 'start', -100, 30).clampedAmount).toBe(-60)
    })
  })
})

/**
 * A trimmable clip's curve, and what the edits of design 7.1, section 4.6 must do with it: each
 * trimmed or split range keeps the parent's mapping on that range, frame by frame, and a rate
 * stretch keeps the shape and the source span.
 */
describe('speed curves through trim-utils', () => {
  const trackId = 'track-1'

  function makeRampItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
    return makeItem({
      id: 'ramp',
      trackId,
      from: 0,
      durationInFrames: 600,
      type: 'video',
      sourceStart: 0,
      sourceEnd: RAMP_SOURCE_FRAMES,
      sourceDuration: 4_000,
      sourceFps: 30,
      speed: 3.85,
      speedCurve: RAMP_600,
      ...overrides,
    })
  }

  /**
   * The mapping every reader applies (`clipSourcePosition`, design 7.1, section 4.6): the
   * curve's exact integral plus the cut remainder, floored, on top of the clip's `sourceStart`.
   */
  function mappedFrame(
    curve: SpeedCurve,
    timelineFrame: number,
    sourceStart: number,
    sourceFrameOffset?: SourceRemainder,
  ): number {
    return clipSourcePosition(
      { type: 'video', speedCurve: curve, sourceStart, sourceFps: 30, sourceFrameOffset },
      timelineFrame,
      RATE_30,
    ).frame
  }

  /** The parent ramp's source frame at a clip-relative frame, its own sourceStart 0. */
  function parentFrame(timelineFrame: number): number {
    return mappedFrame(RAMP_600, timelineFrame, 0)
  }

  // `windowSpeedCurve` and the stretch's scaling moved to `@/studio/speed` (edits.test.ts).

  it('trims the start: the kept range maps every frame as the parent did', () => {
    const item = makeRampItem()
    const update = calculateTrimSourceUpdate(item, 'start', 300, 300, 30)!

    expect(update.sourceStart).toBe(1_155)
    expect(update.speed).toBe(3.85)
    expect(update.sourceFrameOffset).toBeUndefined()
    expect(update.speedCurve?.keys).toEqual([
      { frame: 0, speed: 4 },
      { frame: 270, speed: 4 },
      { frame: 300, speed: 1 },
    ])
    for (let frame = 0; frame <= 300; frame += 1) {
      expect(
        mappedFrame(update.speedCurve!, frame, update.sourceStart!, update.sourceFrameOffset),
      ).toBe(parentFrame(300 + frame))
    }
  })

  it('trims the end: the kept range maps every frame as the parent did', () => {
    const item = makeRampItem()
    const update = calculateTrimSourceUpdate(item, 'end', -300, 300, 30)!

    expect(update.sourceEnd).toBe(1_155)
    expect(update.speed).toBe(3.85)
    // The clip still starts where it started, so an end trim does not touch the remainder.
    expect(update).not.toHaveProperty('sourceFrameOffset')
    expect(update.speedCurve?.keys).toEqual([
      { frame: 0, speed: 1 },
      { frame: 30, speed: 4 },
      { frame: 300, speed: 4 },
    ])
    for (let frame = 0; frame <= 300; frame += 1) {
      expect(mappedFrame(update.speedCurve!, frame, 0)).toBe(parentFrame(frame))
    }
  })

  it("trims the start at a cut between two source frames: every frame is the parent's", () => {
    const item = makeRampItem()
    // 15 frames into the 1x -> 4x ramp the integral is 26.25 source frames: a cut no whole
    // source bound can hold, so the remainder travels with the clip (design 7.1, section 4.6).
    const update = calculateTrimSourceUpdate(item, 'start', 15, 585, 30)!
    const cutArea = areaAt(RAMP_600, 15)
    expect(cutArea).toBe(26.25)
    expect(update.sourceStart).toBe(26)
    expect(update.sourceFrameOffset).toEqual({ num: 1, den: 4 })
    expect(mappedFrame(update.speedCurve!, 0, update.sourceStart!, update.sourceFrameOffset)).toBe(
      parentFrame(15),
    )

    for (let frame = 0; frame <= 585; frame += 1) {
      // The window's real position is the parent's integral less the integral before the cut.
      expect(sourceFramesAt(update.speedCurve!, frame, RATE_30, RATE_30)).toBeCloseTo(
        sourceFramesAt(RAMP_600, 15 + frame, RATE_30, RATE_30) - cutArea,
        9,
      )
      // With the remainder added before the floor, the frame shown is the parent's own.
      expect(
        mappedFrame(update.speedCurve!, frame, update.sourceStart!, update.sourceFrameOffset),
      ).toBe(parentFrame(15 + frame))
    }
  })

  it('composes a cut with the remainder the clip already carries', () => {
    // A clip that was itself cut between two source frames starts at 40 + 0.5. Cutting 15 more
    // frames of the ramp adds 26.25, so its new first frame is 66.75.
    const inherited = makeRampItem({ sourceStart: 40, sourceFrameOffset: { num: 1, den: 2 } })
    const update = calculateTrimSourceUpdate(inherited, 'start', 15, 585, 30)!
    expect(update.sourceStart).toBe(40 + 26)
    expect(update.sourceFrameOffset).toEqual({ num: 3, den: 4 })
    for (let frame = 0; frame <= 585; frame += 1) {
      expect(
        mappedFrame(update.speedCurve!, frame, update.sourceStart!, update.sourceFrameOffset),
      ).toBe(mappedFrame(RAMP_600, 15 + frame, 40, { num: 1, den: 2 }))
    }
  })

  it('clears the remainder when a cut lands on a whole source frame', () => {
    // 26.25 of the ramp plus the 0.75 the clip already carried is 27, a whole source frame.
    const inherited = makeRampItem({ sourceFrameOffset: { num: 3, den: 4 } })
    const update = calculateTrimSourceUpdate(inherited, 'start', 15, 585, 30)!
    expect(update.sourceStart).toBe(27)
    expect(update.sourceFrameOffset).toBeUndefined()
    for (let frame = 0; frame <= 585; frame += 1) {
      expect(
        mappedFrame(update.speedCurve!, frame, update.sourceStart!, update.sourceFrameOffset),
      ).toBe(mappedFrame(RAMP_600, 15 + frame, 0, { num: 3, den: 4 }))
    }
  })

  it("extends the end holding the curve's last speed, and keeps the parent mapping inside it", () => {
    const item = makeRampItem()
    const update = calculateTrimSourceUpdate(item, 'end', 30, 630, 30)!

    expect(update.sourceEnd).toBe(RAMP_SOURCE_FRAMES + 30)
    expect(update.speedCurve?.keys).toEqual([...RAMP_600.keys, { frame: 630, speed: 1 }])
    for (let frame = 0; frame <= 600; frame += 1) {
      expect(mappedFrame(update.speedCurve!, frame, 0)).toBe(parentFrame(frame))
    }
    // The frames the trim revealed hold the last key's speed: one source frame each.
    expect(mappedFrame(update.speedCurve!, 630, 0) - mappedFrame(update.speedCurve!, 600, 0)).toBe(
      30,
    )
  })

  it("extends the start holding the curve's first speed, the rest of the curve shifted", () => {
    const item = makeRampItem({ sourceStart: 500, sourceEnd: 500 + RAMP_SOURCE_FRAMES })
    const update = calculateTrimSourceUpdate(item, 'start', -30, 630, 30)!

    expect(update.sourceStart).toBe(500 - 30)
    expect(update.speedCurve?.keys).toEqual([
      { frame: 0, speed: 1 },
      { frame: 30, speed: 1 },
      { frame: 60, speed: 4 },
      { frame: 600, speed: 4 },
      { frame: 630, speed: 1 },
    ])
    // On the range the curve already covered, the mapping is the parent's, moved by the 30
    // source frames the extension revealed.
    for (let frame = 30; frame <= 630; frame += 1) {
      expect(mappedFrame(update.speedCurve!, frame, update.sourceStart!)).toBe(
        500 + parentFrame(frame - 30),
      )
    }

    // A clip that already carries a remainder keeps it: the frames revealed are whole frames at
    // the first key's speed, so only the integer part of its source start moves.
    const withFraction = makeRampItem({
      sourceStart: 540,
      sourceEnd: 540 + RAMP_SOURCE_FRAMES,
      sourceFrameOffset: { num: 1, den: 2 },
    })
    const fractionKept = calculateTrimSourceUpdate(withFraction, 'start', -30, 630, 30)!
    expect(fractionKept.sourceStart).toBe(540 - 30)
    expect(fractionKept.sourceFrameOffset).toEqual({ num: 1, den: 2 })
  })

  it('changes nothing for a zero-length end trim', () => {
    expect(calculateTrimSourceUpdate(makeRampItem(), 'end', 0, 600, 30)).toEqual({})
  })

  it('clamps an over-extended start at source 0 and leaves no remainder behind', () => {
    // The clamp normally stops this (clampTrimAmount); a caller that asks anyway cannot push
    // the source start below 0, and a fraction of a position the clip does not have is dropped.
    const item = makeRampItem({ sourceStart: 10, sourceEnd: 10 + RAMP_SOURCE_FRAMES })
    const update = calculateTrimSourceUpdate(item, 'start', -100, 700, 30)!
    expect(update.sourceStart).toBe(0)
    expect(update.sourceFrameOffset).toBeUndefined()
    expect(update.speedCurve?.keys[0]).toBeDefined()
  })

  it('prices an end extension on a curve that has no explicit source end', () => {
    const item = makeRampItem({ sourceEnd: undefined })
    // The curve covers 2,310 of the 4,000 source frames; the 1,690 left are 1,690 frames at
    // the 1x the curve ends on.
    expect(clampTrimAmount(item, 'end', 2_000, 30)).toEqual({
      clampedAmount: 1_690,
      maxExtend: 1_690,
    })
  })

  it('clamps an extension by the speed the curve holds at the handle being dragged', () => {
    // The average is 3.25x but the clip starts at 4x, so 400 source frames buy 100 frames of
    // extension, not the 123 the average would allow.
    const startsFast: SpeedCurve = {
      keys: [
        { frame: 0, speed: 4 },
        { frame: 300, speed: 4 },
        { frame: 600, speed: 1 },
      ],
    }
    const item = makeRampItem({
      sourceStart: 400,
      sourceEnd: 400 + Math.floor(areaAt(startsFast, 600)),
      speedCurve: startsFast,
      speed: 3.25,
    })
    expect(clampTrimAmount(item, 'start', -500, 30).clampedAmount).toBe(-100)

    // The end holds 1x while the average is 1.075x: 100 source frames left are 100 frames.
    const endsSlow: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 570, speed: 1 },
        { frame: 600, speed: 4 },
      ],
    }
    const slowTail = makeRampItem({
      sourceEnd: 645,
      sourceDuration: 745,
      speedCurve: endsSlow,
      speed: 1.075,
    })
    expect(clampTrimAmount(slowTail, 'end', 200, 30).clampedAmount).toBe(25)
    const update = calculateTrimSourceUpdate(slowTail, 'end', 25, 625, 30)!
    expect(update.sourceEnd).toBe(745)
  })
})
