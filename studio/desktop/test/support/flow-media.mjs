// Test media and measurements for the e2e flows (looks, subclips): clips made by FFmpeg, the `.cube` file the looks
// flow adds, and the colour and duration read back from an exported file. Plain Node, no Electron: the pure parts are
// unit-tested in `test/e2e-flows.test.mjs`. Nothing here reads the owner's footage or LUTs.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { FFMPEG, FFPROBE, h264Args } from './ffmpeg-path.mjs'

/** The flat colour of the looks clip: strongly asymmetric in red and blue, so a channel swap cannot be missed. */
export const LOOK_CLIP_RGB = [200, 80, 40]

/**
 * A `.cube` that swaps the red and blue channels. Entries run red fastest; the output at grid point (r, g, b) is
 * (b, g, r), which a trilinear lookup reproduces exactly at every size.
 */
export function swapCubeText(size = 17) {
  const lines = ['TITLE "E2E channel swap"', `LUT_3D_SIZE ${size}`]
  const step = (index) => (index / (size - 1)).toFixed(6)
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) lines.push(`${step(b)} ${step(g)} ${step(r)}`)
    }
  }
  return lines.join('\n') + '\n'
}

/** `rgb` with its red and blue swapped: the colour a channel-swap look must give. */
export function swapRedBlue([r, g, b]) {
  return [b, g, r]
}

/** The largest per-channel difference between two colours. */
export function maxChannelDifference(a, b) {
  return Math.max(...a.map((value, index) => Math.abs(value - b[index])))
}

/** Whether `actual` is within `tolerance` of `expected` in every channel. */
export function colourWithin(actual, expected, tolerance) {
  return maxChannelDifference(actual, expected) <= tolerance
}

function ffmpeg(args) {
  execFileSync(FFMPEG, ['-nostdin', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
}

/** A 3 s flat-colour H.264 clip (BT.709, limited range) at 30 fps. */
export function makeColourClip(file, [r, g, b] = LOOK_CLIP_RGB) {
  const hex = [r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=0x${hex}:s=640x360:r=30:d=3`,
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    ...h264Args(),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    file,
  ])
  return file
}

/** The subclips clip: `testsrc2` animates and counts, 25 fps, `seconds` long, no audio. */
export function makeCountingClip(file, seconds = 10) {
  ffmpeg([
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=25:duration=${seconds}`,
    '-pix_fmt', 'yuv420p', ...h264Args({ gop: 10 }),
    file,
  ])
  return file
}

/** Writes the channel-swap look to `file`. */
export function writeSwapCube(file, size = 17) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, swapCubeText(size))
  return file
}

/** The mean colour of the central 32x32 of the frame at `seconds` in `file`, as [r, g, b] 0..255. */
export function frameColour(file, seconds) {
  const raw = execFileSync(
    FFMPEG,
    [
      '-nostdin', '-loglevel', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1',
      '-vf', 'crop=32:32:iw/2-16:ih/2-16,scale=1:1:flags=area', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ],
    { maxBuffer: 1 << 20 },
  )
  if (raw.length < 3) throw new Error(`no frame at ${seconds} s in ${file}`)
  return [raw[0], raw[1], raw[2]]
}

/** The container duration (seconds) and the video stream's frame count and rate of `file`. */
export function probeVideo(file) {
  const out = JSON.parse(
    execFileSync(FFPROBE, [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames,r_frame_rate,width,height,codec_name:format=duration',
      '-of', 'json', file,
    ]).toString(),
  )
  const stream = out.streams?.[0] ?? {}
  const [num, den] = String(stream.r_frame_rate ?? '0/1').split('/').map(Number)
  return {
    duration: Number(out.format?.duration ?? 0),
    frames: Number(stream.nb_read_frames ?? 0),
    fps: den ? num / den : 0,
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    codec: stream.codec_name ?? '',
  }
}

/** The width and height of `file`'s first video stream, read from its header (no decoding, so fast on a long clip). */
export function probeSize(file) {
  const out = JSON.parse(
    execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]).toString(),
  )
  const stream = out.streams?.[0] ?? {}
  return { width: stream.width ?? 0, height: stream.height ?? 0 }
}

/** The average PSNR (dB) in FFmpeg's `psnr` filter summary, or null when there is none. `inf` (identical) is 100. */
export function parsePsnrAverage(log) {
  const match = /PSNR [^\n]*average:(inf|[\d.]+)/.exec(log)
  if (!match) return null
  return match[1] === 'inf' ? 100 : Number(match[1])
}

/**
 * How alike the frame at `seconds` of `exported` is to frame number `frameIndex` of `source`, as PSNR in dB (both are
 * scaled to 160x90 first: the project canvas is larger than the test clip). A frame of the same picture scores far
 * higher than any other frame of a counting pattern.
 */
export function psnrAgainstSourceFrame(exported, seconds, source, frameIndex) {
  const result = spawnSync(
    FFMPEG,
    [
      '-nostdin', '-hide_banner', '-ss', String(seconds), '-i', exported, '-i', source,
      '-filter_complex',
      `[0:v]scale=160:90,format=yuv420p[a];[1:v]select=eq(n\\,${frameIndex}),setpts=PTS-STARTPTS,scale=160:90,format=yuv420p[b];[a][b]psnr`,
      '-frames:v', '1', '-f', 'null', '-',
    ],
    { encoding: 'utf8', maxBuffer: 1 << 20 },
  )
  const psnr = parsePsnrAverage(result.stderr ?? '')
  if (psnr === null) throw new Error(`no PSNR for ${exported} against frame ${frameIndex}: ${(result.stderr ?? '').slice(-400)}`)
  return psnr
}
