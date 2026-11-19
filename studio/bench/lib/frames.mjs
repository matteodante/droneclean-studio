// Decoding frames with FFmpeg for the analyses: small grey pictures for matching, and one full-size frame.
import { run, streamFrames } from './proc.mjs'

const SMALL_WIDTH = 192
const SMALL_HEIGHT = 144

/** Every frame of a video as a small grey picture (one array per frame), without FFmpeg adding or dropping any. */
export async function decodeSmallGrey(file) {
  const frames = []
  await streamFrames(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-map',
      '0:v:0',
      '-fps_mode',
      'passthrough',
      '-vf',
      `scale=${SMALL_WIDTH}:${SMALL_HEIGHT}:flags=area,format=gray`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ],
    SMALL_WIDTH * SMALL_HEIGHT,
    (buffer) => frames.push(new Uint8Array(buffer)),
  )
  return frames
}

/**
 * One frame, converted to RGB with a stated matrix and range, as raw bytes.
 * `format` is 'rgb24' (8-bit) or 'rgb48le' (16-bit). `lut` is a path for FFmpeg's lut3d filter (applied in 16-bit).
 * The conversion uses accurate rounding and full chroma interpolation, so the result is the best FFmpeg can give.
 */
export function decodeRgbFrame(file, frameIndex, { matrix, range, format, lut }) {
  const filters = [
    `select=eq(n\\,${frameIndex})`,
    `scale=in_range=${range}:in_color_matrix=${matrix}:out_range=full:out_color_matrix=${matrix}:flags=accurate_rnd+full_chroma_int+bicubic`,
    `format=${format}`,
  ]
  if (lut) filters.push(`lut3d=file=${lut}:interp=tetrahedral`)
  return run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-fps_mode',
    'passthrough',
    '-vf',
    filters.join(','),
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    format,
    '-',
  ])
}

/** A PNG as 8-bit RGB, interleaved. */
export function decodePngRgb(file) {
  return run('ffmpeg', ['-v', 'error', '-i', file, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
}
