/* eslint-disable no-console -- a command-line tool */
// Native 10-bit export: the desktop's own path, FFmpeg `p010le` in, the GPU conversion, the accumulator packed back to
// `p010le`, FFmpeg out (design 3.6 slice 7, plan tasks 8.4 and 3.3, review finding R5). It needs Electron, FFmpeg, a GPU
// and the clip, and drives `bench/native/` (page and Electron main) once per part:
//
//   fidelity  frames 10, 150 and 299 of the 10 s cut, converted on the GPU, against FFmpeg's own `gbrp10le` of the same
//             frames (the conversion the decoder made until now), in levels of 1023 per channel;
//   pack      one clip frame and a synthetic picture (luma noise, smooth chroma) packed to `p010le` on the GPU and
//             decoded by FFmpeg, against the accumulator they were packed from; and the clip frame's packed codes
//             against the codes it was decoded from;
//   ramp      the kit's 877-level grey ramp through the backend (levels of one row of the float texture, exact) and
//             through a whole 10-bit export (levels per row of the file's luma plane);
//   export    10 s of the clip exported as HEVC Main 10 at 120 Mbps and as ProRes 422 HQ: frames per second, the
//             page's buffers and textures created after the first frames, the peak memory of Electron and FFmpeg;
//   legs      where the time goes: the export with the packed frames read back and dropped (no upload, no encoder);
//             frames from memory posted to the encoder (no decode, no GPU); FFmpeg alone decoding to a pipe and into
//             the shell's own encode command line (the ceiling of this two-process shape).
//
//   node bench/measurements/native-export.mjs [fidelity|pack|ramp|legs|export|all]   (through scripts/heavy.sh)
//
// The comparison frames, the packed frames and the exported files are written into `tmp/native-export/` (outside git);
// the 10 s ProRes file is deleted once probed.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, REPO_ROOT } from '../lib/config.mjs'
import { ensureRamp, RAMP_SCORED_FROM_ROW } from '../lib/inputs.mjs'
import { decodeLuma10, distinctLevelsPerRow, summariseCounts } from '../lib/levels.mjs'
import { run } from '../lib/proc.mjs'

export const name = 'native-export'

