/**
 * The microphone's system permission (main/microphone.ts): macOS is asked when undecided, a refusal is
 * reported as such, and every path answers (a voice-over must never wait for ever on a prompt).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MICROPHONE_CHANNELS } from '../out/shared/microphone.js'
import { requestMicrophoneAccess } from '../out/main/microphone.js'

function source(status, { ask = true, askThrows = false } = {}) {
  const calls = { ask: 0 }
  return {
    calls,
    getMediaAccessStatus: () => status,
    askForMediaAccess: async () => {
      calls.ask += 1
      if (askThrows) throw new Error('no')
      return ask
    },
  }
}

test('an undecided microphone is asked for, and the answer is reported', async () => {
  const allowed = source('not-determined', { ask: true })
  assert.equal(await requestMicrophoneAccess(allowed, 'darwin'), 'granted')
  assert.equal(allowed.calls.ask, 1)
  const refused = source('not-determined', { ask: false })
  assert.equal(await requestMicrophoneAccess(refused, 'darwin'), 'denied')
})

test('a decided microphone is not asked again', async () => {
  for (const status of ['granted', 'denied', 'restricted']) {
    const s = source(status)
    assert.equal(await requestMicrophoneAccess(s, 'darwin'), status)
    assert.equal(s.calls.ask, 0, status)
  }
})

test('a failed ask reports the status macOS holds', async () => {
  assert.equal(await requestMicrophoneAccess(source('not-determined', { askThrows: true }), 'darwin'), 'not-determined')
})

test('a status Electron adds later is unknown, and other systems have no switch', async () => {
  assert.equal(await requestMicrophoneAccess(source('something-new'), 'darwin'), 'unknown')
  const s = source('denied')
  assert.equal(await requestMicrophoneAccess(s, 'linux'), 'granted')
  assert.equal(s.calls.ask, 0)
})

test('the preload writes the same channel name as the shared file, and exposes the bridge member', () => {
  const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
  assert.ok(preload.includes(`request: '${MICROPHONE_CHANNELS.request}'`))
  assert.ok(preload.includes('  microphone,\n}'))
})

test('the packaged app declares why it wants the microphone', () => {
  const config = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  assert.match(config, /extendInfo:\s*\n\s+NSMicrophoneUsageDescription: \S/)
})
