/**
 * `studio.tracks`: the track stack of the active editing context (design §4.2).
 *
 * Every write goes through `setTracks` (`SET_TRACKS`, `track-actions.ts:10`) —
 * the action the track header itself uses for add, rename, mute, solo, visible
 * and lock (`use-timeline-tracks.ts:27-137`) — inside one transaction, so a call
 * is one undo step. The new tracks are built the way the header builds them:
 * `createClassicTrack` for ids, names and kinds, fractional `order` values for a
 * position between two tracks.
 *
 * `remove` also deletes the track's clips with `removeItems` (`REMOVE_ITEMS`,
 * `item-actions.ts:915`) in the same step (design §0.2); the header's own hook
 * leaves them orphaned (`use-timeline-tracks.ts:43-49`). Selection is not
 * project state: after the transaction `remove` drops its references to the
 * removed track and clips, as the header's delete path does
 * (`timeline.tsx:655-675`).
 *
 * Track `height` is a local view preference in the editor, not project data:
 * `items-store`'s `setTracks` re-derives it from `utils/track-heights.ts` on
 * every write, and undo restores through the same funnel
 * (`commands/snapshot.ts:128`). The SDK reads it (`TrackInfo.height`) but does
 * not write it; `update` rejects a patch carrying `height` instead of silently
 * dropping it.
 */

import type { TimelineTrack } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { removeItems } from '@/features/timeline/stores/actions/item-actions'
import { setTracks } from '@/features/timeline/stores/actions/track-actions'
import { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
import { useSelectionStore } from '@/shared/state/selection'
import { requireTrack } from '../context'
import { invalidArgumentError } from '../errors'
import { transaction } from '../transaction'
import type { TrackAddInput, TrackId, TrackInfo, TrackKind, TrackPatch, TracksApi } from '../types'

/** Method names, as the error messages prefix them (design §4.5). */
const UPDATE = 'tracks.update'
const ADD = 'tracks.add'
const REMOVE = 'tracks.remove'
const REORDER = 'tracks.reorder'

/** The store's tracks, top first. `setTracks` keeps them sorted by `order`. */
function currentTracks(): TimelineTrack[] {
  return [...useItemsStore.getState().tracks].sort((left, right) => left.order - right.order)
}

/**
 * One track as the SDK reads it: a field-by-field JSON copy, `order` as the
 * position in the stack (0 = top) rather than the store's sorting value.
 */
function toTrackInfo(track: TimelineTrack, index: number): TrackInfo {
  return {
    id: track.id,
    name: track.name,
    ...(track.kind !== undefined && { kind: track.kind }),
    height: track.height,
    locked: track.locked,
    ...(track.syncLock !== undefined && { syncLock: track.syncLock }),
    visible: track.visible,
    muted: track.muted,
    solo: track.solo,
    ...(track.volume !== undefined && { volume: track.volume }),
    ...(track.color !== undefined && { color: track.color }),
    order: index,
  }
}

/** The `kind` of a new track, as a runtime check: the value arrives as JSON. */
function requireTrackKind(value: unknown): TrackKind {
  if (value === 'video' || value === 'audio') return value
  throw invalidArgumentError({
    method: ADD,
    argument: 'kind',
    expectation: 'a track kind',
    value,
    valid: ['video', 'audio'],
  })
}

/** The insert position of a new track: an integer from 0 (top) to `count`. */
function requirePosition(value: unknown, count: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= count) {
    return value
  }
  throw invalidArgumentError({
    method: ADD,
    argument: 'position',
    expectation: `an integer from 0 to ${count} (0 = top)`,
    value,
  })
}

/**
 * The store `order` that places a new track at `position`, using the header's
 * fractional orders (`use-timeline-tracks.ts:71-110`): above the current top,
 * between its neighbours, or below the current bottom.
 */
function orderForPosition(tracks: readonly TimelineTrack[], position: number): number {
  if (tracks.length === 0) return 0
  if (position <= 0) return Math.min(...tracks.map((track) => track.order)) - 1
  if (position >= tracks.length) return Math.max(...tracks.map((track) => track.order)) + 1
  const above = tracks[position - 1]!.order
  const below = tracks[position]!.order
  return (above + below) / 2
}

/** A track gain the store keeps: a number from -60 to 12 dB. */
function requireVolume(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= -60 && value <= 12) {
    return value
  }
  throw invalidArgumentError({
    method: UPDATE,
    argument: 'volume',
    expectation: 'a number from -60 to 12',
    value,
  })
}

/**
 * Reject a patch that carries `height`: it is a local view preference, not
 * project data, so the SDK does not change it (it stays readable).
 */
function rejectHeight(patch: TrackPatch): void {
  // Read past the public type: a JSON caller can still send the field after
  // `TrackPatch` stops declaring it.
  const height = (patch as TrackPatch & { height?: unknown }).height
  if (height === undefined) return
  throw invalidArgumentError({
    method: UPDATE,
    argument: 'height',
    expectation: 'absent: track height is a view preference the SDK does not change',
    value: height,
  })
}

