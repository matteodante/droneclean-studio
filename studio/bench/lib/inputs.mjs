// The fixed inputs: the 10 s cut of the clip, the 10-bit grey ramp and the LUT. Cut once into the cache folder
// (which git ignores) and reused; each one is described in the result by its hash and its frame count.
import fs from 'node:fs'
import path from 'node:path'
import { distinctLevelsPerRow, decodeLuma10, summariseCounts } from './levels.mjs'
import { writeBenchLut } from './lut.mjs'
import { ffprobeJson, run, sha256File } from './proc.mjs'

const SOURCE_FPS_NUM = 60000
const SOURCE_FPS_DEN = 1001

/** Number of source frames in `seconds` of the clip (59.94 fps). */
export function framesForSeconds(seconds) {
  return Math.round((seconds * SOURCE_FPS_NUM) / SOURCE_FPS_DEN)
}

function hashOfSource(clip, cache) {
  // Hashing 3.76 GB takes a while: remember it for as long as the file's size and modification time are the same.
  const stat = fs.statSync(clip)
  const sidecar = path.join(cache, 'source-hash.json')
  const key = `${clip}|${stat.size}|${stat.mtimeMs}`
  if (fs.existsSync(sidecar)) {
    const saved = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
    if (saved.key === key) return Promise.resolve(saved.sha256)
  }
  return sha256File(clip).then((sha256) => {
    fs.writeFileSync(sidecar, JSON.stringify({ key, sha256 }))
    return sha256
  })
}

/** Time of the first keyframe at or after `start` (a copy cut must begin on one to be decodable from frame 0). */
function firstKeyframeAtOrAfter(clip, start) {
  const out = run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-read_intervals',
    `${start - 1}%${start + 10}`,
    '-show_entries',
    'packet=pts_time,flags',
    '-of',
    'csv=p=0',
    clip,
  ]).toString()
  const times = out
    .split('\n')
    .map((line) => line.split(','))
    .filter(([, flags]) => flags?.startsWith('K'))
    .map(([t]) => Number(t))
    .filter((t) => t >= start - 1e-6)
    .sort((a, b) => a - b)
  if (times.length === 0) throw new Error(`no keyframe found after ${start} s in ${clip}`)
  return times[0]
}

function streamMd5(file) {
  const out = run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-c',
    'copy',
    '-f',
    'md5',
    '-',
  ]).toString()
  return out.trim().replace(/^MD5=/, '')
}

/**
 * The cut of the source clip: video stream only, copied (no re-encode), starting on the first keyframe at or after
 * `startSeconds`, exactly as many frames as `seconds` of 59.94 fps. Reproducible: same frames, same packet hash.
 */
export async function ensureSegment(config, seconds) {
  const frames = framesForSeconds(seconds)
  fs.mkdirSync(config.cache, { recursive: true })
  const sourceSha256 = await hashOfSource(config.clip, config.cache)
  const startPts = firstKeyframeAtOrAfter(config.clip, config.startSeconds)
  const file = path.join(config.cache, `segment_${config.startSeconds}s_${frames}f.mp4`)
  const sidecar = `${file}.json`
  if (
    !fs.existsSync(file) ||
    !fs.existsSync(sidecar) ||
    JSON.parse(fs.readFileSync(sidecar, 'utf8')).sourceSha256 !== sourceSha256
  ) {
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-ss',
      String(startPts),
      '-i',
      config.clip,
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-frames:v',
      String(frames),
      '-an',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact',
      '-tag:v',
      'hvc1',
      '-movflags',
      '+faststart',
      file,
    ])
    const probe = ffprobeJson(file, [
      '-count_packets',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=nb_read_packets',
    ])
    const packets = Number(probe.streams[0].nb_read_packets)
    if (packets !== frames) throw new Error(`cut has ${packets} frames, expected ${frames}`)
    fs.writeFileSync(
      sidecar,
      JSON.stringify({
        sourceSha256,
        packetStreamMd5: streamMd5(file),
        sha256: await sha256File(file),
      }),
    )
  }
  const saved = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
  return {
    file,
    frames,
    seconds,
    startSeconds: config.startSeconds,
    sourceStartPts: startPts,
    sourceSha256,
    sha256: saved.sha256,
    packetStreamMd5: saved.packetStreamMd5,
    bytes: fs.statSync(file).size,
  }
}

