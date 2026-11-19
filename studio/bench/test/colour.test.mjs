import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareToReference, readingOf } from '../lib/colour.mjs'

test('identical pictures have no error, and 65535 is level 255', () => {
  const actual = Uint8Array.from([0, 128, 255, 10, 20, 30])
  const reference = Uint16Array.from([0, 128 * 257, 65535, 10 * 257, 20 * 257, 30 * 257])
  const result = compareToReference(actual, reference)
  assert.equal(result.allChannels.meanAbsError, 0)
  assert.equal(result.allChannels.maxAbsError, 0)
})

test('error is per channel, in 8-bit levels, with its sign', () => {
  // One pixel: red is 2 levels too high, green 1 level too low, blue exact.
  const actual = Uint8Array.from([102, 99, 100])
  const reference = Uint16Array.from([100 * 257, 100 * 257, 100 * 257])
  const result = compareToReference(actual, reference)
  assert.ok(Math.abs(result.perChannel.red.meanAbsError - 2) < 1e-9)
  assert.ok(Math.abs(result.perChannel.green.meanSignedError + 1) < 1e-9)
  assert.equal(result.perChannel.blue.maxAbsError, 0)
  assert.ok(Math.abs(result.allChannels.meanAbsError - 1) < 1e-9)
  assert.ok(Math.abs(result.allChannels.maxAbsError - 2) < 1e-9)
})

test('the percentiles follow the distribution', () => {
  const n = 1000
  const actual = new Uint8Array(n * 3).fill(100)
  const reference = new Uint16Array(n * 3).fill(100 * 257)
  for (let i = 0; i < 10; i++) actual[i * 3] = 110 // 1% of the red samples are 10 levels off
  const result = compareToReference(actual, reference)
  assert.equal(result.perChannel.red.p99AbsError <= 10, true)
  assert.equal(result.perChannel.red.p999AbsError, 10)
  assert.equal(result.perChannel.red.maxAbsError, 10)
})

test('different sizes are refused', () => {
  assert.throws(() => compareToReference(new Uint8Array(3), new Uint16Array(6)), /size mismatch/)
})

test('a file is read by its tags; untagged HD video is read as BT.709 limited and says so', () => {
  assert.deepEqual(readingOf({ matrix: 'bt709', range: 'tv' }), {
    matrix: 'bt709',
    range: 'tv',
    assumed: false,
  })
  assert.deepEqual(readingOf({ matrix: 'smpte170m', range: 'tv' }).matrix, 'bt601')
  const untagged = readingOf({ matrix: null, range: null })
  assert.equal(untagged.matrix, 'bt709')
  assert.equal(untagged.assumed, true)
})
