/**
 * The active editing context, and the lookups every namespace uses to turn an
 * id into a store entity or a typed error (design §4.3, §4.5).
 *
 * Ids and the undo history belong to one context: the Main timeline, or the
 * composition that is open for editing. A lookup that fails reports the ids
 * that do exist and points at `studio.project.context()`, because an id that
 * works in one context is `NOT_FOUND` in another.
 */

import type { MediaMetadata } from '@/types/storage'
import type { ProjectMarker, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
import { computeCompositionDuration } from '@/features/timeline/stores/actions/shared'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { getRangeError, useSubclipsStore, type Subclip } from '@/studio/subclips'
import type { EntityKind, Frame, SourceFrame, TimelineContext } from './types'
import { invalidArgumentError, notFoundError, studioError } from './errors'

/** What a caller can do about a missing id: the ids belong to one context. */
const CONTEXT_HINT =
  'Ids belong to one editing context; studio.project.context() names the one that is open.'

/**
 * The context the SDK reads and writes: the Main timeline, or the open
 * composition.
 * @example getTimelineContext() // { kind: 'main' }
 */
export function getTimelineContext(): TimelineContext {
  const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
  if (activeCompositionId === null) {
    return { kind: 'main' }
  }
  const composition = useCompositionsStore.getState().compositionById[activeCompositionId]
  return {
    kind: 'composition',
    id: activeCompositionId,
    name: composition?.name ?? activeCompositionId,
  }
}

/**
 * Length of the active timeline in frames: the end of its last clip, or the
 * open composition's authored length when that is longer. `project.duration()`
 * and `playback.seek` both read it, so the last frame `seek` accepts is
 * `duration() - 1`.
 * @example timelineDuration() // 240 for a single 240-frame clip
 */
export function timelineDuration(): Frame {
  const context = getTimelineContext()
  // A composition has an authored canvas length of its own; the Main timeline
  // has none and starts from zero.
  const fallback =
    context.kind === 'composition'
      ? (useCompositionsStore.getState().compositionById[context.id]?.durationInFrames ?? 0)
      : 0
  return computeCompositionDuration(useItemsStore.getState().items, fallback)
}

/**
 * How a context reads in a message: `the main timeline` or `composition "Name"`.
 * @example describeContext({ kind: 'main' }) // 'the main timeline'
 */
export function describeContext(context: TimelineContext): string {
  if (context.kind === 'main') return 'the main timeline'
  return `composition ${JSON.stringify(context.name)}`
}

/** Where an entity of a context lives, for a `NOT_FOUND` message. */
function contextPlacement(context: TimelineContext): string {
  if (context.kind === 'main') return 'on the main timeline'
  return `in composition ${JSON.stringify(context.name)}`
}

/** The tracked entity of each lookup, for the error's `entity` field. */
type LookupKind = Extract<EntityKind, 'clip' | 'track' | 'transition' | 'marker' | 'media'>

/** What each kind is called in a `NOT_FOUND` message. */
const KIND_NOUNS: Record<LookupKind, string> = {
  clip: 'clip id',
  track: 'track id',
  transition: 'transition id',
  marker: 'marker id',
  media: 'media id',
}

/**
 * Throw a `NOT_FOUND` naming the argument, the context, the rejected id and
 * the ids that do exist.
 */
function notFound(
  kind: LookupKind,
  id: string,
  valid: readonly string[],
  method: string | undefined,
  argument: string,
  hint: string,
): never {
  throw notFoundError({
    method: method ?? '',
    argument,
    kind,
    id,
    expectation: `an existing ${KIND_NOUNS[kind]} ${contextPlacement(getTimelineContext())}`,
    valid,
    hint,
  })
}

/**
 * The clip with this id in the active context.
 * @throws NOT_FOUND when no clip has that id
 * @example requireClip('c1', 'clips.update')
 */
export function requireClip(id: string, method?: string, argument = 'clipId'): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  if (item) return item
  const valid = useItemsStore.getState().items.map((candidate) => candidate.id)
  return notFound('clip', id, valid, method, argument, CONTEXT_HINT)
}

/**
 * The track with this id in the active context.
 * @throws NOT_FOUND when no track has that id
 * @example requireTrack('v1', 'clips.move', 'trackId')
 */
export function requireTrack(id: string, method?: string, argument = 'trackId'): TimelineTrack {
  const track = useItemsStore.getState().tracks.find((candidate) => candidate.id === id)
  if (track) return track
  const valid = useItemsStore.getState().tracks.map((candidate) => candidate.id)
  return notFound('track', id, valid, method, argument, CONTEXT_HINT)
}

