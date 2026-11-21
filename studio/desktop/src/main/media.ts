/**
 * Media the page names by path, served on the app's own scheme (task 2.2 slice 5,
 * design §4.5).
 *
 * A page cannot open a file by an absolute path, so the shell does: the editor
 * asks `window.dronecleanDesktop.mediaPaths.describe(paths)` for the files an
 * agent named, and `mediaPaths.allow(folders)` for the folders of a project's
 * path records; the shell stats each one and answers
 * `droneclean://app/__media/<id>`. That URL is the same origin as the page, so
 * the preview, mediabunny's `UrlSource` and the export all read it with `Range`
 * and no CORS, COEP work or port.
 *
 * **The allow-list.** The route serves only what the page named: the files an
 * agent's `run` imported in this session (each `describe` call is that naming),
 * and the folders of the open project's path records, which the page names at
 * start-up from its own media library (design §4.5 step 4). A file inside an
 * allowed folder is served without being added to the file list, so after a
 * restart the allow-list is exactly those folders; anything named outside them
 * is that call's session grant. Nothing else on disk has an id, and an id whose
 * path is no longer a regular file or no longer allowed answers 404.
 *
 * The id is a hash of the real path, so the same file answers the same URL for
 * as long as the table holds it, and the URL carries no path of the disk.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { contentRangeHeader, parseByteRange } from '../shared/native-media'
import { refuseUncPath } from './media/path-guard'
import {
  ISOLATION_HEADERS,
  isPathInside,
  mediaUrl,
  type MediaRouteRequest,
} from './protocol'

/** One file the page named: what it is on disk and the URL that serves it. */
export interface MediaFileDescription {
  /** Real path of the file (symlinks resolved). */
  readonly path: string
  /** Base name, for the media library's title. */
  readonly name: string
  /** Size in bytes. */
  readonly size: number
  /** Modification time, epoch milliseconds (`File.lastModified`). */
  readonly lastModified: number
  /** `droneclean://app/__media/<id>`, same origin as the page. */
  readonly url: string
}

/** The IPC channel of `mediaPaths.describe`; the preload writes the same name out. */
export const MEDIA_PATH_DESCRIBE_CHANNEL = 'media-paths:describe'

/** The IPC channel of `mediaPaths.allow`; the preload writes the same name out. */
export const MEDIA_PATH_ALLOW_CHANNEL = 'media-paths:allow'

/**
 * The media types the route may serve, by extension. Deliberately the editor's
 * own readable set: video, audio and raster images. SVG is left out because the
 * route is same-origin with the app and an SVG is a document that can script.
 */
const MEDIA_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** The `Content-Type` a file's extension gives it, or null when it is not media. */
export function mediaContentType(fileName: string): string | null {
  const extension = path.extname(fileName).toLowerCase()
  return MEDIA_CONTENT_TYPES[extension] ?? null
}

/** The id of a file in the route: a hash of its real path, URL-safe, no path on the wire. */
export function mediaIdForPath(realPath: string): string {
  return createHash('sha256').update(realPath, 'utf8').digest('base64url').slice(0, 22)
}

/**
 * Why a path may not be named through the media routes, or null. The folders where a program keeps its own data
 * (a hidden folder of the home folder such as `~/.ssh` or `~/.config`, `~/Library` on macOS, `AppData` / `%APPDATA%`
 * on Windows) hold no footage a pilot picks, and a page that names them gets nothing there but the media-looking
 * files of other programs (review finding F5). Only the folders are judged: a hidden file name is not, and a hidden
 * folder outside the home folder (a working copy under `.worktrees/`) is not.
 *
 * Pure on its inputs (real paths, the home folder, the platform, `%APPDATA%` and `%LOCALAPPDATA%`), so a test checks
 * the Windows rules on any machine.
 */
export function sensitiveFolderReason(
  realPath: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const flavour = platform === 'win32' ? path.win32 : path.posix
  const fold = (value: string): string => (platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value)
  const inside = (outer: string, inner: string): boolean => {
    const relative = flavour.relative(fold(outer), fold(inner))
    return relative !== '' && !relative.startsWith('..') && !flavour.isAbsolute(relative)
  }
  if (platform === 'win32') {
    for (const folder of [env['APPDATA'], env['LOCALAPPDATA']]) {
      if (folder !== undefined && folder !== '' && (inside(folder, realPath) || fold(folder) === fold(realPath))) {
        return 'the folder where programs keep their data'
      }
    }
  }
  if (!inside(home, realPath)) return null
  const segments = flavour.relative(home, realPath).split(/[\\/]/).filter((segment) => segment !== '')
  const folders = segments.slice(0, -1)
  if (folders.some((segment) => segment.startsWith('.'))) return 'a hidden folder'
  const first = fold(segments[0] ?? '')
  if (platform === 'darwin' && first === 'library') return 'the Library folder'
  if (platform === 'win32' && first === 'appdata') return 'the AppData folder'
  return null
}

