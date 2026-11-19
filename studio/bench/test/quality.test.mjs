import assert from 'node:assert/strict'
import { test } from 'node:test'
import { complementOf, dropExpression, parsePsnr, parseSsim } from '../lib/quality.mjs'

test('the select expression drops exactly the listed frames', () => {
  assert.equal(dropExpression([]), null)
  assert.equal(dropExpression([3, 7]), 'not(eq(n\\,3)+eq(n\\,7))')
})

test('the complement of the kept frames', () => {
  assert.deepEqual(complementOf([0, 1, 3], 5), [2, 4])
})

test('FFmpeg summary lines are read', () => {
  const psnr = parsePsnr(
    'noise\n[Parsed_psnr_5 @ 0x1] PSNR y:42.5 u:48.1 v:49.2 average:43.9 min:41.0 max:inf',
  )
  assert.equal(psnr.y, 42.5)
  assert.equal(psnr.average, 43.9)
  assert.equal(psnr.max, Infinity)
  const ssim = parseSsim(
    '[Parsed_ssim_6 @ 0x1] SSIM Y:0.981 (17.2 dB) U:0.99 (20 dB) V:0.994 (22 dB) All:0.985 (18 dB)',
  )
  assert.deepEqual(ssim, { y: 0.981, u: 0.99, v: 0.994, all: 0.985 })
  assert.equal(parsePsnr('nothing'), null)
})