const ELECTRON = path.join(REPO_ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
const FPS = 60000 / 1001
const PICK = [10, 150, 299]
const ENCODERS_HERE = ['hevc_videotoolbox', 'prores_videotoolbox', 'libx265', 'prores_ks']
/** The two 10-bit masters and their containers' extensions */
const TEN_BIT_FORMATS = [
  ['hevc-main10', 'mp4'],
  ['prores-422-hq', 'mov'],
]
const CONVERSION =
  'scale=in_range=tv:in_color_matrix=bt709:out_range=pc:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int'

function build() {
  const tsc = spawnSync(process.execPath, [path.join(REPO_ROOT, 'desktop', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(REPO_ROOT, 'desktop', 'tsconfig.json')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (tsc.status !== 0) throw new Error(`building the desktop main process failed:\n${tsc.stdout}\n${tsc.stderr}`)
  const vite = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'node_modules', 'vite-plus', 'bin', 'vp'), 'build', '-c', path.join(REPO_ROOT, 'bench', 'native', 'vite.config.mjs'), '--logLevel', 'error'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  if (vite.status !== 0) throw new Error(`building the harness page failed:\n${vite.stdout}\n${vite.stderr}`)
}

/** One Electron run of the harness; its report. */
function harness({ mode, query, outDir, allow, grant = [] }) {
  const result = spawnSync(
    ELECTRON,
    [
      path.join(REPO_ROOT, 'bench', 'native', 'main.mjs'),
      `--mode=${mode}`,
      `--out=${outDir}`,
      `--allow=${allow.join(',')}`,
      `--grant=${grant.join(',')}`,
      `--query=${new URLSearchParams({ mode, ...query }).toString()}`,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 },
  )
  const line = `${result.stdout}\n${result.stderr}`.split('\n').find((candidate) => candidate.startsWith('REPORT '))
  if (line === undefined) throw new Error(`the harness printed no report:\n${result.stdout.slice(-4000)}\n${result.stderr.slice(-4000)}`)
  const report = JSON.parse(line.slice('REPORT '.length))
  if (report.error !== undefined) throw new Error(`${mode}: ${report.error}`)
  return report
}

/** A half float's value. */
function halfToFloat(bits) {
  const exponent = (bits >> 10) & 0x1f
  const mantissa = bits & 0x3ff
  const sign = bits & 0x8000 ? -1 : 1
  if (exponent === 0) return sign * mantissa * 2 ** -24
  if (exponent === 31) return mantissa === 0 ? sign * Infinity : NaN
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15)
}

/** Levels of 1023 between an `rgba16float` picture (clamped to 0..1) and a `gbrp10le` one, per channel R, G, B. */
function compareToGbrp(rgba16f, gbrp, width, height) {
  const halves = new Uint16Array(rgba16f.buffer, rgba16f.byteOffset, rgba16f.byteLength / 2)
  const planes = new Uint16Array(gbrp.buffer, gbrp.byteOffset, gbrp.byteLength / 2)
  const pixels = width * height
  // gbrp's planes are G, B, R.
  const planeOf = [2, 0, 1]
  const stats = ['R', 'G', 'B'].map((channel) => ({ channel, max: 0, sum: 0, signed: 0, over1: 0, outOfRange: 0, at: null }))
  for (let i = 0; i < pixels; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      let value = halfToFloat(halves[i * 4 + c])
      if (value < 0 || value > 1) stats[c].outOfRange += 1
      value = Math.min(1, Math.max(0, value))
      const reference = planes[planeOf[c] * pixels + i]
      const difference = value * 1023 - reference
      const absolute = Math.abs(difference)
      const s = stats[c]
      if (absolute > s.max) {
        s.max = absolute
        s.at = { x: i % width, y: Math.floor(i / width), ours: Number((value * 1023).toFixed(3)), reference }
      }
      s.sum += absolute
      s.signed += difference
      if (absolute > 1) s.over1 += 1
    }
  }
  return stats.map((s) => ({
    channel: s.channel,
    max: Number(s.max.toFixed(3)),
    mean: Number((s.sum / pixels).toFixed(4)),
    signedMean: Number((s.signed / pixels).toFixed(4)),
    pixelsOver1: s.over1,
    outOfRange: s.outOfRange,
    at: s.at,
  }))
}

/** Code differences between two `p010le` frames: luma plane and chroma plane. */
function compareP010(a, b, width, height) {
  const wa = new Uint16Array(a.buffer, a.byteOffset, a.byteLength / 2)
  const wb = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2)
  const luma = width * height
  const summarise = (from, to) => {
    let max = 0
    let sum = 0
    let over1 = 0
    for (let i = from; i < to; i += 1) {
      const d = Math.abs((wa[i] >> 6) - (wb[i] >> 6))
      max = Math.max(max, d)
      sum += d
      if (d > 1) over1 += 1
    }
    return { max, mean: Number((sum / (to - from)).toFixed(4)), samplesOver1: over1 }
  }
  return { luma: summarise(0, luma), chroma: summarise(luma, wa.length) }
}

/**
 * The packer against its own definition: the codes `p010-out.ts` says each pixel and each 2x2 block of an `rgba16float`
 * picture become, computed here in double precision, against the codes it wrote. Off by one only where a value lies
 * within float rounding of a half code.
 */
