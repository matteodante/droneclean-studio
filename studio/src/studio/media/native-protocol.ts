/**
 * The wire between the page and the desktop shell's native media engine (FFmpeg), fixed once for
 * phase 3 so that P4's decoder and P5's encoder implement one side and the render worker calls the
 * other (design §0 decision 1 and §4.1).
 *
 * Two custom-protocol streams carry the pixels, because neither a `MessagePort` (it copies) nor a
 * `SharedArrayBuffer` (Electron refuses to clone one across `ipc`) can carry 66 MB frames at the
 * measured rate:
 *
 * - **FFmpeg → page** `GET droneclean-frame://decode/<jobId>/<frameIndex>`. One response body of
 *   `preciseFrameBytes(format, width, height)` bytes: one decoded frame's planes, packed, in
 *   `precisePlaneLayout` order, with no framing header. The body answers `Content-Length`,
 *   `Accept-Ranges: bytes` and a single `Range` (206 with `Content-Range`), so a frame whose read
 *   broke at 40 MB is resumed rather than decoded again. The other statuses are the handler's whole
 *   answer: 400 for a URL that names no frame, 404 for a job it does not know, 410 for a frame that
 *   will never be there (past the end of the file, a cancelled job, or a frame the ring dropped
 *   because the page read slower than the decoder), and 416 with the unsatisfied `Content-Range`
 *   (`bytes`, a star and the frame's length) for a range that starts past the frame.
 * - **page → FFmpeg** `POST droneclean-encode://encode/<jobId>` with `duplex: 'half'` and a
 *   `ReadableStream` body: the readback, `preciseReadbackBytes(readback, width, height)` bytes per
 *   frame, back to back, no framing header. The handler pipes the body into FFmpeg's stdin; one
 *   frame's write completes only when the ring has room, which is the backpressure. The reply is
 *   `EncodeReply` (200) or a 500 whose body is a `NativeEngineErrorPayload`.
 *
 * The control messages (start, progress, cancel, capabilities) travel on the shell's IPC channels;
 * their names and shapes are here too. The page learns the source's geometry and rate from
 * `DecodeStartReply` and the readback format and frame length from `EncodeStartReply`, because only
 * the shell has run ffprobe and only it decides whether `p010le` is available.
 *
 * A frame's length is fixed by its format, so nothing on this wire is framed: the reader knows where
 * frame `k` starts (`k * frameBytes`) and the writer never prefixes a length.
 */

import type {
  ColourTags,
  PreciseExportFormatId,
  PreciseInputFormat,
  PreciseOutputFormat,
  Rate,
} from '@/studio/render/precise/contract'

/**
 * The scheme of the decode stream, FFmpeg → page. The shell registers it as privileged with
 * `standard`, `secure`, `supportFetchAPI` and `corsEnabled` (the settings the prototype measured).
 */
export const NATIVE_FRAME_SCHEME = 'droneclean-frame'

/** The scheme of the readback stream, page → FFmpeg, with the same privileges. */
export const NATIVE_ENCODE_SCHEME = 'droneclean-encode'

/**
 * The decode stream's read-ahead rule: a page keeps at most this many frame GETs of one decode in
 * flight, and asks for frame `k + 3` only once it has read frame `k` whole. The shell relies on it
 * to reuse frame `k`'s buffer as soon as frame `k + 3` is asked for (design 3.6 section 2.16: the
 * ring is allocated once per decode, never per frame).
 */
export const NATIVE_FRAME_READ_AHEAD = 3

/** A job id names one decode or one encode run in its URLs: 1–64 of `A–Z a–z 0–9 _ -`. */
export const NATIVE_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Both protocol routes are named by their host: `decode` for frames in, `encode` for readback out. */
const DECODE_ROUTE = 'decode'
const ENCODE_ROUTE = 'encode'

/**
 * The headers every native-protocol response carries. The app runs cross-origin isolated, so a
 * resource from another scheme must be both COEP-compliant and explicitly embeddable; and no
 * response may be cached: a frame exists once, in a ring of two or three.
 */
export const NATIVE_PROTOCOL_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/octet-stream',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/** An inclusive byte range of a frame: `start` and `end` are both inside the body. */
export interface ByteRange {
  readonly start: number
  readonly end: number
}

