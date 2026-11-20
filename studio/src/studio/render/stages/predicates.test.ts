import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { setNativeExportSession } from '@/studio/render/precise/native-session'
import {
  hasInputColour,
  hasLook,
  isStabilized,
  needsExactSourceFrame,
  needsSourceStages,
  sourceStageFingerprint,
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
    ['motion blur at 1x', { motionBlur: { shutterDegrees: 180 } }, true, true],
    ['motion blur at 4x', { motionBlur: { shutterDegrees: 180 }, speed: 4 }, true, true],
    [
      'motion blur on a curve that peaks at 4x',
      { motionBlur: { shutterDegrees: 360 }, speedCurve: curve },
      true,
      true,
    ],
    ['motion blur below 1x', { motionBlur: { shutterDegrees: 360 }, speed: 0.5 }, true, true],
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
    expect(needsSourceStages(blurred)).toBe(false)
    expect(needsExactSourceFrame(blurred)).toBe(false)
  })
})

describe('the vector blur acts at every speed (design 9.2)', () => {
  it('stages a blurred clip from exact frames at 1x, slower and faster, whatever its rate', () => {
    for (const extra of [{ speed: 1 }, { speed: 0.5 }, { speed: 4 }, { speed: 1, sourceFps: 120 }, { speed: 1, sourceFps: 30 }]) {
      const item = clip({ motionBlur: { shutterDegrees: 180 }, ...extra })
      expect(needsSourceStages(item)).toBe(true)
      expect(needsExactSourceFrame(item)).toBe(true)
    }
  })

  it('leaves a clip without blur unstaged, whatever its speed', () => {
    for (const speed of [0.5, 1, 4]) {
      expect(needsSourceStages(clip({ speed }))).toBe(false)
      expect(needsExactSourceFrame(clip({ speed }))).toBe(false)
    }
  })
})

describe('the fingerprint of what the per-source-frame stages read', () => {
  it('changes with the stabilization, its framing, the input colour and the cleaned pieces, and with nothing else', () => {
    const base = clip({ stabilization: { enabled: true, smoothness: 0.5 } })
    const same = sourceStageFingerprint(base)
    expect(sourceStageFingerprint(clip({ stabilization: { enabled: true, smoothness: 0.5 }, speed: 4, label: 'x' }))).toBe(same)
    expect(sourceStageFingerprint(clip({ stabilization: { enabled: true, smoothness: 0.6 } }))).not.toBe(same)
    expect(sourceStageFingerprint(clip({ stabilization: { enabled: true, smoothness: 0.5, framingX: 0.1 } }))).not.toBe(same)
    expect(sourceStageFingerprint(clip({ stabilization: { enabled: true, smoothness: 0.5 }, inputColor: 'dlog-m' }))).not.toBe(same)
    expect(
      sourceStageFingerprint(clip({ stabilization: { enabled: true, smoothness: 0.5 }, shadowRemoval: { pieces: [{ from: 1 }] } })),
    ).not.toBe(same)
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
