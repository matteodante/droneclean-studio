/**
 * The review's findings on the MCP server (docs/reviews/2026-11-18-findings.md,
 * D6 user gesture, D7, D8, D9 log retention, and the startup wait).
 *
 * Every case is the failing test written first: it fails on the code the review
 * read and passes on the fix.
 *
 * The page is a `node:vm` context behind a `BrowserWindow`-shaped object, so the
 * real bridge (`createPageBridge`) and the real `run` script run end to end
 * without Electron.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import * as launcher from '../../mcp/launcher.mjs'
import * as protocol from '../out/main/mcp/protocol.js'
import * as logModule from '../out/main/mcp/log.js'
import * as page from '../out/main/mcp/page.js'
import { createAgentAccess } from '../out/main/mcp/server.js'
import { exportTool } from '../out/main/mcp/tools/export.js'
import { frameTool } from '../out/main/mcp/tools/frame.js'
import { runScript } from '../out/main/mcp/tools/run.js'
import { createFakeStudio } from './support/fake-page.mjs'

/**
 * A window whose page is a vm context. `ctx.studio` is what `window.studio` is:
 * leave it unset for a page that is still starting.
 */
function createVmWindow(studio) {
  const gestures = []
  const ctx = vm.createContext({ setTimeout, clearTimeout, console, Error, Promise, AbortController })
  if (studio !== undefined) ctx.studio = studio
  const window = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript(code, userGesture) {
        gestures.push(userGesture)
        try {
          return Promise.resolve(vm.runInContext(code, ctx))
        } catch (error) {
          return Promise.reject(error)
        }
      },
    },
  }
  return { window, ctx, gestures }
}

const { agentLogLine, createAgentLog, readAgentLogTail } = logModule
const { socketPathFor } = protocol
const agentLogDir = (...a) => protocol.agentLogDir(...a)
const agentLogPath = (...a) => protocol.agentLogPath(...a)
const pruneAgentLog = (...a) => logModule.pruneAgentLog(...a)

const FAST = { pollMs: 10, readyTimeoutMs: 300 }

