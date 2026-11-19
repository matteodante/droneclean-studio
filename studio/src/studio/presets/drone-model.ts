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
