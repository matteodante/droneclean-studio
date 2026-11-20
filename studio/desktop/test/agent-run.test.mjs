/**
 * `run`: the undo grouping of design §4.4, its timeouts and its cancellation
 * (task 2.2).
 *
 * The page script is evaluated in a `node:vm` context with a fake SDK, which is
 * the same boundary as `webContents.executeJavaScript` (a string in, JSON out)
 * without Electron. The fake follows the SDK's rule: edits inside
 * `studio.transaction` fold into one entry, edits after an `await` are entries
 * of their own.
 *
 * The last tests speak to the real server over its socket: a `tools/call` for
 * an awaited script, an MCP `notifications/cancelled`, and the next call — the
 * path a client takes, not just `runScript`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import * as fixture from '../../mcp/fixture.mjs'
import { agentLogPath } from '../out/main/mcp/protocol.js'
import { createAgentAccess } from '../out/main/mcp/server.js'
import { RUN_BUSY_GLOBAL, createPageBridge } from '../out/main/mcp/page.js'
import { runScript } from '../out/main/mcp/tools/run.js'
import { createFakeStudio, createSilentWindow, createVmPage } from './support/fake-page.mjs'
import { connectSocket } from './support/socket-client.mjs'

test('a synchronous script of five edits is exactly one undo step, labelled agent: …', async () => {
  const page = createVmPage()
  const outcome = await runScript(
    {
      script: 's => { s.edit(); s.edit(); s.edit(); s.edit(); s.edit(); return "done" }',
      label: 'five edits',
    },
    page,
  )
  assert.ok('result' in outcome)
  const result = outcome.result
  assert.equal(result.value, 'done')
  assert.equal(result.undoSteps, 1)
  assert.equal(result.changes.undoSteps, 1)
  assert.equal(result.changes.commands.length, 5)
  assert.equal(outcome.undoSteps, 1)
  assert.deepEqual(page.studio.labels, ['agent: five edits'])
  assert.equal(page.studio.depth(), 1)
  assert.equal(typeof result.durationMs, 'number')
})

test('an awaiting script reports every entry it added, the transaction’s one included', async () => {
  const page = createVmPage()
  const outcome = await runScript(
    {
      script: 'async s => { s.edit(); await null; s.edit(); return 7 }',
      label: 'an awaited edit',
    },
    page,
  )
  assert.ok('result' in outcome)
  assert.equal(outcome.result.value, 7)
  // One entry from the synchronous half (five edits would have been one too),
  // one from the awaited call after the transaction committed. `changes` lists
  // both: the edit after the await is no longer missing from it.
  assert.equal(outcome.result.changes.undoSteps, 2)
  assert.equal(outcome.result.changes.commands.length, 2)
  assert.equal(outcome.result.undoSteps, 2)
  assert.equal(page.studio.depth(), 2)
})

test('a call that changed the open project saves it and says so; a read-only call does not save', async () => {
  const studio = createFakeStudio()
  let saves = 0
  studio.project = { current: () => ({ id: 'p1' }), save: async () => { saves += 1 } }
  const page = createVmPage(studio)
  const edited = await runScript({ script: 's => { s.edit(); return 1 }', label: 'one edit' }, page)
  assert.ok('result' in edited)
  assert.equal(edited.result.saved, true)
  assert.equal(saves, 1)
  const read = await runScript({ script: 's => s.history.depth()', label: 'read only' }, page)
  assert.ok('result' in read)
  assert.equal(read.result.saved, undefined)
  assert.equal(saves, 1)
})

test('a save that fails answers saved: false and keeps the edit', async () => {
  const studio = createFakeStudio()
  studio.project = { current: () => ({ id: 'p1' }), save: async () => { throw new Error('disk full') } }
  const page = createVmPage(studio)
  const outcome = await runScript({ script: 's => { s.edit() }', label: 'one edit' }, page)
  assert.ok('result' in outcome)
  assert.equal(outcome.result.saved, false)
  assert.equal(page.studio.depth(), 1)
})

test('an awaiting script that times out saves the edits it already made', async () => {
  const studio = createFakeStudio()
  let saves = 0
  studio.project = { current: () => ({ id: 'p1' }), save: async () => { saves += 1 } }
  const page = createVmPage(studio)
  const outcome = await runScript(
    { script: 'async s => { s.edit(); await new Promise(() => {}) }', label: 'stuck', timeoutMs: 200 },
    page,
  )
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'TIMEOUT')
  assert.equal(saves, 1)
})

test('a script that changes nothing adds no undo entry', async () => {
  const page = createVmPage()
  const outcome = await runScript({ script: 's => s.history.depth()', label: 'read only' }, page)
  assert.ok('result' in outcome)
  assert.equal(outcome.result.value, 0)
  assert.equal(outcome.result.undoSteps, 0)
  assert.equal(outcome.result.changes.undoSteps, 0)
  assert.equal(page.studio.depth(), 0)
})

test('a StudioError comes back as its JSON', async () => {
  const page = createVmPage()
  const outcome = await runScript(
    {
      script:
        "s => { const e = new Error('boom'); e.toJSON = function () { return { name: 'StudioError', code: 'CONFLICT', message: 'clips.split: boom', hint: 'no' } }; throw e }",
      label: 'fails',
    },
    page,
  )
  assert.ok('error' in outcome)
  assert.equal(outcome.error.name, 'StudioError')
  assert.equal(outcome.error.code, 'CONFLICT')
  assert.equal(outcome.error.message, 'clips.split: boom')
  assert.equal(outcome.error.hint, 'no')
})

test('a syntax error is INVALID_ARGUMENT with the engine’s message', async () => {
  const page = createVmPage()
  const outcome = await runScript({ script: 's => (', label: 'broken' }, page)
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'script')
  assert.match(outcome.error.message, /script/)
})

test('an expression that uses studio is evaluated too, in the same undo step', async () => {
  const page = createVmPage()
  const outcome = await runScript(
    { script: '(studio.edit(), 42)', label: 'expression' },
    page,
  )
  assert.ok('result' in outcome)
  assert.equal(outcome.result.value, 42)
  assert.equal(outcome.result.undoSteps, 1)
  assert.equal(page.studio.depth(), 1)
  assert.deepEqual(page.studio.labels, ['agent: expression'])
})

test('an awaited script that never resolves stops at timeoutMs with TIMEOUT', async () => {
  const page = createVmPage()
  const startedAt = Date.now()
  const outcome = await runScript(
    { script: 'async s => new Promise(() => {})', label: 'hang', timeoutMs: 30 },
    page,
  )
  const elapsed = Date.now() - startedAt
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'TIMEOUT')
  assert.ok(elapsed < 2000, `took ${elapsed} ms; the page’s own race should answer quickly`)
})

test('a page that does not answer within the deadline maps to TIMEOUT', async () => {
  // A page that has started (it answers the readiness probe) and then hangs on the script.
  const window = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: (code) =>
        code.includes(RUN_BUSY_GLOBAL) ? Promise.resolve('ready') : createSilentWindow().webContents.executeJavaScript(),
    },
  }
  const bridge = createPageBridge(() => window)
  await assert.rejects(
    () => bridge.execute('1 + 1', 20),
    (error) => error.name === 'PageTimeoutError',
  )
})

test('the script’s size is checked before it reaches the page', async () => {
  let called = false
  const page = {
    execute: () => {
      called = true
      return Promise.resolve({})
    },
  }
  const outcome = await runScript({ script: `s => 1${' '.repeat(70_000)}`, label: 'big' }, page)
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'INVALID_ARGUMENT')
  assert.equal(outcome.error.argument, 'script')
  assert.equal(called, false)
})

test('a result over 1 MB is cut to a hint instead of the value', async () => {
  const page = createVmPage()
  const outcome = await runScript(
    { script: "s => 'x'.repeat(2 * 1024 * 1024)", label: 'huge' },
    page,
  )
  assert.ok('result' in outcome)
  assert.equal(outcome.result.value, null)
  assert.equal(outcome.result.truncated, true)
  assert.match(outcome.result.hint, /less/)
})

test('a function that returns nothing answers null', async () => {
  const page = createVmPage()
  const outcome = await runScript({ script: 's => {}', label: 'nothing' }, page)
  assert.ok('result' in outcome)
  assert.equal(outcome.result.value, null)
})

test('a 3 s sleep times out at 1000 ms; the edit stays and the page answers the next call', async () => {
  const page = createVmPage()
  const startedAt = Date.now()
  const outcome = await runScript(
    {
      script:
        'async s => { s.edit(); await new Promise((resolve) => setTimeout(resolve, 3000)); s.edit(); return 1 }',
      label: 'a slow script',
      timeoutMs: 1000,
    },
    page,
  )
  const elapsed = Date.now() - startedAt
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'TIMEOUT')
  assert.match(outcome.error.message, /still running/)
  assert.match(outcome.error.hint, /kept/)
  assert.ok(elapsed >= 950 && elapsed < 2000, `answered after ${elapsed} ms, not at timeoutMs`)
  // The synchronous edit was committed before the await and is kept, not undone.
  assert.equal(outcome.undoSteps, 1)
  assert.equal(page.studio.depth(), 1)

  // While the first script is still asleep, the page answers a second call.
  const nextStartedAt = Date.now()
  const next = await runScript({ script: 's => s.history.depth()', label: 'next' }, page)
  assert.ok('result' in next)
  assert.equal(next.result.value, 1)
  assert.ok(Date.now() - nextStartedAt < 500, 'the next call waited for the abandoned script')

  // The abandoned script was not interrupted: its later edit is its own entry.
  await new Promise((resolve) => setTimeout(resolve, 2200))
  assert.equal(page.studio.depth(), 2)
})

test('an aborted (cancelled) call stops waiting at once, as a timeout does', async () => {
  const page = createVmPage()
  const controller = new AbortController()
  const startedAt = Date.now()
  const call = runScript(
    {
      script:
        'async s => { s.edit(); await new Promise((resolve) => setTimeout(resolve, 800)); s.edit(); return 1 }',
      label: 'cancelled',
      timeoutMs: 60_000,
    },
    page,
    controller.signal,
  )
  setTimeout(() => controller.abort(), 100)
  const outcome = await call
  const elapsed = Date.now() - startedAt
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'TIMEOUT')
  assert.match(outcome.error.message, /cancelled/)
  assert.match(outcome.error.hint, /told the script to stop|undo history/)
  assert.ok(elapsed < 700, `answered after ${elapsed} ms; cancellation should not wait for the script`)

  const next = await runScript({ script: 's => s.history.depth()', label: 'after cancel' }, page)
  assert.ok('result' in next)
  assert.equal(next.result.value, 1)
  // The script kept running; its edit after the await is a later entry.
  await new Promise((resolve) => setTimeout(resolve, 800))
  assert.equal(page.studio.depth(), 2)
})

test('a call already aborted before it starts answers TIMEOUT without touching the page', async () => {
  let called = false
  const page = {
    execute: () => {
      called = true
      return Promise.resolve({})
    },
  }
  const controller = new AbortController()
  controller.abort()
  const outcome = await runScript({ script: 's => 1', label: 'gone' }, page, controller.signal)
  assert.ok('error' in outcome)
  assert.equal(outcome.error.code, 'TIMEOUT')
  assert.equal(called, false)
})

/** One temp user folder for a server test. */
function tempUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-agent-run-'))
}

