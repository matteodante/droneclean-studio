/**
 * The native encoder's face to the page (task 3.3, slice P5): the
 * `droneclean-encode:` scheme the readback is POSTed to, and the `encode.start`
 * IPC message that opens a job.
 *
 * **The flow.** `encode.start` validates the request (a granted output path, a
 * format the FFmpeg build can encode, a size and rate), spawns FFmpeg and answers
 * `EncodeStartReply`: the readback format it takes and one frame's byte length.
 * The page then POSTs the frames to `droneclean-encode://encode/<jobId>`; the body
 * is read chunk by chunk into `encode-stream.ts`'s ring, which is the
 * backpressure, and the reply is `EncodeReply` (200) once FFmpeg has written the
 * file, or a 500 with a `NativeEngineErrorPayload` body. Progress is sent per
 * frame the encoder took, as `phase: 'encode'` with `framesTotal` 0 (the request
 * does not say how many frames follow).
 *
 * **Ending a job.** `native-media:cancel` kills it (this file listens on the same
 * channel as the decode jobs; a job id that is not an encode's is ignored here),
 * an aborted POST kills it, and the window going away or navigating kills it
 * (`window-jobs.ts`). A job nobody has written to for the idle time is killed
 * too. Each of these removes the partial file.
 *
 * **The sound.** A project with sound sends its mix first, in chunks, to `droneclean-encode://audio/<jobId>/<n>`
 * (`audio-protocol.ts`), then ends it; `encode.start` takes the staged file by the job id and gives FFmpeg a second
 * input (`audio-stage.ts`, `formats.ts`'s `mix`). A job with no staged mix has no audio stream. The staged file is
 * removed when the encode commits, fails or is cancelled (a cancel before `encode.start` removes it too).
 *
 * The scheme must be registered as privileged before `ready`, in the app's one
 * `registerSchemesAsPrivileged` call (see `frame-protocol.ts`).
 */
import { ipcMain, protocol, type CustomScheme, type IpcMainInvokeEvent } from 'electron'
import {
  NATIVE_ENCODE_SCHEME,
  NATIVE_JOB_ID_PATTERN,
  NATIVE_MEDIA_CHANNELS,
  NATIVE_PROTOCOL_HEADERS,
  NativeEngineFailure,
  nativeEngineErrorPayload,
  parseEncodeUrl,
  preciseOutputFrameBytes,
  type EncodeStartReply,
  type NativeMediaAnswer,
  type NativeProgress,
} from '../../shared/native-media'
import { isAppUrl, appOnly, appOnlySend } from '../sender'
import { answerAudioRequest, NATIVE_AUDIO_ROUTE } from './audio-protocol'
import { audioStage } from './audio-stage'
import { EncodeJobs, pipeBodyIntoJob, spawnEncode } from './encode-stream'
import { parseEncodeStartRequest } from './encode-request'
import { ffmpegCapabilities, ffmpegLocation, missingFfmpegMessage } from './ffmpeg'
import { chooseEncoder, encodeArguments, isHardwareEncoder } from './formats'
import {
  checkOutputPath,
  commitOutput,
  discardPartial,
  outputGrants,
  partialPathFor,
  type OutputGrants,
} from './output-file'
import { WindowJobs } from './window-jobs'

/** The scheme's privileges: the same as the frame scheme's (`frame-protocol.ts`). */
export const NATIVE_ENCODE_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: NATIVE_ENCODE_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}

const jobs = new EncodeJobs({ spawn: spawnEncode })

/**
 * One export at a time per window; the others of the window are refused. No idle sweep, as for the muxer's route
 * (`export-file-protocol.ts`): a heavy frame can take minutes, and the page being gone (navigation, crash, closed
 * window, an aborted POST) already ends the job.
 */
const windowJobs = new WindowJobs({
  cancel: (jobId) => jobs.cancel(jobId),
  maxPerWindow: 1,
  idleMs: Number.POSITIVE_INFINITY,
  call: 'encode.start',
  noun: 'encodes',
})

const IDLE_SWEEP_MS = 5_000
const FORBIDDEN = 403
const BAD_REQUEST = 400
const FAILED = 500

/** Registers the scheme's handler and the IPC; call after `app.whenReady()`. */
export function registerNativeEncodeProtocol(grants: OutputGrants = outputGrants): void {
  void audioStage.clearFolder()
  protocol.handle(NATIVE_ENCODE_SCHEME, (request) => answerReadback(request))
  ipcMain.handle(
    NATIVE_MEDIA_CHANNELS.encodeStart,
    appOnly((event: IpcMainInvokeEvent, raw: unknown) => answerEncodeStart(grants, event, raw)),
  )
  ipcMain.on(
    NATIVE_MEDIA_CHANNELS.cancel,
    appOnlySend((_event, raw: unknown) => {
      const jobId = jobIdOf(raw)
      if (jobId === null) return
      void audioStage.remove(jobId)
      if (!jobs.has(jobId)) return
      windowJobs.release(jobId)
      jobs.cancel(jobId)
    }),
  )
  setInterval(() => {
    windowJobs.sweep()
    void audioStage.sweep()
  }, IDLE_SWEEP_MS).unref()
}

