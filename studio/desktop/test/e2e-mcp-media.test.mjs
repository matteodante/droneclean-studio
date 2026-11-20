// The pure parts of `test/e2e-mcp.mjs`'s measurements: the MP4 box layout Meta's rules are judged by, and the beat
// spacing and sky colour judgements. The end-to-end run itself is `npm run e2e:mcp`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { beatsFollowKicks, looksBlue, medianGap, mp4Boxes, mp4Layout } from './support/mcp-media.mjs'

/** One ISO BMFF box: a 32-bit size, the four-character type and the payload. */
function box(type, ...children) {
  const payload = Buffer.concat(children)
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + payload.length)
  header.write(type, 4, 'latin1')
  return Buffer.concat([header, payload])
}

const filler = (bytes) => Buffer.alloc(bytes, 7)

test('mp4Boxes reads one level in file order and stops at a broken size', () => {
  const file = Buffer.concat([box('ftyp', filler(8)), box('moov', box('trak', filler(4))), box('mdat', filler(16))])
  assert.deepEqual(mp4Boxes(file).map((b) => b.type), ['ftyp', 'moov', 'mdat'])
  const broken = Buffer.concat([box('ftyp', filler(8)), Buffer.from([0, 0, 0, 3, 0x6d, 0x6f, 0x6f, 0x76])])
  assert.deepEqual(mp4Boxes(broken).map((b) => b.type), ['ftyp'])
})

test('mp4Boxes reads a 64-bit size and a box that runs to the end of the file', () => {
  const large = Buffer.alloc(24)
  large.writeUInt32BE(1)
  large.write('mdat', 4, 'latin1')
  large.writeBigUInt64BE(24n, 8)
  const toEnd = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('free', 'latin1'), filler(12)])
  assert.deepEqual(mp4Boxes(Buffer.concat([large, toEnd])).map((b) => [b.type, b.size]), [['mdat', 24], ['free', 20]])
})

test('mp4Layout: fast start without an edit list passes, mdat first or an edts in a track does not', () => {
  const good = Buffer.concat([box('ftyp'), box('moov', box('mvhd'), box('trak', box('tkhd'), box('mdia')), box('trak', box('tkhd'))), box('mdat', filler(32))])
  assert.deepEqual(mp4Layout(good), { order: ['ftyp', 'moov', 'mdat'], tracks: 2, moovFirst: true, edts: false })
  const late = Buffer.concat([box('ftyp'), box('mdat', filler(32)), box('moov', box('trak', box('tkhd')))])
  assert.equal(mp4Layout(late).moovFirst, false)
  const edited = Buffer.concat([box('ftyp'), box('moov', box('trak', box('tkhd'), box('edts', box('elst', filler(8))))), box('mdat')])
  assert.equal(mp4Layout(edited).edts, true)
  assert.equal(mp4Layout(Buffer.concat([box('ftyp'), box('moov')])).moovFirst, false)
})

test('medianGap takes the middle gap of the sorted values', () => {
  assert.equal(medianGap([0, 15, 30, 46, 60]), 15)
  assert.equal(medianGap([30, 0, 15, 45]), 15)
  assert.equal(medianGap([0, 10, 30]), 15)
  assert.equal(medianGap([5]), null)
})

test('beatsFollowKicks accepts the tempo, half and double, and refuses anything else', () => {
  const every = (step, count) => Array.from({ length: count }, (_, index) => index * step)
  assert.equal(beatsFollowKicks(every(15, 20), 30), true)
  assert.equal(beatsFollowKicks(every(30, 10), 30), true)
  assert.equal(beatsFollowKicks(every(8, 30), 30), true)
  assert.equal(beatsFollowKicks(every(22, 12), 30), false)
  assert.equal(beatsFollowKicks([12], 30), false)
})

test('looksBlue wants blue clearly above red', () => {
  assert.equal(looksBlue([120, 160, 210]), true)
  assert.equal(looksBlue([236, 236, 236]), false)
  assert.equal(looksBlue([200, 210, 220]), false)
})
