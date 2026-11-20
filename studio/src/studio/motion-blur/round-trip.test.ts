// A clip's motion blur survives a save and a load (design 7.2, section 4.7): it is written with
// the project, the schema lets the field through, hydrating puts it back, and an angle outside
// the four is clamped to 360 on the way in, so a hand-edited file never reaches a shader.

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
import { validateProject } from '@/features/project-bundle/schemas/project-schema'

const TRACK = makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })

function projectFromTimeline(timeline: ReturnType<typeof buildTimelineFromStores>): Project {
  return {
    id: 'project-1',
    name: 'Motion blur round trip',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline,
  }
}

function stored(): VideoItem | undefined {
  return useItemsStore.getState().itemById['clip-1'] as VideoItem | undefined
}

async function saveAndLoad(): Promise<void> {
  const saved = buildTimelineFromStores()
  const project = projectFromTimeline(JSON.parse(JSON.stringify(saved)) as typeof saved)
  useItemsStore.getState().setItems([])
  await hydrateTimelineStoresFromProject(project)
}

describe('VideoItem.motionBlur round trip', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([TRACK])
    useTimelineCommandStore.getState().clearHistory()
  })

  it('is written with the project and hydrates back onto the clip', async () => {
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({
          id: 'clip-1',
          trackId: TRACK.id,
          motionBlur: { shutterDegrees: 180 },
        }),
      ])

    await saveAndLoad()

    expect(stored()?.motionBlur).toEqual({ shutterDegrees: 180 })
  })

  it('keeps each smooth slow motion mode through a save and a load', async () => {
    for (const smoothSlowMotion of ['blend', 'optical-flow'] as const) {
      useItemsStore
        .getState()
        .setItems([
          makeTimelineVideoItem({
            id: 'clip-1',
            trackId: TRACK.id,
            motionBlur: { shutterDegrees: 270, smoothSlowMotion },
          }),
        ])

      await saveAndLoad()

      expect(stored()?.motionBlur).toEqual({ shutterDegrees: 270, smoothSlowMotion })
    }
  })

  it('loads a project saved with the old blend switch in blend mode, and drops the old field', async () => {
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({
          id: 'clip-1',
          trackId: TRACK.id,
          motionBlur: { shutterDegrees: 270, blendSlowMotion: true } as unknown as VideoItem['motionBlur'],
        }),
      ])

    await saveAndLoad()

    expect(stored()?.motionBlur).toEqual({ shutterDegrees: 270, smoothSlowMotion: 'blend' })
  })

  it('reads an unknown smooth slow motion mode as none', async () => {
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({
          id: 'clip-1',
          trackId: TRACK.id,
          motionBlur: { shutterDegrees: 90, smoothSlowMotion: 'rife' } as unknown as VideoItem['motionBlur'],
        }),
      ])

    await saveAndLoad()

    expect(stored()?.motionBlur).toEqual({ shutterDegrees: 90 })
  })

  it('passes the project schema the bundle load validates with, even with an unknown angle', () => {
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({
          id: 'clip-1',
          trackId: TRACK.id,
          motionBlur: { shutterDegrees: 200 as 180 },
        }),
      ])
    const project = projectFromTimeline(buildTimelineFromStores())

    const result = validateProject(JSON.parse(JSON.stringify(project)) as unknown)

    expect(result.success).toBe(true)
  })

  it.each([[200], [0], [-90], ['180'], [null], [Number.NaN]])(
    'clamps the angle %s to 360 on load',
    async (angle) => {
      useItemsStore
        .getState()
        .setItems([
          makeTimelineVideoItem({
            id: 'clip-1',
            trackId: TRACK.id,
            motionBlur: { shutterDegrees: angle as 180 },
          }),
        ])

      await saveAndLoad()

      expect(stored()?.motionBlur).toEqual({ shutterDegrees: 360 })
    },
  )

  it('drops a motionBlur that is not an object', async () => {
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({
          id: 'clip-1',
          trackId: TRACK.id,
          motionBlur: 'on' as unknown as VideoItem['motionBlur'],
        }),
      ])

    expect(stored()?.motionBlur).toBeUndefined()
    expect('motionBlur' in (stored() ?? {})).toBe(false)
  })
})
