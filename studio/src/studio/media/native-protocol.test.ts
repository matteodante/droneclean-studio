import { describe, expect, it } from 'vite-plus/test'
import {
  NATIVE_ENCODE_SCHEME,
  NATIVE_FRAME_SCHEME,
  NATIVE_JOB_ID_PATTERN,
  NATIVE_MEDIA_CHANNELS,
  NATIVE_PROTOCOL_HEADERS,
  contentRangeHeader,
  parseByteRange,
  parsePreciseFrameUrl,
  parsePreciseReadbackUrl,
  preciseFrameHeaders,
  preciseFrameUrl,
  preciseReadbackUrl,
  type CancelRequest,
  type DecodeStartReply,
  type DecodeStartRequest,
  type EncodeReply,
  type EncodeStartReply,
  type EncodeStartRequest,
  type NativeMediaChannel,
  type NativeProgress,
} from './native-protocol'
import {
  OUTPUT_COLOUR_TAGS,
  preciseFrameBytes,
  preciseReadbackBytes,
} from '../render/precise/contract'

const JOB_ID = 'b2f1c0de-0000-4000-8000-000000000001'
const FRAME_BYTES = 66_355_200
const READBACK_BYTES = 33_177_600

describe('the frame URL', () => {
  it('round-trips a job and an index through the route', () => {
    expect(preciseFrameUrl({ jobId: JOB_ID, frameIndex: 0 })).toBe(
      `droneclean-frame://decode/${JOB_ID}/0`,
    )
    expect(preciseFrameUrl({ jobId: JOB_ID, frameIndex: 12_345 })).toBe(
      `droneclean-frame://decode/${JOB_ID}/12345`,
    )
    expect(parsePreciseFrameUrl(`droneclean-frame://decode/${JOB_ID}/12345`)).toEqual({
      ok: true,
      jobId: JOB_ID,
      frameIndex: 12345,
    })
  })

  it('refuses to build a URL for an id the pattern rejects', () => {
    expect(() => preciseFrameUrl({ jobId: '', frameIndex: 0 })).toThrow(/job id/)
    expect(() => preciseFrameUrl({ jobId: 'a/b', frameIndex: 0 })).toThrow(/job id/)
    expect(() => preciseFrameUrl({ jobId: 'a b', frameIndex: 0 })).toThrow(/job id/)
    expect(() => preciseFrameUrl({ jobId: 'x'.repeat(65), frameIndex: 0 })).toThrow(/job id/)
  })

  it('refuses to build a URL for an index that is not a frame', () => {
    expect(() => preciseFrameUrl({ jobId: JOB_ID, frameIndex: -1 })).toThrow(/index/)
    expect(() => preciseFrameUrl({ jobId: JOB_ID, frameIndex: 1.5 })).toThrow(/index/)
    expect(() => preciseFrameUrl({ jobId: JOB_ID, frameIndex: Number.NaN })).toThrow(/index/)
  })

  it('refuses a URL that names no frame of a job', () => {
    const parse = (url: string) => parsePreciseFrameUrl(url)

    expect(parse(`droneclean-encode://decode/${JOB_ID}/0`)).toMatchObject({ ok: false })
    expect(parse(`droneclean-frame://encode/${JOB_ID}/0`)).toMatchObject({ ok: false })
    expect(parse(`droneclean-frame://decode/${JOB_ID}`)).toMatchObject({ ok: false })
    expect(parse(`droneclean-frame://decode/${JOB_ID}/0/extra`)).toMatchObject({ ok: false })
    expect(parse(`droneclean-frame://decode/${JOB_ID}/0/`)).toMatchObject({ ok: false })
    expect(parse(`droneclean-frame://decode//${JOB_ID}/0`)).toMatchObject({ ok: false })
    expect(parse(`droneclean-frame://decode/${JOB_ID}/01`)).toMatchObject({ ok: false })
    expect(parse(`droneclean-frame://decode/${JOB_ID}/-1`)).toMatchObject({ ok: false })
    expect(parse(`droneclean-frame://decode/${JOB_ID}/x`)).toMatchObject({ ok: false })
    expect(parse(`droneclean-frame://decode/a b/0`)).toMatchObject({ ok: false })
    expect(parse('not a url')).toMatchObject({ ok: false })
  })

  it('says why, rather than guessing', () => {
    expect(parsePreciseFrameUrl('not a url')).toEqual({
      ok: false,
      reason: 'not a URL: "not a url"',
    })
    expect(parsePreciseFrameUrl(`droneclean-frame://decode/${JOB_ID}/01`)).toEqual({
      ok: false,
      reason: 'invalid frame index: "01"',
    })
  })
})

