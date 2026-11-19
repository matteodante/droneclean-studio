// What the preview tells the pilot about a staged clip it cannot draw yet, and the signal that redraws it (design 3.6
// section 2.10, findings S3 and R1). The export never comes here: a stage that cannot draw throws a `StageError` and
// the export stops with its message. The preview instead holds the clip's last good staged frame, and this module is
// how that is not silent:
//
//   clip states     one per clip the preview is holding or drawing without all its stages: "opening" while a stage
//                   prepares or its frame's data is arriving, "failed" with the stage's message. The preview's badge
//                   reads them; a clip whose stages all drew again has no state.
//   frame ready     a held frame's stages became ready: the preview draws its current frame again, so a paused preview
//                   does not stay on the held picture (design 3.6 risk 4).
//
// Nothing here imports a store, React or the DOM: the badge subscribes, the renderer's pipeline writes.

import type { StageErrorStage } from './types'

/** Why a clip is drawn from its last good frame (or from its source, before its first one) */
export type ClipStageState =
  | { readonly kind: 'opening'; readonly stage: StageErrorStage }
  | { readonly kind: 'failed'; readonly stage: StageErrorStage; readonly message: string }

type Listener = () => void

const states = new Map<string, ClipStageState>()
const stateListeners = new Set<Listener>()
const readyListeners = new Set<Listener>()
let snapshot: ReadonlyMap<string, ClipStageState> = new Map()

function sameState(a: ClipStageState | undefined, b: ClipStageState | null): boolean {
  if (a === undefined || b === null) return a === undefined && b === null
  if (a.kind !== b.kind || a.stage !== b.stage) return false
  return a.kind !== 'failed' || (b.kind === 'failed' && a.message === b.message)
}

/** Records a clip's state, or clears it with `null`; listeners hear only a change */
export function setClipStageState(itemId: string, state: ClipStageState | null): void {
  if (sameState(states.get(itemId), state)) return
  if (state === null) states.delete(itemId)
  else states.set(itemId, state)
  snapshot = new Map(states)
  for (const listener of [...stateListeners]) listener()
}

/** Every clip's state, as one immutable map that is replaced on each change (a `useSyncExternalStore` snapshot) */
export function clipStageStates(): ReadonlyMap<string, ClipStageState> {
  return snapshot
}

/** Calls `listener` after any clip's state changes; returns the function that stops it */
export function subscribeClipStageStates(listener: Listener): () => void {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

/** A held or partial preview frame can now be drawn with all its stages */
export function notifyStagedFrameReady(): void {
  for (const listener of [...readyListeners]) listener()
}

/** Calls `listener` each time a held preview frame became drawable; returns the function that stops it */
export function subscribeStagedFrameReady(listener: Listener): () => void {
  readyListeners.add(listener)
  return () => {
    readyListeners.delete(listener)
  }
}
