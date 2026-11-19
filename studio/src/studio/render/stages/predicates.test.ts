import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { toRate } from '@/studio/time'
import { setNativeExportSession } from '@/studio/render/precise/native-session'
import {
  hasInputColour,
  hasLook,
  hasMotionBlurSpan,
  isStabilized,
  needsExactSourceFrame,
  needsSourceStages,
  setProjectRate,
} from './predicates'

const looks = vi.hoisted(() => ({ shown: true }))
vi.mock('@/studio/feature-switches', () => ({ isFeatureShown: () => looks.shown }))

function clip(extra: Record<string, unknown> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    label: 'clip',
    mediaId: 'media-1',
    src: 'blob:clip',
    from: 0,
    durationInFrames: 120,
    sourceFps: 59.94,
    sourceStart: 0,
    sourceDuration: 1000,
    ...extra,
  } as VideoItem
}

const stabilization = { enabled: true, method: 'Default', params: {}, fov: 1 }
const piece = { startFrame: 0, frames: 10, path: 'p.mp4' }
const curve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 100, speed: 4 },
  ],
}

beforeEach(() => {
  looks.shown = true
})

describe('needsSourceStages and needsExactSourceFrame: the truth table', () => {
  const rows: Array<[string, Record<string, unknown>, boolean, boolean]> = [
    // name, fields, needsSourceStages, needsExactSourceFrame
    ['a plain clip', {}, false, false],
    ['a clip at constant speed 2 (the DOM video plays it)', { speed: 2 }, false, false],
    ['stabilized', { stabilization }, true, true],
    [
      'stabilization present but switched off',
      { stabilization: { ...stabilization, enabled: false } },
      false,
      false,
    ],
    ['D-Log M input colour', { inputColor: 'dji-dlog-m' }, true, false],
    ['input colour none', { inputColor: 'none' }, false, false],
    ['a look', { look: { id: 'film', intensity: 1 } }, true, false],
    ['a look at intensity 0', { look: { id: 'film', intensity: 0 } }, false, false],
    ['motion blur at 1x', { motionBlur: { shutterDegrees: 180 } }, false, false],
    ['motion blur at 4x', { motionBlur: { shutterDegrees: 180 }, speed: 4 }, true, true],
    [
      'motion blur on a curve that peaks at 4x',
      { motionBlur: { shutterDegrees: 360 }, speedCurve: curve },
      true,
      true,
    ],
    ['motion blur below 1x', { motionBlur: { shutterDegrees: 360 }, speed: 0.5 }, false, false],
    ['a speed curve alone', { speedCurve: curve }, false, true],
    [
      'a speed curve that stays at 1x',
      { speedCurve: { keys: [{ frame: 0, speed: 1 }] } },
      false,
      true,
    ],
    ['cleaned shadow pieces', { shadowRemoval: { pieces: [piece] } }, false, true],
    ['shadow removal with no pieces yet', { shadowRemoval: { pieces: [] } }, false, false],
    ['reversed', { isReversed: true }, false, true],
    ['reversed and stabilized', { isReversed: true, stabilization }, true, true],
  ]
  it.each(rows)('%s', (_name, fields, stages, exact) => {
    const item = clip(fields)
    expect(needsSourceStages(item)).toBe(stages)
    expect(needsExactSourceFrame(item)).toBe(exact)
  })

  it('a clip whose stages are only per-pixel (input colour, a look) needs no exact frame; with a warp it does', () => {
    expect(needsExactSourceFrame(clip({ inputColor: 'dji-dlog-m', look: { id: 'film', intensity: 1 } }))).toBe(
      false,
    )
    expect(needsExactSourceFrame(clip({ inputColor: 'dji-dlog-m', stabilization }))).toBe(true)
    expect(needsExactSourceFrame(clip({ inputColor: 'dji-dlog-m', isReversed: true }))).toBe(true)
  })

  it('an item that is not a video needs neither', () => {
    const text = { id: 't', type: 'text', inputColor: 'dji-dlog-m' } as unknown as TimelineItem
    expect(needsSourceStages(text)).toBe(false)
    expect(needsExactSourceFrame(text)).toBe(false)
  })
})

describe('the single field predicates', () => {
  it('reads each field once', () => {
    expect(isStabilized(clip({ stabilization }))).toBe(true)
    expect(isStabilized(clip())).toBe(false)
    expect(hasInputColour(clip({ inputColor: 'dji-dlog-m' }))).toBe(true)
    expect(hasInputColour(clip({ inputColor: 'none' }))).toBe(false)
  })

  it('a look is drawn only while the looks switch is on', () => {
    const item = clip({ look: { id: 'film', intensity: 0.5 } })
    expect(hasLook(item)).toBe(true)
    looks.shown = false
    expect(hasLook(item)).toBe(false)
    expect(needsSourceStages(item)).toBe(false)
  })
})

