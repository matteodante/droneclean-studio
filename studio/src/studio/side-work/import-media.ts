/**
 * The side work of an import, as the media library runs it (task 8.7, slice I1): the first imported clip's filmstrip and
 * motion data at interactive priority, the other clips' at import priority; proxies stay what the pilot asks for. The
 * queueing is `createImportWork` (`import-work.ts`); this file is the part that knows the library's filmstrip cache and
 * the gyro engine. Motion opens run in the scheduler's `motion` lane, bounded by the machine's memory.
 *
 * Motion data at import is an open of the clip's file on the gyro engine: the engine records the bytes its parsers read
 * into the motion cache (`src/studio/stabilization/motion-cache.ts`, OPFS), and the engine is closed straight away. The
 * next open of the clip, from the clip panel or the export, replays the trace and does not read the file again.
 * A file with no gyro data, or a build without the gyro package, is not an error: the clip simply has no motion data.
 */
import type { MediaMetadata } from '@/types/storage'
import type { ClipFile } from '@/studio/stabilization/client'
import { createLogger } from '@/shared/logging/logger'
import { useSettingsStore } from '@/features/settings/stores/settings-store'
import { getSideWork } from './index'
import { createImportWork, type ImportWork, type ImportWorkRunners } from './import-work'

const logger = createLogger('ImportSideWork')

/**
 * A freshly imported clip: its record and where its bytes are. A file the import just read has `file`; a clip linked by
 * path (the agent's import) has only the shell's media-route `url`, which is read when the work runs.
 */
export interface ImportedClip {
  media: MediaMetadata
  file?: File
  url?: string
}

/** Whether the clip carries motion data worth reading at import: a DJI file (its tags name the drone model). */
export function canStabilizeAtImport(media: MediaMetadata): boolean {
  return media.mimeType.startsWith('video/') && Boolean(media.droneModel)
}

type MotionOpener = (clip: ImportedClip) => Promise<void>

let motionOpener: MotionOpener | null = null

/**
 * The clip's file for the engine. A clip linked by path has only its media-route URL: the worker reads it there with
 * `Range`, never whole, and the record's name, size and modification time give the motion cache the key the clip panel
 * will look up.
 */
function fileOf({ media, file, url }: ImportedClip): ClipFile {
  if (file) return file
  if (!url) throw new Error(`${media.fileName} has neither a file nor a URL to read`)
  return { url, size: media.fileSize, name: media.fileName, lastModified: media.fileLastModified ?? 0 }
}

/** Opens the clip on a gyro engine of its own and closes it: the parse is cached in OPFS, no memory is held. */
async function openForMotionData(clip: ImportedClip): Promise<void> {
  if (!motionOpener) {
    const [
      { createStabilizationClient },
      { createMotionCache },
      { stabilizationDefaults },
      { toRate },
    ] = await Promise.all([
      import('@/studio/stabilization/client'),
      import('@/studio/stabilization/motion-cache'),
      import('@/studio/stabilization/settings'),
      import('@/studio/time'),
    ])
    // No memory layer: the blob is a few hundred MB and the clip panel's own client reads it from OPFS
    const client = createStabilizationClient({
      recomputeDelayMs: 0,
      motionCache: createMotionCache({ maxMemoryBytes: 0 }),
    })
    let settings: ReturnType<typeof stabilizationDefaults> | null = null
    motionOpener = async (clip) => {
      const { media } = clip
      const file = fileOf(clip)
      settings ??= { ...stabilizationDefaults(await client.smoothingMethods()), enabled: true }
      const id = `import-motion-${media.id}`
      try {
        await client.open({ id, mediaId: media.id, file, rate: toRate(media.fps) }, settings)
      } finally {
        await client.close(id).catch(() => {})
      }
    }
  }
  await motionOpener(clip)
}

/** The `StabilizationError` codes that mean "this file has nothing the engine can use" */
const NO_MOTION_DATA_CODES = new Set(['no-motion-data', 'clip-unreadable'])

const runners: ImportWorkRunners<ImportedClip> = {
  async filmstrip({ media, file, url: sourceUrl }) {
    const [{ filmstripCache }, { blobUrlManager }, { registerKeyframeIndex }] = await Promise.all([
      import('@/features/timeline/services/filmstrip-cache'),
      import('@/infrastructure/browser/blob-url-manager'),
      import('@/shared/utils/keyframe-index-registry'),
    ])
    // The URL the timeline's filmstrip would get from the media resolver, made from the file the import holds (the
    // resolver reads the library back, and the library imports this file). The registration with its metadata is what
    // the extraction worker needs to read the source.
    // A clip linked by path has the shell's media-route URL instead, registered the way the agent's import does.
    const url = file
      ? blobUrlManager.acquire(media.id, file, {
          mediaId: media.id,
          storageType: media.storageType,
          fileHandle: media.storageType === 'handle' ? media.fileHandle : undefined,
          opfsPath: media.storageType === 'opfs' ? media.opfsPath : undefined,
          fileSize: media.fileSize,
        })
      : sourceUrl
        ? blobUrlManager.registerUrl(media.id, sourceUrl)
        : null
    if (!url) return
    try {
      if (media.keyframeTimestamps && media.keyframeTimestamps.length > 0) {
        registerKeyframeIndex(url, media.keyframeTimestamps)
      }
      await filmstripCache.getFilmstrip(media.id, url, media.duration)
    } finally {
      blobUrlManager.release(media.id)
    }
  },

  async motionData(clip) {
    try {
      await openForMotionData(clip)
    } catch (error) {
      // A file with no gyro data or no lens profile is a clip without motion data, not a failure
      const code = (error as { code?: unknown } | null)?.code
      if (typeof code === 'string' && NO_MOTION_DATA_CODES.has(code)) {
        logger.debug(`${clip.media.fileName} has no motion data`)
        return
      }
      throw error
    }
  },
}

let importWork: ImportWork<ImportedClip> | null = null

function appImportWork(): ImportWork<ImportedClip> {
  importWork ??= createImportWork<ImportedClip>({
    scheduler: getSideWork(),
    runners,
    isVideo: ({ media }) => media.mimeType.startsWith('video/'),
    canStabilize: ({ media }) => canStabilizeAtImport(media),
    wantsFilmstrips: () => {
      const { showFilmstrips, enableFilmstripExtraction } = useSettingsStore.getState()
      return showFilmstrips && enableFilmstripExtraction
    },
    nameOf: ({ media }) => media.fileName,
  })
  return importWork
}

/** Queues the side work of a freshly imported clip (not a duplicate: its caches already exist) */
export function queueImportSideWork(clip: ImportedClip): void {
  appImportWork().queue(clip)
}
