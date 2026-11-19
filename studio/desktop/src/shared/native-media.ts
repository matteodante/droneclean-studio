/**
 * The desktop shell's copy of the native media wire (task 3.1, slices P4 and P5).
 *
 * The contract is `studio/src/studio/media/native-protocol.ts` and
 * `studio/src/studio/render/precise/contract.ts`, which live in the editor's
 * TypeScript project. The shell is a project of its own
 * (`studio/desktop/tsconfig.json`, its own `rootDir`), so it cannot import them:
 * this file is the shell's copy of the part of that wire the shell speaks, and
 * `studio/src/studio/render/precise/native-wire.test.ts` holds the two together.
 * That test compares the values here with the contract's at run time and the
 * shapes at compile time, so a change made on one side only fails a test instead
 * of a decode.
 *
 * What is here: the scheme and URL of a decoded frame, the headers and statuses
 * its GET answers, the IPC channels of the control messages, the request and
 * reply shapes, the engine's error payload, and the three pure helpers the shell
 * needs a copy of — the frame's byte length, the colour-tag default, and the
 * `Range` parsing. Everything in this file is free of Node and Electron imports,
 * which is what lets a unit test load it and the sandboxed preload type against
 * it.
 *
 * What is not here: how a frame is decoded (`main/media/ffmpeg.ts`), how frames
 * are held and handed out (`main/media/decode-stream.ts`), and how the wire is
 * answered (`main/media/frame-protocol.ts`).
 */

/** A rate in frames per second, as an exact ratio (`contract.ts`). */
export interface Rate {
  readonly num: number
  readonly den: number
}

/** FFmpeg's name for the matrix that turned the source's YUV into RGB (`contract.ts`). */
export type ColourMatrix = 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020nc' | 'unknown'

/** Whether the source's code values are limited (`tv`) or full range (`pc`) (`contract.ts`). */
export type ColourRange = 'tv' | 'pc' | 'unknown'

/** The source's transfer characteristic (`contract.ts`). */
export type ColourTransfer =
  | 'bt709'
  | 'smpte170m'
  | 'linear'
  | 'bt2020-10'
  | 'smpte2084'
  | 'arib-std-b67'
  | 'unknown'

/** The source's primaries (`contract.ts`). */
export type ColourPrimaries = 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020' | 'unknown'

/** The colour a decoded frame carries, in FFmpeg's own names (`contract.ts`). */
export interface ColourTags {
  readonly matrix: ColourMatrix
  readonly range: ColourRange
  readonly transfer: ColourTransfer
  readonly primaries: ColourPrimaries
}

/** The pixel formats a decoded frame arrives in (`contract.ts`; `p010le` since design 3.6 section 2.16). */
export type PreciseInputFormat = 'p010le' | 'gbrp10le' | 'rgba64le'

/** The pixel formats a readback leaves in (`contract.ts`); P5's business. */
export type PreciseOutputFormat = 'p010le' | 'rgba64le'

/** The four outputs the native encoder writes (`contract.ts`); 3.4 lists them. */
export type PreciseExportFormatId = 'hevc-main10' | 'prores-422-hq' | 'h264-8bit' | 'hevc-8bit'

/** The tags every output file carries (`contract.ts`); `resolveSourceColourTags` fills a gap with them. */
const OUTPUT_COLOUR_TAGS: ColourTags = {
  matrix: 'bt709',
  range: 'tv',
  transfer: 'bt709',
  primaries: 'bt709',
}

/** How many of an FFmpeg run's last log lines an error keeps (`contract.ts`). */
export const NATIVE_ENGINE_LOG_LINES = 20

/**
 * The scheme of the decode stream, FFmpeg to the page (`native-protocol.ts`). It
 * is registered as privileged with `standard`, `secure`, `supportFetchAPI` and
 * `corsEnabled`, the settings the design's prototype measured.
 */
export const NATIVE_FRAME_SCHEME = 'droneclean-frame'

/** The route inside the frame scheme's host: a decoded frame's URL is `/<jobId>/<frameIndex>`. */
const NATIVE_FRAME_ROUTE = 'decode'

