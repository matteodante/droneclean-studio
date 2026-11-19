/**
 * The stabilization engine host (design 3.6 sections 2.2 and 2.9; review findings S3, S4, S5, S7, S8).
 *
 * One client for the page (`client.ts`) and one engine entry per (media, settings fingerprint): `stabilizationEngineKey`,
 * the key the stabilization stage and its derived size are stored under too. Clips of one file with the same settings
 * share an entry, its open, its size and its frames; a settings change is a new key, and the entry of a clip that was
 * the only user of its key MOVES to the new one in place (the client recomputes: 1 s, not a 3-6 s re-open of the file).
 *
 * What the host does: opens a clip's engine once and reports the result as data (`EngineOpenResult`: ready, no motion
 * data, no lens profile, or failed with the typed error), answers the engine's smoothing methods (the clip panel reads
 * both here, so it no longer opens the clip a second time), serves per-frame data to the stage adapter
 * (`engineState`, `frame`, `requestFrame`) and closes an engine when no clip uses it (`sync`, `release`).
 *
 * What it does not do: it never writes the project. The size the engine reports goes to the session's derived-size store,
 * written by the stage's `prepare` (S5); a failed open is a state with a retry (`open(..., { retry: true })`, or new
 * settings, which is a new key), never a sticky silent failure (S3); nothing here draws, submits or knows about tracks.
 */

import type { TimelineItem, VideoItem } from '@/types/timeline'
import { createLogger } from '@/shared/logging/logger'
import { isStabilized } from '@/studio/render/stages/predicates'
import { toRate, type Rate } from '@/studio/time'
import {
  ClipUnreadableError,
  NoLensProfileError,
  NoMotionDataError,
  createStabilizationClient,
  type ClipFile,
  type StabilizationClient,
  type StabilizationFrameData,
  type StabilizationInfo,
  type StabilizationLens,
  type StabilizationProgress,
} from './client'
import { engineSettingsOf, stabilizationEngineKey } from './engine-key'
import {
  type EngineSettings,
  type SmoothingMethod,
  type StabilizationOutputSize,
  type StabilizationSettings,
} from './settings'
import type { StabilizationAssets } from './stage'

const log = createLogger('StabilizationSeat')

/** How many source frames' data the host keeps per engine (the client's own window is 33) */
const FRAME_CACHE = 48

/** What a clip's open came to */
export type EngineOpenResult =
  /** The engine answers frames and the file has a lens profile */
  | { kind: 'ready'; info: StabilizationInfo; lens: StabilizationLens }
  /** The engine answers frames, with its default pinhole lens: the panel asks for a profile */
  | { kind: 'no-lens-profile'; info: StabilizationInfo; error: NoLensProfileError }
  /** The file carries no motion data: there is nothing to stabilize */
  | { kind: 'no-motion-data'; error: NoMotionDataError }
  /** Anything else, with the typed error the client gave (`InvalidSettingsError`, `ClipUnreadableError`, ...) */
  | { kind: 'failed'; error: Error }

/** An engine's state, synchronously, for a stage that must not await */
export type EngineState =
  /** Nobody has opened this key */
  | { status: 'absent' }
  /** The open, or a move to new settings, is under way; `settled` resolves when it is worth asking again */
  | { status: 'opening'; settled: Promise<void> }
  | { status: 'ready'; info: StabilizationInfo }
  | { status: 'failed'; error: Error }

/** Options of one open */
export interface EngineOpenOptions {
  /** The project's rate, used only when the item does not carry its source's own */
  fps?: number
  /** The open's progress; a call that joins an open under way is told its last report at once */
  onProgress?: (progress: StabilizationProgress) => void
  /** Open again when the key's last open failed (a click on Retry); without it the failure is returned as it is */
  retry?: boolean
}

/** What the host is built with; the tests replace the client and the file */
export interface StabilizationSeatOptions {
  /** The page's client; the default is `createStabilizationClient()` */
  createClient?: () => StabilizationClient
  /** The clip's source file for the engine; the default reads the media library's file, or the
   * resolved blob URL when the renderer runs in a worker (which has no workspace root) */
  loadFile?: (item: VideoItem) => Promise<ClipFile | null>
  /** The project's rate for a clip that does not carry its source's; the default reads the timeline's settings */
  projectFps?: () => number | Promise<number>
}

/** The page's host */
export interface StabilizationSeat {
  // -- the engine host ------------------------------------------------------------------------------------------------

