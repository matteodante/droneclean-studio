/**
 * Benchmark page for the import measurement (task 1.2).
 *
 * It drives the editor's own import path for a real file drop: the page's drop
 * handler runs `extractValidMediaFileEntriesFromDataTransfer` (the library's
 * drop parser) and then `useMediaLibraryStore.importHandles` (the function the
 * library and the timeline call). The files come from the DevTools Protocol's
 * `Input.dispatchDragEvent`, so `DataTransferItem.getAsFileSystemHandle()`
 * yields real file handles that point at the footage on disk.
 *
 * The workspace is an OPFS directory (`setWorkspaceRoot`), because a native
 * folder picker cannot be driven; the measurement records origin storage and
 * the Chrome profile's growth as the workspace's footprint.
 */
import type { MediaMetadata } from '@/types/storage'

import { mediaLibraryService } from '@/features/media-library/services/media-library-service'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { extractValidMediaFileEntriesFromDataTransfer } from '@/features/media-library/utils/file-drop'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
// Registers the lazy service loader the media-library store uses.
import '@/features/media-library/services/media-library-service-loader'

interface ClipTiming {
  fileName: string
  startMs: number
  seconds: number
  mediaId?: string
  storageType?: string
  filePath?: string | null
  isDuplicate?: boolean
  error?: string
}

interface LinkDescriptor {
  mediaId: string
  fileName: string
  fileSize: number
  fileLastModified: number
  filePath?: string
}

interface ImportState {
  phase: 'idle' | 'preparing' | 'waiting-drop' | 'importing' | 'done' | 'failed'
  dropMs: number | null
  doneMs: number | null
  totalSeconds: number | null
  error: string | null
  dropErrors: string[]
  timings: ClipTiming[]
  imported: Array<{
    id: string
    fileName: string
    fileSize: number
    storageType: string
    filePath: string | null
  }>
  libraryCount: number
}

let workspace: FileSystemDirectoryHandle | null = null
let projectId = ''
let state: ImportState = emptyState()

function emptyState(): ImportState {
  return {
    phase: 'idle',
    dropMs: null,
    doneMs: null,
    totalSeconds: null,
    error: null,
    dropErrors: [],
    timings: [],
    imported: [],
    libraryCount: 0,
  }
}

async function dirStats(dir: FileSystemDirectoryHandle): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      const nested = await dirStats(entry as FileSystemDirectoryHandle)
      bytes += nested.bytes
      files += nested.files
      continue
    }
    const file = await (entry as FileSystemFileHandle).getFile()
    bytes += file.size
    files += 1
  }
  return { bytes, files }
}

async function originUsageBytes(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    return estimate?.usage ?? null
  } catch {
    return null
  }
}

async function workspaceStats(): Promise<{
  bytes: number
  files: number
  originUsageBytes: number | null
}> {
  if (!workspace) throw new Error('prepare() first')
  const stats = await dirStats(workspace)
  return { ...stats, originUsageBytes: await originUsageBytes() }
}

/** The descriptors written for linked media, plus whether any source bytes were copied. */
async function linkDescriptors(): Promise<{
  links: LinkDescriptor[]
  copiedSourceFiles: string[]
}> {
  if (!workspace) throw new Error('prepare() first')
  const links: LinkDescriptor[] = []
  const copiedSourceFiles: string[] = []
  const mediaRoot = await workspace.getDirectoryHandle('media')
  for await (const entry of mediaRoot.values()) {
    if (entry.kind !== 'directory') continue
    const mediaDir = entry as FileSystemDirectoryHandle
    let descriptorName: string | null = null
    for await (const child of mediaDir.values()) {
      if (child.kind !== 'file') continue
      if (child.name === 'source.link.json') {
        descriptorName = child.name
        continue
      }
      if (['metadata.json', 'thumbnail.jpg', 'thumbnail.meta.json'].includes(child.name)) continue
      copiedSourceFiles.push(`${mediaDir.name}/${child.name}`)
    }
    if (!descriptorName) continue
    const handle = await mediaDir.getFileHandle(descriptorName)
    links.push(JSON.parse(await (await handle.getFile()).text()) as LinkDescriptor)
  }
  return { links, copiedSourceFiles }
}