/**
 * The transition with this id in the active context.
 * @throws NOT_FOUND when no transition has that id
 * @example requireTransition('x1', 'transitions.update')
 */
export function requireTransition(
  id: string,
  method?: string,
  argument = 'transitionId',
): Transition {
  const transition = useTransitionsStore
    .getState()
    .transitions.find((candidate) => candidate.id === id)
  if (transition) return transition
  const valid = useTransitionsStore.getState().transitions.map((candidate) => candidate.id)
  return notFound('transition', id, valid, method, argument, CONTEXT_HINT)
}

/**
 * The marker with this id in the active context.
 * @throws NOT_FOUND when no marker has that id
 * @example requireMarker('k1', 'markers.update')
 */
export function requireMarker(id: string, method?: string, argument = 'markerId'): ProjectMarker {
  const marker = useMarkersStore.getState().markers.find((candidate) => candidate.id === id)
  if (marker) return marker
  const valid = useMarkersStore.getState().markers.map((candidate) => candidate.id)
  return notFound('marker', id, valid, method, argument, CONTEXT_HINT)
}

/**
 * The media library item with this id. Media ids are workspace-wide, not per
 * editing context.
 * @throws NOT_FOUND when no media item has that id
 * @example requireMedia('m-1', 'clips.add')
 */
export function requireMedia(id: string, method?: string, argument = 'mediaId'): MediaMetadata {
  const media = useMediaLibraryStore.getState().mediaById[id]
  if (media) return media
  const valid = useMediaLibraryStore.getState().mediaItems.map((candidate) => candidate.id)
  throw notFoundError({
    method: method ?? '',
    argument,
    kind: 'media',
    id,
    expectation: 'an existing media id in the media library',
    valid,
    hint: 'Media ids are workspace-wide; studio.media.list() lists them.',
  })
}

/**
 * The value as a timeline frame: an integer, not negative.
 * @throws INVALID_ARGUMENT when it is not an integer >= 0
 * @example requireFrame(120, 'from', 'clips.add')
 */
export function requireFrame(value: unknown, argument: string, method?: string): Frame {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value
  }
  throw invalidArgumentError({
    method: method ?? '',
    argument,
    expectation: 'an integer frame >= 0',
    value,
  })
}

/**
 * The subclip with this id. Subclips belong to the project, not to an editing
 * context.
 * @throws NOT_FOUND when no subclip has that id
 * @example requireSubclip('s-1', 'subclips.rename', 'id')
 */
export function requireSubclip(id: string, method?: string, argument = 'id'): Subclip {
  const subclips = useSubclipsStore.getState().subclips
  const subclip = subclips.find((candidate) => candidate.id === id)
  if (subclip) return subclip
  throw notFoundError({
    method: method ?? '',
    argument,
    kind: 'subclip',
    id,
    expectation: 'an existing subclip id',
    valid: subclips.map((candidate) => candidate.id),
    hint: 'studio.subclips.list() lists the subclips of the project.',
  })
}

/**
 * A range of whole source frames inside a file: `0 <= start < end <= frames`.
 * `startArgument` and `endArgument` name the arguments in the message, because
 * `clips.add` calls them `sourceStart`/`sourceEnd` and `subclips.create` calls
 * them `startFrame`/`endFrame`.
 * @throws INVALID_ARGUMENT when the range is not whole frames inside the file
 * @example requireSourceRange(90, 210, 300, 'clips.add', 'sourceStart', 'sourceEnd')
 */
export function requireSourceRange(
  start: unknown,
  end: unknown,
  frameCount: number,
  method: string,
  startArgument: string,
  endArgument: string,
): { start: SourceFrame; end: SourceFrame } {
  for (const [value, argument] of [
    [start, startArgument],
    [end, endArgument],
  ] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw invalidArgumentError({
        method,
        argument,
        expectation: 'an integer source frame',
        value,
      })
    }
  }
  const problem = getRangeError(start as number, end as number, frameCount)
  if (problem) {
    throw studioError({
      code: 'INVALID_ARGUMENT',
      method,
      argument: endArgument,
      message: `${problem}: ${startArgument}=${String(start)}, ${endArgument}=${String(end)}, file has ${frameCount} frames`,
      hint: `Use 0 <= ${startArgument} < ${endArgument} <= ${frameCount}; the end is exclusive.`,
    })
  }
  return { start: start as number, end: end as number }
}
