// @vitest-environment node

// Registers the handles-db and logger mocks before any storage module loads.
import { handlesMocks } from '@/infrastructure/storage/test-utils/storage-test-mocks'

import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import type { SubComposition } from '@/features/timeline/stores/compositions-store'
import { CURRENT_SCHEMA_VERSION } from '@/shared/projects/migrations/types'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import {
  associateMediaWithProject,
  createMedia as createStoredMedia,
  createProject as createStoredProject,
} from '@/infrastructure/storage'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import {
  asHandle,
  createRoot,
  readFileText,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { isAllowedProjectFps } from '@/features/projects/utils/project-fps'
import { rateValue, toRate } from '@/studio/time'
import { formatValue, StudioError } from '../errors'
import type { ProjectApi, ProjectInfo } from '../types'
import { createProjectApi } from './project'

/** A stored project as the workspace holds it. */
function makeProject(id: string, overrides: Partial<Project> = {}): Project {
  const createdAt = 1_700_000_000_000
  return {
    id,
    name: `Project ${id}`,
    description: '',
    createdAt,
    updatedAt: createdAt,
    duration: 0,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: { width: 1920, height: 1080, fps: 30 },
    ...overrides,
  }
}

/** The error a rejected call carries, which must be a `StudioError`. */
async function rejection(promise: Promise<unknown>): Promise<StudioError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

/** A media library item as the workspace holds it (an image: no proxy, no audio). */
function makeMediaItem(id: string, fileName: string): MediaMetadata {
  return {
    id,
    storageType: 'workspace',
    fileName,
    fileSize: 2048,
    mimeType: 'image/jpeg',
    duration: 0,
    width: 4000,
    height: 3000,
    fps: 0,
    codec: '',
    bitrate: 0,
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }
}

let root: MemDir
let api: ProjectApi

beforeEach(() => {
  resetTimelineCompositionTestState()
  useProjectStore.setState({
    projects: [],
    currentProject: null,
    isLoading: false,
    error: null,
  })
  useMediaLibraryStore.getState().setCurrentProject(null)
  useMediaLibraryStore.setState({ error: null })
  useTimelineSettingsStore.getState().setFps(30)
  handlesMocks.getHandle.mockResolvedValue(null)
  root = createRoot()
  setWorkspaceRoot(asHandle(root))
  api = createProjectApi()
})

afterEach(() => {
  setWorkspaceRoot(null)
})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('project.current', () => {
  it('is null when no project is open', () => {
    expect(api.current()).toBeNull()
  })

  it('reads the open project field by field, with the rate as a fraction', () => {
    useProjectStore.setState({
      currentProject: makeProject('p1', {
        name: 'Flight',
        description: 'Riomaggiore at sunrise',
        metadata: { width: 3840, height: 2160, fps: 60, backgroundColor: '#101014' },
      }),
    })

    expect(api.current()).toEqual({
      id: 'p1',
      name: 'Flight',
      description: 'Riomaggiore at sunrise',
      width: 3840,
      height: 2160,
      fps: { num: 60, den: 1 },
      backgroundColor: '#101014',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    })
  })

  it('omits the background colour when the project has none', () => {
    useProjectStore.setState({ currentProject: makeProject('p1') })

    expect(api.current()).not.toHaveProperty('backgroundColor')
  })

  it('returns a copy, not the store object', () => {
    useProjectStore.setState({ currentProject: makeProject('p1') })

    const first = api.current()
    const second = api.current()

    expect(first).not.toBe(second)
    expect(first?.fps).not.toBe(second?.fps)
    if (!first) throw new Error('expected an open project')
    first.name = 'changed'
    first.fps.num = 99
    expect(api.current()).toMatchObject({ name: 'Project p1', fps: { num: 30, den: 1 } })
  })
})

describe('project.list', () => {
  it('is empty on a workspace without projects', async () => {
    expect(await api.list()).toEqual([])
  })

  it('lists what the workspace holds, newest first', async () => {
    await createStoredProject(makeProject('old', { updatedAt: 1_000 }))
    await createStoredProject(makeProject('new', { updatedAt: 5_000 }))

    const projects = await api.list()

    expect(projects.map((project) => project.id)).toEqual(['new', 'old'])
    expect(projects[0]).toMatchObject({ name: 'Project new', fps: { num: 30, den: 1 } })
  })

  it('rejects INTERNAL when the workspace cannot be read', async () => {
    setWorkspaceRoot(null)

    const error = await rejection(api.list())

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toContain('project.list: the project list could not be read')
  })
})

describe('project.rate', () => {
  it('is the editor rate as a fraction', () => {
    useTimelineSettingsStore.getState().setFps(25)

    expect(api.rate()).toEqual({ num: 25, den: 1 })
  })

  it('returns a new object each call', () => {
    expect(api.rate()).not.toBe(api.rate())
  })

  it('round-trips the exact fractions of the NTSC families', () => {
    for (const exact of [
      { num: 24000, den: 1001 },
      { num: 30000, den: 1001 },
      { num: 60000, den: 1001 },
    ]) {
      useTimelineSettingsStore.getState().setFps(rateValue(exact))

      expect(api.rate()).toEqual(exact)
    }
  })
})

describe('project.context', () => {
  it('is the main timeline when no composition is open', () => {
    expect(api.context()).toEqual({ kind: 'main' })
  })

  it('names the open composition', () => {
    useCompositionsStore.getState().setCompositions([makeComposition()])
    useCompositionNavigationStore.setState({ activeCompositionId: 'comp-1' })

    expect(api.context()).toEqual({ kind: 'composition', id: 'comp-1', name: 'Intro' })
  })
})

/** A sub-composition as the compositions store holds it. */
function makeComposition(overrides: Partial<SubComposition> = {}): SubComposition {
  return {
    id: 'comp-1',
    name: 'Intro',
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 0,
    ...overrides,
  }
}

describe('project.duration', () => {
  it('is 0 for an empty timeline', () => {
    expect(api.duration()).toBe(0)
  })

  it('is the end of the last clip', () => {
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({ id: 'clip-1', trackId: 'track-1', from: 0, durationInFrames: 120 }),
      makeTimelineVideoItem({
        id: 'clip-2',
        trackId: 'track-1',
        from: 200,
        durationInFrames: 30,
      }),
    ])

    expect(api.duration()).toBe(230)
  })

  it('keeps the authored canvas length of an open composition', () => {
    useCompositionsStore.getState().setCompositions([makeComposition({ durationInFrames: 300 })])
    useCompositionNavigationStore.setState({ activeCompositionId: 'comp-1' })
    useItemsStore
      .getState()
      .setItems([makeTimelineVideoItem({ id: 'clip-1', trackId: 'track-1', durationInFrames: 90 })])

    expect(api.duration()).toBe(300)
  })
})

