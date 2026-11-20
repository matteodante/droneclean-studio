// The motion-blur measurements' analysis: the linear-light reference, the verdicts and the frame-time summary.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LinearMean,
  comparePictures,
  compareToLinearMean,
  linearToSrgb,
  srgbToLinear,
  summariseFrameTimes,
} from '../page/blur.ts'
import { judgeDecodes, judgeProof } from '../measurements/motion-blur.mjs'
import { keeps5994, summarisePaused } from '../measurements/motion-blur-preview.mjs'

/** An RGBA frame of unorm16 values, one grey code (0..1) for every pixel. */
const grey = (pixels, code) => new Uint16Array(pixels * 4).fill(Math.round(code * 65535))

test('the transfer round-trips', () => {
  for (const v of [0, 0.001, 0.2, 0.5, 0.9, 1])
    assert.ok(Math.abs(linearToSrgb(srgbToLinear(v)) - v) < 1e-9)
})

test('a blur that is the linear-light mean of black and white is within a level, one in code values is not', () => {
  const white = grey(4, 1)
  const black = grey(4, 0)
  const mean = new LinearMean(4)
  mean.add(white, 0.5)
  mean.add(black, 0.5)
  const right = grey(4, linearToSrgb(0.5))
  assert.ok(compareToLinearMean(right, mean, 2).maxDiffLevels < 0.01)
  const wrong = compareToLinearMean(grey(4, 0.5), mean, 2)
  assert.ok(wrong.maxDiffLevels > 100, `code-value blend is ${wrong.maxDiffLevels} levels off`)
  assert.equal(wrong.over1Level, wrong.channels)
  assert.equal(wrong.maxAt.channel, 'r')
})

test('the comparison names where the largest difference is', () => {
  const mean = new LinearMean(6)
  mean.add(grey(6, 0.5), 1)
  const frame = grey(6, 0.5)
  frame[4 * 4 + 2] += 200 // pixel 4 (x 1, y 1 of width 3), blue
  const c = compareToLinearMean(frame, mean, 3)
  assert.deepEqual([c.maxAt.x, c.maxAt.y, c.maxAt.channel], [1, 1, 'b'])
  assert.ok(Math.abs(c.maxDiffLevels - (200 / 65535) * 1023) < 0.01)
  assert.equal(c.over1Level, 1)
})

test('a frame of another size cannot join the mean', () => {
  assert.throws(() => new LinearMean(4).add(grey(3, 0), 1), RangeError)
})

test('decodes: each frame once passes; a repeat or a missing frame is named', () => {
  assert.equal(
    judgeDecodes({ calls: 10, distinctTimestamps: 10, keyChunks: 1 }, 10).everyFrameOnce,
    true,
  )
  const repeated = judgeDecodes({ calls: 14, distinctTimestamps: 10, keyChunks: 2 }, 10)
  assert.equal(repeated.everyFrameOnce, false)
  assert.match(repeated.problems[0], /more than once/)
  assert.equal(
    judgeDecodes({ calls: 8, distinctTimestamps: 8, keyChunks: 1 }, 10).everyFrameOnce,
    false,
  )
})

test('proof: a second render must be identical; the distance from the frame blend is reported', () => {
  const frame = (n, repeat, mean) => ({ outputFrame: n, repeatMaxDiffLevels: repeat, meanDiffLevels: mean, maxDiffLevels: 4 * mean, samples: [], weightSum: 1 })
  const good = judgeProof([frame(0, 0, 3), frame(1, 0, 5)])
  assert.equal(good.repeatsExactly, true)
  assert.equal(good.differenceFromFrameBlend.meanLevels, 4)
  assert.equal(good.differenceFromFrameBlend.maxLevels, 20)
  const bad = judgeProof([frame(0, 0, 3), frame(7, 0.02, 3)])
  assert.equal(bad.repeatsExactly, false)
  assert.match(bad.problems[0], /frame 7/)
})

test('frame times: the rate is the mean, the tail and the misses are counted', () => {
  const times = [...Array(98).fill(10), 30, 40]
  const s = summariseFrameTimes(times)
  assert.equal(s.overBudget, 2)
  assert.equal(s.maxMs, 40)
  assert.ok(Math.abs(s.fps - 1000 / 10.5) < 1e-9)
  assert.equal(keeps5994({ meanMs: 10, p99Ms: 30 }).keeps, true)
  assert.equal(keeps5994({ meanMs: 20, p99Ms: 30 }).keeps, false)
  assert.equal(keeps5994({ meanMs: 10, p99Ms: 50 }).keeps, false)
  assert.equal(summarisePaused([{ frame: 1, seekMs: 5, redrawMs: [1, 2, 3] }]).medianRedrawMs, 2)
})

test('two pictures: identical or not, byte for byte', () => {
  const a = new Uint8ClampedArray([1, 2, 3, 4])
  assert.equal(comparePictures(a, a.slice()).identical, true)
  const d = comparePictures(a, new Uint8ClampedArray([1, 2, 9, 4]))
  assert.deepEqual([d.differing, d.maxDiff], [1, 6])
})
