// Counting the distinct grey levels per row of a decoded luma plane (used to verify the ramp and to score exports).
import { run } from './proc.mjs'

/** Distinct values in every row of a `width` x `height` plane of 16-bit samples. Returns an array of counts. */
export function distinctLevelsPerRow(samples, width, height) {
  const counts = new Array(height)
  const seen = new Uint8Array(65536)
  for (let y = 0; y < height; y++) {
    seen.fill(0)
    let distinct = 0
    const base = y * width
    for (let x = 0; x < width; x++) {
      const v = samples[base + x]
      if (seen[v] === 0) {
        seen[v] = 1
        distinct++
      }
    }
    counts[y] = distinct
  }
  return counts
}

/**
 * Decode one frame of a video file and return its luma plane as 10-bit code values. The file is read as
 * yuv420p10le, which changes neither range nor values (an 8-bit file is scaled by 4: exact), and the first plane is
 * taken, so no colour conversion touches the levels being counted.
 */
export function decodeLuma10(file, width, height, frameIndex = 0) {
  const raw = run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-vf',
    `select=eq(n\\,${frameIndex})`,
    '-frames:v',
    '1',
    '-fps_mode',
    'passthrough',
    '-pix_fmt',
    'yuv420p10le',
    '-f',
    'rawvideo',
    '-',
  ])
  const lumaBytes = width * height * 2
  if (raw.length < lumaBytes)
    throw new Error(`decoded ${raw.length} bytes, expected at least ${lumaBytes}`)
  return new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + lumaBytes))
}

/** Summary of per-row counts. */
export function summariseCounts(counts) {
  const sorted = [...counts].sort((a, b) => a - b)
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    rows: counts.length,
  }
}
