import { describe, expect, it } from 'vite-plus/test'
import { frameToSeconds, secondsToFrame, toRate } from '@/studio/time'
import { averageSpeed, sourceFrameAt as curveSourceFrameAt, type SpeedCurve } from '@/studio/speed'
import type { CompositionItem, VideoItem } from '@/types/timeline'
import { getVideoTargetTimeSeconds } from '@/runtime/renderer/deps/composition-runtime-contract'
import type { ActiveTransition } from './canvas-transitions'
import {
  getItemRenderTimelineSpan,
  getRenderTimelineSourceStart,
  getSourceFrameRampOffset,
  isAAContinuousSplit,
  resolveAATransitionRamps,
  resolveCompositionSourceFrame,
  resolveTransitionRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
} from './render-span'

function createVideoItem(overrides?: Partial<VideoItem>): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 60,
    durationInFrames: 40,
    label: 'Clip',
    src: 'clip.mp4',
    ...overrides,
  }
}

function createActiveTransition(overrides?: Partial<ActiveTransition>): ActiveTransition {
  return {
    transition: {
      id: 'transition-1',
      type: 'crossfade',
      presentation: 'iris',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 20,
    },
    leftClip: createVideoItem({ id: 'left', from: 0, durationInFrames: 60 }),
    rightClip: createVideoItem({ id: 'right', from: 60, durationInFrames: 60 }),
    progress: 0,
    transitionStart: 50,
    transitionEnd: 70,
    durationInFrames: 20,
    leftPortion: 10,
    rightPortion: 10,
    cutPoint: 60,
    ...overrides,
  } as ActiveTransition
}

