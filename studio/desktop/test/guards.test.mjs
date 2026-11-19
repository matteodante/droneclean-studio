/**
 * The small pure guards of the shell: who may call the IPC (`sender.ts`), which
 * variables a launch obeys (`launch-env.ts`), which paths FFmpeg never gets
 * (`media/path-guard.ts`) and the per-window decode accounting
 * (`media/window-jobs.ts`, findings R6, R7, D5, D9).
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { resolveLaunchEnvironment } from '../out/main/launch-env.js'
import { isUncPath } from '../out/main/media/path-guard.js'
import { IDLE_MS, WindowJobs } from '../out/main/media/window-jobs.js'
import { appOnly, appOnlySend, isAppUrl } from '../out/main/sender.js'

test('only the app’s own pages are the app', () => {
  assert.equal(isAppUrl('droneclean://app/projects', null), true)
  assert.equal(isAppUrl('droneclean://app/', null), true)
  assert.equal(isAppUrl('droneclean://other/projects', null), false)
  assert.equal(isAppUrl('https://app/', null), false)
  assert.equal(isAppUrl('https://evil.example/', null), false)
  assert.equal(isAppUrl('', null), false)
  assert.equal(isAppUrl(undefined, null), false)
  // In a development run the dev server is the app, and the scheme is not.
  assert.equal(isAppUrl('http://localhost:5173/projects', 'http://localhost:5173/projects'), true)
  assert.equal(isAppUrl('http://localhost:5174/', 'http://localhost:5173/projects'), false)
  assert.equal(isAppUrl('droneclean://app/projects', 'http://localhost:5173/projects'), false)
})

test('appOnly rejects a foreign or missing frame, appOnlySend ignores it', () => {
  const calls = []
  const handle = appOnly((_event, value) => calls.push(value))
  handle({ senderFrame: { url: 'droneclean://app/x' } }, 1)
  assert.throws(() => handle({ senderFrame: { url: 'https://evil.example/' } }, 2), /only answers the app/)
  assert.throws(() => handle({ senderFrame: null }, 3), /only answers the app/)
  assert.throws(() => handle({}, 4), /only answers the app/)
  const send = appOnlySend((_event, value) => calls.push(value))
  send({ senderFrame: { url: 'droneclean://app/x' } }, 5)
  send({ senderFrame: { url: 'https://evil.example/' } }, 6)
  assert.deepEqual(calls, [1, 5])
})

test('a packaged launch obeys none of the development variables', () => {
  const env = {
    DRONECLEAN_DEV_URL: 'http://localhost:5173/',
    DRONECLEAN_USER_DATA: '/tmp/profile',
    DRONECLEAN_FFMPEG: '/tmp/ffmpeg',
  }
  assert.deepEqual(resolveLaunchEnvironment(env, true), {
    devUrl: null,
    userData: null,
    allowFfmpegOverride: false,
  })
  assert.deepEqual(resolveLaunchEnvironment(env, false), {
    devUrl: 'http://localhost:5173/',
    userData: '/tmp/profile',
    allowFfmpegOverride: true,
  })
  assert.deepEqual(resolveLaunchEnvironment({ DRONECLEAN_DEV_URL: '' }, false).devUrl, null)
})

test('UNC and device paths are refused on Windows only', () => {
  for (const file of ['\\\\server\\share\\a.mp4', '//server/share/a.mp4', '\\\\?\\C:\\a.mp4', '\\\\.\\pipe\\x']) {
    assert.equal(isUncPath(file, 'win32'), true, file)
    assert.equal(isUncPath(file, 'darwin'), false, file)
  }
  assert.equal(isUncPath('C:\\Footage\\a.mp4', 'win32'), false)
  assert.equal(isUncPath('/Volumes/Footage/a.mp4', 'darwin'), false)
})

function windowOf(id) {
  return Object.assign(new EventEmitter(), { id })
}

test('R6: a job nobody reads from for 30 s is cancelled, one being read is not', () => {
  let clock = 0
  const cancelled = []
  const tracker = new WindowJobs({ cancel: (id) => cancelled.push(id), now: () => clock })
  const window = windowOf(1)
  tracker.admit(window, 'idle')
  tracker.admit(window, 'busy')
  tracker.readStarted('busy')
  clock = IDLE_MS - 1
  tracker.sweep()
  assert.deepEqual(cancelled, [])
  clock = IDLE_MS + 1
  tracker.sweep()
  assert.deepEqual(cancelled, ['idle'], 'a read in flight is not idle')
  tracker.readFinished('busy')
  clock += IDLE_MS - 1
  tracker.sweep()
  assert.deepEqual(cancelled, ['idle'], 'the finished read counts as activity')
  clock += 2
  tracker.sweep()
  assert.deepEqual(cancelled, ['idle', 'busy'])
  assert.equal(tracker.size, 0)
})

test('R6: two jobs per window, a release frees a place, windows are independent', () => {
  const tracker = new WindowJobs({ cancel: () => {} })
  const one = windowOf(1)
  tracker.admit(one, 'a')
  tracker.admit(one, 'b')
  assert.throws(() => tracker.admit(one, 'c'), /at most 2/)
  tracker.release('a')
  tracker.admit(one, 'c')
  tracker.admit(windowOf(2), 'd')
})

test('R6: navigation, a renderer crash and destruction cancel the window’s jobs', () => {
  const cancelled = []
  const tracker = new WindowJobs({ cancel: (id) => cancelled.push(id) })
  const window = windowOf(1)
  tracker.admit(window, 'a')
  window.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
  window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  assert.deepEqual(cancelled, [])
  window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  assert.deepEqual(cancelled, ['a'])
  tracker.admit(window, 'b')
  window.emit('render-process-gone', {}, { reason: 'crashed' })
  tracker.admit(window, 'c')
  window.emit('destroyed')
  assert.deepEqual(cancelled, ['a', 'b', 'c'])
})