function comparePackToDefinition(rgba16f, packed, width, height) {
  const halves = new Uint16Array(rgba16f.buffer, rgba16f.byteOffset, rgba16f.byteLength / 2)
  const words = new Uint16Array(packed.buffer, packed.byteOffset, packed.byteLength / 2)
  const KR = 0.2126
  const KB = 0.0722
  const KG = 1 - KR - KB
  const code = (value) => Math.min(1023, Math.max(0, Math.floor(value + 0.5)))
  const rgb = (x, y) => {
    const i = (y * width + x) * 4
    return [halfToFloat(halves[i]), halfToFloat(halves[i + 1]), halfToFloat(halves[i + 2])]
  }
  const luma = ([r, g, b]) => KR * r + KG * g + KB * b
  let lumaMax = 0
  let lumaOff = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const expected = code(64 + luma(rgb(x, y)) * ((1023 * 219) / 255))
      const d = Math.abs(expected - (words[y * width + x] >> 6))
      lumaMax = Math.max(lumaMax, d)
      if (d > 0) lumaOff += 1
    }
  }
  let chromaMax = 0
  let chromaOff = 0
  const chromaBase = width * height
  for (let by = 0; by < height / 2; by += 1) {
    for (let bx = 0; bx < width / 2; bx += 1) {
      const samples = [rgb(2 * bx, 2 * by), rgb(2 * bx + 1, 2 * by), rgb(2 * bx, 2 * by + 1), rgb(2 * bx + 1, 2 * by + 1)]
      const mean = [0, 1, 2].map((c) => samples.reduce((sum, sample) => sum + sample[c], 0) / 4)
      const y = luma(mean)
      const scale = (1023 * 224) / 255
      const u = code(512 + ((mean[2] - y) / (2 * (1 - KB))) * scale)
      const v = code(512 + ((mean[0] - y) / (2 * (1 - KR))) * scale)
      const at = chromaBase + (by * (width / 2) + bx) * 2
      const d = Math.max(Math.abs(u - (words[at] >> 6)), Math.abs(v - (words[at + 1] >> 6)))
      chromaMax = Math.max(chromaMax, d)
      if (d > 0) chromaOff += 1
    }
  }
  return { lumaMaxCodes: lumaMax, lumaSamplesOff: lumaOff, chromaMaxCodes: chromaMax, chromaBlocksOff: chromaOff }
}

/** FFmpeg's decode of packed `p010le` bytes, through the decoder's own conversion, as `gbrp10le`. */
function ffmpegDecodeP010(file, width, height) {
  return run('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'p010le', '-video_size', `${width}x${height}`, '-i', file, '-vf', CONVERSION, '-pix_fmt', 'gbrp10le', '-f', 'rawvideo', '-'], {
    maxBuffer: 1 << 30,
  })
}

/** Frames `PICK` of the cut at `start` s, as FFmpeg's decoder converts them (`gbrp10le`) and as it decodes them (`p010le`). */
function referenceFrames(clip, start, outDir) {
  const select = `select='${PICK.map((k) => `eq(n\\,${k})`).join('+')}'`
  const common = ['-v', 'error', '-hwaccel', 'videotoolbox', '-protocol_whitelist', 'file', '-ss', String(start), '-i', clip, '-map', '0:v:0', '-an', '-sn', '-dn', '-frames:v', String(PICK.length), '-fps_mode', 'passthrough']
  const gbrp = path.join(outDir, 'reference.gbrp10le')
  const p010 = path.join(outDir, 'reference.p010le')
  if (!fs.existsSync(gbrp)) run('ffmpeg', [...common, '-vf', `${select},${CONVERSION}`, '-pix_fmt', 'gbrp10le', '-f', 'rawvideo', '-y', gbrp])
  if (!fs.existsSync(p010)) run('ffmpeg', [...common, '-vf', select, '-pix_fmt', 'p010le', '-f', 'rawvideo', '-y', p010])
  return { gbrp, p010 }
}

function probe(file) {
  return JSON.parse(
    run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames,color_range,color_space,color_transfer,color_primaries', '-of', 'json', file], { encoding: 'utf8' }).toString(),
  ).streams[0]
}

