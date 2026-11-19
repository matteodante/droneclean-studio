/**
 * Benchmark page for the import side-work measurement (task 8.7's measurement half).
 *
 * It is the import page (`import.ts`: the editor's own drop path, `window.benchImport`) plus, for the clips that
 * import left in the media library, the work the editor starts after an import, each through the module the editor
 * itself uses:
 *
 *  - filmstrips: `filmstripCache.getFilmstrip` (what the timeline's `use-filmstrip` calls for a visible clip);
 *  - proxies: `proxyService.generateProxy` (what the media library's "generate proxy" action calls);
 *  - motion data: `createStabilizationClient().open` (what the clip panel calls when stabilization is switched on),
 *    and its `setSettings` (the recompute after a slider);
 *  - waveforms: none. The clips have no audio track, so the editor starts no waveform job; the page reports each
 *    clip's `audioCodec` so the record shows it.
 *
 * Probing and thumbnails are part of the import call (`importMediaWithHandle`) and are timed by `import.ts`.
 * Each phase starts every clip at once and lets the editor's own queues decide what runs together, which is what a
 * pilot who asks for everything gets today. Times are relative to the start of the phase.
 */
import './import'

import { mediaLibraryService } from '@/features/media-library/services/media-library-service'
import { proxyService } from '@/features/media-library/services/proxy-service'
import { resolveMediaUrl } from '@/features/media-library/utils/media-resolver'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { getSharedProxyKey } from '@/features/media-library/utils/proxy-key'
import { filmstripCache } from '@/features/timeline/services/filmstrip-cache'
import {
  createStabilizationClient,
  type StabilizationProgress,
} from '@/studio/stabilization/client'
import { stabilizationDefaults, type StabilizationSettings } from '@/studio/stabilization/settings'
import { toRate } from '@/studio/time'
import type { MediaMetadata } from '@/types/storage'

type PhaseName = 'filmstrips' | 'proxies' | 'motion-data' | 'together'

interface ClipRun {
  fileName: string
  /** Seconds from the start of the phase to the start of this clip's work */
  startSeconds: number
  /** Seconds from the start of the phase to the end of this clip's work */
  endSeconds: number
  seconds: number
  /** What this kind of work reports about the clip */
  detail: Record<string, unknown>
  error?: string
}

interface PhaseResult {
  phase: PhaseName
  /** The kinds of work that ran inside: several for `together` */
  kinds: string[]
  seconds: number
  perClip: Array<ClipRun & { kind: string }>
  /** Seconds from the phase's start to the end of each kind's last clip */
  kindSeconds: Record<string, number>
}

const round = (value: number): number => Math.round(value * 1000) / 1000

function videoItems(): MediaMetadata[] {
  return useMediaLibraryStore
    .getState()
    .mediaItems.filter((item) => item.mimeType.startsWith('video/'))
    .sort((a, b) => a.fileName.localeCompare(b.fileName))
}