/**
 * What a `Range` request asks for: the whole frame (no header), one inclusive range, a range that
 * starts past the frame (416), or a header the handler must ignore and answer in full (`invalid`,
 * with the reason for the log).
 *
 * An `invalid` header is answered with the whole frame, as HTTP requires for a range unit or a
 * syntax a server does not understand, so a broken resume never fails a frame.
 */
export type ByteRangeRequest =
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' }
  | { readonly kind: 'invalid'; readonly reason: string }

/**
 * Parses a `Range` request header against a frame's length (RFC 9110 §14.2: `bytes=0-1023`,
 * `bytes=1024-`, `bytes=-1024`). Only one range is accepted; a multi-range request is `invalid`,
 * because the page only ever resumes one frame.
 */
export function parseByteRange(header: string | null, totalBytes: number): ByteRangeRequest {
  if (header === null || header.trim() === '') return { kind: 'full' }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) {
    return { kind: 'invalid', reason: `not a single bytes range: ${JSON.stringify(header)}` }
  }

  const first = match[1] ?? ''
  const last = match[2] ?? ''
  if (first === '') {
    return last === ''
      ? { kind: 'invalid', reason: 'a bytes range needs a start or a suffix length' }
      : parseSuffixRange(last, totalBytes)
  }
  return parseFirstRange(first, last, totalBytes)
}

/** `bytes=-1024`: the frame's last `suffixLength` bytes, or all of it when it is shorter. */
function parseSuffixRange(suffixLengthText: string, totalBytes: number): ByteRangeRequest {
  const suffixLength = Number(suffixLengthText)
  if (!Number.isSafeInteger(suffixLength) || suffixLength < 0) {
    return { kind: 'invalid', reason: `not a suffix length: ${suffixLengthText}` }
  }
  if (suffixLength === 0 || totalBytes === 0) return { kind: 'unsatisfiable' }
  return { kind: 'partial', start: Math.max(0, totalBytes - suffixLength), end: totalBytes - 1 }
}

/** `bytes=1024-` or `bytes=0-1023`: an inclusive range, clamped to the frame's last byte. */
function parseFirstRange(
  firstText: string,
  lastText: string,
  totalBytes: number,
): ByteRangeRequest {
  const start = Number(firstText)
  if (!Number.isSafeInteger(start) || start < 0) {
    return { kind: 'invalid', reason: `not a first position: ${firstText}` }
  }
  if (start >= totalBytes) return { kind: 'unsatisfiable' }
  if (lastText === '') return { kind: 'partial', start, end: totalBytes - 1 }

  const requestedEnd = Number(lastText)
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return { kind: 'invalid', reason: `not a last position after ${start}: ${lastText}` }
  }
  return { kind: 'partial', start, end: Math.min(requestedEnd, totalBytes - 1) }
}

/**
 * The `Content-Range` of a frame's response: `bytes 0-1023/66355200` for a partial one, and the
 * unsatisfied form (`bytes`, a star and the total) for a 416 that says how long the frame was.
 */
export function contentRangeHeader(totalBytes: number, range: ByteRange | null): string {
  return range ? `bytes ${range.start}-${range.end}/${totalBytes}` : `bytes */${totalBytes}`
}

/**
 * The headers the main process answers a decoded frame's GET with: the protocol's own,
 * `Accept-Ranges`, the length of the body — the whole frame (200) or the requested part (206, with
 * `Content-Range` and the part's `Content-Length`).
 */
export function preciseFrameHeaders(
  totalBytes: number,
  range: ByteRange | null = null,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...NATIVE_PROTOCOL_HEADERS,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(range ? range.end - range.start + 1 : totalBytes),
  }
  if (range) headers['Content-Range'] = contentRangeHeader(totalBytes, range)
  return headers
}

/** Where one decoded frame is: the job it belongs to and its index from the job's first frame. */
export interface PreciseFrameRequest {
  readonly jobId: string
  readonly frameIndex: number
}

/** The result of parsing a frame URL: the request, or why the URL names no frame. */
export type ParsedPreciseFrameUrl =
  | { readonly ok: true; readonly jobId: string; readonly frameIndex: number }
  | { readonly ok: false; readonly reason: string }

