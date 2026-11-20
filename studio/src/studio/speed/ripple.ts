/**
 * How far a speed edit must push the clips after the clip it stretched.
 *
 * FreeCut's rate stretch pushes every later clip by the whole growth, even when the clip grew
 * into a gap that had room for it. A speed edit by a pilot (the speed panel, `clips.setSpeed`,
 * `clips.setSpeedCurve`) pushes only by how far the clip now passes the start of the next clip
 * on its track, and by nothing when it still fits in front of it (task 11.3).
 */

import type { TimelineItem } from '@/types/timeline'

/**
 * The shift the clips after a stretched clip need, in frames: the largest overlap, over the
 * tracks the stretch touched, of a stretched clip's new end with the start of the first clip
 * after the old end on that track. Zero when every stretched clip still ends at or before the
 * clip that follows it, and for a stretch that shortened the clip: a shorter clip leaves its
 * gap where it is.
 *
 * `items` are the items after the stretch; `stretchedIds` the clip and its linked companions;
 * `oldEnd` the clip's end before the stretch, which is where "after" starts.
 */
export function overlapPushAfterStretch(
  items: readonly TimelineItem[],
  stretchedIds: ReadonlySet<string>,
  oldEnd: number,
): number {
  let push = 0
  for (const stretched of items) {
    if (!stretchedIds.has(stretched.id)) continue
    let nextStart = Number.POSITIVE_INFINITY
    for (const other of items) {
      if (other.trackId !== stretched.trackId || stretchedIds.has(other.id)) continue
      if (other.from >= oldEnd && other.from < nextStart) nextStart = other.from
    }
    if (nextStart === Number.POSITIVE_INFINITY) continue
    push = Math.max(push, stretched.from + stretched.durationInFrames - nextStart)
  }
  return push
}
