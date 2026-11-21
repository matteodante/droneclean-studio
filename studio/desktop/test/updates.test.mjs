/**
 * "A new version is available" (21 Nov 2026): the semver compare, the once-a-day rule, the switch
 * that makes no request when off, the answers that are ignored, the one link the shell opens and
 * the preload's channels held to the shared file.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  UPDATES_FILE,
  UPDATE_API_URL,
  UPDATE_CHANNELS,
  UPDATE_DAY_MS,
  compareSemver,
  isReleaseUrl,
  latestStableVersion,
  parseUpdateSettings,
  releaseUrl,
} from '../out/shared/updates.js'
import { createUpdateChecker, installUpdatesIpc } from '../out/main/updates/index.js'
import { readUpdateSettings, updateSettingsPath } from '../out/main/updates/settings.js'

const here = path.dirname(new URL(import.meta.url).pathname)
const HOUR = 60 * 60 * 1000

function profile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-updates-'))
}

function fakeFetch(answer = { tag_name: 'v0.2.0' }, ok = true) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (answer instanceof Error) throw answer
    return { ok, status: ok ? 200 : 403, json: async () => answer }
  }
  return { calls, fetch }
}

function checker(dir, fetch, appVersion = '0.1.9', clock = { t: 1_000_000_000_000 }) {
  return createUpdateChecker({ userDataDir: dir, appVersion, fetch, now: () => clock.t })
}

test('versions compare by number, not by text, and a release beats its pre-release', () => {
  assert.equal(compareSemver('0.1.10', '0.1.9'), 1)
  assert.equal(compareSemver('0.2.0', '0.10.0'), -1)
  assert.equal(compareSemver('1.0.0', 'v1.0.0'), 0)
  assert.equal(compareSemver('1.0.0', '1.0.0-beta.1'), 1)
  assert.equal(compareSemver('1.0.0-beta.2', '1.0.0-beta.10'), -1)
  assert.equal(compareSemver('1.0', '1.0.0'), null)
  assert.equal(compareSemver('latest', '1.0.0'), null)
  assert.equal(compareSemver('v2.3.4', '2.3.4'), 0)
  assert.equal(compareSemver('2.3.10', '2.3.9'), 1)
})

test('only a stable vX.Y.Z release counts', () => {
  assert.equal(latestStableVersion({ tag_name: 'v0.2.0' }), '0.2.0')
  assert.equal(latestStableVersion({ tag_name: 'v0.2.0', draft: true }), null)
  assert.equal(latestStableVersion({ tag_name: 'v0.2.0', prerelease: true }), null)
  assert.equal(latestStableVersion({ tag_name: 'v0.2.0-rc.1' }), null)
  assert.equal(latestStableVersion({ tag_name: '0.2.0' }), null)
  assert.equal(latestStableVersion({ tag_name: 'v0.2.0\nhttps://evil.example' }), null)
  assert.equal(latestStableVersion(null), null)
})

test('a newer version is found with one GET that carries a User-Agent and nothing else about the user', async () => {
  const { calls, fetch } = fakeFetch()
  const notice = await checker(profile(), fetch).check()
  assert.deepEqual(notice, { version: '0.2.0', url: 'https://github.com/matteodante/droneclean-studio/releases/tag/v0.2.0' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, UPDATE_API_URL)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Accept', 'User-Agent'])
  assert.equal(calls[0].init.headers['User-Agent'], 'DroneClean-Studio/0.1.9')
})

test('the same or an older version shows nothing', async () => {
  for (const tag of ['v0.1.9', 'v0.1.8']) {
    assert.equal(await checker(profile(), fakeFetch({ tag_name: tag }).fetch).check(), null)
  }
})

test('a second check inside a day makes no request and shows the same notice; after a day it asks again', async () => {
  const dir = profile()
  const clock = { t: 1_000_000_000_000 }
  const { calls, fetch } = fakeFetch()
  assert.equal((await checker(dir, fetch, '0.1.9', clock).check())?.version, '0.2.0')
  clock.t += 23 * HOUR
  assert.equal((await checker(dir, fetch, '0.1.9', clock).check())?.version, '0.2.0')
  assert.equal(calls.length, 1)
  clock.t += 2 * HOUR
  await checker(dir, fetch, '0.1.9', clock).check()
  assert.equal(calls.length, 2)
})

test('"Later" hides that version until the next day, and a still newer one is not hidden', async () => {
  const dir = profile()
  const clock = { t: 1_000_000_000_000 }
  const answer = { tag_name: 'v0.2.0' }
  const { fetch, calls } = fakeFetch(answer)
  const first = checker(dir, fetch, '0.1.9', clock)
  await first.check()
  first.dismiss()
  assert.equal(first.notice(), null)
  assert.equal(await checker(dir, fetch, '0.1.9', clock).check(), null)
  assert.equal(calls.length, 1)
  clock.t += UPDATE_DAY_MS + 1
  assert.equal((await checker(dir, fetch, '0.1.9', clock).check())?.version, '0.2.0')
  answer.tag_name = 'v0.3.0'
  const later = checker(dir, fetch, '0.1.9', clock)
  clock.t += UPDATE_DAY_MS + 1
  assert.equal((await later.check())?.version, '0.3.0')
})

test('with the switch off no request is made, and turning it off drops a notice already found', async () => {
  const dir = profile()
  const { calls, fetch } = fakeFetch()
  const c = checker(dir, fetch)
  assert.equal(c.enabled(), true)
  await c.check()
  assert.notEqual(c.notice(), null)
  assert.equal(c.setEnabled(false), false)
  assert.equal(c.enabled(), false)
  assert.equal(c.notice(), null)
  const other = fakeFetch()
  assert.equal(await checker(dir, other.fetch).check(), null)
  assert.equal(other.calls.length, 0)
  assert.equal(await checker(dir, fetch, '0.1.9', { t: 9_000_000_000_000 }).check(), null)
  assert.equal(calls.length, 1)
  c.setEnabled(true)
  assert.equal(c.enabled(), true)
})

test('switching off while the request is out drops its answer', async () => {
  const dir = profile()
  let c
  const fetch = async () => {
    c.setEnabled(false)
    return { ok: true, status: 200, json: async () => ({ tag_name: 'v0.2.0' }) }
  }
  c = checker(dir, fetch)
  assert.equal(await c.check(), null)
  assert.equal(readUpdateSettings(updateSettingsPath(dir)).latest, undefined)
})

test('a failure, a refusal or nonsense is silent, shows nothing and does not use up the day', async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    for (const [answer, ok] of [
      [new Error('offline'), true],
      [{ message: 'rate limited' }, false],
    ]) {
      const dir = profile()
      const { fetch } = fakeFetch(answer, ok)
      assert.equal(await checker(dir, fetch).check(), null)
      assert.equal(readUpdateSettings(updateSettingsPath(dir)).lastCheck, undefined)
    }
  } finally {
    console.warn = warn
  }
  // An answer that is not a stable release is a completed check: nothing to show, asked again tomorrow.
  const dir = profile()
  assert.equal(await checker(dir, fakeFetch('not a release').fetch).check(), null)
  assert.equal(readUpdateSettings(updateSettingsPath(dir)).lastCheck, 1_000_000_000_000)
})

test('the stored file is private and a broken one means the defaults', async () => {
  const dir = profile()
  await checker(dir, fakeFetch().fetch).check()
  const file = updateSettingsPath(dir)
  assert.equal(path.basename(file), UPDATES_FILE)
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.equal(fs.existsSync(`${file}.tmp`), false)
  for (const text of ['not json', '{"version":2,"enabled":false}', 'null']) {
    fs.writeFileSync(file, text)
    assert.deepEqual(readUpdateSettings(file), { version: 1 })
    assert.equal(checker(dir, fakeFetch().fetch).enabled(), true)
  }
  assert.deepEqual(parseUpdateSettings({ version: 1, latest: '1.0.0-beta', enabled: 'no', lastCheck: 'x' }), { version: 1 })
})

test('the shell opens only the exact release page of one stable version of this repository', () => {
  assert.equal(releaseUrl('0.2.0'), 'https://github.com/matteodante/droneclean-studio/releases/tag/v0.2.0')
  assert.equal(isReleaseUrl(releaseUrl('0.2.0')), true)
  for (const url of [
    'https://github.com/matteodante/droneclean-studio/releases',
    'https://github.com/matteodante/droneclean-studio/releases/tag/v0.2.0/',
    'https://github.com/matteodante/droneclean-studio/releases/tag/v0.2.0?x=1',
    'https://github.com/matteodante/droneclean-studio/releases/tag/v0.2.0-rc.1',
    'http://github.com/matteodante/droneclean-studio/releases/tag/v0.2.0',
    'https://github.com.evil.example/matteodante/droneclean-studio/releases/tag/v0.2.0',
    'https://github.com/other/droneclean-studio/releases/tag/v0.2.0',
    'file:///etc/passwd',
    '',
    null,
    42,
  ]) {
    assert.equal(isReleaseUrl(url), false, String(url))
  }
})

test('the IPC opens the found release page only, from the app and nowhere else, and hides it after', async () => {
  const dir = profile()
  const c = checker(dir, fakeFetch().fetch)
  const handlers = new Map()
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) }
  const opened = []
  installUpdatesIpc(ipcMain, c, (url) => opened.push(url))
  assert.deepEqual([...handlers.keys()].sort(), Object.values(UPDATE_CHANNELS).filter((n) => n !== 'updates:available').sort())

  const app = { senderFrame: { url: 'droneclean://app/index.html' } }
  const foreign = { senderFrame: { url: 'https://evil.example/' } }
  await handlers.get(UPDATE_CHANNELS.open)(app)
  assert.deepEqual(opened, [], 'nothing found yet, nothing to open')
  await c.check()
  assert.throws(() => handlers.get(UPDATE_CHANNELS.open)(foreign), /refused/)
  assert.throws(() => handlers.get(UPDATE_CHANNELS.setEnabled)(foreign, false), /refused/)
  assert.deepEqual(opened, [])
  assert.deepEqual(handlers.get(UPDATE_CHANNELS.notice)(app), { version: '0.2.0', url: releaseUrl('0.2.0') })
  await handlers.get(UPDATE_CHANNELS.open)(app, 'https://evil.example/ignored')
  assert.deepEqual(opened, [releaseUrl('0.2.0')])
  assert.equal(handlers.get(UPDATE_CHANNELS.notice)(app), null)
  assert.equal(handlers.get(UPDATE_CHANNELS.setEnabled)(app, 'yes'), false, 'only a real true turns it on')
  assert.equal(handlers.get(UPDATE_CHANNELS.enabled)(app), false)
})

test('the preload writes out the same channels as the shared file', () => {
  const preload = fs.readFileSync(path.join(here, '..', 'src', 'preload', 'updates.ts'), 'utf8')
  const block = /const CHANNELS = \{([^}]*)\}/.exec(preload)?.[1] ?? ''
  const written = Object.fromEntries([...block.matchAll(/(\w+): '([^']+)'/g)].map((m) => [m[1], m[2]]))
  assert.deepEqual(written, UPDATE_CHANNELS)
})

test('the main process asks only when installed, and the shell has no other GitHub request', () => {
  const index = fs.readFileSync(path.join(here, '..', 'src', 'main', 'index.ts'), 'utf8')
  assert.match(index, /app\.isPackaged && !STARTED_FOR_MCP && APP_NAME !== TEST_APP_NAME\) scheduleUpdateCheck/)
})
