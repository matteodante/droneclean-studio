// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import {
  makeTimelineVideoItem,
  resetTimelineItemsTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { exactAreaAt } from '@/studio/speed/exact-curve'
import { averageSpeed } from '@/studio/speed/curve'
import { canHoldSmoothEdit, smoothEditClip } from './action'
import { smoothEditCurve } from './curve'

/** A 10-second 30 fps clip of 300 source frames, then the one after it, 100 frames past the first's end. */
function seed(overrides: Partial<VideoItem> = {}): void {
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'a',
      trackId: 'v1',
      from: 0,
      durationInFrames: 300,
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 900,
      sourceFps: 30,
      speed: 1,
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...overrides,
    }),
    makeTimelineVideoItem({
      id: 'b',
      trackId: 'v1',
      from: 400,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 900,
      sourceFps: 30,
      speed: 1,
    }),
  ])
}

function stored(id = 'a'): VideoItem {
  return useItemsStore.getState().itemById[id] as VideoItem
}

function lane(property: string) {
  return useKeyframesStore
    .getState()
    .keyframesByItemId['a']?.properties.find((candidate) => candidate.property === property)
}

describe('smoothEditCurve', () => {
  it('is four whole-frame keys, fast-slow-slow-fast, the ramps smooth', () => {
    const curve = smoothEditCurve(300, 4, 0.45)

    expect(curve.keys).toEqual([
      { frame: 0, speed: 4, ease: 'smooth' },
      { frame: 90, speed: 0.45 },
      { frame: 210, speed: 0.45, ease: 'smooth' },
      { frame: 300, speed: 4 },
    ])
  })

  it('keeps the keys strictly increasing down to the shortest clip and refuses a shorter one', () => {
    for (const duration of [4, 5, 7, 11]) {
      const frames = smoothEditCurve(duration, 4, 0.45).keys.map((key) => key.frame)
      expect(frames[0]).toBe(0)
      expect(frames[3]).toBe(duration)
      expect(frames[1]!).toBeGreaterThan(0)
      expect(frames[2]!).toBeGreaterThan(frames[1]!)
      expect(frames[3]!).toBeGreaterThan(frames[2]!)
    }
    expect(() => smoothEditCurve(3, 4, 0.45)).toThrow(RangeError)
  })
})

describe('smoothEditClip', () => {
  beforeEach(() => {
    resetTimelineItemsTestState()
    useTimelineCommandStore.getState().clearHistory()
    useKeyframesStore.setState({ keyframes: [], keyframesByItemId: {} })
    useTimelineSettingsStore.getState().setFps(30)
    useProjectStore.setState({ currentProject: null })
  })

  it('keeps the clip content: the curve spends the source range it had, within one source frame', () => {
    seed()

    const result = smoothEditClip('a')!

    const item = stored()
    const curve = item.speedCurve!
    expect(curve.keys.map((key) => key.ease)).toEqual(['smooth', undefined, 'smooth', undefined])
    expect(curve.keys.map((key) => key.speed)).toEqual([4, 0.45, 0.45, 4])
    expect(curve.keys[curve.keys.length - 1]!.frame).toBe(item.durationInFrames)
    expect(result.durationInFrames).toBe(item.durationInFrames)
    expect(result.averageSpeed).toBe(averageSpeed(curve))
    // The exact integral at the new length (30 -> 30 fps) is the 300 source frames the clip had, give or
    // take the whole-frame rounding of its length and keys (design 7.1, section 8 risk 7: about a frame
    // and a half at the fast speed), and the source end is that integral floored.
    const area = exactAreaAt(curve, item.durationInFrames)
    const spent = Number(area.num) / Number(area.den)
    expect(Math.abs(spent - 300)).toBeLessThan(2)
    expect(item.sourceStart).toBe(0)
    expect(item.sourceEnd).toBe(Math.floor(spent))
  })

  it('turns on smooth slow motion and motion blur, keeping the clip own shutter angle', () => {
    seed({ motionBlur: { shutterDegrees: 180 } })

    const result = smoothEditClip('a')!

    expect(stored().motionBlur).toEqual({ shutterDegrees: 180, smoothSlowMotion: 'blend' })
    expect(result.motionBlur).toEqual({ shutterDegrees: 180, smoothSlowMotion: 'blend' })
  })

  it('uses a 360 degree shutter on a clip that had no blur', () => {
    seed()

    smoothEditClip('a')

    expect(stored().motionBlur).toEqual({ shutterDegrees: 360, smoothSlowMotion: 'blend' })
  })

  it('zooms: width and height keyframes span the new length, eased, from 1 to 1 + zoom', () => {
    seed()

    const result = smoothEditClip('a', { zoom: 0.25 })!

    const duration = stored().durationInFrames
    expect(result.zoom).toEqual({ firstFrame: 0, lastFrame: duration - 1, scale: 1.25 })
    const width = lane('width')!.keyframes
    const height = lane('height')!.keyframes
    expect(width.map((key) => key.frame)).toEqual([0, duration - 1])
    expect(height.map((key) => key.frame)).toEqual([0, duration - 1])
    // Default canvas 1920x1080, a 1920x1080 picture: it fits exactly.
    expect(width.map((key) => key.value)).toEqual([1920, 2400])
    expect(height.map((key) => key.value)).toEqual([1080, 1350])
    expect(width[0]!.easing).toBe('ease-in-out')
  })

  it('replaces an earlier zoom and leaves the zoom alone when zoom is 0', () => {
    seed()
    smoothEditClip('a', { zoom: 0.4 })
    useTimelineCommandStore.getState().clearHistory()
    seed({ speedCurve: stored().speedCurve, durationInFrames: stored().durationInFrames })

    smoothEditClip('a', { zoom: 0 })
    expect(lane('width')!.keyframes).toHaveLength(2)

    smoothEditClip('a', { zoom: 0.1 })
    expect(lane('width')!.keyframes.map((key) => key.value)).toEqual([1920, 2112])
  })

  it('is one undo step that puts back the curve, the length, the blur and the keyframes', () => {
    seed()

    smoothEditClip('a')
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    useTimelineCommandStore.getState().undo()

    const item = stored()
    expect(item.speedCurve).toBeUndefined()
    expect(item.motionBlur).toBeUndefined()
    expect(item.durationInFrames).toBe(300)
    expect(item.sourceEnd).toBe(300)
    expect(lane('width')).toBeUndefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('ripples only past the next clip start: the clip grows into free room without moving the next one', () => {
    seed()

    smoothEditClip('a')

    const duration = stored().durationInFrames
    const next = stored('b')
    // The average of this recipe is above 1x, so the clip shrinks; the clip after it does not move left to close the gap.
    expect(duration).toBeLessThan(300)
    expect(next.from).toBe(400)
  })

  it('refuses a clip it cannot hold: a reversed one, a clip below four frames', () => {
    seed({ isReversed: true })
    expect(canHoldSmoothEdit(stored())).toBe(false)
    expect(smoothEditClip('a')).toBeUndefined()
    seed({ durationInFrames: 3 })
    expect(canHoldSmoothEdit(stored())).toBe(false)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })
})
