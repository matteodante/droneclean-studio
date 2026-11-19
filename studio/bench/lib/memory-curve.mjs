// What a long export's memory curve means: the pure judgements of the `long-export` measurement (no browser, no
// clock), so they can be tested with fixtures. A "series" is `[{ t, browserBytes, gpuBytes }]`, `t` in ms, the
// browser's resident memory (RSS summed over its processes) and the GPU driver's memory in use (null where the
// platform shows none), as the machine sampler (`lib/sampler.mjs`) records them every 500 ms.

const MIB = 2 ** 20
const GIB = 2 ** 30
const MINUTE_MS = 60_000

/** The plan's limit for a long export: memory stays under 6 GB (task 3.5). */
const DEFAULT_LIMIT_BYTES = 6 * GIB

/**
 * Flat means: over the second half of the export (the first half is the warm-up in which pools and rings fill),
 * the straight line through the samples rises by at most this many MiB a minute. 25 MiB/min is 500 MiB over the
 * 20 minutes of the plan's export, which fits in the headroom a flat run leaves under 6 GB (a run that peaks at
 * 3 GB has 3 GB of room: a leak this slow cannot reach the limit), and it is far above the noise of RSS (a few
 * MiB over a minute, measured), so a stable run is not called growing. The peak must also stay under the limit.
 */
const DEFAULT_SLOPE_LIMIT_MIB_PER_MIN = 25

/** The second half must hold at least this many samples and this many seconds for the slope to mean anything. */
const MIN_HALF_SAMPLES = 20
const MIN_HALF_SECONDS = 30

const round = (n, digits = 1) => Number(n.toFixed(digits))

/** Ordinary least squares of y on x: `{ slope, intercept, r2 }`; slope 0 when x does not vary. */
export function linearFit(points) {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0, r2: 0 }
  const meanX = points.reduce((s, p) => s + p.x, 0) / n
  const meanY = points.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of points) {
    sxx += (p.x - meanX) ** 2
    sxy += (p.x - meanX) * (p.y - meanY)
    syy += (p.y - meanY) ** 2
  }
  if (sxx === 0) return { slope: 0, intercept: meanY, r2: 0 }
  const slope = sxy / sxx
  return { slope, intercept: meanY - slope * meanX, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) }
}

/** True when this sample is over the limit: the moment the measurement aborts the export. */
export function memoryExceedsLimit(sample, limitBytes = DEFAULT_LIMIT_BYTES) {
  return Boolean(sample) && typeof sample.browserBytes === 'number' && sample.browserBytes > limitBytes
}

/**
 * Judge a memory curve. Returns the numbers to quote (`startBytes`, `peakBytes`, `endBytes`, the second half's
 * `slopeMiBPerMinute`) and `verdict`: 'flat', 'growing' (slope over the limit), 'over-limit' (peak over the
 * limit), 'too-short' (not enough samples in the second half to fit a line) or 'no-data'. `flat` is true only for
 * 'flat'. `projectedBytesAtTarget` is the fitted line's value at `targetSeconds` (the 20-minute export) when the
 * slope is positive, so a short run says what a long one would reach.
 */
export function judgeFlatMemory(
  series,
  {
    limitBytes = DEFAULT_LIMIT_BYTES,
    slopeLimitMiBPerMinute = DEFAULT_SLOPE_LIMIT_MIB_PER_MIN,
    targetSeconds = 20 * 60,
  } = {},
) {
  const points = (series ?? []).filter((s) => typeof s.browserBytes === 'number')
  if (points.length === 0) return { verdict: 'no-data', flat: false }
  const first = points[0]
  const last = points.at(-1)
  const peak = points.reduce((best, s) => (s.browserBytes > best.browserBytes ? s : best), first)
  const base = {
    limitBytes,
    slopeLimitMiBPerMinute,
    samples: points.length,
    durationSeconds: round((last.t - first.t) / 1000),
    startBytes: first.browserBytes,
    peakBytes: peak.browserBytes,
    peakAtSeconds: round((peak.t - first.t) / 1000),
    endBytes: last.browserBytes,
  }
  const middle = (first.t + last.t) / 2
  const half = points.filter((s) => s.t >= middle)
  const halfSeconds = half.length > 1 ? (half.at(-1).t - half[0].t) / 1000 : 0
  if (half.length < MIN_HALF_SAMPLES || halfSeconds < MIN_HALF_SECONDS) {
    return {
      ...base,
      verdict: base.peakBytes > limitBytes ? 'over-limit' : 'too-short',
      flat: false,
      secondHalfSamples: half.length,
      secondHalfSeconds: round(halfSeconds),
    }
  }
  const fit = linearFit(half.map((s) => ({ x: s.t / MINUTE_MS, y: s.browserBytes / MIB })))
  const targetMinutes = targetSeconds / 60
  const projectedMiB =
    fit.slope > 0
      ? fit.intercept + fit.slope * targetMinutes
      : fit.intercept + fit.slope * (last.t / MINUTE_MS)
  let verdict = 'flat'
  if (base.peakBytes > limitBytes) verdict = 'over-limit'
  else if (fit.slope > slopeLimitMiBPerMinute) verdict = 'growing'
  return {
    ...base,
    verdict,
    flat: verdict === 'flat',
    secondHalfSamples: half.length,
    secondHalfSeconds: round(halfSeconds),
    slopeMiBPerMinute: round(fit.slope, 2),
    slopeRSquared: round(fit.r2, 3),
    secondHalfMeanBytes: Math.round(half.reduce((s, p) => s + p.browserBytes, 0) / half.length),
    projectedBytesAtTarget: Math.max(0, Math.round(projectedMiB * MIB)),
    projectedTargetSeconds: targetSeconds,
  }
}

