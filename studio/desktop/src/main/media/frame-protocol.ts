/**
 * The native media engine's face to the page: the `droneclean-frame:` scheme that
 * carries decoded frames, and the IPC messages that start and stop a decode
 * (task 3.1, slice P4).
 *
 * **The scheme.** `GET droneclean-frame://decode/<jobId>/<frameIndex>` answers one
 * frame — `preciseInputFrameBytes` bytes of packed planes in the format the reply
 * named (`p010le`, or `gbrp10le` for a source `p010le` cannot carry), no framing
 * header — from `decode-stream.ts`'s ring. The statuses are the contract's: 200
 * the whole frame, 206 a `Range` of it (so a read that broke at 40 MB resumes
 * instead of decoding again), 416 for a range past its end, 400 for a URL that
 * names no frame, 404 for a job the shell does not know, 410 for a frame that
 * will never be there — past the requested count, dropped by the ring, a
 * cancelled job, or a decoder that died (its last log lines are the body).
 *
 * **The IPC.** `decode.start` probes the source with ffprobe, starts FFmpeg and
 * answers the contract's `DecodeStartReply`; `capabilities` answers what the
 * shell's FFmpeg can do; `cancel` kills a decode; `progress` is sent per decoded
 * frame to the window that asked. A failure answers `{ ok: false, error }` — the
 * payload travels as a value because Electron's `invoke` carries only an `Error`'s
 * message back — and `native-source.ts` turns it into the contract's
 * `NativeEngineError`.
 *
 * **Registration.** `registerSchemesAsPrivileged` only works before the app is
 * ready, and — measured on Electron 45 — every call *replaces* the previous list
 * instead of adding to it, so the app scheme and the frame scheme have to be one
 * call. `main/index.ts` makes that call with `NATIVE_FRAME_SCHEME_PRIVILEGES` as
 * its second element, and calls `registerNativeFrameProtocol` after `whenReady`.
 */
import { ipcMain, protocol, type CustomScheme, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import {
  NATIVE_FRAME_SCHEME,
  NATIVE_FRAME_STATUS,
  NATIVE_JOB_ID_PATTERN,
  NATIVE_MEDIA_CHANNELS,
  NATIVE_PROTOCOL_HEADERS,
  NativeEngineFailure,
  frameHeaders,
  nativeEngineErrorPayload,
  parseByteRange,
  parseFrameUrl,
  preciseInputFrameBytes,
  resolveSourceColourTags,
  type DecodeStartReply,
  type DecodeStartRequest,
  type NativeEngineCapabilities,
  type NativeMediaAnswer,
  type NativeProgress,
  type PreciseInputFormat,
} from '../../shared/native-media'
import type { MediaPathAccess } from '../media'
import { APP_HOST, APP_SCHEME } from '../protocol'
import { appOnly, appOnlySend } from '../sender'
import { DecodeJobs, frameBody } from './decode-stream'
import {
  decodeArguments,
  deliveredDecodeFormat,
  ffmpegCapabilities,
  ffmpegLocation,
  preferredHardware,
  probeSource,
  spawnDecode,
} from './ffmpeg'
import { refuseUncPath } from './path-guard'
import { WindowJobs } from './window-jobs'

/**
 * The frame scheme's privileges: a standard, secure URL that a page may `fetch`
 * and that is subject to CORS, which is what the design's prototype measured for
 * cross-scheme responses. It belongs in the app's one
 * `registerSchemesAsPrivileged` call before `whenReady` — see this file's header.
 */
export const NATIVE_FRAME_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: NATIVE_FRAME_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}

/** The shell's decodes, this process's only, answered by the handler below. */
const jobs = new DecodeJobs({ spawn: spawnDecode })

/**
 * Who owns which job, how many a window may hold, and when a job is stopped
 * (reload, crash, window closed, idle): `window-jobs.ts`.
 */
const windowJobs = new WindowJobs({ cancel: (jobId) => jobs.cancel(jobId) })

/** The answer to a frame request from a page that is not the app's. */
const FORBIDDEN = 403

/** How often idle jobs are looked for. */
const IDLE_SWEEP_MS = 5_000

/**
 * Registers the frame scheme's handler and the native media IPC. Call after
 * `app.whenReady()`.
 *
 * `media` is the registry of `main/media.ts`: a decode starts only on a file it
 * holds. Every IPC handler answers only the app's own frame (`sender.ts`).
 */
