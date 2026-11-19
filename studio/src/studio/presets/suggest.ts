/**
 * The colour profile a clip's file name hints at (design 5.1, sections 3.2, 4.5 and 6 slice
 * 5.2a).
 *
 * A clip's colour profile is not in its metadata: the container tags, the `djmd` track and the
 * HEVC VUI all say BT.709 for log footage, so nothing in the file can be trusted to name D-Log
 * or D-Log M. What DJI does write is the profile in the file name's suffix on its newer
 * cameras — one `_D` for D-Log and D-Log M alike, `_D-Log` / `_D-Log-M` when the camera says
 * which. That suffix is a suggestion for the user to confirm, never a decision: the clip panel
 * shows it with a question mark and applies nothing until the user presses Apply (see
 * `ColorPresetSection.tsx`). A file name with no DJI suffix hints at nothing, and the clip keeps
 * no input transform.
 *
 * The drone model comes from the file's own tags (`drone-model.ts`); it is shown beside the
 * suggestion so the user can tell two clips apart, and it does not choose the profile: the
 * suffix does.
 */

import type { ColorProfileId } from '@/studio/color/types'

/** A log profile: what a suggestion can be, never the pass-through `none`. */
export type SuggestedProfile = Exclude<ColorProfileId, 'none'>

/** What the clip panel may suggest for a clip, from its file name and its media record. */
export interface ColorProfileSuggestion {
  /** The profile the question is about. */
  profile: SuggestedProfile
  /** The drone model the file's tags named ("DJI Avata2"), or null when they named none. */
  drone: string | null
}

/**
 * The DJI file names this editor reads the suffix from: `DJI_` + the 14-digit capture time +
 * a counter of three to six digits + the profile suffix, e.g. `DJI_20261115124704_0020_D.MP4`.
 * Requiring the shape keeps a file called `clip_D.mp4` from being read as DJI footage.
 */
const DJI_FILE_NAME = /^dji_\d{14}_\d{3,6}_(d-log-m|d-log|d)$/i

/** The suffix as a profile: `_D-Log-M` → D-Log M, `_D-Log` → D-Log, `_D` → D-Log M (asked). */
function profileFromSuffix(suffix: string): SuggestedProfile {
  return suffix.toLowerCase() === 'd-log' ? 'dlog' : 'dlog-m'
}

/**
 * The file name without its last extension: `DJI_…_D.MP4` → `DJI_…_D`, and `.MP4` alone stays
 * `.MP4` so it matches nothing.
 */
function withoutExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/**
 * What the file name suggests, or null when it suggests nothing. `_D` alone is the ambiguous
 * suffix DJI writes for both logs on these cameras; it is suggested as D-Log M — the profile of
 * the footage this editor was built against — and the question mark is what keeps it honest.
 */
export function suggestColorProfile(input: {
  /** The media record's file name, with or without its extension. */
  fileName: string
  /** The drone model read from the file's tags, when there was one. */
  droneModel?: string | null
}): ColorProfileSuggestion | null {
  const match = DJI_FILE_NAME.exec(withoutExtension(input.fileName))
  const suffix = match?.[1]
  if (!suffix) return null
  const drone = input.droneModel?.trim()
  return { profile: profileFromSuffix(suffix), drone: drone ? drone : null }
}