// ---------------------------------------------------------------------------
// project.create
// ---------------------------------------------------------------------------

describe('project.create', () => {
  it('writes the project, opens it with its own empty timeline, and lists it', async () => {
    const info = await api.create({
      name: 'Flight',
      width: 3840,
      height: 2160,
      fps: { num: 60, den: 1 },
    })

    expect(info.id).not.toBe('')
    expect(info).toMatchObject({
      name: 'Flight',
      description: '',
      width: 3840,
      height: 2160,
      fps: { num: 60, den: 1 },
    })

    const text = await readFileText(root, 'projects', info.id, 'project.json')
    expect(JSON.parse(text!)).toMatchObject({
      id: info.id,
      name: 'Flight',
      metadata: { width: 3840, height: 2160, fps: 60 },
    })

    expect(api.current()).toEqual(info)
    expect(api.rate()).toEqual({ num: 60, den: 1 })
    expect(useItemsStore.getState().items).toEqual([])
    expect(useItemsStore.getState().tracks.map((track) => track.name)).toEqual(['V1', 'A1'])
    expect(useTimelineCommandStore.getState().undoStack).toEqual([])
    expect((await api.list()).map((project) => project.id)).toEqual([info.id])
  })

  it('returns a copy, not the stored project', async () => {
    const info = await api.create({
      name: 'Flight',
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
    })

    info.name = 'changed'
    info.fps.num = 99

    expect(api.current()).toMatchObject({ name: 'Flight', fps: { num: 30, den: 1 } })
  })

  it('rejects an empty name with INVALID_ARGUMENT and writes nothing', async () => {
    const error = await rejection(
      api.create({ name: '   ', width: 1920, height: 1080, fps: { num: 30, den: 1 } }),
    )

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('name')
    expect(error.message).toBe('project.create: "name" must be a non-empty name (got "   ")')
    expect(await api.list()).toEqual([])
  })

  it('rejects a size that is not a positive integer with INVALID_ARGUMENT', async () => {
    const cases = [
      {
        width: 0,
        height: 1080,
        argument: 'width',
        message: 'project.create: "width" must be a positive integer (got 0)',
      },
      {
        width: 1920.5,
        height: 1080,
        argument: 'width',
        message: 'project.create: "width" must be a positive integer (got 1920.5)',
      },
      {
        width: 1920,
        height: -1,
        argument: 'height',
        message: 'project.create: "height" must be a positive integer (got -1)',
      },
    ] as const

    for (const testCase of cases) {
      const error = await rejection(
        api.create({
          name: 'Flight',
          width: testCase.width,
          height: testCase.height,
          fps: { num: 30, den: 1 },
        }),
      )
      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe(testCase.argument)
      expect(error.message).toBe(testCase.message)
    }
    expect(await api.list()).toEqual([])
    expect(api.current()).toBeNull()
  })

  it('creates a 59.94 project equal to the one the UI store action makes', async () => {
    const fps59 = rateValue(toRate(59.94))
    const viaUi = await useProjectStore.getState().createProject({
      name: 'Flight',
      description: '',
      width: 3840,
      height: 2160,
      fps: fps59,
    })
    useProjectStore.setState({ projects: [], currentProject: null })

    const info = await api.create({
      name: 'Flight',
      width: 3840,
      height: 2160,
      fps: { num: 60000, den: 1001 },
    })

    expect(info.fps).toEqual({ num: 60000, den: 1001 })
    const stored = JSON.parse((await readFileText(root, 'projects', info.id, 'project.json'))!)
    expect(stored.metadata).toEqual(viaUi.metadata)
    expect(stored.metadata.fps).toBe(fps59)
    expect(useTimelineSettingsStore.getState().fps).toBe(fps59)
    expect(api.rate()).toEqual({ num: 60000, den: 1001 })
  })

  it('keeps every exact fraction as a fraction and reduces an unreduced one', async () => {
    const cases = [
      { given: { num: 24000, den: 1001 }, exact: { num: 24000, den: 1001 } },
      { given: { num: 30000, den: 1001 }, exact: { num: 30000, den: 1001 } },
      { given: { num: 60000, den: 1001 }, exact: { num: 60000, den: 1001 } },
      { given: { num: 120000, den: 2002 }, exact: { num: 60000, den: 1001 } },
      { given: { num: 50, den: 1 }, exact: { num: 50, den: 1 } },
    ]
    for (const testCase of cases) {
      const info = await api.create({
        name: 'Flight',
        width: 1920,
        height: 1080,
        fps: testCase.given,
      })
      expect(info.fps).toEqual(testCase.exact)
      expect(api.rate()).toEqual(testCase.exact)
    }
  })

  it('rejects a rate that is not positive whole numbers with INVALID_ARGUMENT', async () => {
    const cases = [
      { num: 60, den: 0 },
      { num: 59.94, den: 1 },
      { num: 60000.5, den: 1001 },
      { num: -30, den: 1 },
      { num: 0, den: 1 },
      { num: Number.NaN, den: 1 },
    ]
    for (const fps of cases) {
      const error = await rejection(api.create({ name: 'Flight', width: 1920, height: 1080, fps }))
      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('fps')
      expect(error.message).toBe(
        'project.create: "fps" must be a rate of positive whole numbers { num, den }, ' +
          `like { num: 60000, den: 1001 } (got ${formatValue(fps)})`,
      )
    }
    expect(await api.list()).toEqual([])
  })

  it('accepts exactly the rates the UI accepts and names them when refusing', async () => {
    const message =
      'project.create: "fps" must be one of the rates the editor offers: ' +
      '23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120, 240 (got {"num":1000,"den":7})'
    const error = await rejection(
      api.create({ name: 'Flight', width: 1920, height: 1080, fps: { num: 1000, den: 7 } }),
    )
    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('fps')
    expect(error.message).toBe(message)
    expect(await api.list()).toEqual([])

    for (const fps of [
      { num: 17, den: 1 },
      { num: 1, den: 1 },
    ]) {
      expect(
        (await rejection(api.create({ name: 'Flight', width: 1920, height: 1080, fps }))).code,
      ).toBe('INVALID_ARGUMENT')
    }
    for (const fps of [
      { num: 60000, den: 1001 },
      { num: 120, den: 1 },
    ]) {
      const info = await api.create({ name: 'Flight', width: 1920, height: 1080, fps })
      expect(isAllowedProjectFps(rateValue(toRate(fps)))).toBe(true)
      expect(info.fps).toEqual(fps)
    }
  })

  it('rejects INTERNAL and leaves the store unchanged when the project cannot be written', async () => {
    setWorkspaceRoot(null)

    const error = await rejection(
      api.create({ name: 'Flight', width: 1920, height: 1080, fps: { num: 30, den: 1 } }),
    )

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toContain('project.create: the project could not be written')
    expect(useProjectStore.getState().projects).toEqual([])
    expect(useProjectStore.getState().currentProject).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// project.set
// ---------------------------------------------------------------------------

/** A project in the workspace, open in the editor. */
async function openStoredProject(id: string, overrides: Partial<Project> = {}): Promise<Project> {
  const project = await createStoredProject(makeProject(id, overrides))
  useProjectStore.setState({ currentProject: project })
  useTimelineSettingsStore.getState().setFps(project.metadata.fps)
  return project
}

describe('project.set', () => {
  it('writes the metadata as one undo entry that undo restores', async () => {
    await openStoredProject('p1')

    const info = await api.set({
      width: 1080,
      height: 1920,
      fps: { num: 25, den: 1 },
      backgroundColor: '#101014',
    })

    expect(info).toMatchObject({
      id: 'p1',
      width: 1080,
      height: 1920,
      fps: { num: 25, den: 1 },
      backgroundColor: '#101014',
    })
    expect(api.rate()).toEqual({ num: 25, den: 1 })

    const { undoStack, getUndoLabel } = useTimelineCommandStore.getState()
    expect(undoStack).toHaveLength(1)
    expect(undoStack[0]!.command).toEqual({
      type: 'UPDATE_PROJECT_METADATA',
      payload: { fields: ['width', 'height', 'fps', 'backgroundColor'] },
    })
    expect(getUndoLabel()).toBe('Resize canvas and change frame rate')

    useTimelineCommandStore.getState().undo()

    expect(api.current()).toMatchObject({ width: 1920, height: 1080, fps: { num: 30, den: 1 } })
    expect(api.current()).not.toHaveProperty('backgroundColor')
    expect(api.rate()).toEqual({ num: 30, den: 1 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('returns a copy, not the stored project', async () => {
    await openStoredProject('p1')

    const info = await api.set({ width: 1080 })
    info.width = 1

    expect(api.current()).toMatchObject({ width: 1080 })
  })

  it('adds no undo entry when the patch changes nothing', async () => {
    await openStoredProject('p1')

    await api.set({ width: 1920 })

    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    expect(api.current()).toMatchObject({ width: 1920 })
  })

  it('rejects NOT_FOUND when no project is open', async () => {
    const error = await rejection(api.set({ width: 1080 }))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.message).toBe('project.set: no project is open')
    expect(error.hint).toContain('studio.project.open')
  })

  it('rejects an invalid size or colour with INVALID_ARGUMENT and changes nothing', async () => {
    await openStoredProject('p1')

    const sizeError = await rejection(api.set({ width: 0 }))
    expect(sizeError.code).toBe('INVALID_ARGUMENT')
    expect(sizeError.argument).toBe('width')
    expect(sizeError.message).toBe('project.set: "width" must be a positive integer (got 0)')

    const colourError = await rejection(api.set({ backgroundColor: 'red' }))
    expect(colourError.code).toBe('INVALID_ARGUMENT')
    expect(colourError.argument).toBe('backgroundColor')
    expect(colourError.message).toBe(
      'project.set: "backgroundColor" must be a hex colour like "#101014" (got "red")',
    )

    expect(api.current()).toMatchObject({ width: 1920 })
    expect(api.current()).not.toHaveProperty('backgroundColor')
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('sets an exact fractional rate as one undo step that undo restores', async () => {
    await openStoredProject('p1')

    const info = await api.set({ fps: { num: 30000, den: 1001 } })

    expect(info.fps).toEqual({ num: 30000, den: 1001 })
    expect(api.rate()).toEqual({ num: 30000, den: 1001 })
    expect(useTimelineSettingsStore.getState().fps).toBe(rateValue(toRate(29.97)))
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    useTimelineCommandStore.getState().undo()

    expect(api.rate()).toEqual({ num: 30, den: 1 })
  })

  it('rejects a positive rate the UI does not offer with INVALID_ARGUMENT', async () => {
    await openStoredProject('p1')

    const error = await rejection(api.set({ fps: { num: 1000, den: 7 } }))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('fps')
    expect(error.message).toContain('project.set: "fps" must be one of the rates the editor offers')
    expect(api.rate()).toEqual({ num: 30, den: 1 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('rejects a rate that is not positive whole numbers with INVALID_ARGUMENT', async () => {
    await openStoredProject('p1')

    const fps = { num: 60000, den: 0 }
    const error = await rejection(api.set({ fps }))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('fps')
    expect(error.message).toBe(
      'project.set: "fps" must be a rate of positive whole numbers { num, den }, ' +
        `like { num: 60000, den: 1001 } (got ${formatValue(fps)})`,
    )
    expect(api.rate()).toEqual({ num: 30, den: 1 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('leaves the project and the history unchanged when the write fails', async () => {
    await openStoredProject('p1')
    setWorkspaceRoot(null)

    const error = await rejection(api.set({ width: 1080 }))

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toContain('project.set: the project metadata could not be written')
    expect(api.current()).toMatchObject({ width: 1920, height: 1080 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// project.save
// ---------------------------------------------------------------------------

describe('project.save', () => {
  it('writes the live timeline to the workspace and clears the dirty flag', async () => {
    const project = await openStoredProject('p1')
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    useTimelineSettingsStore.getState().markDirty()

    await api.save()

    const text = await readFileText(root, 'projects', project.id, 'project.json')
    const stored = JSON.parse(text!)
    expect(stored.timeline.tracks.map((track: { id: string }) => track.id)).toEqual(['track-v1'])
    expect(stored.timeline.items).toEqual([])
    expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
  })

  it('rejects NOT_FOUND when no project is open', async () => {
    const error = await rejection(api.save())

    expect(error.code).toBe('NOT_FOUND')
    expect(error.message).toBe('project.save: no project is open')
  })

  it('rejects INTERNAL when the project cannot be written', async () => {
    await openStoredProject('p1')
    setWorkspaceRoot(null)

    const error = await rejection(api.save())

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toContain('project.save: the project could not be written')
  })
})

// ---------------------------------------------------------------------------
// project.open
// ---------------------------------------------------------------------------

describe('project.open', () => {
  it('replaces the timeline, makes the project current and clears the history', async () => {
    const target = await openStoredProject('p-8f21', {
      name: 'Target',
      metadata: { width: 3840, height: 2160, fps: 60 },
    })
    await openStoredProject('p-other')
    useItemsStore
      .getState()
      .setItems([makeTimelineVideoItem({ id: 'clip-1', trackId: 'track-v1' })])
    await api.set({ width: 1600 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    await api.open(target.id)

    expect(api.current()).toMatchObject({
      id: 'p-8f21',
      name: 'Target',
      width: 3840,
      height: 2160,
      fps: { num: 60, den: 1 },
    })
    expect(api.rate()).toEqual({ num: 60, den: 1 })
    expect(useItemsStore.getState().items).toEqual([])
    expect(useItemsStore.getState().tracks.map((track) => track.name)).toEqual(['V1', 'A1'])
    expect(useTimelineCommandStore.getState().undoStack).toEqual([])
    expect(useTimelineCommandStore.getState().canUndo).toBe(false)
  })

  it('rejects NOT_FOUND for an id no project has, leaving the open project in place', async () => {
    await openStoredProject('p1')

    const error = await rejection(api.open('nope'))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('id')
    expect(error.entity).toEqual({ kind: 'project', id: 'nope' })
    expect(error.message).toBe(
      'project.open: "id" must be an existing project id in workspace storage (got "nope")',
    )
    expect(api.current()?.id).toBe('p1')
  })

  it('rejects INTERNAL when the project cannot be read', async () => {
    setWorkspaceRoot(null)

    const error = await rejection(api.open('p1'))

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toContain('project.open: the project could not be read')
  })

  it('scopes the media library to the opened project and loads its media', async () => {
    await createStoredProject(makeProject('p-a'))
    await createStoredProject(makeProject('p-b'))
    await createStoredMedia(makeMediaItem('m-a', 'coast.jpg'))
    await createStoredMedia(makeMediaItem('m-b', 'tower.jpg'))
    await associateMediaWithProject('p-a', 'm-a')
    await associateMediaWithProject('p-b', 'm-b')

    await api.open('p-b')
    expect(useMediaLibraryStore.getState().currentProjectId).toBe('p-b')
    expect(useMediaLibraryStore.getState().mediaItems.map((item) => item.id)).toEqual(['m-b'])

    await api.open('p-a')

    const library = useMediaLibraryStore.getState()
    expect(library.currentProjectId).toBe('p-a')
    expect(library.mediaItems.map((item) => item.id)).toEqual(['m-a'])
    expect(library.mediaById['m-a']).toMatchObject({ fileName: 'coast.jpg' })
    expect(library.isLoading).toBe(false)
    expect(library.error).toBeNull()
  })

  it('refuses a project that needs a schema upgrade with UNSUPPORTED', async () => {
    await openStoredProject('p1')
    await createStoredProject(makeProject('p-legacy', { schemaVersion: 1 }))

    const error = await rejection(api.open('p-legacy'))

    expect(error.code).toBe('UNSUPPORTED')
    expect(error.argument).toBe('id')
    expect(error.entity).toEqual({ kind: 'project', id: 'p-legacy' })
    expect(error.message).toBe(
      'project.open: "id" names a project stored with schema v1, which needs an upgrade to ' +
        `v${CURRENT_SCHEMA_VERSION}; the user must open it once in the app to upgrade it ` +
        '(got "p-legacy")',
    )
    expect(error.hint).toContain('confirm')
    expect(api.current()?.id).toBe('p1')
    expect(useTimelineCommandStore.getState().undoStack).toEqual([])
  })
})

describe('project.delete', () => {
  it('removes a stored project: its folder and its entry in the list', async () => {
    await openStoredProject('p-keep')
    await createStoredProject(makeProject('p-throwaway', { name: 'Throwaway' }))
    await createStoredMedia(makeMediaItem('m-1', 'coast.jpg'))
    await associateMediaWithProject('p-throwaway', 'm-1')
    expect(await readFileText(root, 'projects', 'p-throwaway', 'project.json')).not.toBeNull()

    const result = await api.delete('p-throwaway')

    expect(result).toMatchObject({ id: 'p-throwaway', name: 'Throwaway', undoable: false })
    expect(result.message).toContain('cannot be undone')
    expect(await readFileText(root, 'projects', 'p-throwaway', 'project.json')).toBeNull()
    expect((await api.list()).map((project) => project.id)).toEqual(['p-keep'])
    expect(api.current()?.id).toBe('p-keep')
    // Not left in the trash either: nothing is left to restore.
    expect(await readFileText(root, 'projects', 'p-throwaway', '.freecut-trashed.json')).toBeNull()
  })

  it('keeps the media another project still uses', async () => {
    await openStoredProject('p-keep')
    await createStoredProject(makeProject('p-throwaway'))
    await createStoredMedia(makeMediaItem('m-shared', 'tower.jpg'))
    await associateMediaWithProject('p-throwaway', 'm-shared')
    await associateMediaWithProject('p-keep', 'm-shared')

    await api.delete('p-throwaway')

    await api.open('p-keep')
    expect(useMediaLibraryStore.getState().mediaItems.map((item) => item.id)).toEqual(['m-shared'])
  })

  it('rejects CONFLICT for the open project and deletes nothing', async () => {
    await openStoredProject('p-open')

    const error = await rejection(api.delete('p-open'))

    expect(error.code).toBe('CONFLICT')
    expect(error.argument).toBe('id')
    expect(error.entity).toEqual({ kind: 'project', id: 'p-open' })
    expect(await readFileText(root, 'projects', 'p-open', 'project.json')).not.toBeNull()
    expect(api.current()?.id).toBe('p-open')
  })

  it('rejects NOT_FOUND for an id no project has', async () => {
    const error = await rejection(api.delete('nope'))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.entity).toEqual({ kind: 'project', id: 'nope' })
  })

  it('rejects INTERNAL when the workspace cannot be read', async () => {
    setWorkspaceRoot(null)

    const error = await rejection(api.delete('p1'))

    expect(error.code).toBe('INTERNAL')
    expect(error.message).toContain('project.delete: the project could not be read')
  })
})

// ---------------------------------------------------------------------------
// The @example of every method, run as written. The other namespaces belong to
// the slices beside this one; the examples only reach `studio.project`.
// ---------------------------------------------------------------------------

describe('the @example of every method', () => {
  it('runs as written', async () => {
    await createStoredProject(makeProject('p-8f21', { name: 'Stored' }))
    const studio = { project: createProjectApi() }

    expect(studio.project.current()).toBeNull()

    const listed: ProjectInfo[] = await studio.project.list()
    expect(listed.map((project) => project.id)).toEqual(['p-8f21'])

    const created = await studio.project.create({
      name: 'Flight',
      width: 3840,
      height: 2160,
      fps: { num: 60, den: 1 },
    })
    expect(created.name).toBe('Flight')

    expect(studio.project.rate()).toEqual({ num: 60, den: 1 })
    expect(studio.project.context()).toEqual({ kind: 'main' })
    expect(studio.project.duration()).toBe(0)

    await studio.project.set({ backgroundColor: '#101014' })
    expect(studio.project.current()).toMatchObject({ backgroundColor: '#101014' })

    await studio.project.save()

    await studio.project.open('p-8f21')
    expect(studio.project.current()?.id).toBe('p-8f21')

    await studio.project.open(created.id)
    await studio.project.delete('p-8f21')
    expect((await studio.project.list()).map((project) => project.id)).toEqual([created.id])
  })
})
