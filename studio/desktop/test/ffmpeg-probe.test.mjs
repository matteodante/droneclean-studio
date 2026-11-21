/**
 * Review finding F11: a probe that found no usable FFmpeg is not remembered, and an installed app's message does not
 * point at `DRONECLEAN_FFMPEG`, which it ignores. Own file: the module's caches are per process.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import {
  configureFfmpegOverride,
  ffmpegCapabilities,
  ffmpegLocation,
  missingFfmpegMessage,
} from '../out/main/media/ffmpeg.js'

const whereIsFfmpeg = () => {
  try {
    return path.dirname(execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' }).split('\n')[0].trim())
  } catch {
    return null
  }
}

test('F11: the installed app\'s message does not mention the environment variable', () => {
  assert.doesNotMatch(missingFfmpegMessage(false), /DRONECLEAN_FFMPEG/)
  assert.match(missingFfmpegMessage(false), /reinstall/)
  assert.match(missingFfmpegMessage(true), /DRONECLEAN_FFMPEG/)
})

test('F11: a failed probe is asked again, and a missing binary is looked for again', async (t) => {
  const directory = whereIsFfmpeg()
  if (directory === null) return t.skip('no ffmpeg on this machine')
  const savedPath = process.env.PATH
  const savedResources = process.resourcesPath
  configureFfmpegOverride(false)
  try {
    process.env.PATH = ''
    process.resourcesPath = undefined
    assert.equal(ffmpegLocation(), null)
    const first = await ffmpegCapabilities()
    assert.equal(first.available, false)
    assert.doesNotMatch(first.message ?? '', /DRONECLEAN_FFMPEG/)

    process.env.PATH = directory
    assert.notEqual(ffmpegLocation(), null, 'the binary is found once it is there')
    const second = await ffmpegCapabilities()
    assert.equal(second.available, true, 'the earlier failure was not kept')
  } finally {
    process.env.PATH = savedPath
    process.resourcesPath = savedResources
    configureFfmpegOverride(true)
  }
})
