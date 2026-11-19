/**
 * Media an agent names by path (task 2.2 slice 5, design §4.5).
 *
 * An agent that was handed "these six clips: /Volumes/…/DJI_…_0020_D.MP4" has
 * paths, and a page cannot open a path: there is no `File` and no
 * `FileSystemFileHandle` to be had from a string (Chromium only makes a handle
 * from a picker or a drop). The desktop shell does have the file, and serves it
 * on the app's own scheme with `Range`
 * (`droneclean://app/__media/{id}`, `studio/desktop/src/main/media.ts`), so this
 * module is the page's half of that route:
 *
 * - {@link importMediaPaths} extends `studio.media.import` from handles to
 *   paths: it asks the shell to describe each path, has the library record it
 *   as `storageType: 'path'` with its `filePath`, and registers the URL so
 *   `resolveMediaUrl` answers it (the resolver reads `blobUrlManager` first).
 *   `installAgentMedia()` performs that extension on the page's SDK, so an
 *   agent's script calls `studio.media.import([...paths])` exactly as it calls
 *   the handle import.
 * - {@link registerPathRecords} is the restart path: when the open project's
 *   library loads, its path records name their folders (the shell allows them)
 *   and their files (the shell answers a URL for each again), and the URLs are
 *   registered before playback resolves them. No prompt, no picker.
 *
 * The library is the editor's; the import is not an undo step, exactly as
 * `media.import` is not (design §3.4): importing media never touches the
 * timeline.
 */
import type { MediaMetadata } from '@/types/storage'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import {
  mediaLibraryService,
  type LinkedPathSource,
} from '@/features/media-library/services/media-library-service'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { createLogger } from '@/shared/logging/logger'
import { getDesktopBridge, type DesktopBridge } from '@/studio/desktop/bridge'
import { studioError, type StudioError } from '../sdk/errors'
import type { MediaImportOptions, MediaInfo, Studio } from '../sdk/types'

const logger = createLogger('AgentMedia')

/** Whether {@link installAgentMedia} has already run on this page. */
let installed = false

/**
 * One file the shell described. The page's copy of the shell's
 * `DesktopMediaFile` (`studio/desktop/src/shared/bridge.ts`); the two are held
 * together at compile time by `media.test.ts`, because the shell is its own
 * TypeScript project and the page cannot import its values.
 */
export interface AgentMediaPathFile {
  readonly path: string
  readonly name: string
  readonly size: number
  readonly lastModified: number
  readonly url: string
}

/** The page's copy of the shell's `DesktopMediaPaths` member. */
export interface AgentMediaPathsBridge {
  describe(paths: readonly string[]): Promise<readonly AgentMediaPathFile[]>
  allow(folders: readonly string[]): Promise<readonly string[]>
}

/** One path record of the open project's library: the id to serve and the file it names. */
export interface PathMediaRecord {
  readonly id: string
  readonly filePath: string
}

/**
 * What the rules need from the app, behind one seam so the tests drive them
 * without a store, a worker or a desktop shell (as `frame.ts` does with its
 * environment). The real one is {@link createDefaultEnvironment}.
 */
export interface MediaPathEnvironment {
  /** The shell's media path member; absent in the browser. */
  bridge(): AgentMediaPathsBridge | undefined
  /** The project the import goes into, or null when none is open. */
  currentProjectId(): string | null
  /** The SDK's own `media.import`, for the handle items of a mixed call. */
  importHandles(
    items: readonly FileSystemFileHandle[],
    options?: MediaImportOptions,
  ): Promise<MediaInfo[]>
  /** Probe the described files and record them as path media. */
  importLinkedPaths(
    sources: readonly LinkedPathSource[],
    projectId: string,
  ): Promise<MediaMetadata[]>
  /** Put the new records in the library the editor shows. */
  showInLibrary(records: readonly MediaMetadata[]): void
  /** Make a record's URL the one `resolveMediaUrl` answers. */
  registerUrl(mediaId: string, url: string): void
  /** Whether a record's URL is already registered. */
  hasUrl(mediaId: string): boolean
  /** Clear a broken flag a resolution set before the URL was registered. */
  markHealthy(mediaId: string): void
  /** The SDK's read of a record, for the `MediaInfo[]` answer. */
  info(mediaId: string): MediaInfo | null
}

