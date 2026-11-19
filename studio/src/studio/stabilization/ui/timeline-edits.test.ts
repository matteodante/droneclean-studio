// Trim and split keep a clip's stabilization in step (task 6.4): both halves of a split carry the clip's settings and
// so share its engine (the engine key is the media and the settings, never the clip), a trim leaves the settings
// alone, and a change to one half's settings later gives that half its own engine without touching the other.

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetTimelineItemsTestState } from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import type { VideoItem } from '@/types/timeline'
import { stabilizationEngineKey } from '../engine-key'
import type { StabilizationSettings } from '../settings'

const SETTINGS: StabilizationSettings = {
  enabled: true,
  method: 'Default',
  params: { smoothness: 0.7 },
  fov: 1.1,
  horizonLockPercent: 50,
  horizonLockRoll: 10,
  adaptiveZoomSeconds: 2,
}

function video(id: string): VideoItem {
  return {
    id,
    trackId: 'track-1',
    type: 'video',
    label: 'DJI_0020.MP4',
    mediaId: 'media-1',
    src: 'blob:clip',
    from: 0,
    durationInFrames: 600,
    sourceStart: 0,
    sourceEnd: 600,
    sourceFps: 59.94,
    stabilization: SETTINGS,
  }
}

const itemOf = (id: string) => useItemsStore.getState().itemById[id] as VideoItem

describe('stabilization through split and trim', () => {
  beforeEach(() => {
    resetTimelineItemsTestState()
    useItemsStore.getState().setItems([video('clip')])
  })

  it('gives both halves of a split the same settings and the same engine', () => {
    const result = useItemsStore.getState()._splitItem('clip', 250)
    expect(result).not.toBeNull()
    const left = itemOf(result!.leftItem.id)
    const right = itemOf(result!.rightItem.id)
    expect(left.stabilization).toEqual(SETTINGS)
    expect(right.stabilization).toEqual(SETTINGS)
    // the split is at timeline frame 250 of a 30 fps timeline: source frame 499 of a 59.94 fps file
    expect(right.sourceStart).toBe(499)
    expect(stabilizationEngineKey(left)).not.toBeNull()
    expect(stabilizationEngineKey(left)).toBe(stabilizationEngineKey(right))
  })

  it('leaves the settings alone when either end is trimmed, and when the trim is undone', () => {
    const store = useItemsStore.getState()
    store._trimItemStart('clip', 100)
    store._trimItemEnd('clip', -100)
    const trimmed = itemOf('clip')
    expect(trimmed.durationInFrames).toBe(400)
    expect(trimmed.stabilization).toEqual(SETTINGS)
    store._trimItemStart('clip', -100)
    store._trimItemEnd('clip', 100)
    expect(itemOf('clip').stabilization).toEqual(SETTINGS)
  })

  it('moves one half to its own engine when only its settings change', () => {
    const result = useItemsStore.getState()._splitItem('clip', 250)!
    const rightId = result.rightItem.id
    useItemsStore
      .getState()
      ._updateItem(rightId, { stabilization: { ...SETTINGS, fov: 1.3 } })
    const left = itemOf(result.leftItem.id)
    const right = itemOf(rightId)
    expect(stabilizationEngineKey(left)).not.toBe(stabilizationEngineKey(right))
    expect(left.stabilization).toEqual(SETTINGS)
  })
})
