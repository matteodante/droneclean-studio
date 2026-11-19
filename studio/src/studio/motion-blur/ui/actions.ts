/**
 * Switching a clip's motion blur on, off or to another angle (design 7.2, section 4.7).
 *
 * One action, and it is the one the clip panel and the SDK's `clips.setMotionBlur` both call:
 * one code path from a mouse to a script, and one undo entry per call however many clips it
 * writes. It lives in `ui/`, not beside the maths: the maths is a pure core that may not reach a
 * store, and the store's normaliser imports it.
 */

import { useItemsStore } from '@/features/timeline/stores/items-store'
import { execute } from '@/features/timeline/stores/actions/shared'
import { canHoldMotionBlur } from '../settings'
import type { MotionBlurSettings } from '../types'

/**
 * Write `settings` (or remove the blur with `null`) on every clip of `ids` that can hold it, as
 * one undo step. A clip that cannot (not a video, reversed, a composition wrapper) is left as
 * it is; the callers refuse those themselves with their own answer.
 */
export function setMotionBlur(ids: readonly string[], settings: MotionBlurSettings | null): void {
  const targets = ids.filter((id) => {
    const item = useItemsStore.getState().itemById[id]
    return item !== undefined && canHoldMotionBlur(item)
  })
  if (targets.length === 0) return
  execute(
    'SET_MOTION_BLUR',
    () => {
      for (const id of targets) {
        useItemsStore.getState()._updateItem(id, {
          motionBlur: settings === null ? undefined : { ...settings },
        })
      }
    },
    { ids: targets, shutterDegrees: settings?.shutterDegrees ?? null },
  )
}
