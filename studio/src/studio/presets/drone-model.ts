/**
 * The drone model a video's own tags name (design 5.1, section 4.5; task 5.2).
 *
 * DJI writes the model into the MP4 `©too` tag ("DJI Avata2") — ffprobe calls that tag the
 * file's `encoder`. mediabunny hands the container's atoms over as `raw`, and when `©too` is
 * missing the same string sits inside the `©dji` `udta` blob. The model is descriptive only: the
 * clip panel shows it beside the colour profile the file name suggests, so a user can tell two
 * clips of the same drone family apart. It never chooses a profile.
 *
 * Measured on clip 0020 (3.76 GB, 18 Nov 2026): mediabunny's `getMetadataTags()` takes 7.2 ms and
 * returns `©too: "DJI Avata2"`, `©cmt: "EIS:OFF;FOV:Normal;"` and the `©dji` blob with the same
 * string inside. An ffmpeg re-mux replaces `©too` with its own writer string ("Lavf63.1.102"), so
 * a cut of a DJI clip carries no model unless the tag is restored.
 */

/** The tags mediabunny hands over: `raw` holds the container's own atom names. */
export interface MediaFileTags {
  raw?: Record<string, unknown>
}

/**
 * The model the raw tags name, if any: the MP4 `©too` tag ("DJI Avata2") or, when that atom is
 * missing, the same string inside the `©dji` `udta` blob. Only a string that names a DJI model is
 * returned — some encoders write their own name into `©too`, and that is not a drone.
 */
export function droneModelFromTags(tags: MediaFileTags | null | undefined): string | undefined {
  const raw = tags?.raw
  if (!raw) return undefined
  const too = raw['©too']
  if (typeof too === 'string') return djiModelIn(too)
  const dji = raw['©dji']
  // `ArrayBuffer.isView` rather than `instanceof`: the tag comes from mediabunny, whose bytes
  // need not share this module's realm (a test's TextEncoder already does not).
  if (ArrayBuffer.isView(dji)) {
    // The blob is a box shell of ASCII text around the same strings (`©too` among them).
    const bytes = new Uint8Array(dji.buffer, dji.byteOffset, dji.byteLength)
    return djiModelIn(new TextDecoder('latin1').decode(bytes))
  }
  if (typeof dji === 'string') return djiModelIn(dji)
  return undefined
}

/** The first DJI model name in a tag's text: "DJI Avata2", "DJI Mavic 3 Pro", … */
function djiModelIn(text: string): string | undefined {
  const match = /\bDJI[ -][A-Za-z0-9][A-Za-z0-9 -]{0,30}/.exec(text)
  if (!match) return undefined
  return match[0].trim().replace(/[ -]+$/, '')
}

/** The DJI drones this editor's D-Log M profile is known to have been looked at for, or has an open question for. */
export type KnownDjiDrone = 'avata-2' | 'mini-4-pro' | 'air-3'

/**
 * Which known DJI drone a model string names. DJI writes the model without spaces ("DJI Avata2") and some files
 * carry the camera code instead: `FC8482` is the Mini 4 Pro's (exiftool forum, "DJI Mini 4 Pro - Maker notes could
 * not be parsed", and sampleshots.com). The Air 3's code was not found in a public source, so the Air 3 is
 * recognised by its name only. The Air 3S is a different drone and is not matched.
 */
export function knownDjiDrone(model: string | null | undefined): KnownDjiDrone | null {
  const key = (model ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (key.includes('avata2')) return 'avata-2'
  if (key.includes('mini4pro') || key.includes('fc8482')) return 'mini-4-pro'
  if (/air3(?!s)/.test(key)) return 'air-3'
  return null
}

const DRONE_NAMES: Record<KnownDjiDrone, string> = {
  'avata-2': 'DJI Avata 2',
  'mini-4-pro': 'DJI Mini 4 Pro',
  'air-3': 'DJI Air 3',
}

/** The name a person writes for the drone a tag names ("DJI Avata2" → "DJI Avata 2"); the tag's own text for any other. */
export function droneDisplayName(model: string): string {
  const known = knownDjiDrone(model)
  return known === null ? model : DRONE_NAMES[known]
}

/**
 * Whether the D-Log M profile has not been checked against this drone's footage: it was fitted to the
 * Avata 2's, and DJI lists a separate D-Log M LUT for the Mini 4 Pro and the Air 3 without saying the curve is the same.
 */
export function dlogMUncheckedFor(model: string | null | undefined): boolean {
  const known = knownDjiDrone(model)
  return known === 'mini-4-pro' || known === 'air-3'
}