/** A job id names one decode run in its URLs (`native-protocol.ts`): 1–64 of `A–Z a–z 0–9 _ -`. */
export const NATIVE_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The headers every native-protocol response carries (`native-protocol.ts`): the
 * editor runs cross-origin isolated, so a resource from another scheme must be
 * both COEP-compliant and explicitly embeddable, and no response may be cached —
 * a frame exists once, in a ring of three.
 *
 * No `Access-Control-Allow-Origin` is needed: measured in Electron 45, a
 * `droneclean://app` page and an `http://localhost` page both read a
 * `droneclean-frame:` response without one, because the scheme is registered
 * with `corsEnabled` and `supportFetchAPI`.
 */
export const NATIVE_PROTOCOL_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/octet-stream',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/**
 * The statuses a frame's GET answers (`native-protocol.ts`): the whole frame
 * (200), one requested byte range (206), a URL that names no frame (400), a job
 * the handler does not know (404), a frame that will never be there (410), and a
 * range that starts past the frame (416).
 */
export const NATIVE_FRAME_STATUS = {
  ok: 200,
  partialContent: 206,
  badRequest: 400,
  notFound: 404,
  gone: 410,
  rangeNotSatisfiable: 416,
} as const

/**
 * The IPC channels of the control messages (`native-protocol.ts`). The preload
 * cannot require this file — a sandboxed preload may only load `electron` — so
 * the strings there are written out and a test compares the two.
 */
export const NATIVE_MEDIA_CHANNELS = {
  decodeStart: 'native-media:decode.start',
  encodeStart: 'native-media:encode.start',
  cancel: 'native-media:cancel',
  progress: 'native-media:progress',
  capabilities: 'native-media:capabilities',
} as const

/**
 * The page's request to decode (`native-protocol.ts`): the file, where in it the
 * first frame is (`startSeconds`, the only seconds on this wire: a seek is a
 * source time, not an index), how many frames follow it, and the pixel format
 * FFmpeg converts to. `jobId` names the run in every frame URL and in
 * `progress`.
 */
export interface DecodeStartRequest {
  readonly jobId: string
  readonly file: string
  readonly startSeconds: number
  readonly frames: number
  readonly format: PreciseInputFormat
}

/**
 * What the decoder answers once it has probed the source and started
 * (`native-protocol.ts`): the frame's size, the source's exact rate, the colour
 * it reported, the format the frames come in (the one asked for, or `gbrp10le`
 * when the source cannot travel as `p010le`), and the fixed byte length of one
 * frame in that format.
 */
export interface DecodeStartReply {
  readonly width: number
  readonly height: number
  readonly rate: Rate
  readonly colour: ColourTags
  readonly format: PreciseInputFormat
  readonly frameBytes: number
}

/** The scheme of the readback stream, page to FFmpeg (`native-protocol.ts`), privileged like the frame scheme. */
export const NATIVE_ENCODE_SCHEME = 'droneclean-encode'

/** The route inside the encode scheme's host: the readback is POSTed to `/<jobId>`. */
const NATIVE_ENCODE_ROUTE = 'encode'

/**
 * The page's request to encode (`native-protocol.ts`): the format, the final
 * path, the readback format on the wire, the video bitrate in bits per second,
 * the exact rate, the tags every output carries, and the project size the
 * readback is packed at.
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

/** What the encoder answers (`native-protocol.ts`): the readback it takes and one frame's byte length. */
export interface EncodeStartReply {
  readonly readback: PreciseOutputFormat
  readonly frameBytes: number
}

/** What the readback POST answers when the encoder finished (`native-protocol.ts`). */
export interface EncodeReply {
  readonly framesWritten: number
  readonly path: string
}

/**
 * The fixed byte length of one readback frame (`contract.ts`'s
 * `preciseReadbackBytes`): `p010le` is a 16-bit luma plane and one half-height
 * plane of 16-bit U,V pairs (3 bytes a pixel), `rgba64le` is 8 bytes a pixel.
 */
export function preciseOutputFrameBytes(
  format: PreciseOutputFormat,
  width: number,
  height: number,
): number {
  if (format === 'rgba64le') return width * height * 8
  return width * height * 2 + Math.ceil(width / 2) * 2 * 2 * Math.ceil(height / 2)
}

