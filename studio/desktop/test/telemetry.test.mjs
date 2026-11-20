/**
 * The opt-in crash reports and usage statistics of the desktop shell (20 Nov 2026): the answer's
 * file, the main process's reports, the preload and the MCP launcher. Nothing is sent while a half
 * is off or never answered; the copies of the addresses and the channels stay one value.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { TELEMETRY_CHANNELS, TELEMETRY_DESTINATIONS, TELEMETRY_FILE } from '../out/shared/telemetry.js'
import { createMainTelemetry } from '../out/main/telemetry/index.js'
import { errorEvent, parseStack, scrubText } from '../out/main/telemetry/report.js'
import { readTelemetrySettings, telemetrySettingsPath, writeTelemetryChoice } from '../out/main/telemetry/settings.js'
import {
  LAUNCHER_TELEMETRY,
  crashReportsOn,
  launcherCrashRequest,
  reportLauncherCrash,
  scrubLauncherText,
} from '../../mcp/launcher.mjs'

const here = path.dirname(new URL(import.meta.url).pathname)
const studio = path.resolve(here, '..', '..')
const { sentryDsn: SENTRY_DSN, posthogKey: POSTHOG_KEY } = TELEMETRY_DESTINATIONS
const CONTEXT = { version: '9.9.9', platform: 'darwin' }

function profile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-telemetry-'))
}

function fakeFetch() {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    return {}
  }
  return { calls, fetch }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

test('a profile with no answer, or a broken one, reads as never answered', () => {
  const dir = profile()
  const file = telemetrySettingsPath(dir)
  assert.equal(path.basename(file), TELEMETRY_FILE)
  assert.equal(readTelemetrySettings(file), null)
  for (const text of ['not json', '{"version":2,"crashReports":true}', 'null']) {
    fs.writeFileSync(file, text)
    assert.equal(readTelemetrySettings(file), null)
  }
})

test('an answer is merged, written whole with mode 0600, and the id lives only with usage statistics', () => {
  const dir = profile()
  const file = telemetrySettingsPath(dir)
  assert.deepEqual(writeTelemetryChoice(file, { crashReports: true, usageStats: false }), {
    version: 1,
    crashReports: true,
    usageStats: false,
  })
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  const on = writeTelemetryChoice(file, { usageStats: true })
  assert.equal(on.crashReports, true)
  assert.match(on.installId, /^[0-9a-f-]{36}$/)
  assert.equal(writeTelemetryChoice(file, { crashReports: false }).installId, on.installId)
  assert.deepEqual(writeTelemetryChoice(file, { usageStats: false }), {
    version: 1,
    crashReports: false,
    usageStats: false,
  })
  assert.equal(fs.existsSync(`${file}.tmp`), false)
})

test('the main process sends nothing while the answer is missing or no', async () => {
  const dir = profile()
  const { calls, fetch } = fakeFetch()
  const telemetry = createMainTelemetry({ userDataDir: dir, context: CONTEXT, fetch })
  telemetry.reportError(new Error('boom'), 'main:uncaught')
  telemetry.reportProcessGone('GPU', 'crashed', 1)
  telemetry.agentConnected()
  telemetry.choose({ crashReports: false, usageStats: false })
  telemetry.reportError(new Error('boom'), 'main:uncaught')
  telemetry.agentConnected()
  await settle()
  assert.deepEqual(calls, [])
})

test('with crash reports on, an error leaves as one scrubbed Sentry envelope; a clean exit is not a crash', async () => {
  const dir = profile()
  const { calls, fetch } = fakeFetch()
  const telemetry = createMainTelemetry({ userDataDir: dir, context: CONTEXT, fetch })
  telemetry.choose({ crashReports: true })
  telemetry.reportError(new Error('Could not read /Users/ann/Avata 2/DJI_0001.MP4'), 'main:uncaught')
  telemetry.reportProcessGone('renderer', 'clean-exit', 0)
  telemetry.reportProcessGone('GPU', 'crashed', 5)
  await settle()
  assert.equal(calls.length, 2)
  const [project] = SENTRY_DSN.match(/\/(\d+)$/).slice(1)
  for (const call of calls) {
    assert.ok(call.url.includes(`/api/${project}/envelope/?sentry_key=`), call.url)
    assert.equal(call.init.headers['Content-Type'], 'application/x-sentry-envelope')
  }
  const event = JSON.parse(calls[0].init.body.split('\n')[2])
  assert.equal(event.exception.values[0].value, 'Could not read <path>')
  assert.equal(event.release, 'droneclean-studio@9.9.9')
  assert.equal(event.sdk.settings.infer_ip, 'never')
  assert.equal(event.user, undefined)
  assert.ok(!calls[0].init.body.includes('/Users/'), 'no path leaves the computer')
  const gone = JSON.parse(calls[1].init.body.split('\n')[2])
  assert.equal(gone.tags.process, 'GPU')
  assert.equal(gone.tags.reason, 'crashed')
})

test('mcp_connected waits for a PostHog project and usage statistics, and is sent once per launch', async () => {
  const dir = profile()
  const { calls, fetch } = fakeFetch()
  const telemetry = createMainTelemetry({ userDataDir: dir, context: CONTEXT, fetch })
  telemetry.choose({ usageStats: true })
  telemetry.agentConnected()
  telemetry.agentConnected()
  await settle()
  assert.equal(calls.length, POSTHOG_KEY === '' ? 0 : 1)
})

test('stack frames name the app’s own files from inside the app, and nothing above it', () => {
  const error = new Error('x')
  error.stack = [
    'Error: x',
    '    at load (/Applications/DroneClean Studio.app/Contents/Resources/app.asar/out/main/index.js:10:5)',
    '    at /Users/ann/Library/whatever/lib.js:3:1',
    '    at node:internal/process/task_queues:95:5',
  ].join('\n')
  const frames = parseStack(error.stack)
  assert.deepEqual(
    frames.map((frame) => frame.filename),
    ['node:internal/process/task_queues', 'lib.js', 'app:///out/main/index.js'],
  )
  assert.equal(frames.at(-1).in_app, true)
  assert.equal(errorEvent(error, 'test', CONTEXT).exception.values[0].stacktrace.frames.length, 3)
})

test('the preload carries both channels with the main process’s names and loads nothing but electron', () => {
  const preload = fs.readFileSync(path.resolve(here, '..', 'out', 'preload', 'telemetry.js'), 'utf8')
  for (const name of ['get', 'set']) assert.ok(preload.includes(`'${TELEMETRY_CHANNELS[name]}'`), name)
  const required = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(required)], ['electron'])
  assert.match(preload, /exposeInMainWorld\('dronecleanTelemetry'/)
})

test('the page, the main process and the launcher name one Sentry project, one PostHog key and one file', () => {
  const config = fs.readFileSync(path.join(studio, 'src', 'studio', 'telemetry', 'config.ts'), 'utf8')
  const pageDsn = config.match(/SENTRY_DSN: string =\s*'([^']*)'/)?.[1]
  const pageKey = config.match(/POSTHOG_KEY: string = '([^']*)'/)?.[1]
  assert.equal(pageDsn, SENTRY_DSN)
  assert.equal(pageKey, POSTHOG_KEY)
  assert.equal(LAUNCHER_TELEMETRY.sentryDsn, SENTRY_DSN)
  assert.equal(LAUNCHER_TELEMETRY.settingsFileName, TELEMETRY_FILE)
})

const SCRUB_SAMPLES = [
  'ENOENT: /Volumes/SSD/Avata 2 - 15 novembre 2026/DJI_0001.MP4 missing',
  'failed on "DJI_20261115124704_0020_D.MP4"',
  'C:\\Users\\Ann Lee\\Videos\\clip.mov is busy',
  'at file:///home/ann/x.js',
  'TypeError: undefined is not a function',
]

test('the main process and the launcher scrub the same way', () => {
  for (const sample of SCRUB_SAMPLES) assert.equal(scrubLauncherText(sample), scrubText(sample), sample)
  assert.equal(scrubText(SCRUB_SAMPLES[0]), 'ENOENT: <path> missing')
  assert.equal(scrubText(SCRUB_SAMPLES[2]), '<path> is busy')
})

test('the launcher reports only when the app’s answer says yes, and never throws', async () => {
  const dir = profile()
  const { calls, fetch } = fakeFetch()
  assert.equal(crashReportsOn(dir), false)
  assert.equal(await reportLauncherCrash(new Error('boom'), dir, fetch), false)
  fs.writeFileSync(path.join(dir, TELEMETRY_FILE), JSON.stringify({ version: 1, crashReports: false }))
  assert.equal(await reportLauncherCrash(new Error('boom'), dir, fetch), false)
  assert.equal(calls.length, 0)
  fs.writeFileSync(path.join(dir, TELEMETRY_FILE), JSON.stringify({ version: 1, crashReports: true }))
  assert.equal(await reportLauncherCrash(new Error('open /Users/ann/x.mov'), dir, fetch), true)
  assert.equal(calls.length, 1)
  assert.ok(!calls[0].init.body.includes('/Users/'))
  assert.equal(
    await reportLauncherCrash(new Error('boom'), dir, async () => {
      throw new Error('offline')
    }),
    false,
  )
  assert.ok(launcherCrashRequest(new Error('x')).url.startsWith('https://'))
})
