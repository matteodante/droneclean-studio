import { describe, expect, it } from 'vite-plus/test'
import { averageSpeed, type SpeedCurve } from '@/studio/speed'
import type { VideoItem } from '@/types/timeline'
import { getSourceFrameInfo } from './edit-overlay-utils'

/**
 * The design's 1x -> 4x -> 1x ramp (design 7.1, section 5.2) cut at its frame 6, where the
 * source position is 7.8 frames: `sourceStart` 7 and the 0.8 remainder `sourceFrameOffset`
 * (design 7.1, section 4.6).
 */
const CUT_AT_SIX: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1.6 },
    { frame: 24, speed: 4 },
    { frame: 564, speed: 4 },
    { frame: 594, speed: 1 },
  ],
}
const PROJECT_59_94 = 59.94

function makeCutClip(): VideoItem {
  return {
    id: 'cut-clip',
    type: 'video',
    trackId: 'track-1',
    label: 'Cut clip',
    src: 'blob:clip',
    from: 0,
    durationInFrames: 594,
    sourceStart: 7,
    sourceFps: PROJECT_59_94,
    speed: averageSpeed(CUT_AT_SIX),
    speedCurve: CUT_AT_SIX,
    sourceFrameOffset: { num: 4, den: 5 },
  }
}

describe('getSourceFrameInfo', () => {
  it('reads the parent’s source frame after a cut between two source frames', () => {
    const info = getSourceFrameInfo(makeCutClip(), 1, PROJECT_59_94)

    // Frame 1 of the cut ramp is source frame 9 of the parent (the parent's frame 7); without
    // the remainder the curve's integral alone lands on frame 8.
    expect(info.sourceTime).toBeCloseTo(9 / PROJECT_59_94)
    expect(info.sourceFrame).toBe(9)
  })

  it('reads one source frame behind without the cut’s remainder', () => {
    const withoutRemainder = getSourceFrameInfo(
      { ...makeCutClip(), sourceFrameOffset: undefined },
      1,
      PROJECT_59_94,
    )

    expect(withoutRemainder.sourceFrame).toBe(8)
  })
})
