/**
 * `studio.subclips`: named ranges of library files (design 1.6, D7).
 *
 * A subclip is library state, like media: it lives in `useSubclipsStore`, is
 * saved with the project and never enters the timeline's undo history, so no
 * method here comes from `transaction`. A write marks the project as changed
 * (the way the editor does) so the next save keeps it. The range is whole
 * source frames of the file, `[startFrame, endFrame)`, and a subclip is placed
 * with `clips.add` and the same range, so a clip made from it is a clip of the
 * file.
 *
 * Reads return plain copies; the store's own record is never handed out.
 */

import type { MediaMetadata } from '@/types/storage'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { getMediaType } from '@/features/media-library/utils/validation'
import {
  getParentFrameCount,
  getSubclipValidity,
  useSubclipsStore,
  type Subclip,
} from '@/studio/subclips'
import { requireMedia, requireSourceRange, requireSubclip } from '../context'
import { invalidArgumentError, studioError } from '../errors'
import type { SubclipCreateInput, SubclipFilter, SubclipInfo, SubclipsApi } from '../types'

/** The rate a file without a usable one is counted at, as `getParentFrameCount` does. */
const FALLBACK_FPS = 30

/** The JSON copy of one subclip, with whether its file still has the range. */
function toSubclipInfo(subclip: Subclip): SubclipInfo {
  const parent = useMediaLibraryStore.getState().mediaById[subclip.mediaId]
  const validity = getSubclipValidity(subclip, parent)
  return {
    id: subclip.id,
    mediaId: subclip.mediaId,
    name: subclip.name,
    startFrame: subclip.startFrame,
    endFrame: subclip.endFrame,
    sourceFps: subclip.sourceFps,
    createdAt: subclip.createdAt,
    valid: validity.valid,
    ...(validity.valid ? {} : { invalidReason: validity.reason }),
  }
}

/** A name as the caller gave it, trimmed; an empty or non-string one is rejected. */
function requireName(value: unknown, method: string, argument: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  throw invalidArgumentError({
    method,
    argument,
    expectation: 'a non-empty string',
    value,
  })
}

/** The default name: the file's name without its extension and the subclip's number. */
function defaultName(media: MediaMetadata): string {
  const stem = media.fileName.replace(/\.[^./\\]+$/, '') || media.fileName
  const count = useSubclipsStore.getState().subclips.filter((s) => s.mediaId === media.id).length
  return `${stem} ${count + 1}`
}

/** The subclips of a library file, or of all. */
function list(filter?: SubclipFilter): SubclipInfo[] {
  const mediaId = filter?.mediaId
  return useSubclipsStore
    .getState()
    .subclips.filter((subclip) => mediaId === undefined || subclip.mediaId === mediaId)
    .map(toSubclipInfo)
}

/** One subclip, or null. */
function get(id: string): SubclipInfo | null {
  const subclip = useSubclipsStore.getState().subclips.find((candidate) => candidate.id === id)
  return subclip ? toSubclipInfo(subclip) : null
}

/** Cut a named range of a video or audio file. */
function create(input: SubclipCreateInput): SubclipInfo {
  const method = 'subclips.create'
  const media = requireMedia(input.mediaId, method, 'mediaId')
  const type = getMediaType(media.mimeType)
  if (type !== 'video' && type !== 'audio') {
    throw studioError({
      code: 'UNSUPPORTED',
      method,
      argument: 'mediaId',
      message: `media ${JSON.stringify(media.id)} is ${type === 'unknown' ? 'of an unknown kind' : `an ${type}`}, and only video and audio files have frames to cut`,
      hint: 'studio.media.list({ type: "video" }) lists the files a subclip can be cut from.',
    })
  }
  const { start, end } = requireSourceRange(
    input.startFrame,
    input.endFrame,
    getParentFrameCount(media),
    method,
    'startFrame',
    'endFrame',
  )
  const name =
    input.name === undefined ? defaultName(media) : requireName(input.name, method, 'name')
  const sourceFps = Number.isFinite(media.fps) && media.fps > 0 ? media.fps : FALLBACK_FPS

  const subclip = useSubclipsStore.getState().create({
    mediaId: media.id,
    name,
    startFrame: start,
    endFrame: end,
    sourceFps,
    parentFrameCount: getParentFrameCount(media),
  })
  useTimelineSettingsStore.getState().markDirty()
  return toSubclipInfo(subclip)
}

/** Rename one subclip. */
function rename(id: string, name: string): void {
  const method = 'subclips.rename'
  requireSubclip(id, method, 'id')
  const next = requireName(name, method, 'name')
  useSubclipsStore.getState().rename(id, next)
  useTimelineSettingsStore.getState().markDirty()
}

/** Delete subclips; a missing id deletes none. */
function remove(ids: string[]): void {
  const method = 'subclips.remove'
  if (!Array.isArray(ids)) {
    throw invalidArgumentError({
      method,
      argument: 'ids',
      expectation: 'an array of subclip ids',
      value: ids,
    })
  }
  const requested = [...new Set(ids)]
  for (const id of requested) requireSubclip(id, method, 'ids')
  if (requested.length === 0) return
  useSubclipsStore.getState().remove(requested)
  useTimelineSettingsStore.getState().markDirty()
}

/**
 * The `studio.subclips` namespace: `list`, `get`, `create`, `rename` and
 * `remove` over `useSubclipsStore`. None of them is an undo step.
 * @example const subclips = createSubclipsApi(); subclips.list()
 */
export function createSubclipsApi(): SubclipsApi {
  return { list, get, create, rename, remove }
}
