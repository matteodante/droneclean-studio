/**
 * FFmpeg, as the native media engine uses it (task 3.1, slice P4).
 *
 * Three jobs, one file:
 *
 * 1. **Where the binary is.** `DRONECLEAN_FFMPEG`, then the packaged app's
 *    `Resources/ffmpeg/ffmpeg`, then the `ffmpeg` on `PATH` — which is the
 *    development run (`/opt/homebrew/bin/ffmpeg`, 9.0.2 on this Mac). Bundling
 *    our own build is a later slice; until then this resolves whatever the
 *    machine has.
 * 2. **What it can do.** `-version`, `-decoders`, `-encoders` and `-hwaccels`
 *    once per session, parsed into the contract's `NativeEngineCapabilities`. The
 *    `capabilities` channel answers from it, and 3.4 hides the formats it lists
 *    no encoder for.
 * 3. **The commands.** `ffprobe` reads a source's size, exact rate and colour
 *    tags (`probeSource`); `decodeArguments` is the decode line of design §4.1/§4.4
 *    (hardware decode where the machine has it; `p010le` frames on stdout as the
 *    decoder made them, converted to RGB on the GPU, or, for a source `p010le`
 *    cannot carry, `gbrp10le` frames FFmpeg converted); `spawnDecode` starts it and
 *    hands the process to `decode-stream.ts`.
 *
 * The command lines are pure functions of their inputs, so the tests in
 * `desktop/test/ffmpeg.test.mjs` assert them argument by argument without
 * running FFmpeg. Only `probeFfmpeg`, `probeSource` and `spawnDecode` touch the
 * system.
 */
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  NATIVE_ENGINE_LOG_LINES,
  NativeEngineFailure,
  type ColourMatrix,
  type ColourPrimaries,
  type ColourRange,
  type ColourTags,
  type ColourTransfer,
  type NativeEngineCapabilities,
  type NativeHardware,
  type PreciseExportFormatId,
  type PreciseInputFormat,
  type Rate,
} from '../../shared/native-media'
import type { DecodeProcess } from './decode-stream'
import { refuseUncPath } from './path-guard'

/** The FFmpeg and FFprobe binaries the shell will run. */
export interface FfmpegLocation {
  readonly ffmpeg: string
  readonly ffprobe: string
}

/** What resolving a binary needs from the system; the tests pass their own. */
export interface ResolveFfmpegOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  /** `process.resourcesPath`: the packaged app's Resources folder, absent outside Electron. */
  readonly resourcesPath: string | undefined
  readonly platform: NodeJS.Platform
  /** Whether a path is an executable file; `fs.existsSync` plus the execute bit in the shell. */
  readonly isExecutable: (candidate: string) => boolean
  /** False in a packaged app: `DRONECLEAN_FFMPEG` is then not read (finding D5). Default true. */
  readonly allowEnvOverride?: boolean
}

