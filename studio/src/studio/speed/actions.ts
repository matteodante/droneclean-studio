/**
 * Editing a clip's speed curve (design 7.1, sections 4.6 and 4.8).
 *
 * One action, `setSpeedCurve`, and it is the one the curve panel, the SDK's
 * `clips.setSpeedCurve` and an agent's script all call: one code path from a mouse to an
 * agent, and one undo entry per edit. Its body `applySpeedCurve` is also the panel's live
 * preview during a key drag, which adds its own single undo entry when the pointer is released.
 *
 * A key lands on a whole frame, so the curve's integral at the new length can differ from the
 * old span by less than one source frame; the source end is the integral there, floored — the
 * end the mapping reaches — and repeated edits can move it by a frame each time (design 7.1,
 * section 8 risk 7). The ripple is the speed slider's: the stretch carries the downstream clips,
 * the linked companions and their keyframes, so the edit leaves the timeline laid out and one
 * press of undo puts back the previous curve.
 *
 * What v1 hides rather than implements (design 7.1, section 4.6): a curve on a reversed clip
 * (its mapping runs backwards) and on a composition wrapper (sub-composition time is not source
 * frames). The callers refuse those with `UNSUPPORTED`; this action leaves them untouched.
 */

import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { execute } from '@/features/timeline/stores/actions/shared'
import { rateStretchItemWithoutHistory } from '@/features/timeline/stores/timeline-actions'
import { getSynchronizedLinkedItemsForEdit } from '@/features/timeline/stores/actions/linked-edit'
import { isLinkedSelectionEnabled } from '@/features/timeline/stores/actions/edit/shared'
import { timelineToSourceFrames } from '@/features/timeline/utils/source-calculations'
import { floorFraction, multiplyFractions, rateRatio, toRate } from '@/studio/time'
import { averageSpeed, type SpeedCurve } from './curve'
import { scaledEaseFields } from './ease-cut'
import { exactAreaAt } from './exact-curve'
import { sourceFramesAt } from './mapping'
import { normalizeSpeedCurve } from './normalize'

/**
 * The clip's kind can carry a curve: the renderer asks the mapping for video and audio items
 * only (design 7.1, section 4.6), so a curve written anywhere else would be a control that
 * does nothing. A reversed clip plays its source range backwards; v1 hides a curve there rather
 * than mapping it (design 7.1, sections 4.6 and 8 risk 5).
 *
 * The panel's button and the SDK's `UNSUPPORTED` answer both ask this, so the three surfaces
 * agree on which clips a curve belongs to.
 */
export function canHoldSpeedCurve(item: TimelineItem): boolean {
  if (item.type !== 'video' && item.type !== 'audio') return false
  return item.isReversed !== true
}

/**
 * The clips a curve edit writes (review finding T1): the clip and the companions linked to it
 * — its audio, for a video — exactly the ones the edit's stretch moves, so a video and its
 * sound keep one mapping. Kinds that cannot hold a curve are left out.
 */
function curveTargets(itemId: string): TimelineItem[] {
  const items = useItemsStore.getState().items
  return getSynchronizedLinkedItemsForEdit(items, itemId, isLinkedSelectionEnabled()).filter(
    canHoldSpeedCurve,
  )
}

/** The source frames the clip plays now: its trim window, else the span its curve or speed covers. */
function currentSourceSpan(item: TimelineItem): number {
  const sourceStart = item.sourceStart ?? 0
  if (item.sourceEnd !== undefined) return Math.max(1, item.sourceEnd - sourceStart)
  const fps = useTimelineSettingsStore.getState().fps
  const duration = Math.round(item.durationInFrames)
  if (item.speedCurve !== undefined) {
    return Math.max(
      1,
      Math.floor(
        sourceFramesAt(item.speedCurve, duration, toRate(item.sourceFps ?? fps), toRate(fps)),
      ),
    )
  }
  return Math.max(1, timelineToSourceFrames(duration, item.speed ?? 1, fps, item.sourceFps ?? fps))
}

/** A speed a person entered, to the hundredth: the precision every speed control commits. */
function toHundredth(speed: number): number {
  return Math.round(speed * 100) / 100
}

/**
 * The source end of a clip that plays `curve` over `duration` frames from its own start, with
 * no remainder (a curve edit re-authors the mapping): `floor(sourceStart) + floor(area · ratio)`
 * exactly, at least one frame past the start and inside the media.
 */
function curveSourceEnd(item: TimelineItem, curve: SpeedCurve, duration: number): number {
  const fps = useTimelineSettingsStore.getState().fps
  const span = multiplyFractions(
    exactAreaAt(curve, duration),
    rateRatio(toRate(item.sourceFps ?? fps), toRate(fps)),
  )
  const sourceStart = Math.max(0, Math.floor(item.sourceStart ?? 0))
  const end = sourceStart + Math.max(1, Number(floorFraction(span)))
  return Math.min(item.sourceDuration ?? Number.POSITIVE_INFINITY, end)
}

