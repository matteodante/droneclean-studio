import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  EXPORT_FORMATS,
  NATIVE_ENGINE_LOG_LINES,
  NativeEngineError,
  OUTPUT_COLOUR_TAGS,
  preciseDecodedFrame,
  preciseFrameBytes,
  preciseFramePts,
  preciseOutputActive,
  preciseOutputSink,
  precisePlaneLayout,
  preciseReadbackBytes,
  preciseReadbackFrame,
  preciseRenderFormat,
  resolveSourceColourTags,
  setPreciseOutputSink,
  type NativeEngineCapabilities,
  type PreciseExportFormat,
  type PreciseFrame,
  type Rate,
} from './contract'

const RATE_5994 = { num: 60000, den: 1001 } as const

function frame(index: number, rate: Rate = RATE_5994): PreciseFrame {
  return { index, rate, durationFrames: 1 }
}

afterEach(() => {
  setPreciseOutputSink(null)
})

describe('preciseFramePts', () => {
  it('is the integer index times den, in a 1/num time base', () => {
    expect(preciseFramePts(frame(0))).toBe(0)
    expect(preciseFramePts(frame(1))).toBe(1001)
    expect(preciseFramePts(frame(60000))).toBe(60060000)
  })

  it('never sums a float frame duration', () => {
    expect(preciseFramePts({ index: 90, rate: { num: 60, den: 1 }, durationFrames: 1 })).toBe(90)
  })
})

describe('precisePlaneLayout', () => {
  it('lays gbrp10le out as three contiguous full-size 16-bit planes, G then B then R', () => {
    const planes = precisePlaneLayout('gbrp10le', 4, 4)

    expect(planes.map((plane) => plane.channel)).toEqual(['g', 'b', 'r'])
    expect(planes.map((plane) => plane.offset)).toEqual([0, 32, 64])
    expect(planes.map((plane) => plane.stride)).toEqual([8, 8, 8])
    expect(planes.map((plane) => plane.width)).toEqual([4, 4, 4])
    expect(planes.map((plane) => plane.height)).toEqual([4, 4, 4])
    expect(planes.map((plane) => plane.sizeBytes)).toEqual([32, 32, 32])
    // FFmpeg writes 96 bytes for a 4×4 gbrp10le rawvideo frame (measured with 9.0.2).
    expect(preciseFrameBytes('gbrp10le', 4, 4)).toBe(96)
  })

  it('gives rgba64le one interleaved plane of 8 bytes a pixel', () => {
    const planes = precisePlaneLayout('rgba64le', 4, 2)

    expect(planes).toHaveLength(1)
    expect(planes.map((plane) => plane.channel)).toEqual(['rgba'])
    expect(planes.map((plane) => plane.stride)).toEqual([32])
    expect(planes.map((plane) => plane.sizeBytes)).toEqual([64])
    expect(preciseFrameBytes('rgba64le', 4, 2)).toBe(64)
  })

  it('lays p010le out as a luma plane and one half-height plane of U,V pairs', () => {
    const planes = precisePlaneLayout('p010le', 4, 4)

    expect(planes.map((plane) => plane.channel)).toEqual(['y', 'uv'])
    expect(planes.map((plane) => plane.offset)).toEqual([0, 32])
    expect(planes.map((plane) => plane.stride)).toEqual([8, 8])
    expect(planes.map((plane) => plane.width)).toEqual([4, 4])
    expect(planes.map((plane) => plane.height)).toEqual([4, 2])
    expect(planes.map((plane) => plane.sizeBytes)).toEqual([32, 16])
    // FFmpeg writes 48 bytes for a 4×4 p010le rawvideo frame (measured with 9.0.2).
    expect(preciseReadbackBytes('p010le', 4, 4)).toBe(48)
  })

  it('rounds p010le chroma up to whole U,V pairs on odd sizes', () => {
    const planes = precisePlaneLayout('p010le', 3, 3)

    // 3 luma samples (6 bytes a row, 3 rows) then 4 chroma samples (8 bytes a row, 2 rows).
    expect(planes.map((plane) => plane.stride)).toEqual([6, 8])
    expect(planes.map((plane) => plane.height)).toEqual([3, 2])
    expect(preciseReadbackBytes('p010le', 3, 3)).toBe(18 + 16)
  })

  it('matches the frame sizes the design measured on clip 0020', () => {
    // 3840×2880: 66.3 MB in, 88.5 MB as rgba64le, 33.2 MB as p010le (3 bytes a pixel).
    expect(preciseFrameBytes('gbrp10le', 3840, 2880)).toBe(66_355_200)
    expect(preciseFrameBytes('rgba64le', 3840, 2880)).toBe(88_473_600)
    expect(preciseReadbackBytes('p010le', 3840, 2880)).toBe(33_177_600)
    expect(preciseReadbackBytes('rgba64le', 3840, 2880)).toBe(88_473_600)
  })
})