/** A file an id names: where its bytes are and what they are. */
interface RegisteredMedia {
  readonly path: string
  readonly contentType: string
}

/**
 * What the route may read, and the ids it answers.
 *
 * One instance lives as long as the app: the page names paths as it opens
 * projects and as an agent imports, and the route reads only what was named.
 */
export class MediaPathAccess {
  private readonly files = new Map<string, RegisteredMedia>()
  private readonly allowedFiles = new Set<string>()
  private readonly allowedFolders = new Set<string>()
  private readonly homeDir: string
  private readonly platform: NodeJS.Platform

  /** `homeDir` and `platform` are the running machine's unless a test says otherwise. */
  constructor(options: { readonly homeDir?: string; readonly platform?: NodeJS.Platform } = {}) {
    this.homeDir = options.homeDir ?? os.homedir()
    this.platform = options.platform ?? process.platform
  }

  /**
   * Register the files the page names and answer one entry per file. A folder
   * is refused here: its files have no bytes of their own, so the page names
   * the folders of a project's path records through `allow`, not through this.
   *
   * Everything is refused with a message that names the path: a relative path,
   * a file that does not exist, something that is not a regular file, and an
   * extension the route does not serve. The editor turns the message into the
   * agent's `StudioError`.
   */
  async describe(paths: unknown): Promise<MediaFileDescription[]> {
    if (!Array.isArray(paths)) {
      throw new Error('media paths: "paths" must be an array of absolute file paths')
    }

    const files: Array<{ path: string; size: number; lastModified: number }> = []
    for (const value of paths) {
      if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
        throw new Error(`media paths: not a usable path: ${JSON.stringify(value)}`)
      }
      refuseUncPath(value, 'media paths', this.platform)
      if (!path.isAbsolute(value)) {
        throw new Error(`media paths: not an absolute path: ${JSON.stringify(value)}`)
      }
      let real: string
      try {
        real = await fs.promises.realpath(value)
      } catch {
        throw new Error(`media paths: no such file: ${value}`)
      }
      const stat = await fs.promises.stat(real)
      if (!stat.isFile()) {
        throw new Error(`media paths: not a regular file: ${value}`)
      }
      this.refuseSensitive(real, path.dirname(real), 'file')
      files.push({ path: real, size: stat.size, lastModified: Math.round(stat.mtimeMs) })
    }