describe('render-span', () => {
  it('falls back to legacy offset when deriving source start', () => {
    const clip = createVideoItem({ offset: 18 })

    expect(getItemRenderTimelineSpan(clip)).toEqual({
      from: 60,
      durationInFrames: 40,
      sourceStart: 18,
    })
    expect(getRenderTimelineSourceStart(clip)).toBe(18)
  })

  it('uses legacy offset when resolving transition preroll source anchoring', () => {
    const clip = createVideoItem({ id: 'right', offset: 18 })
    const transition = createActiveTransition({ rightClip: clip })

    expect(resolveTransitionRenderTimelineSpan(clip, transition, 30)).toEqual({
      from: 50,
      durationInFrames: 50,
      sourceStart: 8,
    })
  })

  it('maps retimed mixed-FPS compounds to the same source frame as the DOM player', () => {
    const compound = {
      id: 'compound-1',
      type: 'composition',
      trackId: 'track-1',
      compositionId: 'nested-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
      from: 100,
      durationInFrames: 90,
      sourceStart: 10,
      sourceFps: 60,
      speed: 2,
    } as CompositionItem

    expect(resolveCompositionSourceFrame(compound, 115, 30, 60)).toBe(70)
  })

  describe('A-A continuous-split ramps', () => {
    // Continuous split at frame 60 of an originally-single clip with mediaId
    // 'm1'. Source frames 0..60 went to left, 60..120 to right. Centered
    // 20-frame transition spans timeline [50, 70].
    function makeSplitPair() {
      const left = createVideoItem({
        id: 'left',
        mediaId: 'm1',
        from: 0,
        durationInFrames: 60,
        sourceStart: 0,
      })
      const right = createVideoItem({
        id: 'right',
        mediaId: 'm1',
        from: 60,
        durationInFrames: 60,
        sourceStart: 60,
      })
      return { left, right }
    }

    function makeAARampContext() {
      const { left, right } = makeSplitPair()
      const transition = createActiveTransition({
        leftClip: left,
        rightClip: right,
        transitionStart: 50,
        transitionEnd: 70,
        cutPoint: 60,
      })
      const ramps = resolveAATransitionRamps(left, right, transition, 30)
      if (!ramps) {
        throw new Error('Expected continuous A-A split ramps')
      }
      return { left, right, transition, ramps }
    }

    it('detects continuous A-A split via shared media and source continuity', () => {
      const { left, right } = makeSplitPair()
      expect(isAAContinuousSplit(left, right, 30)).toBe(true)
    })

    it('rejects pairs with different media', () => {
      const { left, right } = makeSplitPair()
      expect(isAAContinuousSplit(left, { ...right, mediaId: 'm2' }, 30)).toBe(false)
    })

    it('rejects pairs with a source-time gap (post-trim)', () => {
      const { left, right } = makeSplitPair()
      expect(isAAContinuousSplit(left, { ...right, sourceStart: 75 }, 30)).toBe(false)
    })

    it('rejects reversed clips (ramp formula assumes forward playback)', () => {
      const { left, right } = makeSplitPair()
      expect(isAAContinuousSplit({ ...left, isReversed: true }, right, 30)).toBe(false)
    })

    it('emits symmetric anchored ramps for A-A splits', () => {
      const { ramps } = makeAARampContext()
      expect(ramps.left).toEqual({ anchor: 'start', slope: 0.5, rampStart: 50, rampEnd: 70 })
      expect(ramps.right).toEqual({ anchor: 'end', slope: 0.5, rampStart: 50, rampEnd: 70 })
    })

    it('returns null for non-A-A pairs', () => {
      const { left, right } = makeSplitPair()
      const transition = createActiveTransition({ leftClip: left, rightClip: right })
      expect(resolveAATransitionRamps(left, { ...right, mediaId: 'm2' }, transition, 30)).toBeNull()
    })

    it('threads ramp through into the render span', () => {
      const { left, right, transition, ramps } = makeAARampContext()
      const leftSpan = resolveTransitionRenderTimelineSpan(left, transition, 30, ramps.left)
      const rightSpan = resolveTransitionRenderTimelineSpan(right, transition, 30, ramps.right)
      expect(leftSpan.sourceTimeRamp).toEqual(ramps.left)
      expect(rightSpan.sourceTimeRamp).toEqual(ramps.right)
    })

    it('ramp offset is zero at the anchor boundary (no jump where clip continues)', () => {
      const { ramps } = makeAARampContext()
      // Left exists naturally for F<50, so anchor='start' (frame=50 → offset 0).
      expect(getSourceFrameRampOffset(ramps.left, 50)).toBe(0)
      // Right exists naturally for F>70, so anchor='end' (frame=70 → offset 0).
      expect(getSourceFrameRampOffset(ramps.right, 70)).toBe(0)
    })

    it('ramp offset is also zero outside the window (no effect on adjacent frames)', () => {
      const { ramps } = makeAARampContext()
      expect(getSourceFrameRampOffset(ramps.left, 49)).toBe(0)
      expect(getSourceFrameRampOffset(ramps.left, 71)).toBe(0)
      expect(getSourceFrameRampOffset(ramps.right, 49)).toBe(0)
      expect(getSourceFrameRampOffset(ramps.right, 71)).toBe(0)
    })

    it('midpoint separates left/right rendered source by half the window duration', () => {
      const { ramps } = makeAARampContext()
      // At midpoint F=60 with slope=0.5: left offset = +5, right offset = -5.
      // Combined difference = 10 source frames = windowDuration / 2.
      expect(getSourceFrameRampOffset(ramps.left, 60)).toBe(5)
      expect(getSourceFrameRampOffset(ramps.right, 60)).toBe(-5)
    })

    it('non-anchor boundary offset equals half window duration (max separation)', () => {
      const { ramps } = makeAARampContext()
      expect(getSourceFrameRampOffset(ramps.left, 70)).toBe(10)
      expect(getSourceFrameRampOffset(ramps.right, 50)).toBe(-10)
    })
  })
})

/**
 * The table of design 1.5, section 4.2, through the function the canvas renderer and the
 * export call. The clip starts at timeline frame 0 with no trim, so the source frame equals
 * the first eight timeline frames of the table.
 */
