/**
 * Sending a cut piece's bytes to the storage the API signs for it (design 4.1, section 5.2).
 *
 * A piece is small enough for one PUT under 64 MiB; above that it goes in the parts the API chose,
 * and a part that fails on the network or on the storage's side is sent again alone, with a fresh
 * URL, so a dropped connection costs at most the part that was on its way (the cloud's own
 * `putParts` and `putToStorage`, `cloud/packages/shared/src/upload.ts`). Nothing here talks to the
 * API itself: `UploadApi` is the handful of calls the client owns, which keeps the retry policy
 * testable with a recorded storage and a fake API.
 */
import {
  DroneCleanApiError,
  abortError,
  type DeleteUploadResult,
  type FetchLike,
  type PartsTicket,
  type SignedParts,
  type Upload,
  type UploadTicket,
  type VideoMeta,
} from './types'

/** How many times a PUT or the completion is tried, and the pauses before the second and third. */
const UPLOAD_RETRY = { attempts: 3, delaysMs: [2000, 5000] } as const

/**
 * From this size a piece goes in parts. Below it one PUT is enough and simpler: one signed URL,
 * one request, nothing to keep between attempts (design 4.1, section 5.2: "under ~64 MB a single
 * PUT is enough").
 */
export const PARTS_THRESHOLD_BYTES = 64 * 1024 ** 2

/** Whether a piece of `sizeBytes` is uploaded in parts rather than in one PUT. */
export function uploadInParts(sizeBytes: number): boolean {
  return sizeBytes >= PARTS_THRESHOLD_BYTES
}

/** What an upload reports and how it can be stopped. */
export interface UploadOptions {
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
  sleep?: (ms: number) => Promise<void>
}

/** Where the bytes go and how to wait: the client passes its own `fetch` and the real timer. */
export interface StorageUploadOptions extends UploadOptions {
  fetch: FetchLike
}

/** The API calls a piece's upload needs; the client implements them over its request helper. */
export interface UploadApi {
  createUpload(video: VideoMeta): Promise<UploadTicket>
  createPartsUpload(video: VideoMeta): Promise<PartsTicket>
  signUploadParts(uploadId: string, partNumbers: number[]): Promise<SignedParts>
  completeUpload(uploadId: string): Promise<Upload>
  abortUpload(uploadId: string): Promise<DeleteUploadResult>
}

const NETWORK_MESSAGE = 'The upload stopped. Check your connection.'
const FAILED_MESSAGE = 'The upload failed. Please try again.'

/** A failure another attempt may get past: no network, the storage busy or failing. */
function transient(error: unknown): boolean {
  return (
    error instanceof DroneCleanApiError &&
    (error.status === 0 || error.status === 429 || error.status >= 500)
  )
}

/** `ms` from now; the tests' fake resolves at once so a retry costs nothing. */
function pause(ms: number, sleep?: (ms: number) => Promise<void>): Promise<void> {
  return sleep ? sleep(ms) : new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * `step` until it works, again after `UPLOAD_RETRY.delaysMs` while it fails on the network or the
 * server's side (a signing, a PUT, the completion: each is safe to repeat). Any other error, or
 * `signal`, ends it.
 */
async function withRetries<T>(step: () => Promise<T>, options: UploadOptions): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw abortError()
    try {
      return await step()
    } catch (error) {
      if (!transient(error) || attempt + 1 >= UPLOAD_RETRY.attempts) throw error
      const delay = UPLOAD_RETRY.delaysMs[Math.min(attempt, UPLOAD_RETRY.delaysMs.length - 1)]
      await pause(delay ?? 0, options.sleep)
    }
  }
}

/** One PUT to a signed URL: the bytes as they are, with the headers the signature covers. */
async function putBytes(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  options: StorageUploadOptions,
): Promise<void> {
  let response: Response
  try {
    response = await options.fetch(url, {
      method: 'PUT',
      headers,
      body,
      signal: options.signal,
    })
  } catch {
    if (options.signal?.aborted) throw abortError()
    throw new DroneCleanApiError(0, 'network_error', NETWORK_MESSAGE)
  }
  if (!response.ok) {
    throw new DroneCleanApiError(response.status, 'upload_failed', FAILED_MESSAGE)
  }
}

/** `ticket`'s URL written with `body` in one PUT, tried again after a failure. */
export async function putToStorage(
  ticket: UploadTicket,
  body: Blob,
  options: StorageUploadOptions,
): Promise<void> {
  await withRetries(() => putBytes(ticket.url, ticket.headers, body, options), options)
  // `fetch` cannot report upload progress: a single PUT says so once it is stored.
  options.onProgress?.(1)
}

/** Asks for the URLs of some parts (`sign`): the one asked for, numbered from 1. */
type SignParts = (partNumbers: number[]) => Promise<SignedParts>

/**
 * `body` in the ticket's parts (part n holds the bytes from (n - 1) x `partSizeBytes`), one part
 * at a time, each PUT with a fresh URL. A part that fails is asked for again alone: what already
 * arrived stays, so the upload resumes instead of starting over.
 */
async function putParts(
  ticket: PartsTicket,
  body: Blob,
  sign: SignParts,
  options: StorageUploadOptions,
): Promise<void> {
  const total = Math.max(1, body.size)
  let stored = 0
  for (let partNumber = 1; partNumber <= ticket.partCount; partNumber++) {
    const start = (partNumber - 1) * ticket.partSizeBytes
    const piece = body.slice(start, Math.min(body.size, start + ticket.partSizeBytes))
    await withRetries(async () => {
      const signed = await sign([partNumber])
      const target = signed.parts.find((part) => part.partNumber === partNumber)
      if (!target) {
        throw new DroneCleanApiError(500, 'internal', "The upload's address did not come.")
      }
      await putBytes(target.url, target.headers, piece, options)
    }, options)
    stored += piece.size
    options.onProgress?.(Math.min(1, stored / total))
  }
}

/**
 * A piece: the video described, its bytes sent, and the upload completed in one call. The declared
 * size decides the route (one PUT, or parts), the same number the API makes the parts from; it
 * must be the piece's own size, because the API checks the uploaded object against it when the
 * upload completes. An upload that could not complete is dropped on the server rather than left for
 * the daily sweep.
 */
export async function uploadPiece(
  api: UploadApi,
  body: Blob,
  video: VideoMeta,
  options: StorageUploadOptions,
): Promise<Upload> {
  const ticket = uploadInParts(video.sizeBytes)
    ? await api.createPartsUpload(video)
    : await api.createUpload(video)
  try {
    if ('partSizeBytes' in ticket) {
      await putParts(
        ticket,
        body,
        (partNumbers) => api.signUploadParts(ticket.uploadId, partNumbers),
        options,
      )
    } else {
      await putToStorage(ticket, body, options)
    }
    return await withRetries(() => api.completeUpload(ticket.uploadId), options)
  } catch (error) {
    // Dropping an upload that did not complete frees its parts now, instead of after a day.
    await api.abortUpload(ticket.uploadId).catch(() => undefined)
    throw error
  }
}
