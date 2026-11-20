import { describe, expect, it, vi } from 'vite-plus/test'
import type { MotionBlurQuery } from '@/studio/motion-blur'
import { toRate } from '@/studio/time'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { exactSourcePosition, sourceFramePlan, type SourceFramePlanSources } from './plan'

// The plan is asked with every DroneClean switch on: the motion blur switch is off until slices B and D draw it.
vi.mock('@/studio/feature-switches', () => ({ isFeatureShown: () => true }))

function clip(extra: Record<string, unknown> = {}): VideoItem {
  return {
    id: 'c',
    type: 'video',
    trackId: 't',
    label: 'c',
    mediaId: 'm',
    src: 'blob:c',
    from: 0,
    durationInFrames: 100,
    sourceStart: 0,
    ...extra,
  } as VideoItem
}

/** A source at 1:1 plus a constant-speed blur query, so the expectations are computed by hand below. */
function sources(
  speed: number,
  shutterDegrees: 90 | 180 | 270 | 360 = 360,
): SourceFramePlanSources {
  const rate = toRate(60)
  return {
    position: (_item, frame) => ({ frame: 100 + frame * speed }),
    motionBlurQuery: (_item, frame): MotionBlurQuery => ({
      clip: { type: 'video', sourceStart: 100, sourceFps: 60, speed },
      timelineFrame: frame,
      projectRate: rate,
      shutterDegrees,
    }),
  }
}

