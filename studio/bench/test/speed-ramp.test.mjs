// The speed-ramp measurement's analysis: what an export shows against the source frames the curve predicts.
// Synthetic pictures stand in for a decode: a frame the export repeats, skips or shows one frame off must be
// reported as such, and an export that follows the prediction exactly must be reported as exact.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  matchAroundPrediction,
  summariseSpeedRamp,
  RAMP_KEYS,
  RAMP_SOURCE_FRAMES,
} from '../measurements/speed-ramp.mjs'
import { noisy, randomFrames } from './helpers.mjs'

const SIZE = 400

/** What an export that plays the prediction exactly holds: one picture per output frame. */
function render(source, shown) {
  return shown.map((sourceFrame, k) => noisy(source[sourceFrame], 3, 100 + k))
}

test('an export that follows the prediction is exact', () => {
  const source = randomFrames(40, SIZE)
  // 1x, 2x, then a repeat: the shapes a ramp and a slower-than-project clip produce.
  const predicted = [0, 1, 2, 3, 5, 7, 9, 11, 12, 12, 13, 14]
  const output = render(source, predicted)
  const compared = matchAroundPrediction(source, output, predicted)
  assert.deepEqual(compared.matched, predicted)
  const summary = summariseSpeedRamp(predicted, compared.matched, {
    ambiguousOutputFrames: compared.ambiguousOutputFrames,
  })
  assert.equal(summary.maxFrameDistance, 0)
  assert.equal(summary.predictionExact, true)
  assert.equal(summary.everyPredictedFrameShownInOrder, true)
  assert.equal(summary.matched.repeats, 1)
  assert.equal(summary.predicted.repeats, 1)
  assert.equal(summary.skippedBeyondPrediction, 0)
  assert.equal(summary.shortOfPrediction, 0)
})

test('a source frame the export skips beyond the prediction is found', () => {
  const source = randomFrames(40, SIZE)
  const predicted = [0, 2, 4, 6, 8, 10]
  // Frame 4 is never shown: the export jumps from 2 to 6.
  const shown = [0, 2, 6, 8, 10, 12]
  const compared = matchAroundPrediction(source, render(source, shown), predicted)
  assert.deepEqual(compared.matched, shown)
  const summary = summariseSpeedRamp(predicted, compared.matched)
  assert.equal(summary.skippedBeyondPrediction, 1)
  assert.equal(summary.predictedSourceFramesMissing, 1)
  assert.equal(summary.everyPredictedFrameShownInOrder, false)
})

test('a source frame shown twice where the curve does not repeat it is found', () => {
  const source = randomFrames(40, SIZE)
  const predicted = [0, 2, 4, 6, 8]
  const shown = [0, 2, 4, 4, 6]
  const compared = matchAroundPrediction(source, render(source, shown), predicted)
  const summary = summariseSpeedRamp(predicted, compared.matched)
  assert.equal(summary.shortOfPrediction, 1)
  assert.equal(summary.matched.repeats, 1)
  assert.equal(summary.outOfOrderFrames, 0)
})

test('a frame shown one source frame off is within the tolerance but named', () => {
  const source = randomFrames(40, SIZE)
  const predicted = [10, 12, 14, 16]
  const shown = [10, 13, 14, 17]
  const compared = matchAroundPrediction(source, render(source, shown), predicted)
  const summary = summariseSpeedRamp(predicted, compared.matched)
  assert.equal(summary.maxFrameDistance, 1)
  assert.equal(summary.aheadOfPredictionFrames, 2)
  assert.equal(summary.behindPredictionFrames, 0)
  assert.equal(summary.everyPredictedFrameShownInOrder, false)
  assert.deepEqual(
    summary.worstMatches.map((entry) => [entry.outputFrame, entry.distance]),
    [
      [1, 1],
      [3, 1],
    ],
  )
})

test('a still scene is reported as ambiguous rather than trusted', () => {
  const still = randomFrames(1, SIZE)[0]
  const source = Array.from({ length: 20 }, (_, i) => noisy(still, 1, i))
  const predicted = [2, 3, 4, 5, 6, 7]
  const output = predicted.map((_, i) => noisy(still, 1, 200 + i))
  const compared = matchAroundPrediction(source, output, predicted)
  assert.equal(compared.ambiguousOutputFrames.length, predicted.length)
  const summary = summariseSpeedRamp(predicted, compared.matched, {
    ambiguousOutputFrames: compared.ambiguousOutputFrames,
  })
  assert.equal(summary.ambiguousMatches, predicted.length)
  assert.equal(
    summary.worstMatches.every((entry) => entry.matchWasAmbiguous),
    true,
  )
})

test('a prediction and an export of different lengths are refused', () => {
  const source = randomFrames(10, SIZE)
  assert.throws(
    () => matchAroundPrediction(source, render(source, [0, 1]).slice(0, 1), [0, 1]),
    /1 frames but 2 were predicted/,
  )
})

test('the design’s ramp predicts 2,310 source frames over its 600 output frames', () => {
  // The same arithmetic the page runs, on the constant part: 4x held for 540 frames, plus the
  // two 30-frame ramps that integrate to 75 and 45 speed-frames over 30 frames.
  assert.equal(RAMP_KEYS.at(-1).frame, 600)
  assert.deepEqual(
    RAMP_KEYS.map((key) => key.speed),
    [1, 4, 4, 1],
  )
  assert.equal(RAMP_SOURCE_FRAMES, 75 + 540 * 4 + 75)
})
