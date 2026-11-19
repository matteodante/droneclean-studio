/**
 * Shared render pipeline core.
 *
 * Extracted from `use-client-render.ts` so both the single-export dialog flow
 * and the render queue runner resolve settings and drive the export worker the
 * exact same way (one source of truth for codec fallback + worker/main-thread
 * orchestration).
 *
 *  - `resolveClientSettings()` maps UI settings → ClientExportSettings, applies
 *    the container override, and falls back to a supported codec when the
 *    requested one can't be encoded here (identical to the in-app export).
 *  - `runRender()` runs one composition in the export worker, transparently
 *    falling back to the main thread for compositions the worker can't handle
 *    (animated images, no OfflineAudioContext). It owns one worker per call and
 *    always terminates it.
 */

import type { ExportSettings, ExtendedExportSettings, CompositionInputProps } from '@/types/export'
import { createManagedWorker } from '@/shared/utils/managed-worker'
import type {
  ClientExportSettings,
  ClientRenderResult,
  RenderProgress,
  ClientCodec,
  ClientVideoContainer,
  ClientAudioContainer,
} from './client-renderer'
import {
  mapToClientSettings,
  validateSettings,
  getSupportedCodecs,
  getDefaultAudioCodec,
  getAudioBitrateForQuality,
  getPreferredContainerForCodec,
  selectFallbackVideoCodec,
} from './client-renderer'
import { renderAudioOnly, renderComposition } from './canvas-render-orchestrator'
import { openWorkerExport } from '@/studio/render/export-worker/page'
import type { NativeExportTarget } from '@/studio/render/export-worker/native-export'
import type {
  StudioWorkerRequest,
  StudioWorkerResponse,
} from '@/studio/render/export-worker/protocol'

/** Narrow ExportSettings to the extended variant (has a `mode`). */
export function isExtendedSettings(
  settings: ExportSettings | ExtendedExportSettings,
): settings is ExtendedExportSettings {
  return 'mode' in settings
}

export interface ResolvedClientSettings {
  clientSettings: ClientExportSettings
  exportMode: 'video' | 'audio'
  renderWholeProject: boolean
  /** The supported codec we fell back to, if the requested one was unavailable. */
  codecFallback?: ClientCodec
}

/** Map the requested UI settings without probing encoder support. */
export function mapRequestedClientSettings(
  settings: ExportSettings | ExtendedExportSettings,
  fps: number,
): Omit<ResolvedClientSettings, 'codecFallback'> {
  const extended = isExtendedSettings(settings)
  const exportMode = extended ? settings.mode : 'video'
  const videoContainer = extended ? settings.videoContainer : undefined
  const audioContainer = extended ? settings.audioContainer : undefined
  const subtitleMode = extended ? (settings.subtitleMode ?? 'burn') : 'burn'
  const renderWholeProject = extended ? (settings.renderWholeProject ?? false) : false
  const clientSettings = mapToClientSettings(settings, fps)

  if (exportMode === 'video' && videoContainer) {
    clientSettings.container = videoContainer as ClientVideoContainer
  } else if (exportMode === 'audio' && audioContainer) {
    clientSettings.container = audioContainer as ClientAudioContainer
    clientSettings.mode = 'audio'
    clientSettings.audioCodec = getDefaultAudioCodec(audioContainer)
    clientSettings.audioBitrate = getAudioBitrateForQuality(settings.quality)
  }

  clientSettings.mode = exportMode
  clientSettings.subtitleMode = exportMode === 'video' ? subtitleMode : 'off'

  return { clientSettings, exportMode, renderWholeProject }
}

/**
 * Map UI export settings to ClientExportSettings, applying the container
 * override and codec fallback. Throws if no supported video codec exists.
 *
 * `getSupportedCodecs` probes WebCodecs, so this is async — call it once at
 * enqueue/start time, not per frame.
 */
export async function resolveClientSettings(
  settings: ExportSettings | ExtendedExportSettings,
  fps: number,
): Promise<ResolvedClientSettings> {
  const extended = isExtendedSettings(settings)
  const videoContainer = extended ? settings.videoContainer : undefined
  const { clientSettings, exportMode, renderWholeProject } = mapRequestedClientSettings(
    settings,
    fps,
  )

  let codecFallback: ClientCodec | undefined

  // Validate + check codec support (skip video codec validation for audio-only).
  if (exportMode === 'video') {
    const validation = validateSettings(clientSettings)
    if (!validation.valid) throw new Error(validation.error)

    const supportedCodecs = await getSupportedCodecs({
      width: clientSettings.resolution.width,
      height: clientSettings.resolution.height,
      bitrate: clientSettings.videoBitrate,
    })

    if (!supportedCodecs.includes(clientSettings.codec)) {
      const containerFallback = selectFallbackVideoCodec(
        supportedCodecs,
        clientSettings.container as ClientVideoContainer,
      )

      if (containerFallback) {
        clientSettings.codec = containerFallback
        codecFallback = containerFallback
      } else if (videoContainer) {
        throw new Error(
          `The selected ${videoContainer.toUpperCase()} format is not supported in this browser. ` +
            `Try a different format or codec.`,
        )
      } else {
        const browserFallback = selectFallbackVideoCodec(supportedCodecs)
        if (!browserFallback) {
          throw new Error('No supported video codecs available in this browser')
        }
        clientSettings.codec = browserFallback
        clientSettings.container = getPreferredContainerForCodec(browserFallback)
        codecFallback = browserFallback
      }

      const postFallbackValidation = validateSettings(clientSettings)
      if (!postFallbackValidation.valid) {
        throw new Error(postFallbackValidation.error)
      }
    }
  }

  return { clientSettings, exportMode, renderWholeProject, codecFallback }
}