describe('sourceFramePlan', () => {
  it('blur off: one sample at weight 1, at the mapping’s own source frame', () => {
    expect(sourceFramePlan(clip(), 7, sources(1))).toEqual({ samples: [{ index: 107, weight: 1 }] })
  })

  it('takes the exact mapping: a 2x clip with a cut remainder, and a 59.94 source in a 60 project', () => {
    const plan = (item: VideoItem, frame: number, fps: number | ReturnType<typeof toRate>) =>
      sourceFramePlan(item, frame, { ...sources(1), position: exactSourcePosition(fps) }).samples
    // 2x: frame 5 is source 10; with a remainder of 1/2 the floor is still 10 (10.5), and frame 3 is 6.5 -> 6
    const fast = clip({ speed: 2, sourceStart: 0, sourceFrameOffset: { num: 1, den: 2 } })
    expect(plan(fast, 5, 60)).toEqual([{ index: 10, weight: 1 }])
    expect(plan(fast, 3, 60)).toEqual([{ index: 6, weight: 1 }])
    // 60000/1001 source in a 60 fps project: frame 1001 is source 1000.999..., exactly 1001*(60000/1001)/60 = 1000
    const ntsc = clip({ sourceFps: 59.94 })
    expect(plan(ntsc, 1001, toRate(60))).toEqual([{ index: 1000, weight: 1 }])
    expect(plan(ntsc, 1000, toRate(60))).toEqual([{ index: 999, weight: 1 }])
  })

  it('blur off ignores the blur query', () => {
    const never: SourceFramePlanSources = {
      ...sources(4),
      motionBlurQuery: () => {
        throw new Error('must not be asked')
      },
    }
    expect(sourceFramePlan(clip(), 2, never).samples).toEqual([{ index: 108, weight: 1 }])
  })

  it('blur on at 4x with a 360 shutter: four equal samples over the span', () => {
    const plan = sourceFramePlan(clip({ motionBlur: { shutterDegrees: 360 } }), 2, sources(4))
    // frame 2 covers source [108, 112): frames 108..111 at a quarter each.
    // each blurred over its own source interval, so the four join into one smear (design 9.2)
    expect(plan.samples).toEqual([
      { index: 108, weight: 0.25, extent: 1 },
      { index: 109, weight: 0.25, extent: 1 },
      { index: 110, weight: 0.25, extent: 1 },
      { index: 111, weight: 0.25, extent: 1 },
    ])
  })

  it('blur on at 4x with a 180 shutter: the first half of the span', () => {
    const plan = sourceFramePlan(clip({ motionBlur: { shutterDegrees: 180 } }), 0, sources(4, 180))
    expect(plan.samples.map((s) => s.index)).toEqual([100, 101])
    expect(plan.samples.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1, 12)
  })

  it('blur on at 1x is one sample at weight 1, blurred over the shutter’s share of its interval', () => {
    const plan = sourceFramePlan(clip({ motionBlur: { shutterDegrees: 360 } }), 5, sources(1))
    expect(plan.samples).toEqual([{ index: 105, weight: 1, extent: 1 }])
  })

  it('blur on but no query for the clip falls back to the single sample', () => {
    const none: SourceFramePlanSources = { ...sources(1), motionBlurQuery: () => undefined }
    expect(sourceFramePlan(clip({ motionBlur: { shutterDegrees: 360 } }), 1, none).samples).toEqual(
      [{ index: 101, weight: 1 }],
    )
  })

  it('4x on a 1199 frame source: the last output frame uses 1196-1198 at a third each', () => {
    const rate = toRate(60)
    const item = clip({ motionBlur: { shutterDegrees: 360 }, sourceStart: 0, sourceDuration: 1199 })
    const at = (frame: number): SourceFramePlanSources => ({
      ...sources(4),
      sourceFrameCount: (it) => it.sourceDuration,
      motionBlurQuery: (): MotionBlurQuery => ({
        clip: { type: 'video', sourceStart: 0, sourceFps: 60, speed: 4 },
        timelineFrame: frame,
        projectRate: rate,
        shutterDegrees: 360,
      }),
    })
    // frame 299 covers [1196, 1200): frame 1199 is past the file
    const last = sourceFramePlan(item, 299, at(299)).samples
    expect(last.map((s) => s.index)).toEqual([1196, 1197, 1198])
    for (const s of last) expect(s.weight).toBeCloseTo(1 / 3, 12)
    // an earlier frame is untouched
    expect(sourceFramePlan(item, 298, at(298)).samples).toHaveLength(4)
    // without the count the plan is as before
    expect(sourceFramePlan(item, 299, { ...at(299), sourceFrameCount: undefined }).samples).toHaveLength(4)
  })

  it('optical-flow slow motion: a frame between two source frames carries its phase over the blend', () => {
    const rate = toRate(60)
    const item = clip({ motionBlur: { shutterDegrees: 180, smoothSlowMotion: 'optical-flow' }, sourceDuration: 200 })
    const at = (frame: number, sourceStart = 100): SourceFramePlanSources => ({
      ...sources(0.5),
      sourceFrameCount: (it) => it.sourceDuration,
      motionBlurQuery: (): MotionBlurQuery => ({
        clip: { type: 'video', sourceStart, sourceFps: 60, speed: 0.5 },
        timelineFrame: frame,
        projectRate: rate,
        shutterDegrees: 180,
        smoothSlowMotion: 'optical-flow',
      }),
    })
    // 0.5x at 180 degrees: each frame stands for a quarter of a source frame's motion
    expect(sourceFramePlan(item, 3, at(3))).toEqual({
      samples: [
        { index: 101, weight: 0.5, extent: 0.25 },
        { index: 102, weight: 0.5, extent: 0.25 },
      ],
      flow: { phase: 0.5 },
    })
    expect(sourceFramePlan(item, 4, at(4))).toEqual({ samples: [{ index: 102, weight: 1, extent: 0.25 }] })
    // The file's last gap: its second frame (200) does not exist, so the frame is 199 alone, with no flow
    expect(sourceFramePlan(item, 1, at(1, 199))).toEqual({ samples: [{ index: 199, weight: 1, extent: 0.25 }] })
  })

  it('an Amount of 0 is optical-flow slow motion with no blur: the phase, and no extent on any sample', () => {
    const rate = toRate(60)
    const item = clip({ motionBlur: { shutterDegrees: 0, smoothSlowMotion: 'optical-flow' }, sourceDuration: 200 })
    const at = (frame: number): SourceFramePlanSources => ({
      ...sources(0.5),
      sourceFrameCount: (it) => it.sourceDuration,
      motionBlurQuery: (): MotionBlurQuery => ({
        clip: { type: 'video', sourceStart: 100, sourceFps: 60, speed: 0.5 },
        timelineFrame: frame,
        projectRate: rate,
        shutterDegrees: 0,
        smoothSlowMotion: 'optical-flow',
      }),
    })
    // Matteo, 20 Nov 2026: Twixtor without a smear; the pipeline draws an interpolated frame and runs no blur pass
    expect(sourceFramePlan(item, 3, at(3))).toEqual({
      samples: [
        { index: 101, weight: 0.5 },
        { index: 102, weight: 0.5 },
      ],
      flow: { phase: 0.5 },
    })
    expect(sourceFramePlan(item, 4, at(4))).toEqual({ samples: [{ index: 102, weight: 1 }] })
  })

  it('refuses a bad position and a non-video item', () => {
    const negative: SourceFramePlanSources = { ...sources(1), position: () => ({ frame: -1 }) }
    expect(() => sourceFramePlan(clip(), 0, negative)).toThrow(RangeError)
    const text = { id: 'x', type: 'text' } as unknown as TimelineItem
    expect(() => sourceFramePlan(text, 0, sources(1))).toThrow(RangeError)
  })
})
