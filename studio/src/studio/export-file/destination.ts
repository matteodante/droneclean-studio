/**
 * Where the export dialog's file goes (task 3.5): asked before the export starts, written
 * by the muxer as it encodes, and completed or thrown away at the end.
 *
 * - **Desktop app:** the shell's save dialog; the muxer's bytes stream into a hidden temporary file
 *   beside the chosen path and a successful export renames it to the chosen name. A failure or a
 *   cancel removes it, and a file already at that name is never touched until the rename.
 * - **Web build:** `showSaveFilePicker`, where the browser has it: the writable the picker gives is
 *   itself atomic (the browser replaces the file when the stream is closed).
 * - **Neither:** `unsupported`, and the export keeps its old route (a scratch file in the browser's
 *   private storage, then a download).
 */
import { getDesktopBridge } from '@/studio/desktop/bridge'
import { openDestination, type ExportOutputDestination } from './writable'
import type { ExportFileBridge } from './wire'

/** The extension and the MIME type of what each container writes. */
const CONTAINERS: Readonly<Record<string, { extension: string; mimeType: string }>> = {
  mp4: { extension: 'mp4', mimeType: 'video/mp4' },
  mov: { extension: 'mov', mimeType: 'video/quicktime' },
  webm: { extension: 'webm', mimeType: 'video/webm' },
  mkv: { extension: 'mkv', mimeType: 'video/x-matroska' },
  mp3: { extension: 'mp3', mimeType: 'audio/mpeg' },
  aac: { extension: 'aac', mimeType: 'audio/aac' },
  wav: { extension: 'wav', mimeType: 'audio/wav' },
}

/** The container a MIME type is written by (smart copy hands over the source file's own type), or null. */
export function containerForMimeType(mimeType: string): string | null {
  const mime = mimeType.toLowerCase()
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('matroska')) return 'mkv'
  if (mime.includes('quicktime') || mime.includes('mov')) return 'mov'
  if (mime.includes('audio/mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('audio/wav') || mime.includes('wave')) return 'wav'
  if (mime.includes('audio/aac') || mime.includes('adts')) return 'aac'
  if (mime.includes('mp4')) return 'mp4'
  return null
}

/** A chosen destination. */
export interface ExportDestination {
  /** What the renderer is given (plain data, so the export worker can be handed it). */
  readonly output: ExportOutputDestination
  /** What the dialog says it was saved as: the full path in the desktop app, the file name in a browser. */
  readonly label: string
  /**
   * The absolute path of a file only the desktop's native encoder writes (a `native` choice), else null: every
   * other destination is written through `output`.
   */
  readonly nativePath: string | null
  /**
   * The export finished: the file takes its name. A subtitle sidecar goes beside it. Answers the file's size in
   * bytes where the shell knows it (the desktop app), else null.
   */
  commit(sidecar?: { readonly content: string }): Promise<number | null>
  /** The export failed or was cancelled: nothing is left, and a file of that name is as it was. */
  discard(): Promise<void>
}

export type ExportDestinationChoice =
  | { readonly status: 'chosen'; readonly destination: ExportDestination }
  | { readonly status: 'declined' }
  | { readonly status: 'unsupported' }

function exportFileBridge(): ExportFileBridge | undefined {
  const bridge = getDesktopBridge() as { readonly exportFile?: ExportFileBridge } | undefined
  return bridge?.exportFile
}

/** Asks for the file. `declined` is the user closing the dialog; a refusal of the shell throws with its sentence. */
export async function chooseExportDestination(request: {
  readonly container: string
  /** The name the dialog suggests, without its extension. */
  readonly baseName: string
  /** The desktop's native encoder writes the file (the 10-bit export): the path is granted to it, nothing is streamed. */
  readonly native?: true
}): Promise<ExportDestinationChoice> {
  const container = CONTAINERS[request.container]
  if (container === undefined) return { status: 'unsupported' }
  const suggestedName = `${request.baseName}.${container.extension}`

  const shell = exportFileBridge()
  if (shell !== undefined) return chooseInDesktopShell(shell, suggestedName, container.extension, request.native)
  // The browser's save picker has no native encoder behind it: a native export is the desktop app's alone.
  if (request.native === true) return { status: 'unsupported' }
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    return chooseWithSavePicker(suggestedName, container)
  }
  return { status: 'unsupported' }
}

async function chooseInDesktopShell(
  shell: ExportFileBridge,
  suggestedName: string,
  extension: string,
  native: true | undefined,
): Promise<ExportDestinationChoice> {
  const answer = await shell.choose({ suggestedName, extension, ...(native === true ? { native } : {}) })
  if (!answer.ok) throw new Error(answer.message)
  if (answer.value === null) return { status: 'declined' }
  const { id, path } = answer.value
  return {
    status: 'chosen',
    destination: {
      output: { kind: 'desktop-file', id },
      label: path,
      nativePath: native === true ? path : null,
      commit: async (sidecar) => {
        const committed = await shell.commit({ id, sidecar })
        if (!committed.ok) throw new Error(committed.message)
        return committed.value.size
      },
      // Best effort by design: the shell also removes the file when the window goes away.
      discard: async () => {
        await shell.discard({ id }).catch(() => undefined)
      },
    },
  }
}

async function chooseWithSavePicker(
  suggestedName: string,
  container: { extension: string; mimeType: string },
): Promise<ExportDestinationChoice> {
  let handle: FileSystemFileHandle
  try {
    handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ accept: { [container.mimeType]: [`.${container.extension}`] } }],
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { status: 'declined' }
    throw error
  }
  return {
    status: 'chosen',
    destination: {
      output: { kind: 'file-handle', handle },
      label: handle.name,
      nativePath: null,
      commit: (sidecar) => {
        if (sidecar !== undefined) downloadText(`${handle.name.replace(/\.[^.]+$/, '')}.srt`, sidecar.content)
        return Promise.resolve(null)
      },
      // The browser drops its swap file when the writable is aborted; the file the picker made stays as the user left it.
      discard: () => Promise.resolve(),
    },
  }
}

/** The bytes a smart copy hands over, written in 4 MiB pieces through the same stream the muxer uses. */
const COPY_PIECE_BYTES = 4 * 1024 * 1024

/** Writes a finished blob into the destination (smart copy: the source file as it is) and answers its size. */
export async function writeBlobToDestination(
  destination: ExportDestination,
  blob: Blob,
  signal: AbortSignal,
): Promise<number> {
  const open = await openDestination(destination.output)
  const writer = open.writable.getWriter()
  try {
    for (let position = 0; position < blob.size; position += COPY_PIECE_BYTES) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
      await writer.ready
      const data = new Uint8Array(await blob.slice(position, position + COPY_PIECE_BYTES).arrayBuffer())
      await writer.write({ type: 'write', data, position })
    }
    await writer.close()
    return await open.finish()
  } catch (error) {
    await open.abort()
    throw error
  }
}

function downloadText(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  requestIdleCallback(() => URL.revokeObjectURL(url))
}
