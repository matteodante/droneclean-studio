/**
 * What the render seat calls to give a `LookStage` the project's looks (design 5.1 §4.4, §4.6,
 * §6 slice 5.2b).
 *
 * `lookTable` reads one look's `.cube` from the workspace, parses it in the row order the library
 * recorded and remembers the table; `registerLooksWith` uploads exactly the looks the project's
 * clips use to one stage (`LookStage.setLook`) and releases the ones they no longer use. A look
 * whose table object the stage already holds is not uploaded again: a call after every edit does
 * not re-upload 2.1 MB textures that did not change, while a re-read of the row order hands the
 * stage a new table object and is uploaded.
 *
 * The seat's loop is: create a stage for the target format (`createLookPass`), then call
 * `registerLooksWith(stage)` whenever the project's clips or the library changed, and encode each
 * clip's look only when `isLookRegistered(stage, look.id)` says the stage holds it (a clip can
 * point at a look whose file was removed, in which case `encode` would throw).
 */

import { createLogger } from '@/shared/logging/logger'
import type { LookStage } from '@/studio/color/gpu/look-pass'
import type { LookId } from '@/studio/color/lut-texture'
import type { ParsedCube } from '@/studio/color/cube'
import { parseLookText } from './import-cube'
import { useLooksStore } from './store'
import { cacheLookTable, cachedLookTable } from './tables'
import { collectUsedLookIds } from './usage'
import { readLookText } from './workspace'

const log = createLogger('LooksRegistry')

/**
 * The table each stage already holds for each look. Weak in the stage, so a stage the renderer
 * throws away is collected; the values are the cache's own table objects, so the map costs no
 * table memory. A later `setLook` with a different table object replaces the entry; `removeLook`
 * only happens for looks the project stopped using.
 */
const registeredLooks = new WeakMap<LookStage, Map<LookId, ParsedCube>>()

/**
 * One look's parsed table, from the cache when the library has already read it. Null when the
 * look is not in the library, its file is gone, or the file no longer reads as a look; the caller
 * skips it instead of failing the render.
 */
export async function lookTable(id: LookId): Promise<ParsedCube | null> {
  const cached = cachedLookTable(id)
  if (cached !== undefined) return cached

  await useLooksStore.getState().load()
  const entry = useLooksStore.getState().looks.find((candidate) => candidate.id === id)
  if (entry === undefined) {
    log.warn(`lookTable: "${id}" is not in the looks library`)
    return null
  }

  let text: string
  try {
    text = await readLookText(entry)
  } catch (error) {
    log.warn(`lookTable: the file of "${id}" cannot be read`, error)
    return null
  }

  const result = parseLookText(text, entry.entryOrder)
  if (!result.ok) {
    log.warn(`lookTable: the file of "${id}" no longer reads as a look: ${result.failure.code}`)
    return null
  }
  cacheLookTable(id, result.look.parsed)
  return result.look.parsed
}

/**
 * Gives a stage the looks the project's clips use, and takes back the ones they no longer use.
 * Call it when the stage is created and after any change to the clips' looks or to the library.
 */
export async function registerLooksWith(stage: LookStage): Promise<void> {
  const used = collectUsedLookIds()
  await useLooksStore.getState().load()

  let held = registeredLooks.get(stage)
  if (held === undefined) {
    held = new Map<LookId, ParsedCube>()
    registeredLooks.set(stage, held)
  }

  for (const id of [...held.keys()]) {
    if (used.has(id)) continue
    stage.removeLook(id)
    held.delete(id)
  }

  for (const id of used) {
    const table = await lookTable(id)
    if (table === null || held.get(id) === table) continue
    stage.setLook(id, table)
    held.set(id, table)
  }
}

/**
 * Whether `registerLooksWith` has given this stage the look — the synchronous check a render seat
 * makes per frame before `encode`, so a clip whose look file disappeared applies nothing instead
 * of throwing.
 */
export function isLookRegistered(stage: LookStage, id: LookId): boolean {
  return registeredLooks.get(stage)?.has(id) ?? false
}
