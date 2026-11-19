/**
 * The writable stream of an export's destination file (task 3.5): what the muxer's
 * `StreamTarget` writes into, in the export worker or on the page.
 *
 * Two destinations, named by plain data so the worker can be handed one:
 *
 * - `desktop-file`: the desktop shell's temporary file (`wire.ts`). Each chunk is POSTed to
 *   `droneclean-export://` and the POST is answered once the bytes are on disk. The stream
 *   holds one chunk in flight and one queued, so a slow disk slows the encoder instead of
 *   growing memory: the muxer awaits `writer.ready` before it hands over the next chunk.
 * - `file-handle`: a `FileSystemFileHandle` from `showSaveFilePicker` (the web build). The browser
 *   writes into a swap file and replaces the user's file only when the stream is closed.
 *
 * **Closing is the caller's.** The muxer closes its writer on `finalize()` and also on
 * `cancel()`, and for a file handle a close is a commit: a cancelled export would then replace the
 * user's file with half a video. So the stream handed to the muxer never closes the real file: its
 * `close` only waits for what was written, and `finish()` (after a successful `finalize()`) or
 * `abort()` (anything else) decides.
 */
import { exportBeginUrl, exportWriteUrl } from './wire'

/** One write of the muxer: bytes at a position of the file. */
export interface ExportWriteChunk {
  readonly type: 'write'
  readonly data: Uint8Array
  readonly position: number
}

/** Where an export's bytes go, as plain data a worker can be given. */
export type ExportOutputDestination =
  | { readonly kind: 'desktop-file'; readonly id: string }
  | { readonly kind: 'file-handle'; readonly handle: FileSystemFileHandle }

/** The open destination: the stream for the muxer, and the two ways to end it. */
export interface OpenDestination {
  readonly writable: WritableStream<ExportWriteChunk>
  /** After a successful `finalize()`: the real file is completed; answers its size in bytes. */
  finish(): Promise<number>
  /** Anything else: what was written is thrown away (the desktop shell removes its temporary file on `discard`). */
  abort(): Promise<void>
}

/** A chunk in flight and one queued: the most the stream ever holds. */
const QUEUED_CHUNKS = 1

/** The sentence a failed POST becomes: the shell's own words when it sent any. */
async function failure(response: Response): Promise<Error> {
  const body = (await response.text().catch(() => '')).trim()
  return new Error(body === '' ? `writing the export file failed (${response.status})` : body)
}

async function post(url: string, body: Uint8Array | null, fetchImpl: typeof fetch): Promise<void> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/octet-stream' },
      body: body as BodyInit | null,
    })
  } catch (error) {
    throw new Error(
      `writing the export file failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) throw await failure(response)
}

/** The desktop shell's file as a stream; `fetchImpl` is the page's `fetch` (a test passes its own). */
export function openDesktopFile(id: string, fetchImpl: typeof fetch = fetch): OpenDestination {
  let size = 0
  let aborted = false
  const writable = new WritableStream<ExportWriteChunk>(
    {
      // An attempt starts: the shell empties the file, so a retry after a failed first attempt
      // (the worker falls back to the main thread) never keeps the tail of the first.
      start: () => post(exportBeginUrl(id), null, fetchImpl),
      write: async (chunk) => {
        if (aborted) throw new Error('the export file was closed')
        await post(exportWriteUrl(id, chunk.position), chunk.data, fetchImpl)
        size = Math.max(size, chunk.position + chunk.data.byteLength)
      },
    },
    new CountQueuingStrategy({ highWaterMark: QUEUED_CHUNKS }),
  )
  return {
    writable,
    finish: () => Promise.resolve(size),
    abort: () => {
      aborted = true
      return Promise.resolve()
    },
  }
}

/** A file the browser's save picker returned, as a stream that is committed by `finish()` only. */
export async function openFileHandle(handle: FileSystemFileHandle): Promise<OpenDestination> {
  const real = await handle.createWritable()
  const writer = real.getWriter()
  const writable = new WritableStream<ExportWriteChunk>(
    { write: (chunk) => writer.write(chunk) },
    new CountQueuingStrategy({ highWaterMark: QUEUED_CHUNKS }),
  )
  return {
    writable,
    finish: async () => {
      await writer.close()
      return (await handle.getFile()).size
    },
    abort: () => writer.abort().catch(() => undefined),
  }
}

/** Opens the destination an export names. Throws when it cannot: an export never falls back to another file. */
export async function openDestination(output: ExportOutputDestination): Promise<OpenDestination> {
  return output.kind === 'desktop-file' ? openDesktopFile(output.id) : await openFileHandle(output.handle)
}
