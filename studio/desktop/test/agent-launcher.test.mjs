/**
 * The stdio launcher (task 2.2, design §4.1 and §4.9).
 *
 * A real launcher process is started for every case: a fake `net` server from
 * `studio/mcp/fixture.mjs` plays the app on the per-user socket, and a small
 * generated executable plays the app binary when the launcher has to start it.
 * No Electron and no real MCP client are involved.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as fixture from '../../mcp/fixture.mjs'
import * as launcher from '../../mcp/launcher.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LAUNCHER = path.resolve(HERE, '..', '..', 'mcp', 'launcher.mjs')
const FIXTURE_URL = pathToFileURL(path.resolve(HERE, '..', '..', 'mcp', 'fixture.mjs')).href

function tempHome() {
  // Short on purpose: a unix socket path is limited to about 100 bytes on
  // macOS, and the real `~/Library/Application Support/DroneClean Studio/` is
  // shorter than the test runner's `os.tmpdir()` prefix.
  return fs.mkdtempSync('/tmp/dc-launcher-')
}

function layoutFor(home) {
  const userDataDir = launcher.userDataDirFor(process.platform, { ...process.env, HOME: home }, home)
  return {
    userDataDir,
    socketPath: launcher.socketPathFor(userDataDir, process.platform),
    settingsPath: launcher.settingsPathFor(userDataDir),
  }
}

function enableAccess(layout) {
  fs.mkdirSync(layout.userDataDir, { recursive: true })
  fs.writeFileSync(layout.settingsPath, JSON.stringify(fixture.SETTINGS_ON))
}

function startLauncher(home, env = {}) {
  const child = spawn(process.execPath, [LAUNCHER], {
    env: { ...process.env, HOME: home, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  return {
    child,
    exited,
    getStdout: () => stdout,
    getStderr: () => stderr,
  }
}

/** Resolve the stdout lines seen so far, waiting until there are `count`. */
async function waitForLines(process_, count, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const lines = process_
      .getStdout()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line))
    if (lines.length >= count) return lines
    if (Date.now() >= deadline) {
      throw new Error(
        `launcher printed ${lines.length} lines, expected ${count}; stderr: ${process_.getStderr()}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function disableAccess(layout) {
  fs.mkdirSync(layout.userDataDir, { recursive: true })
  fs.writeFileSync(layout.settingsPath, JSON.stringify(fixture.SETTINGS_OFF))
}

test('off: the launcher says so, starts nothing and exits 1', async () => {
  const home = tempHome()
  const layout = layoutFor(home)
  disableAccess(layout)
  const process_ = startLauncher(home, {
    DRONECLEAN_APP_BINARY: path.join(home, 'does-not-exist'),
  })
  try {
    const { code } = await process_.exited
    assert.equal(code, 1)
    assert.equal(process_.getStdout(), '')
    assert.match(process_.getStderr(), /agent access is off/i)
    assert.equal(fs.existsSync(layout.socketPath), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('on by default: with no settings file the launcher goes on to start the app', async () => {
  const home = tempHome()
  const binary = path.join(home, 'missing-app-binary')
  const process_ = startLauncher(home, { DRONECLEAN_APP_BINARY: binary })
  try {
    const { code } = await process_.exited
    assert.equal(code, 2, 'past the setting, to the missing app')
    assert.doesNotMatch(process_.getStderr(), /agent access is off/i)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('reached through a symlinked folder, the launcher still runs (it used to exit 0 without a word)', async () => {
  const home = tempHome()
  disableAccess(layoutFor(home))
  const linked = path.join(home, 'linked-mcp')
  fs.symlinkSync(path.dirname(LAUNCHER), linked, 'dir')
  const child = spawn(process.execPath, [path.join(linked, 'launcher.mjs')], {
    env: { ...process.env, HOME: home, DRONECLEAN_APP_BINARY: path.join(home, 'does-not-exist') },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  try {
    const code = await new Promise((resolve) => child.once('exit', resolve))
    assert.equal(code, 1)
    assert.match(stderr, /agent access is off/i)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('isEntryScript compares real paths, and a missing argv is not the entry', () => {
  const url = pathToFileURL(fs.realpathSync(LAUNCHER)).href
  assert.equal(launcher.isEntryScript(LAUNCHER, url), true)
  assert.equal(launcher.isEntryScript(undefined, url), false)
  assert.equal(launcher.isEntryScript(path.join(path.dirname(LAUNCHER), 'fixture.mjs'), url), false)
})

test('an app that is not installed exits 2 with the path', async () => {
  const home = tempHome()
  const layout = layoutFor(home)
  enableAccess(layout)
  const binary = path.join(home, 'missing-app-binary')
  const process_ = startLauncher(home, { DRONECLEAN_APP_BINARY: binary })
  try {
    const { code } = await process_.exited
    assert.equal(code, 2)
    assert.match(process_.getStderr(), /was not found/)
    assert.ok(process_.getStderr().includes(binary))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('the round trip pipes stdin/stdout to the socket and exits 0 when stdin ends', async () => {
  const home = tempHome()
  const layout = layoutFor(home)
  enableAccess(layout)
  const server = await fixture.createFakeSocketServer(layout.socketPath)
  const process_ = startLauncher(home)
  try {
    let received = 0
    for (const entry of fixture.SESSION) {
      process_.child.stdin.write(`${JSON.stringify(entry.request)}\n`)
      if (entry.response === null) continue
      const lines = await waitForLines(process_, received + 1)
      assert.deepEqual(lines[received], entry.response)
      received += 1
    }
    assert.equal(received, 3)

    process_.child.stdin.end()
    const { code } = await process_.exited
    assert.equal(code, 0)
    assert.equal(process_.getStderr(), '')
  } finally {
    process_.child.kill()
    await server.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('with the app closed it starts it with --mcp, without ELECTRON_RUN_AS_NODE, then connects', async () => {
  const home = tempHome()
  const layout = layoutFor(home)
  enableAccess(layout)
  const record = path.join(home, 'fake-app.json')
  const pidFile = path.join(home, 'fake-app.pid')
  const binary = path.join(home, 'fake-app')
  fs.writeFileSync(
    binary,
    `#!/usr/bin/env node
import fs from 'node:fs'
import { createFakeSocketServer } from ${JSON.stringify(FIXTURE_URL)}
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({
  argv: process.argv.slice(2),
  electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
}))
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
await createFakeSocketServer(${JSON.stringify(layout.socketPath)})
`,
    { mode: 0o755 },
  )

  // The launcher is started the way the wrapper starts it: under the app's own
  // binary in Node mode. The app it spawns must not inherit that variable.
  const process_ = startLauncher(home, {
    DRONECLEAN_APP_BINARY: binary,
    ELECTRON_RUN_AS_NODE: '1',
  })
  let pid = null
  try {
    process_.child.stdin.write(`${JSON.stringify(fixture.INITIALIZE_REQUEST)}\n`)
    const lines = await waitForLines(process_, 1, 10_000)
    assert.equal(lines[0].result.serverInfo.name, fixture.CONSTANTS.serverName)
    assert.deepEqual(JSON.parse(fs.readFileSync(record, 'utf8')), {
      argv: ['--mcp'],
      electronRunAsNode: null,
    })
    pid = Number(fs.readFileSync(pidFile, 'utf8'))
    assert.ok(Number.isInteger(pid) && pid > 0)

    process_.child.stdin.end()
    const { code } = await process_.exited
    assert.equal(code, 0)
  } finally {
    process_.child.kill()
    if (pid !== null) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // The fake app already went away.
      }
    }
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('the launcher’s start flag is the one the app reads', () => {
  const main = fs.readFileSync(path.resolve(HERE, '..', 'src', 'main', 'index.ts'), 'utf8')
  const flag = /MCP_LAUNCH_FLAG = '([^']+)'/.exec(main)
  assert.ok(flag, 'main/index.ts names the MCP launch flag')
  assert.equal(flag[1], '--mcp')
})

test('DRONECLEAN_USER_DATA names the profile, and with it the socket', async () => {
  assert.equal(
    launcher.userDataDirFor(
      'darwin',
      { DRONECLEAN_USER_DATA: '/tmp/droneclean-throwaway', HOME: '/Users/example' },
      '/Users/example',
    ),
    '/tmp/droneclean-throwaway',
  )

  const home = tempHome()
  const profile = path.join(home, 'profile')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'agent-access.json'), JSON.stringify(fixture.SETTINGS_ON))
  const socketPath = path.join(profile, 'mcp.sock')
  const server = await fixture.createFakeSocketServer(socketPath)
  const process_ = startLauncher(home, { DRONECLEAN_USER_DATA: profile })
  try {
    process_.child.stdin.write(`${JSON.stringify(fixture.INITIALIZE_REQUEST)}\n`)
    const lines = await waitForLines(process_, 1)
    assert.equal(lines[0].result.serverInfo.name, fixture.CONSTANTS.serverName)
    process_.child.stdin.end()
    const { code } = await process_.exited
    assert.equal(code, 0)
  } finally {
    process_.child.kill()
    await server.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

const WRAPPER = path.resolve(HERE, '..', '..', 'mcp', 'droneclean-mcp')

test(
  'the wrapper is executable and runs the launcher under the app binary in Node mode',
  { skip: process.platform === 'win32' },
  () => {
    assert.equal(fs.statSync(WRAPPER).mode & 0o777, 0o755)
    const text = fs.readFileSync(WRAPPER, 'utf8')
    assert.match(text, /ELECTRON_RUN_AS_NODE=1 exec/)
    assert.match(text, /DRONECLEAN_APP_BINARY/)
  },
)

test(
  'the wrapper refuses a missing app binary with exit 2 and a message',
  { skip: process.platform === 'win32' },
  async () => {
    const home = tempHome()
    try {
      const child = spawn(WRAPPER, [], {
        env: { ...process.env, DRONECLEAN_APP_BINARY: path.join(home, 'gone') },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8')
      })
      const code = await new Promise((resolve) => child.once('exit', resolve))
      assert.equal(code, 2)
      assert.match(stderr, /app binary was not found/)
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  },
)