/** Reads a readback URL back (`native-protocol.ts`): `droneclean-encode://encode/<jobId>` and nothing else. */
export function parseEncodeUrl(
  href: string,
): { readonly ok: true; readonly jobId: string } | { readonly ok: false; readonly reason: string } {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { ok: false, reason: `not a URL: ${JSON.stringify(href)}` }
  }
  if (url.protocol !== `${NATIVE_ENCODE_SCHEME}:`) {
    return { ok: false, reason: `wrong scheme: ${url.protocol}` }
  }
  if (url.host !== NATIVE_ENCODE_ROUTE) return { ok: false, reason: `wrong route: ${url.host}` }
  const segments = url.pathname.split('/').slice(1)
  if (segments.length !== 1) return { ok: false, reason: 'a readback URL is /<jobId>' }
  const [jobId = ''] = segments
  if (!NATIVE_JOB_ID_PATTERN.test(jobId)) {
    return { ok: false, reason: `invalid job id: ${JSON.stringify(jobId)}` }
  }
  return { ok: true, jobId }
}

/** How far a job has got (`native-protocol.ts`); one message per frame boundary. */
export interface NativeProgress {
  readonly jobId: string
  readonly phase: 'decode' | 'encode'
  readonly framesDone: number
  readonly framesTotal: number
}

/** Stops a job (`native-protocol.ts`): the shell kills FFmpeg, frees the ring, further GETs are 410. */
export interface CancelRequest {
  readonly jobId: string
}

/** A failure as it crosses a process boundary (`contract.ts`'s `NativeEngineErrorPayload`). */
export interface NativeEngineErrorPayload {
  readonly message: string
  readonly command: readonly string[]
  readonly exitCode: number | null
  readonly signal: string | null
  readonly log: readonly string[]
}

/**
 * What an `invoke` answers: the reply, or the failure as a plain object.
 *
 * Electron's `ipcRenderer.invoke` carries only an `Error`'s message back from a
 * rejected handler, so the payload travels as a value; the page's
 * `native-source.ts` turns `{ ok: false }` back into the contract's
 * `NativeEngineError` before its caller sees it.
 */
export type NativeMediaAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: NativeEngineErrorPayload }

/** What the running shell's media engine can do (`contract.ts`); 3.4 reads it once per session. */
export interface NativeEngineCapabilities {
  readonly available: boolean
  readonly version: string | null
  readonly decoders: readonly string[]
  readonly encoders: readonly string[]
  readonly hardware: readonly NativeHardware[]
  readonly inputFormats: readonly PreciseInputFormat[]
  readonly outputFormats: readonly PreciseOutputFormat[]
  readonly exportFormats: readonly PreciseExportFormatId[]
  readonly message: string | null
}

/** The hardware paths the engine can encode or decode through (`contract.ts`). */
export type NativeHardware = 'videotoolbox' | 'nvenc' | 'qsv' | 'amf' | 'd3d11va'

/**
 * A failure of the native media engine, as the shell raises it: the FFmpeg
 * command, its exit code and the last lines it logged. `toPayload` is the shape
 * the IPC answers and the 410 body carries.
 */
export class NativeEngineFailure extends Error {
  readonly command: readonly string[]
  readonly exitCode: number | null
  readonly signal: string | null
  readonly log: readonly string[]

  constructor(payload: NativeEngineErrorPayload) {
    super(payload.message)
    this.name = 'NativeEngineFailure'
    this.command = payload.command
    this.exitCode = payload.exitCode
    this.signal = payload.signal
    this.log = payload.log.slice(-NATIVE_ENGINE_LOG_LINES)
  }

  toPayload(): NativeEngineErrorPayload {
    return {
      message: this.message,
      command: this.command,
      exitCode: this.exitCode,
      signal: this.signal,
      log: this.log,
    }
  }
}

/** The payload of anything caught in the shell: an engine failure keeps its command and log. */
export function nativeEngineErrorPayload(error: unknown): NativeEngineErrorPayload {
  if (error instanceof NativeEngineFailure) return error.toPayload()
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
  return { message, command: [], exitCode: null, signal: null, log: [] }
}