function tempDir(prefix = 'droneclean-hardening-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

// ---------------------------------------------------------------------------
// D6: scripts get no user gesture
// ---------------------------------------------------------------------------

test('D6: a script is evaluated without a user gesture', async () => {
  const { window, gestures } = createVmWindow(createFakeStudio())
  const bridge = page.createPageBridge(() => window, FAST)
  await bridge.execute('1 + 1', 1000)
  assert.ok(gestures.length >= 1)
  assert.deepEqual(
    gestures.filter((gesture) => gesture !== false),
    [],
    'executeJavaScript must be called with userGesture false every time',
  )
})

// ---------------------------------------------------------------------------
// D8: a call that timed out stops its script and releases the page (task 11.2)
// ---------------------------------------------------------------------------

test('D8: after a run times out, the script is told to stop and the next call runs at once', async () => {
  const { window, ctx } = createVmWindow(createFakeStudio())
  let release
  ctx.gate = new Promise((resolve) => {
    release = resolve
  })
  const bridge = page.createPageBridge(() => window, FAST)

  const first = await runScript(
    { script: 'async s => { await gate; return 1 }', label: 'hangs', timeoutMs: 40 },
    bridge,
  )
  assert.ok('error' in first)
  assert.equal(first.error.code, 'TIMEOUT')
  assert.match(first.error.message, /stopped/)
  assert.equal(ctx[page.RUN_ABORT_GLOBAL].signal.aborted, true, 'the SDK can see the abort signal')

  const startedAt = Date.now()
  const second = await runScript({ script: 's => 2', label: 'second' }, bridge)
  assert.ok('result' in second, JSON.stringify(second))
  assert.equal(second.result.value, 2)
  assert.ok(Date.now() - startedAt < 200, 'the page was released, nothing to wait for')
  assert.equal(ctx[page.RUN_ABORT_GLOBAL].signal.aborted, false, 'a new call has a fresh signal')
  release()
})

test('D8: an abandoned script that settles late does not release the call that came after it', async () => {
  const { window, ctx } = createVmWindow(createFakeStudio())
  let releaseFirst
  ctx.firstGate = new Promise((resolve) => {
    releaseFirst = resolve
  })
  ctx.secondGate = new Promise(() => {})
  const bridge = page.createPageBridge(() => window, FAST)

  await runScript({ script: 'async s => { await firstGate }', label: 'first', timeoutMs: 30 }, bridge)
  // The second call is pending in the page when the first one finally settles.
  const second = runScript({ script: 'async s => { await secondGate }', label: 'second', timeoutMs: 400 }, bridge)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(ctx[page.RUN_BUSY_GLOBAL], true)
  releaseFirst()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(ctx[page.RUN_BUSY_GLOBAL], true, 'the late first script must not clear the second one’s flag')
  const answered = await second
  assert.ok('error' in answered)
  assert.equal(answered.error.code, 'TIMEOUT')
  assert.equal(ctx[page.RUN_BUSY_GLOBAL], false)
})

test('D8: a cancelled run is stopped the same way and the next call runs', async () => {
  const { window, ctx } = createVmWindow(createFakeStudio())
  let release
  ctx.gate = new Promise((resolve) => {
    release = resolve
  })
  const bridge = page.createPageBridge(() => window, FAST)
  const controller = new AbortController()
  const pending = runScript(
    { script: 'async s => { await gate; return 1 }', label: 'cancelled', timeoutMs: 5000 },
    bridge,
    controller.signal,
  )
  await new Promise((resolve) => setTimeout(resolve, 30))
  controller.abort()
  const cancelled = await pending
  assert.ok('error' in cancelled)
  assert.equal(cancelled.error.code, 'TIMEOUT')

  const next = await runScript({ script: 's => 2', label: 'next' }, bridge)
  assert.ok('result' in next, JSON.stringify(next))
  assert.equal(next.result.value, 2)
  release()
})

test('D8: frame and export answer CONFLICT when the page is held', async () => {
  const busy = {
    execute: () => Promise.reject(new page.PageBusyError()),
  }
  const frame = await frameTool({ frame: 0 }, busy)
  assert.ok('error' in frame)
  assert.equal(frame.error.code, 'CONFLICT')
  const exported = await exportTool({ jobId: 'job-1' }, busy)
  assert.ok('error' in exported)
  assert.equal(exported.error.code, 'CONFLICT')
})

// ---------------------------------------------------------------------------
// Startup: a call waits for window.studio (design §4.9)
// ---------------------------------------------------------------------------

test('startup: a run made while the page loads waits for window.studio and then runs', async () => {
  const { window, ctx } = createVmWindow()
  const bridge = page.createPageBridge(() => window, { pollMs: 10, readyTimeoutMs: 2000 })
  setTimeout(() => {
    ctx.studio = createFakeStudio()
  }, 80)
  const startedAt = Date.now()
  const outcome = await runScript({ script: 's => "ready"', label: 'early' }, bridge)
  assert.ok('result' in outcome, JSON.stringify(outcome))
  assert.equal(outcome.result.value, 'ready')
  assert.ok(Date.now() - startedAt >= 70, 'it waited for the page')
})

test('startup: past the wait the call fails UNSUPPORTED, "the editor is still starting"', async () => {
  const { window } = createVmWindow()
  const bridge = page.createPageBridge(() => window, { pollMs: 10, readyTimeoutMs: 120 })
  const startedAt = Date.now()
  const outcome = await runScript({ script: 's => 1', label: 'never' }, bridge)
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'UNSUPPORTED')
  assert.match(outcome.error.message, /still starting/)
  assert.equal(outcome.error.hint, 'the editor is still starting')
  assert.ok(Date.now() - startedAt >= 110, 'it waited the whole allowance first')
})

test('startup: frame and export share the same wait', async () => {
  const { window, ctx } = createVmWindow()
  const bridge = page.createPageBridge(() => window, { pollMs: 10, readyTimeoutMs: 120 })
  const frame = await frameTool({ frame: 0 }, bridge)
  assert.ok('error' in frame)
  assert.equal(frame.error.code, 'UNSUPPORTED')
  assert.equal(frame.error.hint, 'the editor is still starting')
  const exported = await exportTool({ jobId: 'job-1' }, bridge)
  assert.ok('error' in exported)
  assert.equal(exported.error.code, 'UNSUPPORTED')
  assert.equal(exported.error.hint, 'the editor is still starting')
  assert.equal(ctx.studio, undefined)
})

