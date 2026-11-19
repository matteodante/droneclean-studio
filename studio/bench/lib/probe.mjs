// What FFprobe says about a file the editor wrote: format facts and the spacing of the frame timestamps.
import { ffprobeJson } from './proc.mjs'

/** Bit depth of a pixel format name ("yuv420p" 8, "yuv420p10le" 10, "p010le" 10, "yuv420p12le" 12 ...). */
export function bitDepthOfPixelFormat(pixFmt) {
  if (!pixFmt) return null
  const explicit = /(?:p|gray|rgb|gbrp|yuv\d{3}p)(9|10|12|14|16)(?:le|be)?$/.exec(pixFmt)
  if (explicit) return Number(explicit[1])
  if (/^p0?10/.test(pixFmt)) return 10
  if (/^p0?12/.test(pixFmt)) return 12
  return 8
}

/**
 * Spacing of the presentation timestamps (in container ticks). Evenly spaced when every gap is the same, give or
 * take one tick of rounding (a time base that does not divide the frame duration).
 */
export function describeSpacing(ptsTicks, timeBase) {
  const sorted = [...ptsTicks].sort((a, b) => a - b)
  const gaps = new Map()
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    gaps.set(gap, (gaps.get(gap) ?? 0) + 1)
  }
  const list = [...gaps.entries()].sort((a, b) => b[1] - a[1])
  const values = list.map(([gap]) => gap)
  const spread = values.length === 0 ? 0 : Math.max(...values) - Math.min(...values)
  return {
    timeBase,
    frames: sorted.length,
    evenlySpaced: sorted.length > 1 && spread <= 1,
    distinctGapsInTicks: list.slice(0, 6).map(([gap, count]) => ({ gap, count })),
    distinctGapCount: list.length,
    duplicateTimestamps: sorted.length - new Set(sorted).size,
  }
}

function parseFraction(text) {
  const [n, d] = String(text).split('/').map(Number)
  return d ? n / d : n
}

/** Everything the benchmark records about one video file. */
export function probeVideoFile(file) {
  const info = ffprobeJson(file, ['-show_format', '-show_streams', '-select_streams', 'v:0'])
  const stream = info.streams[0]
  const packets = ffprobeJson(file, [
    '-select_streams',
    'v:0',
    '-show_entries',
    'packet=pts,dts',
    '-of',
    'json',
  ]).packets
  const [num, den] = stream.time_base.split('/').map(Number)
  const ptsTicks = packets.map((p) => Number(p.pts))
  const duration = Number(info.format.duration)
  const size = Number(info.format.size)
  return {
    container: info.format.format_name,
    codec: stream.codec_name,
    profile: stream.profile,
    pixelFormat: stream.pix_fmt,
    bitDepth: Number(stream.bits_per_raw_sample) || bitDepthOfPixelFormat(stream.pix_fmt),
    width: stream.width,
    height: stream.height,
    colour: {
      range: stream.color_range ?? null,
      matrix: stream.color_space ?? null,
      transfer: stream.color_transfer ?? null,
      primaries: stream.color_primaries ?? null,
    },
    sizeBytes: size,
    durationSeconds: duration,
    // Real bitrate: the bytes of the file over its duration; the stream's own figure when the container has one.
    bitrateBitsPerSecond: Math.round((size * 8) / duration),
    streamBitrateBitsPerSecond: stream.bit_rate ? Number(stream.bit_rate) : null,
    frameCount: packets.length,
    declaredFrameRate: stream.r_frame_rate,
    declaredAverageFrameRate: stream.avg_frame_rate,
    declaredFrameRateValue: parseFraction(stream.r_frame_rate),
    timestamps: describeSpacing(ptsTicks, `${num}/${den}`),
  }
}
