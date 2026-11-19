import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  alignedSelections,
  matchFrames,
  nearDuplicateOutputFrames,
  summariseMatches,
} from '../lib/align.mjs'
import { noisy, randomFrames } from './helpers.mjs'

const SIZE = 400

test('an output that shows every source frame once is reported as exact', () => {
  const source = randomFrames(60, SIZE)
  const output = source.map((f, i) => noisy(f, 3, i))
  const { matches } = matchFrames(source, output)
  assert.deepEqual(
    matches,
    source.map((_, i) => i),
  )
  const summary = summariseMatches(matches, source.length)
  assert.equal(summary.everySourceFrameExactlyOnceInOrder, true)
  assert.equal(summary.repeatedFrames, 0)
  assert.equal(summary.skippedSourceFrames, 0)
})

test('a repeated frame is found, with its position', () => {
  const source = randomFrames(60, SIZE)
  const shown = [...Array(30).keys(), 29, ...Array.from({ length: 30 }, (_, i) => 30 + i)]
  const output = shown.map((j, i) => noisy(source[j], 3, i))
  const summary = summariseMatches(matchFrames(source, output).matches, source.length)
  assert.equal(summary.repeatedFrames, 1)
  assert.deepEqual(summary.repeated, [{ outputFrame: 30, sourceFrame: 29 }])
  assert.equal(summary.skippedSourceFrames, 0)
  assert.equal(summary.outputFrames, 61)
  assert.equal(summary.everySourceFrameExactlyOnceInOrder, false)
})

test('a dropped source frame is found', () => {
  const source = randomFrames(60, SIZE)
  const shown = [...Array(60).keys()].filter((j) => j !== 20)
  const output = shown.map((j, i) => noisy(source[j], 3, i))
  const summary = summariseMatches(matchFrames(source, output).matches, source.length)
  assert.equal(summary.skippedSourceFrames, 1)
  assert.deepEqual(summary.skipped, [20])
  assert.equal(summary.repeatedFrames, 0)
})

test('frames out of order and a missing tail are reported', () => {
  const source = randomFrames(40, SIZE)
  const shown = [...Array(20).keys(), 19 - 1, ...Array.from({ length: 5 }, (_, i) => 21 + i)]
  const output = shown.map((j, i) => noisy(source[j], 2, i))
  const summary = summariseMatches(matchFrames(source, output).matches, source.length)
  assert.equal(summary.outOfOrderFrames >= 1, true)
  assert.equal(summary.sourceFramesMissingAtEnd, 40 - 1 - 25)
})

test('a static scene is flagged as ambiguous rather than trusted', () => {
  const still = randomFrames(1, SIZE)[0]
  const source = Array.from({ length: 20 }, (_, i) => noisy(still, 1, i))
  // The export is the same still plus its own encoder noise: no source frame is closer than the others.
  const output = source.map((_, i) => noisy(still, 1, 100 + i))
  assert.equal(matchFrames(source, output).ambiguousOutputFrames.length > 5, true)
})

test('after a jump the search recovers over the whole source', () => {
  const source = randomFrames(80, SIZE)
  const shown = [
    ...Array.from({ length: 30 }, (_, i) => i),
    ...Array.from({ length: 30 }, (_, i) => 50 + i),
  ]
  const output = shown.map((j, i) => noisy(source[j], 2, i))
  const { matches } = matchFrames(source, output)
  assert.deepEqual(matches, shown)
})

test('alignment keeps the first showing of each source frame', () => {
  const { keepOutput, keepSource } = alignedSelections([0, 1, 1, 2, 3], 5)
  assert.deepEqual(keepOutput, [0, 1, 3, 4])
  assert.deepEqual(keepSource, [0, 1, 2, 3])
})

test('the second opinion finds a frame that is a copy of the one before it', () => {
  const frames = randomFrames(10, SIZE)
  const output = [...frames.slice(0, 5), noisy(frames[4], 1), ...frames.slice(5)]
  const result = nearDuplicateOutputFrames(output)
  assert.deepEqual(result.outputFrames, [5])
})
