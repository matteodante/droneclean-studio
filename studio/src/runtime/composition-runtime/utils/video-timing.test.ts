// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { frameToSeconds, secondsToFrame, toRate } from '@/studio/time'
import {
  averageSpeed,
  sourceFrameAt as curveSourceFrameAt,
  type SourceRemainder,
  type SpeedCurve,
} from '@/studio/speed'
import { getVideoTargetTimeSeconds, getAudioTargetTimeSeconds } from './video-timing'

/**
 * The rate a probed 59.94 clip carries: mediabunny snaps `bestGuessFrameRate` to `60 / 1.001`,
 * one ulp from `60000 / 1001`, so the test passes the probe's own value (design 1.5, 3).
 */
const SOURCE_59_94 = 60 / 1.001
const SOURCE_29_97 = 30000 / 1001
const SOURCE_60 = 60
const SOURCE_25 = 25
const SOURCE_23_976 = 24000 / 1001

/** 20 minutes of a 59.94 project. */
const TWENTY_MINUTES_FRAMES = 71_928

function sourceFrameOf(timeSeconds: number, sourceFps: number): number {
  return secondsToFrame(toRate(sourceFps), timeSeconds)
}

function firstVideoSourceFrames(
  sourceFps: number,
  count: number,
  speed: number,
  sourceStart = 0,
): number[] {
  const frames: number[] = []
  for (let timelineFrame = 0; timelineFrame < count; timelineFrame += 1) {
    frames.push(
      sourceFrameOf(
        getVideoTargetTimeSeconds(sourceStart, sourceFps, timelineFrame, speed, 59.94),
        sourceFps,
      ),
    )
  }
  return frames
}

/**
 * The table of design 1.5, section 4.2: the first eight timeline frames of a 59.94 project,
 * source start 0. Speeds 2 and 0.5 are the 59.94 source, repeated for every source as section
 * 4.8 asks.
 */
const FIRST_EIGHT_FRAMES = [
  {
    name: '59.94',
    fps: SOURCE_59_94,
    normal: [0, 1, 2, 3, 4, 5, 6, 7],
    double: [0, 2, 4, 6, 8, 10, 12, 14],
    half: [0, 0, 1, 1, 2, 2, 3, 3],
  },
  {
    name: '29.97',
    fps: SOURCE_29_97,
    normal: [0, 0, 1, 1, 2, 2, 3, 3],
    double: [0, 1, 2, 3, 4, 5, 6, 7],
    half: [0, 0, 0, 0, 1, 1, 1, 1],
  },
  {
    name: '60',
    fps: SOURCE_60,
    normal: [0, 1, 2, 3, 4, 5, 6, 7],
    double: [0, 2, 4, 6, 8, 10, 12, 14],
    half: [0, 0, 1, 1, 2, 2, 3, 3],
  },
  {
    name: '25',
    fps: SOURCE_25,
    normal: [0, 0, 0, 1, 1, 2, 2, 2],
    double: [0, 0, 1, 2, 3, 4, 5, 5],
    half: [0, 0, 0, 0, 0, 1, 1, 1],
  },
  {
    name: '23.976',
    fps: SOURCE_23_976,
    normal: [0, 0, 0, 1, 1, 2, 2, 2],
    double: [0, 0, 1, 2, 3, 4, 4, 5],
    half: [0, 0, 0, 0, 0, 1, 1, 1],
  },
]

function expectAudioVideoTargetTimesToMatch({
  sourceStart,
  sourceFps,
  frame,
  playbackRate,
  timelineFps,
}: {
  sourceStart: number
  sourceFps: number
  frame: number
  playbackRate: number
  timelineFps: number
}) {
  const videoTime = getVideoTargetTimeSeconds(
    sourceStart,
    sourceFps,
    frame,
    playbackRate,
    timelineFps,
  )
  const audioTime = getAudioTargetTimeSeconds(
    sourceStart,
    sourceFps,
    frame,
    playbackRate,
    timelineFps,
  )

  expect(videoTime).toBe(audioTime)
}

