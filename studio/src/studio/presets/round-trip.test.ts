// The clip's colour profile survives a save and a load: it is written with the project, the
// project schema lets the optional field through (items are `.passthrough()`), and hydrating the
// timeline stores puts it back on the clip. Design 5.1, section 4.6; slice 5.2a.

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
const CLIP = makeTimelineVideoItem({
  id: 'clip-1',
  trackId: TRACK.id,
  inputColor: 'dlog-m',
})

function projectFromTimeline(timeline: ReturnType<typeof buildTimelineFromStores>): Project {
  return {
    id: 'project-1',
    name: 'Colour preset round trip',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline,
  }
}

describe('VideoItem.inputColor round trip', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([TRACK])
    useItemsStore.getState().setItems([CLIP])
    useTimelineCommandStore.getState().clearHistory()
  })

  it('is written with the project and hydrates back onto the clip', async () => {
    const saved = buildTimelineFromStores()
    expect((saved.items[0] as VideoItem).inputColor).toBe('dlog-m')

    // The project file: JSON, then the loader's hydration.
    const project = projectFromTimeline(JSON.parse(JSON.stringify(saved)) as typeof saved)
    useItemsStore.getState().setItems([])

    await hydrateTimelineStoresFromProject(project)

    const loaded = useItemsStore.getState().itemById[CLIP.id] as VideoItem | undefined
    expect(loaded?.inputColor).toBe('dlog-m')
  })

  it('passes the project schema the bundle load validates with', () => {
    const project = projectFromTimeline(buildTimelineFromStores())

    const result = validateProject(JSON.parse(JSON.stringify(project)) as unknown)

    expect(result.success).toBe(true)
    const item = result.data?.timeline?.items[0] as VideoItem | undefined
    expect(item?.inputColor).toBe('dlog-m')
  })
})
