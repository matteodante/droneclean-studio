// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import * as protocol from '@/studio/media/native-protocol'
import * as shell from '../../../../desktop/src/shared/native-media'
import {
  DEFAULT_DECODE_RING_SIZE,
  decodeSlotCount,
} from '../../../../desktop/src/main/media/decode-stream'
import * as contract from './contract'

/**
 * The desktop shell's copy of the wire (`studio/desktop/src/shared/native-media.ts`)
 * against the contract (`contract.ts`, `native-protocol.ts`).
 *
 * The shell is its own TypeScript project, so it keeps a copy of the shapes and
 * the pure helpers it speaks; nothing else holds the two together. The type
 * assertions below are the compile-time half — a field renamed on one side fails
 * `vp run check` here — and the runtime assertions are the values: a scheme, a
 * channel or a status that drifted fails a test instead of a decode.
 */

/** True only when `A` and `B` are assignable to each other: the same shape. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const sameRate: Same<contract.Rate, shell.Rate> = true
const sameColour: Same<contract.ColourTags, shell.ColourTags> = true
const sameMatrix: Same<contract.ColourMatrix, shell.ColourMatrix> = true
const sameRange: Same<contract.ColourRange, shell.ColourRange> = true
const sameTransfer: Same<contract.ColourTransfer, shell.ColourTransfer> = true
const samePrimaries: Same<contract.ColourPrimaries, shell.ColourPrimaries> = true
const sameInputFormat: Same<contract.PreciseInputFormat, shell.PreciseInputFormat> = true
const sameOutputFormat: Same<contract.PreciseOutputFormat, shell.PreciseOutputFormat> = true
const sameExportFormat: Same<contract.PreciseExportFormatId, shell.PreciseExportFormatId> = true
const sameDecodeStart: Same<protocol.DecodeStartRequest, shell.DecodeStartRequest> = true
const sameDecodeReply: Same<protocol.DecodeStartReply, shell.DecodeStartReply> = true
const sameProgress: Same<protocol.NativeProgress, shell.NativeProgress> = true
const sameCancel: Same<protocol.CancelRequest, shell.CancelRequest> = true
const sameErrorPayload: Same<contract.NativeEngineErrorPayload, shell.NativeEngineErrorPayload> =
  true
const sameCapabilities: Same<contract.NativeEngineCapabilities, shell.NativeEngineCapabilities> =
  true
const sameChannels: Same<
  typeof protocol.NATIVE_MEDIA_CHANNELS,
  typeof shell.NATIVE_MEDIA_CHANNELS
> = true

describe('the shell and the contract describe the same wire', () => {
  it('has the same shapes, at compile time', () => {
    expect([
      sameRate,
      sameColour,
      sameMatrix,
      sameRange,
      sameTransfer,
      samePrimaries,
      sameInputFormat,
      sameOutputFormat,
      sameExportFormat,
      sameDecodeStart,
      sameDecodeReply,
      sameProgress,
      sameCancel,
      sameErrorPayload,
      sameCapabilities,
      sameChannels,
    ]).toEqual(Array.from({ length: 16 }, () => true))
  })

  it('names the frame scheme, its route and its job ids the same', () => {
    expect(shell.NATIVE_FRAME_SCHEME).toBe(protocol.NATIVE_FRAME_SCHEME)
    // The ring keeps a buffer per frame the page may still be reading: the protocol's read-ahead.
    expect(decodeSlotCount(DEFAULT_DECODE_RING_SIZE)).toBe(
      DEFAULT_DECODE_RING_SIZE + protocol.NATIVE_FRAME_READ_AHEAD + 1,
    )
    expect(shell.NATIVE_JOB_ID_PATTERN.source).toBe(protocol.NATIVE_JOB_ID_PATTERN.source)
    expect(shell.NATIVE_JOB_ID_PATTERN.test('decode-1a2b3c')).toBe(true)
    expect(shell.NATIVE_JOB_ID_PATTERN.test('decode 1')).toBe(false)
  })

  it('carries the contract’s response headers and IPC channels', () => {
    expect(shell.NATIVE_PROTOCOL_HEADERS).toEqual(protocol.NATIVE_PROTOCOL_HEADERS)
    expect(shell.NATIVE_MEDIA_CHANNELS).toEqual(protocol.NATIVE_MEDIA_CHANNELS)
    expect(shell.NATIVE_ENGINE_LOG_LINES).toBe(contract.NATIVE_ENGINE_LOG_LINES)
  })

  it('answers the statuses the contract lists', () => {
    expect(shell.NATIVE_FRAME_STATUS).toEqual({
      ok: 200,
      partialContent: 206,
      badRequest: 400,
      notFound: 404,
      gone: 410,
      rangeNotSatisfiable: 416,
    })
  })
})

describe('the shell sizes a frame as the contract does', () => {
  it('is 3 bytes a pixel for p010le, 6 for gbrp10le and 8 for rgba64le, at every size', () => {
    const sizes: ReadonlyArray<readonly [number, number]> = [
      [1, 1],
      [4, 2],
      [1920, 1080],
      [3840, 2880],
      [3, 5],
    ]
    for (const [width, height] of sizes) {
      for (const format of ['p010le', 'gbrp10le', 'rgba64le'] as const) {
        expect(shell.preciseInputFrameBytes(format, width, height)).toBe(
          contract.preciseFrameBytes(format, width, height),
        )
      }
    }
    expect(shell.preciseInputFrameBytes('gbrp10le', 3840, 2880)).toBe(66_355_200)
    expect(shell.preciseInputFrameBytes('p010le', 3840, 2880)).toBe(33_177_600)
  })

  it('reads an untagged source as the contract does', () => {
    const tags: contract.ColourTags[] = [
      { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
      { matrix: 'unknown', range: 'unknown', transfer: 'unknown', primaries: 'unknown' },
      { matrix: 'smpte170m', range: 'pc', transfer: 'smpte170m', primaries: 'smpte170m' },
      { matrix: 'bt2020nc', range: 'unknown', transfer: 'smpte2084', primaries: 'bt2020' },
    ]
    for (const reported of tags) {
      expect(shell.resolveSourceColourTags(reported)).toEqual(
        contract.resolveSourceColourTags(reported),
      )
    }
  })
})

describe('the shell reads a frame URL as the contract writes it', () => {
  it('answers the same for every URL a page could ask for', () => {
    const urls = [
      protocol.preciseFrameUrl({ jobId: 'decode-1', frameIndex: 0 }),
      protocol.preciseFrameUrl({ jobId: 'decode-1', frameIndex: 12345 }),
      'droneclean-frame://decode/job-1/01',
      'droneclean-frame://decode/job-1/1/2',
      'droneclean-frame://decode/job 1/1',
      'droneclean-frame://encode/job-1/1',
      'droneclean-encode://decode/job-1/1',
      'droneclean-frame://decode/job-1/-1',
      'not a url',
    ]
    for (const url of urls) {
      expect(shell.parseFrameUrl(url)).toEqual(protocol.parsePreciseFrameUrl(url))
    }
  })
})

describe('the shell reads a Range as the contract does', () => {
  it('answers the same request and the same headers', () => {
    const headers = [null, '', 'bytes=0-', 'bytes=10-19', 'bytes=-10', 'bytes=99-', 'bytes=0-1-2', 'items=0-1', 'bytes=5-2']
    for (const header of headers) {
      expect(shell.parseByteRange(header, 100)).toEqual(protocol.parseByteRange(header, 100))
      expect(shell.parseByteRange(header, 0)).toEqual(protocol.parseByteRange(header, 0))
    }
    expect(shell.frameHeaders(66_355_200)).toEqual(protocol.preciseFrameHeaders(66_355_200))
    expect(shell.frameHeaders(66_355_200, { start: 0, end: 65_535 })).toEqual(
      protocol.preciseFrameHeaders(66_355_200, { start: 0, end: 65_535 }),
    )
    expect(shell.contentRangeHeader(66_355_200, null)).toBe('bytes */66355200')
  })
})