  /**
   * Opens the clip's engine for its settings (once per key: a second call joins the first) and resolves with what the
   * open came to. A clip whose settings changed since its last call moves its engine in place when it is the key's only
   * user. Never rejects: a failure is a result.
   */
  open(item: VideoItem, options?: EngineOpenOptions): Promise<EngineOpenResult>
  /** The state of a key's engine, synchronously */
  engineState(key: string): EngineState
  /** The size the key's engine reported, once it has opened (kept across a move to other settings) */
  outputSizeOf(key: string): StabilizationOutputSize | null
  /** Resolves when the key's engine next settles (opens, fails, or finishes a move): when it is worth asking again */
  whenSettled(key: string): Promise<void>
  /** The key's data for a source frame if the host holds it */
  frame(key: string, sourceFrame: number): StabilizationFrameData | undefined
  /**
   * Starts fetching the key's data for a source frame (once) and resolves when the fetch is over; it never rejects: a
   * failure is read with `takeFrameFailure`. The engine's own window prefetches the neighbours.
   */
  requestFrame(key: string, sourceFrame: number): Promise<void>
  /** The error of the last failed fetch of a frame, once (it is forgotten as it is read) */
  takeFrameFailure(key: string, sourceFrame: number): Error | undefined
  /** The warp shader's assets for the key's lens model; once read, `loadedAssets` answers synchronously */
  stageAssets(key: string): Promise<StabilizationAssets>
  /** The assets `stageAssets` last read for the key, or `undefined` (a move to other settings forgets them) */
  loadedAssets(key: string): StabilizationAssets | undefined
  /** The engine's smoothing methods and their limits (the clip panel's form and a new clip's defaults) */
  smoothingMethods(): Promise<SmoothingMethod[]>
  /**
   * Puts a clip's settings on its engine (the clip panel calls it): the clip moves to the settings when the gesture
   * ends, and the call resolves when its frames are the new settings' (rejecting with the engine's error when it
   * refuses them). Settings with `enabled` off let the clip go. The caller stores the settings on the item itself.
   */
  setSettings(item: VideoItem, settings: StabilizationSettings): Promise<void>
  /**
   * The timeline's items as they are now: a clip the host serves that is gone, switched off or put on another media
   * lets its engine go when no other clip uses it; a clip whose settings changed has its engine moved to them. An
   * engine still opening is left alone (the clip panel opens one before the clip is switched on).
   */
  sync(items: readonly TimelineItem[]): void
  /** Closes a key's engine whoever uses it (the preparer calls it for a key no clip wants) */
  release(key: string): Promise<void>
  /** Closes a clip's claim; its engine goes when no other clip uses it */
  close(clipId: string): Promise<void>
  /** Terminates every worker (the tests use it too) */
  destroy(): void

}

