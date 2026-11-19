/**
 * The looks library's data (design 5.1 §4.4, §6 slice 5.2b).
 *
 * A **look** is a creative `.cube` LUT the user added to the workspace: it runs after the clip's
 * input transform, so its table is applied to display-referred Rec.709, and it is taste rather
 * than calibration. The `.cube` files live in the workspace folder (`looks/{id}/…`, with the list
 * in `looks/index.json`), never in the project JSON: a 65³ table is 2.1 MB of half-floats and a
 * project keeps only the look's id and the intensity it is applied with (design 5.1 §4.4).
 *
 * This module holds the plain data only; importing is `import-cube.ts`, the workspace files are
 * `workspace.ts`, the library's state is `store.ts` and the float tables a stage uploads are
 * `registry.ts`.
 */

import type { CubeEntryOrder } from '@/studio/color/cube'

/** The intensity a look is applied with when the user has not moved the slider: 100 %. */
export const DEFAULT_LOOK_INTENSITY = 1

/** One clip's look: the library entry it reads and the blend with the input (0…1). */
export interface ClipLook {
  /** The id of a `.cube` file in the workspace's looks library. */
  readonly id: string
  /** 0…1: 0 leaves the picture untouched, 1 applies the table fully. */
  readonly intensity: number
}

/** One `.cube` file in the workspace's looks library. */
export interface LookEntry {
  /** The id the library and the clips refer to; the file's folder in the workspace. */
  readonly id: string
  /** What the picker and the library list show; starts as the file's `TITLE` or file name. */
  readonly name: string
  /** The original file name, for the library list's tooltip. */
  readonly fileName: string
  /** The file name inside `looks/{id}/`, already safe for any filesystem. */
  readonly filePath: string
  /** Points per side of the 3D grid, 2…65. */
  readonly size: number
  /** Whether the file also holds a `LUT_1D_SIZE` shaper, applied before the grid. */
  readonly hasShaper: boolean
  /** The order the file's data rows were read in; a blue-fastest file is retried this way. */
  readonly entryOrder: CubeEntryOrder
  /** SHA-256 of the file's text, so a changed file is visible without reading it. */
  readonly hash: string
  /** When the look was added, in milliseconds since the epoch. */
  readonly addedAt: number
}

/** `looks/index.json`: the library, newest last. */
export interface LooksIndexFile {
  readonly version: 1
  readonly looks: readonly LookEntry[]
}

/** A clip's look clamped to the 0…1 a stage accepts; an unreadable value means the default. */
function clampLookIntensity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LOOK_INTENSITY
  return Math.min(1, Math.max(0, value))
}

/** The slider's 0…100 reading of a clip look's intensity. */
export function lookIntensityPercent(look: ClipLook | undefined): number {
  return Math.round(clampLookIntensity(look?.intensity) * 100)
}