/** What the restart path needs: the shell, and the URL registration. */
export type PathRegistrationEnvironment = Pick<
  MediaPathEnvironment,
  'bridge' | 'registerUrl' | 'hasUrl' | 'markHealthy'
>

/** The message of a failed promise or IPC call, for a `StudioError`. */
function failureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Electron prefixes a rejected `ipcRenderer.invoke` with the channel and an
  // `Error: `; the agent needs the shell's own sentence, not the wrapper.
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:Error:\s*)+/, '')
}

/** The error of a `media.import` call, with the SDK's shape. */
function importError(
  code: 'UNSUPPORTED' | 'INVALID_ARGUMENT' | 'MEDIA_UNAVAILABLE' | 'INTERNAL',
  message: string,
  hint?: string,
): StudioError {
  return studioError({ code, method: 'media.import', message, ...(hint ? { hint } : {}) })
}

/**
 * Import the files an agent named by path, and make them playable.
 *
 * The shell describes every file in one call (a path that is not a readable
 * media file fails the whole call, so the agent fixes the list and retries),
 * the library probes each URL with `Range` and writes the records, and the URL
 * of every record is registered before the library shows it — a clip that
 * appears in the library is one the player can already resolve.
 */
export async function importNamedPaths(
  paths: readonly string[],
  options: MediaImportOptions | undefined,
  environment: Pick<
    MediaPathEnvironment,
    | 'bridge'
    | 'currentProjectId'
    | 'importLinkedPaths'
    | 'showInLibrary'
    | 'registerUrl'
    | 'info'
  >,
): Promise<MediaInfo[]> {
  if (options?.storageMode === 'copy') {
    throw importError(
      'UNSUPPORTED',
      'a file named by its path is linked, never copied: its bytes stay where they are',
      'Pass no storageMode, or "link". To copy a file into the workspace, import it as a FileSystemFileHandle.',
    )
  }

  const bridge = environment.bridge()
  if (!bridge) {
    throw importError(
      'UNSUPPORTED',
      'importing by path needs the desktop app: this page has no window.dronecleanDesktop.mediaPaths',
      'In a browser, pass FileSystemFileHandles: studio.media.import([handle]).',
    )
  }

  const projectId = environment.currentProjectId()
  if (!projectId) {
    throw importError(
      'UNSUPPORTED',
      'no project is open, so the media library has nothing to import into',
      'Open the project first with studio.project.open(id); after studio.project.create, pass the id it returned.',
    )
  }

  const unique = [...new Set(paths)]
  let described: readonly AgentMediaPathFile[]
  try {
    described = await bridge.describe(unique)
  } catch (error) {
    throw importError(
      'MEDIA_UNAVAILABLE',
      `the desktop app could not open the media: ${failureMessage(error)}`,
      'Pass absolute paths of video, audio or image files that exist on this Mac.',
    )
  }

  let records: MediaMetadata[]
  try {
    records = await environment.importLinkedPaths(described, projectId)
  } catch (error) {
    throw importError(
      'MEDIA_UNAVAILABLE',
      `the import failed: ${failureMessage(error)}`,
      'Check that the files are readable video, audio or images; nothing was imported.',
    )
  }
  if (records.length !== described.length) {
    throw importError(
      'INTERNAL',
      `the library answered ${records.length} records for ${described.length} files`,
    )
  }

  // The URL is registered before the record is visible: the library re-render
  // and the preview's resolution both start from `showInLibrary`. The records
  // come back in the order the files were described.
  described.forEach((file, index) => {
    const record = records[index]
    if (record) environment.registerUrl(record.id, file.url)
  })
  environment.showInLibrary(records)

  return records.map((record) => {
    const info = environment.info(record.id)
    if (!info) {
      throw importError(
        'INTERNAL',
        `the imported record ${record.id} is not in the media library`,
      )
    }
    return info
  })
}

/** The folder of an absolute path, or null at a filesystem root. */
export function folderOfPath(filePath: string): string | null {
  const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  if (cut <= 0) return null
  const folder = filePath.slice(0, cut)
  // `C:` is not absolute on its own; its separator has to come with it.
  return folder.endsWith(':') ? `${folder}${filePath[cut]}` : folder
}

