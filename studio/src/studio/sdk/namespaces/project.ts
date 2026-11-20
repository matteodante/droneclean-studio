/**
 * `studio.project`: the open project, its metadata and workspace storage
 * (design §4.2, §0.6).
 *
 * `current`, `rate`, `context` and `duration` read the stores and return plain
 * copies. `set` is the one writing method: it goes through
 * `commitProjectMetadataChange`, the helper the canvas panel uses, which
 * captures the snapshot before the asynchronous project write and then pushes
 * exactly one `UPDATE_PROJECT_METADATA` entry — a failed write rolls the project
 * store back and adds nothing to the history. `set` is not wrapped in
 * `transaction()`: the project write is asynchronous, and a transaction must not
 * span an `await` (design §4.4, §4.7).
 *
 * `create`, `list`, `open` and `save` are storage operations and add no undo
 * entry. `open` comes to rest on the project it names — its timeline loaded
 * into the stores, its rate in the settings, its media in the library, the undo
 * history cleared — which is the state the editor is in after the projects page
 * navigates to `/editor/$projectId`. `create` comes to rest on the new project
 * the same way (its empty timeline, its own media library), so an agent imports
 * media right after it: the tour of 19 Nov 2026 lost a call to "no project is
 * open" when `create` left the library elsewhere.
 *
 * `open` refuses a project whose schema is older than the current one with
 * `UNSUPPORTED`: `loadTimeline` would need `allowProjectUpgrade`, which only the
 * app can ask the user for, and the SDK has no option to force it.
 */

import type { Project } from '@/types/project'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { loadTimeline, saveTimeline } from '@/features/timeline/stores/timeline-persistence'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { commitProjectMetadataChange } from '@/features/editor/utils/project-metadata-history'
import { getProject } from '@/infrastructure/storage'
import { CURRENT_SCHEMA_VERSION } from '@/shared/projects/migrations/types'
import { isAllowedProjectFps } from '@/features/projects/utils/project-fps'
import { formatRate, LEGACY_RATES, RATES, rateValue, toRate } from '@/studio/time'
import { getTimelineContext, timelineDuration } from '../context'
import { formatValue, invalidArgumentError, notFoundError, studioError } from '../errors'
import type { StudioError } from '../errors'
import type {
  Frame,
  ProjectApi,
  ProjectCreateInput,
  ProjectInfo,
  ProjectPatch,
  Rate,
} from '../types'

/** The project fields `project.updateProject` writes, keyed as it expects them. */
interface ProjectMetadataUpdates {
  width?: number
  height?: number
  fps?: number
  backgroundColor?: string
}

/** Canvas colours are six-digit hex, the format the project form and the picker use. */
const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/

/**
 * The `StudioError` of a store failure the method's JSDoc documents as
 * `INTERNAL`, with the underlying message appended.
 */
function internalError(method: string, detail: string, cause: unknown): StudioError {
  const reason = cause instanceof Error ? cause.message : String(cause)
  return studioError({ code: 'INTERNAL', method, message: `${detail}: ${reason}` })
}

/** The open project, or `NOT_FOUND`: without one there is nothing to read or write. */
function requireOpenProject(method: string): Project {
  const project = useProjectStore.getState().currentProject
  if (project) return project
  throw studioError({
    code: 'NOT_FOUND',
    method,
    message: 'no project is open',
    hint: 'Open one with studio.project.open(id) or create one with studio.project.create({ name, width, height, fps }).',
  })
}

