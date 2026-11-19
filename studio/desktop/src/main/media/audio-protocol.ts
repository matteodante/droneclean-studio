/**
 * The audio half of the `droneclean-encode:` scheme (no Electron import, so a test drives it with a plain `Request`).
 *
 * `POST droneclean-encode://audio/<jobId>/<n>` appends chunk `n` of the job's mix (`audio-stage.ts`); `POST
 * droneclean-encode://audio/<jobId>/end?chunks=<count>` closes it. Both answer 200 with a JSON `AudioReply`, or a
 * 400 whose body is the reason. The page sends the chunks in order and waits for each answer.
 */
import { NATIVE_JOB_ID_PATTERN } from '../../shared/native-media'
import { AUDIO_FRAME_BYTES, type AudioStage } from './audio-stage'

/** The host of the audio route. */
export const NATIVE_AUDIO_ROUTE = 'audio'

/** What both audio requests answer. */
export interface AudioReply {
  readonly chunks: number
  readonly samples: number
}

/** A chunk request's parts, or why the URL is not one. */
export type ParsedAudioUrl =
  | { readonly ok: true; readonly jobId: string; readonly part: number | 'end'; readonly chunks: number | null }
  | { readonly ok: false; readonly reason: string }

/** Reads `droneclean-encode://audio/<jobId>/<n>` and `.../end?chunks=<count>`. */
export function parseAudioUrl(href: string, scheme: string): ParsedAudioUrl {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { ok: false, reason: `not a URL: ${JSON.stringify(href)}` }
  }
  if (url.protocol !== `${scheme}:`) return { ok: false, reason: `wrong scheme: ${url.protocol}` }
  if (url.host !== NATIVE_AUDIO_ROUTE) return { ok: false, reason: `wrong route: ${url.host}` }
  const segments = url.pathname.split('/').slice(1)
  if (segments.length !== 2) return { ok: false, reason: 'an audio URL is /<jobId>/<n> or /<jobId>/end' }
  const [jobId = '', rawPart = ''] = segments
  if (!NATIVE_JOB_ID_PATTERN.test(jobId)) return { ok: false, reason: `invalid job id: ${JSON.stringify(jobId)}` }
  if (rawPart === 'end') {
    const raw = url.searchParams.get('chunks')
    if (raw === null || !/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return { ok: false, reason: 'the end of a mix says how many chunks it had: ?chunks=<count>' }
    }
    return { ok: true, jobId, part: 'end', chunks: Number(raw) }
  }
  if (!/^(0|[1-9]\d*)$/.test(rawPart) || !Number.isSafeInteger(Number(rawPart))) {
    return { ok: false, reason: `invalid chunk number: ${JSON.stringify(rawPart)}` }
  }
  return { ok: true, jobId, part: Number(rawPart), chunks: null }
}

/** Answers one audio request; `ok` false means a 400 with `message`. */
export async function answerAudioRequest(
  stage: AudioStage,
  request: Pick<Request, 'url' | 'method' | 'arrayBuffer'>,
  scheme: string,
): Promise<{ readonly ok: true; readonly reply: AudioReply } | { readonly ok: false; readonly message: string }> {
  if (request.method !== 'POST') return { ok: false, message: `${request.method} is not an audio request` }
  const parsed = parseAudioUrl(request.url, scheme)
  if (!parsed.ok) return { ok: false, message: parsed.reason }
  try {
    if (parsed.part === 'end') {
      const done = await stage.end(parsed.jobId, parsed.chunks ?? 0)
      return { ok: true, reply: { chunks: done.chunks, samples: done.samples } }
    }
    const bytes = new Uint8Array(await request.arrayBuffer())
    await stage.append(parsed.jobId, parsed.part, bytes)
    return { ok: true, reply: { chunks: parsed.part + 1, samples: bytes.byteLength / AUDIO_FRAME_BYTES } }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
