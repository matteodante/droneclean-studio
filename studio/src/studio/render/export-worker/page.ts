// The page's half of the export worker (design 3.6 section 2.15, task 8.3). Before the worker's first frame the page
// prepares what only the page has: the derived sizes it knows, the media records of the composition's media (the
// worker's media library is empty), the files behind the composition's `blob:` URLs (FreeCut's decoders open a
// `blob:` URL in a worker only from its own object-URL registry, and without it a plain clip renders black), and its
// stabilization host, served to the worker over a port so the export reads the engines the page already opened. While the worker renders, the page only relays the engines' answers and the
// progress; when it ends, the page turns the worker's answer back into the same named error, records the worker's
// stage marks on its own timeline, and closes the port.
//
// FreeCut's `render-pipeline.ts` calls `openWorkerExport` before it posts `start`, and the session it gets back on
// every way out (complete, error, cancel). For a native 10-bit export it also prepares the export's paths, encode job
// and decode relay (`native-export.ts`), which the session's `close` cancels unless the export completed.

import {
  getObjectUrlBlob,
  getObjectUrlSourceMetadata,
} from '@/infrastructure/browser/object-url-registry'
import {
  stabilizationEngineKey,
  stabilizationProjectAspect,
} from '@/studio/stabilization/engine-key'
import type { StabilizationSeat } from '@/studio/stabilization/seat'
import { derivedSizeKey, type DerivedSizeStore } from '@/studio/render/stages/derived-sizes'
import { isStabilized } from '@/studio/render/stages/predicates'
import type { Size } from '@/studio/render/stages/types'
import { MARK_PREFIX, stageTimingsEnabled } from '@/studio/render/timings'
import type { CompositionInputProps } from '@/types/export'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { sendProjectMix } from '@/studio/export/native-audio'
import { serveStabilizationHost } from './engine-relay'
import {
  openNativeExport,
  preloadNativeShell,
  type NativeExportOpening,
  type NativeExportTarget,
  type NativeShellBridge,
} from './native-export'
import {
  failureFromWorker,
  type StudioCompleteResponse,
  type StudioErrorResponse,
  type WorkerExportStart,
  type WorkerObjectUrl,
  type WorkerTimings,
} from './protocol'

/** The composition's own items (a composition with sub-compositions renders on the page: FreeCut's refusal) */
function itemsOf(composition: CompositionInputProps): TimelineItem[] {
  return (composition.tracks ?? []).flatMap((track) => track.items ?? [])
}

function stabilizedClips(items: readonly TimelineItem[]): VideoItem[] {
  return items.filter((item): item is VideoItem => item.type === 'video' && isStabilized(item))
}

/** The derived sizes the page knows for these items' staged clips, as `[derivedSizeKey, size]` entries */
export function snapshotDerivedSizes(
  items: readonly TimelineItem[],
  sizes: DerivedSizeStore,
): Array<[string, Size]> {
  const entries = new Map<string, Size>()
  for (const item of stabilizedClips(items)) {
    const key = stabilizationEngineKey(item)
    if (key === null) continue
    const derived = derivedSizeKey('stabilize', key)
    const size = sizes.get(derived)
    if (size !== undefined) entries.set(derived, { width: size.width, height: size.height })
  }
  return [...entries]
}

/**
 * The media records of the media these items use, as the worker's media library needs them (codec lookups, a clip's
 * size when it does not carry its own). The file handle stays on the page: the worker reads the resolved URLs.
 */
export function snapshotMedia(
  items: readonly TimelineItem[],
  mediaById: Readonly<Record<string, MediaMetadata | undefined>>,
): MediaMetadata[] {
  const records: MediaMetadata[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const mediaId = 'mediaId' in item ? item.mediaId : undefined
    if (typeof mediaId !== 'string' || seen.has(mediaId)) continue
    seen.add(mediaId)
    const media = mediaById[mediaId]
    if (media === undefined) continue
    const { fileHandle: _handle, ...record } = media
    records.push(record)
  }
  return records
}

/** Every `blob:` URL anywhere in the composition: the clips' sources, a cleaned clip's pieces, an image's file */
export function blobUrlsOf(composition: CompositionInputProps): string[] {
  const found = new Set<string>()
  const seen = new Set<object>()
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('blob:')) found.add(value)
      return
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value)
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child)
  }
  walk(composition)
  return [...found]
}

/** The files behind these URLs, as the page's object-URL registry holds them; a URL it does not hold is left out */
export function snapshotObjectUrls(
  urls: readonly string[],
  lookup: PageSources['objectUrl'],
): WorkerObjectUrl[] {
  const entries: WorkerObjectUrl[] = []
  for (const url of urls) {
    const entry = lookup(url)
    if (entry !== null) entries.push({ url, ...entry })
  }
  return entries
}