const PROJECT_59_94 = 59.94

function firstRenderSpanSourceFrames(sourceFps: number, count: number, speed: number): number[] {
  const item = createVideoItem({
    from: 0,
    durationInFrames: 1_200,
    sourceStart: 0,
    sourceFps,
    speed,
  })
  const span = { from: 0, durationInFrames: 1_200, sourceStart: 0 }
  const frames: number[] = []
  for (let frame = 0; frame < count; frame += 1) {
    frames.push(
      secondsToFrame(
        toRate(sourceFps),
        resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94),
      ),
    )
  }
  return frames
}

const RENDER_SPAN_FIRST_FRAMES = [
  {
    name: '59.94',
    fps: 60 / 1.001,
    normal: [0, 1, 2, 3, 4, 5, 6, 7],
    double: [0, 2, 4, 6, 8, 10, 12, 14],
    half: [0, 0, 1, 1, 2, 2, 3, 3],
  },
  {
    name: '29.97',
    fps: 30000 / 1001,
    normal: [0, 0, 1, 1, 2, 2, 3, 3],
    double: [0, 1, 2, 3, 4, 5, 6, 7],
    half: [0, 0, 0, 0, 1, 1, 1, 1],
  },
  {
    name: '60',
    fps: 60,
    normal: [0, 1, 2, 3, 4, 5, 6, 7],
    double: [0, 2, 4, 6, 8, 10, 12, 14],
    half: [0, 0, 1, 1, 2, 2, 3, 3],
  },
  {
    name: '25',
    fps: 25,
    normal: [0, 0, 0, 1, 1, 2, 2, 2],
    double: [0, 0, 1, 2, 3, 4, 5, 5],
    half: [0, 0, 0, 0, 0, 1, 1, 1],
  },
  {
    name: '23.976',
    fps: 24000 / 1001,
    normal: [0, 0, 0, 1, 1, 2, 2, 2],
    double: [0, 0, 1, 2, 3, 4, 4, 5],
    half: [0, 0, 0, 0, 0, 1, 1, 1],
  },
]

