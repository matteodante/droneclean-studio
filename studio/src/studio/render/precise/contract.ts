/**
 * The contract of the precise render path (task 3.1).
 *
 * Every slice of phase 3 compiles against this file: P1's float effects, P2's float composite and
 * single 8-bit output, P3's source pass, P4's native decoder, P5's readback and encoder, P6's long
 * exports, and 3.4's export dialog. It fixes what the coordinator decided on 18 Nov 2026
 * (`docs/designs/3.1-precise-path.md` §0) and the design's §4.1 (transport and pixel formats),
 * §4.3 (the float composite) and §4.4 (colour).
 *
 * Two rules run through it. A frame is an integer index at an exact `Rate`, never a float number of
 * seconds (design 1.5 §4.0). And the code values the decoder produced stay code values until the
 * encoder: the working values are full-range, non-linear RGB in 16-bit float, and 8 bits exist once,
 * at the output.
 *
 * What this file does not do: it holds no GPU resource and starts no process. A render's source
 * frames come from its own provider (`render/frames/`, design 3.6 section 2.4), the wire to FFmpeg
 * is `native-protocol.ts`, and the desktop shell implements both sides of that wire (P4, P5).
 */

import type { Rate } from '@/studio/time'

/**
 * A rate in frames per second, as an exact ratio: `num` frames every `den` seconds.
 *
 * Both are integers and `den` is positive; 59.94 is `{ num: 60000, den: 1001 }`, never `59.94`.
 * The type is task 1.5's, in `src/studio/time/rate.ts`; this file re-exports it, so every slice of
 * phase 3 compiles against one `Rate`.
 */
export type { Rate } from '@/studio/time'

/**
 * One frame of a render or an export, by integer index — never by a float number of seconds.
 *
 * `index` counts frames from the export's first frame (design 1.5 §4.0: timeline frames for the
 * project, source frames for a clip); `rate` is the exact rate those indices count at; and
 * `durationFrames` is how many frames of time the frame occupies — 1 unless it is held (a still, a
 * stopped clip). Its exact duration in seconds is `durationFrames * rate.den / rate.num`, computed
 * only at a boundary that needs seconds (design 1.5 §4.0).
 */
export interface PreciseFrame {
  readonly index: number
  readonly rate: Rate
  readonly durationFrames: number
}

/**
 * The frame's presentation timestamp in the encoder's `1/num` time base: `index * den`, an integer.
 *
 * FFmpeg is given `-r num/den` and fed these PTS values, so 60000/1001 frame 1 is PTS 1001 and frame
 * 60000 is PTS 60060000; no timestamp is ever a running sum of 1/59.94 (design 1.5 §4.0).
 */
export function preciseFramePts(frame: PreciseFrame): number {
  return frame.index * frame.rate.den
}

/**
 * The working format of the precise path (design §4.3): the source texture, every effect pass and
 * the composite are `rgba16float`, and exactly one conversion to 8 bits exists, at the output.
 *
 * P1's effects pipeline, P2's composite, P3's source pass and P5's readback pass take the format
 * from here; `source-pass.ts` builds the source texture with it.
 */
export const PRECISE_RENDER_FORMAT = 'rgba16float' as const

/** FFmpeg's name for the matrix that turned the source's YUV into RGB (`-colorspace`). */
export type ColourMatrix = 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020nc' | 'unknown'

/** Whether the source's code values are limited (`tv`) or full range (`pc`) (`-color_range`). */
export type ColourRange = 'tv' | 'pc' | 'unknown'

/** The source's transfer characteristic (`-color_trc`). HDR's two are here so the record has room. */
export type ColourTransfer =
  | 'bt709'
  | 'smpte170m'
  | 'linear'
  | 'bt2020-10'
  | 'smpte2084'
  | 'arib-std-b67'
  | 'unknown'

/** The source's primaries (`-color_primaries`). */
export type ColourPrimaries = 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020' | 'unknown'

/**
 * The colour a decoded frame carries (design §4.4): what the decoder reports and what the encoder
 * writes, in FFmpeg's own names, so P4 reads them from ffprobe and P5 passes them to
 * `-colorspace`, `-color_range`, `-color_trc` and `-color_primaries` unchanged.
 */
export interface ColourTags {
  readonly matrix: ColourMatrix
  readonly range: ColourRange
  readonly transfer: ColourTransfer
  readonly primaries: ColourPrimaries
}

