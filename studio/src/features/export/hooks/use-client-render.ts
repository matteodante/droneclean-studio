/**
 * Client-side render hook
 *
 * Provides a React hook for video rendering using mediabunny.
 * Uses blob URLs directly, runs entirely in the browser with WebCodecs.
 *
 * Settings resolution (codec fallback) and worker orchestration live in
 * `../utils/render-pipeline` so this hook and the render queue runner stay in
 * lockstep.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { ExportSettings, ExtendedExportSettings } from '@/types/export'
import type { RenderProgress, ClientRenderResult, ClientCodec } from '../deps/renderer'
import {
  mapToClientSettings,
  getSupportedCodecs,
  formatBytes,
  estimateFileSize,
  getVideoBitrateForQuality,
} from '../deps/renderer'
import {
  isExtendedSettings,
  mapRequestedClientSettings,
  resolveClientSettings,
  runRender,
} from '../deps/renderer'
import { getSideWork } from '@/studio/side-work'
import type { NativeMasterFormat } from '@/studio/export/presets'
import { trySmartCopyExport } from '../utils/smart-copy'
import { convertTimelineToComposition } from '../utils/timeline-to-composition'
import { buildTranscriptSubtitleCues } from '../deps/renderer'
import { serializeSrt } from '@/shared/utils/subtitles'
import {
  chooseExportDestination,
  containerForMimeType,
  releaseTemporaryExportOutput,
  writeBlobToDestination,
  type ExportDestination,
} from '../deps/renderer'
import {
  useItemsStore,
  useKeyframesStore,
  useMarkersStore,
  useTimelineSettingsStore,
  useTransitionsStore,
} from '@/features/export/deps/timeline'
import { useProjectStore } from '@/features/export/deps/projects'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { resolveMediaUrls } from '@/features/export/deps/media-library'
import { usePlaybackStore } from '@/shared/state/playback'
import { createLogger, createOperationId } from '@/shared/logging/logger'
import { exportedFormat, trackExportFinished } from '@/studio/telemetry/usage'

const log = createLogger('Export')

/** The container each native master is written in (`EXPORT_FORMATS` of the render contract). */
const NATIVE_CONTAINERS: Record<NativeMasterFormat, 'mp4' | 'mov'> = {
  'hevc-main10': 'mp4',
  'prores-422-hq': 'mov',
}

/** What `startExport` can be asked besides the settings. */
export interface StartExportOptions {
  /**
   * Run the export through the desktop's native encoder in this format (a master preset): true 10-bit, each clip read
   * from its file on disk. The settings then carry the project's size and the bitrate; WebCodecs is not asked.
   */
  nativeFormat?: NativeMasterFormat
}

export type ClientRenderStatus =
  | 'idle'
  | 'preparing'
  | 'rendering'
  | 'encoding'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'

interface UseClientRenderReturn {
  // State
  isExporting: boolean
  progress: number
  progressMessage?: string
  renderedFrames?: number
  totalFrames?: number
  status: ClientRenderStatus
  error: string | null
  result: ClientRenderResult | null
  /** Where the finished export was saved when it went straight to a file the user chose (path or file name), else null. */
  savedTo: string | null

  // Actions
  /** Resolves `declined` when the user closed the save dialog, so nothing started; `finished` once the export ended any other way. */
  startExport: (
    settings: ExportSettings | ExtendedExportSettings,
    options?: StartExportOptions,
  ) => Promise<'finished' | 'declined'>
  cancelExport: () => void
  downloadVideo: () => void
  resetState: () => void

  // Utilities
  getSupportedCodecs: (options?: {
    resolution?: { width: number; height: number }
    quality?: ExportSettings['quality']
    bitrate?: number
  }) => Promise<ClientCodec[]>
  estimateFileSize: (settings: ExportSettings, durationSeconds: number) => string
}