/** Records the worker's stage marks on the page's timeline, moved from the worker's clock to the page's */
export function recordWorkerTimings(timings: WorkerTimings): void {
  const offset = timings.timeOrigin - performance.timeOrigin
  for (const mark of timings.marks) {
    if (!mark.name.startsWith(MARK_PREFIX)) continue
    const start = mark.startTime + offset
    try {
      performance.measure(mark.name, {
        start,
        end: start + mark.duration,
        ...(mark.detail === null ? {} : { detail: mark.detail }),
      })
    } catch {
      // A mark the page's timeline refuses is never worth a failed export
    }
  }
}

/** What the page holds while the worker renders */
export interface WorkerExportSession {
  /** The `studio` field of the start message */
  readonly start: WorkerExportStart
  /** What the start message transfers (the host's port) */
  readonly transfer: Transferable[]
  /** The worker finished: its marks join the page's timeline */
  completed(response: StudioCompleteResponse): void
  /** The worker failed: the error the export rejects with, named as the worker's was */
  failed(response: StudioErrorResponse): Error
  /** Stops serving the host and closes its port; called on every way out */
  close(): void
}

/** What `openWorkerExport` reads from the page; the tests give their own */
export interface PageSources {
  derivedSizes(): Promise<DerivedSizeStore>
  mediaById(): Promise<Readonly<Record<string, MediaMetadata | undefined>>>
  stabilizationHost(): Promise<StabilizationSeat>
  /** The file the page's object-URL registry holds for a `blob:` URL, or `null` */
  objectUrl(url: string): Omit<WorkerObjectUrl, 'url'> | null
  /** The desktop shell's members a native 10-bit export uses; only asked for one */
  nativeShell?(): NativeShellBridge
  /** Mixes the project's sound into the shell for a native export's job; `false` when the project has none */
  nativeAudio?(composition: CompositionInputProps, jobId: string): Promise<boolean>
}

const PAGE_SOURCES: PageSources = {
  async derivedSizes() {
    return (await import('@/studio/render/stages/staged-size')).derivedSizes
  },
  async mediaById() {
    const { useMediaLibraryStore } = await import(
      '@/features/media-library/stores/media-library-store'
    )
    return useMediaLibraryStore.getState().mediaById
  },
  async stabilizationHost() {
    return (await import('@/studio/stabilization/seat')).stabilizationSeat()
  },
  objectUrl(url) {
    const blob = getObjectUrlBlob(url)
    if (blob === null) return null
    const metadata = getObjectUrlSourceMetadata(url)
    return metadata === null ? { blob } : { blob, metadata }
  },
  nativeShell: preloadNativeShell,
  async nativeAudio(composition, jobId) {
    return (await sendProjectMix(composition, { jobId })) !== null
  },
}

/**
 * Prepares the page's part of one worker export of `composition`; with `native`, of a native 10-bit export into that
 * file (rejects with a `SourceError` for a clip that has no file on disk, before anything renders).
 */
export async function openWorkerExport(
  composition: CompositionInputProps,
  sources: PageSources = PAGE_SOURCES,
  native?: NativeExportTarget,
): Promise<WorkerExportSession> {
  const items = itemsOf(composition)
  const [sizes, mediaById] = await Promise.all([sources.derivedSizes(), sources.mediaById()])
  let stopHost: (() => void) | null = null
  let engines: MessagePort | null = null
  if (stabilizedClips(items).length > 0) {
    const channel = new MessageChannel()
    stopHost = serveStabilizationHost(channel.port1, await sources.stabilizationHost())
    engines = channel.port2
  }
  let nativeExport: NativeExportOpening | null = null
  if (native !== undefined) {
    try {
      const shell = (sources.nativeShell ?? preloadNativeShell)()
      const nativeAudio = sources.nativeAudio ?? PAGE_SOURCES.nativeAudio
      nativeExport = await openNativeExport(composition, native, mediaById, shell, {
        relay: true,
        ...(nativeAudio === undefined
          ? {}
          : { sendAudio: (jobId: string) => nativeAudio.call(sources, composition, jobId) }),
      })
    } catch (error) {
      stopHost?.()
      throw error
    }
  }
  return {
    start: {
      projectFps: composition.fps,
      projectFrame: stabilizationProjectAspect() ?? null,
      derivedSizes: snapshotDerivedSizes(items, sizes),
      media: snapshotMedia(items, mediaById),
      objectUrls: snapshotObjectUrls(blobUrlsOf(composition), sources.objectUrl),
      engines,
      timings: stageTimingsEnabled(),
      ...(nativeExport === null ? {} : { native: nativeExport.plan }),
    },
    transfer: [...(engines === null ? [] : [engines]), ...(nativeExport?.transfer ?? [])],
    completed(response) {
      nativeExport?.completed()
      if (response.timings !== undefined) recordWorkerTimings(response.timings)
    },
    failed(response) {
      return failureFromWorker(response.failure, response.error)
    },
    close() {
      stopHost?.()
      stopHost = null
      nativeExport?.close()
    },
  }
}