    const described: MediaFileDescription[] = []
    for (const file of files) {
      const contentType = mediaContentType(file.path)
      if (contentType === null) {
        throw new Error(`media paths: not video, audio or image: ${file.path}`)
      }
      // A file inside an allowed folder needs no grant of its own: the folder is
      // the grant. Anything else is granted by this call — the page naming it is
      // the app naming it (an agent's `run`).
      if (!this.isAllowed(file.path)) this.allowedFiles.add(file.path)
      const id = mediaIdForPath(file.path)
      this.files.set(id, { path: file.path, contentType })
      described.push({
        path: file.path,
        name: path.basename(file.path),
        size: file.size,
        lastModified: file.lastModified,
        url: mediaUrl(id),
      })
    }
    return described
  }

  /**
   * Allow the folders of the open project's path records, so the files inside
   * them stay readable after a restart without naming each file in advance.
   * Answers the real path of each folder.
   */
  async allow(folders: unknown): Promise<string[]> {
    if (!Array.isArray(folders)) {
      throw new Error('media paths: "folders" must be an array of absolute folder paths')
    }

    const allowed: string[] = []
    for (const value of folders) {
      if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
        throw new Error(`media paths: not a usable folder: ${JSON.stringify(value)}`)
      }
      refuseUncPath(value, 'media paths', this.platform)
      if (!path.isAbsolute(value)) {
        throw new Error(`media paths: not an absolute folder: ${JSON.stringify(value)}`)
      }
      let real: string
      try {
        real = await fs.promises.realpath(value)
      } catch {
        throw new Error(`media paths: no such folder: ${value}`)
      }
      if (!(await fs.promises.stat(real)).isDirectory()) {
        throw new Error(`media paths: not a folder: ${value}`)
      }
      this.refuseSensitive(path.join(real, 'x'), real, 'folder')
      this.allowFolder(real)
      allowed.push(real)
    }
    return allowed
  }

  /**
   * The file an id names, when it is still a regular file and still allowed.
   * Null is the 404: an id the page never named, a file that moved or was
   * deleted, and a path that is no longer inside an allowed folder.
   */
  async resolve(
    id: string,
  ): Promise<{ path: string; size: number; contentType: string } | null> {
    const file = this.files.get(id)
    if (!file) return null
    let stat: fs.Stats
    try {
      stat = await fs.promises.lstat(file.path)
    } catch {
      return null
    }
    // `lstat`, not `stat`: the path was a real path when it was named, and a
    // symlink put in its place afterwards is not the file the page named.
    if (!stat.isFile()) return null
    if (!this.isAllowed(file.path)) return null
    return { path: file.path, size: stat.size, contentType: file.contentType }
  }

  /**
   * The real path of `value` when it is a media file this registry holds: a
   * regular file with a media extension that was named (`describe`) or sits in
   * an allowed folder. Null for everything else, so that a native decode, which
   * runs a program on the file, starts only on what the page legitimately named
   * (review finding R7).
   */
  async registeredFile(value: unknown): Promise<string | null> {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return null
    if (!path.isAbsolute(value)) return null
    try {
      refuseUncPath(value, 'media paths', this.platform)
      const real = await fs.promises.realpath(value)
      if (!(await fs.promises.stat(real)).isFile()) return null
      if (mediaContentType(real) === null) return null
      return this.isAllowed(real) ? real : null
    } catch {
      return null
    }
  }

  /**
   * A folder is the grant of everything under it; a disk root would grant the
   * whole disk, and the home folder (or a folder above it) the documents, keys
   * and footage of everything in it.
   */
  private allowFolder(folder: string): void {
    if (path.dirname(folder) === folder) {
      throw new Error(`media paths: a media folder cannot be a disk root: ${folder}`)
    }
    if (this.isHomeOrAbove(folder)) {
      throw new Error(`media paths: a media folder cannot be the home folder or above it: ${folder}`)
    }
    this.allowedFolders.add(folder)
  }

  /** Throws when `judged` (a file, or a probe path inside a folder) is where programs keep their own data. */
  private refuseSensitive(judged: string, shown: string, noun: 'file' | 'folder'): void {
    const reason = sensitiveFolderReason(judged, this.realHome(), this.platform)
    if (reason !== null) {
      throw new Error(`media paths: not a media ${noun}, it is in ${reason}: ${shown}`)
    }
  }

  private realHome(): string {
    try {
      return fs.realpathSync(this.homeDir)
    } catch {
      return this.homeDir
    }
  }

  private isHomeOrAbove(folder: string): boolean {
    let home = this.homeDir
    try {
      home = fs.realpathSync(this.homeDir)
    } catch {
      // A home folder that cannot be resolved is compared as written.
    }
    return folder === home || isPathInside(folder, home)
  }

  private isAllowed(filePath: string): boolean {
    if (this.allowedFiles.has(filePath)) return true
    for (const folder of this.allowedFolders) {
      if (isPathInside(folder, filePath)) return true
    }
    return false
  }
}

/** The headers of a media response: the app's isolation headers plus what a range needs. */
function mediaHeaders(
  contentType: string,
  contentLength: number,
  contentRange?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...ISOLATION_HEADERS,
    'Content-Type': contentType,
    'Content-Length': String(contentLength),
    'Accept-Ranges': 'bytes',
  }
  if (contentRange !== undefined) headers['Content-Range'] = contentRange
  return headers
}

function mediaNotFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: mediaHeaders('text/plain; charset=utf-8', 8),
  })
}

/**
 * Answer a `/__media/{id}` request. Only `GET` and `HEAD` reach here (the
 * handler answers 405 first); a `Range` header gets 206 with `Content-Range`,
 * an invalid or unsatisfiable one 416, and no header the whole file as 200.
 * The body is an abortable stream of exactly the requested bytes, so a 3.76 GB
 * clip is never loaded whole.
 */
export async function serveMediaRequest(
  access: MediaPathAccess,
  route: MediaRouteRequest,
  request: Request,
): Promise<Response> {
  if (route.kind === 'rejected') return mediaNotFound()
  const file = await access.resolve(route.id)
  if (file === null) return mediaNotFound()

  const asked = parseByteRange(request.headers.get('range'), file.size)
  if (asked.kind === 'invalid' || asked.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: mediaHeaders('text/plain; charset=utf-8', 0, contentRangeHeader(file.size, null)),
    })
  }
  const range = asked.kind === 'partial' ? asked : null
  const length = range ? range.end - range.start + 1 : file.size
  const headers = mediaHeaders(
    file.contentType,
    length,
    range ? contentRangeHeader(file.size, range) : undefined,
  )
  const status = range ? 206 : 200
  if (request.method === 'HEAD') return new Response(null, { status, headers })

  const stream = fs.createReadStream(file.path, range ? { start: range.start, end: range.end } : {})
  const abort = (): void => {
    stream.destroy()
  }
  request.signal.addEventListener('abort', abort, { once: true })
  stream.once('close', () => request.signal.removeEventListener('abort', abort))
  const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
  return new Response(body, { status, headers })
}
