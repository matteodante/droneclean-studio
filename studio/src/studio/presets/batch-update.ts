/**
 * One grade for a whole flight (plan 5.2): the colour profile and the look are chosen once and
 * written on every selected video clip. The clip panel's controls call this, so a choice made on
 * twenty clips is one undo entry, not twenty.
 */

import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { execute } from '@/features/timeline/stores/actions/shared'
import type { TimelineItem } from '@/types/timeline'

/** What one clip is to receive. */
export interface ClipUpdate {
  readonly id: string
  readonly updates: Partial<TimelineItem>
}

/**
 * Write every update in `changes` as ONE undo step. An id that is no longer in the timeline is
 * skipped; with nothing left to write, no history entry is made.
 */
export function updateClipsTogether(type: string, changes: readonly ClipUpdate[]): void {
  const targets = changes.filter(
    (change) => useItemsStore.getState().itemById[change.id] !== undefined,
  )
  if (targets.length === 0) return
  execute(
    type,
    () => {
      for (const { id, updates } of targets) {
        useItemsStore.getState()._updateItem(id, updates)
      }
      useTimelineSettingsStore.getState().markDirty()
    },
    { ids: targets.map((change) => change.id), count: targets.length },
  )
}
