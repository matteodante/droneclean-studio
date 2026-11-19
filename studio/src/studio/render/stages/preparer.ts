// The preparer (design 3.6 section 2.9, condition 9): fills the derived-size store, outside the render, before a clip's
// first frame. On every change of the project's items it diffs the (stage, key) pairs the clips want against the ones it
// has prepared, prepares the new ones in the background and releases the old ones (an engine no clip uses goes: S7).
// An export calls `prepareAll(items, device)` before frame 0 and gets the first failure as a `StageError`.
//
// A failed prepare is state, kept under its key and not tried again by every later change (that would be a retry storm):
// new settings are a new key and prepare afresh, and `retry(item)` is the click on Retry. The preparer imports no store:
// the timeline's items arrive through `watchItems`, and the device through `getDevice`, both wired in `session.ts`.

import type { TimelineItem, VideoItem } from '@/types/timeline'
import { derivedSizeKey, type DerivedSizeStore } from './derived-sizes'
import type { StageRegistry } from './registry'
import { StageError, type SourceStage, type StageId } from './types'

/** What one (stage, key) is */
export type PrepareStatus =
  | { status: 'preparing' }
  | { status: 'ready' }
  | { status: 'failed'; error: StageError }

/** Called after any status changes, with the derived key that changed */
export type PrepareListener = (derivedKey: string) => void

export interface PreparerOptions {
  registry: StageRegistry
  sizes: DerivedSizeStore
  /** The device stages are prepared on; `undefined` (no GPU yet) postpones the preparation */
  getDevice?: () => Promise<GPUDevice | undefined>
  /** Calls the listener with the project's items on every change; resolves with the call that stops it */
  watchItems?: (listener: (items: readonly TimelineItem[]) => void) => Promise<() => void>
}

export interface Preparer {
  /** Diffs the project's items against what is prepared; prepares and releases in the background */
  sync(items: readonly TimelineItem[]): Promise<void>
  /** Prepares every stage every clip needs and resolves when all are ready; rejects with the first `StageError` */
  prepareAll(items: readonly TimelineItem[], device: GPUDevice): Promise<void>
  /**
   * Starts, in the background, every preparation these clips need that was never started: the preview's renderer asks
   * this before a clip's first frame. It releases nothing and does not try a failed preparation again (Retry does).
   */
  ensure(items: readonly TimelineItem[], device: GPUDevice): void
  /** The state of a clip's stage, or `undefined` when it is not wanted or not started */
  statusOf(item: VideoItem, stage: StageId): PrepareStatus | undefined
  /** Prepares a clip's failed stages again (the Retry button) */
  retry(item: VideoItem): Promise<void>
  /** Calls `listener` after any status changes; returns the function that stops it */
  subscribe(listener: PrepareListener): () => void
  /** Follows the project's items (`watchItems`); resolves with the call that stops it */
  start(): Promise<() => void>
}

interface Prepared {
  readonly stage: SourceStage
  readonly key: string
  state: PrepareStatus
  promise: Promise<void>
}

