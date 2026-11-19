import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encoderPlan, lastProgress, listedEncoders, pickHwaccel } from '../measurements/ceiling.mjs'

test('encoder plan per platform', () => {
  assert.deepEqual(
    encoderPlan('darwin').map((e) => e[0]),
    ['hevc_videotoolbox', 'prores_videotoolbox'],
  )
  assert.deepEqual(
    encoderPlan('win32').map((e) => e[0]),
    ['hevc_nvenc', 'av1_nvenc', 'hevc_qsv', 'hevc_amf'],
  )
  assert.deepEqual(encoderPlan('linux'), [])
  assert.ok(encoderPlan('darwin')[0][2].includes('main10'))
  assert.ok(encoderPlan('darwin')[1][2].includes('hq'))
})

test('hardware decoder choice from ffmpeg -hwaccels', () => {
  assert.equal(
    pickHwaccel('Hardware acceleration methods:\nvideotoolbox\n', 'darwin'),
    'videotoolbox',
  )
  assert.equal(pickHwaccel('Hardware acceleration methods:\ncuda\nd3d11va\nqsv\n', 'win32'), 'cuda')
  assert.equal(pickHwaccel('Hardware acceleration methods:\nd3d11va\n', 'win32'), 'd3d11va')
  assert.equal(pickHwaccel('Hardware acceleration methods:\n', 'darwin'), null)
})

test('encoders listed by ffmpeg', () => {
  const text =
    ' V....D hevc_videotoolbox    VideoToolbox H.265 Encoder (codec hevc)\n A....D aac  x\n V....D prores_videotoolbox  P\n'
  const set = listedEncoders(text)
  assert.ok(set.has('hevc_videotoolbox') && set.has('prores_videotoolbox'))
  assert.ok(!set.has('aac'))
})

test('last progress block', () => {
  const out = 'frame=10\nfps=50.0\nprogress=continue\nframe=599\nfps=61.25\nprogress=end\n'
  assert.deepEqual(lastProgress(out), { frames: 599, fps: 61.25 })
  assert.deepEqual(lastProgress(''), { frames: null, fps: null })
})