describe('resolveVideoRenderSourceTimeSeconds', () => {
  for (const row of RENDER_SPAN_FIRST_FRAMES) {
    describe(`a ${row.name} source in a 59.94 project`, () => {
      it('maps the first eight timeline frames at normal speed', () => {
        expect(firstRenderSpanSourceFrames(row.fps, 8, 1)).toEqual(row.normal)
      })

      it('maps them at speed 2', () => {
        expect(firstRenderSpanSourceFrames(row.fps, 8, 2)).toEqual(row.double)
      })

      it('maps them at speed 0.5', () => {
        expect(firstRenderSpanSourceFrames(row.fps, 8, 0.5)).toEqual(row.half)
      })
    })
  }

  it('asks for the source frame’s own start time', () => {
    const item = createVideoItem({ from: 0, sourceStart: 7, sourceFps: 60 / 1.001 })
    const span = { from: 0, durationInFrames: 40, sourceStart: 7 }

    expect(resolveVideoRenderSourceTimeSeconds(item, span, 3, PROJECT_59_94)).toBe(
      frameToSeconds(toRate(60 / 1.001), 10),
    )
  })

  it('shows a 1,199-frame 59.94 segment as 1,199 frames, every source frame once in order', () => {
    const item = createVideoItem({
      from: 0,
      durationInFrames: 1_199,
      sourceStart: 0,
      sourceFps: 60 / 1.001,
    })
    const span = { from: 0, durationInFrames: 1_199, sourceStart: 0 }
    const shown: number[] = []

    for (let frame = 0; frame < 1_199; frame += 1) {
      shown.push(
        secondsToFrame(
          toRate(60 / 1.001),
          resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94),
        ),
      )
    }

    expect(shown).toEqual(Array.from({ length: 1_199 }, (_, frame) => frame))
  })

  it('counts from the render span’s first frame, not the timeline origin', () => {
    const item = createVideoItem({
      from: 1_000,
      durationInFrames: 1_199,
      sourceStart: 0,
      sourceFps: 60 / 1.001,
    })
    const span = { from: 1_000, durationInFrames: 1_199, sourceStart: 0 }

    expect(
      secondsToFrame(
        toRate(60 / 1.001),
        resolveVideoRenderSourceTimeSeconds(item, span, 1_005, PROJECT_59_94),
      ),
    ).toBe(5)
  })

  it('mirrors a reversed clip from its source end', () => {
    const item = createVideoItem({
      from: 0,
      durationInFrames: 1_199,
      sourceStart: 0,
      sourceEnd: 1_199,
      sourceFps: 60 / 1.001,
      isReversed: true,
    })
    const span = { from: 0, durationInFrames: 1_199, sourceStart: 0 }

    expect(
      [0, 1, 2].map((frame) =>
        secondsToFrame(
          toRate(60 / 1.001),
          resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94),
        ),
      ),
    ).toEqual([1_198, 1_197, 1_196])
  })

  it('adds the transition ramp’s source-frame offset before flooring', () => {
    const item = createVideoItem({ from: 0, sourceStart: 0, sourceFps: 60 / 1.001 })
    const span = {
      from: 0,
      durationInFrames: 40,
      sourceStart: 0,
      sourceTimeRamp: { anchor: 'start' as const, slope: 0.5, rampStart: 0, rampEnd: 10 },
    }
    const sourceFrameAt = (frame: number) =>
      secondsToFrame(
        toRate(60 / 1.001),
        resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94),
      )

    expect([0, 1, 2, 3, 4].map(sourceFrameAt)).toEqual([0, 1, 3, 4, 6])
  })

  it('clamps to the source duration', () => {
    const item = createVideoItem({
      from: 0,
      sourceStart: 0,
      sourceFps: 60 / 1.001,
      sourceDuration: 1_199,
    })
    const span = { from: 0, durationInFrames: 40, sourceStart: 0 }

    expect(
      secondsToFrame(
        toRate(60 / 1.001),
        resolveVideoRenderSourceTimeSeconds(item, span, 50_000, PROJECT_59_94),
      ),
    ).toBe(1_198)
  })
})

/**
 * The 10-second ramp of design 7.1, section 5.2: 1x -> 4x, hold, 4x -> 1x, over 600 frames.
 * Its average, 3.85, is what the clip's `speed` holds; it is a length, never a position.
 */
const RAMP_600: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}
const RAMP_AVERAGE = averageSpeed(RAMP_600)

function createCurvedItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return createVideoItem({
    from: 0,
    durationInFrames: 600,
    sourceStart: 0,
    sourceFps: PROJECT_59_94,
    speed: RAMP_AVERAGE,
    speedCurve: RAMP_600,
    ...overrides,
  })
}

