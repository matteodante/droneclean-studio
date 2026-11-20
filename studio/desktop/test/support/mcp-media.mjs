// Test media and measurements for `test/e2e-mcp.mjs`: an overcast "sky over ground" clip for the Sky effect, a kick
// track for beat markers, the mean colour of a region of a PNG, and the MP4 box layout Meta's upload rules ask for.
// Everything is generated here by FFmpeg; nothing reads the owner's footage. The pure parts are unit-tested in
// `test/e2e-mcp-media.test.mjs`.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { FFMPEG, FFPROBE, h264Args } from './ffmpeg-path.mjs'
import { parsePsnrAverage } from './flow-media.mjs'

/** The flat colours of the sky clip: a white overcast sky over dark green ground, each one half of the frame. */
export const SKY_RGB = [236, 236, 236]
export const GROUND_RGB = [40, 72, 40]

/** The kick track's tempo: one kick every half second, 120 bpm. */
const KICK_INTERVAL_S = 0.5

const hex = (rgb) => rgb.map((value) => value.toString(16).padStart(2, '0')).join('')

function ffmpeg(args) {
  execFileSync(FFMPEG, ['-nostdin', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
}

/** A 3 s 1280x720 30 fps H.264 clip, BT.709 limited range: the top half `SKY_RGB`, the bottom half `GROUND_RGB`. */
export function makeSkyClip(file) {
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=0x${hex(SKY_RGB)}:s=1280x360:r=30:d=3`,
    '-f', 'lavfi', '-i', `color=c=0x${hex(GROUND_RGB)}:s=1280x360:r=30:d=3`,
    '-filter_complex', '[0:v][1:v]vstack=inputs=2,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]',
    '-map', '[v]', ...h264Args(),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    file,
  ])
  return file
}

/**
 * A 10 s 48 kHz stereo WAV: a kick every `KICK_INTERVAL_S`, the beat detector's own test kick (a 60 Hz sine decaying
 * with a 70 ms time constant, `src/studio/beats/detect.test.ts`), silence between. A short high click is not a beat to
 * it: the detector ignores hi-hats on purpose.
 */
export function makeKickTrack(file, seconds = 10) {
  const t = `mod(t\\,${KICK_INTERVAL_S})`
  ffmpeg([
    '-f', 'lavfi',
    '-i', `aevalsrc=0.8*sin(2*PI*60*${t})*exp(-${t}/0.07):s=48000:d=${seconds}`,
    '-ac', '2', '-c:a', 'pcm_s16le',
    file,
  ])
  return file
}

/** The mean colour of the region { x, y, w, h } (fractions of the frame) of an image file, as [r, g, b] 0..255. */
export function regionColour(file, { x, y, w, h }) {
  const raw = execFileSync(
    FFMPEG,
    [
      '-nostdin', '-loglevel', 'error', '-i', file, '-frames:v', '1',
      '-vf', `crop=iw*${w}:ih*${h}:iw*${x}:ih*${y},scale=1:1:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ],
    { maxBuffer: 1 << 20 },
  )
  if (raw.length < 3) throw new Error(`no picture in ${file}`)
  return [raw[0], raw[1], raw[2]]
}

/** How alike two images of the same size are, as PSNR in dB (100 for identical), by FFmpeg's `psnr` filter. */
export function psnrBetween(a, b) {
  const run = spawnSync(FFMPEG, ['-nostdin', '-i', a, '-i', b, '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'], {
    encoding: 'utf8',
  })
  return parsePsnrAverage(run.stderr ?? '')
}

/**
 * The boxes of an MP4 buffer at one level, in file order: `{ type, start, size }`. A 64-bit size (`1`) and a box that
 * runs to the end of the file (`0`) are read the way ISO/IEC 14496-12 §4.2 defines them.
 */
export function mp4Boxes(buffer, start = 0, end = buffer.length) {
  const boxes = []
  let offset = start
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    if (size === 1) size = Number(buffer.readBigUInt64BE(offset + 8))
    else if (size === 0) size = end - offset
    if (size < 8 || offset + size > end) break
    boxes.push({ type, start: offset, size })
    offset += size
  }
  return boxes
}

/**
 * What Meta's rules ask of an upload's layout (11.19): `moov` before `mdat` (fast start), and no `edts`
 * in any track (an edit list makes Instagram drop or shift the first frames).
 */
export function mp4Layout(buffer) {
  const top = mp4Boxes(buffer)
  const order = top.map((box) => box.type)
  const moov = top.find((box) => box.type === 'moov')
  const traks = moov ? mp4Boxes(buffer, moov.start + 8, moov.start + moov.size).filter((box) => box.type === 'trak') : []
  const edts = traks.some((trak) => mp4Boxes(buffer, trak.start + 8, trak.start + trak.size).some((box) => box.type === 'edts'))
  const moovIndex = order.indexOf('moov')
  const mdatIndex = order.indexOf('mdat')
  return { order, tracks: traks.length, moovFirst: moovIndex !== -1 && mdatIndex !== -1 && moovIndex < mdatIndex, edts }
}

/** The audio stream of `file`: codec, bit rate (bits per second, 0 when unknown), sample rate and channels. */
export function probeAudio(file) {
  const out = JSON.parse(
    execFileSync(FFPROBE, [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,bit_rate,sample_rate,channels', '-of', 'json', file,
    ]).toString(),
  )
  const stream = out.streams?.[0] ?? {}
  return {
    codec: stream.codec_name ?? '',
    bitRate: Number(stream.bit_rate ?? 0),
    sampleRate: Number(stream.sample_rate ?? 0),
    channels: Number(stream.channels ?? 0),
  }
}

/** The median of the gaps between consecutive values (frames), or null with fewer than two. */
export function medianGap(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const gaps = sorted.slice(1).map((value, index) => value - sorted[index])
  if (gaps.length === 0) return null
  gaps.sort((a, b) => a - b)
  const middle = Math.floor(gaps.length / 2)
  return gaps.length % 2 === 1 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2
}

/**
 * Whether beat markers found on the kick track follow its tempo: the median gap is the kick interval, or half or
 * twice it (a beat tracker may count in either), within 10 %.
 */
export function beatsFollowKicks(frames, fps, interval = KICK_INTERVAL_S) {
  const gap = medianGap(frames)
  if (gap === null) return false
  const seconds = gap / fps
  return [interval / 2, interval, interval * 2].some((expected) => Math.abs(seconds - expected) <= expected * 0.1)
}

/** Whether `rgb` reads as blue sky: blue clearly above red, and not grey. */
export function looksBlue([r, , b]) {
  return b - r >= 25
}

/** Whether `path` exists as a non-empty file. */
export function nonEmptyFile(file) {
  try {
    return fs.statSync(file).size > 0
  } catch {
    return false
  }
}