/** One engine entry */
interface Entry {
  key: string
  /** The id the client knows the clip by: stable across moves */
  readonly clientId: string
  readonly mediaId: string
  /** The settings the engine was last asked for: the clip's, and the project's aspect */
  settings: EngineSettings
  /** The items that use this key */
  readonly users: Set<string>
  /** The open's or the move's outcome; `null` while one is under way */
  result: EngineOpenResult | null
  pending: Promise<EngineOpenResult>
  info: StabilizationInfo | null
  /** The warp assets last read for this engine */
  assets: StabilizationAssets | undefined
  /** Whether the client holds the clip open (a failed open closes it; a refused move leaves it) */
  engineLive: boolean
  closed: boolean
  generation: number
  progress: Set<(progress: StabilizationProgress) => void>
  lastProgress: StabilizationProgress | null
  readonly frames: Map<number, StabilizationFrameData>
  readonly inflight: Map<number, Promise<void>>
  readonly frameFailures: Map<number, Error>
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function sizeOf(info: StabilizationInfo): StabilizationOutputSize | null {
  const [width, height] = info.output
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

/** Whether a result leaves the engine answering frames */
function isUsable(result: EngineOpenResult | null): result is Extract<
  EngineOpenResult,
  { kind: 'ready' | 'no-lens-profile' }
> {
  return result?.kind === 'ready' || result?.kind === 'no-lens-profile'
}

/**
 * A file the desktop serves on its media route, described for the engine from the route's own answer: the worker
 * reads it with `Range`, never whole. Null when the route does not answer with a size.
 */
async function linkedFileAt(url: string, name: string): Promise<ClipFile | null> {
  const response = await fetch(url, { method: 'HEAD' })
  const size = Number(response.headers.get('content-length'))
  if (!response.ok || !Number.isSafeInteger(size) || size <= 0) return null
  return { url, size, name, lastModified: 0 }
}

/**
 * The clip's file for the engine, which reads it in slices and never whole.
 *
 * On the page this is the media library's own file, or, for a file the desktop links by path (which
 * has no `File` here), its media-route URL with the record's name, size and modification time. In
 * the export worker the library's workspace root does not exist (it lives in the page), so the
 * clip's resolved URL is the way in: a blob URL is fetched (the same bytes, as a Blob the worker's
 * `FileReaderSync` reads slice by slice), the media route is read with `Range`.
 */
async function loadClipFile(item: VideoItem): Promise<ClipFile | null> {
  if (item.mediaId) {
    try {
      const file = await libraryFileOf(item.mediaId)
      if (file !== undefined) return file
    } catch {
      // No workspace root here: the export worker. The clip's URL below is the way in.
    }
  }
  return item.src ? urlFileOf(item.src, item.label ?? `${item.id}.mp4`) : null
}

/** The media library's file for the clip; `undefined` when the library has no bytes for it here */
async function libraryFileOf(mediaId: string): Promise<ClipFile | null | undefined> {
  const { mediaLibraryService } = await import('@/features/media-library/services/media-library-service')
  const media = await mediaLibraryService.getMedia(mediaId)
  if (!media) return undefined
  if (media.storageType === 'path') {
    const { resolveMediaUrl } = await import('@/features/media-library/utils/media-resolver')
    const url = await resolveMediaUrl(media.id)
    if (!url) return null
    return { url, size: media.fileSize, name: media.fileName, lastModified: media.fileLastModified ?? 0 }
  }
  const file = await mediaLibraryService.getMediaFile(media)
  return file instanceof File ? file : undefined
}

/** The clip's resolved URL: a blob URL fetched as a File, the media route described for `Range` reads */
async function urlFileOf(src: string, name: string): Promise<ClipFile | null> {
  if (!src.startsWith('blob:')) return linkedFileAt(src, name)
  const response = await fetch(src)
  if (!response.ok) return null
  const blob = await response.blob()
  return new File([blob], name, { type: blob.type })
}

/** The project's rate from the timeline's settings; a page without the store (a worker) has none */
async function timelineFps(): Promise<number> {
  const { useTimelineSettingsStore } = await import(
    '@/features/timeline/stores/timeline-settings-store'
  )
  return useTimelineSettingsStore.getState().fps
}

class Seat implements StabilizationSeat {
  private readonly client: StabilizationClient
  private readonly loadFile: (item: VideoItem) => Promise<ClipFile | null>
  private readonly projectFps: () => number | Promise<number>
  private readonly entries = new Map<string, Entry>()
  /** The entry each item last used: how a settings change finds the engine to move */
  private readonly itemEntries = new Map<string, Entry>()
  private readonly waiters = new Map<string, Array<() => void>>()
  private nextClientId = 0

  constructor(options: StabilizationSeatOptions) {
    this.client = (options.createClient ?? createStabilizationClient)()
    this.loadFile = options.loadFile ?? loadClipFile
    this.projectFps = options.projectFps ?? timelineFps
  }

  // -- the host -------------------------------------------------------------------------------------------------------

  open(item: VideoItem, options: EngineOpenOptions = {}): Promise<EngineOpenResult> {
    const entry = this.ensure(item, options)
    if (!entry) {
      return Promise.resolve({
        kind: 'failed',
        error: new ClipUnreadableError('the clip has no source file or no stabilization settings'),
      })
    }
    if (options.onProgress) {
      if (entry.result === null) {
        entry.progress.add(options.onProgress)
        if (entry.lastProgress) options.onProgress(entry.lastProgress)
      }
    }
    return entry.pending
  }

  engineState(key: string): EngineState {
    const entry = this.entries.get(key)
    if (!entry) return { status: 'absent' }
    const result = entry.result
    if (result === null) return { status: 'opening', settled: entry.pending.then(() => undefined) }
    if (isUsable(result)) return { status: 'ready', info: result.info }
    return { status: 'failed', error: result.error }
  }

  outputSizeOf(key: string): StabilizationOutputSize | null {
    const info = this.entries.get(key)?.info
    return info ? sizeOf(info) : null
  }

  whenSettled(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (entry) return entry.pending.then(() => undefined)
    return new Promise((resolve) => {
      const list = this.waiters.get(key) ?? []
      list.push(resolve)
      this.waiters.set(key, list)
    })
  }

  frame(key: string, sourceFrame: number): StabilizationFrameData | undefined {
    return this.entries.get(key)?.frames.get(sourceFrame)
  }

  requestFrame(key: string, sourceFrame: number): Promise<void> {
    const entry = this.entries.get(key)
    if (!entry || !isUsable(entry.result)) return Promise.resolve()
    const known = entry.inflight.get(sourceFrame)
    if (known) return known
    const generation = entry.generation
    entry.frameFailures.delete(sourceFrame)
    const fetching: Promise<void> = this.client
      .getFrameData(entry.clientId, sourceFrame, { wait: true })
      .then(
        (frame) => {
          // A move to other settings landed meanwhile: these are the old settings' frames
          if (entry.generation !== generation || !frame) return
          entry.frames.set(sourceFrame, frame)
          while (entry.frames.size > FRAME_CACHE) {
            const oldest = entry.frames.keys().next().value
            if (oldest === undefined || oldest === sourceFrame) break
            entry.frames.delete(oldest)
          }
        },
        (error: unknown) => {
          if (entry.generation === generation) entry.frameFailures.set(sourceFrame, toError(error))
        },
      )
      .finally(() => {
        if (entry.inflight.get(sourceFrame) === fetching) entry.inflight.delete(sourceFrame)
      })
    entry.inflight.set(sourceFrame, fetching)
    return fetching
  }

  takeFrameFailure(key: string, sourceFrame: number): Error | undefined {
    const entry = this.entries.get(key)
    const error = entry?.frameFailures.get(sourceFrame)
    entry?.frameFailures.delete(sourceFrame)
    return error
  }

  async stageAssets(key: string): Promise<StabilizationAssets> {
    const entry = this.entries.get(key)
    if (!entry || !isUsable(entry.result)) {
      throw new ClipUnreadableError('the clip’s engine is not open')
    }
    const generation = entry.generation
    const assets = await this.client.stageAssets(entry.clientId)
    if (entry.generation === generation) entry.assets = assets
    return assets
  }

  loadedAssets(key: string): StabilizationAssets | undefined {
    return this.entries.get(key)?.assets
  }

  smoothingMethods(): Promise<SmoothingMethod[]> {
    return this.client.smoothingMethods()
  }

  async setSettings(item: VideoItem, settings: StabilizationSettings): Promise<void> {
    if (settings.enabled !== true) {
      await this.close(item.id)
      return
    }
    const entry = this.ensure({ ...item, stabilization: settings }, {})
    if (!entry) return
    const result = await entry.pending
    if (result.kind === 'failed') throw result.error
  }

  sync(items: readonly TimelineItem[]): void {
    if (this.itemEntries.size === 0) return
    const live = new Map(items.map((item) => [item.id, item]))
    for (const [itemId, entry] of [...this.itemEntries]) {
      // An engine still opening or moving is left alone: a probe's, or a gesture's
      if (entry.result === null) continue
      const item = live.get(itemId)
      if (item?.type === 'video' && isStabilized(item) && item.mediaId === entry.mediaId) {
        // Settings that changed since the engine was asked (an undo, a script, the panel) move it
        if (stabilizationEngineKey(item) !== entry.key) this.ensure(item, {})
        continue
      }
      this.unclaim(itemId, entry)
    }
    this.closeUnused()
  }

  async release(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (entry) await this.discard(entry, 'the clip’s engine was released')
  }

  async close(clipId: string): Promise<void> {
    const entry = this.itemEntries.get(clipId)
    if (!entry) return
    this.unclaim(clipId, entry)
    if (entry.users.size === 0 && entry.result !== null) await this.discard(entry, 'the clip was closed')
  }

  destroy(): void {
    for (const entry of this.entries.values()) entry.closed = true
    this.entries.clear()
    this.itemEntries.clear()
    this.waiters.clear()
    this.client.destroy()
  }

  // -- the entries ----------------------------------------------------------------------------------------------------

  /** The entry the item uses: the key's own, or the item's previous one moved to the key, or a new open; `null` for no file or settings */
  private ensure(item: VideoItem, options: EngineOpenOptions): Entry | null {
    const key = stabilizationEngineKey(item)
    const settings = engineSettingsOf(item)
    if (key === null || !settings || !item.mediaId) return null
    const entry = this.reusable(key, options) ?? this.successor(item, key, settings, options)
    this.claim(item.id, entry)
    return entry
  }

  /** The key's entry, unless its open failed and this open is a retry: then the failed one is let go */
  private reusable(key: string, options: EngineOpenOptions): Entry | undefined {
    const entry = this.entries.get(key)
    if (!entry || options.retry !== true || entry.result === null || isUsable(entry.result)) return entry
    void this.discard(entry, 'the clip is being opened again')
    return undefined
  }

  /** A key with no entry: the item's previous engine moved to it when it can follow, a new open otherwise */
  private successor(
    item: VideoItem,
    key: string,
    settings: EngineSettings,
    options: EngineOpenOptions,
  ): Entry {
    const prior = this.itemEntries.get(item.id)
    return prior && this.canMove(prior, item)
      ? this.move(prior, key, settings)
      : this.start(item, key, settings, options)
  }

  /** An item's engine can follow it to new settings when the item is its only user, it is the same media and the client holds it */
  private canMove(prior: Entry, item: VideoItem): boolean {
    return (
      !prior.closed &&
      prior.mediaId === item.mediaId &&
      prior.users.size === 1 &&
      prior.users.has(item.id) &&
      (prior.result === null ? prior.engineLive || prior.info === null : prior.engineLive)
    )
  }

  private claim(itemId: string, entry: Entry): void {
    const previous = this.itemEntries.get(itemId)
    if (previous && previous !== entry) previous.users.delete(itemId)
    entry.users.add(itemId)
    this.itemEntries.set(itemId, entry)
  }

  private unclaim(itemId: string, entry: Entry): void {
    entry.users.delete(itemId)
    if (this.itemEntries.get(itemId) === entry) this.itemEntries.delete(itemId)
  }

  private closeUnused(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.users.size === 0 && entry.result !== null) {
        void this.discard(entry, 'no clip uses the engine any more')
      }
    }
  }

