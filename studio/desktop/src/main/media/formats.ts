/**
 * The export formats as FFmpeg command lines (task 3.3, slice P5): pure functions
 * from a format, an encoder, a size, a rate and the tags to the argument list, so
 * a test can pin every argument and nothing here starts a process.
 *
 * **Input.** The page's readback arrives on stdin as bare `rawvideo`: `p010le`
 * (VideoToolbox's own format, packed by the GPU: the code values sit in the high
 * ten bits of 16-bit words) or the heavier `rgba64le` fallback, which FFmpeg
 * converts to limited-range BT.709 itself. The size and the exact rate (`-framerate
 * 60000/1001`) are given to the demuxer; no frame is ever duplicated or dropped
 * (`-fps_mode passthrough`), so frame `k` of the file is frame `k` of the readback.
 *
 * **Output.** Four formats (`EXPORT_FORMATS` in the contract): HEVC Main 10, ProRes
 * 422 HQ, 8-bit H.264 and 8-bit H.265. Each has a hardware encoder per platform
 * and a software one as the fallback; `chooseEncoder` picks from the encoder names
 * `ffmpeg.ts` found. Every file carries the colour tags it was asked for (BT.709
 * limited by default, design 3.1 §4.4) both on the stream and in the container.
 *
 * **Audio.** There is none unless the caller gives a source: it is copied when its
 * codec is allowed in the container, otherwise encoded (AAC 320k, or 24-bit PCM
 * for a ProRes master).
 */
import type {
  ColourTags,
  PreciseExportFormatId,
  PreciseOutputFormat,
  Rate,
} from '../../shared/native-media'
import { refuseUncPath } from './path-guard'

/** Every video encoder this file can write a command line for. */
export type VideoEncoderName =
  | 'hevc_videotoolbox'
  | 'prores_videotoolbox'
  | 'h264_videotoolbox'
  | 'hevc_nvenc'
  | 'av1_nvenc'
  | 'h264_nvenc'
  | 'hevc_qsv'
  | 'h264_qsv'
  | 'hevc_amf'
  | 'h264_amf'
  | 'libx265'
  | 'libx264'
  | 'prores_ks'

/** The hardware encoder families, which the export record names. */
const HARDWARE_ENCODERS: ReadonlySet<VideoEncoderName> = new Set([
  'hevc_videotoolbox',
  'prores_videotoolbox',
  'h264_videotoolbox',
  'hevc_nvenc',
  'av1_nvenc',
  'h264_nvenc',
  'hevc_qsv',
  'h264_qsv',
  'hevc_amf',
  'h264_amf',
])

/** Whether an encoder runs on a media engine (VideoToolbox, NVENC, Quick Sync, AMF) and not on the CPU. */
export function isHardwareEncoder(encoder: VideoEncoderName): boolean {
  return HARDWARE_ENCODERS.has(encoder)
}

/** The encoders of each format, best first, by platform: hardware before software. */
const ENCODER_ORDER: Readonly<
  Record<PreciseExportFormatId, Readonly<Record<'darwin' | 'win32' | 'other', readonly VideoEncoderName[]>>>
> = {
  'hevc-main10': {
    darwin: ['hevc_videotoolbox', 'libx265'],
    win32: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265'],
    other: ['hevc_nvenc', 'hevc_qsv', 'libx265'],
  },
  'hevc-8bit': {
    darwin: ['hevc_videotoolbox', 'libx265'],
    win32: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265'],
    other: ['hevc_nvenc', 'hevc_qsv', 'libx265'],
  },
  'h264-8bit': {
    darwin: ['h264_videotoolbox', 'libx264'],
    win32: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'],
    other: ['h264_nvenc', 'h264_qsv', 'libx264'],
  },
  // ProRes has a hardware encoder on the Mac only; Windows and Linux use `prores_ks`.
  'prores-422-hq': {
    darwin: ['prores_videotoolbox', 'prores_ks'],
    win32: ['prores_ks'],
    other: ['prores_ks'],
  },
}

