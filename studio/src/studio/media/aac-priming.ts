/**
 * AAC encoder delay declared only in an `iTunSMPB` tag (task 11.22).
 *
 * An AAC file says how many samples at the start of the decoded audio are encoder priming in one of two ways:
 * an edit list (`edts/elst`, which mediabunny reads: it gives the priming packets a negative timestamp) or the
 * iTunes `iTunSMPB` freeform tag in `moov/udta/meta/ilst`. mediabunny ignores the tag, so a file that has only
 * the tag decodes late by the delay (1024 samples, 21.3 ms at 48 kHz). This module reads the tag and gives every
 * decode path one call, `createPrimedAudioSampleSink`, which returns the usual `AudioSampleSink` with the delay
 * removed: time 0 is the first real sample.
 *
 * Files with an edit list, with no tag, or in any format that is not an MP4/M4A are left exactly as they were.
 */

type MediabunnyModule = typeof import('mediabunny')
type AudioSampleSinkInstance = InstanceType<MediabunnyModule['AudioSampleSink']>
type AudioSampleInstance = InstanceType<MediabunnyModule['AudioSample']>

/** Largest `moov` box read to look for the tag (a very long video's `moov` is a few MB). */
const MAX_MOOV_BYTES = 64 * 1024 * 1024
const TAG_NAME = 'iTunSMPB'

interface Box {
  type: string
  /** Offset of the box's content (after the header) in the buffer. */
  start: number
  /** Offset just past the box. */
  end: number
}

function readBoxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const boxes: Box[] = []
  let at = from
  while (at + 8 <= to) {
    let size = view.getUint32(at)
    let header = 8
    if (size === 1) {
      if (at + 16 > to) break
      size = Number(view.getBigUint64(at + 8))
      header = 16
    } else if (size === 0) {
      size = to - at
    }
    if (size < header || at + size > to) break
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!)
    boxes.push({ type, start: at + header, end: at + size })
    at += size
  }
  return boxes
}

function findBox(bytes: Uint8Array, within: Box | null, path: string[]): Box | null {
  let current = within ?? { type: '', start: 0, end: bytes.byteLength }
  for (const type of path) {
    const next = readBoxes(bytes, current.start, current.end).find((box) => box.type === type)
    if (!next) return null
    current = next
  }
  return current
}

/**
 * The encoder delay in samples declared by the `iTunSMPB` tag among the children of an `ilst` box's content
 * (a freeform `----` atom: `mean`, `name`, then a `data` atom holding hex fields: 0, delay, padding, length...).
 * Null when there is no such tag or its value cannot be read.
 */
export function parseItunSmpbFromIlst(ilst: Uint8Array): number | null {
  const decoder = new TextDecoder()
  for (const atom of readBoxes(ilst, 0, ilst.byteLength)) {
    if (atom.type !== '----') continue
    const children = readBoxes(ilst, atom.start, atom.end)
    const name = children.find((box) => box.type === 'name')
    const data = children.find((box) => box.type === 'data')
    if (!name || !data) continue
    // `name`: version/flags (4 bytes) then the text; `data`: type (4) + locale (4) then the text.
    if (decoder.decode(ilst.subarray(name.start + 4, name.end)) !== TAG_NAME) continue
    const fields = decoder
      .decode(ilst.subarray(data.start + 8, data.end))
      .trim()
      .split(/\s+/)
    const delay = Number.parseInt(fields[1] ?? '', 16)
    if (!Number.isSafeInteger(delay) || delay <= 0) return null
    return delay
  }
  return null
}

/**
 * The delay declared by the tag of a `moov` box (its whole bytes, header included), or null when the movie
 * has an edit list (mediabunny already handles that) or no tag.
 */
export function readAacDelayFromMoov(moovBox: Uint8Array): number | null {
  const moov = findBox(moovBox, null, ['moov'])
  if (!moov) return null
  const hasEditList = readBoxes(moovBox, moov.start, moov.end)
    .filter((box) => box.type === 'trak')
    .some((trak) => findBox(moovBox, trak, ['edts']) !== null)
  if (hasEditList) return null
  const meta = findBox(moovBox, moov, ['udta', 'meta'])
  if (!meta) return null
  // `meta` is a full box in MP4 (4 bytes of version/flags before its children) but a plain one in QuickTime.
  const view = new DataView(moovBox.buffer, moovBox.byteOffset, moovBox.byteLength)
  const childrenStart = view.getUint32(meta.start) === 0 ? meta.start + 4 : meta.start
  const ilst = readBoxes(moovBox, childrenStart, meta.end).find((box) => box.type === 'ilst')
  if (!ilst) return null
  return parseItunSmpbFromIlst(moovBox.subarray(ilst.start, ilst.end))
}

/** The part of mediabunny's `Source` read here: not public API, so it is checked before use. */
interface RawSource {
  getSizeOrNull?: () => Promise<number | null>
  _read?: (
    start: number,
    end: number,
    minReadPosition: number,
    maxReadPosition: number,
  ) => RawSlice | null | Promise<RawSlice | null>
}
interface RawSlice {
  bytes: Uint8Array
  offset: number
}

