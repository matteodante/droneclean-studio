import assert from 'node:assert/strict'
import test from 'node:test'
import { describeMp4, parseBoxes } from './lib/mp4-boxes.mjs'

function box(type, ...parts) {
  const body = Buffer.concat(parts)
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + body.length, 0)
  header.write(type, 4, 'latin1')
  return Buffer.concat([header, body])
}

function u32(...values) {
  const out = Buffer.alloc(values.length * 4)
  values.forEach((value, i) => out.writeInt32BE(value, i * 4))
  return out
}

/** A one-track file: `samples` samples of `sampleSize` bytes, 1 s long at timescale 1000, with an optional edit list. */
function track(handler, { samples, sampleSize, edit }) {
  const mdhd = box('mdhd', u32(0, 0, 0, 1000, 1000 * (samples / 10), 0))
  const hdlr = box('hdlr', u32(0, 0), Buffer.from(handler, 'latin1'), Buffer.alloc(13))
  const stsz = box('stsz', u32(0, sampleSize, samples))
  const stts = box('stts', u32(0, 1, samples, Math.round(1000 / 10)))
  const stsd = box('stsd', u32(0, 0))
  const stbl = box('stbl', stsd, stts, stsz)
  const edts = edit ? box('edts', box('elst', u32(0, 1, 900, edit.mediaTime, 0x10000))) : Buffer.alloc(0)
  return box('trak', edts, box('mdia', mdhd, hdlr, box('minf', stbl)))
}

function file(order, options = {}) {
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(0))
  const moov = box(
    'moov',
    track('vide', { samples: 10, sampleSize: 1000 }),
    track('soun', { samples: 10, sampleSize: 1600, edit: options.edit }),
  )
  const mdat = box('mdat', Buffer.alloc(100))
  return Buffer.concat(order === 'front' ? [ftyp, moov, mdat] : [ftyp, mdat, moov])
}

test('a file with the moov first, no edit list and audio at 128 kbps passes every Reel rule', () => {
  const info = describeMp4(file('front'))
  assert.deepEqual(info.topLevel, ['ftyp', 'moov', 'mdat'])
  assert.equal(info.moovBeforeMdat, true)
  assert.equal(info.editListBoxes, 0)
  assert.equal(info.audio.firstSampleTime, 0)
  assert.equal(Math.round(info.audio.bitrate / 1000), 128)
  assert.equal(info.video.handler, 'vide')
})

test('a moov at the end is reported', () => {
  assert.equal(describeMp4(file('end')).moovBeforeMdat, false)
})

test('an edit list is counted and shifts the first sample (media time 2112/48000 s = 44 ms at timescale 1000)', () => {
  const info = describeMp4(file('front', { edit: { mediaTime: 44 } }))
  assert.equal(info.editListBoxes, 2)
  assert.equal(info.audio.hasEditList, true)
  assert.ok(Math.abs(info.audio.firstSampleTime + 0.044) < 1e-9, String(info.audio.firstSampleTime))
})

test('a box that does not fit is an error', () => {
  const broken = file('front')
  broken.writeUInt32BE(0xffff, 0)
  assert.throws(() => parseBoxes(broken))
})