export function registerNativeFrameProtocol(media: MediaPathAccess): void {
  protocol.handle(NATIVE_FRAME_SCHEME, (request) => answerFrameRequest(request))
  ipcMain.handle(
    NATIVE_MEDIA_CHANNELS.decodeStart,
    appOnly((event: IpcMainInvokeEvent, raw: unknown) => answerDecodeStart(media, event, raw)),
  )
  ipcMain.handle(
    NATIVE_MEDIA_CHANNELS.capabilities,
    appOnly(async () => answerCapabilities()),
  )
  ipcMain.on(
    NATIVE_MEDIA_CHANNELS.cancel,
    appOnlySend((_event, raw: unknown) => {
      const jobId = jobIdOf(raw)
      if (jobId === null) return
      windowJobs.release(jobId)
      jobs.cancel(jobId)
    }),
  )
  setInterval(() => windowJobs.sweep(), IDLE_SWEEP_MS).unref()
}

/**
 * A frame request from a page that is not the app's: its `Origin`, when the
 * browser sends one (a `fetch` from another origin always does), must be the
 * app's. A request with no `Origin` is a same-origin or non-CORS load and has
 * nothing to compare; the job ids it would need are unguessable and live only in
 * the app's page.
 */
function isForeignOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin === null) return false
  return origin !== `${APP_SCHEME}://${APP_HOST}`
}

/** One frame's response, from the ring; the contract's statuses (`native-media.ts`). */
async function answerFrameRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textResponse(NATIVE_FRAME_STATUS.badRequest, `${request.method} is not a frame request`)
  }

  if (isForeignOrigin(request)) return textResponse(FORBIDDEN, 'not the app’s page')

  const parsed = parseFrameUrl(request.url)
  if (!parsed.ok) return textResponse(NATIVE_FRAME_STATUS.badRequest, parsed.reason)

  windowJobs.readStarted(parsed.jobId)
  let answer: Awaited<ReturnType<typeof jobs.take>>
  try {
    answer = await jobs.take(parsed.jobId, parsed.frameIndex)
  } finally {
    windowJobs.readFinished(parsed.jobId)
  }
  if (answer.kind === 'unknown-job') {
    return textResponse(NATIVE_FRAME_STATUS.notFound, `no decode job ${parsed.jobId}`)
  }
  if (answer.kind === 'gone') return textResponse(NATIVE_FRAME_STATUS.gone, answer.reason)

  const totalBytes = answer.bytes.byteLength
  const range = parseByteRange(request.headers.get('range'), totalBytes)
  if (range.kind === 'unsatisfiable') {
    return new Response(null, {
      status: NATIVE_FRAME_STATUS.rangeNotSatisfiable,
      headers: frameHeaders(totalBytes, null),
    })
  }
  // A range the contract calls `invalid` is answered in full, as RFC 9110 asks of
  // a range unit or syntax the server does not understand: a broken resume never
  // fails a frame.
  const partial = range.kind === 'partial' ? range : null
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: partial === null ? NATIVE_FRAME_STATUS.ok : NATIVE_FRAME_STATUS.partialContent,
      headers: frameHeaders(totalBytes, partial),
    })
  }

  // The response is being built, so this frame no longer holds one of the ring's
  // places: the pump may decode the next one. A resumed read still finds it here
  // until the ring slides past it. The body streams the ring's own buffer: a
  // `Response` built from the bytes would copy the frame.
  jobs.settle(parsed.jobId, parsed.frameIndex)
  if (partial === null) {
    return new Response(frameBody(answer.bytes), {
      status: NATIVE_FRAME_STATUS.ok,
      headers: frameHeaders(totalBytes, null),
    })
  }
  return new Response(frameBody(answer.bytes.subarray(partial.start, partial.end + 1)), {
    status: NATIVE_FRAME_STATUS.partialContent,
    headers: frameHeaders(totalBytes, partial),
  })
}