  private newEntry(key: string, mediaId: string, settings: EngineSettings): Entry {
    this.nextClientId += 1
    return {
      key,
      clientId: `engine-${this.nextClientId}`,
      mediaId,
      settings,
      users: new Set(),
      result: null,
      pending: Promise.resolve({ kind: 'failed', error: new Error('not started') }),
      info: null,
      assets: undefined,
      engineLive: false,
      closed: false,
      generation: 0,
      progress: new Set(),
      lastProgress: null,
      frames: new Map(),
      inflight: new Map(),
      frameFailures: new Map(),
    }
  }

  /** A new entry, and its open in the background */
  private start(
    item: VideoItem,
    key: string,
    settings: EngineSettings,
    options: EngineOpenOptions,
  ): Entry {
    const entry = this.newEntry(key, item.mediaId as string, settings)
    this.entries.set(key, entry)
    entry.pending = this.runOpen(entry, item, options.fps)
    return entry
  }

  private report(entry: Entry, progress: StabilizationProgress): void {
    entry.lastProgress = progress
    for (const listener of [...entry.progress]) listener(progress)
  }

  private async runOpen(entry: Entry, item: VideoItem, fps: number | undefined): Promise<EngineOpenResult> {
    let result: EngineOpenResult
    try {
      const file = await this.loadFile(item)
      if (!file) {
        throw new ClipUnreadableError(`the media ${JSON.stringify(entry.mediaId)} has no readable file`)
      }
      if (entry.closed) throw new ClipUnreadableError('the clip was closed while it opened')
      const rate: Rate = toRate(item.sourceFps ?? fps ?? (await this.projectFps()))
      const info = await this.client.open(
        { id: entry.clientId, mediaId: entry.mediaId, file, rate },
        entry.settings,
        (progress) => this.report(entry, progress),
      )
      entry.engineLive = true
      entry.info = info
      result = await this.classify(entry, info)
    } catch (error) {
      result =
        error instanceof NoMotionDataError
          ? { kind: 'no-motion-data', error }
          : { kind: 'failed', error: toError(error) }
    }
    if (!isUsable(result)) {
      entry.engineLive = false
      void this.client.close(entry.clientId).catch(() => undefined)
      if (!entry.closed) {
        log.warn('the clip could not be opened for stabilization', {
          key: entry.key,
          error: result.error.message,
        })
      }
    }
    return this.settle(entry, result)
  }

