// The optical flow's two settings on a clip (design 11.24, "Motion detail" and "Hard edges"): a non-default value is
// written with the project and hydrates back; a default value, an unknown one, or either without smooth slow motion by
// optical flow is dropped on the way in, so a clip that never touched them stores (and renders) exactly as before.

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import type { VideoItem } from '@/types/timeline'
import {
  buildTimelineFromStores,
  hydrateTimelineStoresFromProject,
} from '@/features/timeline/stores/timeline-persistence'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { makeTimelineTrack, makeTimelineVideoItem } from '@/features/timeline/test-helpers'
import { flowSettingsOf, isFlowDetail, isFlowEdges } from './settings'

const TRACK = makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })

/** The clip's motion blur after a save and a load of a project holding `motionBlur` on it */
async function throughSaveAndLoad(motionBlur: unknown): Promise<VideoItem['motionBlur']> {
  useItemsStore
    .getState()
    .setItems([
      makeTimelineVideoItem({ id: 'clip-1', trackId: TRACK.id, motionBlur: motionBlur as VideoItem['motionBlur'] }),
    ])
  const saved = buildTimelineFromStores()
  const project: Project = {
    id: 'project-1',
    name: 'Optical flow settings',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline: JSON.parse(JSON.stringify(saved)) as typeof saved,
  }
  useItemsStore.getState().setItems([])
  await hydrateTimelineStoresFromProject(project)
  return (useItemsStore.getState().itemById['clip-1'] as VideoItem | undefined)?.motionBlur
}

describe("the optical flow's settings on a clip (design 11.24)", () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([TRACK])
    useTimelineCommandStore.getState().clearHistory()
  })

  it('keeps high motion detail and nearest-frame hard edges through a save and a load', async () => {
    const settings = { shutterDegrees: 0, smoothSlowMotion: 'optical-flow', flowDetail: 'high', flowEdges: 'nearest' }
    expect(await throughSaveAndLoad(settings)).toEqual(settings)
  })

  it('drops the defaults, so a clip on normal detail and mixed edges is stored as one that never chose them', async () => {
    expect(
      await throughSaveAndLoad({ shutterDegrees: 180, smoothSlowMotion: 'optical-flow', flowDetail: 'normal', flowEdges: 'mix' }),
    ).toEqual({ shutterDegrees: 180, smoothSlowMotion: 'optical-flow' })
  })

  it('drops them without smooth slow motion by optical flow, and drops an unknown value', async () => {
    expect(
      await throughSaveAndLoad({ shutterDegrees: 180, smoothSlowMotion: 'blend', flowDetail: 'high', flowEdges: 'nearest' }),
    ).toEqual({ shutterDegrees: 180, smoothSlowMotion: 'blend' })
    expect(await throughSaveAndLoad({ shutterDegrees: 180, flowDetail: 'high' })).toEqual({ shutterDegrees: 180 })
    expect(
      await throughSaveAndLoad({ shutterDegrees: 180, smoothSlowMotion: 'optical-flow', flowDetail: 'ultra', flowEdges: 3 }),
    ).toEqual({ shutterDegrees: 180, smoothSlowMotion: 'optical-flow' })
  })

  it('names the values the panel and the SDK accept, the default first', () => {
    expect(['normal', 'high'].every(isFlowDetail)).toBe(true)
    expect(['mix', 'nearest'].every(isFlowEdges)).toBe(true)
    expect(isFlowDetail('ultra')).toBe(false)
    expect(isFlowEdges(undefined)).toBe(false)
    expect(flowSettingsOf('optical-flow', { flowDetail: 'high', flowEdges: 'mix' })).toEqual({ flowDetail: 'high' })
    expect(flowSettingsOf(undefined, { flowDetail: 'high' })).toEqual({})
  })
})
