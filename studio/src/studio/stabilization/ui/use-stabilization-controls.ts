// The clip panel section's state: what the clip's switch is doing, and the one function per control that stores a
// change (task 6.4). Every store goes through the timeline's `updateItem`, so one change is one undo step; the
// renderer's engine follows the item (`seat.sync`) and is also told directly (`engine.applySettings`).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import type { VideoItem } from '@/types/timeline'
import { NoLensProfileError, NoMotionDataError, type StabilizationProgress } from '../client'
import { engineSettingsKey, type SmoothingMethod, type StabilizationSettings } from '../settings'
import { applyChange, lensProfileName, type StabilizationChange } from './changes'
import type { StabilizationEngine } from './engine'
import { openStabilization, storeStabilization } from './switch'

/** What the section shows besides the switch */
export type StabilizationPhase =
  | { kind: 'idle' }
  /** The pilot switched stabilization on and the clip is being opened; `progress` is the engine's report */
  | { kind: 'checking'; progress: StabilizationProgress | null }
  | { kind: 'no-motion-data' }
  | { kind: 'no-lens-profile' }
  /** The engine's own words, shown as they are */
  | { kind: 'failed'; reason: string }

export interface StabilizationControls {
  phase: StabilizationPhase
  /** The smoothing methods, once the engine has described them; the smoothness range comes from them */
  methods: SmoothingMethod[] | null
  /** The lens profile's name, when one is loaded */
  lensName: string | null
  /** Switches the clip on (after the engine says it can be stabilized) or off: one undo step */
  setEnabled(enabled: boolean): void
  /** Stores one control's change; a value outside the allowed range is refused and `false` is returned */
  change(change: StabilizationChange): boolean
}

/** A failure's words: the message the engine gave */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The hook behind the section: `item` is the clip as the store has it now */
export function useStabilizationControls(
  item: VideoItem,
  engine: StabilizationEngine,
): StabilizationControls {
  const [phase, setPhase] = useState<StabilizationPhase>({ kind: 'idle' })
  const [methods, setMethods] = useState<SmoothingMethod[] | null>(null)
  const [probedLens, setProbedLens] = useState<string | null>(null)
  const alive = useRef(true)
  const itemRef = useRef(item)
  useEffect(() => {
    itemRef.current = item
  })
  const enabled = item.stabilization?.enabled === true

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // The controls' limits come from the engine; a clip that is already on needs them to draw its sliders
  useEffect(() => {
    if (!enabled || methods) return
    engine.smoothingMethods().then(
      (loaded) => {
        if (alive.current) setMethods(loaded)
      },
      (error: unknown) => {
        if (alive.current) setPhase({ kind: 'failed', reason: reasonOf(error) })
      },
    )
  }, [enabled, methods, engine])

  const store = useCallback(
    (settings: StabilizationSettings, switched = false) => {
      // Switching on or off moves an untouched box to the picture's new shape, in the same undo step
      storeStabilization(engine, itemRef.current, settings, switched).catch((error: unknown) => {
        if (alive.current) setPhase({ kind: 'failed', reason: reasonOf(error) })
      })
    },
    [engine],
  )

  const switchOn = useCallback(async () => {
    setPhase({ kind: 'checking', progress: null })
    try {
      const frameRate = useTimelineSettingsStore.getState().fps
      const {
        methods: loaded,
        next,
        lens,
      } = await openStabilization(engine, itemRef.current, frameRate, (progress) => {
        if (alive.current) setPhase({ kind: 'checking', progress })
      })
      if (!alive.current) return
      setMethods(loaded)
      setProbedLens(lens.name)
      setPhase({ kind: 'idle' })
      store(next, true)
    } catch (error) {
      if (!alive.current) return
      if (error instanceof NoMotionDataError) setPhase({ kind: 'no-motion-data' })
      else if (error instanceof NoLensProfileError) setPhase({ kind: 'no-lens-profile' })
      else setPhase({ kind: 'failed', reason: reasonOf(error) })
    }
  }, [engine, store])

  const setEnabled = useCallback(
    (on: boolean) => {
      if (on) {
        void switchOn()
        return
      }
      setPhase({ kind: 'idle' })
      const current = itemRef.current.stabilization
      if (current) store({ ...current, enabled: false }, true)
    },
    [store, switchOn],
  )

  const change = useCallback(
    (requested: StabilizationChange): boolean => {
      // The store's clip, not the last render's: a number box commits on Enter and, in the same event, again on blur,
      // before React has drawn the first commit
      const latest = useItemsStore.getState().itemById[item.id] as VideoItem | undefined
      const current = (latest ?? itemRef.current).stabilization
      if (!current || !methods) return false
      const next = applyChange(current, requested, methods)
      if (!next) return false
      // A number box commits on Enter and again on blur: the second commit says the same and is not a change, so it
      // adds no undo step and does not ask the engine for a recompute
      if (engineSettingsKey(next) === engineSettingsKey(current)) return true
      store(next)
      return true
    },
    [methods, store, item.id],
  )

  return {
    phase,
    methods,
    lensName: probedLens ?? lensProfileName(item.stabilization?.lensProfile),
    setEnabled,
    change,
  }
}