describe('the readback URL', () => {
  it('round-trips the job', () => {
    expect(preciseReadbackUrl(JOB_ID)).toBe(`droneclean-encode://encode/${JOB_ID}`)
    expect(parsePreciseReadbackUrl(`droneclean-encode://encode/${JOB_ID}`)).toEqual({
      ok: true,
      jobId: JOB_ID,
    })
  })

  it('refuses an id the pattern rejects', () => {
    expect(() => preciseReadbackUrl('')).toThrow(/job id/)
    expect(() => preciseReadbackUrl('..')).toThrow(/job id/)
  })

  it('refuses a URL that names no encode', () => {
    expect(parsePreciseReadbackUrl(`droneclean-frame://encode/${JOB_ID}`)).toMatchObject({
      ok: false,
    })
    expect(parsePreciseReadbackUrl(`droneclean-encode://decode/${JOB_ID}`)).toMatchObject({
      ok: false,
    })
    expect(parsePreciseReadbackUrl(`droneclean-encode://encode/${JOB_ID}/1`)).toMatchObject({
      ok: false,
    })
    expect(
      parsePreciseReadbackUrl(`droneclean-encode://encode/${JOB_ID.replace('-', '/')}`),
    ).toMatchObject({ ok: false })
  })
})

describe('parseByteRange', () => {
  it('asks for the whole frame when there is no header', () => {
    expect(parseByteRange(null, FRAME_BYTES)).toEqual({ kind: 'full' })
    expect(parseByteRange('  ', FRAME_BYTES)).toEqual({ kind: 'full' })
  })

  it('reads the three forms a resume needs', () => {
    expect(parseByteRange('bytes=0-1023', FRAME_BYTES)).toEqual({
      kind: 'partial',
      start: 0,
      end: 1023,
    })
    expect(parseByteRange('bytes=1024-', FRAME_BYTES)).toEqual({
      kind: 'partial',
      start: 1024,
      end: FRAME_BYTES - 1,
    })
    expect(parseByteRange('bytes=-1024', FRAME_BYTES)).toEqual({
      kind: 'partial',
      start: FRAME_BYTES - 1024,
      end: FRAME_BYTES - 1,
    })
  })

  it('clamps a last position past the frame and a suffix longer than it', () => {
    expect(parseByteRange('bytes=0-999999999', 1000)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999,
    })
    expect(parseByteRange('bytes=-999999999', 1000)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999,
    })
    expect(parseByteRange('bytes=0-0', 1000)).toEqual({ kind: 'partial', start: 0, end: 0 })
  })

  it('is unsatisfiable when the range starts past the frame or asks for nothing', () => {
    expect(parseByteRange(`bytes=${FRAME_BYTES}-`, FRAME_BYTES)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=-0', FRAME_BYTES)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('is invalid for a unit or a syntax it does not serve, and for several ranges', () => {
    expect(parseByteRange('items=0-1', FRAME_BYTES)).toMatchObject({ kind: 'invalid' })
    expect(parseByteRange('bytes=0-1,3-4', FRAME_BYTES)).toMatchObject({ kind: 'invalid' })
    expect(parseByteRange('bytes=-', FRAME_BYTES)).toMatchObject({ kind: 'invalid' })
    expect(parseByteRange('bytes=5-3', FRAME_BYTES)).toMatchObject({ kind: 'invalid' })
    expect(parseByteRange('bytes=a-b', FRAME_BYTES)).toMatchObject({ kind: 'invalid' })
  })
})