  /** What an opened engine is: without motion data, with or without a lens profile */
  private async classify(entry: Entry, info: StabilizationInfo): Promise<EngineOpenResult> {
    if (info.orientations === 0) return { kind: 'no-motion-data', error: new NoMotionDataError() }
    try {
      return { kind: 'ready', info, lens: await this.client.lensProfile(entry.clientId) }
    } catch (error) {
      if (error instanceof NoLensProfileError) return { kind: 'no-lens-profile', info, error }
      throw error
    }
  }

  private settle(entry: Entry, result: EngineOpenResult): EngineOpenResult {
    entry.result = result
    entry.progress.clear()
    entry.lastProgress = null
    const waiting = this.waiters.get(entry.key)
    if (waiting) {
      this.waiters.delete(entry.key)
      for (const resolve of waiting) resolve()
    }
    return result
  }

  /** Moves the item's engine to new settings in place: same worker, same file read, one recompute */
  private move(entry: Entry, key: string, settings: EngineSettings): Entry {
    this.entries.delete(entry.key)
    entry.key = key
    this.entries.set(key, entry)
    entry.settings = settings
    entry.generation += 1
    entry.assets = undefined
    entry.frames.clear()
    entry.inflight.clear()
    entry.frameFailures.clear()
    const before = entry.pending
    entry.result = null
    entry.pending = before.then(async (opened) => {
      if (!isUsable(opened) && !entry.engineLive) return this.settle(entry, opened)
      let result: EngineOpenResult
      try {
        await this.client.setSettings(entry.clientId, settings)
        if (entry.closed) throw new ClipUnreadableError('the clip was closed while its settings changed')
        // The new settings may have changed the frame's size (the project's aspect): the engine says what it is now
        entry.info = this.client.infoOf(entry.clientId) ?? entry.info
        const info = entry.info
        if (info === null) throw new ClipUnreadableError('the clip’s engine has no information')
        result = await this.classify(entry, info)
      } catch (error) {
        // The client keeps the engine and the frames it had when it refuses settings
        result = { kind: 'failed', error: toError(error) }
      }
      return this.settle(entry, result)
    })
    return entry
  }