/**
 * Set the clip's speed curve, or remove it with `null` — which leaves the clip at one speed,
 * the curve's current average, and keeps its length (design 7.1, sections 4.1 and 4.9).
 *
 * `keys` are clip-relative frames, like the clip's keyframes, and the normaliser makes them
 * whole, sorted and pinned to the clip's ends, so the store never holds a curve that a renderer
 * would misread. The whole edit is one undo entry: the stretch that makes room for the new
 * length and the curve written into it.
 *
 * A curved clip is stretched, so its linked companions and downstream clips move with it, and
 * the companions get the same curve (review finding T1); a clip of a kind that cannot hold a
 * curve, or a reversed one, is left as it is, and so is a curve the normaliser cannot repair
 * (design 7.1, sections 4.6 and 8 risk 5).
 */
export function setSpeedCurve(itemId: string, curve: SpeedCurve | null): void {
  execute('SET_SPEED_CURVE', () => applySpeedCurve(itemId, curve), { id: itemId })
}

/**
 * Apply a curve without adding an undo entry: the body of {@link setSpeedCurve}, and what a
 * pointer drag in the curve panel calls on every move, so the clip and the clips after it follow
 * the pointer (the same live feedback the speed slider gives). The caller owns the undo entry: the
 * panel takes one snapshot when the drag starts and adds one entry when it ends (design 7.1,
 * section 4.8), exactly as the clip panel's speed slider does.
 *
 * The curve edit keeps the source span the clip plays and moves its length instead: with the
 * keys as the shape `u_i = f_i / D` and its average `mean`, spending the same `F` source frames
 * takes `D' = F·pNum·sDen/(mean·pDen·sNum)` frames (design 7.1, 4.6). The keys move to `u_i·D'`
 * and every speed is rounded to the hundredth, as a person's edit is; the source end is the
 * curve's exact integral at `D'`, floored, the end the mapping reaches. A curve edit re-authors
 * the mapping, so the cut's remainder goes (the first frame's source frame is unchanged), and a
 * curve that holds one speed is stored as that speed (review finding T6).
 */
export function applySpeedCurve(itemId: string, curve: SpeedCurve | null): void {
  const itemsStore = useItemsStore.getState()
  const item = itemsStore.itemById[itemId]
  if (item === undefined || !canHoldSpeedCurve(item)) return
  const targets = curveTargets(itemId)

  if (curve === null) {
    // One constant speed, at the average the curve last wrote: the length does not change.
    for (const target of targets) {
      itemsStore._updateItem(target.id, { speedCurve: undefined, sourceFrameOffset: undefined })
    }
    return
  }

  const authored = {
    keys: curve.keys.map((key) => ({
      frame: key.frame,
      speed: toHundredth(key.speed),
      ...(key.ease !== undefined ? { ease: key.ease } : {}),
      ...(key.easeSlice !== undefined ? { easeSlice: key.easeSlice } : {}),
    })),
  }
  const shape = normalizeSpeedCurve(authored, item.durationInFrames)
  if (shape === undefined) return

  const sourceFps = item.sourceFps ?? useTimelineSettingsStore.getState().fps
  const sourceRate = toRate(sourceFps)
  const projectRate = toRate(useTimelineSettingsStore.getState().fps)
  const sourceSpan = currentSourceSpan(item)
  const average = averageSpeed(shape)
  // The design's one division: the length that spends the same source span at the new shape.
  const duration = Math.max(
    1,
    Math.round(
      (sourceSpan * sourceRate.den * projectRate.num) /
        (average * sourceRate.num * projectRate.den),
    ),
  )
  const factor = duration / item.durationInFrames
  const nextCurve = normalizeSpeedCurve(
    {
      keys: shape.keys.map((key) => ({
        frame: key.frame * factor,
        speed: key.speed,
        ...scaledEaseFields(key, factor, 1),
      })),
    },
    duration,
  )
  if (nextCurve === undefined) return

  // The stretch makes room (or takes it) with the speed slider's ripple, the linked companions
  // and their keyframes, as a speed change: it leaves each clip at one speed with no remainder.
  // The new curve is then written into the length it just left, on the clip and on every
  // companion, inside the same undo entry (design 7.1, section 4.6).
  rateStretchItemWithoutHistory(itemId, item.from, duration, average, { rippleOverlapOnly: true })

  const store = useItemsStore.getState()
  for (const target of targets) {
    const stretched = store.itemById[target.id]
    if (stretched === undefined) continue
    store._updateItem(target.id, {
      speedCurve: nextCurve,
      sourceEnd: curveSourceEnd(stretched, nextCurve, duration),
      sourceFrameOffset: undefined,
    })
  }
}
