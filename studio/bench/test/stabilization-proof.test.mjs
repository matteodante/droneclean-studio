// The verdicts of the stabilization proofs (task 6.4): what counts as a motion-cache hit, as a match with Gyroflow's
// reference, and as controls that change the picture and undo to it.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { judgeSteps } from '../measurements/stabilization-controls.mjs'
import { judgeKernelParameters, judgeMotionCache } from '../measurements/stabilized-export.mjs'

test('a motion-cache hit is an open that read nothing from the file', () => {
  assert.equal(judgeMotionCache([{ kind: 'ready', bytesRead: 0 }]).hit, true)
  const miss = judgeMotionCache([{ kind: 'ready', bytesRead: 1_896_500_750 }])
  assert.equal(miss.hit, false)
  assert.match(miss.problems[0], /1896500750 bytes/)
  assert.equal(judgeMotionCache([]).hit, false, 'no open seen is no proof')
})

test('the kernel parameters match only when every frame matches in all three hashes', () => {
  const frame = { frame: 0, matricesMatch: true, kernelParamsMatch: true, kernelParamsBytesMatch: true }
  assert.equal(judgeKernelParameters([frame, { ...frame, frame: 1 }]).allMatch, true)
  const bad = judgeKernelParameters([frame, { ...frame, frame: 1000, kernelParamsMatch: false }])
  assert.equal(bad.allMatch, false)
  assert.match(bad.problems[0], /frame 1000: kernel parameters differ/)
  assert.equal(judgeKernelParameters([]).allMatch, false)
})

test('the controls verdict names a step that did not change the picture, or did not undo to it', () => {
  const step = (name, hash, expect, than, undoDepth, expectedUndoDepth = undoDepth) => ({
    step: name,
    hash,
    expect,
    than,
    undoDepth,
    expectedUndoDepth,
  })
  const good = [
    step('plain', 'a', null, null, 0),
    step('on', 'b', 'differs', 'plain', 1),
    step('undo to plain', 'a', 'equals', 'plain', 0),
  ]
  assert.deepEqual(judgeSteps(good), { ok: true, problems: [] })
  const same = judgeSteps([good[0], step('on', 'a', 'differs', 'plain', 1)])
  assert.equal(same.ok, false)
  assert.match(same.problems[0], /did not change/)
  const notBack = judgeSteps([good[0], good[1], step('undo to plain', 'c', 'equals', 'plain', 0)])
  assert.match(notBack.problems[0], /not the one of plain/)
  const depth = judgeSteps([step('plain', 'a', null, null, 1, 0)])
  assert.match(depth.problems[0], /1 undo steps, expected 0/)
})