async function measureParts(config, parts) {
  const record = { parts: {} }
  const outDir = path.join(REPO_ROOT, 'tmp', 'native-export')
  fs.mkdirSync(outDir, { recursive: true })
  const clip = config.clip
  const allow = [path.dirname(clip), config.cache]
  const start = config.startSeconds
  // The frame `-ss start` lands on: the first at or after `start` (clip 0020 starts at 0).
  const startIndex = String(Math.ceil(start * FPS - 1e-9))
  build()

  if (parts.includes('fidelity')) {
    const reference = referenceFrames(clip, start, outDir)
    const report = harness({
      mode: 'fidelity',
      outDir,
      allow,
      query: { file: clip, fps: String(FPS), startIndex, frames: '300', pick: PICK.join(',') },
    })
    const width = 3840
    const height = 2880
    const gbrp = fs.readFileSync(reference.gbrp)
    const frameBytes = width * height * 6
    const frames = PICK.map((k, at) => ({
      frame: k,
      channels: compareToGbrp(fs.readFileSync(path.join(outDir, `fidelity-${k}.rgba16f`)), gbrp.subarray(at * frameBytes, (at + 1) * frameBytes), width, height),
    }))
    record.parts.fidelity = { report, frames }
    console.log(JSON.stringify(record.parts.fidelity, null, 2))
  }

  if (parts.includes('pack')) {
    const reference = referenceFrames(clip, start, outDir)
    const report = harness({ mode: 'pack', outDir, allow, query: { file: clip, fps: String(FPS), startIndex, frame: '10' } })
    const { width, height } = report
    const results = {}
    for (const picture of ['clip', 'synthetic']) {
      const packed = path.join(outDir, `pack-${picture}.p010le`)
      const accumulator = fs.readFileSync(path.join(outDir, `pack-${picture}.rgba16f`))
      results[picture] = {
        ffmpegDecodeAgainstAccumulator: compareToGbrp(accumulator, ffmpegDecodeP010(packed, width, height), width, height),
        codesAgainstDefinition: comparePackToDefinition(accumulator, fs.readFileSync(packed), width, height),
      }
    }
    const p010Frame = width * height * 3
    results.clipCodesAgainstSource = compareP010(fs.readFileSync(path.join(outDir, 'pack-clip.p010le')), fs.readFileSync(reference.p010).subarray(0, p010Frame), width, height)
    record.parts.pack = { report, results }
    console.log(JSON.stringify(record.parts.pack, null, 2))
  }

  if (parts.includes('ramp')) {
    const ramp = await ensureRamp(config)
    const rows = [RAMP_SCORED_FROM_ROW, 1440, 2879]
    const texture = harness({ mode: 'ramp', outDir, allow, query: { file: ramp.file, fps: '30', rows: rows.join(',') } })
    const out = path.join(outDir, 'ramp-hevc.mp4')
    fs.rmSync(out, { force: true })
    const exported = harness({
      mode: 'export',
      outDir,
      allow,
      grant: [out],
      query: { file: ramp.file, fps: '30', startIndex: '0', frames: '30', format: 'hevc-main10', out, width: '3840', height: '2880' },
    })
    const perRow = distinctLevelsPerRow(decodeLuma10(out, 3840, 2880, 0), 3840, 2880)
    record.parts.ramp = {
      texture,
      exported: { report: exported, probe: probe(out), scoredRows: { fromRow: RAMP_SCORED_FROM_ROW, ...summariseCounts(perRow.slice(RAMP_SCORED_FROM_ROW)) } },
    }
    console.log(JSON.stringify(record.parts.ramp, null, 2))
  }

  if (parts.includes('legs')) {
    const frames = String(Math.round(config.segmentSeconds * FPS))
    const discard = harness({
      mode: 'export',
      outDir,
      allow,
      query: { file: clip, fps: String(FPS), startIndex, frames, format: 'hevc-main10', out: path.join(outDir, 'unused.mp4'), sink: 'discard' },
    })
    const upload = {}
    for (const [format, extension] of TEN_BIT_FORMATS) {
      const out = path.join(outDir, `upload-${format}.${extension}`)
      fs.rmSync(out, { force: true })
      upload[format] = harness({ mode: 'upload', outDir, allow, grant: [out], query: { frames, format, out, fps: String(FPS) } })
      fs.rmSync(out, { force: true })
    }
    record.parts.legs = {
      exportWithoutUploadOrEncoder: discard,
      uploadIntoEncoder: upload,
      ffmpegAlone: await ffmpegLegs(clip, start, Number(frames), outDir),
    }
    console.log(JSON.stringify(record.parts.legs, null, 2))
  }

  if (parts.includes('export')) {
    record.parts.export = {}
    for (const [format, extension] of TEN_BIT_FORMATS) {
      const out = path.join(outDir, `export-${format}.${extension}`)
      fs.rmSync(out, { force: true })
      const report = harness({
        mode: 'export',
        outDir,
        allow,
        grant: [out],
        query: { file: clip, fps: String(FPS), startIndex, frames: String(Math.round(config.segmentSeconds * FPS)), format, out },
      })
      record.parts.export[format] = { report, probe: probe(out), bytes: fs.statSync(out).size }
      // A 10 s 4K ProRes HQ file is gigabytes: the numbers are kept, the file is not.
      if (format === 'prores-422-hq') fs.rmSync(out, { force: true })
      console.log(JSON.stringify(record.parts.export[format], null, 2))
    }
  }
  return record
}