/**
 * The tags every output file carries (design §4.4): limited-range BT.709 in every format, after the
 * decoder converted the source with the source's own matrix and range. P5's command lines write
 * these, and 3.4 shows nothing about them.
 */
export const OUTPUT_COLOUR_TAGS: ColourTags = {
  matrix: 'bt709',
  range: 'tv',
  transfer: 'bt709',
  primaries: 'bt709',
}

/**
 * The tags to decode with, given what the decoder reported: a field it could not tell is read as
 * limited-range BT.709, exactly as the benchmark kit reads an untagged file (design §4.4). The
 * fields it did report are kept, so an SD clip tagged BT.601 is still converted as BT.601.
 */
export function resolveSourceColourTags(reported: ColourTags): ColourTags {
  return {
    matrix: reported.matrix === 'unknown' ? OUTPUT_COLOUR_TAGS.matrix : reported.matrix,
    range: reported.range === 'unknown' ? OUTPUT_COLOUR_TAGS.range : reported.range,
    transfer: reported.transfer === 'unknown' ? OUTPUT_COLOUR_TAGS.transfer : reported.transfer,
    primaries: reported.primaries === 'unknown' ? OUTPUT_COLOUR_TAGS.primaries : reported.primaries,
  }
}

/**
 * The pixel formats a decoded frame arrives in (design §0 decision 1 and §4.1).
 *
 * `p010le` is the path (design 3.6 section 2.16): the hardware decoder's own planes, 3 bytes a pixel,
 * converted to RGB on the GPU exactly as FFmpeg would (`p010-in.ts`). `gbrp10le` is its fallback, for
 * a source that is not 4:2:0 limited range: FFmpeg converts YUV→RGB with the source's matrix and
 * range, and the GPU only divides the 10-bit code values by 1023, at 6 bytes a pixel. `rgba64le` is
 * the heavier (8 bytes a pixel) fallback the design measured.
 */
export type PreciseInputFormat = 'p010le' | 'gbrp10le' | 'rgba64le'

/**
 * The pixel formats the readback leaves in (design §0 decision 1).
 *
 * `p010le` is the path — VideoToolbox's own format, packed by the GPU — and `rgba64le` is the 8
 * bytes-a-pixel fallback and the 16-bit debug readback. A `p010le` frame is 3 bytes a pixel (a
 * 2-byte luma sample and one byte of chroma per pixel, 33,177,600 bytes at 3840×2880), 2.67× lighter
 * than `rgba64le`; design §1.3's "1.5 bytes a pixel, 16.6 MB" is half the real size. P5 proves
 * `p010le` on the real path before the encode slices depend on it.
 */
export type PreciseOutputFormat = 'p010le' | 'rgba64le'

/**
 * Which plane of a frame a `PrecisePlane` describes. FFmpeg's planar RGB is G, B, R in that order;
 * `p010le` is a full-size luma plane and one half-height plane in which U and V samples alternate;
 * `rgba64le` is one interleaved plane.
 */
export type PrecisePlaneChannel = 'g' | 'b' | 'r' | 'rgba' | 'y' | 'uv'

/**
 * One plane of a frame, inside the single buffer its bytes arrive in.
 *
 * The buffer is packed, as FFmpeg's `rawvideo` output and input are: a plane's rows follow one
 * another with no padding (`stride` is the width times 2 for a 16-bit sample, times 8 for
 * `rgba64le`), and the planes are consecutive, in the order `precisePlaneLayout` lists them.
 * `gbrp10le` and `p010le` store each 10-bit sample in a 16-bit word (little endian, the 10 bits in
 * the high bits for `p010le`, the low bits for `gbrp10le`).
 */
export interface PrecisePlane {
  /** Which plane of the frame this is. */
  readonly channel: PrecisePlaneChannel
  /** Byte offset of the plane from the start of the frame's buffer. */
  readonly offset: number
  /** Bytes from a row's first byte to the next row's first byte. */
  readonly stride: number
  /**
   * Samples per row. For `p010le`'s `uv` plane a sample is one U or one V, alternating, so the
   * width is the frame's (rounded up to whole U,V pairs) and the row is that many 16-bit words.
   */
  readonly width: number
  /** Rows. `p010le`'s `uv` plane has half the frame's height, rounded up. */
  readonly height: number
  /** The plane's bytes in the buffer: `stride * height`. */
  readonly sizeBytes: number
}