describe('the headers the main process answers', () => {
  it('writes Content-Range for a part, and the unsatisfied form for a 416', () => {
    expect(contentRangeHeader(1000, { start: 0, end: 499 })).toBe('bytes 0-499/1000')
    expect(contentRangeHeader(1000, null)).toBe('bytes */1000')
  })

  it('announces the whole frame and that ranges are served', () => {
    expect(preciseFrameHeaders(FRAME_BYTES)).toEqual({
      ...NATIVE_PROTOCOL_HEADERS,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(FRAME_BYTES),
    })
  })

  it('answers a range with the part’s length and its Content-Range', () => {
    expect(preciseFrameHeaders(FRAME_BYTES, { start: 1024, end: 2047 })).toEqual({
      ...NATIVE_PROTOCOL_HEADERS,
      'Accept-Ranges': 'bytes',
      'Content-Length': '1024',
      'Content-Range': `bytes 1024-2047/${FRAME_BYTES}`,
    })
  })

  it('is the same in both directions and cannot be cached', () => {
    expect(NATIVE_PROTOCOL_HEADERS['Content-Type']).toBe('application/octet-stream')
    expect(NATIVE_PROTOCOL_HEADERS['Cache-Control']).toBe('no-store')
    expect(NATIVE_PROTOCOL_HEADERS['Cross-Origin-Resource-Policy']).toBe('cross-origin')
    expect(NATIVE_PROTOCOL_HEADERS['Cross-Origin-Embedder-Policy']).toBe('require-corp')
  })
})

describe('the control messages', () => {
  it('carries the geometry, rate and byte lengths the page needs before a frame arrives', () => {
    const decode: DecodeStartRequest = {
      jobId: JOB_ID,
      file: '/Volumes/Media/DRONE/DJI_20261115124704_0020_D.MP4',
      startSeconds: 60,
      frames: 300,
      format: 'gbrp10le',
    }
    const decodeReply: DecodeStartReply = {
      width: 3840,
      height: 2880,
      rate: { num: 60000, den: 1001 },
      colour: OUTPUT_COLOUR_TAGS,
      format: decode.format,
      frameBytes: preciseFrameBytes(decode.format, 3840, 2880),
    }
    const encode: EncodeStartRequest = {
      jobId: JOB_ID,
      path: '/Volumes/Media/exports/clip-hevc.mp4',
      format: 'hevc-main10',
      readback: 'p010le',
      bitrate: 120_000_000,
      fps: decodeReply.rate,
      tags: OUTPUT_COLOUR_TAGS,
      width: decodeReply.width,
      height: decodeReply.height,
    }
    const encodeReply: EncodeStartReply = {
      readback: encode.readback,
      frameBytes: preciseReadbackBytes(encode.readback, encode.width, encode.height),
    }
    const reply: EncodeReply = { framesWritten: decode.frames, path: encode.path }
    const progress: NativeProgress = {
      jobId: encode.jobId,
      phase: 'encode',
      framesDone: 1,
      framesTotal: decode.frames,
    }
    const cancel: CancelRequest = { jobId: encode.jobId }
    const channel: NativeMediaChannel = NATIVE_MEDIA_CHANNELS.cancel

    expect([decodeReply.frameBytes, encodeReply.frameBytes]).toEqual([FRAME_BYTES, READBACK_BYTES])
    expect([reply.framesWritten, progress.framesTotal, cancel.jobId, channel]).toEqual([
      300,
      300,
      JOB_ID,
      'native-media:cancel',
    ])
  })

  it('names the schemes the shell registers and accepts the ids a URL can carry', () => {
    expect(NATIVE_FRAME_SCHEME).toBe('droneclean-frame')
    expect(NATIVE_ENCODE_SCHEME).toBe('droneclean-encode')
    expect(
      preciseFrameUrl({ jobId: JOB_ID, frameIndex: 0 }).startsWith(`${NATIVE_FRAME_SCHEME}://`),
    ).toBe(true)

    for (const id of [JOB_ID, 'a', 'A_1-2', 'x'.repeat(64)]) {
      expect(NATIVE_JOB_ID_PATTERN.test(id)).toBe(true)
    }
    for (const id of ['', 'a b', 'a/b', '..', 'x'.repeat(65)]) {
      expect(NATIVE_JOB_ID_PATTERN.test(id)).toBe(false)
    }
  })
})

describe('the control channels', () => {
  it('names one channel per message, none shared', () => {
    const channels = Object.values(NATIVE_MEDIA_CHANNELS)

    expect(channels).toEqual([
      'native-media:decode.start',
      'native-media:encode.start',
      'native-media:cancel',
      'native-media:progress',
      'native-media:capabilities',
    ])
    expect(new Set(channels).size).toBe(channels.length)
  })
})
