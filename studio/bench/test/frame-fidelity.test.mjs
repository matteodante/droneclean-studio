// What the frame-fidelity record says about the design's "done when" (design 1.5, section 4.5).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkDoneWhen } from '../measurements/frame-fidelity.mjs'

/** The facts the design expects of the 20 s cut of clip 0020 at 59.94. */
function expectedFacts(overrides = {}) {
  return {
    sourceFrames: 1199,
    outputFrames: 1199,
    repeatedFrames: 0,
    skippedSourceFrames: 0,
    everySourceFrameExactlyOnceInOrder: true,
    timestamps: {
      timeBase: '1/60000',
      distinctGapsInTicks: [{ gap: 1001, count: 1198 }],
    },
    declaredFrameRate: '60000/1001',
    ...overrides,
  }
}

test("the design's expected numbers hold", () => {
  assert.deepEqual(checkDoneWhen(expectedFacts()), { holds: true, problems: [] })
})

test("the old 60 fps project's record says why it fails", () => {
  // The numbers of the 18 Nov 2026 baseline: 1,200 output frames, two repeats, a 1/60 clock, 60/1 declared.
  const verdict = checkDoneWhen({
    sourceFrames: 1199,
    outputFrames: 1200,
    repeatedFrames: 2,
    skippedSourceFrames: 0,
    everySourceFrameExactlyOnceInOrder: false,
    timestamps: { timeBase: '1/60', distinctGapsInTicks: [{ gap: 1, count: 1199 }] },
    declaredFrameRate: '60/1',
  })
  assert.equal(verdict.holds, false)
  assert.equal(verdict.problems.length, 6)
  const said = verdict.problems.join('\n')
  assert.match(said, /outputFrames 1200 is not sourceFrames 1199/)
  assert.match(said, /repeatedFrames is 2/)
  assert.match(said, /timeBase is 1\/60/)
  assert.match(said, /tick gaps are \[\{"gap":1,"count":1199\}\]/)
  assert.match(said, /declaredFrameRate is 60\/1/)
})

test('the right count on a 1/2997 clock still fails', () => {
  // The decimal 59.94 reaches mediabunny as 1/2997 with 50 ticks per frame: a different rate by 1 ppm.
  const verdict = checkDoneWhen(
    expectedFacts({
      timestamps: { timeBase: '1/2997', distinctGapsInTicks: [{ gap: 50, count: 1198 }] },
    }),
  )
  assert.equal(verdict.holds, false)
  assert.equal(verdict.problems.length, 2)
})

test('gaps that do not cover every pair of frames fail', () => {
  const verdict = checkDoneWhen(
    expectedFacts({
      timestamps: { timeBase: '1/60000', distinctGapsInTicks: [{ gap: 1001, count: 1197 }] },
    }),
  )
  assert.equal(verdict.holds, false)
  assert.equal(verdict.problems.length, 1)
  assert.match(verdict.problems[0], /not 1198 of 1,001/)
})

test('a record with nothing to read does not throw', () => {
  const verdict = checkDoneWhen({})
  assert.equal(verdict.holds, false)
  assert.equal(verdict.problems.length, 7)
})
