// Stage timings (task 8.2): the marks the editor records with the flag on (`src/studio/render/timings.ts`, User
// Timing measures named `dc.<stage>`) turned into per-stage statistics. Pure: marks in, numbers out.

/** One mark as the page reads it from `performance.getEntriesByType('measure')`. */
/** @typedef {{ name: string, start: number, duration: number, frame?: number }} Mark */

const MARK_PREFIX = 'dc.'

/** The stages of one table, in pipeline order; `effects-composite` is derived, the others are marks. */
const STAGE_ORDER = [
  'decode',
  'upload',
  'source.gpu',
  'stabilize',
  'input-colour',
  'look',
  'effects-composite',
  'readback',
  'encode',
  'write',
]

/** What each stage means, for the report. */
const STAGE_LABELS = {
  decode: 'decode (decoder hands over the frame)',
  upload: 'upload (frame into the renderer)',
  'source.gpu': 'source on the GPU (the upload and widening the queue still held)',
  stabilize: 'stabilize (GPU, submit to done)',
  'input-colour': 'input colour (GPU, submit to done)',
  look: 'look (GPU, submit to done)',
  'effects-composite': 'effects and composite (render minus the above)',
  readback: 'readback (pixels into a sample)',
  encode: 'encode (encoder takes the sample)',
  write: 'write (muxer bytes to the file)',
}

const SOURCE_STAGES = ['decode', 'upload', 'source.gpu', 'stabilize', 'input-colour', 'look']

/** The p-th percentile (0..100) by linear interpolation; null for no values. */
export function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

const round = (n, digits = 2) => (n === null ? null : Number(n.toFixed(digits)))

/** Marks of `dc.*` out of a page's measure entries, shaped as `Mark`. */
export function marksFromEntries(entries) {
  return entries
    .filter((e) => typeof e.name === 'string' && e.name.startsWith(MARK_PREFIX))
    .map((e) => ({
      name: e.name.slice(MARK_PREFIX.length),
      start: e.startTime ?? e.start,
      duration: e.duration,
      ...(e.detail && typeof e.detail.frame === 'number' ? { frame: e.detail.frame } : {}),
    }))
}

/**
 * Per-stage statistics. Each mark belongs to an output frame: its own `frame` when the editor knew it, else the
 * last `frame.render` that began at or before it. A stage's per-frame figure is the sum of its marks in that frame
 * (frames without a mark count as zero), so `meanPerFrameMs` is total over frames and `p95PerFrameMs` the 95th
 * percentile over frames. `meanPerMarkMs` is the mean of single marks. Effects and composite is
 * `frame.render` minus the source stages, per frame, never below zero.
 *
 * @param {Mark[]} marks
 * @param {{ skipFrames?: number }} [options] frames to leave out at the start (warm-up: pipeline builds, first decode)
 */
export function summariseMarks(marks, { skipFrames = 0 } = {}) {
  const renders = marks.filter((m) => m.name === 'frame.render').sort((a, b) => a.start - b.start)
  if (renders.length === 0)
    return { frames: 0, stages: {}, rows: [], slowest: null, skippedFrames: 0 }
  const frameIds = renders.map((m, i) => m.frame ?? i)
  const slotOf = new Map(frameIds.map((id, i) => [id, i]))
  const frameOfMark = (m) => {
    if (m.frame !== undefined && slotOf.has(m.frame)) return slotOf.get(m.frame)
    let lo = 0
    let hi = renders.length - 1
    let found = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (renders[mid].start <= m.start) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return found
  }
  const skip = Math.min(skipFrames, renders.length - 1)
  const count = renders.length - skip
  const perFrame = {}
  const perMark = {}
  for (const m of marks) {
    const slot = frameOfMark(m) - skip
    if (slot < 0) continue
    ;(perFrame[m.name] ??= new Float64Array(count))[slot] += m.duration
    ;(perMark[m.name] ??= []).push(m.duration)
  }
  // Derived: effects and composite.
  const render = perFrame['frame.render']
  const derived = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    let rest = render[i]
    for (const s of SOURCE_STAGES) rest -= perFrame[s]?.[i] ?? 0
    derived[i] = Math.max(0, rest)
  }
  perFrame['effects-composite'] = derived
  perMark['effects-composite'] = [...derived]

  const stages = {}
  for (const [name, values] of Object.entries(perFrame)) {
    const total = values.reduce((a, b) => a + b, 0)
    const marksOfStage = perMark[name] ?? []
    stages[name] = {
      marks: name === 'effects-composite' ? count : marksOfStage.length,
      totalMs: round(total),
      meanPerFrameMs: round(total / count),
      p95PerFrameMs: round(percentile([...values], 95)),
      meanPerMarkMs: round(
        marksOfStage.reduce((a, b) => a + b, 0) / Math.max(1, marksOfStage.length),
      ),
    }
  }
  const rows = STAGE_ORDER.filter((s) => stages[s] && stages[s].marks > 0)
  const slowest = rows.reduce(
    (best, s) =>
      best === null || stages[s].meanPerFrameMs > stages[best].meanPerFrameMs ? s : best,
    null,
  )
  return { frames: count, skippedFrames: skip, stages, rows, slowest }
}

/** A text table of one summary; `wallMsPerFrame` (real time per frame) is shown for scale when given. */
export function formatSummary(title, summary, { wallMsPerFrame = null } = {}) {
  const lines = [title]
  if (summary.frames === 0) return [...lines, '  no marks recorded'].join('\n')
  const name = (s) => STAGE_LABELS[s] ?? s
  const width = Math.max(...summary.rows.map((s) => name(s).length), 5)
  lines.push(`  ${'stage'.padEnd(width)}  ${'mean ms'.padStart(8)}  ${'p95 ms'.padStart(8)}  share`)
  const sum = summary.rows.reduce((a, s) => a + summary.stages[s].meanPerFrameMs, 0)
  for (const s of summary.rows) {
    const st = summary.stages[s]
    const share = sum > 0 ? Math.round((100 * st.meanPerFrameMs) / sum) : 0
    lines.push(
      `  ${name(s).padEnd(width)}  ${st.meanPerFrameMs.toFixed(2).padStart(8)}  ${st.p95PerFrameMs.toFixed(2).padStart(8)}  ${String(share).padStart(4)}%${s === summary.slowest ? '  <- slowest' : ''}`,
    )
  }
  lines.push(
    `  sum of stages ${sum.toFixed(2)} ms per frame over ${summary.frames} frames` +
      (wallMsPerFrame === null
        ? ''
        : `; real time ${wallMsPerFrame.toFixed(2)} ms per frame (stages overlap: encode and write run behind the next render)`),
  )
  return lines.join('\n')
}