async function readRange(
  source: RawSource,
  start: number,
  end: number,
): Promise<Uint8Array | null> {
  const slice = await source._read!(start, end, 0, Infinity)
  if (!slice || !(slice.bytes instanceof Uint8Array)) return null
  // `offset` is the file position at which `bytes` begins, not an index into it
  const from = start - slice.offset
  if (from < 0 || from + (end - start) > slice.bytes.byteLength) return null
  return slice.bytes.subarray(from, from + (end - start))
}

/** The size a box header declares (32-bit, 64-bit when 1, to the end of the file when 0), or null if unreadable. */
function declaredBoxSize(header: Uint8Array, remaining: number): number | null {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const declared = view.getUint32(0)
  if (declared === 0) return remaining
  if (declared !== 1) return declared
  return header.byteLength >= 16 ? Number(view.getBigUint64(8)) : null
}

/** The type and total size of the top-level box at `at`, or null when it cannot be read or does not fit. */
async function readTopLevelHeader(
  source: RawSource,
  at: number,
  fileSize: number,
): Promise<{ type: string; size: number } | null> {
  const header = await readRange(source, at, Math.min(fileSize, at + 16))
  if (!header || header.byteLength < 8) return null
  const size = declaredBoxSize(header, fileSize - at)
  if (size === null || size < 8 || at + size > fileSize) return null
  return { type: String.fromCharCode(...header.subarray(4, 8)), size }
}

/** Finds the top-level `moov` box of an MP4 by walking box headers, and returns its bytes. */
async function readMoovBox(source: RawSource): Promise<Uint8Array | null> {
  const fileSize = await source.getSizeOrNull!()
  if (fileSize === null) return null
  let at = 0
  while (at + 8 <= fileSize) {
    const box = await readTopLevelHeader(source, at, fileSize)
    if (!box) return null
    if (box.type === 'moov')
      return box.size > MAX_MOOV_BYTES ? null : readRange(source, at, at + box.size)
    at += box.size
  }
  return null
}

/**
 * The AAC encoder delay (samples) that the file declares only through an `iTunSMPB` tag, or null: the track is
 * not AAC, the file is not an MP4/M4A, it has an edit list, or it has no tag. Never throws: if the probe fails
 * the audio decodes as it did before this module existed.
 */
async function readItunSmpbDelay(
  input: InstanceType<MediabunnyModule['Input']>,
  audioTrack: { codec: string | null },
): Promise<number | null> {
  if (audioTrack.codec !== 'aac') return null
  try {
    // Any freeform `----` atom shows up as a key here (mediabunny cannot decode its value, so it is null);
    // an MP4 without one cannot carry the tag and is not read any further.
    const tags = await input.getMetadataTags()
    if (!tags.raw || !('----' in tags.raw)) return null
    const source = input.source as unknown as RawSource
    if (typeof source._read !== 'function' || typeof source.getSizeOrNull !== 'function')
      return null
    const moov = await readMoovBox(source)
    return moov ? readAacDelayFromMoov(moov) : null
  } catch {
    return null
  }
}

function shiftSample(
  sample: AudioSampleInstance,
  delaySeconds: number,
): AudioSampleInstance | null {
  const start = sample.timestamp - delaySeconds
  const skipFrames = start < 0 ? Math.round(-start * sample.sampleRate) : 0
  if (skipFrames >= sample.numberOfFrames) {
    sample.close()
    return null
  }
  if (skipFrames === 0) {
    sample.setTimestamp(start)
    return sample
  }
  const trimmed = sample.trim(skipFrames)
  sample.close()
  trimmed.setTimestamp(trimmed.timestamp - delaySeconds)
  return trimmed
}

/**
 * Wraps a sink so that the first `delaySamples` decoded samples are dropped and every timestamp moves back by
 * the delay. Only `samples` and `getSample` are shifted (the two the editor uses); the rest is the sink's own.
 */
function trimAudioSinkPriming(
  sink: AudioSampleSinkInstance,
  delaySamples: number,
  sampleRate: number,
): AudioSampleSinkInstance {
  const delay = delaySamples / sampleRate
  async function* samples(startTimestamp?: number, endTimestamp?: number, options?: object) {
    for await (const sample of sink.samples(
      startTimestamp === undefined ? undefined : startTimestamp + delay,
      endTimestamp === undefined ? undefined : endTimestamp + delay,
      options,
    )) {
      const shifted = shiftSample(sample, delay)
      if (shifted) yield shifted
    }
  }
  const getSample = async (timestamp: number, options?: object) => {
    const sample = await sink.getSample(timestamp + delay, options)
    return sample ? shiftSample(sample, delay) : null
  }
  return new Proxy(sink, {
    get(target, property) {
      if (property === 'samples') return samples
      if (property === 'getSample') return getSample
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * What every audio decode path calls instead of `new AudioSampleSink(track)`: the same sink, with the encoder
 * delay of an AAC file that declares it only in an `iTunSMPB` tag removed from the start.
 */
export async function createPrimedAudioSampleSink(
  mb: MediabunnyModule,
  input: InstanceType<MediabunnyModule['Input']>,
  audioTrack: InstanceType<MediabunnyModule['InputAudioTrack']>,
): Promise<AudioSampleSinkInstance> {
  const sink = new mb.AudioSampleSink(audioTrack)
  const delay = await readItunSmpbDelay(input, audioTrack)
  return delay === null ? sink : trimAudioSinkPriming(sink, delay, audioTrack.sampleRate)
}
