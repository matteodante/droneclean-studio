import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALL_FORMATS,
  AudioSample,
  BufferSource,
  CustomAudioDecoder,
  Input,
  registerDecoder,
} from 'mediabunny'
import * as mb from 'mediabunny'
import { describe, expect, it } from 'vite-plus/test'
import {
  createPrimedAudioSampleSink,
  parseItunSmpbFromIlst,
  readAacDelayFromMoov,
} from './aac-priming'

/**
 * 11.22: an AAC file that declares its encoder delay only in an `iTunSMPB` tag (no edit list).
 *
 * Fixtures: `aac-click-0p5s.m4a` has an edit list (media time 1024); `aac-click-0p5s-noedit.m4a` is the same
 * click at 0.5 s encoded with `ffmpeg ... -c:a aac -b:a 128k -use_editlist 0`, which has neither an edit list
 * nor a tag. FFmpeg 9 cannot write the iTunes freeform `----` atom (with `use_metadata_tags` it writes a
 * QuickTime `mdta` key instead), so `withItunSmpb` below inserts the atom into the file's `ilst`, as iTunes does.
 *
 * A decoder is not available in Node, so a stand-in AAC decoder registered here turns every packet into 1024
 * frames whose value is the frame's index in the decoded stream (packet start x 48000 + position, / 1e5):
 * after the trim, the value at time t must be (t x 48000 + delay) / 1e5, i.e. time 0 is stream frame `delay`.
 */
const RATE = 48_000
const BLOCK = 1024
const SCALE = 1e5
const encoder = new TextEncoder()

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)))

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, size)
  out.set(encoder.encode(type), 4)
  let at = 8
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** A freeform `----` atom as iTunes writes it: mean, name, data (UTF-8 text). */
function freeformAtom(name: string, value: string): Uint8Array {
  const u32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
  return box(
    '----',
    box('mean', u32(0), encoder.encode('com.apple.iTunes')),
    box('name', u32(0), encoder.encode(name)),
    box('data', u32(1), u32(0), encoder.encode(value)),
  )
}

const smpb = (delay: number) =>
  ` 00000000 ${delay.toString(16).padStart(8, '0')} 00000240 0000000000000000 00000000 00000000`

/** Appends an atom to the `ilst` of a file whose `moov` is its last top-level box, fixing the parent sizes. */
function withIlstAtom(bytes: Uint8Array, atom: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const find = (type: string, from: number, to: number) => {
    for (let at = from; at + 8 <= to; at += view.getUint32(at)) {
      if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === type) return at
    }
    throw new Error(`no ${type}`)
  }
  const moov = find('moov', 0, bytes.length)
  const udta = find('udta', moov + 8, moov + view.getUint32(moov))
  const meta = find('meta', udta + 8, udta + view.getUint32(udta))
  const ilst = find('ilst', meta + 12, meta + view.getUint32(meta))
  const ilstEnd = ilst + view.getUint32(ilst)
  expect(moov + view.getUint32(moov)).toBe(bytes.length)
  const out = new Uint8Array(bytes.length + atom.length)
  out.set(bytes.subarray(0, ilstEnd))
  out.set(atom, ilstEnd)
  out.set(bytes.subarray(ilstEnd), ilstEnd + atom.length)
  const grow = new DataView(out.buffer)
  for (const at of [moov, udta, meta, ilst]) grow.setUint32(at, grow.getUint32(at) + atom.length)
  return out
}

const withItunSmpb = (bytes: Uint8Array, delay: number) =>
  withIlstAtom(bytes, freeformAtom('iTunSMPB', smpb(delay)))

class IndexDecoder extends CustomAudioDecoder {
  static override supports(codec: string) {
    return codec === 'aac'
  }
  init() {}
  decode(packet: mb.EncodedPacket) {
    const base = Math.round(packet.timestamp * RATE)
    const data = new Float32Array(BLOCK)
    for (let i = 0; i < BLOCK; i++) data[i] = (base + i) / SCALE
    void this.onSample(
      new AudioSample({
        data,
        format: 'f32',
        numberOfChannels: 1,
        sampleRate: RATE,
        timestamp: packet.timestamp,
      }),
    )
  }
  flush() {}
  close() {}
}
registerDecoder(IndexDecoder)

async function decodeAll(bytes: Uint8Array) {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) })
  try {
    const track = (await input.getPrimaryAudioTrack())!
    const sink = await createPrimedAudioSampleSink(mb, input, track)
    const samples: { timestamp: number; values: Float32Array }[] = []
    for await (const sample of sink.samples()) {
      const values = new Float32Array(sample.numberOfFrames)
      sample.copyTo(values, { planeIndex: 0, format: 'f32-planar' })
      samples.push({ timestamp: sample.timestamp, values })
      sample.close()
    }
    return samples
  } finally {
    input.dispose()
  }
}