/**
 * The encoder to run for a format: the first of the platform's list that the
 * FFmpeg build has (`NativeEngineCapabilities.encoders`), or null when it has
 * none. A hardware encoder that is listed but refuses to open (no such card) is
 * the process's failure to report; the choice here is by what is listed.
 */
export function chooseEncoder(
  format: PreciseExportFormatId,
  available: readonly string[],
  platform: NodeJS.Platform,
): VideoEncoderName | null {
  const key = platform === 'darwin' || platform === 'win32' ? platform : 'other'
  return ENCODER_ORDER[format][key].find((name) => available.includes(name)) ?? null
}

/** The container of each format, as FFmpeg names its muxer. */
const CONTAINER: Readonly<Record<PreciseExportFormatId, 'mp4' | 'mov'>> = {
  'hevc-main10': 'mp4',
  'hevc-8bit': 'mp4',
  'h264-8bit': 'mp4',
  'prores-422-hq': 'mov',
}

/** The file extension each format writes, lower case with the dot. */
export function outputExtension(format: PreciseExportFormatId): '.mp4' | '.mov' {
  return CONTAINER[format] === 'mp4' ? '.mp4' : '.mov'
}

/** The pixel format the encoder is given: what the format's bit depth and chroma need. */
function encoderPixelFormat(format: PreciseExportFormatId, encoder: VideoEncoderName): string {
  switch (format) {
    case 'prores-422-hq':
      // ProRes is 4:2:2; the 4:2:0 readback is upsampled in the scaler.
      return 'yuv422p10le'
    case 'h264-8bit':
    case 'hevc-8bit':
      return 'yuv420p'
    case 'hevc-main10':
      // Software HEVC takes planar 10-bit; the hardware encoders take the readback's own p010le.
      return encoder === 'libx265' ? 'yuv420p10le' : 'p010le'
  }
}

/** The encoder-specific options of one encoder for one format; `bitrate` is bits per second. */
function encoderOptions(
  format: PreciseExportFormatId,
  encoder: VideoEncoderName,
  bitrate: number,
): string[] {
  const rate = String(bitrate)
  switch (encoder) {
    case 'hevc_videotoolbox':
      return [
        '-c:v',
        encoder,
        '-profile:v',
        format === 'hevc-main10' ? 'main10' : 'main',
        '-tag:v',
        'hvc1',
        '-b:v',
        rate,
      ]
    case 'h264_videotoolbox':
      return ['-c:v', encoder, '-profile:v', 'high', '-b:v', rate]
    case 'prores_videotoolbox':
      return ['-c:v', encoder, '-profile:v', 'hq']
    case 'libx265':
      return [
        '-c:v',
        encoder,
        '-profile:v',
        format === 'hevc-main10' ? 'main10' : 'main',
        '-tag:v',
        'hvc1',
        '-preset',
        'medium',
        '-b:v',
        rate,
        '-x265-params',
        'log-level=error',
      ]
    case 'libx264':
      return ['-c:v', encoder, '-profile:v', 'high', '-preset', 'medium', '-b:v', rate]
    case 'prores_ks':
      return ['-c:v', encoder, '-profile:v', 'hq', '-vendor', 'apl0']
    case 'hevc_nvenc':
      return [
        '-c:v',
        encoder,
        '-profile:v',
        format === 'hevc-main10' ? 'main10' : 'main',
        '-tag:v',
        'hvc1',
        '-preset',
        'p5',
        '-tune',
        'hq',
        '-rc',
        'vbr',
        '-b:v',
        rate,
      ]
    case 'av1_nvenc':
      return ['-c:v', encoder, '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-b:v', rate]
    case 'h264_nvenc':
      return [
        '-c:v',
        encoder,
        '-profile:v',
        'high',
        '-preset',
        'p5',
        '-tune',
        'hq',
        '-rc',
        'vbr',
        '-b:v',
        rate,
      ]
    case 'hevc_qsv':
      return [
        '-c:v',
        encoder,
        '-profile:v',
        format === 'hevc-main10' ? 'main10' : 'main',
        '-tag:v',
        'hvc1',
        '-b:v',
        rate,
      ]
    case 'h264_qsv':
      return ['-c:v', encoder, '-profile:v', 'high', '-b:v', rate]
    case 'hevc_amf':
      return [
        '-c:v',
        encoder,
        '-profile:v',
        format === 'hevc-main10' ? 'main10' : 'main',
        '-tag:v',
        'hvc1',
        '-usage',
        'high_quality',
        '-b:v',
        rate,
      ]
    case 'h264_amf':
      return ['-c:v', encoder, '-profile:v', 'high', '-usage', 'high_quality', '-b:v', rate]
  }
}