/** The project as the SDK reads it: a plain copy, field by field. */
function toProjectInfo(project: Project): ProjectInfo {
  const info: ProjectInfo = {
    id: project.id,
    name: project.name,
    description: project.description,
    width: project.metadata.width,
    height: project.metadata.height,
    fps: rateOf(project.metadata.fps),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
  if (project.metadata.backgroundColor !== undefined) {
    info.backgroundColor = project.metadata.backgroundColor
  }
  return info
}

/** A canvas size: a positive whole number of pixels. */
function requireSize(value: unknown, argument: 'width' | 'height', method: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  throw invalidArgumentError({
    method,
    argument,
    expectation: 'a positive integer',
    value,
  })
}

/**
 * The rates the editor accepts, named for a message: the ones the project form offers and
 * the legacy ones `isAllowedProjectFps` still accepts.
 */
function allowedRateNames(): string {
  return [...RATES, ...LEGACY_RATES].map(formatRate).join(', ')
}

/**
 * The number the stores keep for a `Rate` (design 1.5, 4.6): `rateValue(toRate(rate))`,
 * the exact double of the reduced fraction, the same one the project form writes for
 * 59.94 (`60000/1001`). `toRate` refuses what is not a fraction of two positive whole
 * numbers; `isAllowedProjectFps`, the rule of the project form, refuses every other rate.
 */
function requireRate(rate: Rate, method: string): number {
  let fps: number
  try {
    fps = rateValue(toRate(rate))
  } catch {
    throw invalidArgumentError({
      method,
      argument: 'fps',
      expectation: 'a rate of positive whole numbers { num, den }, like { num: 60000, den: 1001 }',
      value: rate,
    })
  }
  if (!isAllowedProjectFps(fps)) {
    throw invalidArgumentError({
      method,
      argument: 'fps',
      expectation: `one of the rates the editor offers: ${allowedRateNames()}`,
      value: rate,
    })
  }
  return fps
}

/** The exact fraction a stored `fps` number stands for: `toRate`, so 59.94 is 60000/1001. */
function rateOf(fps: number): Rate {
  const { num, den } = toRate(fps)
  return { num, den }
}

/** A canvas colour: six hex digits, as the picker writes it. */
function requireColour(value: unknown, method: string): string {
  if (typeof value === 'string' && HEX_COLOUR.test(value)) {
    return value
  }
  throw invalidArgumentError({
    method,
    argument: 'backgroundColor',
    expectation: 'a hex colour like "#101014"',
    value,
  })
}

/** The validated `project.create` input, in the shape the project store writes. */
function requireCreateInput(
  input: ProjectCreateInput,
  method: string,
): { name: string; description: string; width: number; height: number; fps: number } {
  if (input === null || typeof input !== 'object') {
    throw invalidArgumentError({
      method,
      argument: 'input',
      expectation: 'an object with name, width, height and fps',
      value: input,
    })
  }
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw invalidArgumentError({
      method,
      argument: 'name',
      expectation: 'a non-empty name',
      value: input.name,
    })
  }
  return {
    name: input.name,
    description: '',
    width: requireSize(input.width, 'width', method),
    height: requireSize(input.height, 'height', method),
    fps: requireRate(input.fps, method),
  }
}

/** The validated `project.set` patch, keyed as the project store writes it. */
function requirePatch(patch: ProjectPatch, method: string): ProjectMetadataUpdates {
  if (patch === null || typeof patch !== 'object') {
    throw invalidArgumentError({
      method,
      argument: 'patch',
      expectation: 'an object with width, height, fps or backgroundColor',
      value: patch,
    })
  }
  const updates: ProjectMetadataUpdates = {}
  if (patch.width !== undefined) updates.width = requireSize(patch.width, 'width', method)
  if (patch.height !== undefined) updates.height = requireSize(patch.height, 'height', method)
  if (patch.fps !== undefined) updates.fps = requireRate(patch.fps, method)
  if (patch.backgroundColor !== undefined) {
    updates.backgroundColor = requireColour(patch.backgroundColor, method)
  }
  return updates
}

/** A stored project, or `NOT_FOUND` when the workspace has no project with that id. */
async function readStoredProject(id: string, method: string): Promise<Project> {
  let stored: Project | undefined
  try {
    stored = await getProject(id)
  } catch (error) {
    throw internalError(method, 'the project could not be read', error)
  }
  if (!stored) {
    throw notFoundError({
      method,
      argument: 'id',
      kind: 'project',
      id,
      expectation: 'an existing project id in workspace storage',
      hint: 'studio.project.list() lists them.',
    })
  }
  return stored
}

/** Load a project's timeline into the stores, which also clears the undo history. */
async function loadProjectTimeline(method: string, detail: string, id: string): Promise<void> {
  try {
    await loadTimeline(id)
  } catch (error) {
    throw internalError(method, detail, error)
  }
}

/**
 * Refuse a project the app would have to upgrade: `loadTimeline` only migrates a
 * legacy project with `allowProjectUpgrade`, the flag the editor passes after the
 * user confirms the upgrade dialog. The SDK cannot ask, and it has no option to
 * force the upgrade, so the project stays as stored until the user opens it once
 * in the app.
 */
function requireCurrentSchema(project: Project): void {
  const storedVersion = project.schemaVersion ?? 1
  if (storedVersion >= CURRENT_SCHEMA_VERSION) return
  throw studioError({
    code: 'UNSUPPORTED',
    method: 'project.open',
    message:
      `"id" names a project stored with schema v${storedVersion}, which needs an upgrade to ` +
      `v${CURRENT_SCHEMA_VERSION}; the user must open it once in the app to upgrade it ` +
      `(got ${formatValue(project.id)})`,
    argument: 'id',
    entity: { kind: 'project', id: project.id },
    hint: 'The app asks the user to confirm the upgrade; the SDK cannot confirm it.',
  })
}

