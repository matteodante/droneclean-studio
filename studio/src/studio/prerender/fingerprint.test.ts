// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
} from '@/features/timeline/test-helpers'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { frameHashes, type FingerprintInput } from './fingerprint'

const clipA = makeTimelineVideoItem({
  id: 'a',
  trackId: 'v1',
  from: 0,
  durationInFrames: 100,
  mediaId: 'm1',
})
const clipB = makeTimelineVideoItem({
  id: 'b',
  trackId: 'v1',
  from: 100,
  durationInFrames: 100,
  mediaId: 'm2',
})
const music = makeTimelineAudioItem({ id: 'music', trackId: 'a1', from: 0, durationInFrames: 200 })

function track(
  id: string,
  items: TimelineTrack['items'],
  extra: Partial<TimelineTrack> = {},
): TimelineTrack {
  return { ...makeTimelineTrack({ id, name: id, kind: 'video', order: 0 }), items, ...extra }
}

function input(overrides: Partial<FingerprintInput> = {}): FingerprintInput {
  return {
    global: { width: 1920, height: 1080, fps: 30, previewQuality: 1, useProxy: true },
    tracks: [track('v1', [clipA, clipB]), track('a1', [music], { kind: 'audio' })],
    transitions: [],
    keyframes: [],
    compositionsById: new Map(),
    sourceKey: (item) => `original|${item.mediaId}`,
    ...overrides,
  }
}

const RANGE = { start: 0, end: 200 }

/** The frames whose hash differs between two inputs */
function changedFrames(before: FingerprintInput, after: FingerprintInput): number[] {
  const a = frameHashes(before, RANGE)
  const b = frameHashes(after, RANGE)
  const changed: number[] = []
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) changed.push(index)
  return changed
}

function span(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, index) => start + index)
}

describe('frameHashes', () => {
  it('gives the same hashes to the same drawing, and one hash per stretch of the same clips', () => {
    const first = frameHashes(input(), RANGE)
    expect(frameHashes(input(), RANGE)).toEqual(first)
    expect(first[0]).toBe(first[99])
    expect(first[100]).toBe(first[199])
    expect(first[0]).not.toBe(first[100])
  })

  it('makes only the frames of an edited clip stale', () => {
    const edited = { ...clipB, effects: [] as VideoItem['effects'], speed: 2 }
    expect(changedFrames(input(), input({ tracks: [track('v1', [clipA, edited])] }))).toEqual(
      span(100, 200),
    )
  })

  it('ignores audio clips: changing the music redraws no frame', () => {
    const louder = { ...music, volume: 6 }
    expect(
      changedFrames(
        input(),
        input({ tracks: [track('v1', [clipA, clipB]), track('a1', [louder], { kind: 'audio' })] }),
      ),
    ).toEqual([])
  })

  it('makes a moved clip stale where it was and where it is now', () => {
    const moved = { ...clipB, from: 150, durationInFrames: 50 }
    expect(changedFrames(input(), input({ tracks: [track('v1', [clipA, moved])] }))).toEqual(
      span(100, 200),
    )
  })

  it('makes every frame stale when a global input changes (preview quality, proxies, project size)', () => {
    for (const global of [
      { width: 1920, height: 1080, fps: 30, previewQuality: 0.5, useProxy: true },
      { width: 1920, height: 1080, fps: 30, previewQuality: 1, useProxy: false },
      { width: 1280, height: 720, fps: 30, previewQuality: 1, useProxy: true },
    ]) {
      expect(changedFrames(input(), input({ global }))).toEqual(span(0, 200))
    }
  })

  it('makes a clip stale when its keyframes or the file it reads change', () => {
    const keyframes: ItemKeyframes[] = [{ itemId: 'a', properties: [] }]
    expect(changedFrames(input(), input({ keyframes }))).toEqual(span(0, 100))
    expect(
      changedFrames(
        input(),
        input({ sourceKey: (item) => (item.id === 'b' ? 'proxy|m2' : `original|${item.mediaId}`) }),
      ),
    ).toEqual(span(100, 200))
  })

  it('makes the frames of a hidden track stale, and leaves the rest', () => {
    const hidden = input({
      tracks: [
        track('v1', [clipA, clipB]),
        track('v2', [{ ...clipA, id: 'top', trackId: 'v2' }], { visible: false }),
      ],
    })
    const shown = input({
      tracks: [track('v1', [clipA, clipB]), track('v2', [{ ...clipA, id: 'top', trackId: 'v2' }])],
    })
    expect(changedFrames(hidden, shown)).toEqual(span(0, 100))
    expect(changedFrames(input(), hidden)).toEqual([])
  })

  it('makes a transition stale on its window, and both of its clips stale wholly', () => {
    const transition = {
      id: 't1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'a',
      rightClipId: 'b',
      trackId: 'v1',
      durationInFrames: 20,
      alignment: 0.5,
    } as unknown as Transition
    const withTransition = input({ transitions: [transition] })
    const changed = changedFrames(input(), withTransition)
    // The window sits on the cut at frame 100: a new segment, so the frames around the cut change
    expect(changed).toContain(95)
    expect(changed).toContain(104)
    expect(changed).not.toContain(0)
    expect(changed).not.toContain(199)
    const longer = input({ transitions: [{ ...transition, durationInFrames: 30 } as Transition] })
    expect(changedFrames(withTransition, longer).length).toBeGreaterThan(0)
  })

  it('hashes the whole timeline for a clip that reads another clip (a transform parent)', () => {
    const child = { ...clipB, transformParent: { itemId: 'a' } } as unknown as VideoItem
    const parented = input({ tracks: [track('v1', [clipA, child])] })
    const parentMoved = input({
      tracks: [track('v1', [{ ...clipA, transform: { x: 10 } } as VideoItem, child])],
    })
    // Clip a's own frames change, and so do the child's, though their spans do not meet
    expect(changedFrames(parented, parentMoved)).toEqual(span(0, 200))
  })

  it('makes a compound clip stale when its sub-composition changes', () => {
    const compound = makeTimelineVideoItem({
      id: 'cc',
      trackId: 'v1',
      from: 0,
      durationInFrames: 100,
    })
    const wrapper = {
      ...compound,
      type: 'composition',
      compositionId: 'sub',
    } as unknown as VideoItem
    const sub = { id: 'sub', name: 'Sub', items: [clipA], tracks: [], markers: [] }
    const before = input({
      tracks: [track('v1', [wrapper, clipB])],
      compositionsById: new Map([['sub', sub]]),
    })
    const renamed = input({
      tracks: [track('v1', [wrapper, clipB])],
      compositionsById: new Map([['sub', { ...sub, name: 'Renamed', markers: [{ id: 'x' }] }]]),
    })
    const edited = input({
      tracks: [track('v1', [wrapper, clipB])],
      compositionsById: new Map([['sub', { ...sub, items: [{ ...clipA, speed: 3 }] }]]),
    })
    expect(changedFrames(before, renamed)).toEqual([])
    expect(changedFrames(before, edited)).toEqual(span(0, 100))
  })
})