describe('the frame descriptions', () => {
  it('computes a decoded frame’s planes and byte size from its format', () => {
    const decoded = preciseDecodedFrame({
      frame: frame(10),
      format: 'gbrp10le',
      width: 4,
      height: 4,
      colour: OUTPUT_COLOUR_TAGS,
    })

    expect(decoded.sizeBytes).toBe(96)
    expect(decoded.planes.map((plane) => plane.channel)).toEqual(['g', 'b', 'r'])
    expect(decoded.frame.index).toBe(10)
    expect(decoded.colour).toBe(OUTPUT_COLOUR_TAGS)
  })

  it('computes a readback frame’s fixed byte length from its format', () => {
    const readback = preciseReadbackFrame({
      frame: frame(10),
      format: 'p010le',
      width: 3840,
      height: 2880,
    })

    expect(readback.sizeBytes).toBe(33_177_600)
    expect(readback.format).toBe('p010le')
  })
})

describe('colour tags', () => {
  it('writes limited-range BT.709 in every output', () => {
    expect(OUTPUT_COLOUR_TAGS).toEqual({
      matrix: 'bt709',
      range: 'tv',
      transfer: 'bt709',
      primaries: 'bt709',
    })
  })

  it('reads an untagged source as limited-range BT.709, as the benchmark kit does', () => {
    expect(
      resolveSourceColourTags({
        matrix: 'unknown',
        range: 'unknown',
        transfer: 'unknown',
        primaries: 'unknown',
      }),
    ).toEqual(OUTPUT_COLOUR_TAGS)
  })

  it('keeps what the decoder did report', () => {
    expect(
      resolveSourceColourTags({
        matrix: 'smpte170m',
        range: 'pc',
        transfer: 'smpte170m',
        primaries: 'smpte170m',
      }),
    ).toEqual({
      matrix: 'smpte170m',
      range: 'pc',
      transfer: 'smpte170m',
      primaries: 'smpte170m',
    })
  })
})

describe('EXPORT_FORMATS', () => {
  it('lists the four outputs in the dialog’s order, names and containers', () => {
    expect(EXPORT_FORMATS.map((format) => format.id)).toEqual([
      'hevc-main10',
      'prores-422-hq',
      'h264-8bit',
      'hevc-8bit',
    ])
    expect(EXPORT_FORMATS.map((format) => format.label)).toEqual([
      'HEVC Main 10',
      'ProRes 422 HQ',
      'H.264',
      'HEVC',
    ])
    expect(EXPORT_FORMATS.map((format) => [format.container, format.extension])).toEqual([
      ['mp4', '.mp4'],
      ['mov', '.mov'],
      ['mp4', '.mp4'],
      ['mp4', '.mp4'],
    ])
    expect(EXPORT_FORMATS.map((format) => format.bitDepth)).toEqual([10, 10, 8, 8])
  })

  it('gives every entry a label, a depth and an extension that fits its container', () => {
    const formats: readonly PreciseExportFormat[] = EXPORT_FORMATS

    expect(new Set(formats.map((format) => format.id)).size).toBe(formats.length)
    for (const format of formats) {
      expect(format.label.length).toBeGreaterThan(0)
      expect(format.extension).toBe(format.container === 'mov' ? '.mov' : '.mp4')
      expect([8, 10]).toContain(format.bitDepth)
    }
  })
})

