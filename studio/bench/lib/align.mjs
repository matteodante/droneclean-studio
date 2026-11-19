// Which source frame does each output frame show? Frames are compared as small grey pictures (sum of absolute
// differences), which is robust to the encoder's noise and to the 8-bit / 10-bit difference, and insensitive to a
// grade. From the match we count the frames repeated, skipped and out of order.

/** Sum of absolute differences of two equally long byte arrays. */
function sad(a, b) {
  let total = 0
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i])
  return total
}

function median(values) {
  const sorted = [...values].sort((x, y) => x - y)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
}

/**
 * Match every output frame to a source frame.
 * Search follows the sequence: after a match at `j`, the next output frame is looked for in [j - back, j + ahead];
 * the first one is looked for among the first `startSearch` source frames. When the best match in the window is
 * much worse than the typical match (the sequence has jumped), the whole source is searched once.
 *
 * `ambiguousOutputFrames` lists the matches where the second best candidate is nearly as good (a static scene): the count of
 * repeated or skipped frames can be off by those.
 *
 * @param {Uint8Array[]} source small grey frames of the source, in order
 * @param {Uint8Array[]} output small grey frames of the export, in order
 */
export function matchFrames(
  source,
  output,
  { back = 3, ahead = 4, startSearch = 12, ambiguityRatio = 0.85 } = {},
) {
  const matches = []
  const bests = []
  const ambiguousOutputFrames = []
  let previous = null
  for (let k = 0; k < output.length; k++) {
    const range =
      previous === null
        ? [0, Math.min(source.length - 1, startSearch)]
        : [Math.max(0, previous - back), Math.min(source.length - 1, previous + ahead)]
    let found = search(source, output[k], range[0], range[1])
    const typical = median(bests)
    if (previous !== null && bests.length >= 10 && found.best > Math.max(typical * 6, 64)) {
      found = search(source, output[k], 0, source.length - 1)
    }
    matches.push(found.index)
    bests.push(found.best)
    if (found.second > 0 && found.best / found.second > ambiguityRatio)
      ambiguousOutputFrames.push(k)
    previous = found.index
  }
  return { matches, bestDistances: bests, ambiguousOutputFrames }
}

function search(source, frame, from, to) {
  let best = Infinity
  let second = Infinity
  let index = from
  for (let j = from; j <= to; j++) {
    const d = sad(frame, source[j])
    if (d < best) {
      second = best
      best = d
      index = j
    } else if (d < second) {
      second = d
    }
  }
  return { index, best, second: second === Infinity ? 0 : second }
}

/**
 * What the matching says about the export.
 * @param {number[]} matches source index shown by each output frame
 * @param {number} sourceFrames number of frames in the source segment
 */
export function summariseMatches(matches, sourceFrames, listLimit = 20) {
  const repeated = []
  const outOfOrder = []
  const seen = new Set()
  for (let k = 0; k < matches.length; k++) {
    seen.add(matches[k])
    if (k === 0) continue
    if (matches[k] === matches[k - 1]) repeated.push({ outputFrame: k, sourceFrame: matches[k] })
    else if (matches[k] < matches[k - 1])
      outOfOrder.push({ outputFrame: k, sourceFrame: matches[k] })
  }
  const first = matches.length > 0 ? matches[0] : null
  const last = matches.length > 0 ? matches[matches.length - 1] : null
  const skipped = []
  if (first !== null && last !== null) {
    for (let j = first; j <= last; j++) if (!seen.has(j)) skipped.push(j)
  }
  const missingAtStart = first ?? 0
  const missingAtEnd = last === null ? sourceFrames : sourceFrames - 1 - last
  const gaps = repeated.slice(1).map((r, i) => r.outputFrame - repeated[i].outputFrame)
  return {
    sourceFrames,
    outputFrames: matches.length,
    uniqueSourceFramesShown: seen.size,
    repeatedFrames: repeated.length,
    skippedSourceFrames: skipped.length,
    outOfOrderFrames: outOfOrder.length,
    firstSourceFrame: first,
    lastSourceFrame: last,
    sourceFramesMissingAtStart: missingAtStart,
    sourceFramesMissingAtEnd: missingAtEnd,
    everySourceFrameExactlyOnceInOrder:
      repeated.length === 0 &&
      skipped.length === 0 &&
      outOfOrder.length === 0 &&
      missingAtStart === 0 &&
      missingAtEnd === 0 &&
      matches.length === sourceFrames,
    repeated: repeated.slice(0, listLimit),
    skipped: skipped.slice(0, listLimit),
    outOfOrder: outOfOrder.slice(0, listLimit),
    outputFramesBetweenRepeats: gaps.slice(0, listLimit),
  }
}

/**
 * Second opinion that needs no source: an output frame that is a copy of the previous one differs from it far less
 * than frames of moving footage normally do.
 */
export function nearDuplicateOutputFrames(output, { fraction = 0.1, listLimit = 20 } = {}) {
  const diffs = []
  for (let k = 1; k < output.length; k++) diffs.push(sad(output[k], output[k - 1]))
  const typical = median(diffs)
  const indices = []
  diffs.forEach((d, i) => {
    if (d < typical * fraction) indices.push(i + 1)
  })
  return {
    typicalFrameToFrameDifference: typical,
    count: indices.length,
    outputFrames: indices.slice(0, listLimit),
  }
}

/** Frames to keep so that the output and the source line up one to one: first showing of each source frame. */
export function alignedSelections(matches, sourceFrames) {
  const keepOutput = []
  const shown = new Set()
  matches.forEach((j, k) => {
    if (!shown.has(j)) {
      shown.add(j)
      keepOutput.push(k)
    }
  })
  const keepSource = [...shown].sort((a, b) => a - b)
  return { keepOutput, keepSource, sourceFrames }
}