describe('the speed curve of a render span', () => {
  it('carries the clip’s curve in its render span', () => {
    const span = getItemRenderTimelineSpan(createCurvedItem())

    expect(span.speedCurve).toBe(RAMP_600)
  })

  it('does not carry a curve for a reversed clip', () => {
    const span = getItemRenderTimelineSpan(createCurvedItem({ isReversed: true }))

    expect(span.speedCurve).toBeUndefined()
  })

  it('does not carry a curve for a composition wrapper', () => {
    const compound = {
      id: 'compound-1',
      type: 'composition',
      trackId: 'track-1',
      compositionId: 'nested-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
      from: 100,
      durationInFrames: 90,
      speed: RAMP_AVERAGE,
      speedCurve: RAMP_600,
    } as CompositionItem

    expect(getItemRenderTimelineSpan(compound).speedCurve).toBeUndefined()
  })

  it('carries the curve through a transition participant’s span', () => {
    const span = resolveTransitionRenderTimelineSpan(
      createCurvedItem(),
      { transitionStart: 590, transitionEnd: 610 },
      PROJECT_59_94,
    )

    expect(span.speedCurve).toBe(RAMP_600)
  })

  it('returns the curve’s source time for the same frame as the preview mapping', () => {
    const item = createCurvedItem()
    const span = getItemRenderTimelineSpan(item)

    for (const frame of [0, 1, 7, 29, 30, 299, 300, 570, 599, 600]) {
      const preview = getVideoTargetTimeSeconds(
        0,
        PROJECT_59_94,
        frame,
        RAMP_AVERAGE,
        PROJECT_59_94,
        0,
        false,
        undefined,
        RAMP_600,
      )
      expect(resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94)).toBe(preview)
    }
  })

  it('returns the curve’s source time when the source rate differs from the project rate', () => {
    const item = createCurvedItem({ sourceFps: 30 })
    const span = getItemRenderTimelineSpan(item)

    for (const frame of [0, 7, 30, 300, 600]) {
      const expected = frameToSeconds(
        toRate(30),
        curveSourceFrameAt(RAMP_600, frame, 0, toRate(30), toRate(PROJECT_59_94)),
      )
      expect(resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94)).toBe(expected)
      expect(
        getVideoTargetTimeSeconds(
          0,
          30,
          frame,
          RAMP_AVERAGE,
          PROJECT_59_94,
          0,
          false,
          undefined,
          RAMP_600,
        ),
      ).toBe(expected)
    }
  })

  it('is the curve’s position, never the average speed times the frame', () => {
    const item = createCurvedItem()
    const span = getItemRenderTimelineSpan(item)
    const atFrameSeven = secondsToFrame(
      toRate(PROJECT_59_94),
      resolveVideoRenderSourceTimeSeconds(item, span, 7, PROJECT_59_94),
    )

    expect(atFrameSeven).toBe(9)
    // The clip's speed is 3.85; its product with the frame is the length, not the picture.
    expect(Math.floor(RAMP_AVERAGE * 7)).toBe(26)
  })

  it('ignores the curve on a reversed clip and mirrors from the source end', () => {
    const item = createCurvedItem({
      durationInFrames: 1_199,
      sourceEnd: 1_199,
      isReversed: true,
      sourceFps: 60 / 1.001,
    })
    const withCurve = { from: 0, durationInFrames: 1_199, sourceStart: 0, speedCurve: RAMP_600 }
    const withoutCurve = { from: 0, durationInFrames: 1_199, sourceStart: 0 }
    const sourceFrameAtFrame = (
      span: { from: number; durationInFrames: number; sourceStart: number },
      frame: number,
    ) =>
      secondsToFrame(
        toRate(60 / 1.001),
        resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94),
      )

    expect([0, 1, 2].map((frame) => sourceFrameAtFrame(withCurve, frame))).toEqual(
      [0, 1, 2].map((frame) => sourceFrameAtFrame(withoutCurve, frame)),
    )
    expect(sourceFrameAtFrame(withCurve, 0)).toBe(1_198)
  })

  it('starts the curve at the clip’s own first frame inside a transition’s pre-roll span', () => {
    const item = createCurvedItem({ from: 60, sourceStart: 100, sourceFps: 30 })
    const transition = createActiveTransition({ transitionStart: 50, transitionEnd: 70 })
    const span = resolveTransitionRenderTimelineSpan(item, transition, 30)

    expect(span.from).toBe(50)
    expect(span.sourceStart).toBeLessThan(100)
    // The clip's own first frame asks for the clip's source start, not the pre-roll-reduced one.
    expect(
      secondsToFrame(toRate(30), resolveVideoRenderSourceTimeSeconds(item, span, 60, 30)),
    ).toBe(100)
    expect(
      secondsToFrame(toRate(30), resolveVideoRenderSourceTimeSeconds(item, span, 61, 30)),
    ).toBe(101)
  })
})