describe('motion blur and its feature switch', () => {
  const blurred = clip({ motionBlur: { shutterDegrees: 360 }, speed: 4 })

  it('a blurred clip at 4x is staged only while the motion blur switch is on', () => {
    expect(needsSourceStages(blurred)).toBe(true)
    expect(needsExactSourceFrame(blurred)).toBe(true)
    looks.shown = false
    expect(hasMotionBlurSpan(blurred)).toBe(false)
    expect(needsSourceStages(blurred)).toBe(false)
    expect(needsExactSourceFrame(blurred)).toBe(false)
  })
})

describe('motion blur and the playback rates', () => {
  const blurred = clip({ motionBlur: { shutterDegrees: 360 } })

  it('equal rates: no span above 1x', () => {
    const rate = toRate(60)
    expect(hasMotionBlurSpan(blurred, { source: rate, project: rate })).toBe(false)
  })

  it('a 120 fps source in a 60 fps project covers two source frames at 1x', () => {
    expect(hasMotionBlurSpan(blurred, { source: toRate(120), project: toRate(60) })).toBe(true)
    expect(needsSourceStages(blurred, { source: toRate(120), project: toRate(60) })).toBe(true)
  })

  it('59.94 into 60 stays one sample', () => {
    expect(hasMotionBlurSpan(blurred, { source: toRate(59.94), project: toRate(60) })).toBe(false)
  })

  it('a clip without blur never has a span, whatever the rates', () => {
    expect(
      hasMotionBlurSpan(clip({ speed: 4 }), { source: toRate(120), project: toRate(60) }),
    ).toBe(false)
  })
})

describe('the slow-motion blend', () => {
  const blended = (extra: Record<string, unknown> = {}) =>
    clip({ motionBlur: { shutterDegrees: 180, blendSlowMotion: true }, ...extra })
  const equal = { source: toRate(60), project: toRate(60) }

  it('a clip below 1x blends two frames, so it is drawn through the stages from exact frames', () => {
    expect(hasMotionBlurSpan(blended({ speed: 0.5 }), equal)).toBe(true)
    expect(needsSourceStages(blended({ speed: 0.5 }), equal)).toBe(true)
  })

  it('a 30 fps file in a 60 fps project blends at 1x, a 60 fps one does not', () => {
    expect(hasMotionBlurSpan(blended({ speed: 1 }), { source: toRate(30), project: toRate(60) })).toBe(true)
    expect(hasMotionBlurSpan(blended({ speed: 1 }), equal)).toBe(false)
  })

  it('without the blend a slow clip still needs nothing', () => {
    expect(hasMotionBlurSpan(clip({ motionBlur: { shutterDegrees: 180 }, speed: 0.5 }), equal)).toBe(false)
  })
})

describe('the predicates derive the rates from the clip and the project (no argument at the call sites)', () => {
  const fast = (extra: Record<string, unknown> = {}) => clip({ sourceFps: 120, speed: 1, ...extra })

  beforeEach(() => setProjectRate(toRate(60)))
  afterEach(() => setProjectRate(undefined))

  it('a blur clip at 1x with a 120 fps source in a 60 fps project is staged and exact', () => {
    const item = fast({ motionBlur: { shutterDegrees: 360 } })
    expect(hasMotionBlurSpan(item)).toBe(true)
    expect(needsSourceStages(item)).toBe(true)
    expect(needsExactSourceFrame(item)).toBe(true)
  })

  it('the same clip with blur off is not staged', () => {
    expect(needsSourceStages(fast())).toBe(false)
    expect(needsExactSourceFrame(fast())).toBe(false)
  })

  it('equal rates and 59.94 into 60 stay unstaged; a 60 fps source in a 59.94 project is staged', () => {
    const blur = { motionBlur: { shutterDegrees: 360 } }
    expect(needsSourceStages(fast({ ...blur, sourceFps: 60 }))).toBe(false)
    expect(needsSourceStages(fast({ ...blur, sourceFps: 59.94 }))).toBe(false)
    setProjectRate(toRate(59.94))
    expect(needsSourceStages(fast({ ...blur, sourceFps: 60 }))).toBe(true)
  })

  it('without a known project rate the rates are equal', () => {
    setProjectRate(undefined)
    expect(needsSourceStages(fast({ motionBlur: { shutterDegrees: 360 } }))).toBe(false)
  })
})

describe('a precise export draws every video clip through the stages', () => {
  afterEach(() => setNativeExportSession(null))

  it('stages a plain clip while a native 10-bit export runs in this realm, and only then', () => {
    const plain = clip()
    expect(needsSourceStages(plain)).toBe(false)
    setNativeExportSession({ bridge: { startDecode: vi.fn(), cancel: vi.fn() }, paths: new Map() })
    expect(needsSourceStages(plain)).toBe(true)
    // Not an exact-frame question: the provider answers every staged clip of an export with the exact frame anyway.
    expect(needsExactSourceFrame(plain)).toBe(false)
    // Not a title or an image: only video clips have a source to decode.
    expect(needsSourceStages({ id: 'title', type: 'text' } as unknown as TimelineItem)).toBe(false)
    setNativeExportSession(null)
    expect(needsSourceStages(plain)).toBe(false)
  })
})
