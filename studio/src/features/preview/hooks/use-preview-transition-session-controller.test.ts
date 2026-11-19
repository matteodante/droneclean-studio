// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { getVideoTargetTimeSeconds } from '@/features/preview/deps/composition-runtime'
import { transitionClipTargetTime } from './use-preview-transition-session-controller'

describe('the transition session’s seek (review finding T8)', () => {
  it('asks for the source frame the preview shows: a curved clip with a cut remainder', () => {
    const clip = {
      id: 'ramp',
      type: 'video',
      trackId: 'track-v',
      from: 100,
      durationInFrames: 96,
      label: 'Ramp',
      src: 'blob:ramp',
      sourceStart: 30,
      sourceFps: 59.94,
      speed: 3,
      speedCurve: {
        keys: [
          { frame: 0, speed: 1 },
          { frame: 32, speed: 4 },
          { frame: 64, speed: 4 },
          { frame: 96, speed: 1 },
        ],
      },
      sourceFrameOffset: { num: 3, den: 4 },
    } as VideoItem
    for (let frame = 0; frame < clip.durationInFrames; frame++) {
      const preview = getVideoTargetTimeSeconds(
        clip.sourceStart!,
        clip.sourceFps!,
        frame,
        clip.speed!,
        30,
        0,
        false,
        undefined,
        clip.speedCurve,
        clip.sourceFrameOffset,
      )
      expect(transitionClipTargetTime(clip, frame, 30), `frame ${frame}`).toBe(preview)
    }
  })
})
