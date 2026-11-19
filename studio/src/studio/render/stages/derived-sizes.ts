// The derived-size store (design 3.6 section 2.9): the size a stage's output has for a clip, a function of
// (media, settings) and nothing the render computes. It is filled only by `SourceStage.prepare`, outside the render,
// and read synchronously by `outputSize` and by the layout. A settings change is a new key, so an old size is never
// reused for new settings, and nothing here enters the project's undo history.

import type { Size, StageId } from './types'

/** Called after the store changes, with the key that changed. */
export type DerivedSizeListener = (key: string) => void

/** An observable `Map<key, Size>`. */
export interface DerivedSizeStore {
  get(key: string): Size | undefined
  /** Records the size for a key. Only a stage's `prepare` calls this. A listener is told only when the size changed. */
  set(key: string, size: Size): void
  /** Forgets a key (the preparer closes a stage whose key left the project). */
  delete(key: string): void
  /** Calls `listener` after each change; returns the function that stops it. */
  subscribe(listener: DerivedSizeListener): () => void
}

/** The key one stage's size is stored under: the stage's id and its own `key(item)` (media and settings fingerprint). */
export function derivedSizeKey(stage: StageId, stageKey: string): string {
  return `${stage}|${stageKey}`
}

function assertSize(size: Size): void {
  if (
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new RangeError(
      `A derived size must be whole pixels above 0, got ${size.width}x${size.height}`,
    )
  }
}

/** A fresh store. The session's one store is created by the preparer (slice 1), which is its only writer. */
export function createDerivedSizeStore(): DerivedSizeStore {
  const sizes = new Map<string, Size>()
  const listeners = new Set<DerivedSizeListener>()
  const notify = (key: string): void => {
    for (const listener of [...listeners]) listener(key)
  }
  return {
    get: (key) => sizes.get(key),
    set(key, size) {
      assertSize(size)
      const current = sizes.get(key)
      if (current?.width === size.width && current.height === size.height) return
      sizes.set(key, { width: size.width, height: size.height })
      notify(key)
    },
    delete(key) {
      if (sizes.delete(key)) notify(key)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