/** The path records of a library: the records the shell's route can read for this project. */
export function pathRecordsOf(items: readonly MediaMetadata[]): PathMediaRecord[] {
  const records: PathMediaRecord[] = []
  for (const item of items) {
    if (item.storageType !== 'path') continue
    if (typeof item.filePath !== 'string' || item.filePath.length === 0) continue
    records.push({ id: item.id, filePath: item.filePath })
  }
  return records
}

/**
 * Re-register the open project's path records after a restart.
 *
 * The folders are allowed first, so each file is served through its folder's
 * grant rather than a grant of its own; then every file is described and its
 * URL registered. One file that failed to come back (moved, deleted, permission
 * gone) costs only its own URL: the other records register, and the app's
 * broken-media state names the one that does not.
 */
export async function registerPathRecords(
  records: readonly PathMediaRecord[],
  environment: PathRegistrationEnvironment,
): Promise<{ folders: number; files: number; urls: number }> {
  const pending = records.filter((record) => !environment.hasUrl(record.id))
  const bridge = environment.bridge()
  if (!bridge || pending.length === 0) return { folders: 0, files: 0, urls: 0 }

  const folders = [...new Set(pending.map((record) => folderOfPath(record.filePath)))]
    .filter((folder): folder is string => folder !== null)
  try {
    if (folders.length > 0) await bridge.allow(folders)
  } catch (error) {
    // A folder that is gone (an unmounted disk) fails its files below; the rest
    // of the records still register.
    logger.warn('Allowing the path records’ folders failed:', error)
  }

  const files = [...new Set(pending.map((record) => record.filePath))]
  let entries: readonly AgentMediaPathFile[] = []
  try {
    // One call, so every URL of the project is ready after one round trip. A
    // file that did not come back (moved, deleted, permission gone) would fail
    // the whole call, so a failure falls back to naming each file on its own:
    // it costs only its own URL, the other records still register.
    entries = await bridge.describe(files)
  } catch (error) {
    logger.warn('Describing the path records failed; trying each file on its own:', error)
    const settled = await Promise.all(
      files.map(async (file) => {
        try {
          const [entry] = await bridge.describe([file])
          return entry ?? null
        } catch (fileError) {
          logger.warn(`Describing ${file} failed:`, fileError)
          return null
        }
      }),
    )
    entries = settled.filter((entry): entry is AgentMediaPathFile => entry !== null)
  }
  const urlByPath = new Map<string, string>()
  for (const entry of entries) {
    urlByPath.set(entry.path, entry.url)
  }

  let urls = 0
  for (const record of pending) {
    const url = urlByPath.get(record.filePath)
    if (!url) continue
    environment.registerUrl(record.id, url)
    // A preview that resolved the record in the milliseconds before this call
    // marked it missing; the bytes are there, and the route answers them now.
    environment.markHealthy(record.id)
    urls++
  }
  return { folders: folders.length, files: files.length, urls }
}

/**
 * The media-route URL of one path record, registered now when this launch has
 * none for it yet. A reopened project's clips are resolved as the editor
 * loads, which can be before the library's change re-registers its path
 * records (`installAgentMedia`); a clip resolved then showed as missing until
 * it was relinked (found on 19 Nov 2026). Null in the browser, and for a file
 * that did not come back (moved, deleted, its disk not mounted).
 */
export async function pathMediaUrl(record: PathMediaRecord): Promise<string | null> {
  const environment = createDefaultEnvironment(() =>
    Promise.reject(new Error('pathMediaUrl imports nothing')),
  )
  if (!environment.hasUrl(record.id)) await registerPathRecords([record], environment)
  return blobUrlManager.get(record.id) ?? null
}

/** The SDK on the page, or the error of an installer called before `installStudio()`. */
function currentStudio(): Studio {
  const page = globalThis as { studio?: Studio }
  if (!page.studio) {
    throw new Error('installAgentMedia needs window.studio: call it after installStudio()')
  }
  return page.studio
}

/** Merge newly imported records into the library, replacing a record that is already there. */
function withRecords(
  items: readonly MediaMetadata[],
  records: readonly MediaMetadata[],
): MediaMetadata[] {
  const imported = new Map(records.map((record) => [record.id, record]))
  const merged = items.map((item) => imported.get(item.id) ?? item)
  for (const record of records) {
    if (!items.some((item) => item.id === record.id)) merged.unshift(record)
  }
  return merged
}