describe('the exact frame mapping of design 1.5, section 4.2', () => {
  for (const row of FIRST_EIGHT_FRAMES) {
    describe(`a ${row.name} source in a 59.94 project`, () => {
      it('maps the first timeline frames at normal speed', () => {
        expect(firstVideoSourceFrames(row.fps, 8, 1)).toEqual(row.normal)
      })

      it('maps them at speed 2', () => {
        expect(firstVideoSourceFrames(row.fps, 8, 2)).toEqual(row.double)
      })

      it('maps them at speed 0.5', () => {
        expect(firstVideoSourceFrames(row.fps, 8, 0.5)).toEqual(row.half)
      })

      it('adds the trim-in to every frame', () => {
        expect(firstVideoSourceFrames(row.fps, 8, 1, 100)).toEqual(
          row.normal.map((frame) => frame + 100),
        )
      })

      it('asks the decoder for each frame’s own start time, not a snapped neighbour', () => {
        for (let timelineFrame = 0; timelineFrame < 8; timelineFrame += 1) {
          const sourceFrame = row.normal[timelineFrame]!
          const time = getVideoTargetTimeSeconds(0, row.fps, timelineFrame, 1, 59.94)
          expect(time).toBe(frameToSeconds(toRate(row.fps), sourceFrame))
        }
      })

      it('keeps audio on the same source frame as video', () => {
        for (const speed of [1, 2, 0.5]) {
          for (let timelineFrame = 0; timelineFrame < 8; timelineFrame += 1) {
            expectAudioVideoTargetTimesToMatch({
              sourceStart: 0,
              sourceFps: row.fps,
              frame: timelineFrame,
              playbackRate: speed,
              timelineFps: 59.94,
            })
          }
        }
      })
    })
  }
})

describe('video timing with shared Sequences', () => {
  it('produces identical target time for grouped and isolated split clips', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const playbackRate = 1
    const sourceStart = 3425
    const sequenceOffset = 4285

    const groupedTime = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      sequenceOffset,
      playbackRate,
      timelineFps,
      sequenceOffset,
    )

    const isolatedTime = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      0,
      playbackRate,
      timelineFps,
      0,
    )

    expect(groupedTime).toBe(isolatedTime)
    expect(groupedTime).toBe(frameToSeconds(toRate(sourceFps), sourceStart))
  })

  it('maps a frame before the shared Sequence backwards through the source', () => {
    // The rolling-edit panel asks for frames before a clip; at equal rates this is one source
    // frame per timeline frame, with no snap rounding it to a neighbour.
    expect(getVideoTargetTimeSeconds(50, 30, -30, 1, 30)).toBe(frameToSeconds(toRate(30), 20))
  })
})

describe('reversed playback', () => {
  it('starts on the last source frame and steps back one frame per advance', () => {
    const sourceEnd = 200
    const frames = [0, 1, 2, 3, 4, 5].map((localFrame) =>
      sourceFrameOf(
        getVideoTargetTimeSeconds(100, SOURCE_59_94, localFrame, 1, 59.94, 0, true, sourceEnd),
        SOURCE_59_94,
      ),
    )

    expect(frames).toEqual([199, 198, 197, 196, 195, 194])
  })

  it('mirrors the exact mapping on a mismatched source rate', () => {
    const sourceEnd = 1_201
    const frames = [0, 1, 2].map((localFrame) =>
      sourceFrameOf(
        getVideoTargetTimeSeconds(0, SOURCE_60, localFrame, 1, 59.94, 0, true, sourceEnd),
        SOURCE_60,
      ),
    )

    expect(frames).toEqual([1_200, 1_199, 1_198])
  })

  it('asks for the reversed frame’s own start time', () => {
    const time = getVideoTargetTimeSeconds(100, SOURCE_59_94, 3, 1, 59.94, 0, true, 200)

    expect(time).toBe(frameToSeconds(toRate(SOURCE_59_94), 196))
  })
})