/**
 * Point the media library at the opened project and load its items, as the
 * editor route does. A library failure does not undo the open: `loadMediaItems`
 * records it in the library store (`useMediaLibraryStore.error`), and a project
 * whose timeline loaded is open.
 */
async function scopeMediaLibrary(projectId: string): Promise<void> {
  const library = useMediaLibraryStore.getState()
  library.setCurrentProject(projectId)
  try {
    await library.loadMediaItems()
  } catch {
    /* the library store carries the error */
  }
}

/**
 * `studio.project`, over the project store, the timeline stores and workspace
 * storage. Every read returns a plain JSON copy.
 * @example const api = createProjectApi(); await api.list()
 */
export function createProjectApi(): ProjectApi {
  return {
    current() {
      const project = useProjectStore.getState().currentProject
      return project ? toProjectInfo(project) : null
    },

    async list() {
      try {
        await useProjectStore.getState().loadProjects()
      } catch (error) {
        throw internalError('project.list', 'the project list could not be read', error)
      }
      return useProjectStore.getState().projects.map(toProjectInfo)
    },

    async create(input) {
      const fields = requireCreateInput(input, 'project.create')
      let project: Project
      try {
        project = await useProjectStore.getState().createProject(fields)
      } catch (error) {
        throw internalError('project.create', 'the project could not be written', error)
      }
      // The new project becomes the open one; give it its own empty timeline and
      // its own media library, as the editor does when the form lands on
      // /editor/$projectId.
      await loadProjectTimeline(
        'project.create',
        'the new project timeline could not be read',
        project.id,
      )
      await scopeMediaLibrary(project.id)
      return toProjectInfo(project)
    },

    rate() {
      return rateOf(useTimelineSettingsStore.getState().fps)
    },

    context() {
      return getTimelineContext()
    },

    duration(): Frame {
      return timelineDuration()
    },

    async set(patch) {
      const project = requireOpenProject('project.set')
      const updates = requirePatch(patch, 'project.set')
      let updated: Project | null
      try {
        updated = await commitProjectMetadataChange({
          project,
          updates,
          command: { type: 'UPDATE_PROJECT_METADATA', payload: { fields: Object.keys(updates) } },
          updateProject: useProjectStore.getState().updateProject,
          markDirty: useTimelineSettingsStore.getState().markDirty,
        })
      } catch (error) {
        throw internalError('project.set', 'the project metadata could not be written', error)
      }
      // The entry above was captured before the write, when the settings still
      // held the old rate, so this change undoes together with the metadata.
      if (updates.fps !== undefined) {
        useTimelineSettingsStore.getState().setFps(updates.fps)
      }
      return toProjectInfo(updated ?? useProjectStore.getState().currentProject ?? project)
    },

    async save() {
      const project = requireOpenProject('project.save')
      try {
        await saveTimeline(project.id)
      } catch (error) {
        throw internalError('project.save', 'the project could not be written', error)
      }
    },

    async open(id) {
      // Read the project first so a failed load leaves the current one in place.
      const stored = await readStoredProject(id, 'project.open')
      requireCurrentSchema(stored)
      await loadProjectTimeline('project.open', 'the project could not be read', id)
      useProjectStore.getState().setCurrentProject(stored)
      await scopeMediaLibrary(id)
    },

    async delete(id) {
      const method = 'project.delete'
      const stored = await readStoredProject(id, method)
      if (useProjectStore.getState().currentProject?.id === id) {
        throw studioError({
          code: 'CONFLICT',
          method,
          argument: 'id',
          message: `"id" names the open project "${stored.name}", which cannot be deleted while it is open`,
          entity: { kind: 'project', id },
          hint: 'Open or create another project first with studio.project.open(id) or studio.project.create(...).',
        })
      }
      // FreeCut's own removal path, in its two steps: the trash marker, then the wipe of the
      // folder with the media nobody else uses. `clearLocalFiles` stays false: the project's
      // linked folder on the user's disk is never touched.
      try {
        await useProjectStore.getState().deleteProject(id, false)
        await useProjectStore.getState().permanentlyDeleteProject(id)
        await useProjectStore.getState().loadProjects()
      } catch (error) {
        throw internalError(method, 'the project could not be deleted', error)
      }
      return {
        id,
        name: stored.name,
        undoable: false,
        message: `The project "${stored.name}" was deleted from the workspace. This cannot be undone.`,
      }
    },
  }
}