const RAMP_WIDTH = 3840
const RAMP_HEIGHT = 2880
/** Rows above this one are left out of the grey-ramp score: the ramp file itself is coarser there. */
export const RAMP_SCORED_FROM_ROW = 64
// 877 grey levels in every row (luma 64 + mod(floor(X/4), 877), 10-bit studio range).
const RAMP_ARGS = [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  `color=c=gray:s=${RAMP_WIDTH}x${RAMP_HEIGHT}:r=30:d=1,format=yuv420p10le,geq=lum='64+mod(floor(X/4)\\,877)':cb=512:cr=512`,
  '-c:v',
  'hevc_videotoolbox',
  '-profile:v',
  'main10',
  '-pix_fmt',
  'p010le',
  '-b:v',
  '120M',
  '-tag:v',
  'hvc1',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
  '-color_range',
  'tv',
]

/** The 10-bit grey ramp. Verified every time by decoding: each sampled row must hold 877 different levels. */
export async function ensureRamp(config) {
  fs.mkdirSync(config.cache, { recursive: true })
  const file = path.join(config.cache, 'ramp10.mp4')
  if (!fs.existsSync(file)) run('ffmpeg', [...RAMP_ARGS, file])
  // Decode the first frame with FFmpeg at 10 bits and count the levels in every row. The hardware encoder codes the
  // first rows (the top 32 here) more coarsely, and adds a few overshoot values of its own (61..943), so a row
  // holds 877 to 883 levels; the rows from RAMP_SCORED_FROM_ROW down must all hold at least 877.
  const perRow = distinctLevelsPerRow(
    decodeLuma10(file, RAMP_WIDTH, RAMP_HEIGHT),
    RAMP_WIDTH,
    RAMP_HEIGHT,
  )
  const scored = summariseCounts(perRow.slice(RAMP_SCORED_FROM_ROW))
  if (scored.min < 877) {
    throw new Error(
      `the grey ramp is wrong: rows ${RAMP_SCORED_FROM_ROW}.. hold ${JSON.stringify(scored)} levels, expected 877 or more in every row`,
    )
  }
  const levels = {
    allRows: summariseCounts(perRow),
    scoredRows: { fromRow: RAMP_SCORED_FROM_ROW, ...scored },
  }
  const probe = ffprobeJson(file, [
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=profile,pix_fmt,width,height,nb_frames',
  ])
  return {
    file,
    sha256: await sha256File(file),
    bytes: fs.statSync(file).size,
    distinctLevelsPerRow: levels,
    width: RAMP_WIDTH,
    height: RAMP_HEIGHT,
    stream: probe.streams[0],
  }
}

/** The LUT file: name, size, hash. (The page gets its data from `parseCube`.) */
export async function describeLut(config) {
  if (config.lutGenerated) writeBenchLut(config.lut)
  const text = fs.readFileSync(config.lut, 'utf8')
  const title = /^TITLE\s+"?(.*?)"?\s*$/m.exec(text)?.[1] ?? ''
  const size = Number(/^LUT_3D_SIZE\s+(\d+)/m.exec(text)?.[1] ?? 0)
  return {
    file: config.lut,
    title,
    size,
    sha256: await sha256File(config.lut),
    bytes: Buffer.byteLength(text),
  }
}

/**
 * The effect parameters the editor's LUT panel would store for a .cube file: rgba8 data, base64
 */
export function parseCube(text) {
  let size = 0
  let title = ''
  let min = [0, 0, 0]
  let max = [1, 1, 1]
  const values = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('TITLE')) title = line.replace(/^TITLE\s+/, '').replace(/"/g, '')
    else if (line.startsWith('LUT_3D_SIZE')) size = Number(line.split(/\s+/)[1])
    else if (line.startsWith('DOMAIN_MIN')) min = line.split(/\s+/).slice(1).map(Number)
    else if (line.startsWith('DOMAIN_MAX')) max = line.split(/\s+/).slice(1).map(Number)
    else if (/^[-+.\d]/.test(line)) values.push(line.split(/\s+/).slice(0, 3).map(Number))
  }
  if (values.length !== size ** 3)
    throw new Error(`expected ${size ** 3} LUT entries, got ${values.length}`)
  const data = Buffer.alloc(size ** 3 * 4)
  values.forEach((rgb, i) => {
    for (let c = 0; c < 3; c++) {
      const t = (rgb[c] - min[c]) / (max[c] - min[c])
      data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, t)) * 255)
    }
    data[i * 4 + 3] = 255
  })
  return { lutName: title, lutSize: String(size), lutData: data.toString('base64') }
}