/** An object a caller passed as a patch or an input, as a runtime check. */
function requireObject(value: unknown, method: string, argument: string): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return
  throw invalidArgumentError({
    method,
    argument,
    expectation: 'an object',
    value,
  })
}

/** Whether `ids` names every current track exactly once. */
function isPermutation(ids: unknown, currentIds: readonly string[]): boolean {
  if (!Array.isArray(ids) || ids.length !== currentIds.length) return false
  const known = new Set(currentIds)
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) return false
    seen.add(id)
  }
  return true
}

/**
 * Drop the selection's references to a removed track and the clips deleted with
 * it, the way the track header's delete path does (`timeline.tsx:655-675`): the
 * removed id leaves `selectedTrackIds`, an active removed track falls back to
 * the first remaining track, and selected clips that no longer exist are
 * dropped. Selection is not project state, so this runs outside the
 * transaction and is not an undo step.
 */
function clearSelectionAfterRemove(
  removedTrackId: string,
  removedClipIds: ReadonlySet<string>,
): void {
  const selection = useSelectionStore.getState()
  const remainingSelectedTrackIds = selection.selectedTrackIds.filter(
    (trackId) => trackId !== removedTrackId,
  )

  if (remainingSelectedTrackIds.length > 0) {
    selection.selectTracks(remainingSelectedTrackIds)
  } else if (!selection.activeTrackId || selection.activeTrackId === removedTrackId) {
    selection.setActiveTrack(useItemsStore.getState().tracks[0]?.id ?? null)
  }

  const current = useSelectionStore.getState()
  const remainingSelectedClipIds = current.selectedItemIds.filter(
    (clipId) => !removedClipIds.has(clipId),
  )
  if (remainingSelectedClipIds.length !== current.selectedItemIds.length) {
    current.selectItems(remainingSelectedClipIds)
  }
}

/**
 * Create the `studio.tracks` namespace.
 * @example const tracks = createTracksApi()
 */
export function createTracksApi(): TracksApi {
  return {
    list(): TrackInfo[] {
      return currentTracks().map(toTrackInfo)
    },

    add(input: TrackAddInput): TrackId {
      requireObject(input, ADD, 'input')
      const kind = requireTrackKind(input.kind)
      if (input.name !== undefined && typeof input.name !== 'string') {
        throw invalidArgumentError({
          method: ADD,
          argument: 'name',
          expectation: 'a string',
          value: input.name,
        })
      }

      const tracks = currentTracks()
      const position =
        input.position === undefined
          ? tracks.length
          : requirePosition(input.position, tracks.length)
      const track = createClassicTrack({
        tracks,
        kind,
        order: orderForPosition(tracks, position),
      })
      if (input.name !== undefined) track.name = input.name

      const nextTracks = [...tracks.slice(0, position), track, ...tracks.slice(position)]
      transaction('TRACKS_ADD', () => setTracks(nextTracks))
      return track.id
    },

    update(id: TrackId, patch: TrackPatch): void {
      requireTrack(id, UPDATE, 'id')
      requireObject(patch, UPDATE, 'patch')
      rejectHeight(patch)
      if (patch.volume !== undefined) requireVolume(patch.volume)

      const nextTracks = currentTracks().map((track) =>
        track.id === id ? { ...track, ...patch } : track,
      )
      transaction('TRACKS_UPDATE', () => setTracks(nextTracks))
    },

    remove(id: TrackId): void {
      requireTrack(id, REMOVE, 'id')
      const tracks = currentTracks()
      const clipIds = (useItemsStore.getState().itemsByTrackId[id] ?? []).map((item) => item.id)
      const itemIdsBefore = new Set(useItemsStore.getState().items.map((item) => item.id))

      transaction('TRACKS_REMOVE', () => {
        if (clipIds.length > 0) removeItems(clipIds)
        setTracks(tracks.filter((track) => track.id !== id))
      })

      // `removeItems` may also drop linked partners outside the track, so the
      // removed clips are what the store no longer holds, not just `clipIds`.
      const removedClipIds = new Set(
        [...itemIdsBefore].filter(
          (clipId) => useItemsStore.getState().itemById[clipId] === undefined,
        ),
      )
      clearSelectionAfterRemove(id, removedClipIds)
    },

    reorder(ids: TrackId[]): void {
      const tracks = currentTracks()
      const currentIds = tracks.map((track) => track.id)
      if (!isPermutation(ids, currentIds)) {
        throw invalidArgumentError({
          method: REORDER,
          argument: 'ids',
          expectation: `a permutation of the ${currentIds.length} current track ids`,
          value: ids,
          valid: currentIds,
        })
      }

      const trackById = new Map(tracks.map((track) => [track.id, track]))
      const nextTracks = ids.map((id, index) => ({ ...trackById.get(id)!, order: index }))
      transaction('TRACKS_REORDER', () => setTracks(nextTracks))
    },
  }
}