/**
 * The plane layout of a frame in one of the four formats, at a size, from the start of its buffer.
 *
 * This is the one statement of where a plane's bytes are: P3's source pass uploads each plane with
 * it, P4's decoder splits FFmpeg's output with it, and P5's readback sizes the POST body with it.
 * The byte counts are FFmpeg's own, measured on this machine: `gbrp10le` is 6 bytes a pixel (three
 * full planes), `rgba64le` 8, and `p010le` 3 (a 2-byte luma sample and one byte of chroma per
 * pixel), which is 33,177,600 bytes at 3840×2880 — not 16.6 MB: a 10-bit 4:2:0 pixel is 24 bits, as
 * the design's own `yuv420p10le` row (33.2 MB) already said. Design §1.3 and §4.8 give `p010le` as
 * 1.5 bytes a pixel, half the real figure; this function and its test carry the measured one.
 */
export function precisePlaneLayout(
  format: PreciseInputFormat | PreciseOutputFormat,
  width: number,
  height: number,
): readonly PrecisePlane[] {
  const plane = (
    channel: PrecisePlaneChannel,
    offset: number,
    planeWidth: number,
    planeHeight: number,
    bytesPerSample: number,
  ): PrecisePlane => {
    const stride = planeWidth * bytesPerSample
    return {
      channel,
      offset,
      stride,
      width: planeWidth,
      height: planeHeight,
      sizeBytes: stride * planeHeight,
    }
  }

  switch (format) {
    case 'gbrp10le': {
      // FFmpeg's planar RGB order is G, B, R; each plane is width × height 16-bit words.
      const g = plane('g', 0, width, height, 2)
      const b = plane('b', g.sizeBytes, width, height, 2)
      const r = plane('r', g.sizeBytes + b.sizeBytes, width, height, 2)
      return [g, b, r]
    }
    case 'rgba64le':
      return [plane('rgba', 0, width, height, 8)]
    case 'p010le': {
      // 4:2:0 semi-planar: a full 16-bit luma plane, then one half-height plane of U,V pairs.
      const y = plane('y', 0, width, height, 2)
      const uv = plane('uv', y.sizeBytes, Math.ceil(width / 2) * 2, Math.ceil(height / 2), 2)
      return [y, uv]
    }
  }
}

/** The fixed byte length of one decoded frame in `format`, at a size: 3 bytes a pixel for `p010le`, 6 for `gbrp10le`. */
export function preciseFrameBytes(
  format: PreciseInputFormat,
  width: number,
  height: number,
): number {
  return precisePlaneLayout(format, width, height).reduce(
    (total, plane) => total + plane.sizeBytes,
    0,
  )
}

/** The fixed byte length of one readback frame in `format`, at a size: 3 bytes a pixel for `p010le`. */
export function preciseReadbackBytes(
  format: PreciseOutputFormat,
  width: number,
  height: number,
): number {
  return precisePlaneLayout(format, width, height).reduce(
    (total, plane) => total + plane.sizeBytes,
    0,
  )
}

/**
 * A decoded source frame as the native engine hands it over: its geometry, its plane layout and the
 * colour the decoder reported. The bytes themselves are not here — the page assembles them from the
 * `preciseFrameBytes` bytes of a frame's `Response` (see `native-protocol.ts`).
 */
export interface PreciseDecodedFrame {
  readonly frame: PreciseFrame
  readonly format: PreciseInputFormat
  readonly width: number
  readonly height: number
  /** The planes, in buffer order; see `precisePlaneLayout`. */
  readonly planes: readonly PrecisePlane[]
  /** The bytes of the whole frame buffer: the sum of the planes. */
  readonly sizeBytes: number
  /** What the decoder reported, before `resolveSourceColourTags` fills an unknown field. */
  readonly colour: ColourTags
}

/** A decoded frame's description, with the plane layout and byte size computed from its format. */
export function preciseDecodedFrame(input: {
  readonly frame: PreciseFrame
  readonly format: PreciseInputFormat
  readonly width: number
  readonly height: number
  readonly colour: ColourTags
}): PreciseDecodedFrame {
  return {
    ...input,
    planes: precisePlaneLayout(input.format, input.width, input.height),
    sizeBytes: preciseFrameBytes(input.format, input.width, input.height),
  }
}

