/**
 * The parsed `.cube` tables the looks library has read (design 5.1 §4.4, §6 slice 5.2b).
 *
 * A parsed 65³ look is 2.1 M floats and costs the parser's time; the render seat asks for the same
 * look on every frame, so the library keeps the tables in memory once per look. The cache is keyed
 * by the look's id: the library only ever replaces a look's file under a new id (an import adds an
 * entry, a re-read of the row order replaces the table under the same id through `setEntryOrder`),
 * and both paths write the cache themselves.
 *
 * This module has no workspace or store dependency, so `store.ts` (which fills the cache on an
 * import) and `registry.ts` (which reads it for a stage) share it without an import cycle.
 */

import type { ParsedCube } from '@/studio/color/cube'
import type { LookId } from '@/studio/color/lut-texture'

const tables = new Map<LookId, ParsedCube>()

/** The parsed table of a look the library has read, or undefined when it has not. */
export function cachedLookTable(id: LookId): ParsedCube | undefined {
  return tables.get(id)
}

/** Remembers a look's parsed table, replacing one of the same id. */
export function cacheLookTable(id: LookId, cube: ParsedCube): void {
  tables.set(id, cube)
}

/** Drops one look's parsed table: its file changed, or it was removed from the library. */
export function forgetLookTable(id: LookId): void {
  tables.delete(id)
}

/**
 * Drops every parsed table whose look is no longer in the library — what a reload of a changed or
 * swapped workspace needs, so a new workspace's look cannot read the old one's table.
 */
export function forgetLookTablesExcept(ids: ReadonlySet<LookId>): void {
  for (const id of [...tables.keys()]) {
    if (!ids.has(id)) tables.delete(id)
  }
}
