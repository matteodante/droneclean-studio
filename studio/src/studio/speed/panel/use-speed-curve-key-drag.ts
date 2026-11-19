/**
 * Dragging one key of the speed curve (design 7.1, section 4.8).
 *
 * A drag is one undo step, like the speed slider's: the snapshot is taken when the pointer goes down,
 * every move calls the action's history-free `applySpeedCurve` so the clip's right edge and the clips
 * after it follow the pointer, and one undo entry is added when the pointer comes up. Nothing is
 * committed per move, so Ctrl+Z puts the curve and the timeline layout back in one press.
 *
 * Vertical movement sets the key's speed (the pointer's y on the graph's 0.1–10 axis); horizontal
 * movement moves the key inside the clip, expressed as its position in the shape (`frame / length`),
 * because a curve edit keeps the source span and changes the clip's length by the shape (§4.6): a key
 * set by its absolute frame would move every time the length changed under it. The first and last
 * keys are pinned to the clip's ends, so they only move vertically.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpeedCurve } from '@/studio/speed'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { captureSnapshot } from '@/features/timeline/stores/commands/snapshot'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { applySpeedCurve } from '../actions'
import { clampCurveSpeed, curveOnItem, roundCurveSpeed, withKeyFrame, withKeySpeed } from './curve-on-item'
import { plotYToSpeed } from './graph-geometry'

/** Where a key drag started: the key, the pointer and the plot's top edge in client pixels. */
export interface SpeedKeyDragStart {
  /** Index of the key in the curve's key list. */
  index: number
  /** The pointer's client x when it went down. */
  clientX: number
  /** The pointer's client y when it went down. */
  clientY: number
  /** The plot's top edge in client pixels, so a pointer y becomes a speed. */
  plotTop: number
  /** The plot's height in pixels: the axis the pointer y is read on. */
  plotHeight: number
}

interface KeyDragState extends SpeedKeyDragStart {
  /** The key's clip-relative frame when the drag started. */
  frame: number
  /** The key's speed when the drag started. */
  speed: number
  /** The clip's length when the drag started. */
  duration: number
  /** The timeline before the drag's first edit: the undo entry's "before". */
  before: ReturnType<typeof captureSnapshot>
}

/** Whether two curves hold the same keys; a no-op move does not touch the store. */
function curvesEqual(left: SpeedCurve, right: SpeedCurve): boolean {
  if (left.keys.length !== right.keys.length) return false
  return left.keys.every((key, index) => {
    const other = right.keys[index]!
    return key.frame === other.frame && key.speed === other.speed
  })
}

/** One pressed key's clip-relative frame for a pointer delta, in the shape's own space. */
function draggedFrame(drag: KeyDragState, clientX: number, currentDuration: number, pixelsPerFrame: number): number {
  const deltaFrames = (clientX - drag.clientX) / pixelsPerFrame
  const shapePosition = (drag.frame + deltaFrames) / drag.duration
  return Math.round(shapePosition * Math.max(1, currentDuration))
}

/**
 * The key drag's pointer handling for one clip: `beginDrag` starts a drag from a handle's pointer
 * down, and the hook adds the single undo entry when the pointer is released (or the panel goes
 * away mid-drag, so a live preview can never become an edit undo cannot reach).
 */
export function useSpeedCurveKeyDrag({
  itemId,
  fps,
  pixelsPerSecond,
}: {
  itemId: string
  fps: number
  pixelsPerSecond: number
}): {
  /** Index of the key being dragged, or null. */
  draggingIndex: number | null
  /** Start dragging one key of the clip's curve. */
  beginDrag: (start: SpeedKeyDragStart) => void
} {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const dragRef = useRef<KeyDragState | null>(null)

  const beginDrag = useCallback(
    (start: SpeedKeyDragStart) => {
      const item = useItemsStore.getState().itemById[itemId]
      if (!item) return
      const curve = curveOnItem(item)
      const key = curve.keys[start.index]
      if (!key) return
      dragRef.current = {
        ...start,
        frame: key.frame,
        speed: key.speed,
        duration: Math.max(1, Math.round(item.durationInFrames)),
        before: captureSnapshot(),
      }
      setDraggingIndex(start.index)
    },
    [itemId],
  )

  useEffect(() => {
    if (draggingIndex === null) return

    const finish = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setDraggingIndex(null)
      // The store's own guard adds nothing when the drag changed nothing (a click without movement).
      useTimelineCommandStore
        .getState()
        .addUndoEntry({ type: 'SET_SPEED_CURVE', payload: { id: itemId } }, drag.before)
    }

    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const item = useItemsStore.getState().itemById[itemId]
      if (!item) return
      const base = curveOnItem(item)
      const last = base.keys.length - 1
      if (drag.index < 0 || drag.index > last) return

      const speed = roundCurveSpeed(clampCurveSpeed(plotYToSpeed(event.clientY - drag.plotTop, drag.plotHeight)))
      let next = withKeySpeed(base, drag.index, speed)
      if (drag.index > 0 && drag.index < last) {
        const pixelsPerFrame = pixelsPerSecond / Math.max(1, fps)
        next = withKeyFrame(
          next,
          drag.index,
          draggedFrame(drag, event.clientX, item.durationInFrames, pixelsPerFrame),
        )
      }
      if (curvesEqual(next, base)) return
      applySpeedCurve(itemId, next)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      // A panel closed mid-drag still leaves one undo entry for what the pointer already changed.
      // `finish` adds nothing after a normal pointer-up has cleared the drag.
      finish()
    }
  }, [draggingIndex, fps, itemId, pixelsPerSecond])

  return { draggingIndex, beginDrag }
}
