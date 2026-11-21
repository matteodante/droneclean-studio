/**
 * What `main/index.ts` asks of Electron (review findings D3, D5, D9, C16 and the
 * GPU choice of task 8.1): run on the real module against a stand-in `electron`
 * that records the calls (`test/support/fake-electron.cjs`).
 *
 * `index.ts` reads the environment when it loads, so every scenario clears the
 * module cache and loads it again.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, test } from 'node:test'

const require = createRequire(import.meta.url)
const { install } = require('./support/fake-electron.cjs')
const outMain = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../out')

let fake = null
const touched = []

function setEnv(env) {
  for (const [name, value] of Object.entries(env)) {
    touched.push(name)
    process.env[name] = value
  }
}

afterEach(() => {
  fake?.restore()
  fake = null
  for (const name of touched.splice(0)) delete process.env[name]
})

/** Load `index.js` fresh and let its `whenReady` work run. */
async function launch({ isPackaged, env = {}, argv = [], productName }) {
  // A test that launches more than once quits the shell it launched before (its agent socket, its loader patch).
  fake?.restore()
  fake = null
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(outMain)) delete require.cache[key]
  }
  setEnv(env)
  fake = install({ isPackaged, productName })
  const savedArgv = process.argv
  process.argv = [...savedArgv, ...argv]
  try {
    require('../out/main/index.js')
  } finally {
    process.argv = savedArgv
  }
  await new Promise((resolve) => setTimeout(resolve, 150))
  return fake.state
}

test('a development run honours DRONECLEAN_DEV_URL and DRONECLEAN_USER_DATA', async () => {
  const state = await launch({
    isPackaged: false,
    env: { DRONECLEAN_DEV_URL: 'http://localhost:5173/projects', DRONECLEAN_USER_DATA: '/tmp/droneclean-dev-profile' },
  })
  assert.equal(state.loadedUrls[0], 'http://localhost:5173/projects')
  assert.equal(state.paths.userData, '/tmp/droneclean-dev-profile')
})

test('D5: a packaged app ignores DRONECLEAN_DEV_URL', async () => {
  const state = await launch({
    isPackaged: true,
    env: { DRONECLEAN_DEV_URL: 'https://evil.example/projects' },
  })
  assert.equal(state.loadedUrls[0], 'droneclean://app/projects')
})

test('D5: a packaged app ignores DRONECLEAN_USER_DATA', async () => {
  const state = await launch({
    isPackaged: true,
    env: { DRONECLEAN_USER_DATA: '/tmp/somebody-elses-profile' },
  })
  assert.notEqual(state.paths.userData, '/tmp/somebody-elses-profile')
  assert.match(state.paths.userData, /DroneClean Studio$/)
})

test('E1: the profile folder follows the product name, and the real app keeps its own', async () => {
  const real = await launch({ isPackaged: true })
  assert.match(real.paths.userData, /[\\/]DroneClean Studio$/)
  const variant = await launch({ isPackaged: true, productName: 'DroneClean Studio Test' })
  assert.match(variant.paths.userData, /[\\/]DroneClean Studio Test$/)
  const other = await launch({ isPackaged: true, productName: 'Electron' })
  assert.match(other.paths.userData, /[\\/]DroneClean Studio$/, 'any other name leaves the real profile alone')
})

test('C16: spellcheck is off in the editor window', async () => {
  const state = await launch({ isPackaged: false })
  assert.equal(state.windows[0].options.webPreferences.spellcheck, false)
})

test('D3: the shell does not answer Chromium’s restricted-path event', async () => {
  const state = await launch({ isPackaged: false })
  assert.equal(state.sessionListeners.includes('file-system-access-restricted'), false)
})

test('8.1: Chromium is asked for the high-performance GPU, before ready', async () => {
  const state = await launch({ isPackaged: false })
  assert.ok(
    state.switches.includes('force-high-performance-gpu'),
    `switches: ${JSON.stringify(state.switches)}`,
  )
})

test('D9: the agent access IPC exists before the page can be created', async () => {
  const state = await launch({ isPackaged: false })
  const { AGENT_ACCESS_CHANNELS } = require('../out/shared/agent-access.js')
  const before = new Set(state.ipcOrderAtWindowCreation)
  for (const channel of Object.values(AGENT_ACCESS_CHANNELS)) {
    assert.ok(before.has(channel), `${channel} was not registered when the window was created`)
  }
})

/** Ask the installed request handler and collect every answer it gives. */
function request(state, permission, details) {
  const answers = []
  state.permissionRequestHandler({ id: 1 }, permission, (granted) => answers.push(granted), details)
  return answers
}

test('D3 follow-up: a microphone request from the app’s own page is granted, once', async () => {
  const state = await launch({ isPackaged: true })
  const own = { requestingUrl: 'droneclean://app/projects', mediaTypes: ['audio'] }
  assert.deepEqual(request(state, 'media', own), [true])
  assert.equal(state.permissionCheckHandler({ id: 1 }, 'media', 'droneclean://app', { mediaType: 'audio' }), true)
})

test('D3 follow-up: video, audio plus video, and another origin are refused, once', async () => {
  const state = await launch({ isPackaged: true })
  assert.deepEqual(request(state, 'media', { requestingUrl: 'droneclean://app/projects', mediaTypes: ['video'] }), [false])
  assert.deepEqual(
    request(state, 'media', { requestingUrl: 'droneclean://app/projects', mediaTypes: ['audio', 'video'] }),
    [false],
  )
  assert.deepEqual(request(state, 'media', { requestingUrl: 'https://evil.example/', mediaTypes: ['audio'] }), [false])
  assert.deepEqual(request(state, 'media', { mediaTypes: ['audio'] }), [false])
})

test('D3 follow-up: every permission path answers exactly once and the file-system rules hold', async () => {
  const state = await launch({ isPackaged: true })
  const folder = { filePath: '/Users/x/ws', isDirectory: true, fileAccessType: 'writable' }
  const file = { filePath: '/Volumes/F/a.mp4', isDirectory: false, fileAccessType: 'writable' }
  assert.deepEqual(request(state, 'fileSystem', folder), [true])
  assert.deepEqual(request(state, 'fileSystem', file), [false])
  assert.deepEqual(request(state, 'clipboard-read', {}), [true])
  assert.deepEqual(request(state, 'geolocation', {}), [false])
})