/** FFmpeg alone: decode to a pipe, then the same into the shell's encode command line; frames per second each. */
async function ffmpegLegs(clip, start, frames, outDir) {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const { encodeArguments, chooseEncoder } = require(path.join(REPO_ROOT, 'desktop', 'out', 'main', 'media', 'formats.js'))
  const decodeArgs = ['-v', 'error', '-hwaccel', 'videotoolbox', '-ss', String(start), '-i', clip, '-frames:v', String(frames), '-an', '-pix_fmt', 'p010le', '-f', 'rawvideo', 'pipe:1']
  const timed = (run) => {
    const started = Date.now()
    run()
    return Number((frames / ((Date.now() - started) / 1000)).toFixed(2))
  }
  const legs = { decodeToPipe: timed(() => run('sh', ['-c', `ffmpeg ${decodeArgs.map((a) => `'${a}'`).join(' ')} > /dev/null`])) }
  for (const [format, extension] of TEN_BIT_FORMATS) {
    const file = path.join(outDir, `leg-${format}.${extension}`)
    const encodeArgs = encodeArguments({
      format,
      encoder: chooseEncoder(format, ENCODERS_HERE, 'darwin'),
      readback: 'p010le',
      width: 3840,
      height: 2880,
      fps: { num: 60000, den: 1001 },
      bitrate: 120_000_000,
      tags: { matrix: 'bt709', range: 'tv', transfer: 'bt709', primaries: 'bt709' },
      path: file,
    })
    const quote = (list) => list.map((a) => `'${a}'`).join(' ')
    legs[`decodeIntoEncode:${format}`] = timed(() => run('sh', ['-c', `ffmpeg ${quote(decodeArgs)} | ffmpeg ${quote(encodeArgs)} > /dev/null`]))
    fs.rmSync(file, { force: true })
  }
  return legs
}

/** The bench's entry: every part. */
export async function measure(ctx) {
  return measureParts(ctx.config, ['fidelity', 'pack', 'ramp', 'legs', 'export'])
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const requested = process.argv[2] ?? 'all'
  const parts = requested === 'all' ? ['fidelity', 'pack', 'ramp', 'legs', 'export'] : requested.split(',')
  const config = loadConfig(process.env, {})
  const record = await measureParts(config, parts)
  const file = path.join(REPO_ROOT, 'tmp', 'native-export', `record-${parts.join('-')}.json`)
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  console.log(`wrote ${file}`)
}