describe('parseItunSmpbFromIlst', () => {
  it('reads the delay, the second hex field, from a hand-built ilst', () => {
    const ilst = new Uint8Array([
      ...box('©too', box('data', new Uint8Array(8), encoder.encode('x'))),
      ...freeformAtom('iTunSMPB', smpb(2112)),
    ])
    expect(parseItunSmpbFromIlst(ilst)).toBe(2112)
  })

  it('ignores other freeform atoms, an empty ilst and unreadable values', () => {
    expect(parseItunSmpbFromIlst(new Uint8Array(0))).toBeNull()
    expect(parseItunSmpbFromIlst(freeformAtom('iTunNORM', smpb(2112)))).toBeNull()
    expect(parseItunSmpbFromIlst(freeformAtom('iTunSMPB', ' 00000000 zzzz'))).toBeNull()
    expect(parseItunSmpbFromIlst(freeformAtom('iTunSMPB', smpb(0)))).toBeNull()
  })
})

describe('readAacDelayFromMoov', () => {
  const moovOf = (bytes: Uint8Array) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let at = 0
    while (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) !== 'moov')
      at += view.getUint32(at)
    return bytes.subarray(at)
  }

  it('returns the delay of a file with the tag and no edit list', () => {
    expect(
      readAacDelayFromMoov(moovOf(withItunSmpb(fixture('aac-click-0p5s-noedit.m4a'), 1024))),
    ).toBe(1024)
  })

  it('returns nothing for a file with an edit list, even when it also has the tag', () => {
    const withEditList = fixture('aac-click-0p5s.m4a')
    expect(readAacDelayFromMoov(moovOf(withEditList))).toBeNull()
    expect(readAacDelayFromMoov(moovOf(withItunSmpb(withEditList, 1024)))).toBeNull()
  })

  it('returns nothing for a file with neither', () => {
    expect(readAacDelayFromMoov(moovOf(fixture('aac-click-0p5s-noedit.m4a')))).toBeNull()
  })
})

describe('decoding with the delay in the tag only', () => {
  it('starts time 0 at the first real sample (the trim)', async () => {
    const plain = await decodeAll(fixture('aac-click-0p5s-noedit.m4a'))
    const tagged = await decodeAll(withItunSmpb(fixture('aac-click-0p5s-noedit.m4a'), 1024))
    // Without the fix the file decodes late: time 0 holds stream frame 0, the priming.
    expect(plain[0]!.timestamp).toBe(0)
    expect(plain[0]!.values[0]).toBe(0)
    // With it, the 1024 priming frames are gone and time t holds stream frame t x 48000 + 1024.
    expect(tagged[0]!.timestamp).toBeCloseTo(0, 9)
    expect(tagged[0]!.values[0]).toBeCloseTo(1024 / SCALE, 6)
    expect(tagged.length).toBe(plain.length - 1)
    const frames = tagged.reduce((n, s) => n + s.values.length, 0)
    expect(frames).toBe(plain.reduce((n, s) => n + s.values.length, 0) - 1024)
    // the click is at stream frame 24000 + 1024 = 25024 (the file was encoded with 1024 of priming), so
    // after the trim it sits at time 0.5 s, sample 24000
    const at = tagged.find((s) => s.timestamp <= 0.5 && s.timestamp + s.values.length / RATE > 0.5)!
    const index = Math.round(0.5 * RATE) - Math.round(at.timestamp * RATE)
    expect(at.values[index]! * SCALE).toBeCloseTo(24000 + 1024, 0)
  })

  it('trims a delay that is not a whole block (2112 = 2 blocks + 64 frames)', async () => {
    const tagged = await decodeAll(withItunSmpb(fixture('aac-click-0p5s-noedit.m4a'), 2112))
    expect(tagged[0]!.timestamp).toBeCloseTo(0, 9)
    expect(tagged[0]!.values.length).toBe(BLOCK - 64)
    expect(tagged[0]!.values[0]! * SCALE).toBeCloseTo(2112, 0)
    expect(tagged[1]!.timestamp).toBeCloseTo((BLOCK - 64) / RATE, 9)
  })

  it('leaves the edit-list file where it is, tag or not', async () => {
    const plain = await decodeAll(fixture('aac-click-0p5s.m4a'))
    const tagged = await decodeAll(withItunSmpb(fixture('aac-click-0p5s.m4a'), 1024))
    expect(tagged.map((s) => s.timestamp)).toEqual(plain.map((s) => s.timestamp))
    expect(tagged[0]!.timestamp * RATE).toBeCloseTo(-1024, 3)
  })

  it('shifts a ranged read and getSample too', async () => {
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BufferSource(withItunSmpb(fixture('aac-click-0p5s-noedit.m4a'), 1024)),
    })
    try {
      const track = (await input.getPrimaryAudioTrack())!
      const sink = await createPrimedAudioSampleSink(mb, input, track)
      const sample = (await sink.getSample(0.5))!
      const first = new Float32Array(1)
      sample.copyTo(first, { planeIndex: 0, format: 'f32-planar', frameCount: 1 })
      const offset = Math.round((0.5 - sample.timestamp) * RATE)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(first[0]! * SCALE + offset).toBeCloseTo(Math.round(0.5 * RATE) + 1024 - 0, 0)
      sample.close()
      let count = 0
      for await (const s of sink.samples(0.5, 0.6)) {
        expect(s.timestamp).toBeLessThan(0.6)
        count++
        s.close()
      }
      expect(count).toBeGreaterThan(0)
    } finally {
      input.dispose()
    }
  })
})
