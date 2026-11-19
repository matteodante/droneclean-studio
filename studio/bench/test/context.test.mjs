// The spec of one export: which project rate the kit asks for, and which scenario switches smart copy off.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROJECT_FPS, exportSpec } from '../lib/context.mjs'

const config = { customBitrate: 120_000_000 }
const ctx = {
  config,
  segment: async (seconds) => ({ file: `/cache/segment_${seconds}s.mp4`, frames: 1199 }),
  ramp: async () => ({ file: '/cache/ramp.mp4' }),
}

test("the kit's project rate is the exact 59.94 fraction, not the decimal", () => {
  assert.equal(PROJECT_FPS, 60000 / 1001)
  assert.notEqual(PROJECT_FPS, 59.94)
  assert.equal(Math.round(PROJECT_FPS * 1001), 60000)
})

test('the segment exports run in a 59.94 project', async () => {
  const auto = await exportSpec(ctx, { id: 'segment-auto-10s', what: 'segment', kind: 'auto', seconds: 10 })
  assert.equal(auto.project.fps, PROJECT_FPS)
  assert.equal(auto.mediaFile, '/cache/segment_10s.mp4')
  assert.equal(auto.forceRender, true)
  assert.equal(auto.settings.smartCopy, true)
})

test('only the untouched-clip run switches smart copy off, and only it skips the nudge', async () => {
  const copy = await exportSpec(ctx, {
    id: 'segment-copy-path-auto-10s',
    what: 'segment-copy-path',
    kind: 'auto',
    seconds: 10,
  })
  assert.equal(copy.project.fps, PROJECT_FPS)
  assert.equal(copy.forceRender, false)
  assert.equal(copy.settings.smartCopy, false)
  // The rest of the dialog's settings are the ones a pilot picked.
  assert.equal(copy.settings.codec, 'h265')
  assert.equal(copy.settings.videoContainer, 'mp4')
})

test('a custom-bitrate run carries the bitrate, and the ramp keeps its 30 fps project', async () => {
  const custom = await exportSpec(ctx, { id: 'x', what: 'segment', kind: 'custom', seconds: 10 })
  assert.equal(custom.settings.rateControl, 'variable')
  assert.equal(custom.settings.videoBitrate, config.customBitrate)

  const ramp = await exportSpec(ctx, { id: 'ramp', what: 'ramp', kind: 'auto' })
  assert.equal(ramp.project.fps, 30)
  assert.equal(ramp.mediaFile, '/cache/ramp.mp4')
})