/** The encoders a format may run on, so a mismatched pair is refused rather than half-built. */
function encoderSuits(format: PreciseExportFormatId, encoder: VideoEncoderName): boolean {
  switch (format) {
    case 'prores-422-hq':
      return encoder === 'prores_videotoolbox' || encoder === 'prores_ks'
    case 'h264-8bit':
      return encoder.startsWith('h264_') || encoder === 'libx264'
    case 'hevc-8bit':
      return encoder.startsWith('hevc_') || encoder === 'libx265'
    case 'hevc-main10':
      // `av1_nvenc` is 10-bit too, but an AV1 file is not one of the four formats' output
      // (the contract has no AV1 id yet); it is accepted here for the day it has one.
      return encoder.startsWith('hevc_') || encoder === 'libx265' || encoder === 'av1_nvenc'
  }
}

/** The names FFmpeg's colour options take for each tag; `unknown` writes no option. */
const MATRIX_NAMES: Readonly<Record<string, string>> = {
  bt709: 'bt709',
  bt470bg: 'bt470bg',
  smpte170m: 'smpte170m',
  bt2020nc: 'bt2020nc',
}
const TRANSFER_NAMES: Readonly<Record<string, string>> = {
  bt709: 'bt709',
  smpte170m: 'smpte170m',
  linear: 'linear',
  'bt2020-10': 'bt2020-10',
  smpte2084: 'smpte2084',
  'arib-std-b67': 'arib-std-b67',
}
const PRIMARIES_NAMES: Readonly<Record<string, string>> = {
  bt709: 'bt709',
  bt470bg: 'bt470bg',
  smpte170m: 'smpte170m',
  bt2020: 'bt2020',
}

/**
 * The four colour options of a tag set, in FFmpeg's order: range, matrix,
 * primaries, transfer. Default output: `-color_range tv -colorspace bt709
 * -color_primaries bt709 -color_trc bt709`.
 */
export function colourArguments(tags: ColourTags): string[] {
  const args: string[] = []
  if (tags.range !== 'unknown') args.push('-color_range', tags.range)
  const matrix = MATRIX_NAMES[tags.matrix]
  if (matrix !== undefined) args.push('-colorspace', matrix)
  const primaries = PRIMARIES_NAMES[tags.primaries]
  if (primaries !== undefined) args.push('-color_primaries', primaries)
  const transfer = TRANSFER_NAMES[tags.transfer]
  if (transfer !== undefined) args.push('-color_trc', transfer)
  return args
}

/** What the audio of a file does: nothing, a copy of the source's stream, or a re-encode. */
export type AudioPlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'copy' }
  | { readonly kind: 'aac' }
  | { readonly kind: 'pcm_s24le' }

/** The codecs each container takes as a stream copy. */
const COPYABLE_AUDIO: Readonly<Record<'mp4' | 'mov', readonly string[]>> = {
  mp4: ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'opus'],
  mov: ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le'],
}

/**
 * What to do with a source's audio: copy it when the container takes its codec,
 * otherwise encode it, to 24-bit PCM for the ProRes master and to AAC 320k for the
 * MP4 formats.
 */