function assertJobId(jobId: string): void {
  if (!NATIVE_JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`Invalid native media job id: ${JSON.stringify(jobId)}`)
  }
}

/**
 * The URL of one decoded frame: `droneclean-frame://decode/<jobId>/<frameIndex>`. Throws on an id
 * that `NATIVE_JOB_ID_PATTERN` rejects or an index that is not a non-negative integer, because both
 * are programming errors at the caller.
 */
export function preciseFrameUrl(request: PreciseFrameRequest): string {
  assertJobId(request.jobId)
  if (!Number.isSafeInteger(request.frameIndex) || request.frameIndex < 0) {
    throw new Error(`Invalid decoded frame index: ${request.frameIndex}`)
  }
  return `${NATIVE_FRAME_SCHEME}://${DECODE_ROUTE}/${request.jobId}/${request.frameIndex}`
}

/**
 * Reads a frame URL back: `droneclean-frame://decode/<jobId>/<frameIndex>` and nothing else. A wrong
 * scheme, route, id, index or an extra path segment is a refusal with the reason, so the handler can
 * answer 400 instead of guessing.
 */
export function parsePreciseFrameUrl(href: string): ParsedPreciseFrameUrl {
  const url = parseProtocolUrl(href)
  if (!url.ok) return url
  if (url.url.protocol !== `${NATIVE_FRAME_SCHEME}:`) {
    return { ok: false, reason: `wrong scheme: ${url.url.protocol}` }
  }
  if (url.url.host !== DECODE_ROUTE) {
    return { ok: false, reason: `wrong route: ${url.url.host}` }
  }

  const segments = url.url.pathname.split('/').slice(1)
  if (segments.length !== 2) {
    return { ok: false, reason: 'a frame URL is /<jobId>/<frameIndex>' }
  }
  const [jobId = '', rawIndex = ''] = segments
  if (!NATIVE_JOB_ID_PATTERN.test(jobId)) {
    return { ok: false, reason: `invalid job id: ${JSON.stringify(jobId)}` }
  }
  if (!/^(0|[1-9]\d*)$/.test(rawIndex)) {
    return { ok: false, reason: `invalid frame index: ${JSON.stringify(rawIndex)}` }
  }

  const frameIndex = Number(rawIndex)
  if (!Number.isSafeInteger(frameIndex)) {
    return { ok: false, reason: `frame index out of range: ${rawIndex}` }
  }
  return { ok: true, jobId, frameIndex }
}

/**
 * The URL an encode's readback is POSTed to: `droneclean-encode://encode/<jobId>`, with
 * `duplex: 'half'` and a `ReadableStream` body. Throws on an id that `NATIVE_JOB_ID_PATTERN`
 * rejects.
 */
export function preciseReadbackUrl(jobId: string): string {
  assertJobId(jobId)
  return `${NATIVE_ENCODE_SCHEME}://${ENCODE_ROUTE}/${jobId}`
}

/** The result of parsing a readback URL: the job, or why the URL names no encode. */
export type ParsedPreciseReadbackUrl =
  | { readonly ok: true; readonly jobId: string }
  | { readonly ok: false; readonly reason: string }

/** Reads a readback URL back: `droneclean-encode://encode/<jobId>` and nothing else. */
export function parsePreciseReadbackUrl(href: string): ParsedPreciseReadbackUrl {
  const url = parseProtocolUrl(href)
  if (!url.ok) return url
  if (url.url.protocol !== `${NATIVE_ENCODE_SCHEME}:`) {
    return { ok: false, reason: `wrong scheme: ${url.url.protocol}` }
  }
  if (url.url.host !== ENCODE_ROUTE) {
    return { ok: false, reason: `wrong route: ${url.url.host}` }
  }

  const segments = url.url.pathname.split('/').slice(1)
  if (segments.length !== 1) {
    return { ok: false, reason: 'a readback URL is /<jobId>' }
  }
  const [jobId = ''] = segments
  if (!NATIVE_JOB_ID_PATTERN.test(jobId)) {
    return { ok: false, reason: `invalid job id: ${JSON.stringify(jobId)}` }
  }
  return { ok: true, jobId }
}