/** `decode.start`: probe, build the command line, start the job, answer the reply. */
async function answerDecodeStart(
  media: MediaPathAccess,
  event: IpcMainInvokeEvent,
  raw: unknown,
): Promise<NativeMediaAnswer<DecodeStartReply>> {
  try {
    const request = parseDecodeStartRequest(raw)
    windowJobs.assertRoom(event.sender.id)
    // Only what the page named through the media registry: the shell runs FFmpeg
    // on this path, so "any absolute path" would be "any file of the disk".
    const file = await media.registeredFile(request.file)
    if (file === null) {
      throw new Error(
        `decode.start: not a registered media file: ${JSON.stringify(request.file)}`,
      )
    }
    const location = ffmpegLocation()
    if (location === null) {
      throw new NativeEngineFailure({
        message: 'no FFmpeg binary: set DRONECLEAN_FFMPEG to one, or add ffmpeg to PATH',
        command: [],
        exitCode: null,
        signal: null,
        log: [],
      })
    }

    const source = await probeSource(location.ffprobe, file)
    const capabilities = await ffmpegCapabilities()
    const format = deliveredDecodeFormat(request.format, source)
    const args = decodeArguments({
      file,
      startSeconds: request.startSeconds,
      frames: request.frames,
      format,
      tags: resolveSourceColourTags(source.colour),
      hardware: preferredHardware(capabilities.hardware, process.platform),
    })
    const frameBytes = preciseInputFrameBytes(format, source.width, source.height)

    windowJobs.admit(event.sender, request.jobId)
    let reply: DecodeStartReply
    try {
      reply = jobs.start({
        jobId: request.jobId,
        frames: request.frames,
        frameBytes,
        ffmpeg: location.ffmpeg,
        args,
        reply: {
          width: source.width,
          height: source.height,
          rate: source.rate,
          colour: source.colour,
          format,
          frameBytes,
        },
        onFrame: (framesDone) => {
          if (event.sender.isDestroyed()) return
          const progress: NativeProgress = {
            jobId: request.jobId,
            phase: 'decode',
            framesDone,
            framesTotal: request.frames,
          }
          event.sender.send(NATIVE_MEDIA_CHANNELS.progress, progress)
        },
      })
    } catch (error) {
      windowJobs.release(request.jobId)
      throw error
    }
    return { ok: true, value: reply }
  } catch (error) {
    return { ok: false, error: nativeEngineErrorPayload(error) }
  }
}

/** `capabilities`: what the shell's FFmpeg lists; never rejects, it reports `available: false`. */
async function answerCapabilities(): Promise<NativeMediaAnswer<NativeEngineCapabilities>> {
  try {
    return { ok: true, value: await ffmpegCapabilities() }
  } catch (error) {
    return { ok: false, error: nativeEngineErrorPayload(error) }
  }
}

/** The validated `decode.start` request; anything else is a refusal the page can read. */
function parseDecodeStartRequest(raw: unknown): DecodeStartRequest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('decode.start: the request must be an object')
  }
  const record = raw as Record<string, unknown>
  const { jobId, file, startSeconds, frames, format } = record

  if (typeof jobId !== 'string' || !NATIVE_JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`decode.start: not a job id: ${JSON.stringify(jobId)}`)
  }
  if (typeof file === 'string') refuseUncPath(file, 'decode.start')
  if (typeof file !== 'string' || file === '' || !path.isAbsolute(file)) {
    throw new Error(`decode.start: the file must be an absolute path, got ${JSON.stringify(file)}`)
  }
  if (typeof startSeconds !== 'number' || !Number.isFinite(startSeconds) || startSeconds < 0) {
    throw new Error(`decode.start: the start must be a time in seconds, got ${String(startSeconds)}`)
  }
  if (typeof frames !== 'number' || !Number.isSafeInteger(frames) || frames < 1) {
    throw new Error(`decode.start: the frame count must be a positive integer, got ${String(frames)}`)
  }
  if (format !== 'p010le' && format !== 'gbrp10le' && format !== 'rgba64le') {
    throw new Error(`decode.start: not a decoded frame format: ${JSON.stringify(format)}`)
  }
  return { jobId, file, startSeconds, frames, format: format as PreciseInputFormat }
}

/** The job id of a `cancel` message, or null for anything malformed (a send has no reply). */
function jobIdOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const jobId = (raw as Record<string, unknown>).jobId
  return typeof jobId === 'string' && NATIVE_JOB_ID_PATTERN.test(jobId) ? jobId : null
}

/** A plain-text answer (a refusal) with the protocol's headers and no caching. */
function textResponse(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: {
      ...NATIVE_PROTOCOL_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