export function planAudio(
  format: PreciseExportFormatId,
  sourceCodec: string | null,
): AudioPlan {
  if (sourceCodec === null) return { kind: 'none' }
  const container = CONTAINER[format]
  if (COPYABLE_AUDIO[container].includes(sourceCodec)) return { kind: 'copy' }
  return format === 'prores-422-hq' ? { kind: 'pcm_s24le' } : { kind: 'aac' }
}

/** The raw format and rate of the staged mix (`audio-stage.ts`). */
const MIX_FORMAT = 'f32le'
const MIX_SAMPLE_RATE = 48_000

/** A master's sound: 24-bit PCM in the ProRes `.mov`, AAC-LC 320 kb/s in the MP4s. */
export function mixPlan(format: PreciseExportFormatId): AudioPlan {
  return format === 'prores-422-hq' ? { kind: 'pcm_s24le' } : { kind: 'aac' }
}

/** The audio of an export: the source file, where its first sample is, and its codec. */
export interface AudioSource {
  readonly file: string
  readonly startSeconds: number
  /** FFmpeg's name for the source stream's codec (`aac`, `pcm_s16le`). */
  readonly codec: string
}

/** What `encodeArguments` needs. */
export interface EncodeArgumentsInput {
  readonly format: PreciseExportFormatId
  readonly encoder: VideoEncoderName
  /** The readback format on stdin. */
  readonly readback: PreciseOutputFormat
  readonly width: number
  readonly height: number
  readonly fps: Rate
  /** Video bits per second; ProRes ignores it. */
  readonly bitrate: number
  /** The tags every output carries. */
  readonly tags: ColourTags
  /** The final path the file is written to. */
  readonly path: string
  /** The exact frame count, when the caller knows it: FFmpeg stops there (`-frames:v`). */
  readonly frames?: number
  readonly audio?: AudioSource
  /**
   * The project's mixed sound as the page staged it (`audio-stage.ts`): interleaved stereo `float32le` at 48 kHz in
   * one file. It is encoded for the master (24-bit PCM in ProRes, AAC 320 kb/s in the MP4s); with no `mix` the
   * file has no audio stream.
   */
  readonly mix?: { readonly file: string }
  /** The platform the paths are checked for; the running one unless a test says. */
  readonly platform?: NodeJS.Platform
}

/** The largest frame side an encoder is asked for; HEVC level 6.2 stops at 8192. */
const MAX_SIDE = 16384

/**
 * The whole FFmpeg command line (without the binary) of one export.
 *
 * `-progress pipe:1` makes FFmpeg report the frames it muxed on stdout, which is
 * how `encode-stream.ts` checks that every frame it fed arrived in the file; the
 * log stays on stderr (`-v error`) for the failure report. The output is
 * `file:<path>` so a path is never read as a URL, and `-y` is there because the
 * user chose the path in a save dialog that asked about overwriting.
 */
