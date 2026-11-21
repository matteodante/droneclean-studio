// The pre-render's range bookkeeping (design `docs/designs/prerender-preview.md` §0.7): which frames a request covers,
// which of them still have to be rendered, and the coalesced ranges the ruler's green bar draws. Pure functions over
// half-open frame ranges `[start, end)`, the way the timeline's out point is exclusive.

/** A half-open range of timeline frames: `start` is the first frame, `end` the one after the last */
export interface FrameRange {
  readonly start: number
  readonly end: number
}

/** What a request names: the SDK's optional bounds and the timeline's own in/out range and length */
export interface PrerenderRangeRequest {
  readonly startFrame?: number
  readonly endFrame?: number
  readonly inPoint: number | null
  readonly outPoint: number | null
  /** The frame after the timeline's last frame (0 for an empty timeline) */
  readonly timelineEnd: number
}

/**
 * The range a request renders: the timeline's In/Out when one is set, the whole timeline otherwise, each bound
 * replaced by the caller's when given. `null` when that leaves nothing to render (an empty timeline, or bounds that
 * are out of order); the caller says why.
 */
export function resolvePrerenderRange(request: PrerenderRangeRequest): FrameRange | null {
  const { inPoint, outPoint, timelineEnd } = request
  const hasInOut = inPoint !== null && outPoint !== null && outPoint > inPoint
  const start = request.startFrame ?? (hasInOut ? inPoint : 0)
  const end = Math.min(request.endFrame ?? (hasInOut ? outPoint : timelineEnd), timelineEnd)
  if (!(Number.isInteger(start) && Number.isInteger(end))) return null
  if (start < 0 || end <= start) return null
  return { start, end }
}

/** The ranges sorted by start, with overlapping and touching ranges merged */
export function coalesceRanges(ranges: readonly FrameRange[]): FrameRange[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .toSorted((a, b) => a.start - b.start)
  const merged: FrameRange[] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last !== undefined && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) }
    } else {
      merged.push(range)
    }
  }
  return merged
}

/** The parts of `range` that none of `covered` contains, in order */
export function subtractRanges(range: FrameRange, covered: readonly FrameRange[]): FrameRange[] {
  const missing: FrameRange[] = []
  let cursor = range.start
  for (const block of coalesceRanges(covered)) {
    if (block.end <= cursor) continue
    if (block.start >= range.end) break
    if (block.start > cursor) missing.push({ start: cursor, end: Math.min(block.start, range.end) })
    cursor = Math.max(cursor, block.end)
    if (cursor >= range.end) break
  }
  if (cursor < range.end) missing.push({ start: cursor, end: range.end })
  return missing
}

/**
 * The ranges of indices whose flag is set, offset by `base`: the runs of valid frames of one cached run
 * (`flags[i]` is frame `base + i`).
 */
export function rangesOfFlags(flags: ArrayLike<boolean>, base: number): FrameRange[] {
  const ranges: FrameRange[] = []
  let start = -1
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] === true) {
      if (start < 0) start = index
    } else if (start >= 0) {
      ranges.push({ start: base + start, end: base + index })
      start = -1
    }
  }
  if (start >= 0) ranges.push({ start: base + start, end: base + flags.length })
  return ranges
}