function installDropTarget(): void {
  const zone = document.getElementById('import-drop-zone')
  if (!zone) throw new Error('drop zone missing')
  const allow = (event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  zone.addEventListener('dragenter', allow)
  zone.addEventListener('dragover', allow)
  zone.addEventListener('drop', (event) => {
    void handleDrop(event)
  })
  state.phase = 'waiting-drop'
  zone.textContent = 'waiting for the drop of the six clips'
}

async function handleDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  event.stopPropagation()
  if (state.phase !== 'waiting-drop') return
  state.phase = 'importing'
  state.dropMs = performance.now()

  try {
    const { supported, entries, errors } = await extractValidMediaFileEntriesFromDataTransfer(
      event.dataTransfer!,
    )
    if (!supported) {
      throw new Error('the drop carried no FileSystemFileHandle items')
    }
    state.dropErrors = errors
    if (entries.length === 0) {
      throw new Error(`no importable media in the drop: ${errors.join('; ')}`)
    }

    // Time each import the way the library does, at the service call the
    // import action makes (`runImportTasks` -> importMediaWithHandle).
    const original = mediaLibraryService.importMediaWithHandle.bind(mediaLibraryService)
    mediaLibraryService.importMediaWithHandle = async (handle, targetProjectId, options) => {
      const start = performance.now()
      try {
        const metadata = await original(handle, targetProjectId, options)
        recordTiming(handle.name, start, metadata)
        return metadata
      } catch (error) {
        state.timings.push({
          fileName: handle.name,
          startMs: round(start - state.dropMs!),
          seconds: round((performance.now() - start) / 1000),
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }

    const results = await useMediaLibraryStore
      .getState()
      .importHandles(entries.map((entry) => entry.handle))

    state.doneMs = performance.now()
    state.totalSeconds = round((state.doneMs - state.dropMs) / 1000)
    state.imported = results.map(toImported)
    state.libraryCount = useMediaLibraryStore.getState().mediaItems.length
    state.phase = 'done'
    document.getElementById('import-drop-zone')!.textContent =
      `${results.length} clips imported in ${state.totalSeconds} s`
  } catch (error) {
    state.doneMs = performance.now()
    state.error = error instanceof Error ? error.message : String(error)
    state.phase = 'failed'
  }
}

function recordTiming(
  fileName: string,
  start: number,
  metadata: MediaMetadata & { isDuplicate?: boolean },
): void {
  state.timings.push({
    fileName,
    startMs: round(start - state.dropMs!),
    seconds: round((performance.now() - start) / 1000),
    mediaId: metadata.id,
    storageType: metadata.storageType,
    filePath: metadata.filePath ?? null,
    isDuplicate: Boolean(metadata.isDuplicate),
  })
}

function toImported(metadata: MediaMetadata): ImportState['imported'][number] {
  return {
    id: metadata.id,
    fileName: metadata.fileName,
    fileSize: metadata.fileSize,
    storageType: metadata.storageType,
    filePath: metadata.filePath ?? null,
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

async function prepare(): Promise<{
  workspaceBytes: number
  originUsageBytes: number | null
  projectId: string
}> {
  state = emptyState()
  state.phase = 'preparing'
  const opfsRoot = await navigator.storage.getDirectory()
  workspace = await opfsRoot.getDirectoryHandle(`bench-import-${crypto.randomUUID()}`, {
    create: true,
  })
  setWorkspaceRoot(workspace)
  projectId = `bench-import-${crypto.randomUUID()}`
  useMediaLibraryStore.getState().setCurrentProject(projectId)
  installDropTarget()
  const stats = await workspaceStats()
  return { workspaceBytes: stats.bytes, originUsageBytes: stats.originUsageBytes, projectId }
}

const api = {
  ready: true as const,
  prepare,
  getState: (): ImportState => structuredClone(state),
  workspaceStats,
  linkDescriptors,
}
type ImportBenchApi = typeof api
;(window as unknown as { benchImport: ImportBenchApi }).benchImport = api
;(window as unknown as { bench: { ready: true } }).bench = { ready: true }