export function encodeArguments(input: EncodeArgumentsInput): string[] {
  refuseUncPath(input.path, 'encode', input.platform)
  if (input.audio !== undefined) refuseUncPath(input.audio.file, 'encode audio', input.platform)
  if (input.mix !== undefined) refuseUncPath(input.mix.file, 'encode audio', input.platform)
  if (input.audio !== undefined && input.mix !== undefined) {
    throw new Error('encode: a source audio and a project mix cannot both be the sound of one file')
  }
  if (!Number.isSafeInteger(input.width) || input.width < 2 || input.width > MAX_SIDE || input.width % 2 !== 0) {
    throw new Error(`encode: the width must be an even number of pixels up to ${MAX_SIDE}, got ${input.width}`)
  }
  if (!Number.isSafeInteger(input.height) || input.height < 2 || input.height > MAX_SIDE || input.height % 2 !== 0) {
    throw new Error(`encode: the height must be an even number of pixels up to ${MAX_SIDE}, got ${input.height}`)
  }
  if (!Number.isSafeInteger(input.fps.num) || !Number.isSafeInteger(input.fps.den) || input.fps.num < 1 || input.fps.den < 1) {
    throw new Error(`encode: the rate must be a ratio of positive integers, got ${input.fps.num}/${input.fps.den}`)
  }
  if (!Number.isSafeInteger(input.bitrate) || input.bitrate < 1) {
    throw new Error(`encode: the bitrate must be a positive number of bits per second, got ${input.bitrate}`)
  }
  if (input.frames !== undefined && (!Number.isSafeInteger(input.frames) || input.frames < 1)) {
    throw new Error(`encode: the frame count must be a positive integer, got ${input.frames}`)
  }
  if (!encoderSuits(input.format, input.encoder)) {
    throw new Error(`encode: ${input.encoder} cannot write ${input.format}`)
  }

  const rate = `${input.fps.num}/${input.fps.den}`
  const container = CONTAINER[input.format]
  const audio: AudioPlan =
    input.mix === undefined ? planAudio(input.format, input.audio?.codec ?? null) : mixPlan(input.format)

  // `rgba64le` is full-range RGB: FFmpeg converts it with the output's matrix and limited range.
  const conversion =
    input.readback === 'rgba64le'
      ? [
          '-vf',
          'scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int',
        ]
      : []

  return [
    '-hide_banner',
    '-nostats',
    '-v',
    'error',
    '-progress',
    'pipe:1',
    '-y',
    // The readback: bare frames on stdin, with the size and the exact rate that no header carries.
    '-protocol_whitelist',
    'file,pipe',
    '-f',
    'rawvideo',
    '-pix_fmt',
    input.readback,
    '-video_size',
    `${input.width}x${input.height}`,
    '-framerate',
    rate,
    ...(input.readback === 'p010le' ? colourArguments(input.tags) : []),
    '-i',
    'pipe:0',
    ...(input.audio === undefined
      ? []
      : [
          '-protocol_whitelist',
          'file',
          '-ss',
          String(input.audio.startSeconds),
          '-i',
          input.audio.file,
        ]),
    // The project's mix: raw stereo float at 48 kHz, from the file the page staged.
    ...(input.mix === undefined
      ? []
      : [
          '-protocol_whitelist',
          'file',
          '-f',
          MIX_FORMAT,
          '-ar',
          String(MIX_SAMPLE_RATE),
          '-ac',
          '2',
          '-i',
          `file:${input.mix.file}`,
        ]),
    '-map',
    '0:v:0',
    ...(audio.kind === 'none' ? ['-an'] : ['-map', '1:a:0', ...audioOptions(audio)]),
    '-sn',
    '-dn',
    // Nothing of the source's metadata travels: not its global tags (GPS, serial), not its stream tags, not its
    // chapters (privacy, task 3.4).
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    // A source's audio may run past the picture; the project's mix is cut to the project's length, so nothing ends it.
    ...(audio.kind === 'none' || input.mix !== undefined ? [] : ['-shortest']),
    ...(input.frames === undefined ? [] : ['-frames:v', String(input.frames)]),
    '-fps_mode',
    'passthrough',
    ...conversion,
    '-pix_fmt',
    encoderPixelFormat(input.format, input.encoder),
    '-sws_flags',
    'accurate_rnd+full_chroma_int',
    ...encoderOptions(input.format, input.encoder, input.bitrate),
    ...colourArguments(input.tags),
    '-f',
    container,
    `file:${input.path}`,
  ]
}

function audioOptions(plan: AudioPlan): string[] {
  switch (plan.kind) {
    case 'copy':
      return ['-c:a', 'copy']
    case 'aac':
      return ['-c:a', 'aac', '-b:a', '320k']
    case 'pcm_s24le':
      return ['-c:a', 'pcm_s24le']
    case 'none':
      return []
  }
}
