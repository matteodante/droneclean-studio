// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { frameToSeconds, toRate } from '@/studio/time'
import type { VideoItem } from '@/types/timeline'
import { getItemSourceSpanSeconds, sourceSecondsToTimelineFrame } from './media-item-frames'

const PROJECT_59_94 = 59.94
const SOURCE_59_94 = 60 / 1.001

function videoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 100,
    durationInFrames: 1_199,
    label: 'Clip',
    src: 'clip.mp4',
    sourceStart: 0,
    sourceEnd: 1_199,
    sourceFps: SOURCE_59_94,
    ...overrides,
  }
}

describe('sourceSecondsToTimelineFrame', () => {
  it('maps a source time through the exact source frame and the exact inverse', () => {
    const item = videoItem()

    // 10 s is source frame 599 at 59.94, and timeline frame 599 of an equal-rate clip.
    expect(sourceSecondsToTimelineFrame(item, 10, PROJECT_59_94)).toBe(100 + 599)
  })

  it('maps a 60 fps source in a 59.94 project to the frame that shows it', () => {
    const item = videoItem({ from: 0, sourceEnd: 1_200, sourceFps: 60 })

    // 10 s is source frame 600; source frame 600 is first shown at timeline frame 599.
    expect(sourceSecondsToTimelineFrame(item, 10, PROJECT_59_94)).toBe(599)
  })

  it('maps a reversed clip from its source end', () => {
    const item = videoItem({ sourceEnd: 1_199, isReversed: true })

    // Source frame 599 is 600 frames before the end, so 600 timeline frames.
    expect(sourceSecondsToTimelineFrame(item, 10, PROJECT_59_94)).toBe(100 + 600)
  })

  it('derives the source end from the clip length when the item has none', () => {
    const item = videoItem({ sourceEnd: undefined })

    expect(sourceSecondsToTimelineFrame(item, 0, PROJECT_59_94)).toBe(100)
  })
})

describe('getItemSourceSpanSeconds', () => {
  it('returns the exact source bounds of a 59.94 clip', () => {
    const span = getItemSourceSpanSeconds(videoItem(), PROJECT_59_94)

    expect(span).toEqual({
      start: 0,
      end: frameToSeconds(toRate(SOURCE_59_94), 1_199),
    })
    expect(span?.end).toBeCloseTo(20.003_3, 3)
  })

  it('returns the exact source bounds of a 60 fps clip in a 59.94 project', () => {
    const span = getItemSourceSpanSeconds(
      videoItem({ sourceEnd: 1_200, sourceFps: 60 }),
      PROJECT_59_94,
    )

    expect(span?.start).toBe(0)
    expect(span?.end).toBe(20)
  })

  it('has no span for an item that is not video or audio', () => {
    expect(
      getItemSourceSpanSeconds({ ...videoItem(), type: 'shape' } as unknown as VideoItem, 30),
    ).toBeNull()
  })
})
