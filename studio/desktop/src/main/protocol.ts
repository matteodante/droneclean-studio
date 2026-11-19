/**
 * Mapping from a `droneclean://` request to a file inside the app's `dist/` folder.
 *
 * Pure on purpose: no filesystem, no Electron. `protocol-handler.ts` adds the file
 * reads and the realpath check that follows symlinks; this module decides what a
 * request means, which is what the unit tests cover.
 */
import path from 'node:path'

/** Scheme the editor page is served from, and the host inside it. */
export const APP_SCHEME = 'droneclean'
export const APP_HOST = 'app'
/** The URL the window opens: the projects page, which is the desktop app's front door. */
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/projects`

/**
 * The route that serves media an agent named by path (task 2.2, design §4.5):
 * `droneclean://app/__media/<id>`. It lives inside the app's scheme, so it is
 * the same origin as the page and needs no CORS, no port and no second origin.
 */
export const MEDIA_PATH_SEGMENT = '__media'

/** A media id: the hash `main/media.ts` gives a path, URL-safe. */
export const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** The URL of a registered media file. */
export function mediaUrl(mediaId: string): string {
  return `${APP_SCHEME}://${APP_HOST}/${MEDIA_PATH_SEGMENT}/${mediaId}`
}

export type MediaRouteRequest =
  | { readonly kind: 'media'; readonly id: string }
  | { readonly kind: 'rejected'; readonly reason: string }

/**
 * Decide whether a request is for the media route.
 *
 * `null` means "not this route": another scheme, another host, or a path that
 * does not start with `__media` — those go to `mapRequestUrl` and the built
 * editor. A URL that does name the route but carries no usable id is
 * `rejected`, which the handler answers 404 rather than guessing a file.
 */
export function parseMediaRoute(requestUrl: string): MediaRouteRequest | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    return { kind: 'rejected', reason: 'malformed-escape' }
  }
  if (decoded.includes('\0')) return { kind: 'rejected', reason: 'nul-byte' }

  const segments = decoded.split('/').filter((segment) => segment !== '')
  if (segments[0] !== MEDIA_PATH_SEGMENT) return null
  if (segments.length !== 2) return { kind: 'rejected', reason: 'a media URL is /__media/<id>' }
  const id = segments[1] ?? ''
  if (!MEDIA_ID_PATTERN.test(id)) return { kind: 'rejected', reason: 'invalid media id' }
  return { kind: 'media', id }
}

/** The file a path without an extension falls back to (the SPA entry). */
export const SPA_ENTRY = 'index.html'

/**
 * Headers on every response: the editor needs cross-origin isolation for
 * SharedArrayBuffer, and the same values the Vite dev server and the headless
 * server send.
 */
export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.icns': 'image/icns',
}

export type RequestMapping =
  | { readonly kind: 'file'; readonly relativePath: string; readonly contentType: string }
  | { readonly kind: 'rejected'; readonly reason: RejectionReason }

export type RejectionReason =
  | 'unparsable-url'
  | 'wrong-scheme'
  | 'wrong-host'
  | 'malformed-escape'
  | 'nul-byte'
  | 'path-traversal'
  | 'backslash'
  | 'colon'

/**
 * Decide which file a request URL means.
 *
 * - `droneclean://app/` and any extension-less path serve the SPA entry, so the
 *   router sees `/projects/abc` and `/editor/42` as routes.
 * - A path with an extension is a file of `dist/`; unknown extensions are served
 *   as `application/octet-stream`.
 * - Anything that tries to leave the folder (`..`, encoded `%2e%2e`, backslashes,
 *   NUL bytes, malformed escapes, another host) is rejected, never resolved.
 */
export function mapRequestUrl(requestUrl: string): RequestMapping {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return { kind: 'rejected', reason: 'unparsable-url' }
  }

  if (url.protocol !== `${APP_SCHEME}:`) return { kind: 'rejected', reason: 'wrong-scheme' }
  if (url.host !== APP_HOST) return { kind: 'rejected', reason: 'wrong-host' }

  let decoded: string
  try {
    // Decoding before splitting is deliberate: it turns `%2e%2e` into `..` and
    // `%2f` into a separator, so both are judged by the rules below.
    decoded = decodeURIComponent(url.pathname)
  } catch {
    return { kind: 'rejected', reason: 'malformed-escape' }
  }

  if (decoded.includes('\0')) return { kind: 'rejected', reason: 'nul-byte' }

  const segments = decoded.split('/').filter((segment) => segment !== '')
  for (const segment of segments) {
    if (segment === '..' || segment === '.') return { kind: 'rejected', reason: 'path-traversal' }
    if (segment.includes('\\')) return { kind: 'rejected', reason: 'backslash' }
    // A drive letter or a resource fork would only matter on other filesystems;
    // no file of `dist/` needs a colon, and rejecting it keeps `path.resolve` honest everywhere.
    if (segment.includes(':')) return { kind: 'rejected', reason: 'colon' }
  }

  if (segments.length === 0) {
    return { kind: 'file', relativePath: SPA_ENTRY, contentType: contentTypeOf(SPA_ENTRY) }
  }

  const relativePath = segments.join('/')
  if (extensionOf(relativePath) === '') {
    return { kind: 'file', relativePath: SPA_ENTRY, contentType: contentTypeOf(SPA_ENTRY) }
  }

  return { kind: 'file', relativePath, contentType: contentTypeOf(relativePath) }
}

/** Lower-case extension including the dot; `''` when the last segment has none. */
export function extensionOf(relativePath: string): string {
  const lastSegment = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  const dot = lastSegment.lastIndexOf('.')
  if (dot <= 0) return ''
  return lastSegment.slice(dot).toLowerCase()
}

/** MIME type for a file of the built app. Unknown extensions are not guessed. */
export function contentTypeOf(relativePath: string): string {
  return CONTENT_TYPES[extensionOf(relativePath)] ?? 'application/octet-stream'
}

/**
 * True when `candidate` is a strict descendant of `dir`.
 *
 * Both paths must be absolute and already normalised (realpath output is). The
 * comparison adds the separator so `/app/dist-other` is not inside `/app/dist`.
 */
export function isPathInside(dir: string, candidate: string): boolean {
  const withSeparator = dir.endsWith(path.sep) ? dir : dir + path.sep
  return candidate.startsWith(withSeparator) && candidate.length > withSeparator.length
}
