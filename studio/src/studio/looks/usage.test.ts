// @vitest-environment node
//
// Which looks a project uses (design 5.1 §4.4, §6 slice 5.2b): the ids the render seat registers,
// and the count the library asks about before deleting a look — including the clips inside a
// sub-composition, and a look field a hand-edited project file got wrong.

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { makeTimelineTrack, makeTimelineVideoItem } from '@/features/timeline/test-helpers'
import type { ClipLook } from './types'
import type { TextItem } from '@/types/timeline'
import { collectUsedLookIds, countClipsUsingLook } from './usage'

const TRACK = makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })

const TEXT: TextItem = {
  id: 'text-1',
  trackId: 'track-v1',
  type: 'text',
  label: 'Title',
  text: 'Hello',
  color: '#ffffff',
  from: 0,
  durationInFrames: 60,
}

const COMPOSITION = {
  id: 'comp-1',
  name: 'Compound clip',
  tracks: [makeTimelineTrack({ id: 'comp-track-v1', name: 'V1', kind: 'video', order: 0 })],
  items: [
    makeTimelineVideoItem({
      id: 'nested-video',
      trackId: 'comp-track-v1',
      look: { id: 'look-a', intensity: 1 },
    }),
  ],
  transitions: [],
  keyframes: [],
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 60,
}

beforeEach(() => {
  useItemsStore.getState().setTracks([TRACK])
  useItemsStore
    .getState()
    .setItems([
      makeTimelineVideoItem({ id: 'video-a', look: { id: 'look-a', intensity: 0.5 } }),
      makeTimelineVideoItem({ id: 'video-b', look: { id: 'look-b', intensity: 1 } }),
      makeTimelineVideoItem({ id: 'video-none' }),
      TEXT,
    ])
  useCompositionsStore.getState().setCompositions([COMPOSITION])
})

describe('the looks a project uses', () => {
  it('collects the ids of the open timeline and of the sub-compositions', () => {
    expect([...collectUsedLookIds()].sort()).toEqual(['look-a', 'look-b'])
  })

  it('counts every clip that uses a look, nested ones included', () => {
    expect(countClipsUsingLook('look-a')).toBe(2)
    expect(countClipsUsingLook('look-b')).toBe(1)
    expect(countClipsUsingLook('look-gone')).toBe(0)
  })

  it('ignores a look field that is not a look', () => {
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({ id: 'broken-string', look: 'hero' as unknown as ClipLook }),
        makeTimelineVideoItem({ id: 'broken-id', look: { id: 7 } as unknown as ClipLook }),
        makeTimelineVideoItem({ id: 'broken-null', look: null as unknown as ClipLook }),
      ])
    useCompositionsStore.getState().setCompositions([])

    expect(collectUsedLookIds().size).toBe(0)
    expect(countClipsUsingLook('7')).toBe(0)
  })
})