/**
 * The fixed byte length of one decoded frame (`contract.ts`'s `preciseFrameBytes`):
 * 3 bytes a pixel for `p010le` (a 16-bit luma plane and a half-height plane of
 * 16-bit U,V pairs, odd sizes rounded up to whole pairs), 6 for `gbrp10le` (three
 * full 16-bit planes), 8 for `rgba64le`. FFmpeg's raw `rawvideo` output is
 * tightly packed, so a frame is its planes and nothing else.
 */
export function preciseInputFrameBytes(
  format: PreciseInputFormat,
  width: number,
  height: number,
): number {
  if (format === 'p010le') return width * height * 2 + Math.ceil(width / 2) * 2 * Math.ceil(height / 2) * 2
  return width * height * (format === 'gbrp10le' ? 6 : 8)
}

/**
 * The tags to decode with, given what ffprobe reported (`contract.ts`'s
 * `resolveSourceColourTags`): a field it could not tell is read as
 * limited-range BT.709, exactly as the benchmark kit reads an untagged file,
 * and the fields it did report are kept.
 */
export function resolveSourceColourTags(reported: ColourTags): ColourTags {
  return {
    matrix: reported.matrix === 'unknown' ? OUTPUT_COLOUR_TAGS.matrix : reported.matrix,
    range: reported.range === 'unknown' ? OUTPUT_COLOUR_TAGS.range : reported.range,
    transfer: reported.transfer === 'unknown' ? OUTPUT_COLOUR_TAGS.transfer : reported.transfer,
    primaries: reported.primaries === 'unknown' ? OUTPUT_COLOUR_TAGS.primaries : reported.primaries,
  }
}

/** An inclusive byte range of a frame: `start` and `end` are both inside the body. */
export interface ByteRange {
  readonly start: number
  readonly end: number
}

/** What a `Range` request asks for (`native-protocol.ts`). */
export type ByteRangeRequest =
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' }
  | { readonly kind: 'invalid'; readonly reason: string }

/**
 * Parses a `Range` request header against a frame's length (RFC 9110 §14.2:
 * `bytes=0-1023`, `bytes=1024-`, `bytes=-1024`), as `native-protocol.ts` does.
 * Only one range is accepted; a multi-range request is `invalid`, because the
 * page only ever resumes one frame.
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

/** The `Content-Range` of a frame's response (`native-protocol.ts`). */
export function contentRangeHeader(totalBytes: number, range: ByteRange | null): string {
  return range ? `bytes ${range.start}-${range.end}/${totalBytes}` : `bytes */${totalBytes}`
}

/**
 * The headers a decoded frame's GET answers with (`native-protocol.ts`'s
 * `preciseFrameHeaders`): the protocol's own, `Accept-Ranges`, and the body's
 * length — the whole frame (200) or the requested part (206, with
 * `Content-Range`).
 */
export function frameHeaders(
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

/** The result of parsing a frame URL: the request, or why the URL names no frame. */
export type ParsedPreciseFrameUrl =
  | { readonly ok: true; readonly jobId: string; readonly frameIndex: number }
  | { readonly ok: false; readonly reason: string }

/**
 * Reads a frame URL back (`native-protocol.ts`'s `parsePreciseFrameUrl`):
 * `droneclean-frame://decode/<jobId>/<frameIndex>` and nothing else. A wrong
 * scheme, route, id, index or an extra path segment is a refusal with the
 * reason, so the handler answers 400 instead of guessing.
 */
export function parseFrameUrl(href: string): ParsedPreciseFrameUrl {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { ok: false, reason: `not a URL: ${JSON.stringify(href)}` }
  }
  if (url.protocol !== `${NATIVE_FRAME_SCHEME}:`) {
    return { ok: false, reason: `wrong scheme: ${url.protocol}` }
  }
  if (url.host !== NATIVE_FRAME_ROUTE) {
    return { ok: false, reason: `wrong route: ${url.host}` }
  }

  const segments = url.pathname.split('/').slice(1)
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