async function answerReadback(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin !== null && !isAppUrl(origin)) return text(FORBIDDEN, 'not the app’s page')
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...NATIVE_PROTOCOL_HEADERS,
        ...(origin === null ? {} : { 'Access-Control-Allow-Origin': origin }),
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'content-type',
      },
    })
  }
  if (request.method !== 'POST') return text(BAD_REQUEST, `${request.method} is not a readback request`)
  if (new URL(request.url).host === NATIVE_AUDIO_ROUTE) {
    const answer = await answerAudioRequest(audioStage, request, NATIVE_ENCODE_SCHEME)
    return answer.ok ? json(200, answer.reply, origin) : text(BAD_REQUEST, answer.message)
  }

  const parsed = parseEncodeUrl(request.url)
  if (!parsed.ok) return text(BAD_REQUEST, parsed.reason)
  if (request.body === null) return text(BAD_REQUEST, 'the readback needs a body')

  const { jobId } = parsed
  // A page that gives up (navigation, an aborted fetch) stops the encoder and removes the file.
  request.signal.addEventListener('abort', () => {
    windowJobs.release(jobId)
    jobs.cancel(jobId)
  })
  try {
    const reply = await pipeBodyIntoJob(jobs, jobId, request.body, {
      started: () => windowJobs.readStarted(jobId),
      finished: () => windowJobs.readFinished(jobId),
    })
    windowJobs.release(jobId)
    return json(200, reply, origin)
  } catch (error) {
    windowJobs.release(jobId)
    jobs.cancel(jobId)
    return json(FAILED, nativeEngineErrorPayload(error), origin)
  }
}

/** `encode.start`: validate, choose the encoder, spawn FFmpeg, answer the reply. */
async function answerEncodeStart(
  grants: OutputGrants,
  event: IpcMainInvokeEvent,
  raw: unknown,
): Promise<NativeMediaAnswer<EncodeStartReply>> {
  let audioJobId: string | null = null
  let started = false
  try {
    const request = parseEncodeStartRequest(raw)
    audioJobId = request.jobId
    windowJobs.assertRoom(event.sender.id)
    await checkOutputPath(request.path, request.format)
    if (!grants.has(request.path)) {
      throw new Error(
        `encode.start: ${JSON.stringify(request.path)} is not a path the user chose in a save dialog`,
      )
    }
    const location = ffmpegLocation()
    if (location === null) {
      throw new NativeEngineFailure({
        message: missingFfmpegMessage(),
        command: [],
        exitCode: null,
        signal: null,
        log: [],
      })
    }
    const capabilities = await ffmpegCapabilities()
    const encoder = chooseEncoder(request.format, capabilities.encoders, process.platform)
    if (encoder === null) {
      throw new Error(`encode.start: this FFmpeg has no encoder for ${request.format}`)
    }
    // The project's mix, if the page staged one (null: a project with no sound, which has no audio stream).
    const mix = audioStage.take(request.jobId)
    const args = encodeArguments({
      format: request.format,
      encoder,
      readback: request.readback,
      width: request.width,
      height: request.height,
      fps: request.fps,
      bitrate: request.bitrate,
      tags: request.tags,
      ...(mix === null ? {} : { mix: { file: mix.file } }),
      // FFmpeg writes beside the final path and `commit` renames it, so a file the user
      // already had survives a failed or cancelled export.
      path: partialPathFor(request.path),
    })
    const frameBytes = preciseOutputFrameBytes(request.readback, request.width, request.height)

    if (!grants.claim(request.path)) throw new Error('encode.start: the path grant was used up')
    windowJobs.admit(event.sender, request.jobId)
    try {
      jobs.start({
        jobId: request.jobId,
        frameBytes,
        ffmpeg: location.ffmpeg,
        args,
        path: request.path,
        onFrame: (framesDone) => {
          if (event.sender.isDestroyed()) return
          const progress: NativeProgress = {
            jobId: request.jobId,
            phase: 'encode',
            framesDone,
            framesTotal: 0,
          }
          event.sender.send(NATIVE_MEDIA_CHANNELS.progress, progress)
        },
        discard: async () => {
          await audioStage.remove(request.jobId)
          await discardPartial(partialPathFor(request.path))
        },
        commit: async () => {
          await commitOutput(partialPathFor(request.path), request.path)
          await audioStage.remove(request.jobId)
        },
      })
      started = true
    } catch (error) {
      windowJobs.release(request.jobId)
      throw error
    }
    console.log(
      `[desktop] encode ${request.jobId}: ${request.format} with ${encoder} ` +
        `(${isHardwareEncoder(encoder) ? 'hardware' : 'software'})` +
        (mix === null ? ', no sound' : `, sound ${mix.samples} samples`),
    )
    return { ok: true, value: { readback: request.readback, frameBytes } }
  } catch (error) {
    // A start that did not get as far as the job leaves no staged mix behind.
    if (!started && audioJobId !== null) await audioStage.remove(audioJobId)
    return { ok: false, error: nativeEngineErrorPayload(error) }
  }
}

function jobIdOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const jobId = (raw as Record<string, unknown>).jobId
  return typeof jobId === 'string' && NATIVE_JOB_ID_PATTERN.test(jobId) ? jobId : null
}

function text(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { ...NATIVE_PROTOCOL_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...NATIVE_PROTOCOL_HEADERS,
      'Content-Type': 'application/json',
      ...(origin === null ? {} : { 'Access-Control-Allow-Origin': origin }),
    },
  })
}