/** Initialize a raw socket client, as a real client does. */
async function handshake(client) {
  client.send(fixture.INITIALIZE_REQUEST)
  const initialized = await client.receive()
  client.send(fixture.INITIALIZED_NOTIFICATION)
  return initialized
}

test('a syntax error and a thrown StudioError answer isError over the socket', async () => {
  const dir = tempUserDataDir()
  const page = createVmPage()
  const access = createAgentAccess({
    userDataDir: dir,
    page,
    loadDocuments: async () => fixture.CORPUS,
    logger: () => undefined,
  })
  await access.enable()
  const client = await connectSocket(access.socketPath)
  try {
    await handshake(client)
    client.send({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'run', arguments: { script: 's => (', label: 'broken' } },
    })
    const syntax = await client.receive()
    assert.equal(syntax.result.isError, true)
    const syntaxText = JSON.parse(syntax.result.content[0].text)
    assert.equal(syntaxText.name, 'StudioError')
    assert.equal(syntaxText.code, 'INVALID_ARGUMENT')
    assert.match(syntaxText.message, /could not be parsed/)

    client.send({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'run',
        arguments: {
          script:
            "s => { const error = new Error('boom'); error.toJSON = () => ({ name: 'StudioError', code: 'NOT_FOUND', message: 'clips.split: no clip', hint: 'list them' }); throw error }",
          label: 'missing clip',
        },
      },
    })
    const thrown = await client.receive()
    assert.equal(thrown.result.isError, true)
    const thrownText = JSON.parse(thrown.result.content[0].text)
    assert.equal(thrownText.name, 'StudioError')
    assert.equal(thrownText.code, 'NOT_FOUND')
    assert.equal(thrownText.hint, 'list them')
  } finally {
    client.close()
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('MCP notifications/cancelled stops the run at once; the next call is served', async () => {
  const dir = tempUserDataDir()
  const page = createVmPage()
  const access = createAgentAccess({
    userDataDir: dir,
    page,
    loadDocuments: async () => fixture.CORPUS,
    logger: () => undefined,
  })
  await access.enable()
  const client = await connectSocket(access.socketPath)
  try {
    await handshake(client)
    client.send({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'run',
        arguments: {
          script:
            'async s => { s.edit(); await new Promise((resolve) => setTimeout(resolve, 1500)); s.edit(); return 1 }',
          label: 'cancelled',
          timeoutMs: 60_000,
        },
      },
    })
    // Let the handler start and reach the page, then cancel that request id.
    await new Promise((resolve) => setTimeout(resolve, 200))
    client.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 13, reason: 'the test does not need it' },
    })

    const startedAt = Date.now()
    client.send({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'run', arguments: { script: 's => s.history.depth()', label: 'next' } },
    })
    const answer = await client.receive(1500)
    const elapsed = Date.now() - startedAt
    assert.equal(answer.id, 14)
    assert.ok(elapsed < 700, `the next call waited ${elapsed} ms for the cancelled one`)
    assert.equal(JSON.parse(answer.result.content[0].text).value, 1)

    // The cancelled request gets no answer: MCP drops the response of an
    // aborted request. Its log line says TIMEOUT and did not wait 60 s.
    await assert.rejects(() => client.receive(150), /no message/)
    const lines = fs
      .readFileSync(agentLogPath(dir), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(lines.length, 2)
    assert.equal(lines[0].tool, 'run')
    assert.equal(lines[0].code, 'TIMEOUT')
    assert.ok(lines[0].durationMs < 1000, `logged ${lines[0].durationMs} ms for the cancelled call`)
    assert.equal(lines[1].code, 'OK')

    // The abandoned script ran to its end: its later edit is a second entry.
    await new Promise((resolve) => setTimeout(resolve, 1400))
    assert.equal(page.studio.depth(), 2)
  } finally {
    client.close()
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a fresh fake starts empty', () => {
  const studio = createFakeStudio()
  assert.equal(studio.depth(), 0)
  assert.deepEqual(studio.labels, [])
})
