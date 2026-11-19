// Clearing what subclips leave behind. Kept free of the timeline so the library's stores can use
// it without an import cycle.

import { useSourcePlayerStore } from '@/shared/state/source-player'
import { useSubclipsStore, type Subclip } from '@/studio/subclips'
import { subclipPosters } from '@/studio/subclips/poster'

/** Drops the remembered marks of subclips and files that are gone, so they are not saved. */
export function forgetSourceMarks(keys: readonly string[]): void {
  const player = useSourcePlayerStore.getState()
  const doomed = new Set(keys)
  const kept = Object.fromEntries(
    Object.entries(player.marksByKey).filter(([key]) => !doomed.has(key)),
  )
  if (Object.keys(kept).length !== Object.keys(player.marksByKey).length) {
    player.setMarksByKey(kept)
  }
}

type RemovalListener = () => void
const removalListeners = new Set<RemovalListener>()

/**
 * Runs `listener` whenever deleting files removed subclips. The library's stores cannot import the
 * timeline (a cycle), so whoever can, the library's actions, registers to mark the project changed.
 */
export function onSubclipsRemoved(listener: RemovalListener): () => void {
  removalListeners.add(listener)
  return () => removalListeners.delete(listener)
}

/** Deleting library files deletes their subclips too (design 1.6, D6): the records removed. */
export function removeSubclipsOfMedia(mediaIds: readonly string[]): Subclip[] {
  const removed = mediaIds.flatMap((id) => useSubclipsStore.getState().removeForMedia(id))
  for (const subclip of removed) subclipPosters.release(subclip.id)
  forgetSourceMarks([...mediaIds, ...removed.map((subclip) => subclip.id)])
  if (removed.length > 0) for (const listener of removalListeners) listener()
  return removed
}
