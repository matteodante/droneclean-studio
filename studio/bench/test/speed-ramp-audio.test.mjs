// The speed-ramp sound measurement's analysis: beeps, flashes, the curve's own arithmetic, and the verdict on sync.
// Synthetic signals stand in for an export: a track that follows the curve must be judged in step, and a track whose
// sound is late by more than a frame must be judged out of step.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectBeeps, detectFlashes, judgeSync } from '../measurements/speed-ramp-audio.mjs'
import { curveArea, frameAtArea, shownSourceFrame } from '../measurements/ramp-support.mjs'

const RATE = 48000
const FRAME = 1001 / 60000
const KEYS = [
  { frame: 0, speed: 1 },
  { frame: 30, speed: 4 },
  { frame: 570, speed: 4 },
  { frame: 600, speed: 1 },
]

/** A click track as an export of `keys` would carry it: beeps of `tone` Hz played at the curve's local speed. */
function renderTrack(keys, seconds, { delaySeconds = 0, tone = 500 } = {}) {
  const samples = new Float32Array(Math.round(seconds * RATE))
  const sourcePerOutputSecond = (t) => {
    const frame = t / FRAME
    return (curveArea(keys, frame + 1e-3) - curveArea(keys, frame - 1e-3)) / 2e-3 / FRAME
  }
  let sourceSeconds = 0
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE - delaySeconds
    if (t < 0) continue
    const sourceFrames = curveArea(keys, t / FRAME)
    const phase = (2 * Math.PI * tone * sourceFrames * FRAME)
    const inBeep = sourceFrames % 30 < 8
    samples[i] = inBeep ? 0.8 * Math.sin(phase) : 0
    sourceSeconds = sourcePerOutputSecond(t)
  }
  return { samples, sourceSeconds }
}

/** The per-frame mean grey of a picture track: a flash on every frame that shows a flash source frame. */
function renderFlashes(keys, frames) {
  const means = []
  const times = []
  for (let n = 0; n < frames; n++) {
    means.push(shownSourceFrame(keys, n) % 30 < 8 ? 235 : 16)
    times.push(n * FRAME)
  }
  return { means, times }
}

test('the curve arithmetic integrates and inverts', () => {
  assert.equal(curveArea(KEYS, 0), 0)
  assert.equal(curveArea(KEYS, 30), 75)
  assert.equal(curveArea(KEYS, 570), 75 + 2160)
  assert.equal(curveArea(KEYS, 600), 2310)
  assert.equal(curveArea(KEYS, 610), 2310 + 10)
  for (const area of [1, 30, 75, 76.5, 1000, 2300]) {
    assert.ok(Math.abs(curveArea(KEYS, frameAtArea(KEYS, area)) - area) < 1e-9)
  }
  assert.equal(shownSourceFrame(KEYS, 100), 75 + 70 * 4)
})

test('beeps are found with their onset and their frequency', () => {
  const { samples } = renderTrack([{ frame: 0, speed: 1 }, { frame: 600, speed: 1 }], 3)
  const beeps = detectBeeps(samples)
  assert.equal(beeps.length, 6)
  assert.ok(Math.abs(beeps[1].onset - 30 * FRAME) < 0.001)
  assert.ok(Math.abs(beeps[1].hz - 500) < 5)
})

test('a track that follows the curve is in step, the pitch follows the speed', () => {
  const { samples } = renderTrack(KEYS, 10)
  const beeps = detectBeeps(samples)
  const flashes = detectFlashes(...Object.values(renderFlashes(KEYS, 599)))
  const judged = judgeSync(beeps, flashes, KEYS)
  assert.ok(judged.paired >= 18, `paired ${judged.paired}`)
  assert.equal(judged.withinOneFrame, true)
  assert.ok(judged.worstDeviationMs < FRAME * 1000, `deviation ${judged.worstDeviationMs}`)
  const inHold = judged.rows.filter((row) => row.expectedHz > 1900)
  assert.ok(inHold.length > 5)
  for (const row of inHold) assert.ok(Math.abs(row.hzRatio - 1) < 0.05, `hold beep ${row.beep}: ${row.hzRatio}`)
})

test('sound that arrives two frames late is out of step', () => {
  const { samples } = renderTrack(KEYS, 10, { delaySeconds: 2 * FRAME })
  const judged = judgeSync(
    detectBeeps(samples),
    detectFlashes(...Object.values(renderFlashes(KEYS, 599))),
    KEYS,
  )
  assert.equal(judged.withinOneFrame, false)
  assert.ok(judged.worstDeviationMs > 30)
  // a constant lag is a median, not a drift
  assert.ok(Math.abs(judged.medianDeviationMs + 2 * FRAME * 1000) < 2, `median ${judged.medianDeviationMs}`)
  assert.ok(judged.jitterAroundMedianMs < 2, `jitter ${judged.jitterAroundMedianMs}`)
})

test('a flash is counted once however many frames it lasts', () => {
  const flashes = detectFlashes([0, 255, 255, 255, 0, 0, 255, 0], [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(flashes, [{ frame: 1, time: 1 }, { frame: 6, time: 6 }])
})
