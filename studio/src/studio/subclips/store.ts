import { create } from 'zustand'
import type { Subclip } from './model'
import { getRangeError, parseStoredSubclip } from './validate'

export interface CreateSubclipInput {
  mediaId: string
  name: string
  startFrame: number
  endFrame: number
  sourceFps: number
  /** Parent's frame count: when given, a range past the end of the file is refused. */
  parentFrameCount?: number
}

interface SubclipsState {
  subclips: Subclip[]
}

interface SubclipsActions {
  /** Adds a subclip. Throws a `RangeError` for a bad range or an empty name; nothing is clamped. */
  create: (input: CreateSubclipInput) => Subclip
  /** Renames one. False when it does not exist or the name is empty. */
  rename: (id: string, name: string) => boolean
  /** Removes by id; the number removed. Clips already on the timeline are not touched. */
  remove: (ids: readonly string[]) => number
  /** Removes every subclip of a parent (D6); the records removed. */
  removeForMedia: (mediaId: string) => Subclip[]
  /** Replaces all records (project open): malformed ones and repeated ids are dropped. */
  setSubclips: (records: readonly unknown[]) => void
  reset: () => void
}

export const useSubclipsStore = create<SubclipsState & SubclipsActions>()((set, get) => ({
  subclips: [],

  create: (input) => {
    const name = input.name.trim()
    if (name === '') throw new RangeError('A subclip needs a name')
    const error = getRangeError(input.startFrame, input.endFrame, input.parentFrameCount)
    if (error) throw new RangeError(error)
    const subclip: Subclip = {
      id: crypto.randomUUID(),
      mediaId: input.mediaId,
      name,
      startFrame: input.startFrame,
      endFrame: input.endFrame,
      sourceFps: input.sourceFps,
      createdAt: Date.now(),
    }
    set((state) => ({ subclips: [...state.subclips, subclip] }))
    return subclip
  },

  rename: (id, name) => {
    const next = name.trim()
    if (next === '' || !get().subclips.some((subclip) => subclip.id === id)) return false
    set((state) => ({
      subclips: state.subclips.map((subclip) =>
        subclip.id === id ? { ...subclip, name: next } : subclip,
      ),
    }))
    return true
  },

  remove: (ids) => {
    const doomed = new Set(ids)
    const before = get().subclips.length
    set((state) => ({ subclips: state.subclips.filter((subclip) => !doomed.has(subclip.id)) }))
    return before - get().subclips.length
  },

  removeForMedia: (mediaId) => {
    const removed = get().subclips.filter((subclip) => subclip.mediaId === mediaId)
    if (removed.length > 0) {
      set((state) => ({
        subclips: state.subclips.filter((subclip) => subclip.mediaId !== mediaId),
      }))
    }
    return removed
  },

  setSubclips: (records) => {
    const seen = new Set<string>()
    const subclips: Subclip[] = []
    for (const record of records) {
      const subclip = parseStoredSubclip(record)
      if (!subclip || seen.has(subclip.id)) continue
      seen.add(subclip.id)
      subclips.push(subclip)
    }
    set({ subclips })
  },

  reset: () => set({ subclips: [] }),
}))

/** The subclips of one library file, in the order they were made. */
export function getSubclipsForMedia(mediaId: string): Subclip[] {
  return useSubclipsStore.getState().subclips.filter((subclip) => subclip.mediaId === mediaId)
}

/** How many subclips deleting these files would also delete: the count the confirmation names. */
export function countSubclipsForMedia(mediaIds: readonly string[]): number {
  const ids = new Set(mediaIds)
  return useSubclipsStore.getState().subclips.filter((subclip) => ids.has(subclip.mediaId)).length
}
