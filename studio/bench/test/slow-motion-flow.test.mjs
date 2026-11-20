import assert from 'node:assert/strict'
import test from 'node:test'
import { flowCost } from '../measurements/slow-motion-flow.mjs'

test('the flow’s cost over the blend, per output frame and per interpolated frame', () => {
  const cost = flowCost({ wallSeconds: 6, frames: 240 }, { wallSeconds: 7.2, frames: 240 }, 120)
  assert.deepEqual(cost, {
    extraSeconds: 1.2,
    flowOverBlendWallTime: 1.2,
    extraMsPerOutputFrame: 5,
    extraMsPerInterpolatedFrame: 10,
  })
})
