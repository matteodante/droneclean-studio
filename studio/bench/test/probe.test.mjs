import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bitDepthOfPixelFormat, describeSpacing } from '../lib/probe.mjs'

test('bit depth from the pixel format name', () => {
  assert.equal(bitDepthOfPixelFormat('yuv420p'), 8)
  assert.equal(bitDepthOfPixelFormat('yuv420p10le'), 10)
  assert.equal(bitDepthOfPixelFormat('p010le'), 10)
  assert.equal(bitDepthOfPixelFormat('yuv422p12le'), 12)
  assert.equal(bitDepthOfPixelFormat('gray10le'), 10)
  assert.equal(bitDepthOfPixelFormat('rgb24'), 8)
  assert.equal(bitDepthOfPixelFormat(undefined), null)
})

test('equal gaps are evenly spaced, in any order', () => {
  const result = describeSpacing([3, 0, 1, 2, 4], '1/60')
  assert.equal(result.evenlySpaced, true)
  assert.equal(result.distinctGapCount, 1)
})

test('one tick of rounding still counts as even, two different gaps do not', () => {
  assert.equal(describeSpacing([0, 961, 1921, 2882], '1/57600').evenlySpaced, true)
  assert.equal(describeSpacing([0, 1, 2, 5, 6], '1/60').evenlySpaced, false)
})

test('a repeated timestamp is counted', () => {
  assert.equal(describeSpacing([0, 1, 1, 2], '1/60').duplicateTimestamps, 1)
})