function asStageError(error: unknown, stage: StageId, item: VideoItem): StageError {
  if (error instanceof StageError) return error
  return new StageError({
    clip: item.label ?? item.id,
    stage,
    reason: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}

/** Creates a preparer over a registry and a size store. */
export function createPreparer(options: PreparerOptions): Preparer {
  const { registry, sizes } = options
  const prepared = new Map<string, Prepared>()
  const listeners = new Set<PrepareListener>()
  let latest: readonly TimelineItem[] = []
  let syncId = 0

  const notify = (derivedKey: string): void => {
    for (const listener of [...listeners]) listener(derivedKey)
  }

  /** The (derived key -> stage, item) pairs the items want, one per key whatever the number of clips using it */
  function wanted(
    items: readonly TimelineItem[],
  ): Map<string, { stage: SourceStage; item: VideoItem; key: string }> {
    const result = new Map<string, { stage: SourceStage; item: VideoItem; key: string }>()
    for (const item of items) {
      if (item.type !== 'video') continue
      for (const stage of registry.activeStages(item)) {
        let key: string
        try {
          key = stage.key(item)
        } catch (error) {
          // A clip with no usable key (no file, no settings): its failure is state under a key of its own
          key = `invalid:${item.id}`
          const derived = derivedSizeKey(stage.id, key)
          if (!prepared.has(derived)) {
            prepared.set(derived, {
              stage,
              key,
              state: { status: 'failed', error: asStageError(error, stage.id, item) },
              promise: Promise.resolve(),
            })
            notify(derived)
          }
        }
        const derived = derivedSizeKey(stage.id, key)
        if (!result.has(derived)) result.set(derived, { stage, item, key })
      }
    }
    return result
  }

  function start(
    derived: string,
    stage: SourceStage,
    item: VideoItem,
    key: string,
    device: GPUDevice,
  ): Prepared {
    const entry: Prepared = {
      stage,
      key,
      state: { status: 'preparing' },
      promise: Promise.resolve(),
    }
    // `prepare` runs its synchronous part now (a stage that knows its size sets it before it awaits)
    entry.promise = stage.prepare(item, device).then(
      () => {
        if (prepared.get(derived) === entry) {
          entry.state = { status: 'ready' }
          notify(derived)
        }
      },
      (error: unknown) => {
        if (prepared.get(derived) === entry) {
          entry.state = { status: 'failed', error: asStageError(error, stage.id, item) }
          notify(derived)
        }
      },
    )
    prepared.set(derived, entry)
    notify(derived)
    return entry
  }

  function release(derived: string, entry: Prepared): void {
    prepared.delete(derived)
    sizes.delete(derived)
    const { stage } = entry
    if (stage.release !== undefined) {
      void Promise.resolve(stage.release(entry.key)).catch(() => undefined)
    }
    notify(derived)
  }

  async function sync(items: readonly TimelineItem[]): Promise<void> {
    latest = items
    const id = ++syncId
    const device = await options.getDevice?.()
    // A newer change arrived while the device was found: it does the work
    if (id !== syncId) return
    const wants = wanted(items)
    if (device !== undefined) {
      for (const [derived, want] of wants) {
        if (!prepared.has(derived)) start(derived, want.stage, want.item, want.key, device)
      }
    }
    // Releases come after the starts: an engine that moves to new settings is found by the new key first
    for (const [derived, entry] of [...prepared]) {
      if (!wants.has(derived)) release(derived, entry)
    }
  }

  return {
    sync,

    async prepareAll(items, device) {
      latest = items
      const wants = wanted(items)
      const running: Promise<void>[] = []
      for (const [derived, want] of wants) {
        let entry = prepared.get(derived)
        if (entry?.state.status === 'failed') {
          prepared.delete(derived)
          entry = undefined
        }
        entry ??= start(derived, want.stage, want.item, want.key, device)
        running.push(entry.promise)
      }
      await Promise.all(running)
      for (const derived of wants.keys()) {
        const state = prepared.get(derived)?.state
        if (state?.status === 'failed') throw state.error
      }
    },

    ensure(items, device) {
      for (const [derived, want] of wanted(items)) {
        if (!prepared.has(derived)) start(derived, want.stage, want.item, want.key, device)
      }
    },

    statusOf(item, stage) {
      const found = registry.stages.find((candidate) => candidate.id === stage)
      if (!found) return undefined
      try {
        return prepared.get(derivedSizeKey(stage, found.key(item)))?.state
      } catch {
        return prepared.get(derivedSizeKey(stage, `invalid:${item.id}`))?.state
      }
    },

    async retry(item) {
      for (const stage of registry.activeStages(item)) {
        let key: string
        try {
          key = stage.key(item)
        } catch {
          key = `invalid:${item.id}`
        }
        const derived = derivedSizeKey(stage.id, key)
        if (prepared.get(derived)?.state.status === 'failed') prepared.delete(derived)
      }
      await sync(latest)
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async start() {
      if (options.watchItems === undefined) return () => undefined
      return options.watchItems((items) => {
        void sync(items)
      })
    },
  }
}
