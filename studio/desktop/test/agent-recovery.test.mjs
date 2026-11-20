/**
 * A `run` or `frame` that never settles no longer holds the editor forever
 * (task 11.2): the bridge asks the page to abort, then to save, then reloads the
 * window, and the call answers a `TIMEOUT` that says what happened.
 *
 * The page is a fake window that never answers: it hangs on the call's script
 * (the way a blocked main thread would), answers the abort request only when the
 * test says it can, answers the save only when the test says it can, and comes
 * back ready after `reload()`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  PageTimeoutError,
  RUN_ABORT_GLOBAL,
  createPageBridge,
} from '../out/main/mcp/page.js'
import { frameTool } from '../out/main/mcp/tools/frame.js'
import { runScript } from '../out/main/mcp/tools/run.js'
import { timeoutOutcome } from '../out/main/mcp/tools/page-failure.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FAST = { pollMs: 5, readyTimeoutMs: 400, abortGraceMs: 30, saveGraceMs: 30 }

/**
 * A window whose page hangs on the call's script. `abortAnswers` and
 * `saveAnswers` say whether it can still answer those two requests; a reload
 * unblocks it. `crashable` adds `forcefullyCrashRenderer`.
 */
function createHangingWindow({ abortAnswers = false, saveAnswers = false, saveKept = true, crashable = false } = {}) {
  const state = { hung: false, reloads: 0, crashes: 0, asked: [] }
  const window = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript(code) {
        if (code.includes("return 'aborted'")) {
          state.asked.push('abort')
          if (abortAnswers) {
            state.hung = false
            return Promise.resolve('aborted')
          }
          return new Promise(() => {})
        }
        if (code.includes('s.project.save')) {
          state.asked.push('save')
          return saveAnswers ? Promise.resolve({ kept: saveKept }) : new Promise(() => {})
        }
        if (code.includes("return 'ready'")) {
          return state.hung ? new Promise(() => {}) : Promise.resolve('ready')
        }
        if (code.includes('stuck()')) {
          state.asked.push('script')
          state.hung = true
          return new Promise(() => {})
        }
        state.asked.push('call')
        return Promise.resolve('ok')
      },
      reload() {
        state.reloads += 1
        state.hung = false
      },
      ...(crashable && {
        forcefullyCrashRenderer() {
          state.crashes += 1
        },
      }),
    },
  }
  return { window, state }
}

async function timedOut(bridge, options = { recover: true }) {
  try {
    await bridge.execute('stuck()', 40, options)
  } catch (error) {
    assert.ok(error instanceof PageTimeoutError, String(error))
    return error
  }
  assert.fail('the call should have timed out')
}

test('a page that acknowledges the abort is released without a reload, edits kept', async () => {
  const { window, state } = createHangingWindow({ abortAnswers: true })
  const bridge = createPageBridge(() => window, FAST)
  await bridge.execute('1', 500, { recover: true })
  state.asked.length = 0

  const error = await timedOut(bridge)
  assert.deepEqual(error.recovery, { action: 'aborted' })
  assert.equal(state.reloads, 0)
  assert.deepEqual(state.asked, ['script', 'abort'])

  // The lock is free: the next call runs.
  assert.equal(await bridge.execute('2', 500, { recover: true }), 'ok')
})

test('a page that answers nothing is asked to save, then reloaded; the call says the edits were lost', async () => {
  const { window, state } = createHangingWindow({ crashable: true })
  const bridge = createPageBridge(() => window, FAST)
  await bridge.execute('1', 500, { recover: true })
  state.asked.length = 0

  const error = await timedOut(bridge)
  assert.deepEqual(error.recovery, { action: 'reloaded', unsavedEditsKept: false, back: true })
  assert.deepEqual(state.asked, ['script', 'abort', 'save'])
  assert.equal(state.reloads, 1)
  assert.equal(state.crashes, 1, 'a renderer that does not answer is killed before the reload')
})

test('a page that cannot abort but can save keeps the unsaved edits', async () => {
  const { window, state } = createHangingWindow({ saveAnswers: true })
  const bridge = createPageBridge(() => window, FAST)
  await bridge.execute('1', 500, { recover: true })
  state.asked.length = 0

  const error = await timedOut(bridge)
  assert.deepEqual(error.recovery, { action: 'reloaded', unsavedEditsKept: true, back: true })
  assert.equal(state.reloads, 1)
  assert.equal(state.crashes, 0, 'no crash hook on this window, and it still reloads')
})