test('startup: with no workspace folder the call fails UNSUPPORTED and the window is shown', async () => {
  const studio = createFakeStudio()
  studio.workspace = { isOpen: () => false }
  const { window } = createVmWindow(studio)
  let shown = 0
  const bridge = page.createPageBridge(() => window, {
    ...FAST,
    readyTimeoutMs: 120,
    showWindow: () => {
      shown += 1
    },
  })
  const outcome = await runScript({ script: 's => 1', label: 'no folder' }, bridge)
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'UNSUPPORTED')
  assert.match(outcome.error.message, /the app has no workspace folder yet/)
  assert.equal(shown, 1)
})

test('startup: a workspace folder chosen while the call waits lets it through', async () => {
  const studio = createFakeStudio()
  let chosen = false
  studio.workspace = { isOpen: () => chosen }
  const { window } = createVmWindow(studio)
  const bridge = page.createPageBridge(() => window, { pollMs: 10, readyTimeoutMs: 2000 })
  setTimeout(() => {
    chosen = true
  }, 60)
  const outcome = await runScript({ script: 's => 5', label: 'picked' }, bridge)
  assert.ok('result' in outcome, JSON.stringify(outcome))
  assert.equal(outcome.result.value, 5)
})

test('startup: once the page has been ready, a page that stops answering is a TIMEOUT, not a 20 s wait', async () => {
  const studio = createFakeStudio()
  let hang = false
  const { window } = createVmWindow(studio)
  const inner = window.webContents.executeJavaScript
  window.webContents.executeJavaScript = (code, gesture) =>
    hang ? new Promise(() => {}) : inner(code, gesture)
  const bridge = page.createPageBridge(() => window, FAST)
  await bridge.execute('1', 500)
  hang = true
  const startedAt = Date.now()
  await assert.rejects(
    () => bridge.execute('1', 60),
    (error) => error.name === 'PageTimeoutError',
  )
  assert.ok(Date.now() - startedAt < 250)
})

// ---------------------------------------------------------------------------
// D7: the Windows pipe is per user
// ---------------------------------------------------------------------------

test('D7: the Windows pipe name carries a per-user part, the same in the app and the launcher', () => {
  const alice = socketPathFor('C:\\Users\\alice', 'win32', 'alice')
  const bob = socketPathFor('C:\\Users\\bob', 'win32', 'bob')
  assert.notEqual(alice, bob)
  assert.match(alice, /^\\\\\.\\pipe\\droneclean-studio-mcp-[0-9a-f]{16}$/)
  assert.equal(alice, socketPathFor('C:\\Users\\alice', 'win32', 'alice'))
  assert.equal(alice, socketPathFor('D:\\other', 'win32', 'ALICE'), 'Windows user names are case-insensitive')
  assert.equal(alice, launcher.socketPathFor('C:\\Users\\alice', 'win32', 'alice'))
  assert.equal(bob, launcher.socketPathFor('C:\\Users\\bob', 'win32', 'bob'))
  assert.equal(launcher.socketPathFor('/tmp/u', 'darwin', 'alice'), '/tmp/u/mcp.sock')
  assert.equal(socketPathFor('/tmp/u', 'linux', 'alice'), '/tmp/u/mcp.sock')
})

test('D7: without a faked user the real one is used by both', () => {
  assert.equal(socketPathFor('C:\\u', 'win32'), launcher.socketPathFor('C:\\u', 'win32'))
  assert.notEqual(socketPathFor('C:\\u', 'win32'), '\\\\.\\pipe\\droneclean-studio-mcp')
})

// ---------------------------------------------------------------------------
// D9: dated log files, 30 days of retention, a tail that reads the end only
// ---------------------------------------------------------------------------

function lineAt(at, summary = 'x') {
  return agentLogLine('search', { query: summary }, { at: new Date(at), durationMs: 1, code: 'OK' })
}