/** The file name of a bundled binary, with the extension the platform needs. */
export function binaryName(base: 'ffmpeg' | 'ffprobe', platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${base}.exe` : base
}

/**
 * The `ffmpeg` the shell will run, or null when the machine has none.
 *
 * The order is the brief's: `DRONECLEAN_FFMPEG` (an absolute path, for a machine
 * with several builds), the packaged app's `Resources/ffmpeg/`, then the `PATH`
 * of a development run. Existence is checked here rather than at the first
 * spawn, so `capabilities` can say "not available" instead of a decode failing.
 */
export function resolveFfmpegLocation(options: ResolveFfmpegOptions): FfmpegLocation | null {
  const { env, resourcesPath, platform, isExecutable } = options

  const fromEnv = options.allowEnvOverride === false ? undefined : env.DRONECLEAN_FFMPEG
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const ffmpeg = path.resolve(fromEnv.trim())
    if (!isExecutable(ffmpeg)) return null
    return withFfprobeBeside(ffmpeg, platform, isExecutable)
  }

  if (resourcesPath !== undefined && resourcesPath !== '') {
    const bundled = path.join(resourcesPath, 'ffmpeg', binaryName('ffmpeg', platform))
    if (isExecutable(bundled)) return withFfprobeBeside(bundled, platform, isExecutable)
  }

  const name = binaryName('ffmpeg', platform)
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (directory === '') continue
    const candidate = path.join(directory, name)
    if (isExecutable(candidate)) return withFfprobeBeside(candidate, platform, isExecutable)
  }
  return null
}

/** `ffprobe` sits beside the `ffmpeg` it came with; a build that lacks it cannot be used. */
function withFfprobeBeside(
  ffmpeg: string,
  platform: NodeJS.Platform,
  isExecutable: (candidate: string) => boolean,
): FfmpegLocation | null {
  const ffprobe = path.join(path.dirname(ffmpeg), binaryName('ffprobe', platform))
  return isExecutable(ffprobe) ? { ffmpeg, ffprobe } : null
}

/** Whether a path is a file this user may execute. */
export function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK)
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

/**
 * The decode line of design §4.1 and §4.4.
 *
 * `-hwaccel` when the machine has a hardware decoder (VideoToolbox on this Mac;
 * measured bit-identical to the software decode on three frames of clip 0020 and
 * 54.5 against 18.2 frames/s for the decode alone), then `-ss` before `-i` so
 * the seek is accurate, one video stream, the exact frame count, no frame-rate
 * conversion (`-fps_mode passthrough`: frame `k` of the output is frame `k` of
 * the source, never a duplicated or dropped one), the requested pixel format,
 * and the frames on stdout as bare `rawvideo` with no container and no framing
 * header. For `gbrp10le` (and `rgba64le`) FFmpeg makes the YUV→RGB conversion
 * with the source's own matrix and range expanded to full range; `p010le` is the
 * decoder's own planes with no filter at all (design 3.6 section 2.16: the GPU
 * converts them, `src/studio/render/precise/p010-in.ts`).
 */
export function decodeArguments(input: {
  readonly file: string
  readonly startSeconds: number
  readonly frames: number
  readonly format: PreciseInputFormat
  readonly tags: ColourTags
  readonly hardware: NativeHardware | null
  /** The platform the path is checked for; the running one unless a test says. */
  readonly platform?: NodeJS.Platform
}): string[] {
  refuseUncPath(input.file, 'decode', input.platform)
  if (!Number.isFinite(input.startSeconds) || input.startSeconds < 0) {
    throw new Error(`decode: the start must be a time in seconds, got ${input.startSeconds}`)
  }
  if (!Number.isSafeInteger(input.frames) || input.frames < 1) {
    throw new Error(`decode: the frame count must be a positive integer, got ${input.frames}`)
  }

  const conversion = [
    `in_range=${input.tags.range}`,
    `in_color_matrix=${input.tags.matrix}`,
    'out_range=pc',
    'out_color_matrix=bt709',
    'flags=accurate_rnd+full_chroma_int',
  ].join(':')

  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    ...(input.hardware === null ? [] : ['-hwaccel', input.hardware]),
    // The input is a file and nothing else: no `http:`, `concat:`, `subfile:` or
    // `tcp:` reached through a playlist or a crafted container (finding R7).
    '-protocol_whitelist',
    'file',
    '-ss',
    String(input.startSeconds),
    '-i',
    input.file,
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-frames:v',
    String(input.frames),
    '-fps_mode',
    'passthrough',
    ...(input.format === 'p010le' ? [] : ['-vf', `scale=${conversion}`]),
    '-pix_fmt',
    input.format,
    '-f',
    'rawvideo',
    'pipe:1',
  ]
}

/** `ffprobe`'s line: one video stream's size, rate and colour tags as JSON. */
export function probeArguments(file: string, platform?: NodeJS.Platform): string[] {
  refuseUncPath(file, 'probe', platform)
  return [
    '-v',
    'error',
    '-protocol_whitelist',
    'file',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,pix_fmt,avg_frame_rate,r_frame_rate,color_range,color_space,color_transfer,color_primaries',
    '-of',
    'json',
    file,
  ]
}

/** What a source's first video stream is: the reply's size, rate and colour come from here. */
export interface SourceInfo {
  readonly width: number
  readonly height: number
  /** FFmpeg's name of the decoded pixel format (`yuv420p10le` for clip 0020), '' when ffprobe did not say. */
  readonly pixelFormat: string
  readonly rate: Rate
  /** What ffprobe reported, before `resolveSourceColourTags` fills an unknown field. */
  readonly colour: ColourTags
}

/**
 * Reads `probeArguments`' JSON into the size, the exact rate and the colour the
 * decoder reports.
 *
 * A field ffprobe left out is `unknown` here and read as BT.709 by
 * `resolveSourceColourTags`, the contract's rule for an untagged file. The rate
 * prefers `avg_frame_rate` and falls back to `r_frame_rate`; both must be an
 * exact ratio, and `0/0` (a stream ffprobe could not measure) falls through.
 */
export function parseSourceInfo(json: string): SourceInfo {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('ffprobe: output is not JSON')
  }
  const streams = (parsed as { streams?: unknown }).streams
  const stream = Array.isArray(streams) ? (streams[0] as Record<string, unknown>) : undefined
  if (stream === undefined) throw new Error('ffprobe: the file has no video stream')

  const width = Number(stream.width)
  const height = Number(stream.height)
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error(`ffprobe: a video stream without a size (${String(stream.width)}x${String(stream.height)})`)
  }

  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  const rate = parseRate(text(stream.avg_frame_rate)) ?? parseRate(text(stream.r_frame_rate))
  if (rate === null) {
    throw new Error(
      `ffprobe: no usable frame rate (${JSON.stringify(stream.avg_frame_rate)} / ${JSON.stringify(stream.r_frame_rate)})`,
    )
  }

  return {
    width,
    height,
    pixelFormat: text(stream.pix_fmt),
    rate,
    colour: {
      matrix: colourMatrix(text(stream.color_space)),
      range: colourRange(text(stream.color_range)),
      transfer: colourTransfer(text(stream.color_transfer)),
      primaries: colourPrimaries(text(stream.color_primaries)),
    },
  }
}

/**
 * The pixel formats whose frames `p010le` carries without loss: 4:2:0 at 8, 9 or
 * 10 bits. A 4:2:2 or 4:4:4 source would lose chroma, a 12-bit one bits.
 */
const P010_CARRIES = new Set([
  'yuv420p',
  'yuv420p9le',
  'yuv420p9be',
  'yuv420p10le',
  'yuv420p10be',
  'nv12',
  'nv21',
  'p010le',
  'p010be',
])

/**
 * The format a decode delivers when the page asked for `requested`: `p010le` only
 * for a limited-range (or untagged) 4:2:0 source of at most 10 bits whose matrix
 * the GPU converts (BT.709, BT.601, or untagged), otherwise `gbrp10le`, which
 * FFmpeg converts itself. The page reads the answer from `DecodeStartReply.format`.
 */
export function deliveredDecodeFormat(
  requested: PreciseInputFormat,
  source: Pick<SourceInfo, 'pixelFormat' | 'colour'>,
): PreciseInputFormat {
  if (requested !== 'p010le') return requested
  const { range, matrix } = source.colour
  const carries =
    P010_CARRIES.has(source.pixelFormat) &&
    (range === 'tv' || range === 'unknown') &&
    (matrix === 'bt709' || matrix === 'bt470bg' || matrix === 'smpte170m' || matrix === 'unknown')
  return carries ? 'p010le' : 'gbrp10le'
}

/** `60000/1001` as an exact rate, reduced; null for `0/0` or anything malformed. */
export function parseRate(text: string): Rate | null {
  const match = /^(\d+)\/(\d+)$/.exec(text.trim())
  if (!match) return null
  const num = Number(match[1])
  const den = Number(match[2])
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) return null
  const divisor = greatestCommonDivisor(num, den)
  return { num: num / divisor, den: den / divisor }
}

function greatestCommonDivisor(a: number, b: number): number {
  let [x, y] = [a, b]
  while (y !== 0) [x, y] = [y, x % y]
  return x
}

/** FFmpeg's `color_space` name as the contract's matrix, or `unknown`. */
export function colourMatrix(name: string): ColourMatrix {
  switch (name) {
    case 'bt709':
    case 'bt470bg':
    case 'smpte170m':
    case 'bt2020nc':
      return name
    default:
      return 'unknown'
  }
}

/** FFmpeg's `color_range` as the contract's range, or `unknown`. */
export function colourRange(name: string): ColourRange {
  return name === 'tv' || name === 'pc' ? name : 'unknown'
}

/** FFmpeg's `color_transfer` as the contract's transfer, or `unknown`. */
export function colourTransfer(name: string): ColourTransfer {
  switch (name) {
    case 'bt709':
    case 'smpte170m':
    case 'linear':
    case 'bt2020-10':
    case 'smpte2084':
    case 'arib-std-b67':
      return name
    default:
      return 'unknown'
  }
}

/** FFmpeg's `color_primaries` as the contract's primaries, or `unknown`. */
export function colourPrimaries(name: string): ColourPrimaries {
  switch (name) {
    case 'bt709':
    case 'bt470bg':
    case 'smpte170m':
    case 'bt2020':
      return name
    default:
      return 'unknown'
  }
}

/**
 * The hardware decoder to ask FFmpeg for, given what the build lists and the
 * platform: VideoToolbox on macOS, D3D11VA on Windows. Software decoding is the
 * fallback (`null`), never an error.
 */
export function preferredHardware(
  available: readonly NativeHardware[],
  platform: NodeJS.Platform,
): NativeHardware | null {
  const order: readonly NativeHardware[] =
    platform === 'darwin' ? ['videotoolbox'] : ['d3d11va']
  return order.find((candidate) => available.includes(candidate)) ?? null
}

/** The four probes' raw output, as `probeFfmpeg` collects it. */
export interface CapabilityOutput {
  readonly version: string
  readonly decoders: string
  readonly encoders: string
  readonly hwaccels: string
}

const DECODERS_OF_INTEREST = ['hevc', 'h264', 'prores', 'av1'] as const
const ENCODERS_OF_INTEREST = [
  'hevc_videotoolbox',
  'h264_videotoolbox',
  'prores_videotoolbox',
  'libx265',
  'libx264',
  'prores_ks',
  'hevc_nvenc',
  'hevc_qsv',
  'hevc_amf',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
] as const

/** The FFmpeg capability lists as `-decoders`/`-encoders`/`-hwaccels` print them: the names only. */
export function listedNames(output: string): string[] {
  const names: string[] = []
  for (const line of output.split('\n')) {
    const match = /^\s*[A-Z.]{6}\s+(\S+)/.exec(line)
    if (match?.[1] !== undefined) names.push(match[1])
  }
  return names
}

/** `-hwaccels` prints one name per line with no flags column. */
export function listedHwaccels(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.includes(' ') && line !== 'Hardware acceleration methods:')
}

/**
 * The capabilities the contract describes, from the four probes.
 *
 * `inputFormats` is both the decoder can produce for the GPU (`rawvideo` writes
 * them whatever the machine); `outputFormats` is P5's to narrow once the
 * `p010le` packer is proven. `exportFormats` keeps only the entries of
 * `EXPORT_FORMATS` this build lists an encoder for, in the dialog's order.
 */
export function parseCapabilities(output: CapabilityOutput): NativeEngineCapabilities {
  const decoders = listedNames(output.decoders).filter((name) =>
    (DECODERS_OF_INTEREST as readonly string[]).includes(name),
  )
  const encoders = listedNames(output.encoders).filter((name) =>
    (ENCODERS_OF_INTEREST as readonly string[]).includes(name),
  )
  const hwaccels = listedHwaccels(output.hwaccels)

  const hardware: NativeHardware[] = []
  if (hwaccels.includes('videotoolbox')) hardware.push('videotoolbox')
  if (hwaccels.includes('d3d11va')) hardware.push('d3d11va')
  for (const family of ['nvenc', 'qsv', 'amf'] as const) {
    if (encoders.some((name) => name.endsWith(`_${family}`))) hardware.push(family)
  }

  const has = (...names: readonly string[]): boolean => names.some((name) => encoders.includes(name))
  const exportFormats: PreciseExportFormatId[] = []
  if (has('hevc_videotoolbox', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265')) {
    exportFormats.push('hevc-main10')
  }
  if (has('prores_videotoolbox', 'prores_ks')) exportFormats.push('prores-422-hq')
  if (has('h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264')) {
    exportFormats.push('h264-8bit')
  }
  if (has('hevc_videotoolbox', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265')) {
    exportFormats.push('hevc-8bit')
  }

  const missing = (DECODERS_OF_INTEREST as readonly string[]).filter(
    (name) => !decoders.includes(name),
  )
  return {
    available: true,
    version: firstLine(output.version),
    decoders,
    encoders,
    hardware,
    inputFormats: ['p010le', 'gbrp10le', 'rgba64le'],
    outputFormats: ['p010le', 'rgba64le'],
    exportFormats,
    message: missing.length === 0 ? null : `the decoder lacks ${missing.join(', ')}`,
  }
}

function firstLine(text: string): string | null {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '')
  return line === undefined ? null : line.trim()
}

/** The capabilities of a shell with no FFmpeg: what 3.4 shows instead of the formats. */
export function unavailableCapabilities(message: string): NativeEngineCapabilities {
  return {
    available: false,
    version: null,
    decoders: [],
    encoders: [],
    hardware: [],
    inputFormats: [],
    outputFormats: [],
    exportFormats: [],
    message,
  }
}

/** One `ffmpeg`/`ffprobe` run that must succeed; its stdout, or an engine failure with the last lines. */
export function runTool(command: readonly string[], timeoutMs = 30_000): Promise<string> {
  const [binary, ...args] = command
  if (binary === undefined) return Promise.reject(new Error('no binary to run'))
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        reject(
          new NativeEngineFailure({
            message: `${path.basename(binary)} exited with ${describeExit(error.code, error.signal)}`,
            command,
            exitCode: typeof error.code === 'number' ? error.code : null,
            signal: typeof error.signal === 'string' ? error.signal : null,
            log: stderrTail(stderr),
          }),
        )
      },
    )
  })
}

/** `code 1`, `signal SIGKILL`: how a process's end reads in a message. */
function describeExit(code: number | string | null | undefined, signal: string | null | undefined): string {
  if (typeof signal === 'string' && signal !== '') return `signal ${signal}`
  return typeof code === 'number' ? `code ${code}` : 'an unknown error'
}

/** The last `NATIVE_ENGINE_LOG_LINES` non-empty lines of a stderr, as the payload keeps them. */
export function stderrTail(stderr: string): string[] {
  return stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-NATIVE_ENGINE_LOG_LINES)
}

/** What a source is, as `probeSource` reads it. */
export async function probeSource(ffprobe: string, file: string): Promise<SourceInfo> {
  const command = [ffprobe, ...probeArguments(file)]
  return parseSourceInfo(await runTool(command))
}

let cachedLocation: FfmpegLocation | null | undefined
let allowEnvOverride = true

/**
 * Whether `DRONECLEAN_FFMPEG` may choose the binary; the shell turns it off in a
 * packaged app. Forgets a binary resolved under the other setting.
 */
export function configureFfmpegOverride(allow: boolean): void {
  allowEnvOverride = allow
  cachedLocation = undefined
  cachedCapabilities = undefined
}
let cachedCapabilities: Promise<NativeEngineCapabilities> | undefined

/**
 * What to tell the user when there is no FFmpeg. `DRONECLEAN_FFMPEG` is only read by an unpackaged run
 * (`configureFfmpegOverride`), so an installed app does not offer it: its FFmpeg is part of the install.
 */
export function missingFfmpegMessage(overrideAllowed: boolean = allowEnvOverride): string {
  return overrideAllowed
    ? 'no FFmpeg binary: set DRONECLEAN_FFMPEG to one, or add ffmpeg to PATH'
    : 'the FFmpeg that comes with DroneClean Studio is missing or cannot be run: reinstall the app'
}

/** The binaries of this run, resolved once they are found; null (not remembered) when the machine has none. */
export function ffmpegLocation(): FfmpegLocation | null {
  if (cachedLocation === undefined || cachedLocation === null) {
    cachedLocation = resolveFfmpegLocation({
      env: process.env,
      resourcesPath: process.resourcesPath,
      platform: process.platform,
      isExecutable: isExecutableFile,
      allowEnvOverride,
    })
  }
  return cachedLocation
}

/**
 * The capabilities of this run, probed once and cached. With no binary the answer
 * is `available: false` and the message says how to point the shell at one.
 */
export function ffmpegCapabilities(): Promise<NativeEngineCapabilities> {
  if (cachedCapabilities === undefined) {
    const probe = probeCapabilities()
    cachedCapabilities = probe
    // A probe that found nothing usable (a slow first start, a binary still being scanned) is not remembered: the
    // next call asks again instead of leaving native export off until the app restarts.
    void probe.then(
      (result) => {
        if (!result.available && cachedCapabilities === probe) cachedCapabilities = undefined
      },
      () => {
        if (cachedCapabilities === probe) cachedCapabilities = undefined
      },
    )
  }
  return cachedCapabilities
}

async function probeCapabilities(): Promise<NativeEngineCapabilities> {
  const location = ffmpegLocation()
  if (location === null) {
    return unavailableCapabilities(missingFfmpegMessage())
  }
  try {
    const [version, decoders, encoders, hwaccels] = await Promise.all([
      runTool([location.ffmpeg, '-hide_banner', '-version']),
      runTool([location.ffmpeg, '-hide_banner', '-decoders']),
      runTool([location.ffmpeg, '-hide_banner', '-encoders']),
      runTool([location.ffmpeg, '-hide_banner', '-hwaccels']),
    ])
    return parseCapabilities({ version, decoders, encoders, hwaccels })
  } catch (error) {
    const payload = error instanceof NativeEngineFailure ? error : null
    const reason = payload === null ? String(error) : payload.log.at(-1) ?? payload.message
    return { ...unavailableCapabilities(`FFmpeg did not answer: ${reason}`), version: null }
  }
}

/**
 * Starts a decode and hands the process to `decode-stream.ts`.
 *
 * stdout is a pipe of bare frames; stderr is kept as its last lines for the
 * report a failed decode carries. Nothing is written back, so stdin is
 * `/dev/null` (`-nostdin` also keeps FFmpeg from reading a terminal).
 */
export function spawnDecode(input: {
  readonly ffmpeg: string
  readonly args: readonly string[]
}): DecodeProcess {
  const command = [input.ffmpeg, ...input.args]
  const child = spawn(input.ffmpeg, [...input.args], { stdio: ['ignore', 'pipe', 'pipe'] })

  let log = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    log = `${log}${chunk}`.slice(-64 * 1024)
  })

  const exited = new Promise<{ readonly code: number | null; readonly signal: string | null }>(
    (resolve) => {
      child.once('error', () => resolve({ code: null, signal: null }))
      child.once('close', (code, signal) => resolve({ code, signal: signal ?? null }))
    },
  )

  return {
    command,
    stdout: child.stdout,
    exited,
    kill() {
      // A killed FFmpeg must not keep the pipe's unread frames alive; the ring is
      // freed by the job that cancels it, and the stream is destroyed here.
      child.kill('SIGKILL')
      child.stdout.destroy()
    },
    stderrTail() {
      return stderrTail(log)
    },
  }
}
