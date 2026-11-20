/**
 * Which looks a project's clips use (design 5.1 §4.4, §6 slice 5.2b).
 *
 * The render seat registers "the looks the project uses", and the library asks how many clips use
 * a look before it deletes it. Both read the same places: the open timeline's items and the items
 * of every sub-composition, since a compound clip can hold a look just as a top-level one does.
 */

import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import type { TimelineItem } from '@/types/timeline'

/** The look id an item applies, or null when it is not a video clip with a readable look. */
function lookIdOf(item: TimelineItem): string | null {
  if (item.type !== 'video') return null
  const look: unknown = item.look
  if (typeof look !== 'object' || look === null) return null
  const id = (look as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** Every item the project holds: the open timeline's, and the sub-compositions' ones. */
function projectItems(): TimelineItem[] {
  const root = useItemsStore.getState().items
  const compositions = useCompositionsStore.getState().compositions
  if (compositions.length === 0) return root
  return [...root, ...compositions.flatMap((composition) => composition.items)]
}

/** The library ids the project's video clips use, as a render seat must register them. */
export function collectUsedLookIds(): Set<string> {
  const ids = new Set<string>()
  for (const item of projectItems()) {
    const id = lookIdOf(item)
    if (id !== null) ids.add(id)
  }
  return ids
}

/** How many of the project's video clips use a look — the number the removal asks about. */
export function countClipsUsingLook(id: string): number {
  let count = 0
  for (const item of projectItems()) {
    if (lookIdOf(item) === id) count += 1
  }
  return count
}

/** The ids of the project's video clips that use a look, for a message that names what blocks a removal. */
export function clipIdsUsingLook(id: string): string[] {
  return projectItems().flatMap((item) => (lookIdOf(item) === id ? [item.id] : []))
}