export interface RunRenderArgs {
  clientSettings: ClientExportSettings
  exportMode: 'video' | 'audio'
  composition: CompositionInputProps
  signal: AbortSignal
  onProgress: (progress: RenderProgress) => void
  /** A native 10-bit export into this file (desktop app only): the worker renders it, never the main thread */
  native?: NativeExportTarget
}

export interface RunRenderOutcome {
  result: ClientRenderResult
  renderPath: 'worker' | 'main-thread'
  /** Worker error message that triggered the main-thread fallback, if any. */
  fallbackReason?: string
}

type ExportWorkerManager = ReturnType<typeof createManagedWorker<Worker>>

async function renderInWorker(
  workerManager: ExportWorkerManager,
  clientSettings: ClientExportSettings,
  composition: CompositionInputProps,
  signal: AbortSignal,
  onProgress: (progress: RenderProgress) => void,
  native?: NativeExportTarget,
): Promise<ClientRenderResult> {
  if (typeof Worker === 'undefined') {
    throw new Error('WORKER_UNAVAILABLE')
  }
  // What the stage pipeline needs from the page: derived sizes, media, the stabilization host (design 3.6 §2.15)
  const studio = await openWorkerExport(composition, undefined, native)

  return new Promise<ClientRenderResult>((resolve, reject) => {
    if (signal.aborted) {
      studio.close()
      reject(new DOMException('Render cancelled', 'AbortError'))
      return
    }

    const requestId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const worker = workerManager.getWorker()

    const onAbort = () => {
      const cancelMessage: StudioWorkerRequest = { type: 'cancel', requestId }
      worker.postMessage(cancelMessage)
    }
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      studio.close()
    }

    signal.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (event: MessageEvent<StudioWorkerResponse>) => {
      const response = event.data
      if (response.requestId !== requestId) return

      switch (response.type) {
        case 'progress':
          onProgress(response.progress)
          break
        case 'complete':
          studio.completed(response)
          cleanup()
          resolve(response.result)
          break
        case 'cancelled':
          cleanup()
          reject(new DOMException('Render cancelled', 'AbortError'))
          break
        case 'error':
          cleanup()
          reject(studio.failed(response))
          break
      }
    }

    worker.onerror = (event: ErrorEvent) => {
      cleanup()
      const location = event.filename ? ` @${event.filename}:${event.lineno}:${event.colno}` : ''
      reject(new Error(`EXPORT_WORKER_RUNTIME_ERROR:${event.message}${location}`))
    }

    const startMessage: StudioWorkerRequest = {
      type: 'start',
      requestId,
      settings: clientSettings,
      composition,
      studio: studio.start,
    }
    worker.postMessage(startMessage, studio.transfer)
  })
}

function renderOnMainThread(
  exportMode: 'video' | 'audio',
  clientSettings: ClientExportSettings,
  composition: CompositionInputProps,
  signal: AbortSignal,
  onProgress: (progress: RenderProgress) => void,
): Promise<ClientRenderResult> {
  if (exportMode === 'audio') {
    return renderAudioOnly({ settings: clientSettings, composition, onProgress, signal })
  }
  return renderComposition({ settings: clientSettings, composition, onProgress, signal })
}

/**
 * Render one composition. Prefers the export worker; falls back to the main
 * thread for compositions the worker can't handle. Owns a single worker for
 * the call and always terminates it. Re-throws AbortError on cancellation.
 */
export async function runRender({
  clientSettings,
  exportMode,
  composition,
  signal,
  onProgress,
  native,
}: RunRenderArgs): Promise<RunRenderOutcome> {
  const workerManager = createManagedWorker<Worker>({
    createWorker: () =>
      new Worker(new URL('./workers/export-render.worker.ts', import.meta.url), {
        type: 'module',
      }),
    setupWorker: (worker) => () => {
      worker.onmessage = null
      worker.onerror = null
    },
  })

  try {
    const result = await renderInWorker(
      workerManager,
      clientSettings,
      composition,
      signal,
      onProgress,
      native,
    )
    return { result, renderPath: 'worker' }
  } catch (workerError) {
    if (workerError instanceof DOMException && workerError.name === 'AbortError') {
      throw workerError
    }

    const workerMessage = workerError instanceof Error ? workerError.message : String(workerError)
    const shouldFallbackToMainThread =
      workerMessage.startsWith('WORKER_REQUIRES_MAIN_THREAD:') ||
      workerMessage.startsWith('WORKER_UNAVAILABLE') ||
      workerMessage.startsWith('EXPORT_WORKER_RUNTIME_ERROR:')

    // A native export's encode job and its save-dialog grant are spent: it never re-renders elsewhere
    if (!shouldFallbackToMainThread || native !== undefined) throw workerError

    const result = await renderOnMainThread(
      exportMode,
      clientSettings,
      composition,
      signal,
      onProgress,
    )
    return { result, renderPath: 'main-thread', fallbackReason: workerMessage }
  } finally {
    workerManager.terminate()
  }
}
