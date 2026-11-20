/**
 * `studio.markers`: the markers and the in/out range of the active editing
 * context (design §4.2). Implemented by `createMarkersApi(): MarkersApi`.
 *
 * Every writing method is one `transaction` around the action the timeline UI
 * calls (`features/timeline/stores/actions/marker-actions.ts`), so a call is at
 * most one undo entry and a rejected argument leaves the project as it was.
 * Arguments are checked before a store is touched; an id that is not in the
 * active context is `NOT_FOUND` through `requireMarker`.
 *
 * A colour is accepted in the forms the editor itself stores for a marker: the
 * `#RGB` and `#RRGGBB` the colour picker writes, and the `oklch(L C H)` form of
 * the marker panel's presets (`marker-panel/index.tsx:22-29`). A colour that
 * `list()` returned can therefore always be written back.
 *
 * Two store behaviours shape the range (`marker-actions.ts`): the first in point
 * set on a timeline without an out point also sets the out point to the
 * timeline's end (`:66-69`), and the first out point sets the in point to 0
 * (`:93-96`). On a fresh 400-frame timeline, `setIn(30)` therefore makes
 * `range()` return `{ in: 30, out: 400 }`, not `{ in: 30, out: null }`. Clearing
 * a single point has no action of its own — `clearInOutPoints` drops both — so
 * `setIn(null)` and `setOut(null)` write the store setter inside their
 * transaction and mark the project dirty as the actions do; that is still one
 * undo entry.
 */

import type { ProjectMarker } from '@/types/timeline'
import {
  addMarker,
  clearAllMarkers,
  clearInOutPoints,
  removeMarker,
  setInPoint,
  setOutPoint,
  updateMarker,
} from '@/features/timeline/stores/actions/marker-actions'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { markBeats } from '@/studio/beats/mark'
import { requireClip, requireFrame, requireMarker } from '../context'
import { invalidArgumentError } from '../errors'
import { transaction } from '../transaction'
import type {
  ClipId,
  Frame,
  MarkerAddInput,
  MarkerBeatsInput,
  MarkerId,
  MarkerInfo,
  MarkerPatch,
  MarkersApi,
  RangeInfo,
} from '../types'

/** `#RGB` and `#RRGGBB`, the two hex forms the marker colour picker writes. */
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * `oklch(L C H)` in the form the marker panel's presets write it
 * (`marker-panel/index.tsx:22-29`): two-decimal lightness and chroma, an
 * integer hue, single spaces.
 */
const OKLCH_COLOUR = /^oklch\(\d+\.\d{2} \d+\.\d{2} \d+\)$/

/** `value` as a marker colour, or undefined when the caller left it out. */
function optionalColour(value: unknown, argument: string, method: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && (HEX_COLOUR.test(value) || OKLCH_COLOUR.test(value))) {
    return value
  }
  throw invalidArgumentError({
    method,
    argument,
    expectation: 'a colour like "#3B82F6" or "oklch(0.65 0.20 250)"',
    value,
  })
}

/** `value` as a marker label, or undefined when the caller left it out. */
function optionalLabel(value: unknown, argument: string, method: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw invalidArgumentError({ method, argument, expectation: 'a string', value })
}

/** The marker as a plain copy; the store's own object is never handed out. */
function markerInfo(marker: ProjectMarker): MarkerInfo {
  return {
    id: marker.id,
    frame: marker.frame,
    ...(marker.label !== undefined && { label: marker.label }),
    color: marker.color,
  }
}

/**
 * Markers in frame order, each as a plain copy. Ties on frame break on id, the
 * way every marker surface orders them (`shared/timeline/marker-names.ts:16`).
 */
function list(): MarkerInfo[] {
  const markers = useMarkersStore.getState().markers
  return [...markers].sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id)).map(markerInfo)
}

/** Add a marker; the store generates the id, read back after the action. */
function add(input: MarkerAddInput): MarkerId {
  const method = 'markers.add'
  const frame = requireFrame(input.frame, 'frame', method)
  const label = optionalLabel(input.label, 'label', method)
  const color = optionalColour(input.color, 'color', method)

  return transaction('MARKERS_ADD', () => {
    addMarker(frame, color, label)
    const markers = useMarkersStore.getState().markers
    return markers[markers.length - 1]!.id
  }).value
}

/** Mark the beats of a clip's audio; `markBeats` is the one undo step. */
async function addBeats(clipId: ClipId, input: MarkerBeatsInput = {}): Promise<Frame[]> {
  const method = 'markers.addBeats'
  requireClip(clipId, method, 'clipId')
  const strength = input?.strength
  if (strength !== undefined && !(typeof strength === 'number' && strength >= 0 && strength <= 1)) {
    throw invalidArgumentError({
      method,
      argument: 'strength',
      expectation: 'a number between 0 and 1',
      value: strength,
    })
  }
  return markBeats(clipId, { strength })
}

/** Change the fields the patch names on one marker. */
function update(id: MarkerId, patch: MarkerPatch): void {
  const method = 'markers.update'
  const frame = patch.frame === undefined ? undefined : requireFrame(patch.frame, 'frame', method)
  const label = optionalLabel(patch.label, 'label', method)
  const color = optionalColour(patch.color, 'color', method)
  requireMarker(id, method, 'id')

  const updates: Partial<Omit<ProjectMarker, 'id'>> = {
    ...(frame !== undefined && { frame }),
    ...(label !== undefined && { label }),
    ...(color !== undefined && { color }),
  }
  transaction('MARKERS_UPDATE', () => updateMarker(id, updates))
}

/** Remove one marker of the active context. */
function remove(id: MarkerId): void {
  requireMarker(id, 'markers.remove', 'id')
  transaction('MARKERS_REMOVE', () => removeMarker(id))
}

/** Remove every marker of the active context. */
function clear(): void {
  transaction('MARKERS_CLEAR', () => clearAllMarkers())
}

/** The in/out range as a plain copy. */
function range(): RangeInfo {
  const { inPoint, outPoint } = useMarkersStore.getState()
  return { in: inPoint, out: outPoint }
}

/** Set or clear the in point; `SET_IN_POINT` also moves a missing out point. */
function setIn(frame: Frame | null): void {
  if (frame === null) {
    // No action clears one point (`clearInOutPoints` clears both): the store
    // setter inside the transaction is what makes this a single undo step.
    transaction('MARKERS_SET_IN', () => {
      useMarkersStore.getState().setInPoint(null)
      useTimelineSettingsStore.getState().markDirty()
    })
    return
  }

  const value = requireFrame(frame, 'frame', 'markers.setIn')
  transaction('MARKERS_SET_IN', () => setInPoint(value))
}

/** Set or clear the out point; `SET_OUT_POINT` also moves a missing in point. */
function setOut(frame: Frame | null): void {
  if (frame === null) {
    // See `setIn`: clearing one point has no action of its own.
    transaction('MARKERS_SET_OUT', () => {
      useMarkersStore.getState().setOutPoint(null)
      useTimelineSettingsStore.getState().markDirty()
    })
    return
  }

  const value = requireFrame(frame, 'frame', 'markers.setOut')
  transaction('MARKERS_SET_OUT', () => setOutPoint(value))
}

/** Clear both points of the active context. */
function clearRange(): void {
  transaction('MARKERS_CLEAR_RANGE', () => clearInOutPoints())
}

/**
 * The `studio.markers` namespace (design §4.2).
 * @example const markers = createMarkersApi(); markers.list()
 */
export function createMarkersApi(): MarkersApi {
  return { list, add, addBeats, update, remove, clear, range, setIn, setOut, clearRange }
}