describe('20 minutes at 59.94', () => {
  it('shows every source frame exactly once, in order, for a 59.94 source', () => {
    const seen = new Set<number>()
    let lastSourceFrame = -1
    let repeats = 0

    for (let timelineFrame = 0; timelineFrame < TWENTY_MINUTES_FRAMES; timelineFrame += 1) {
      const sourceFrame = sourceFrameOf(
        getVideoTargetTimeSeconds(0, SOURCE_59_94, timelineFrame, 1, 59.94),
        SOURCE_59_94,
      )
      if (sourceFrame <= lastSourceFrame) {
        repeats += 1
      }
      seen.add(sourceFrame)
      lastSourceFrame = sourceFrame
    }

    expect(repeats).toBe(0)
    expect(seen.size).toBe(TWENTY_MINUTES_FRAMES)
    expect(lastSourceFrame).toBe(TWENTY_MINUTES_FRAMES - 1)
  })
})

describe('audio and video sync for non-native FPS sources', () => {
  it('audio and video seek to the same start position for 23.981fps source', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const sourceStart = 2666 // source frames at 23.981fps
    const playbackRate = 1.502
    const frame = 0 // start of clip

    const videoSeek = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      frame,
      playbackRate,
      timelineFps,
    )
    const audioSeek = getAudioTargetTimeSeconds(
      sourceStart,
      sourceFps,
      frame,
      playbackRate,
      timelineFps,
    )

    expect(videoSeek).toBe(audioSeek)
    // Both seek to ~111.17s (2666 / 23.981)
    expect(videoSeek).toBeCloseTo(111.17, 1)
  })

  it('audio and video seek to the same end position for 23.981fps source', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const sourceStart = 2666
    const playbackRate = 1.502
    const durationInFrames = 1785

    const videoEnd = getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      durationInFrames,
      playbackRate,
      timelineFps,
    )
    const audioEnd = getAudioTargetTimeSeconds(
      sourceStart,
      sourceFps,
      durationInFrames,
      playbackRate,
      timelineFps,
    )

    expect(videoEnd).toBe(audioEnd)
    // Both reach ~200.53s
    expect(videoEnd).toBeCloseTo(200.54, 0)
  })

  it('audio and video stay in sync at every frame for mismatched FPS', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const sourceStart = 2666
    const playbackRate = 1.502
    const durationInFrames = 1785

    for (const frame of [0, 1, 100, 500, 1000, 1784, durationInFrames]) {
      expectAudioVideoTargetTimesToMatch({
        sourceStart,
        sourceFps,
        frame,
        playbackRate,
        timelineFps,
      })
    }
  })

  it('using wrong FPS for trimBefore causes desync (documents the bug)', () => {
    const timelineFps = 30
    const sourceFps = 23.981
    const sourceStart = 2666
    const playbackRate = 1.502
    const frame = 0

    const correctSeek = getAudioTargetTimeSeconds(
      sourceStart,
      sourceFps,
      frame,
      playbackRate,
      timelineFps,
    )

    // Bug: using timelineFps instead of sourceFps for trimBefore conversion
    const buggySeek = getAudioTargetTimeSeconds(
      sourceStart,
      timelineFps,
      frame,
      playbackRate,
      timelineFps,
    )

    // The buggy seek starts ~22 seconds too early
    expect(correctSeek).toBeCloseTo(111.17, 1)
    expect(buggySeek).toBeCloseTo(88.87, 1)
    expect(Math.abs(correctSeek - buggySeek)).toBeGreaterThan(20)
  })

  it('sync holds for various source FPS values', () => {
    const timelineFps = 30
    const sourceStart = 1000
    const playbackRate = 2
    const frame = 500

    // Test common non-30fps formats
    for (const sourceFps of [23.976, 23.981, 24, 25, 29.97, 48, 50, 59.94, 60]) {
      expectAudioVideoTargetTimesToMatch({
        sourceStart,
        sourceFps,
        frame,
        playbackRate,
        timelineFps,
      })

      // Start position should use source FPS, not timeline FPS
      const expectedStart = sourceStart / sourceFps
      const atFrameZero = getAudioTargetTimeSeconds(
        sourceStart,
        sourceFps,
        0,
        playbackRate,
        timelineFps,
      )
      expect(atFrameZero).toBeCloseTo(expectedStart, 4)
    }
  })

  it('sync holds when sourceFps equals timelineFps (no conversion needed)', () => {
    const timelineFps = 30
    const sourceFps = 30
    const sourceStart = 2666
    const playbackRate = 1.5
    const durationInFrames = 1785

    for (const frame of [0, 100, durationInFrames]) {
      expectAudioVideoTargetTimesToMatch({
        sourceStart,
        sourceFps,
        frame,
        playbackRate,
        timelineFps,
      })
    }
  })
})

