// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { toRate } from '@/studio/time'
import { TRACK_DATA, TRACK_JOB_ID, TRACK_SUMMARY } from './__fixtures__/recorded'
import {
  shadowClick,
  shadowSegment,
  trackPointsInSourceFrames,
  trackRangesInSourceFrames,
} from './jobs'

/** Clip 0020's exact rate: 60000/1001, not the double 59.94 (design 1.5, section 4.0). */
const RATE = toRate(59.94)

/** The piece starts on source frame 3600: 60.06 s of clip 0020, cut on its keyframe. */
const PIECE_START_FRAME = 3600

/** Clip 0020's length: 230.880650 s, 13,839 frames at 60000/1001. */
const CLIP_FRAMES = 13_839

/**
 * Seconds as the engine writes them (`frame / fps`, its own float of 60000/1001) and as JSON
 * prints them, next to the source frame they came from. The last is 20 minutes, the longest project
 * the editor makes.
 */
const RECORDED_EDGES = [
  { frame: 0, seconds: 0 },
  { frame: 30, seconds: 0.5005000000000001 },
  { frame: 45, seconds: 0.75075 },
  { frame: 599, seconds: 9.993316666666667 },
  { frame: 13_838, seconds: 230.86396666666667 },
  { frame: 71_928, seconds: 1199.9988 },
]

describe('the tracking pass in source frames', () => {
  it('shifts every keyframe by the piece start, and nothing else', () => {
    const points = trackPointsInSourceFrames(PIECE_START_FRAME, TRACK_DATA)

    expect(points).toHaveLength(TRACK_DATA.keyframes.length)
    expect(points[0]).toEqual({ frame: 3630, x: 1860.25, y: 2410.5, radius: 96.5 })
    expect(points.at(-1)).toEqual({ frame: 3699, x: 1889.5, y: 2430, radius: 100.4 })
    // A keyframe of the upload at frame j is source frame 3600 + j: no seconds in between.
    for (const [index, point] of points.entries()) {
      expect(point.frame).toBe(PIECE_START_FRAME + TRACK_DATA.keyframes[index]![0])
    }
  })

  it('maps the ranges the pass found to source frames, exactly on a 60000/1001 clip', () => {
    const ranges = trackRangesInSourceFrames(RATE, PIECE_START_FRAME, TRACK_SUMMARY)

    expect(ranges).toEqual([
      { startFrame: 3630, endFrame: 3660 },
      { startFrame: 3690, endFrame: 3700 },
    ])
  })

  it('gives a recorded edge back its frame for the whole clip and for 20 minutes', () => {
    for (const edge of RECORDED_EDGES) {
      const [range] = trackRangesInSourceFrames(RATE, 0, {
        ranges: [{ startSeconds: edge.seconds, endSeconds: edge.seconds + 1 }],
      })
      expect(range?.startFrame).toBe(edge.frame)
    }
  })

  it('recovers every frame of clip 0020 from the seconds the engine writes for it', () => {
    const fps = TRACK_SUMMARY.fps
    const wrong: number[] = []
    for (let frame = 0; frame < CLIP_FRAMES; frame += 7) {
      const [range] = trackRangesInSourceFrames(RATE, PIECE_START_FRAME, {
        ranges: [{ startSeconds: frame / fps, endSeconds: (frame + 1) / fps }],
      })
      if (range?.startFrame !== PIECE_START_FRAME + frame) wrong.push(frame)
    }
    expect(wrong).toEqual([])
  })
})

describe('the API point and range from source frames', () => {
  it('sends a mark at the frame it was picked on, as the upload’s seconds', () => {
    const click = shadowClick(RATE, PIECE_START_FRAME, {
      x: 1860.25,
      y: 2410.5,
      frame: 3630,
      radius: 96.5,
    })

    // (3630 - 3600) x 1001 / 60000 = 0.5005, one rounding of the exact rate: the engine picks
    // frame 30 of the piece.
    expect(click).toEqual({
      x: 1860.25,
      y: 2410.5,
      timeSeconds: 0.5005,
      radius: 96.5,
    })
  })

  it('sends a range as the upload’s seconds, its end excluded, with its anchor frame', () => {
    const segment = shadowSegment(RATE, PIECE_START_FRAME, {
      startFrame: 3630,
      endFrame: 3660,
      anchor: { x: 1871.5, y: 2418, frame: 3645, radius: 98 },
      trackJobIds: [TRACK_JOB_ID],
    })

    expect(segment).toEqual({
      startSeconds: 0.5005,
      endSeconds: 1.001,
      anchor: { x: 1871.5, y: 2418, timeSeconds: 0.75075, radius: 98 },
      trackJobIds: [TRACK_JOB_ID],
    })
  })

  it('sends a mark on the piece’s first frame as 0 and one past it as the range’s end', () => {
    const first = shadowClick(RATE, PIECE_START_FRAME, {
      x: 1860.25,
      y: 2410.5,
      frame: PIECE_START_FRAME,
      radius: 96.5,
    })
    const segment = shadowSegment(RATE, PIECE_START_FRAME, {
      startFrame: PIECE_START_FRAME,
      endFrame: 4200,
      anchor: { x: 1882, y: 2425, frame: 3659, radius: 99.4 },
    })

    expect(first.timeSeconds).toBe(0)
    expect(segment.startSeconds).toBe(0)
    expect(segment.endSeconds).toBe(10.01)
  })

  it('refuses a range that ends before it starts, and an anchor outside it', () => {
    const range = { startFrame: 3630, endFrame: 3660 }

    expect(() =>
      shadowSegment(RATE, PIECE_START_FRAME, {
        ...range,
        endFrame: 3630,
        anchor: { x: 0, y: 0, frame: 3630, radius: 10 },
      }),
    ).toThrow(RangeError)
    expect(() =>
      shadowSegment(RATE, PIECE_START_FRAME, {
        ...range,
        anchor: { x: 0, y: 0, frame: 3660, radius: 10 },
      }),
    ).toThrow(RangeError)
    expect(() =>
      shadowSegment(RATE, PIECE_START_FRAME, {
        ...range,
        anchor: { x: 0, y: 0, frame: 3629, radius: 10 },
      }),
    ).toThrow(RangeError)
  })

  it('refuses a position that is not a whole source frame', () => {
    expect(() =>
      shadowClick(RATE, PIECE_START_FRAME, { x: 0, y: 0, frame: 3630.5, radius: 10 }),
    ).toThrow(RangeError)
    expect(() => trackPointsInSourceFrames(3600.5, TRACK_DATA)).toThrow(RangeError)
    expect(() => trackRangesInSourceFrames(RATE, 3600.5, TRACK_SUMMARY)).toThrow(RangeError)
  })
})