/**
 * A curved clip cut between two source frames carries the remainder of its first frame's source
 * position (design 7.1, section 4.6): the render path adds it to the curve's integral **before**
 * the floor, so the clip's frames are the parent's. Here the design's ramp is cut at frame 15,
 * 26.25 source frames in: the clip starts on source frame 26 and carries 0.25.
 */
const CUT_AT_15: SpeedCurve = {
  keys: [
    { frame: 0, speed: 2.5 },
    { frame: 15, speed: 4 },
    { frame: 555, speed: 4 },
    { frame: 585, speed: 1 },
  ],
}
const CUT_FRACTION = { num: 1, den: 4 }

function createCutItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return createCurvedItem({
    durationInFrames: 585,
    sourceStart: 26,
    sourceEnd: 2310,
    sourceFps: PROJECT_59_94,
    speed: averageSpeed(CUT_AT_15),
    speedCurve: CUT_AT_15,
    sourceFrameOffset: CUT_FRACTION,
    ...overrides,
  })
}

describe('the cut fraction of a render span', () => {
  it('carries the clip’s curve; the remainder is read from the clip by the one mapping', () => {
    const span = getItemRenderTimelineSpan(createCutItem())

    expect(span.speedCurve).toBe(CUT_AT_15)
    expect('sourceFrameOffset' in span).toBe(false)
  })

  it('adds the remainder of a clip at one speed too (review finding T4)', () => {
    // A 29.97 clip in a 59.94 project cut at an odd frame starts half a source frame in.
    const item = createCurvedItem({
      durationInFrames: 100,
      sourceStart: 49,
      sourceFps: 29.97,
      speed: 1,
      speedCurve: undefined,
      sourceFrameOffset: { num: 1, den: 2 },
    })
    const span = getItemRenderTimelineSpan(item)
    const shown = [0, 1, 2, 3].map((frame) =>
      secondsToFrame(
        toRate(29.97),
        resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94),
      ),
    )
    expect(shown).toEqual([49, 50, 50, 51])
  })

  it('adds it before the floor, so the cut clip shows the parent’s source frame every frame', () => {
    const item = createCutItem()
    const span = getItemRenderTimelineSpan(item)

    for (let frame = 0; frame < item.durationInFrames; frame++) {
      const parent = secondsToFrame(
        toRate(PROJECT_59_94),
        frameToSeconds(
          toRate(PROJECT_59_94),
          curveSourceFrameAt(RAMP_600, frame + 15, 0, toRate(PROJECT_59_94), toRate(PROJECT_59_94)),
        ),
      )
      expect(
        secondsToFrame(
          toRate(PROJECT_59_94),
          resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94),
        ),
        `frame ${frame}`,
      ).toBe(parent)
    }
  })

  it('lags one source frame behind on many frames without it', () => {
    const item = createCutItem({ sourceFrameOffset: undefined })
    const span = getItemRenderTimelineSpan(item)
    let behind = 0
    for (let frame = 0; frame < item.durationInFrames; frame++) {
      const cut = secondsToFrame(
        toRate(PROJECT_59_94),
        resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94),
      )
      const parent = curveSourceFrameAt(
        RAMP_600,
        frame + 15,
        0,
        toRate(PROJECT_59_94),
        toRate(PROJECT_59_94),
      )
      if (cut !== parent) behind++
    }

    expect(behind).toBe(556)
  })

  it('keeps the mapping of a curve without the field byte for byte', () => {
    const item = createCurvedItem()
    const span = getItemRenderTimelineSpan(item)
    const spanWithoutField = { ...span }
    delete (spanWithoutField as { sourceFrameOffset?: number }).sourceFrameOffset

    for (const frame of [0, 1, 7, 30, 299, 600]) {
      expect(resolveVideoRenderSourceTimeSeconds(item, span, frame, PROJECT_59_94)).toBe(
        resolveVideoRenderSourceTimeSeconds(item, spanWithoutField, frame, PROJECT_59_94),
      )
    }
  })
})