describe('the decoder is asked for the frame’s own start time', () => {
  it('maps consecutive timeline frames to consecutive source frames (sourceStart=439, fps=30)', () => {
    const timelineFps = 30
    const sourceFps = 30
    const sourceStart = 439
    const clipFrom = 11260

    for (let frame = clipFrom; frame < clipFrom + 50; frame++) {
      const localFrame = frame - clipFrom
      const sourceTime = getVideoTargetTimeSeconds(
        sourceStart,
        sourceFps,
        localFrame,
        1,
        timelineFps,
      )
      expect(sourceTime).toBe(frameToSeconds(toRate(sourceFps), sourceStart + localFrame))
    }
  })

  it('maps consecutive timeline frames to consecutive source frames (sourceStart=2128, fps=30)', () => {
    const timelineFps = 30
    const sourceFps = 30
    const sourceStart = 2128
    const clipFrom = 12806

    for (let frame = clipFrom; frame < clipFrom + 50; frame++) {
      const localFrame = frame - clipFrom
      const sourceTime = getVideoTargetTimeSeconds(
        sourceStart,
        sourceFps,
        localFrame,
        1,
        timelineFps,
      )
      expect(sourceTime).toBe(frameToSeconds(toRate(sourceFps), sourceStart + localFrame))
    }
  })

  it('never skips or duplicates source frames for mismatched FPS', () => {
    const timelineFps = 30
    const sourceFps = 23.976
    const sourceStart = 1000

    let prevSourceFrame = sourceFrameOf(
      getVideoTargetTimeSeconds(sourceStart, sourceFps, 0, 1, timelineFps),
      sourceFps,
    )

    for (let localFrame = 1; localFrame < 200; localFrame++) {
      const sourceTime = getVideoTargetTimeSeconds(
        sourceStart,
        sourceFps,
        localFrame,
        1,
        timelineFps,
      )
      const sourceFrame = sourceFrameOf(sourceTime, sourceFps)

      // Source frame should never go backward
      expect(sourceFrame).toBeGreaterThanOrEqual(prevSourceFrame)

      // When source frame advances, it should advance by exactly 1
      // (for 1x speed with sourceFps < timelineFps, some frames repeat but none skip)
      if (sourceFrame > prevSourceFrame) {
        expect(sourceFrame - prevSourceFrame).toBe(1)
      }

      prevSourceFrame = sourceFrame
    }
  })

  it('never skips source frames for same-FPS clips at various sourceStart values', () => {
    const fps = 30

    // Test sourceStart values that produce repeating decimals as floats
    for (const sourceStart of [
      1, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 100, 439, 997, 1234, 2128, 3333, 9999,
    ]) {
      for (let localFrame = 0; localFrame < 100; localFrame++) {
        const sourceTime = getVideoTargetTimeSeconds(sourceStart, fps, localFrame, 1, fps)
        expect(sourceTime).toBe(frameToSeconds(toRate(fps), sourceStart + localFrame))
      }
    }
  })

  it('floors a genuinely fractional source position instead of snapping it', () => {
    // 23.976fps source on a 30fps timeline: timeline frame 1 advances 0.7992 source frames
    const sourceFps = 23.976
    const sourceStart = 1000
    expect(
      sourceFrameOf(getVideoTargetTimeSeconds(sourceStart, sourceFps, 1, 1, 30), sourceFps),
    ).toBe(1000)
    expect(
      sourceFrameOf(getVideoTargetTimeSeconds(sourceStart, sourceFps, 2, 1, 30), sourceFps),
    ).toBe(1001)
  })
})