export function useClientRender(): UseClientRenderReturn {
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState<string>()
  const [renderedFrames, setRenderedFrames] = useState<number>()
  const [totalFrames, setTotalFrames] = useState<number>()
  const [status, setStatus] = useState<ClientRenderStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ClientRenderResult | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const resultRef = useRef<ClientRenderResult | null>(null)

  // AbortController for cancellation
  const abortControllerRef = useRef<AbortController | null>(null)

  // An export that does not go through the render queue still holds the side-work scheduler, until it ends
  // (finished, failed, cancelled, reset or unmounted: each of them clears `isExporting`).
  useEffect(() => {
    if (!isExporting) return
    return getSideWork().hold('client-export')
  }, [isExporting])

  /**
   * Handle progress updates from the render engine
   */
  const handleProgress = useCallback((progressData: RenderProgress) => {
    setProgress(progressData.progress)
    setProgressMessage(progressData.message)
    setRenderedFrames(progressData.currentFrame)
    setTotalFrames(progressData.totalFrames)

    // Map phase to status
    switch (progressData.phase) {
      case 'preparing':
        setStatus('preparing')
        break
      case 'rendering':
        setStatus('rendering')
        break
      case 'encoding':
        setStatus('encoding')
        break
      case 'finalizing':
        setStatus('finalizing')
        break
    }
  }, [])

  /**
   * Start client-side export
   */
  const startExport = useCallback(
    async (
      settings: ExportSettings | ExtendedExportSettings,
      options?: StartExportOptions,
    ): Promise<'finished' | 'declined'> => {
      const nativeFormat = options?.nativeFormat
      const opId = createOperationId()
      const event = log.startEvent('render', opId)
      // The file the user chose, once there is one: completed at the end, thrown away on a failure or a cancel.
      let destination: ExportDestination | null = null

      /** Asks where the file goes: `unsupported` where nothing can ask (the old scratch-file route), `declined` when the user closed the dialog. */
      const chooseDestination = async (
        container: string,
        native?: true,
      ): Promise<ExportDestination | 'unsupported' | 'declined'> => {
        const choice = await chooseExportDestination({
          container,
          baseName: `export-${Date.now()}`,
          ...(native ? { native } : {}),
        })
        return choice.status === 'chosen' ? choice.destination : choice.status
      }

      /** The user closed the save dialog: nothing has started, and the dialog goes back to its settings. */
      const abandon = (): 'declined' => {
        log.event('render', { opId, outcome: 'declined' })
        setStatus('idle')
        return 'declined'
      }

      try {
        const previousResult = resultRef.current
        resultRef.current = null
        void releaseTemporaryExportOutput(previousResult)
        setIsExporting(true)
        setProgress(0)
        setProgressMessage(undefined)
        setError(null)
        setResult(null)
        setSavedTo(null)
        setStatus('preparing')

        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController()

        // Read current state from stores
        const { tracks, items } = useItemsStore.getState()
        const { transitions } = useTransitionsStore.getState()
        const { keyframes } = useKeyframesStore.getState()
        const { inPoint, outPoint } = useMarkersStore.getState()
        const { fps } = useTimelineSettingsStore.getState()

        // Get project metadata (background color and native resolution)
        const currentProject = useProjectStore.getState().currentProject
        const busAudioEq = usePlaybackStore.getState().busAudioEq
        const masterBusDb = usePlaybackStore.getState().masterBusDb
        const backgroundColor = currentProject?.metadata?.backgroundColor
        // Use PROJECT resolution for composition (transform calculations match preview)
        const projectWidth = currentProject?.metadata?.width ?? DEFAULT_PROJECT_WIDTH
        const projectHeight = currentProject?.metadata?.height ?? DEFAULT_PROJECT_HEIGHT

        const requested = mapRequestedClientSettings(settings, fps)
        // When renderWholeProject is true, ignore in/out points.
        const { exportMode, renderWholeProject } = requested
        const effectiveInPoint = renderWholeProject ? null : inPoint
        const effectiveOutPoint = renderWholeProject ? null : outPoint
        const signal = abortControllerRef.current.signal

        // A native master states its own format: the source's bytes are never copied for it.
        const smartCopy =
          nativeFormat !== undefined
            ? null
            : await trySmartCopyExport(
                {
                  settings: requested.clientSettings,
                  tracks,
                  items,
                  transitions,
                  keyframes,
                  fps,
                  width: projectWidth,
                  height: projectHeight,
                  inPoint: effectiveInPoint,
                  outPoint: effectiveOutPoint,
                  busAudioEq,
                  masterBusDb,
                },
                signal,
                handleProgress,
              )

        if (smartCopy?.result) {
          let copied = smartCopy.result
          const copyDestination = await chooseDestination(
            containerForMimeType(copied.mimeType) ?? requested.clientSettings.container,
          )
          if (copyDestination === 'declined') return abandon()
          if (copyDestination !== 'unsupported') {
            destination = copyDestination
            // The original file, as it is, goes into the file the user chose.
            const fileSize = await writeBlobToDestination(destination, copied.blob, signal)
            await destination.commit()
            setSavedTo(destination.label)
            copied = { ...copied, blob: new Blob([], { type: copied.mimeType }), fileSize, directOutput: true }
          }
          resultRef.current = copied
          setResult(copied)
          setStatus('completed')
          setProgress(100)
          trackExportFinished('dialog', 'smart-copy', exportedFormat(settings), copied.duration)
          event.set('renderPath', 'smart-copy')
          event.success({
            fileSize: copied.fileSize,
            fileSizeFormatted: formatBytes(copied.fileSize),
            duration: copied.duration,
          })
          return 'finished'
        }

        // Resolve settings + codec fallback only when an encoder is required. A native master asks WebCodecs for
        // nothing: the desktop's encoder writes it.
        const resolved =
          nativeFormat === undefined
            ? await resolveClientSettings(settings, fps)
            : { ...requested, codecFallback: undefined }
        const { codecFallback } = resolved
        let clientSettings = resolved.clientSettings
        if (codecFallback) event.set('codecFallback', codecFallback)

        // Ask where the file goes before any work starts, so a long export streams straight into it. A native
        // master's path is granted to the desktop's encoder instead, which writes (and renames) the file itself.
        let native: { format: NativeMasterFormat; path: string; bitrate: number } | undefined
        if (nativeFormat !== undefined) {
          const chosenNative = await chooseDestination(NATIVE_CONTAINERS[nativeFormat], true)
          if (chosenNative === 'declined') return abandon()
          if (chosenNative === 'unsupported' || chosenNative.nativePath === null) {
            if (chosenNative !== 'unsupported') await chosenNative.discard()
            throw new Error('A 10-bit export needs the desktop app: its FFmpeg decodes and encodes the frames')
          }
          destination = chosenNative
          native = {
            format: nativeFormat,
            path: chosenNative.nativePath,
            bitrate: Math.round(settings.videoBitrate ?? 100_000_000),
          }
        } else {
          const chosen = await chooseDestination(clientSettings.container)
          if (chosen === 'declined') return abandon()
          if (chosen !== 'unsupported') {
            destination = chosen
            clientSettings = { ...clientSettings, destination: chosen.output }
          }
        }

        const extended = isExtendedSettings(settings)
        event.merge({
          mode: exportMode,
          fps,
          tracks: tracks.length,
          items: items.length,
          inPoint: effectiveInPoint,
          outPoint: effectiveOutPoint,
          renderWholeProject,
          keyframes: keyframes?.length ?? 0,
          projectResolution: `${projectWidth}x${projectHeight}`,
          videoContainer: extended ? settings.videoContainer : undefined,
          audioContainer: extended ? settings.audioContainer : undefined,
          subtitleMode: clientSettings.subtitleMode,
          projectId: currentProject?.id,
          codec: clientSettings.codec,
          container: clientSettings.container,
          resolution: `${clientSettings.resolution.width}x${clientSettings.resolution.height}`,
        })

        // Convert timeline to Composition format (handles I/O point trimming)
        // Use PROJECT resolution so transforms match preview (will scale to export res later)
        const composition = convertTimelineToComposition(
          tracks,
          items,
          transitions,
          fps,
          projectWidth,
          projectHeight,
          effectiveInPoint,
          effectiveOutPoint,
          keyframes,
          backgroundColor,
          busAudioEq,
          masterBusDb,
        )

        const totalCompositionItems = composition.tracks.reduce(
          (sum, t) => sum + (t.items?.length ?? 0),
          0,
        )
        const compositionDuration = composition.durationInFrames ?? 0

        event.merge({
          compositionDuration: compositionDuration,
          compositionDurationSec: compositionDuration / fps,
          compositionTracks: composition.tracks.length,
          compositionItems: totalCompositionItems,
        })

        // Resolve media URLs (convert mediaIds to blob URLs)
        // Export always uses full-res source, never proxies
        const resolvedTracks = await resolveMediaUrls(composition.tracks, { useProxy: false })
        composition.tracks = resolvedTracks

        // Count resolved items for diagnostics
        let totalResolvedItems = 0
        let itemsWithSrc = 0
        let itemsMissingSrc = 0
        for (const track of resolvedTracks) {
          for (const item of track.items ?? []) {
            totalResolvedItems++
            if ('src' in item && item.src) {
              itemsWithSrc++
            } else if (
              item.type === 'video' ||
              item.type === 'audio' ||
              item.type === 'image' ||
              item.type === 'lottie'
            ) {
              itemsMissingSrc++
              log.warn('Media item missing src after resolve', {
                opId,
                itemId: item.id,
                type: item.type,
                mediaId: item.mediaId,
              })
            }
          }
        }

        event.merge({
          resolvedItems: totalResolvedItems,
          itemsWithSrc,
          itemsMissingSrc,
        })

        // Run the render (worker, with automatic main-thread fallback).
        const {
          result: renderResult,
          renderPath,
          fallbackReason,
        } = await runRender({
          clientSettings,
          exportMode,
          composition,
          signal,
          onProgress: handleProgress,
          ...(native ? { native } : {}),
        })
        if (fallbackReason) event.set('workerFallbackReason', fallbackReason)

        // Sidecar mode: the video is muxed clean; build the .srt from the same
        // (export-trimmed) composition on the main thread and attach it so the
        // dialog can offer it as a second download.
        let finalResult = renderResult
        let sidecarText: string | undefined
        if (clientSettings.subtitleMode === 'sidecar') {
          const cues = buildTranscriptSubtitleCues(composition)
          if (cues.length > 0) {
            sidecarText = serializeSrt(cues)
            // A file the user chose gets its sidecar beside it at commit; otherwise the dialog offers it as a download.
            if (!destination) {
              finalResult = {
                ...renderResult,
                subtitleSidecar: { filename: 'subtitles.srt', content: sidecarText },
              }
            }
            event.set('subtitleSidecarCues', cues.length)
          }
        }
        if (destination) {
          const savedSize = await destination.commit(
            sidecarText === undefined ? undefined : { content: sidecarText },
          )
          setSavedTo(destination.label)
          // A native export's result is empty (the encoder wrote the file): the file's own size, and no download.
          if (native) {
            finalResult = { ...finalResult, fileSize: savedSize ?? 0, directOutput: true }
          }
        }

        resultRef.current = finalResult
        setResult(finalResult)
        setStatus('completed')
        setProgress(100)

        trackExportFinished(
          'dialog',
          native ? 'native' : 'browser',
          exportedFormat(settings),
          renderResult.duration,
        )
        event.set('renderPath', renderPath)
        event.success({
          fileSize: finalResult.fileSize,
          fileSizeFormatted: formatBytes(finalResult.fileSize),
          duration: renderResult.duration,
        })
        return 'finished'
      } catch (err) {
        // Nothing is left of a failed or cancelled export, and a file of that name stays as it was.
        await destination?.discard()
        if (err instanceof DOMException && err.name === 'AbortError') {
          event.set('outcome', 'cancelled')
          event.set('duration_ms', Date.now())
          log.event('render', { opId, outcome: 'cancelled' })
          setStatus('cancelled')
        } else {
          event.failure(err)
          const message = err instanceof Error ? err.message : 'Failed to export'
          setError(message)
          setStatus('failed')
        }
        return 'finished'
      } finally {
        setIsExporting(false)
        abortControllerRef.current = null
      }
    },
    [handleProgress],
  )

  /**
   * Cancel the current export. Aborting the controller signals `runRender`,
   * which posts the cancel to its worker and terminates it.
   */
  const cancelExport = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setStatus('cancelled')
      setIsExporting(false)
    }
  }, [])

  /**
   * Download the rendered video/audio
   */
  const downloadVideo = useCallback(() => {
    // A file saved where the user chose has nothing to download.
    if (!result || result.directOutput) return

    const url = URL.createObjectURL(result.blob)
    const a = document.createElement('a')
    a.href = url

    // Determine file extension from MIME type
    let extension = 'mp4'
    const mime = result.mimeType.toLowerCase()
    if (mime.includes('webm')) extension = 'webm'
    else if (mime.includes('matroska')) extension = 'mkv'
    else if (mime.includes('quicktime') || mime.includes('mov')) extension = 'mov'
    else if (mime.includes('audio/mpeg') || mime.includes('mp3')) extension = 'mp3'
    else if (mime.includes('audio/wav') || mime.includes('wave')) extension = 'wav'
    else if (mime.includes('audio/aac') || mime.includes('adts')) extension = 'aac'

    const baseName = `export-${Date.now()}`
    a.download = `${baseName}.${extension}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // Revoke during idle — download has already started by then
    requestIdleCallback(() => URL.revokeObjectURL(url))

    // Sidecar mode: download the .srt alongside, sharing the video's base name.
    const sidecar = result.subtitleSidecar
    if (sidecar) {
      const sidecarExt = sidecar.filename.split('.').pop() ?? 'srt'
      const sidecarBlob = new Blob([sidecar.content], { type: 'text/plain;charset=utf-8' })
      const sidecarUrl = URL.createObjectURL(sidecarBlob)
      const sidecarLink = document.createElement('a')
      sidecarLink.href = sidecarUrl
      sidecarLink.download = `${baseName}.${sidecarExt}`
      document.body.appendChild(sidecarLink)
      sidecarLink.click()
      document.body.removeChild(sidecarLink)
      requestIdleCallback(() => URL.revokeObjectURL(sidecarUrl))
    }
  }, [result])

  /**
   * Reset state
   */
  const resetState = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsExporting(false)
    setProgress(0)
    setProgressMessage(undefined)
    setRenderedFrames(undefined)
    setTotalFrames(undefined)
    setStatus('idle')
    setError(null)
    setSavedTo(null)
    const previousResult = resultRef.current
    resultRef.current = null
    void releaseTemporaryExportOutput(previousResult)
    setResult(null)
  }, [])

  useEffect(
    () => () => {
      void releaseTemporaryExportOutput(resultRef.current)
      resultRef.current = null
    },
    [],
  )

  /**
   * Get supported codecs for the current resolution
   */
  const getSupportedCodecsForResolution = useCallback(
    async (options?: {
      resolution?: { width: number; height: number }
      quality?: ExportSettings['quality']
      bitrate?: number
    }) => {
      const currentProject = useProjectStore.getState().currentProject
      const width =
        options?.resolution?.width ?? currentProject?.metadata?.width ?? DEFAULT_PROJECT_WIDTH
      const height =
        options?.resolution?.height ?? currentProject?.metadata?.height ?? DEFAULT_PROJECT_HEIGHT
      const bitrate =
        options?.bitrate ??
        (options?.quality ? getVideoBitrateForQuality(options.quality) : undefined)

      const codecs = await getSupportedCodecs({ width, height, bitrate })
      return codecs
    },
    [],
  )

  /**
   * Estimate file size for given settings
   */
  const estimateFileSizeForSettings = useCallback(
    (settings: ExportSettings, durationSeconds: number) => {
      const fps = useTimelineSettingsStore.getState().fps
      const clientSettings = mapToClientSettings(settings, fps)
      const bytes = estimateFileSize(clientSettings, durationSeconds)
      return formatBytes(bytes)
    },
    [],
  )

  return {
    isExporting,
    progress,
    progressMessage,
    renderedFrames,
    totalFrames,
    status,
    error,
    result,
    savedTo,
    startExport,
    cancelExport,
    downloadVideo,
    resetState,
    getSupportedCodecs: getSupportedCodecsForResolution,
    estimateFileSize: estimateFileSizeForSettings,
  }
}
