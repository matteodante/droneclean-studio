/**
 * What leaves the computer in a crash report has no paths and no file names (20 Nov 2026): an
 * error message such as "Could not decode /Users/ann/Flights/DJI_0020.MP4" arrives as "Could not
 * decode <path>". The same rules are written out in `desktop/src/main/telemetry/report.ts` and
 * `mcp/launcher.mjs`, and tested on the same samples.
 */

/**
 * An absolute path: a POSIX one under a user or volume folder, a Windows drive path, a UNC path, or a file:// URL.
 * Folders may hold spaces (`/Volumes/SSD/Avata 2 - 15 novembre/`); the last part ends at a space.
 */
const ABSOLUTE_PATH =
  /(?:(?:file:\/\/\/?)?\/(?:Users|home|Volumes|private|var|tmp|mnt|media|run|opt|root)(?:\/[^\/\n'"`)\]>,;]*(?=\/))*\/[^\s'"`)\]>,;]*|[A-Za-z]:(?:[\\\/][^\\\/\n'"`)\]>,;]*(?=[\\\/]))*[\\\/][^\s'"`)\]>,;]*|\\\\[^\s'"`)\]>,;]+)/g

/** A bare file name with a media, project or look extension. */
const FILE_NAME =
  /[^\s/\\'"`()[\]<>,;:]+\.(?:mp4|mov|m4v|mkv|avi|mxf|insv|lrv|lrf|mts|m2ts|webm|wav|mp3|m4a|aac|flac|aiff?|ogg|opus|png|jpe?g|heic|webp|gif|dng|tiff?|cube|3dl|srt|vtt|gcsv|bbl|osd|fcpxml|xml|otio|edl|fcproject|zip)\b/gi

/** The editor's project ids in its addresses (`/editor/<id>`). */
const EDITOR_ROUTE = /\/editor\/[^/?#\s]+/g

/** The same text with paths, media file names and project ids replaced. */
export function scrubText(text: string): string {
  return text
    .replace(ABSOLUTE_PATH, '<path>')
    .replace(FILE_NAME, '<file>')
    .replace(EDITOR_ROUTE, '/editor/<id>')
}

/** An address without its query, fragment and project id: the page, not what was open in it. */
export function scrubUrl(url: string): string {
  const cut = url.split(/[?#]/, 1)[0] ?? ''
  return cut.replace(EDITOR_ROUTE, '/editor/<id>')
}
