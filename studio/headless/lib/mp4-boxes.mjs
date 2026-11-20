// A small ISO base media (MP4) box parser: enough to check a file against Meta's Reel container rules
// (moov before mdat, no edit lists, AAC near 128 kbps, the first audio sample at time 0) without FFmpeg.

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'dinf'])

/** The size and header length of the box at `at` (a size of 1 is followed by a 64-bit size, 0 runs to the end). */
function boxSize(buffer, at, end) {
  const size = buffer.readUInt32BE(at)
  if (size === 1) return { size: Number(buffer.readBigUInt64BE(at + 8)), headerSize: 16 }
  return { size: size === 0 ? end - at : size, headerSize: 8 }
}

/** The box at `at`, its header read and its size checked against the bytes that are left. */
function readBox(buffer, at, end) {
  const type = buffer.toString('latin1', at + 4, at + 8)
  const { size, headerSize } = boxSize(buffer, at, end)
  if (size < headerSize || at + size > end) {
    throw new Error(`box "${type}" at ${at} has size ${size}, which does not fit (${end - at} bytes left)`)
  }
  return { type, start: at, end: at + size, headerSize }
}

/** The boxes in `buffer[start, end)`, each `{ type, start, end, headerSize, children? }`; container boxes are walked. */
export function parseBoxes(buffer, start = 0, end = buffer.length) {
  const boxes = []
  for (let at = start; at + 8 <= end; at = boxes.at(-1).end) {
    const box = readBox(buffer, at, end)
    if (CONTAINERS.has(box.type)) box.children = parseBoxes(buffer, box.start + box.headerSize, box.end)
    boxes.push(box)
  }
  return boxes
}

function child(box, type) {
  return box?.children?.find((candidate) => candidate.type === type)
}

function find(box, ...types) {
  return types.reduce((current, type) => child(current, type), box)
}

function allBoxes(boxes) {
  return boxes.flatMap((box) => [box, ...(box.children ? allBoxes(box.children) : [])])
}

/** The body of a full box (after its version and flags are read by the caller). */
function bodyOf(box) {
  return box.start + box.headerSize
}

function handlerOf(buffer, trak) {
  const hdlr = find(trak, 'mdia', 'hdlr')
  const at = bodyOf(hdlr) + 8
  return buffer.toString('latin1', at, at + 4)
}

function timingOf(buffer, trak) {
  const body = bodyOf(find(trak, 'mdia', 'mdhd'))
  const wide = buffer[body] === 1
  return {
    timescale: buffer.readUInt32BE(body + (wide ? 20 : 12)),
    duration: wide ? Number(buffer.readBigUInt64BE(body + 24)) : buffer.readUInt32BE(body + 16),
  }
}

/** The sample count and the bytes of all samples of the track's `stsz` box. */
function sizesOf(buffer, stbl) {
  const body = bodyOf(child(stbl, 'stsz'))
  const fixed = buffer.readUInt32BE(body + 4)
  const count = buffer.readUInt32BE(body + 8)
  let bytes = fixed * count
  for (let i = 0; fixed === 0 && i < count; i++) bytes += buffer.readUInt32BE(body + 12 + i * 4)
  return { count, bytes }
}

/** One entry of an `elst` box: its length in the movie's milliseconds and the media time it starts at (-1: empty). */
function editEntry(buffer, at, wide) {
  return wide
    ? { segment: Number(buffer.readBigUInt64BE(at)), time: Number(buffer.readBigInt64BE(at + 8)) }
    : { segment: buffer.readUInt32BE(at), time: buffer.readInt32BE(at + 4) }
}

/** The entries of an `elst` box. */
function editEntries(buffer, elst) {
  const body = bodyOf(elst)
  const wide = buffer[body] === 1
  const entries = buffer.readUInt32BE(body + 4)
  return Array.from({ length: entries }, (_, i) =>
    editEntry(buffer, body + 8 + i * (wide ? 20 : 12), wide),
  )
}

/** When the first sample is shown, in seconds: 0 with no edit list. */
function firstSampleTimeOf(buffer, edts, timescale) {
  if (!edts) return 0
  const entries = editEntries(buffer, child(edts, 'elst'))
  const firstMedia = entries.findIndex((entry) => entry.time !== -1)
  const empty = entries.slice(0, firstMedia < 0 ? entries.length : firstMedia)
  const emptySeconds = empty.reduce((sum, entry) => sum + entry.segment / 1000, 0)
  return emptySeconds - (firstMedia < 0 ? 0 : entries[firstMedia].time / timescale)
}

function mediaOf(buffer, trak) {
  const { timescale, duration } = timingOf(buffer, trak)
  const { count, bytes } = sizesOf(buffer, find(trak, 'mdia', 'minf', 'stbl'))
  const edts = child(trak, 'edts')
  return {
    handler: handlerOf(buffer, trak),
    timescale,
    seconds: duration / timescale,
    samples: count,
    /** The track's own bytes per second, from its sample sizes: what a player sees as the bitrate. */
    bitrate: duration > 0 ? (bytes * 8 * timescale) / duration : 0,
    hasEditList: Boolean(edts),
    firstSampleTime: firstSampleTimeOf(buffer, edts, timescale),
  }
}

/**
 * What an MP4 file says about its container: the order of the top-level boxes, every edit list, and for each
 * track its handler (`vide`, `soun`), duration, bitrate and where its first sample falls.
 */
export function describeMp4(buffer) {
  const top = parseBoxes(buffer)
  const types = top.map((box) => box.type)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) throw new Error('no moov box')
  const tracks = moov.children.filter((box) => box.type === 'trak').map((trak) => mediaOf(buffer, trak))
  return {
    topLevel: types,
    moovBeforeMdat: types.indexOf('moov') < types.indexOf('mdat'),
    editListBoxes: allBoxes(top).filter((box) => box.type === 'edts' || box.type === 'elst').length,
    tracks,
    video: tracks.find((track) => track.handler === 'vide'),
    audio: tracks.find((track) => track.handler === 'soun'),
  }
}
