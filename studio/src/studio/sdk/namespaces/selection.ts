/**
 * `studio.selection`: what the editor has selected (design §4.2, §4.4).
 *
 * Selection is view state, not timeline content: it is absent from the
 * timeline snapshot, so it is never an undo step and never runs inside a
 * transaction. The namespace reads and writes `useSelectionStore`, the store
 * the timeline's click handlers (`selectItems`, `selectTracks`) and the side
 * panels (`selectMarker`, `selectTransition`) write, and it returns plain
 * copies.
 *
 * The store keeps one *primary* selection — clips, a marker or a transition —
 * and `selectItems`, `selectMarker` and `selectTransition` each clear the other
 * two. `set` merges the patch into the current selection with the same effects,
 * so a field the patch does not name keeps its value, except where selecting
 * another kind replaces it. `selectionType`, `selectedItemIdSet` and the
 * keyframe lanes are kept consistent with the four public fields, as the store
 * actions keep them.
 */

import type { SelectionApi, SelectionInfo, SelectionPatch } from '../types'
import type { SelectionState } from '@/shared/state/selection'
import { useSelectionStore } from '@/shared/state/selection'
import { requireClip, requireMarker, requireTrack, requireTransition } from '../context'
import { invalidArgumentError } from '../errors'

/** Whether two id lists hold the same ids in the same order. */
function sameIds(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((id, index) => id === next[index])
}

/** The current selection, field by field. */
function currentFields(state: SelectionState): SelectionInfo {
  return {
    clips: [...state.selectedItemIds],
    tracks: [...state.selectedTrackIds],
    marker: state.selectedMarkerId,
    transition: state.selectedTransitionId,
  }
}

/** A copy of a patch field that must be an array of ids. */
function requireIdList(value: unknown, argument: string): string[] {
  if (!Array.isArray(value)) {
    throw invalidArgumentError({
      method: 'selection.set',
      argument,
      expectation: 'an array of ids',
      value,
    })
  }
  return [...value]
}

/** The fields a patch names, as copies; a field left out stays undefined. */
function namedFields(patch: SelectionPatch): Partial<SelectionInfo> {
  const named: Partial<SelectionInfo> = {}
  if (patch.clips !== undefined) named.clips = requireIdList(patch.clips, 'clips')
  if (patch.tracks !== undefined) named.tracks = requireIdList(patch.tracks, 'tracks')
  if (patch.marker !== undefined) named.marker = patch.marker
  if (patch.transition !== undefined) named.transition = patch.transition
  return named
}

/** Throw NOT_FOUND for the first named id the active context does not have. */
function requireNamedIdsExist(named: Partial<SelectionInfo>): void {
  for (const clip of named.clips ?? []) requireClip(clip, 'selection.set', 'clips')
  for (const track of named.tracks ?? []) requireTrack(track, 'selection.set', 'tracks')
  if (named.marker !== undefined && named.marker !== null) {
    requireMarker(named.marker, 'selection.set', 'marker')
  }
  if (named.transition !== undefined && named.transition !== null) {
    requireTransition(named.transition, 'selection.set', 'transition')
  }
}

/**
 * Clips, a marker and a transition are mutually exclusive in the store, so a
 * patch that names two of them cannot be honoured: rejecting it is better than
 * silently keeping one of the two.
 */
function requireSinglePrimary(named: Partial<SelectionInfo>): void {
  const primaries = [
    named.clips && named.clips.length > 0 ? 'clips' : null,
    named.marker ? 'marker' : null,
    named.transition ? 'transition' : null,
  ].filter((field): field is string => field !== null)
  if (primaries.length <= 1) return
  throw invalidArgumentError({
    method: 'selection.set',
    argument: primaries[1]!,
    expectation: `named alone, because ${primaries[0]} and ${primaries[1]} cannot both be selected`,
    value: primaries.join(' and '),
  })
}

/** The named fields laid over the current selection. */
function mergeFields(current: SelectionInfo, named: Partial<SelectionInfo>): SelectionInfo {
  return {
    clips: named.clips ?? current.clips,
    tracks: named.tracks ?? current.tracks,
    marker: named.marker !== undefined ? named.marker : current.marker,
    transition: named.transition !== undefined ? named.transition : current.transition,
  }
}

/**
 * The fields with the store's one-primary rule applied: selecting clips, a
 * marker or a transition clears the other two, and selecting tracks clears all
 * three, as `selectItems`, `selectMarker`, `selectTransition` and `selectTracks`
 * do. Clearing a field clears only that field.
 */
function applyPrimaryRule(named: Partial<SelectionInfo>, fields: SelectionInfo): SelectionInfo {
  let { clips, marker, transition } = fields
  if (named.tracks !== undefined && fields.tracks.length > 0) {
    // selectTracks also leaves a selected transition behind, which the rest of
    // the editor treats as no longer current, so the namespace clears it too.
    clips = []
    marker = null
    transition = null
  }
  if (named.clips !== undefined && clips.length > 0) {
    marker = null
    transition = null
  }
  if (named.marker !== undefined && marker !== null) {
    clips = []
    transition = null
  }
  if (named.transition !== undefined && transition !== null) {
    clips = []
    marker = null
  }
  return { ...fields, clips, marker, transition }
}

/** Whether the selection would not change. */
function sameFields(previous: SelectionInfo, next: SelectionInfo): boolean {
  return (
    sameIds(previous.clips, next.clips) &&
    sameIds(previous.tracks, next.tracks) &&
    previous.marker === next.marker &&
    previous.transition === next.transition
  )
}

/** The store's `selectionType` for these fields. */
function selectionTypeFor(fields: SelectionInfo): SelectionState['selectionType'] {
  if (fields.marker !== null) return 'marker'
  if (fields.transition !== null) return 'transition'
  if (fields.clips.length > 0) return 'item'
  if (fields.tracks.length > 0) return 'track'
  return null
}

/** The store fields to write for a new selection. */
function storeFieldsFor(state: SelectionState, fields: SelectionInfo): Partial<SelectionState> {
  return {
    selectedItemIds: fields.clips,
    selectedItemIdSet: new Set(fields.clips),
    selectedTrackIds: fields.tracks,
    selectedTrackId: fields.tracks[0] ?? null,
    activeTrackId: fields.tracks[0] ?? null,
    selectedMarkerId: fields.marker,
    selectedTransitionId: fields.transition,
    selectionType: selectionTypeFor(fields),
    expandedKeyframeLanes:
      state.editKeyframePanelOpen && fields.clips.length === 1
        ? new Set([fields.clips[0]!])
        : new Set<string>(),
  }
}

/**
 * Create the `studio.selection` namespace over `useSelectionStore`.
 * @example const selection = createSelectionApi()
 */
export function createSelectionApi(): SelectionApi {
  return {
    get(): SelectionInfo {
      return currentFields(useSelectionStore.getState())
    },

    set(patch: SelectionPatch): void {
      const state = useSelectionStore.getState()
      const current = currentFields(state)
      const named = namedFields(patch)
      requireNamedIdsExist(named)
      requireSinglePrimary(named)

      const next = applyPrimaryRule(named, mergeFields(current, named))

      if (sameFields(current, next)) return
      useSelectionStore.setState(storeFieldsFor(state, next))
    },

    clear(): void {
      useSelectionStore.getState().clearSelection()
    },
  }
}