/**
 * The 10-second ramp of design 7.1, section 5.2: 1x -> 4x, hold, 4x -> 1x, over 600 frames.
 * Its average is 3.85 — a length, never a position.
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

function curveVideoTime(sourceFps: number, frame: number, curve: SpeedCurve): number {
  return getVideoTargetTimeSeconds(
    0,
    sourceFps,
    frame,
    RAMP_AVERAGE,
    59.94,
    0,
    false,
    undefined,
    curve,
  )
}

function curveAudioTime(sourceFps: number, frame: number, curve: SpeedCurve): number {
  return getAudioTargetTimeSeconds(
    0,
    sourceFps,
    frame,
    RAMP_AVERAGE,
    59.94,
    false,
    undefined,
    curve,
  )
}

describe('a speed curve is the position; the clip’s `speed` is only the average', () => {
  it('maps the ramp’s first frames through the curve, not through the average speed', () => {
    const frames = Array.from({ length: 8 }, (_, timelineFrame) =>
      sourceFrameOf(curveVideoTime(59.94, timelineFrame, RAMP_600), 59.94),
    )

    // floor(n + n²/20), the curve's integral over its first 30-frame segment.
    expect(frames).toEqual([0, 1, 2, 3, 4, 6, 7, 9])
    // The average speed would put timeline frame 7 at source frame 26 instead.
    expect(Math.floor(RAMP_AVERAGE * 7)).toBe(26)
  })

  it('asks for the curve’s source frame for the video and for the audio, at every rate', () => {
    for (const sourceFps of [59.94, 29.97, 25, 23.976]) {
      for (const frame of [0, 1, 7, 29, 30, 299, 300, 570, 599, 600]) {
        const expected = frameToSeconds(
          toRate(sourceFps),
          curveSourceFrameAt(RAMP_600, frame, 0, toRate(sourceFps), toRate(59.94)),
        )
        expect(curveVideoTime(sourceFps, frame, RAMP_600)).toBe(expected)
        expect(curveAudioTime(sourceFps, frame, RAMP_600)).toBe(expected)
      }
    }
  })

  it('adds the trim-in to the curve’s advance', () => {
    const time = getVideoTargetTimeSeconds(
      100,
      59.94,
      300,
      RAMP_AVERAGE,
      59.94,
      0,
      false,
      undefined,
      RAMP_600,
    )

    expect(time).toBe(
      frameToSeconds(
        toRate(59.94),
        100 + curveSourceFrameAt(RAMP_600, 300, 0, toRate(59.94), toRate(59.94)),
      ),
    )
  })

  it('ignores the curve on a reversed clip, as the renderer does', () => {
    const withCurve = getVideoTargetTimeSeconds(0, 30, 3, 1, 30, 0, true, 200, RAMP_600)
    const withoutCurve = getVideoTargetTimeSeconds(0, 30, 3, 1, 30, 0, true, 200)

    expect(withCurve).toBe(withoutCurve)
    expect(sourceFrameOf(withCurve, 30)).toBe(196)
  })

  it('ignores the curve before the clip’s first frame, where the constant speed answers', () => {
    const withCurve = getVideoTargetTimeSeconds(50, 30, -10, 2, 30, 0, false, undefined, RAMP_600)

    expect(withCurve).toBe(getVideoTargetTimeSeconds(50, 30, -10, 2, 30))
    expect(withCurve).toBe(frameToSeconds(toRate(30), 30))
  })
})

/**
 * A curved clip cut between two source frames carries the remainder of its first frame's source
 * position (design 7.1, section 4.6), added to the curve's integral before the floor: the
 * preview's two mappings return the parent's source frame after the cut. The design's ramp cut
 * at frame 15 is 26.25 source frames in, so the clip starts on source frame 26 with 0.25 left.
 */
