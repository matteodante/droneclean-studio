/**
 * Benchmark page of the `long-export` measurement (task 3.5): a timeline of several clips end to end, exported
 * through the app's own path (`mapRequestedClientSettings`, `resolveClientSettings`, `convertTimelineToComposition`,
 * `resolveMediaUrls`, `runRender`: the calls `use-client-render.ts` makes). It is a page of its own so that the
 * one-clip page (`main.ts`) stays as it is. The driver (`bench/measurements/long-export.mjs`) calls `window.longExport`
 * and watches `progress()` and `abort()` while the export runs: the page records nothing itself.
 */
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import type { ExtendedExportSettings } from '@/types/export'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { RenderProgress } from '@/runtime/renderer/client-renderer'

import { CURRENT_SCHEMA_VERSION } from '@/shared/projects/migrations'
import { validateProject } from '@/features/project-bundle/schemas/project-schema'
import { mediaProcessorService } from '@/features/media-library/services/media-processor-service'
import { getMimeType, validateMediaFileContent } from '@/features/media-library/utils/validation'
import { resolveMediaUrls } from '@/features/media-library/utils/media-resolver'
import { convertTimelineToComposition } from '@/features/export/utils/timeline-to-composition'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { releaseTemporaryExportOutput } from '@/runtime/renderer/export-output-target'
import { chooseExportDestination, type ExportDestination } from '@/studio/export-file/destination'
import {
  mapRequestedClientSettings,
  resolveClientSettings,
  runRender,
} from '@/runtime/renderer/render-pipeline'
import type { ClientRenderResult } from '@/runtime/renderer/client-renderer'
import { editProject } from '@/headless/edit'
import { seedMediaLibrary } from '@/headless/seed-media'

interface ClipInput {
  mediaId: string
  url: string
  fileName: string
}

interface PrepareInput {
  project: { width: number; height: number; fps: number }
  clips: ClipInput[]
  /** Export only the first frames of the timeline (an in point of 0 and this out point); null for all of it. */
  limitFrames: number | null
}

interface Session {
  project: Project
  tracks: TimelineTrack[]
  items: TimelineItem[]
  totalFrames: number
  exportFrames: number
  limitFrames: number | null
  lastResult: ClientRenderResult | null
}

const SCRATCH_DIR = 'freecut-export-output'

/**
 * Where the export goes: `download` is the old route (a scratch file in the browser's storage, then a blob download),
 * `desktop` is the desktop shell's own save dialog and file (task 3.5; the driver answers the dialog), and `file-handle`
 * is the web build's route with an OPFS file standing in for the file a save picker returns.
 */
type DestinationKind = 'download' | 'desktop' | 'file-handle'

let session: Session | null = null
let controller: AbortController | null = null
const progressState = { phase: 'idle', frame: 0, totalFrames: 0, at: 0 }

