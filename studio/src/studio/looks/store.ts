/**
 * The looks library's state (design 5.1 §4.4, §6 slice 5.2b).
 *
 * The list the picker draws comes from `looks/index.json` in the workspace folder, read when the
 * clip panel's looks section mounts and after every change. Adding, renaming, removing and
 * re-reading a file all write the index through `workspace.ts`; the parsed table of a look is
 * remembered in `tables.ts` so the render seat never parses the same file twice.
 *
 * A look is the user's own file, not project content: none of these actions is an undo step of
 * the timeline. The per-clip choice (`VideoItem.look`) is, through `updateItem`.
 */

import { create } from 'zustand'
import { createLogger } from '@/shared/logging/logger'
import type { CubeEntryOrder } from '@/studio/color/cube'
import { lookDisplayName, parseLookText, type LookImportFailure } from './import-cube'
import { cacheLookTable, forgetLookTable, forgetLookTablesExcept } from './tables'
import {
  hashLookText,
  readLookText,
  readLooksIndex,
  removeLookFiles,
  writeLookText,
  writeLooksIndex,
} from './workspace'
import type { LookEntry } from './types'

const log = createLogger('LooksStore')

/** Why the library could not do what it was asked, beyond an import's own failures. */
export type LooksFailure =
  | LookImportFailure
  | {
      /** The workspace's index or a look's file could not be read. */
      readonly code: 'read'
    }
  | {
      /** The workspace's index or a look's file could not be written. */
      readonly code: 'store'
    }
  | {
      /** This browser has no file picker; the file has to be dropped into the library. */
      readonly code: 'unavailable'
    }

/** The library's list, its load state, and the last failure the dialog shows. */
interface LooksState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly looks: readonly LookEntry[]
  readonly error: LooksFailure | null
  /** Reads `looks/index.json`; a no-op once loaded unless `force` is set. */
  load: (options?: { readonly force?: boolean }) => Promise<void>
  /** Parses, stores and lists one `.cube` text; null when it did not become a look. */
  add: (input: { readonly text: string; readonly fileName: string }) => Promise<LookEntry | null>
  /** Renames a look; false when the name is empty or the write failed. */
  rename: (id: string, name: string) => Promise<boolean>
  /** Removes a look and its file; false when the id is not in the library or the write failed. */
  remove: (id: string) => Promise<boolean>
  /** Re-reads a look's file in the other row order; the retry a blue-fastest file needs. */
  setEntryOrder: (id: string, order: CubeEntryOrder) => Promise<boolean>
  /** Shows a failure the dialog itself met (a picker that cannot open, an unreadable file). */
  report: (failure: LooksFailure | null) => void
}

/**
 * The load in flight, shared by every caller: the section, the dialog and the render seat all ask
 * for the library on the same settle, and one read of the index answers them all.
 */
let pendingLoad: Promise<void> | null = null

/** Replaces the entry with `id`, or returns the list unchanged when there is no such entry. */
function withEntry(
  looks: readonly LookEntry[],
  id: string,
  change: (entry: LookEntry) => LookEntry,
): LookEntry[] | null {
  const index = looks.findIndex((entry) => entry.id === id)
  if (index < 0) return null
  return looks.map((entry, position) => (position === index ? change(entry) : entry))
}

/** Writes a changed list, reports a failure, and adopts the list on success. */
async function commit(
  set: (partial: Partial<LooksState>) => void,
  looks: readonly LookEntry[],
): Promise<boolean> {
  try {
    await writeLooksIndex(looks)
  } catch (error) {
    log.warn('writing looks/index.json failed', error)
    set({ error: { code: 'store' } })
    return false
  }
  set({ looks, error: null })
  return true
}

export const useLooksStore = create<LooksState>((set, get) => ({
  status: 'idle',
  looks: [],
  error: null,

  load: (options = {}) => {
    const state = get()
    if (state.status === 'loading' && pendingLoad !== null) return pendingLoad
    if (state.status === 'ready' && options.force !== true) return Promise.resolve()
    const run = (async () => {
      set({ status: 'loading' })
      try {
        const looks = await readLooksIndex()
        forgetLookTablesExcept(new Set(looks.map((entry) => entry.id)))
        set({ status: 'ready', looks, error: null })
      } catch (error) {
        log.warn('reading looks/index.json failed', error)
        set({ status: 'error', looks: [], error: { code: 'read' } })
      } finally {
        pendingLoad = null
      }
    })()
    pendingLoad = run
    return run
  },

  add: async ({ text, fileName }) => {
    const result = parseLookText(text)
    if (!result.ok) {
      set({ error: result.failure })
      return null
    }
    // The list the new entry joins must be the stored one, not this session's guess: a new
    // workspace or a tab that has not loaded yet would otherwise drop the index's entries.
    await get().load()
    if (get().status !== 'ready') {
      set({ error: { code: 'read' } })
      return null
    }
    const entry: LookEntry = {
      id: crypto.randomUUID(),
      name: lookDisplayName(fileName, result.look.title),
      fileName,
      filePath: fileName,
      size: result.look.size,
      hasShaper: result.look.hasShaper,
      entryOrder: 'red-fastest',
      hash: await hashLookText(text),
      addedAt: Date.now(),
    }
    const next = [...get().looks, entry]
    try {
      await writeLookText(entry, text)
    } catch (error) {
      log.warn('writing a look file failed', error)
      set({ error: { code: 'store' } })
      return null
    }
    if (!(await commit(set, next))) {
      // The look is not in the index: its file must not linger in the workspace either.
      await removeLookFiles(entry.id).catch(() => undefined)
      return null
    }
    cacheLookTable(entry.id, result.look.parsed)
    return entry
  },

  rename: async (id, name) => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return false
    const next = withEntry(get().looks, id, (entry) => ({ ...entry, name: trimmed }))
    if (next === null) return false
    return commit(set, next)
  },

  remove: async (id) => {
    const current = get().looks
    const next = current.filter((entry) => entry.id !== id)
    if (next.length === current.length) return false
    if (!(await commit(set, next))) return false
    forgetLookTable(id)
    // The index is authoritative; a file that cannot be removed is only an orphan on disk.
    await removeLookFiles(id).catch((error) => log.warn('removing a look file failed', error))
    return true
  },

  setEntryOrder: async (id, order) => {
    const entry = get().looks.find((candidate) => candidate.id === id)
    if (entry === undefined || entry.entryOrder === order) return false
    let text: string
    try {
      text = await readLookText(entry)
    } catch (error) {
      log.warn('reading a look file failed', error)
      set({ error: { code: 'read' } })
      return false
    }
    const result = parseLookText(text, order)
    if (!result.ok) {
      set({ error: result.failure })
      return false
    }
    const next = withEntry(get().looks, id, (candidate) => ({ ...candidate, entryOrder: order }))
    if (next === null) return false
    if (!(await commit(set, next))) return false
    cacheLookTable(id, result.look.parsed)
    return true
  },

  report: (failure) => {
    set({ error: failure })
  },
}))
