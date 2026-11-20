// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { makeTimelineAudioItem } from '@/features/timeline/test-helpers'
import { beatFramesOnClip } from './mark'

describe('beatFramesOnClip', () => {
  const clip = makeTimelineAudioItem({
    from: 100,
    durationInFrames: 300,
    sourceStart: 0,
    sourceEnd: 300,
  })

  it('places a hit at the clip position plus its time in the source', () => {
    expect(beatFramesOnClip(clip, [0, 1, 2.5], 30)).toEqual([100, 130, 175])
  })

  it('follows the trim: hits before the clip start are dropped, the rest shift', () => {
    const trimmed = { ...clip, sourceStart: 90, sourceEnd: 390 }
    // 3 s into the media plays on the clip's first frame.
    expect(beatFramesOnClip(trimmed, [1, 3, 4, 14], 30)).toEqual([100, 130])
  })

  it('follows the speed: at 2x a hit one source second in plays after half a second', () => {
    const fast = { ...clip, speed: 2, sourceEnd: 600 }
    expect(beatFramesOnClip(fast, [1, 2, 3], 30)).toEqual([115, 130, 145])
  })

  it('follows a reversed clip: the end of the source plays first', () => {
    const reversed = { ...clip, isReversed: true }
    expect(beatFramesOnClip(reversed, [10, 9], 30)).toEqual([100, 130])
  })

  it('drops hits that fall outside the clip', () => {
    expect(beatFramesOnClip(clip, [-1, 10, 11], 30)).toEqual([])
  })
})
