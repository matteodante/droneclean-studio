/**
 * Downloading a finished job's cleaned file: `job.result.url`, a pre-signed GET that lives an hour
 * (design 4.1, section 5.3).
 *
 * The bytes are read from the response's stream a chunk at a time and only then made into one
 * `Blob`, so nothing holds the whole file twice: the caller writes that blob into the project
 * beside the clip (`media/{id}/shadow/...`) and the renderer reads the file from there. The URL is
 * signed storage, not the API: no token is sent, so the signature stays valid.
 */
import { DroneCleanApiError, abortError, type FetchLike } from './types'

const NETWORK_MESSAGE = 'Could not reach DroneClean. Check your connection.'
const FAILED_MESSAGE = 'The cleaned file could not be downloaded. Try again.'

/** What a download needs, and how far it has got. */
export interface DownloadOptions {
  fetch: FetchLike
  /** Stops the download; the call rejects with an `AbortError`. */
  signal?: AbortSignal
  /** Called with the downloaded fraction, 0 to 1, after each chunk (only when the size is known). */
  onProgress?: (fraction: number) => void
}

/** The response's own type, or MP4 when the storage does not say (the cloud writes an MP4 or MOV). */
const DEFAULT_TYPE = 'video/mp4'

/**
 * `url`'s bytes as one `Blob`. The response is read chunk by chunk (`response.body`), so the
 * download never asks for the whole file at once; a response without a stream falls back to its
 * `blob()`. A failed GET throws a `DroneCleanApiError` with the storage's status.
 */
export async function downloadResult(url: string, options: DownloadOptions): Promise<Blob> {
  let response: Response
  try {
    response = await options.fetch(url, { signal: options.signal })
  } catch {
    if (options.signal?.aborted) throw abortError()
    throw new DroneCleanApiError(0, 'network_error', NETWORK_MESSAGE)
  }
  if (!response.ok) {
    throw new DroneCleanApiError(response.status, 'download_failed', FAILED_MESSAGE)
  }
  const type = response.headers.get('content-type') ?? DEFAULT_TYPE
  if (!response.body) {
    const blob = await response.blob()
    options.onProgress?.(1)
    return blob
  }
  const size = Number(response.headers.get('content-length') ?? '')
  const known = Number.isFinite(size) && size > 0
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    // A stream's chunks are ArrayBuffer-backed; the lib types them as ArrayBufferLike.
    chunks.push(value as Uint8Array<ArrayBuffer>)
    received += value.byteLength
    if (known) options.onProgress?.(Math.min(1, received / size))
  }
  return new Blob(chunks, { type })
}