/** Per minute of the series: lowest, mean and highest browser memory (MiB) and the highest GPU memory (MiB). */
export function perMinute(series) {
  const points = (series ?? []).filter((s) => typeof s.browserBytes === 'number')
  if (points.length === 0) return []
  const origin = points[0].t
  const buckets = new Map()
  for (const s of points) {
    const minute = Math.floor((s.t - origin) / MINUTE_MS)
    if (!buckets.has(minute)) buckets.set(minute, [])
    buckets.get(minute).push(s)
  }
  return [...buckets.entries()].map(([minute, list]) => {
    const bytes = list.map((s) => s.browserBytes)
    const gpu = list.map((s) => s.gpuBytes).filter((v) => typeof v === 'number')
    return {
      minute,
      samples: list.length,
      browserMiB: {
        min: Math.round(Math.min(...bytes) / MIB),
        mean: Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length / MIB),
        max: Math.round(Math.max(...bytes) / MIB),
      },
      gpuMaxMiB: gpu.length ? Math.round(Math.max(...gpu) / MIB) : null,
    }
  })
}

/** At most `max` points, evenly spaced, always keeping the first, the last and the highest. */
export function downsample(series, max = 600) {
  const list = series ?? []
  if (list.length <= max) return list
  const step = (list.length - 1) / (max - 1)
  const keep = new Set(Array.from({ length: max }, (_, i) => Math.round(i * step)))
  let peakIndex = 0
  list.forEach((s, i) => {
    if ((s.browserBytes ?? 0) > (list[peakIndex].browserBytes ?? 0)) peakIndex = i
  })
  keep.add(peakIndex)
  return list.filter((_, i) => keep.has(i))
}

/**
 * Is the output written as it goes? `points` are `{ frame, growthBytes }`: how far the browser profile's size has
 * grown since before the export (the OPFS temporary file lives there, and its bytes are not visible through the
 * OPFS API until the writer closes), against how many frames are done. At the half-way frame a streamed file
 * already holds about half its final size; a file held in memory and written at the end holds nothing.
 * 'streamed': at least a quarter of the final size at half-way; 'held-until-end': under 5 %; otherwise 'partial'.
 */
export function judgeOutputGrowth(points, { totalFrames, finalBytes }) {
  const list = (points ?? []).filter((p) => typeof p.frame === 'number')
  if (list.length === 0 || !(finalBytes > 0) || !(totalFrames > 0)) {
    return { verdict: 'no-data', writtenAsItGoes: false }
  }
  const atHalf = list.find((p) => p.frame >= totalFrames / 2)
  if (!atHalf) return { verdict: 'no-data', writtenAsItGoes: false }
  const fraction = atHalf.growthBytes / finalBytes
  const verdict = fraction >= 0.25 ? 'streamed' : fraction < 0.05 ? 'held-until-end' : 'partial'
  return {
    verdict,
    writtenAsItGoes: verdict === 'streamed',
    growthAtHalfwayBytes: atHalf.growthBytes,
    fractionOfFinalAtHalfway: round(fraction, 3),
    halfwayFrame: atHalf.frame,
  }
}

/**
 * Which clips of the folder the timeline needs and where each starts. `clips` are in timeline order
 * (`{ fileName, bytes, durationSeconds }`); `limitSeconds` (or null for all) cuts the export short: only the clips
 * that start before it are copied into the browser's storage.
 */
export function planTimeline(clips, { limitSeconds = null } = {}) {
  let start = 0
  const planned = clips.map((clip) => {
    const entry = { ...clip, startSeconds: start }
    start += clip.durationSeconds
    return entry
  })
  const totalSeconds = start
  const exportSeconds = limitSeconds === null ? totalSeconds : Math.min(limitSeconds, totalSeconds)
  const withNeeded = planned.map((c) => ({ ...c, needed: c.startSeconds < exportSeconds }))
  return {
    clips: withNeeded,
    totalSeconds,
    exportSeconds,
    neededBytes: withNeeded.filter((c) => c.needed).reduce((s, c) => s + c.bytes, 0),
  }
}

/**
 * Disk the run needs: the clips copied into the browser's storage, the temporary output, the copy the download
 * makes of it, and a margin. Refuse to start with less free.
 */
export function diskNeededBytes({ neededBytes, exportSeconds, bitsPerSecond = 60_000_000 }) {
  const output = Math.ceil((exportSeconds * bitsPerSecond) / 8)
  return neededBytes + 2 * output + 4 * GIB
}