describe('NativeEngineCapabilities', () => {
  it('reports the engine in the catalogue’s own terms, so 3.4 can show only what runs', () => {
    const capabilities: NativeEngineCapabilities = {
      available: true,
      version: 'ffmpeg version 9.0.2',
      decoders: ['hevc', 'h264', 'prores', 'av1'],
      encoders: ['hevc_videotoolbox', 'libx265', 'prores_ks'],
      hardware: ['videotoolbox'],
      inputFormats: ['gbrp10le', 'rgba64le'],
      outputFormats: ['p010le', 'rgba64le'],
      exportFormats: EXPORT_FORMATS.map((format) => format.id),
      message: null,
    }

    expect(capabilities.inputFormats[0]).toBe('gbrp10le')
    expect(capabilities.outputFormats[0]).toBe('p010le')
    expect(capabilities.exportFormats).toHaveLength(EXPORT_FORMATS.length)
  })

  it('says why it is unavailable when there is no engine', () => {
    const unavailable: NativeEngineCapabilities = {
      available: false,
      version: null,
      decoders: [],
      encoders: [],
      hardware: [],
      inputFormats: [],
      outputFormats: [],
      exportFormats: [],
      message: 'ffmpeg was not found next to the app',
    }

    expect(unavailable.available).toBe(false)
    expect(unavailable.message).toContain('ffmpeg')
  })
})

describe('NativeEngineError', () => {
  const payload = {
    message: 'ffmpeg exited with code 1',
    command: ['ffmpeg', '-i', '/Volumes/Media/clip.mp4'],
    exitCode: 1,
    signal: null,
    log: ['clip.mp4: Invalid data found when processing input'],
  } as const

  it('carries the exit code and the last log lines of the command that failed', () => {
    const error = new NativeEngineError(payload)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('NativeEngineError')
    expect(error.message).toBe(payload.message)
    expect(error.exitCode).toBe(1)
    expect(error.signal).toBeNull()
    expect(error.log).toEqual(payload.log)
    expect(error.command).toEqual(payload.command)
  })

  it('survives a process boundary as a payload', () => {
    const error = new NativeEngineError(payload)
    const copy = new NativeEngineError(error.toPayload())

    expect(copy.toPayload()).toEqual(payload)
  })

  it('says a signal killed it when there is no exit code', () => {
    const error = new NativeEngineError({ ...payload, exitCode: null, signal: 'SIGKILL' })

    expect(error.exitCode).toBeNull()
    expect(error.signal).toBe('SIGKILL')
  })

  it('keeps only the last lines of a long log, so the payload stays small', () => {
    const log = Array.from({ length: 25 }, (_, index) => `line ${index}`)
    const error = new NativeEngineError({ ...payload, log })

    expect(error.log).toHaveLength(NATIVE_ENGINE_LOG_LINES)
    expect(error.log[0]).toBe(`line ${25 - NATIVE_ENGINE_LOG_LINES}`)
    expect(error.log[NATIVE_ENGINE_LOG_LINES - 1]).toBe('line 24')
    expect(error.toPayload().log).toHaveLength(NATIVE_ENGINE_LOG_LINES)
  })
})

describe('the output sink', () => {
  it('is null outside an export, so the renderer’s hook does nothing', () => {
    expect(preciseOutputSink()).toBeNull()
  })

  it('hands each float composite and its frame to the sink an export registered', () => {
    const deliver = vi.fn()
    const texture = {} as GPUTexture
    const outputFrame = frame(3, { num: 24, den: 1 })
    setPreciseOutputSink({ deliver })

    const sink = preciseOutputSink()
    expect(sink).not.toBeNull()
    sink?.deliver(texture, outputFrame)
    expect(deliver).toHaveBeenCalledWith(texture, outputFrame)
  })

  it('stops delivering when the export unregisters it', () => {
    const deliver = vi.fn()
    setPreciseOutputSink({ deliver })
    setPreciseOutputSink(null)

    expect(preciseOutputSink()).toBeNull()
    expect(deliver).not.toHaveBeenCalled()
  })

  it('renders in rgba16float only for an export whose sink is registered', () => {
    expect(preciseRenderFormat('export')).toBe('rgba8unorm')
    expect(preciseRenderFormat('preview')).toBe('rgba8unorm')

    setPreciseOutputSink({ deliver: vi.fn() })
    expect(preciseRenderFormat('export')).toBe('rgba16float')
    // A preview rendering while an export runs is not the encoder's frame stream.
    expect(preciseRenderFormat('preview')).toBe('rgba8unorm')
    expect(preciseOutputActive('export')).toBe(true)
    expect(preciseOutputActive('preview')).toBe(false)

    setPreciseOutputSink(null)
    expect(preciseRenderFormat('export')).toBe('rgba8unorm')
    expect(preciseOutputActive('export')).toBe(false)
  })
})
