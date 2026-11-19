import { openDestination, type ExportOutputDestination } from '@/studio/export-file/writable'
import { timedWritable } from '@/studio/render/timings'
import type { ClientContainer, ClientRenderResult } from './client-renderer'

type MediabunnyModule = typeof import('mediabunny')

const EXPORT_SCRATCH_DIR = 'freecut-export-output'
const STREAM_CHUNK_SIZE_BYTES = 4 * 1024 * 1024
const STALE_OUTPUT_AGE_MS = 24 * 60 * 60 * 1000
let staleCleanupStarted = false

export interface TemporaryExportOutput {
  directory: string
  fileName: string
}

export interface ExportOutputTarget {
  target:
    | InstanceType<MediabunnyModule['BufferTarget']>
    | InstanceType<MediabunnyModule['StreamTarget']>
  kind: 'buffer' | 'file'
  complete: () => Promise<{
    blob: Blob
    /** The file's size in bytes; `blob` holds no bytes when `directOutput` is set. */
    size: number
    temporaryOutput?: TemporaryExportOutput
    /** The bytes went straight to the destination the caller chose, so there is no scratch copy to read back. */
    directOutput?: true
  }>
  discard: () => Promise<void>
}

function randomOutputName(container: ClientContainer): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${id}.${container}`
}

async function createFileBackedTarget(
  mediabunny: MediabunnyModule,
  container: ClientContainer,
  mimeType: string,
): Promise<ExportOutputTarget | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null

  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle(EXPORT_SCRATCH_DIR, { create: true })
  if (!staleCleanupStarted) {
    staleCleanupStarted = true
    void (async () => {
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind !== 'file') continue
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          if (Date.now() - file.lastModified >= STALE_OUTPUT_AGE_MS) {
            await directory.removeEntry(name)
          }
        } catch {
          // Another export context may have removed the file already.
        }
      }
    })()
  }
  const fileName = randomOutputName(container)
  const fileHandle = await directory.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  let settled = false

  const removeFile = async () => {
    try {
      await directory.removeEntry(fileName)
    } catch {
      // Already removed or unavailable.
    }
  }

  return {
    target: new mediabunny.StreamTarget(timedWritable(writable), {
      chunked: true,
      chunkSize: STREAM_CHUNK_SIZE_BYTES,
    }),
    kind: 'file',
    complete: async () => {
      settled = true
      const file = await fileHandle.getFile()
      return {
        size: file.size,
        // Blob composition keeps the OPFS-backed File as its immutable backing
        // store while supplying the MIME type that OPFS files don't preserve.
        blob: new Blob([file], { type: mimeType }),
        temporaryOutput: { directory: EXPORT_SCRATCH_DIR, fileName },
      }
    },
    discard: async () => {
      if (!settled) {
        await writable.abort().catch(() => undefined)
      }
      await removeFile()
    },
  }
}

/**
 * A target that writes straight into the file the user chose (`@/studio/export-file`). The muxer's
 * close does not complete that file (a cancel closes it too): `complete()` does, after `finalize()`,
 * and `discard()` throws what was written away. There is no fallback to another file when the
 * destination cannot be opened: the export fails with the reason instead.
 */
async function createDestinationTarget(
  mediabunny: MediabunnyModule,
  destination: ExportOutputDestination,
  mimeType: string,
): Promise<ExportOutputTarget> {
  const open = await openDestination(destination)
  let settled = false
  return {
    target: new mediabunny.StreamTarget(timedWritable(open.writable), {
      chunked: true,
      chunkSize: STREAM_CHUNK_SIZE_BYTES,
    }),
    kind: 'file',
    complete: async () => {
      const size = await open.finish()
      settled = true
      return { blob: new Blob([], { type: mimeType }), size, directOutput: true }
    },
    discard: async () => {
      if (!settled) await open.abort()
    },
  }
}

/**
 * Prefer an OPFS-backed Mediabunny target so encoded bytes are flushed to disk
 * instead of accumulating in one renderer-process ArrayBuffer. BufferTarget is
 * retained as a compatibility fallback for environments without OPFS.
 */
export async function createExportOutputTarget(
  mediabunny: MediabunnyModule,
  container: ClientContainer,
  mimeType: string,
  destination?: ExportOutputDestination,
): Promise<ExportOutputTarget> {
  if (destination) return createDestinationTarget(mediabunny, destination, mimeType)
  try {
    const fileTarget = await createFileBackedTarget(mediabunny, container, mimeType)
    if (fileTarget) return fileTarget
  } catch {
    // Preserve export support where OPFS exists but is temporarily unavailable.
  }

  const target = new mediabunny.BufferTarget()
  return {
    target,
    kind: 'buffer',
    complete: async () => {
      if (!target.buffer) throw new Error('No output buffer generated')
      const blob = new Blob([target.buffer], { type: mimeType })
      return { blob, size: blob.size }
    },
    discard: async () => {},
  }
}

export async function releaseTemporaryExportOutput(
  result: Pick<ClientRenderResult, 'temporaryOutput'> | null | undefined,
): Promise<void> {
  const temporary = result?.temporaryOutput
  if (!temporary || typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return

  try {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle(temporary.directory)
    await directory.removeEntry(temporary.fileName)
  } catch {
    // Cleanup is best-effort; the file may already have been removed.
  }
}