  private async discard(entry: Entry, reason: string): Promise<void> {
    if (entry.closed) return
    entry.closed = true
    entry.generation += 1
    entry.frames.clear()
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
    for (const itemId of entry.users) {
      if (this.itemEntries.get(itemId) === entry) this.itemEntries.delete(itemId)
    }
    entry.users.clear()
    try {
      await this.client.close(entry.clientId)
    } catch (error) {
      log.warn('an engine could not be closed', { reason, error: toError(error).message })
    }
  }
}

/** Creates a host; the page has one, the tests build their own */
export function createStabilizationSeat(options: StabilizationSeatOptions = {}): StabilizationSeat {
  return new Seat(options)
}

/** The timeline's items, each time they change: what the page's host is fed with */
type ItemsListener = (items: readonly TimelineItem[]) => void

/**
 * Calls `onChange` with the timeline's items each time they change; resolves with the call that
 * stops it
 */
export async function watchTimelineItems(onChange: ItemsListener): Promise<() => void> {
  const { useItemsStore } = await import('@/features/timeline/stores/items-store')
  return useItemsStore.subscribe((state, previous) => {
    if (state.items !== previous.items) onChange(state.items)
  })
}

let pageSeat: StabilizationSeat | null = null

/**
 * The page's host: one client, one engine per (media, settings), shared by preview and export. On the page it follows
 * the timeline's items (`sync`), so a deleted clip, a clip switched off and a closed project let their engines go. The
 * export worker renders a snapshot and has no timeline (nor a `document`): its engines end with the worker, which the
 * export terminates.
 */
export function stabilizationSeat(): StabilizationSeat {
  if (!pageSeat) {
    const seat = createStabilizationSeat()
    pageSeat = seat
    if (typeof document !== 'undefined') {
      watchTimelineItems((items) => seat.sync(items)).catch((error: unknown) => {
        log.warn('the stabilization host cannot follow the timeline', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }
  return pageSeat
}

/**
 * Makes `host` this realm's host. The export worker calls it before its first frame with a host that asks the page's
 * through a port (design 3.6 section 2.15, `render/export-worker/engine-relay.ts`): the export reads the engines the
 * page has open and never opens a file a second time (S7).
 */
export function installStabilizationSeat(host: StabilizationSeat): void {
  pageSeat = host
}