async function copyToOpfs(url: string, fileName: string): Promise<File> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Media fetch failed: HTTP ${response.status}`)
  const root = await navigator.storage.getDirectory()
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-160)
  const handle = await root.getFileHandle(`bench-${crypto.randomUUID()}-${safe}`, { create: true })
  const writable = await handle.createWritable()
  await response.body.pipeTo(writable)
  return handle.getFile()
}

async function importMedia(clip: ClipInput): Promise<MediaMetadata> {
  const file = await copyToOpfs(clip.url, clip.fileName)
  const validation = await validateMediaFileContent(file)
  if (!validation.valid) throw new Error(validation.error ?? 'Media validation failed')
  const mimeType = getMimeType(file)
  const { metadata } = await mediaProcessorService.processMedia(file, mimeType, {
    generateThumbnail: false,
    fastMetadata: true,
  })
  const now = Date.now()
  const full = {
    ...metadata,
    id: clip.mediaId,
    storageType: 'workspace',
    fileName: clip.fileName,
    fileSize: file.size,
    fileLastModified: file.lastModified,
    mimeType,
    tags: [],
    createdAt: now,
    updatedAt: now,
  } as MediaMetadata
  blobUrlManager.acquire(clip.mediaId, file)
  seedMediaLibrary([{ metadata: full }])
  return full
}

function newProject(width: number, height: number, fps: number): Project {
  const now = Date.now()
  const validated = validateProject({
    id: crypto.randomUUID(),
    name: 'bench-long-export',
    description: '',
    createdAt: now,
    updatedAt: now,
    duration: 0,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: { width, height, fps },
  })
  if (!validated.success || !validated.data) throw new Error('bench project failed validation')
  return validated.data as Project
}

function endOfTimeline(project: Project): number {
  return ((project.timeline?.items ?? []) as unknown as TimelineItem[]).reduce(
    (end, item) => Math.max(end, item.from + item.durationInFrames),
    0,
  )
}

/**
 * Copy each clip into the browser's storage, import it the way the app does and place it after the one before.
 * Each clip carries a +0.01 dB gain (the clips have no audio) so that no shortcut replaces the render.
 */
async function prepare(input: PrepareInput) {
  let project = newProject(input.project.width, input.project.height, input.project.fps)
  const placed: Array<{
    mediaId: string
    fileName: string
    from: number
    durationInFrames: number
    sourceFps: number
    sourceSeconds: number
  }> = []
  for (const clip of input.clips) {
    const metadata = await importMedia(clip)
    const from = endOfTimeline(project)
    const edited = await editProject({
      project,
      ops: [
        { op: 'addClip', callerId: 'clip', mediaId: clip.mediaId, from },
        {
          op: 'updateItem',
          id: { $ref: 'clip#/detail/created/0/id' },
          updates: { volume: 0.01 },
        },
      ] as never,
      media: [{ mediaId: clip.mediaId, metadata }],
    })
    project = edited.project
    placed.push({
      mediaId: clip.mediaId,
      fileName: clip.fileName,
      from,
      durationInFrames: endOfTimeline(project) - from,
      sourceFps: metadata.fps,
      sourceSeconds: metadata.duration,
    })
  }
  const timeline = project.timeline
  if (!timeline) throw new Error('edit produced no timeline')
  const totalFrames = endOfTimeline(project)
  const exportFrames =
    input.limitFrames === null ? totalFrames : Math.min(input.limitFrames, totalFrames)
  session = {
    project,
    tracks: (timeline.tracks ?? []) as unknown as TimelineTrack[],
    items: (timeline.items ?? []) as unknown as TimelineItem[],
    totalFrames,
    exportFrames,
    limitFrames: input.limitFrames === null ? null : exportFrames,
    lastResult: null,
  }
  return { clips: placed, totalFrames, exportFrames }
}

async function buildComposition() {
  if (!session) throw new Error('call prepare() first')
  const { project, tracks, items, limitFrames } = session
  const composition = convertTimelineToComposition(
    tracks,
    items,
    [],
    project.metadata.fps,
    project.metadata.width,
    project.metadata.height,
    limitFrames === null ? null : 0,
    limitFrames,
    [],
    project.metadata.backgroundColor,
    undefined,
    undefined,
  )
  composition.tracks = await resolveMediaUrls(composition.tracks, { useProxy: false })
  return composition
}

/** The file the export streams into, the way the export dialog's hook asks for it; null for the old route. */
async function openDestination(kind: DestinationKind, container: string): Promise<ExportDestination | null> {
  if (kind === 'download') return null
  if (kind === 'desktop') {
    const choice = await chooseExportDestination({ container, baseName: 'long-export' })
    if (choice.status !== 'chosen') throw new Error(`no destination file (${choice.status})`)
    return choice.destination
  }
  const root = await navigator.storage.getDirectory()
  const name = `bench-direct-${crypto.randomUUID()}.${container}`
  const handle = await root.getFileHandle(name, { create: true })
  return {
    output: { kind: 'file-handle', handle },
    label: name,
    commit: async () => {},
    discard: async () => {
      await root.removeEntry(name).catch(() => undefined)
    },
  }
}

/** One export of the whole prepared timeline. Resolves when it is done or was aborted; never throws for an abort. */
async function runExport(settings: ExtendedExportSettings, destinationKind: DestinationKind = 'download') {
  if (!session) throw new Error('call prepare() first')
  const fps = session.project.metadata.fps
  const started = performance.now()
  const resolved = await resolveClientSettings(settings, fps)
  const { codecFallback } = resolved
  let clientSettings = resolved.clientSettings
  const destination = await openDestination(destinationKind, clientSettings.container)
  if (destination) clientSettings = { ...clientSettings, destination: destination.output }
  const { exportMode } = mapRequestedClientSettings(settings, fps)
  const composition = await buildComposition()
  controller = new AbortController()
  const signal = controller.signal
  progressState.totalFrames = composition.durationInFrames ?? 0
  progressState.frame = 0
  progressState.phase = 'starting'
  const onProgress = (p: RenderProgress) => {
    progressState.phase = p.phase ?? progressState.phase
    if (p.currentFrame !== undefined && p.phase !== 'preparing') progressState.frame = p.currentFrame
    progressState.at = performance.now()
  }
  const renderStart = performance.now()
  try {
    const outcome = await runRender({
      clientSettings,
      exportMode,
      composition,
      signal,
      onProgress,
    })
    const wallMs = performance.now() - renderStart
    await destination?.commit()
    session.lastResult = outcome.result
    progressState.phase = 'done'
    return {
      aborted: false as const,
      effective: { ...clientSettings, codecFallback: codecFallback ?? null },
      renderPath: outcome.renderPath,
      workerFallbackReason: outcome.fallbackReason ?? null,
      frames: composition.durationInFrames ?? 0,
      wallMs,
      prepMs: renderStart - started,
      fileSize: outcome.result.fileSize,
      durationSeconds: outcome.result.duration,
      mimeType: outcome.result.mimeType,
      // A temporary OPFS file backs the result when the encoder wrote to a stream; none means a buffer in memory.
      outputKind: outcome.result.directOutput
        ? (`direct-${destinationKind}` as const)
        : outcome.result.temporaryOutput
          ? ('opfs-file' as const)
          : ('memory-buffer' as const),
      savedTo: destination?.label ?? null,
      temporaryOutput: outcome.result.temporaryOutput ?? null,
    }
  } catch (error) {
    // A failed or cancelled export leaves nothing of the file it was writing.
    await destination?.discard()
    if (!signal.aborted) throw error
    progressState.phase = 'aborted'
    return { aborted: true as const, wallMs: performance.now() - renderStart }
  }
}

function abort(): void {
  controller?.abort()
}

function progress() {
  return { ...progressState, now: performance.now() }
}

/** The files in the app's export scratch folder and their size as OPFS shows it (a writer's bytes are invisible until it closes). */
async function scratchFiles() {
  const root = await navigator.storage.getDirectory()
  let directory: FileSystemDirectoryHandle
  try {
    directory = await root.getDirectoryHandle(SCRATCH_DIR)
  } catch {
    return []
  }
  const files: Array<{ name: string; size: number }> = []
  for await (const [name, handle] of (
    directory as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
  ).entries()) {
    if (handle.kind !== 'file') continue
    files.push({ name, size: (await (handle as FileSystemFileHandle).getFile()).size })
  }
  return files
}

/** Hand the last export to the driver as a download, the way the app's Save does; returns its size. */
async function download(fileName: string): Promise<number> {
  const result = session?.lastResult
  if (!result) throw new Error('no export to download')
  const url = URL.createObjectURL(result.blob)
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click()
  setTimeout(() => URL.revokeObjectURL(url), 600_000)
  setTimeout(() => void releaseTemporaryExportOutput(result), 600_000)
  return result.fileSize
}

const api = { prepare, runExport, abort, progress, scratchFiles, download }
Object.assign(window, { longExport: api })