test('D9: the log is one file per day under agent-log/', async () => {
  const userData = tempDir()
  assert.equal(agentLogDir(userData), path.join(userData, 'agent-log'))
  assert.equal(
    agentLogPath(userData, new Date('2026-11-18T23:59:00Z')),
    path.join(userData, 'agent-log', '2026-11-18.jsonl'),
  )
  const log = createAgentLog(agentLogDir(userData))
  await log.append(lineAt('2026-11-17T10:00:00Z', 'monday'))
  await log.append(lineAt('2026-11-18T10:00:00Z', 'tuesday'))
  await log.append(lineAt('2026-11-18T11:00:00Z', 'tuesday again'))
  assert.deepEqual(fs.readdirSync(agentLogDir(userData)).sort(), ['2026-11-17.jsonl', '2026-11-18.jsonl'])
  assert.equal(
    fs.readFileSync(path.join(agentLogDir(userData), '2026-11-18.jsonl'), 'utf8').trim().split('\n').length,
    2,
  )
  fs.rmSync(userData, { recursive: true, force: true })
})

test('D9: files older than 30 days are deleted, the rest and strangers are kept', async () => {
  const dir = tempDir()
  for (const name of ['2026-10-18.jsonl', '2026-10-19.jsonl', '2026-11-18.jsonl', 'notes.txt', '2026-13-45.jsonl']) {
    fs.writeFileSync(path.join(dir, name), '')
  }
  const removed = await pruneAgentLog(dir, new Date('2026-11-18T12:00:00Z'))
  assert.deepEqual(removed.sort(), ['2026-10-18.jsonl'])
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-10-19.jsonl', '2026-11-18.jsonl', '2026-13-45.jsonl', 'notes.txt'])
  assert.deepEqual(await pruneAgentLog(path.join(dir, 'missing'), new Date()), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('D9: the app prunes the log when it starts', async () => {
  const userData = tempDir()
  const dir = agentLogDir(userData)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '2020-01-01.jsonl'), '')
  const access = createAgentAccess({
    userDataDir: userData,
    page: { execute: () => Promise.reject(new Error('unused')) },
    loadDocuments: async () => [],
    logger: () => undefined,
  })
  await access.startIfEnabled()
  assert.equal(fs.existsSync(path.join(dir, '2020-01-01.jsonl')), false)
  await access.dispose()
  fs.rmSync(userData, { recursive: true, force: true })
})

test('D9: the panel tail is the newest 50 lines across files, oldest first, reading only the end', async () => {
  const dir = tempDir()
  const day = (name, count, from) => {
    const lines = Array.from({ length: count }, (_, index) =>
      JSON.stringify(lineAt(Date.UTC(2026, 10, 18, 0, 0, from + index), `${name} ${from + index}`)),
    )
    fs.writeFileSync(path.join(dir, `${name}.jsonl`), `${lines.join('\n')}\n`)
  }
  day('2026-11-10', 20, 0)
  day('2026-11-17', 30, 100)
  // The newest day is large: 40000 lines, about 8 MB. Only its end may be read.
  day('2026-11-18', 40_000, 1000)
  const size = fs.statSync(path.join(dir, '2026-11-18.jsonl')).size
  assert.ok(size > 4_000_000)

  const real = fs.promises.open
  let bytesRead = 0
  fs.promises.open = async (...args) => {
    const handle = await real(...args)
    const read = handle.read.bind(handle)
    handle.read = async (...readArgs) => {
      const result = await read(...readArgs)
      bytesRead += result.bytesRead
      return result
    }
    return handle
  }
  let tail
  try {
    tail = await readAgentLogTail(dir, 50)
  } finally {
    fs.promises.open = real
  }
  assert.equal(tail.length, 50)
  assert.equal(tail[49].summary, 'search "2026-11-18 40999"')
  assert.equal(tail[0].summary, 'search "2026-11-18 40950"')
  assert.ok(bytesRead < size / 10, `read ${bytesRead} of ${size} bytes`)

  // A short newest file is topped up from the older ones.
  fs.writeFileSync(path.join(dir, '2026-11-18.jsonl'), `${JSON.stringify(lineAt(Date.UTC(2026, 10, 18, 5), 'only'))}\n`)
  const mixed = await readAgentLogTail(dir, 5)
  assert.deepEqual(
    mixed.map((entry) => entry.summary),
    ['search "2026-11-17 126"', 'search "2026-11-17 127"', 'search "2026-11-17 128"', 'search "2026-11-17 129"', 'search "only"'],
  )
  assert.deepEqual(await readAgentLogTail(path.join(dir, 'missing'), 5), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('startup: the workspace gate is read from studio.workspace.isOpen, never from an error message', async () => {
  const studio = createFakeStudio()
  let listed = 0
  // A project list that throws the old gate message must not matter: only isOpen decides.
  studio.project = {
    list: () => {
      listed += 1
      return Promise.reject(new Error('Workspace root is not set.'))
    },
  }
  studio.workspace = { isOpen: () => true }
  const { window } = createVmWindow(studio)
  const bridge = page.createPageBridge(() => window, { pollMs: 10, readyTimeoutMs: 120 })
  const outcome = await runScript({ script: 's => 3', label: 'open' }, bridge)
  assert.ok('result' in outcome, JSON.stringify(outcome))
  assert.equal(listed, 0)
})

// ---------------------------------------------------------------------------
// A page that went away (the MCP tour, 19 Nov 2026): its renderer crashed
// during an export, and every later call answered "still starting" for good.
// ---------------------------------------------------------------------------

/**
 * A vm page behind a window with Electron's crash surface: `crash()` ends the
 * renderer the way Electron does (pending scripts reject, `isCrashed()` is true,
 * `render-process-gone` fires), and `reload()` brings up a fresh page whose SDK
 * is installed after `loadMs`.
 */
function createCrashableWindow({ loadMs = 30 } = {}) {
  const listeners = { 'render-process-gone': [], 'did-start-navigation': [] }
  const state = { crashed: false, reloads: 0, pending: [], ctx: null }
  const fresh = () => {
    const ctx = vm.createContext({ setTimeout, clearTimeout, console, Error, Promise, AbortController })
    ctx.studio = createFakeStudio()
    return ctx
  }
  state.ctx = fresh()
  const window = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript(code) {
        if (state.crashed || state.ctx === null) {
          return Promise.reject(new Error('Script failed to execute, this normally means an error was thrown'))
        }
        return new Promise((resolve, reject) => {
          const entry = { reject }
          state.pending.push(entry)
          Promise.resolve()
            .then(() => vm.runInContext(code, state.ctx))
            .then(resolve, reject)
            .finally(() => {
              state.pending = state.pending.filter((candidate) => candidate !== entry)
            })
        })
      },
      isCrashed: () => state.crashed,
      reload() {
        state.reloads += 1
        state.crashed = false
        state.ctx = null
        for (const listener of listeners['did-start-navigation']) {
          listener({ isMainFrame: true, isSameDocument: false })
        }
        setTimeout(() => {
          state.ctx = fresh()
        }, loadMs)
      },
      on(event, listener) {
        listeners[event]?.push(listener)
        return window.webContents
      },
    },
  }
  const crash = () => {
    state.crashed = true
    for (const entry of state.pending) {
      entry.reject(new Error('Render frame was disposed before the request completed'))
    }
    for (const listener of listeners['render-process-gone']) {
      listener({}, { reason: 'crashed', exitCode: 5 })
    }
  }
  // The order the packaged app showed: the pending script is dropped first, and Electron reports the crash after.
  const crashScriptFirst = async () => {
    for (const entry of state.pending) {
      entry.reject(new Error('Render frame was disposed before the request completed'))
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
    state.crashed = true
    for (const listener of listeners['render-process-gone']) {
      listener({}, { reason: 'killed', exitCode: 2 })
    }
  }
  return { window, state, crash, crashScriptFirst }
}

test('a page that crashes under a call is reported as a crash, reloaded, and the next call runs', async () => {
  const { window, state, crash } = createCrashableWindow()
  const bridge = page.createPageBridge(() => window, { pollMs: 10, readyTimeoutMs: 2000 })
  state.ctx.gate = new Promise(() => {})
  await runScript({ script: 's => 1', label: 'first' }, bridge)

  const pending = exportTool({ jobId: 'job-1', waitMs: 5000 }, bridge)
  state.ctx.studioAgent = { export: () => new Promise(() => {}) }
  await new Promise((resolve) => setTimeout(resolve, 30))
  crash()
  const crashed = await pending

  assert.ok('error' in crashed)
  assert.equal(crashed.error.code, 'INTERNAL')
  assert.match(crashed.error.message, /^export: the editor page crashed \(crashed, exit code 5\)/)
  assert.doesNotMatch(crashed.error.message, /still starting/)
  assert.match(crashed.error.hint, /studio\.project\.open\(id\)/)
  assert.equal(state.reloads, 1, 'the bridge reloads the crashed page')

  const next = await runScript({ script: 's => "back"', label: 'after the crash' }, bridge)
  assert.ok('result' in next, JSON.stringify(next))
  assert.equal(next.result.value, 'back')
})

test('a crash between two calls is reported by the next call, which reloads; the one after runs', async () => {
  const { window, state, crash } = createCrashableWindow()
  const bridge = page.createPageBridge(() => window, { pollMs: 10, readyTimeoutMs: 2000 })
  await runScript({ script: 's => 1', label: 'first' }, bridge)

  crash()
  const startedAt = Date.now()
  const reported = await runScript({ script: 's => 2', label: 'second' }, bridge)
  assert.ok('error' in reported)
  assert.equal(reported.error.code, 'INTERNAL')
  assert.match(reported.error.message, /the editor page crashed \(crashed, exit code 5\)/)
  assert.ok(Date.now() - startedAt < 500, 'a crashed page is not waited for as a starting one')
  assert.equal(state.reloads, 1)

  const third = await runScript({ script: 's => 3', label: 'third' }, bridge)
  assert.ok('result' in third, JSON.stringify(third))
  assert.equal(third.result.value, 3)
})

test('a page that reloads under a call says so, and the next call waits for the new page', async () => {
  const { window, state } = createCrashableWindow({ loadMs: 60 })
  const bridge = page.createPageBridge(() => window, { pollMs: 10, readyTimeoutMs: 2000 })
  await runScript({ script: 's => 1', label: 'first' }, bridge)

  state.ctx.studioAgent = { export: () => new Promise(() => {}) }
  const pending = exportTool({ jobId: 'job-1', waitMs: 5000 }, bridge)
  await new Promise((resolve) => setTimeout(resolve, 30))
  // The page reloads itself: the main frame loads a new document and the old frame's scripts are dropped.
  const dropped = [...state.pending]
  window.webContents.reload()
  state.reloads = 0
  for (const entry of dropped) entry.reject(new Error('Render frame was disposed before the request completed'))
  const reloaded = await pending

  assert.ok('error' in reloaded)
  assert.equal(reloaded.error.code, 'INTERNAL')
  assert.match(reloaded.error.message, /^export: the editor page reloaded while this call ran/)

  const next = await runScript({ script: 's => "new page"', label: 'after the reload' }, bridge)
  assert.ok('result' in next, JSON.stringify(next))
  assert.equal(next.result.value, 'new page')
  assert.equal(state.reloads, 0, 'a page that reloaded itself is not reloaded again')
})

test('a script dropped before Electron reports the crash: the call says the page went away, the next call reloads and runs', async () => {
  const { window, state, crashScriptFirst } = createCrashableWindow()
  const bridge = page.createPageBridge(() => window, { pollMs: 10, readyTimeoutMs: 2000 })
  await runScript({ script: 's => 1', label: 'first' }, bridge)

  state.ctx.studioAgent = { export: () => new Promise(() => {}) }
  const pending = exportTool({ jobId: 'job-1', waitMs: 5000 }, bridge)
  await new Promise((resolve) => setTimeout(resolve, 30))
  await crashScriptFirst()
  const lost = await pending

  assert.ok('error' in lost)
  assert.equal(lost.error.code, 'INTERNAL')
  assert.match(lost.error.message, /^export: the editor page went away while this call ran/)
  assert.match(lost.error.message, /Render frame was disposed/)
  assert.match(lost.error.hint, /studio\.project\.open\(id\)/)

  const next = await runScript({ script: 's => "after"', label: 'after the crash' }, bridge)
  assert.ok('result' in next, JSON.stringify(next))
  assert.equal(next.result.value, 'after')
  assert.equal(state.reloads, 1, 'the crash is reloaded once, by the next call')
})