/**
 * A frame on its way out: the bytes the GPU packed, in the readback format, at a fixed length.
 *
 * Frames are their own framing: the POST body is `sizeBytes` bytes per frame, back to back, with no
 * header between them (`native-protocol.ts`).
 */
export interface PreciseReadbackFrame {
  readonly frame: PreciseFrame
  readonly format: PreciseOutputFormat
  readonly width: number
  readonly height: number
  /** The frame's fixed byte length: `preciseReadbackBytes(format, width, height)`. */
  readonly sizeBytes: number
}

/** A readback frame's description, with its fixed byte length computed from its format. */
export function preciseReadbackFrame(input: {
  readonly frame: PreciseFrame
  readonly format: PreciseOutputFormat
  readonly width: number
  readonly height: number
}): PreciseReadbackFrame {
  return {
    ...input,
    sizeBytes: preciseReadbackBytes(input.format, input.width, input.height),
  }
}

/** The outputs the native encoder writes (design §4.4). 3.4's dialog lists these four. */
export type PreciseExportFormatId = 'hevc-main10' | 'prores-422-hq' | 'h264-8bit' | 'hevc-8bit'

/** What 3.4, P5 and P6 need to name and describe one output format. */
export interface PreciseExportFormat {
  readonly id: PreciseExportFormatId
  /**
   * The name the dialog shows. The translations and the plain-words limit strings live in the nine
   * language files and are 3.4's lines to report.
   */
  readonly label: string
  /** The muxer's container. */
  readonly container: 'mp4' | 'mov'
  /** The extension of the file the save dialog offers and P6 writes. */
  readonly extension: '.mp4' | '.mov'
  /** The bits the encoder keeps: 10 for the two masters, 8 for the two web-compatible outputs. */
  readonly bitDepth: 10 | 8
}

/**
 * The four outputs, in the order 3.4 shows them: the two 10-bit masters first.
 *
 * P5's `desktop/media/formats.ts` maps an id to its FFmpeg command line, tags and audio; nothing in
 * this file decides an encoder or a bitrate.
 */
export const EXPORT_FORMATS = [
  { id: 'hevc-main10', label: 'HEVC Main 10', container: 'mp4', extension: '.mp4', bitDepth: 10 },
  {
    id: 'prores-422-hq',
    label: 'ProRes 422 HQ',
    container: 'mov',
    extension: '.mov',
    bitDepth: 10,
  },
  { id: 'h264-8bit', label: 'H.264', container: 'mp4', extension: '.mp4', bitDepth: 8 },
  { id: 'hevc-8bit', label: 'HEVC', container: 'mp4', extension: '.mp4', bitDepth: 8 },
] as const satisfies readonly PreciseExportFormat[]

/** The hardware paths the engine can encode or decode through, by their FFmpeg family. */
export type NativeHardware = 'videotoolbox' | 'nvenc' | 'qsv' | 'amf' | 'd3d11va'

/**
 * What the running desktop shell's media engine can do.
 *
 * P4 fills it from FFmpeg's version and configuration line plus a one-frame probe, and the page
 * reads it once per session: 3.4 shows the entries of `EXPORT_FORMATS` the engine lists, the export
 * path hides the native engine when `available` is false, and the readback format is the first of
 * `outputFormats` the packer can write.
 */
export interface NativeEngineCapabilities {
  /** False when the shell has no FFmpeg binary: the web build, or an incomplete install. */
  readonly available: boolean
  /** FFmpeg's version line, when it was found. */
  readonly version: string | null
  /** The decoders found, by FFmpeg's names (`hevc`, `h264`, `prores`, `av1`). */
  readonly decoders: readonly string[]
  /** The encoders found, by FFmpeg's names (`hevc_videotoolbox`, `libx265`, `prores_ks`). */
  readonly encoders: readonly string[]
  /** The hardware paths found. */
  readonly hardware: readonly NativeHardware[]
  /** The pixel formats the decoder can produce for the GPU. */
  readonly inputFormats: readonly PreciseInputFormat[]
  /** The readback formats the encoder accepts, best first. */
  readonly outputFormats: readonly PreciseOutputFormat[]
  /** Which of `EXPORT_FORMATS` it can write, in the dialog's order. */
  readonly exportFormats: readonly PreciseExportFormatId[]
  /** Why it is not available, or what is missing, for the dialog's details and the log. */
  readonly message: string | null
}

