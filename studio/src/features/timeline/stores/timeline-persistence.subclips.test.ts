import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { useSubclipsStore } from '@/studio/subclips'
import {
  buildTimelineFromStores,
  hydrateTimelineStoresFromProject,
  loadTimeline,
} from './timeline-persistence'

// Subclips and remembered marks through the timeline writer and reader (design 1.6, D1 and D5).
const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  updateProject: vi.fn(),
  getMediaForProject: vi.fn(),
  validateProjectMediaReferences: vi.fn(),
}))

vi.mock('@/infrastructure/storage', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, getProject: mocks.getProject, updateProject: mocks.updateProject }
})
vi.mock('@/features/timeline/deps/media-library-service', () => ({
  importMediaLibraryService: async () => ({
    mediaLibraryService: { getMediaForProject: mocks.getMediaForProject },
  }),
}))
vi.mock('@/features/timeline/utils/media-validation', () => ({
  validateProjectMediaReferences: mocks.validateProjectMediaReferences,
}))
vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => ({
      setOrphanedClips: vi.fn(),
      openOrphanedClipsDialog: vi.fn(),
      closeOrphanedClipsDialog: vi.fn(),
    }),
  },
}))
vi.mock('@/shared/projects/migrations', () => ({
  migrateProject: vi.fn((project) => ({
    project,
    migrated: false,
    fromVersion: 1,
    toVersion: 1,
    appliedMigrations: [],
  })),
  CURRENT_SCHEMA_VERSION: 1,
}))

const track = makeTimelineTrack({ id: 'track', name: 'V1', kind: 'video', order: 0 })

function resetAll() {
  resetTimelineCompositionTestState()
  useSubclipsStore.getState().reset()
  useSourcePlayerStore.setState({
    currentMediaId: null,
    activeSubclipId: null,
    activeWindow: null,
    inPoint: null,
    outPoint: null,
    marksByKey: {},
  })
}

function projectWith(timeline: Project['timeline']): Project {
  return {
    id: 'p1',
    name: 'P',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 10,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline,
  }
}

describe('subclips in the project timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAll()
  })
  afterEach(resetAll)

  it('survives saving and reopening into fresh stores', async () => {
    useSourcePlayerStore.getState().setCurrentMediaId('m1')
    useSourcePlayerStore.getState().setInPoint(20)
    useSourcePlayerStore.getState().setOutPoint(80)
    const sub = useSubclipsStore
      .getState()
      .create({ mediaId: 'm1', name: 'Dive', startFrame: 20, endFrame: 80, sourceFps: 29.97 })
    useSourcePlayerStore.getState().setCurrentMediaId('m2')
    useSourcePlayerStore.getState().setInPoint(7)

    const saved = JSON.parse(JSON.stringify(buildTimelineFromStores())) as Project['timeline']
    expect(saved?.subclips).toEqual([sub])
    expect(saved?.sourceMarks).toEqual({ m1: { in: 20, out: 80 }, m2: { in: 7, out: null } })

    resetAll()
    await hydrateTimelineStoresFromProject(
      projectWith({
        ...saved!,
        tracks: [track],
        items: [makeTimelineVideoItem({ id: 'i', trackId: track.id })],
      }),
    )
    expect(useSubclipsStore.getState().subclips).toEqual([sub])
    expect(useSourcePlayerStore.getState().marksByKey).toEqual({
      m1: { in: 20, out: 80 },
      m2: { in: 7, out: null },
    })
  })

  it('does not write the fields for a project that has none', () => {
    const timeline = buildTimelineFromStores()
    expect(timeline).not.toHaveProperty('subclips')
    expect(timeline).not.toHaveProperty('sourceMarks')
  })

  it('loads an old project, without the fields, unchanged', async () => {
    useSubclipsStore
      .getState()
      .create({ mediaId: 'stale', name: 'x', startFrame: 0, endFrame: 5, sourceFps: 30 })
    await hydrateTimelineStoresFromProject(
      projectWith({
        tracks: [track],
        items: [makeTimelineVideoItem({ id: 'i', trackId: track.id })],
      }),
    )
    expect(useSubclipsStore.getState().subclips).toEqual([])
    expect(useSourcePlayerStore.getState().marksByKey).toEqual({})
  })

  it('opening a project drops the subclips of media no longer in the library', async () => {
    const records = [
      {
        id: 's1',
        mediaId: 'kept',
        name: 'a',
        startFrame: 0,
        endFrame: 10,
        sourceFps: 30,
        createdAt: 0,
      },
      {
        id: 's2',
        mediaId: 'deleted',
        name: 'b',
        startFrame: 0,
        endFrame: 10,
        sourceFps: 30,
        createdAt: 0,
      },
    ]
    mocks.getProject.mockResolvedValue(
      projectWith({
        tracks: [track],
        items: [],
        subclips: records,
        sourceMarks: { kept: { in: 1, out: 5 }, deleted: { in: 1, out: 5 }, s2: { in: 2, out: 3 } },
      }),
    )
    mocks.validateProjectMediaReferences.mockResolvedValue([])
    mocks.getMediaForProject.mockResolvedValue([{ id: 'kept', duration: 10, fps: 30 }])

    await loadTimeline('p1')

    expect(useSubclipsStore.getState().subclips.map((s) => s.id)).toEqual(['s1'])
    expect(Object.keys(useSourcePlayerStore.getState().marksByKey)).toEqual(['kept'])
  })

  it('does not read the library for a project without subclips or marks', async () => {
    mocks.getProject.mockResolvedValue(projectWith({ tracks: [track], items: [] }))
    mocks.validateProjectMediaReferences.mockResolvedValue([])
    await loadTimeline('p1')
    expect(mocks.getMediaForProject).not.toHaveBeenCalled()
  })
})
