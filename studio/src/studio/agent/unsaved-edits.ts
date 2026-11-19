/**
 * Whether the open project has edits no save has written (task 2.3): what Take
 * over of a lost workspace would discard, since it reloads the project from
 * disk (`workspace-owner.ts`).
 *
 * The timeline's dirty flag is set by every edit and cleared only by a save that
 * went through, so in a read-only window it holds every edit made since the
 * last save — the ones made while read-only included.
 *
 * It lives here, outside the workspace gate, because a feature reaches another
 * feature's store only through a contract file, and the gate's folder is
 * FreeCut's.
 */
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'

export function hasUnsavedProjectEdits(): boolean {
  return useTimelineSettingsStore.getState().isDirty
}
