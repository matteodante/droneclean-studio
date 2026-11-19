// The stabilized speed-ramp measurement's verdicts: which source frames the stabilization host was asked for, and
// whether the kernel parameters it answered are Gyroflow's reference ones.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { judgeKernelAgainstReference, judgeLookups, judgeSameData } from '../measurements/speed-ramp-stabilized.mjs'

test('every predicted frame looked up, the others being lookahead, is accepted', () => {
  const judged = judgeLookups([0, 1, 3, 3, 7], [0, 1, 2, 3, 4, 7, 9], 2)
  assert.equal(judged.everyPredictedFrameLookedUp, true)
  assert.equal(judged.onlyPredictedFramesAndTheirLookahead, true)
  assert.equal(judged.lookedUpButNotPredicted, 3)
})

test('a predicted frame never looked up, and one far from any predicted frame, are found', () => {
  const judged = judgeLookups([0, 2, 40], [0, 3, 5, 40], 2)
  assert.equal(judged.everyPredictedFrameLookedUp, false)
  assert.deepEqual(judged.firstMissing, [2])
  assert.equal(judged.onlyPredictedFramesAndTheirLookahead, false)
  assert.deepEqual(judged.firstUnexplained, [5])
})

const REFERENCE = [
  { frame: 0, matrices_sha256: 'aa', kernel_params_bytes: 8, kernel_params_sha256: 'bb' },
  { frame: 1000, matrices_sha256: 'cc', kernel_params_bytes: 8, kernel_params_sha256: 'dd' },
]

test('kernel parameters equal to the reference match, a different hash or length does not', () => {
  const same = judgeKernelAgainstReference(
    [{ frame: 0, matricesSha256: 'aa', kernelParamsBytes: 8, kernelParamsSha256: 'bb' }],
    REFERENCE,
  )
  assert.equal(same.allMatch, true)
  const other = judgeKernelAgainstReference(
    [
      { frame: 0, matricesSha256: 'aa', kernelParamsBytes: 8, kernelParamsSha256: 'bb' },
      { frame: 1000, matricesSha256: 'cc', kernelParamsBytes: 8, kernelParamsSha256: 'XX' },
    ],
    REFERENCE,
  )
  assert.equal(other.allMatch, false)
  assert.equal(other.frames[1].kernelParamsMatch, false)
  assert.equal(other.frames[1].matricesMatch, true)
  assert.equal(judgeKernelAgainstReference([], REFERENCE).allMatch, false)
})

test('the same source frame must give the same data in the ramp and in the plain export', () => {
  const a = { frame: 5, matricesSha256: 'm5', kernelParamsSha256: 'k5' }
  const b = { frame: 9, matricesSha256: 'm9', kernelParamsSha256: 'k9' }
  assert.equal(judgeSameData([a, b], [{ ...b }, { ...a }]).same, true)
  const changed = judgeSameData([a, b], [a, { ...b, kernelParamsSha256: 'other' }])
  assert.equal(changed.same, false)
  assert.deepEqual(changed.differentFrames, [9])
  assert.equal(judgeSameData([a], [b]).same, false)
})