const CUT_AT_15: SpeedCurve = {
  keys: [
    { frame: 0, speed: 2.5 },
    { frame: 15, speed: 4 },
    { frame: 555, speed: 4 },
    { frame: 585, speed: 1 },
  ],
}
/** The cut's remainder: the item's exact fraction for the picture, its double for the sound. */
const CUT_FRACTION: SourceRemainder = { num: 1, den: 4 }
const CUT_FRACTION_VALUE = 0.25
const CUT_DURATION = 585
const CUT_AVERAGE = averageSpeed(CUT_AT_15)

/** `sourceStart` 26: the clip starts on the source frame the cut's whole part lands in. */
const CUT_SOURCE_START = 26

function cutVideoTime(frame: number, sourceFrameOffset?: SourceRemainder): number {
  return getVideoTargetTimeSeconds(
    CUT_SOURCE_START,
    59.94,
    frame,
    CUT_AVERAGE,
    59.94,
    0,
    false,
    undefined,
    CUT_AT_15,
    sourceFrameOffset,
  )
}

function cutAudioTime(frame: number, sourceFrameOffset = 0): number {
  return getAudioTargetTimeSeconds(
    CUT_SOURCE_START,
    59.94,
    frame,
    CUT_AVERAGE,
    59.94,
    false,
    undefined,
    CUT_AT_15,
    sourceFrameOffset,
  )
}

/** The source frame the parent ramp shows at its own frame 15 + `frame`, through its integral. */
function parentSourceFrame(frame: number): number {
  return curveSourceFrameAt(RAMP_600, frame + 15, 0, toRate(59.94), toRate(59.94))
}

describe('the cut fraction of a curved clip', () => {
  it('adds it before the floor, so the video and the audio ask for the parent’s frame every frame', () => {
    for (let frame = 0; frame < CUT_DURATION; frame++) {
      expect(sourceFrameOf(cutVideoTime(frame, CUT_FRACTION), 59.94), `frame ${frame}`).toBe(
        parentSourceFrame(frame),
      )
      expect(sourceFrameOf(cutAudioTime(frame, CUT_FRACTION_VALUE), 59.94), `frame ${frame}`).toBe(
        parentSourceFrame(frame),
      )
    }
  })

  it('lags one source frame behind on many frames without it', () => {
    let behind = 0
    for (let frame = 0; frame < CUT_DURATION; frame++) {
      if (sourceFrameOf(cutVideoTime(frame), 59.94) !== parentSourceFrame(frame)) behind++
    }

    expect(behind).toBe(556)
    // The clip's first frame is the parent's either way: the cut lands on source frame 26.
    expect(sourceFrameOf(cutVideoTime(0), 59.94)).toBe(26)
  })

  it('ignores the fraction on a reversed clip, as the renderer does', () => {
    expect(getVideoTargetTimeSeconds(0, 30, 3, 1, 30, 0, true, 200, RAMP_600, CUT_FRACTION)).toBe(
      getVideoTargetTimeSeconds(0, 30, 3, 1, 30, 0, true, 200, RAMP_600),
    )
  })

  it('is the mapping of before when the fraction is 0', () => {
    for (const frame of [0, 1, 7, 30, 299, 583, 584]) {
      const expected = frameToSeconds(
        toRate(59.94),
        CUT_SOURCE_START + curveSourceFrameAt(CUT_AT_15, frame, 0, toRate(59.94), toRate(59.94)),
      )
      expect(cutVideoTime(frame)).toBe(expected)
      expect(cutAudioTime(frame)).toBe(expected)
    }
  })
})