/**
 * How many of an FFmpeg run's last log lines an error keeps: `NativeEngineError` drops the rest, so
 * a shell can hand over a whole stderr and the payload that crosses a process boundary stays small.
 */
export const NATIVE_ENGINE_LOG_LINES = 20

/**
 * A `NativeEngineError` as a plain object: the shape an IPC rejection or a protocol reply can carry
 * across processes, where a class instance loses its fields.
 */
export interface NativeEngineErrorPayload {
  /** What failed, in one sentence of English (the dialog has its own translated copy). */
  readonly message: string
  /** The command that ran, as it was spawned; the binary's arguments, not a shell line. */
  readonly command: readonly string[]
  /** FFmpeg's exit code, or null when a signal killed it. */
  readonly exitCode: number | null
  /** The signal that killed it, if one did. */
  readonly signal: string | null
  /** Its stderr lines in order; only the last `NATIVE_ENGINE_LOG_LINES` survive construction. */
  readonly log: readonly string[]
}

/**
 * A failure of the native media engine: the FFmpeg command that failed, its exit code and the last
 * lines it logged. P4's decoder and P5's encoder throw it; the page shows `message` and keeps
 * `log` for the report, never as interface text.
 */
export class NativeEngineError extends Error {
  readonly command: readonly string[]
  readonly exitCode: number | null
  readonly signal: string | null
  readonly log: readonly string[]

  constructor(payload: NativeEngineErrorPayload) {
    super(payload.message)
    this.name = 'NativeEngineError'
    this.command = payload.command
    this.exitCode = payload.exitCode
    this.signal = payload.signal
    this.log = payload.log.slice(-NATIVE_ENGINE_LOG_LINES)
  }

  /** The plain object to send where a class cannot cross a process boundary. */
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

/**
 * Where the renderer hands each finished frame of an export — the meeting point of the renderer and
 * the native encoder (the design's §7 hook in `src/runtime/renderer/frame-render-pass.ts`, which
 * calls `preciseOutputSink()?.deliver(...)` after compositing).
 *
 * `deliver` is called once per frame the renderer composites, in export order, on the thread that
 * renders it. `texture` is the frame's `rgba16float` composite at the project's size — the float
 * accumulator, before the one 8-bit conversion the preview and the web export use. Packing it to
 * `p010le`, reading it back and writing it to the encoder are P5's
 * (`src/studio/render/precise/readback.ts`); the 8-bit canvas is not what this path carries.
 *
 * The texture stays valid until the returned promise resolves; the renderer awaits `deliver` before
 * it composes the next frame into the accumulator again. A plain one-clip project reaches `deliver`
 * too: `frame-render-pass.ts` routes its direct path through the same composite.
 */
export interface PreciseOutputSink {
  deliver(texture: GPUTexture, frame: PreciseFrame): void | Promise<void>
}

let outputSink: PreciseOutputSink | null = null

/**
 * The sink an export registered, or null outside an export — which is why the renderer's hook does
 * nothing today and the stored golden frames do not move.
 */
export function preciseOutputSink(): PreciseOutputSink | null {
  return outputSink
}

/** Registers the sink that receives an export's frames; null unregisters it when the export ends. */
export function setPreciseOutputSink(sink: PreciseOutputSink | null): void {
  outputSink = sink
}

/**
 * Whether this renderer's frames belong to a precise export: a sink is registered **and** the
 * renderer renders an export. The preview is never one, even while an export runs in the same page
 * — its frames are not the encoder's, and delivering them would put preview frames into the file.
 */
export function preciseOutputActive(renderMode: 'export' | 'preview'): boolean {
  return renderMode === 'export' && outputSink !== null
}

/**
 * The format of every texture a renderer composites in: `rgba16float` during a precise export (the
 * design's float composite, §4.3) and `rgba8unorm` otherwise, so the preview, the golden kit and
 * the 8-bit web export keep the paths and the pixels they had.
 *
 * Every texture the renderer acquires or creates for a frame takes its format from here — the
 * compositor's accumulator, a media participant's output, a transition participant's output, the
 * sub-composition scratch. One answer for all of them, so no pass can write a float texture into an
 * 8-bit target or the reverse.
 */
export function preciseRenderFormat(renderMode: 'export' | 'preview'): GPUTextureFormat {
  return preciseOutputActive(renderMode) ? PRECISE_RENDER_FORMAT : 'rgba8unorm'
}
