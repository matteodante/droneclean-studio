import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distinctLevelsPerRow, summariseCounts } from '../lib/levels.mjs'

test('distinct levels are counted per row', () => {
  const samples = Uint16Array.from([1, 1, 2, 3, 5, 5, 5, 5])
  assert.deepEqual(distinctLevelsPerRow(samples, 4, 2), [3, 1])
})

test('a ramp with 877 steps counts 877', () => {
  const width = 3840
  const row = Uint16Array.from({ length: width }, (_, x) => 64 + (Math.floor(x / 4) % 877))
  assert.deepEqual(distinctLevelsPerRow(row, width, 1), [877])
})

test('summary of the counts', () => {
  assert.deepEqual(summariseCounts([5, 1, 3]), { min: 1, median: 3, max: 5, rows: 3 })
})