test('a save that fails is not a kept edit', async () => {
  const { window, state } = createHangingWindow({ saveAnswers: true, saveKept: false })
  const bridge = createPageBridge(() => window, FAST)
  await bridge.execute('1', 500, { recover: true })
  state.asked.length = 0
  const error = await timedOut(bridge)
  assert.equal(error.recovery.unsavedEditsKept, false)
})

test('after the recovery the next call finds a ready editor, not a held one', async () => {
  const { window, state } = createHangingWindow()
  const bridge = createPageBridge(() => window, FAST)
  await bridge.execute('1', 500, { recover: true })
  state.asked.length = 0
  await timedOut(bridge)

  state.asked.length = 0
  const startedAt = Date.now()
  assert.equal(await bridge.execute('3', 500, { recover: true }), 'ok')
  assert.deepEqual(state.asked, ['call'])
  assert.ok(Date.now() - startedAt < 300)
})

test('a call that does not ask for recovery keeps the old behaviour: held, no reload', async () => {
  const { window, state } = createHangingWindow()
  const bridge = createPageBridge(() => window, FAST)
  await bridge.execute('1', 500)
  state.asked.length = 0
  const error = await timedOut(bridge, {})
  assert.equal(error.recovery, undefined)
  assert.equal(state.reloads, 0)
  assert.deepEqual(state.asked, ['script'])
})

test('a run that finds the page still held by an earlier call releases it first', async () => {
  const { window, state } = createHangingWindow({ abortAnswers: true })
  const bridge = createPageBridge(() => window, FAST)
  await bridge.execute('1', 500)
  state.asked.length = 0
  await timedOut(bridge, {}) // a poll that timed out and left the page held
  state.asked.length = 0
  const result = await bridge.execute('2', 500, { recover: true })
  assert.equal(result, 'ok')
  assert.deepEqual(state.asked, ['abort', 'call'])
})

test('recover() stops the call that is running in the page, for a cancelled run', async () => {
  const { window, state } = createHangingWindow({ abortAnswers: true })
  const bridge = createPageBridge(() => window, FAST)
  await bridge.execute('1', 500)
  state.asked.length = 0
  assert.deepEqual(await bridge.recover(), { action: 'aborted' })
  assert.deepEqual(state.asked, ['abort'])
})

test('a window that cannot be reloaded is left as it was, without a recovery', async () => {
  const { window, state } = createHangingWindow()
  delete window.webContents.reload
  const bridge = createPageBridge(() => window, FAST)
  await bridge.execute('1', 500, { recover: true })
  state.asked.length = 0
  const error = await timedOut(bridge)
  assert.equal(error.recovery, undefined)
})

test('run and frame ask the bridge for recovery, and answer what was done', async () => {
  const calls = []
  const recovered = (recovery) => ({
    execute(code, timeoutMs, options) {
      calls.push({ timeoutMs, options })
      return Promise.reject(new PageTimeoutError('the editor did not answer', recovery))
    },
  })
  const reloaded = { action: 'reloaded', unsavedEditsKept: true, back: true }
  const run = await runScript({ script: 's => 1', label: 'x', timeoutMs: 100 }, recovered(reloaded))
  const frame = await frameTool({ frame: 0 }, recovered(reloaded))
  assert.deepEqual(calls.map((call) => call.options), [{ recover: true }, { recover: true }])
  for (const outcome of [run, frame]) {
    assert.ok('error' in outcome)
    assert.equal(outcome.error.code, 'TIMEOUT')
    assert.match(outcome.error.message, /reloaded the editor window and reopened the project/)
    assert.match(outcome.error.hint, /saved before the reload, so no edit was lost/)
  }
})

test('the timeout answers say what was done and name only things an agent can do', () => {
  const answer = (recovery) =>
    timeoutOutcome('run', new PageTimeoutError('x', recovery), 1000, 'try again.').error
  const aborted = answer({ action: 'aborted' })
  assert.match(aborted.message, /stopped the script and the editor is free again/)
  assert.match(aborted.hint, /unsaved until studio\.project\.save\(\)/)

  const lost = answer({ action: 'reloaded', unsavedEditsKept: false, back: false })
  assert.match(lost.message, /still reopening the project/)
  assert.match(lost.hint, /could not save .* lost: redo them/)

  const none = answer(undefined)
  assert.match(none.message, /did not answer within 1000 ms/)

  for (const error of [aborted, lost, none]) {
    assert.doesNotMatch(`${error.message} ${error.hint}`, /panel|Settings|menu|click|button/i)
  }
})

test('the abort signal lives under the name the SDK reads', () => {
  const context = fs.readFileSync(path.resolve(here, '../../src/studio/sdk/context.ts'), 'utf8')
  assert.ok(context.includes(`AGENT_ABORT_GLOBAL = '${RUN_ABORT_GLOBAL}'`))
})
