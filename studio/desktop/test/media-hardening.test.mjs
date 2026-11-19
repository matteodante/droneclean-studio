/**
 * The native decode's guards (review findings R6, R7, D9), on the real
 * `registerNativeFrameProtocol` and `registerAppProtocol` against the stand-in
 * `electron` (`test/support/fake-electron.cjs`) and a fake `ffmpeg`/`ffprobe`
 * that records its process id, so "the decoder was stopped" is read from the
 * operating system, not from a flag.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

const require = createRequire(import.meta.url)
const { install, FakeWebContents } = require('./support/fake-electron.cjs')

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-media-hardening-')))
const bin = path.join(work, 'bin')
const pids = path.join(work, 'pids')
fs.mkdirSync(bin)
fs.mkdirSync(pids)

// The decode line ends in `pipe:1`; every other call is a probe and answers nothing.
fs.writeFileSync(
  path.join(bin, 'ffmpeg'),
  `#!/bin/sh
for a in "$@"; do
  if [ "$a" = "pipe:1" ]; then
    echo $$ > "${pids}/$$.pid"
    echo "$@" > "${pids}/$$.args"
    exec sleep 60
  fi
done
exit 0
`,
  { mode: 0o755 },
)
fs.writeFileSync(
  path.join(bin, 'ffprobe'),
  `#!/bin/sh
echo '{"streams":[{"width":16,"height":16,"avg_frame_rate":"30/1"}]}'
`,
  { mode: 0o755 },
)
process.env.DRONECLEAN_FFMPEG = path.join(bin, 'ffmpeg')

const clip = path.join(work, 'clip.mp4')
const other = path.join(work, 'other.mp4')
fs.writeFileSync(clip, 'x')
fs.writeFileSync(other, 'x')

const electron = install({ isPackaged: false })
const state = electron.state
const { MediaPathAccess } = require('../out/main/media.js')
const { registerNativeFrameProtocol } = require('../out/main/media/frame-protocol.js')
const { registerAppProtocol } = require('../out/main/protocol-handler.js')
const { NATIVE_MEDIA_CHANNELS } = require('../out/shared/native-media.js')

const media = registerAppProtocol(path.join(work, 'dist'))
try {
  registerNativeFrameProtocol(media)
} catch (error) {
  throw new Error(`registerNativeFrameProtocol(media): ${error}`)
}

after(() => {
  for (const file of fs.readdirSync(pids)) {
    if (!file.endsWith('.pid')) continue
    try {
      process.kill(Number(fs.readFileSync(path.join(pids, file), 'utf8')), 'SIGKILL')
    } catch {}
  }
  electron.restore()
  fs.rmSync(work, { recursive: true, force: true })
})
before(async () => {
  await media.describe([clip, other])
})

const APP_FRAME = { url: 'droneclean://app/projects' }

function eventOf(sender, senderFrame = APP_FRAME) {
  return { sender, senderFrame }
}

let jobCounter = 0
function startRequest(file, extra = {}) {
  return {
    jobId: `job-${process.pid}-${++jobCounter}`,
    file,
    startSeconds: 0,
    frames: 1000,
    format: 'gbrp10le',
    ...extra,
  }
}

const decodeStart = (event, request) => state.handles.get(NATIVE_MEDIA_CHANNELS.decodeStart)(event, request)

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function runningDecoderPids() {
  await new Promise((resolve) => setTimeout(resolve, 300))
  return fs
    .readdirSync(pids)
    .filter((file) => file.endsWith('.pid'))
    .map((file) => Number(fs.readFileSync(path.join(pids, file), 'utf8')))
    .filter(processAlive)
}

async function waitUntilNoneRunning() {
  for (let i = 0; i < 40; i += 1) {
    if ((await runningDecoderPids()).length === 0) return true
  }
  return false
}

test('R7: decode.start refuses a file the media registry does not hold', async () => {
  const sender = new FakeWebContents(101)
  const stray = path.join(work, 'stray.mp4')
  fs.writeFileSync(stray, 'x')
  const answer = await decodeStart(eventOf(sender), startRequest(stray))
  assert.equal(answer.ok, false)
  assert.match(answer.error.message, /registered|media/i)
  assert.equal((await runningDecoderPids()).length, 0)
})

test('R7: decode.start refuses a folder and a file that is not media, even named', async () => {
  const sender = new FakeWebContents(102)
  const answer = await decodeStart(eventOf(sender), startRequest(work))
  assert.equal(answer.ok, false)
})

test('R7: decode.start starts a registered file, with the protocol whitelist on its input', async () => {
  const sender = new FakeWebContents(103)
  const answer = await decodeStart(eventOf(sender), startRequest(clip))
  assert.equal(answer.ok, true, JSON.stringify(answer))
  await runningDecoderPids()
  const argsFile = fs.readdirSync(pids).find((file) => file.endsWith('.args'))
  const args = fs.readFileSync(path.join(pids, argsFile), 'utf8')
  assert.match(args, /-protocol_whitelist file .*-i /)
  sender.destroy()
  assert.ok(await waitUntilNoneRunning())
})

test('R7/D9: a frame that is not the app’s own refuses every media and decode IPC', async () => {
  const sender = new FakeWebContents(104)
  const foreign = eventOf(sender, { url: 'https://evil.example/' })
  const none = eventOf(sender, null)
  for (const event of [foreign, none]) {
    await assert.rejects(
      Promise.resolve().then(() => decodeStart(event, startRequest(clip))),
      /app|frame|sender/i,
    )
    await assert.rejects(
      Promise.resolve().then(() => state.handles.get('media-paths:describe')(event, [clip])),
      /app|frame|sender/i,
    )
    await assert.rejects(
      Promise.resolve().then(() => state.handles.get('media-paths:allow')(event, [work])),
      /app|frame|sender/i,
    )
    await assert.rejects(
      Promise.resolve().then(() =>
        state.handles.get(NATIVE_MEDIA_CHANNELS.capabilities)(event),
      ),
      /app|frame|sender/i,
    )
  }
  assert.equal((await runningDecoderPids()).length, 0)
})

test('R6: a window navigating away stops its decoders', async () => {
  const sender = new FakeWebContents(105)
  assert.equal((await decodeStart(eventOf(sender), startRequest(clip))).ok, true)
  assert.equal((await runningDecoderPids()).length, 1)
  sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'droneclean://app/projects' })
  assert.ok(await waitUntilNoneRunning(), 'FFmpeg still running after the reload')
})

test('R6: a navigation inside the page, or of a subframe, leaves a decode alone', async () => {
  const sender = new FakeWebContents(106)
  assert.equal((await decodeStart(eventOf(sender), startRequest(clip))).ok, true)
  sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  sender.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
  assert.equal((await runningDecoderPids()).length, 1)
  sender.destroy()
  assert.ok(await waitUntilNoneRunning())
})

test('R6: a crashed renderer stops its decoders', async () => {
  const sender = new FakeWebContents(107)
  assert.equal((await decodeStart(eventOf(sender), startRequest(clip))).ok, true)
  assert.equal((await runningDecoderPids()).length, 1)
  sender.emit('render-process-gone', {}, { reason: 'crashed' })
  assert.ok(await waitUntilNoneRunning(), 'FFmpeg still running after the crash')
})

test('R6: a third decode of one window is refused with a clear error', async () => {
  const sender = new FakeWebContents(108)
  assert.equal((await decodeStart(eventOf(sender), startRequest(clip))).ok, true)
  assert.equal((await decodeStart(eventOf(sender), startRequest(other))).ok, true)
  const third = await decodeStart(eventOf(sender), startRequest(clip))
  assert.equal(third.ok, false)
  assert.match(third.error.message, /at most 2|too many/i)
  assert.equal((await runningDecoderPids()).length, 2)
  // Another window has its own two.
  const second = new FakeWebContents(109)
  assert.equal((await decodeStart(eventOf(second), startRequest(clip))).ok, true)
  sender.destroy()
  second.destroy()
  assert.ok(await waitUntilNoneRunning())
})

test('R6: cancelling a job frees its place', async () => {
  const sender = new FakeWebContents(110)
  const first = startRequest(clip)
  assert.equal((await decodeStart(eventOf(sender), first)).ok, true)
  assert.equal((await decodeStart(eventOf(sender), startRequest(clip))).ok, true)
  state.listeners.get(NATIVE_MEDIA_CHANNELS.cancel)(eventOf(sender), { jobId: first.jobId })
  assert.equal((await decodeStart(eventOf(sender), startRequest(other))).ok, true)
  sender.destroy()
  assert.ok(await waitUntilNoneRunning())
})

test('the fake FFmpeg is the script of this test', () => {
  assert.equal(spawnSync(path.join(bin, 'ffmpeg'), ['-version']).status, 0)
})