async function timed(
  origin: number,
  item: MediaMetadata,
  work: () => Promise<Record<string, unknown>>,
): Promise<ClipRun> {
  const start = performance.now()
  const times = () => {
    const end = performance.now()
    return {
      fileName: item.fileName,
      startSeconds: round((start - origin) / 1000),
      endSeconds: round((end - origin) / 1000),
      seconds: round((end - start) / 1000),
    }
  }
  try {
    const detail = await work()
    return { ...times(), detail }
  } catch (error) {
    return {
      ...times(),
      detail: {},
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** All clips at once; `getFilmstrip` queues them itself (one or two extractions, by core count). */
function filmstripWork(origin: number, items: MediaMetadata[]): Promise<ClipRun[]> {
  return Promise.all(
    items.map((item) =>
      timed(origin, item, async () => {
        // The URL the timeline's use-filmstrip gets: the resolver registers the blob with its metadata, which the
        // extraction worker needs. A bare `URL.createObjectURL` made every worker fail ("Blob URL source is not
        // registered in this worker") and sent each clip down the slow HTMLVideoElement fallback.
        const url = await resolveMediaUrl(item.id)
        if (!url) throw new Error('no blob URL for the clip')
        try {
          const filmstrip = await filmstripCache.getFilmstrip(item.id, url, item.duration)
          return {
            frames: filmstrip.frames.length,
            isComplete: filmstrip.isComplete,
          }
        } finally {
          blobUrlManager.release(item.id)
        }
      }),
    ),
  )
}

/** All clips at once; `proxyService` runs one job at a time and keeps the rest queued. */
function proxyWork(origin: number, items: MediaMetadata[]): Promise<ClipRun[]> {
  return Promise.all(
    items.map((item) =>
      timed(origin, item, async () => {
        const proxyKey = getSharedProxyKey(item)
        const status = await new Promise<'ready' | 'error'>((resolve) => {
          proxyService.generateProxy(
            item.id,
            async () => mediaLibraryService.getMediaFile(item.id),
            item.width,
            item.height,
            proxyKey,
            { onSettled: resolve },
          )
        })
        if (status !== 'ready') throw new Error('the proxy failed')
        const url = proxyService.getProxyBlobUrl(item.id, proxyKey)
        const proxyBytes = url ? (await (await fetch(url)).blob()).size : null
        return { proxyBytes }
      }),
    ),
  )
}

async function motionSettings(
  client: ReturnType<typeof createStabilizationClient>,
): Promise<{ settings: StabilizationSettings; engineStartSeconds: number }> {
  const start = performance.now()
  const methods = await client.smoothingMethods()
  return {
    settings: { ...stabilizationDefaults(methods), enabled: true },
    engineStartSeconds: round((performance.now() - start) / 1000),
  }
}

/**
 * The clips' motion data, one clip after another, each on an engine of its own that is closed afterwards: the way a
 * pilot works through clips with stabilization (six engines at once would hold about 10 GB). The engine reads and
 * smooths in a worker; the editor does not cache what it read (finding S7).
 */
async function motionWork(origin: number, items: MediaMetadata[]): Promise<ClipRun[]> {
  const client = createStabilizationClient({ recomputeDelayMs: 0 })
  const runs: ClipRun[] = []
  try {
    const { settings } = await motionSettings(client)
    for (const item of items) {
      runs.push(
        await timed(origin, item, async () => {
          const file = (await mediaLibraryService.getMediaFile(item.id)) as File | null
          if (!file) throw new Error('no file for the clip')
          const clipId = `bench-motion-${item.id}`
          try {
            const recorder = phaseRecorder(performance.now())
            const info = await client.open(
              { id: clipId, mediaId: item.id, file, rate: toRate(item.fps) },
              settings,
              recorder.onProgress,
            )
            return {
              readSeconds: recorder.readSeconds(),
              bytesRead: info.bytes_read,
              fileBytes: item.fileSize,
              orientations: info.orientations,
              smoothedOrientations: info.smoothed_orientations,
              frames: info.frames,
              lens: info.lens,
            }
          } finally {
            await client.close(clipId)
          }
        }),
      )
    }
  } finally {
    client.destroy()
  }
  return runs
}

/** One clip's engine opened, then three settings changes: the recompute a slider causes (no file read). */
async function motionRecompute(mediaId: string): Promise<Record<string, unknown>> {
  const item = videoItems().find((candidate) => candidate.id === mediaId)
  if (!item) throw new Error(`no media ${mediaId}`)
  const client = createStabilizationClient({ recomputeDelayMs: 0 })
  try {
    const { settings, engineStartSeconds } = await motionSettings(client)
    const file = (await mediaLibraryService.getMediaFile(item.id)) as File
    const clipId = `bench-recompute-${item.id}`
    const openStart = performance.now()
    const recorder = phaseRecorder(openStart)
    const info = await client.open(
      { id: clipId, mediaId: item.id, file, rate: toRate(item.fps) },
      settings,
      recorder.onProgress,
    )
    const openSeconds = round((performance.now() - openStart) / 1000)
    const recomputeSeconds: number[] = []
    for (const fov of [1.1, 1.0, 1.2]) {
      const start = performance.now()
      await client.setSettings(clipId, { ...settings, fov })
      recomputeSeconds.push(round((performance.now() - start) / 1000))
    }
    await client.close(clipId)
    return {
      fileName: item.fileName,
      engineStartSeconds,
      openSeconds,
      readSeconds: recorder.readSeconds(),
      bytesRead: info.bytes_read,
      recomputeSeconds,
    }
  } finally {
    client.destroy()
  }
}

/** Records when `open` says it has finished reading and starts smoothing: the read and the compute apart. */
function phaseRecorder(start: number): {
  onProgress: (progress: StabilizationProgress) => void
  readSeconds: () => number | null
} {
  let smoothingAt: number | null = null
  return {
    onProgress: (progress) => {
      if (progress.phase === 'smoothing' && smoothingAt === null) smoothingAt = performance.now()
    },
    readSeconds: () => (smoothingAt === null ? null : round((smoothingAt - start) / 1000)),
  }
}

function lastEnd(runs: ClipRun[]): number {
  return runs.reduce((latest, run) => Math.max(latest, run.endSeconds), 0)
}

async function runPhase(phase: PhaseName, clipLimit?: number): Promise<PhaseResult> {
  const items = videoItems().slice(0, clipLimit)
  const origin = performance.now()
  const kinds: Record<string, Promise<ClipRun[]>> = {}
  if (phase === 'filmstrips' || phase === 'together')
    kinds.filmstrips = filmstripWork(origin, items)
  if (phase === 'proxies' || phase === 'together') kinds.proxies = proxyWork(origin, items)
  if (phase === 'motion-data' || phase === 'together')
    kinds['motion-data'] = motionWork(origin, items)
  const names = Object.keys(kinds)
  const results = await Promise.all(names.map((name) => kinds[name]!))
  const seconds = round((performance.now() - origin) / 1000)
  const kindSeconds: Record<string, number> = {}
  const perClip: PhaseResult['perClip'] = []
  names.forEach((name, index) => {
    kindSeconds[name] = round(lastEnd(results[index]!))
    for (const run of results[index]!) perClip.push({ ...run, kind: name })
  })
  return { phase, kinds: names, seconds, perClip, kindSeconds }
}

const sideWorkApi = {
  ready: true as const,
  clips: () =>
    videoItems().map((item) => ({
      id: item.id,
      fileName: item.fileName,
      fileSize: item.fileSize,
      duration: item.duration,
      fps: item.fps,
      width: item.width,
      height: item.height,
      codec: item.codec,
      audioCodec: item.audioCodec ?? null,
    })),
  runPhase,
  motionRecompute,
  filmstripMetrics: () => structuredClone(filmstripCache.getMetricsSnapshot()),
  hardwareConcurrency: () => navigator.hardwareConcurrency,
}
type SideWorkApi = typeof sideWorkApi
;(window as unknown as { benchSideWork: SideWorkApi }).benchSideWork = sideWorkApi