type ParsedProtocolUrl =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: string }

function parseProtocolUrl(href: string): ParsedProtocolUrl {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { ok: false, reason: `not a URL: ${JSON.stringify(href)}` }
  }
  return { ok: true, url }
}

/**
 * The page's request to decode: the file, where in it the first frame is (`startSeconds`, the only
 * seconds on this wire: a seek is a source time, not an index), how many frames follow it, and the
 * pixel format FFmpeg converts to. `jobId` names the run in every frame URL and in `progress`.
 *
 * Answered with `DecodeStartReply`, or rejected with a `NativeEngineErrorPayload`.
 */
export interface DecodeStartRequest {
  readonly jobId: string
  readonly file: string
  readonly startSeconds: number
  readonly frames: number
  readonly format: PreciseInputFormat
}

/**
 * What the decoder answers once it has probed the source and started: the frame's size (the page
 * cannot assemble a frame without it), the source's exact rate (so frame `k` has a real time), the
 * colour it reports, the format the frames come in — the one asked for, or `gbrp10le` when the
 * source cannot travel as `p010le` (not 4:2:0, more than 10 bits, full range, or a matrix the GPU
 * does not convert) — and the fixed byte length of one frame in that format.
 */
export interface DecodeStartReply {
  readonly width: number
  readonly height: number
  readonly rate: Rate
  readonly colour: ColourTags
  readonly format: PreciseInputFormat
  readonly frameBytes: number
}

/**
 * The page's request to encode: which of `EXPORT_FORMATS` (`format`), where the file goes
 * (`path`), the readback format on the wire (`readback`: `p010le`, or `rgba64le` when the shell has
 * not got `p010le`), the encoder's video bitrate in bits per second, the exact rate (`-r
 * num/den`), the tags every output carries, and the project size the readback is packed at — from
 * which the frame's length follows.
 *
 * Answered with `EncodeStartReply`, or rejected with a `NativeEngineErrorPayload`.
 */
export interface EncodeStartRequest {
  readonly jobId: string
  readonly path: string
  readonly format: PreciseExportFormatId
  readonly readback: PreciseOutputFormat
  readonly bitrate: number
  readonly fps: Rate
  readonly tags: ColourTags
  readonly width: number
  readonly height: number
}

/**
 * What the encoder answers: the readback format it will take — the one asked for, or `rgba64le`
 * when it cannot take `p010le` — and one frame's fixed byte length, which the page uses to cut the
 * POST body.
 */
export interface EncodeStartReply {
  readonly readback: PreciseOutputFormat
  readonly frameBytes: number
}

/**
 * What the readback POST answers when the encoder finished: the frames it wrote and the file it
 * wrote them to. A failure answers 500 with a `NativeEngineErrorPayload` body instead.
 */
export interface EncodeReply {
  readonly framesWritten: number
  readonly path: string
}

/** How far a job has got; the shell sends one per frame boundary, not per byte. */
export interface NativeProgress {
  readonly jobId: string
  readonly phase: 'decode' | 'encode'
  readonly framesDone: number
  readonly framesTotal: number
}

/** Stops a job: the shell kills its FFmpeg process, frees the ring and makes further GETs 410. */
export interface CancelRequest {
  readonly jobId: string
}

/**
 * The IPC channels of the control messages. `decodeStart` and `encodeStart` are `invoke`s answered
 * by `DecodeStartReply` and `EncodeStartReply`, `cancel` is a send, `progress` is an event the shell
 * sends, and `capabilities` is the `invoke` behind 3.4's dialog; a failed `invoke` rejects with a
 * `NativeEngineErrorPayload`.
 */
export const NATIVE_MEDIA_CHANNELS = {
  decodeStart: 'native-media:decode.start',
  encodeStart: 'native-media:encode.start',
  cancel: 'native-media:cancel',
  progress: 'native-media:progress',
  capabilities: 'native-media:capabilities',
} as const

/** One of the control channels above. */
export type NativeMediaChannel = (typeof NATIVE_MEDIA_CHANNELS)[keyof typeof NATIVE_MEDIA_CHANNELS]