/** The real environment: the page's stores, the library service and the shell's bridge. */
function createDefaultEnvironment(
  importHandles: MediaPathEnvironment['importHandles'],
): MediaPathEnvironment {
  return {
    bridge() {
      const bridge = getDesktopBridge() as
        | (DesktopBridge & { readonly mediaPaths?: AgentMediaPathsBridge })
        | undefined
      return bridge?.mediaPaths
    },
    currentProjectId() {
      return useMediaLibraryStore.getState().currentProjectId ?? null
    },
    importHandles,
    importLinkedPaths(sources, projectId) {
      return mediaLibraryService.importLinkedPaths(sources, projectId)
    },
    showInLibrary(records) {
      useMediaLibraryStore.setState((state) => ({
        mediaItems: withRecords(state.mediaItems, records),
        error: null,
        errorLink: null,
      }))
    },
    registerUrl(mediaId, url) {
      blobUrlManager.registerUrl(mediaId, url)
    },
    hasUrl(mediaId) {
      return blobUrlManager.has(mediaId)
    },
    markHealthy(mediaId) {
      useMediaLibraryStore.getState().markMediaHealthy(mediaId)
    },
    info(mediaId) {
      return (globalThis as { studio?: Studio }).studio?.media.get(mediaId) ?? null
    },
  }
}

/**
 * Extend the page's `studio.media.import` to accept absolute paths beside
 * handles, and keep the open project's path records playable across a restart.
 *
 * Call once, after `installStudio()`: `src/main.tsx` does, beside the other
 * agent installers. A path import needs the desktop app; in a browser the
 * handle import is unchanged, and a path is refused with `UNSUPPORTED`.
 * @example installAgentMedia()
 */
export function installAgentMedia(): void {
  if (installed) return
  const studio = currentStudio()
  const originalImport = studio.media.import.bind(studio.media)
  const environment = createDefaultEnvironment((items, options) =>
    originalImport(items as FileSystemFileHandle[], options),
  )

  // Handles keep the SDK's own route; paths go through the shell. A mixed call
  // is unusual and answers its handles first, then its paths.
  studio.media.import = (items: FileSystemFileHandle[], options?: MediaImportOptions) =>
    importMediaPaths(items as unknown, options, environment)

  let currentSignature: string | null = null
  const restore = (items: readonly MediaMetadata[]): void => {
    // Only the records still waiting for a URL: a file that was missing gets
    // another try when the library changes, and a fully registered project
    // costs nothing on the next change.
    const pending = pathRecordsOf(items).filter((record) => !environment.hasUrl(record.id))
    const signature = pending.map((record) => `${record.id}\u0000${record.filePath}`).join('\n')
    if (signature === currentSignature) return
    currentSignature = signature
    if (pending.length === 0) return
    void registerPathRecords(pending, environment).then((result) => {
      // Nothing registered (a folder still mounting): let the next library
      // change try again.
      if (result.urls === 0) currentSignature = null
      else logger.info(`Re-registered ${result.urls} path media for playback`)
    })
  }
  useMediaLibraryStore.subscribe((state) => restore(state.mediaItems))
  restore(useMediaLibraryStore.getState().mediaItems)
  installed = true
}

/**
 * The body of the wrapped `studio.media.import`: handles go to the SDK,
 * paths to the shell. Exported so the rules are testable without patching the
 * SDK object.
 */
export async function importMediaPaths(
  items: unknown,
  options: MediaImportOptions | undefined,
  environment: MediaPathEnvironment,
): Promise<MediaInfo[]> {
  if (!Array.isArray(items)) {
    // The SDK's own argument check answers, with its INVALID_ARGUMENT shape.
    return environment.importHandles(items as FileSystemFileHandle[], options)
  }
  const handles = items.filter((item): item is FileSystemFileHandle => typeof item !== 'string')
  const paths = items.filter((item): item is string => typeof item === 'string')
  if (paths.length === 0) return environment.importHandles(handles, options)

  const imported = await importNamedPaths(paths, options, environment)
  if (handles.length === 0) return imported
  return [...(await environment.importHandles(handles, options)), ...imported]
}
