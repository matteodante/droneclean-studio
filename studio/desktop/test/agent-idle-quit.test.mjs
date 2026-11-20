/**
 * An app the MCP launcher started quits when idle (task 11.15): the decision
 * and the watcher, against a fake clock; the save before the quit; and the
 * server's activity events over a real socket.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  IDLE_QUIT_MS,
  createIdleQuit,
  isIdleForQuit,
  saveBeforeQuit,
} from '../out/main/mcp/idle-quit.js'
import { PageUnavailableError } from '../out/main/mcp/page.js'
import { createAgentAccess } from '../out/main/mcp/server.js'
import { connectSocket } from './support/socket-client.mjs'

/** A clock the test moves by hand: `advance` runs the timers that fall due, in order. */
function createFakeClock() {
  let now = 0
  let next = 1
  const timers = new Map()
  return {
    timer: {
      set(callback, ms) {
        const id = next++
        timers.set(id, { at: now + ms, callback })
        return id
      },
      clear(id) {
        timers.delete(id)
      },
    },
    pending: () => timers.size,
    async advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, entry]) => entry.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        timers.delete(due[0])
        now = due[1].at
        due[1].callback()
        // Let the watcher's async save and quit settle.
        for (let i = 0; i < 5; i++) await Promise.resolve()
      }
      now = target
    },
  }
}

function watcher({ startedForAgent = true, saves = true } = {}) {
  const clock = createFakeClock()
  const log = { saves: 0, quits: 0 }
  const idle = createIdleQuit({
    startedForAgent,
    idleMs: 1000,
    timer: clock.timer,
    save: () => {
      log.saves += 1
      return Promise.resolve(saves)
    },
    quit: () => {
      log.quits += 1
    },
  })
  return { idle, clock, log }
}

test('the decision: only a hidden agent launch with nobody connected or calling is idle', () => {
  const idle = { startedForAgent: true, windowShown: false, clients: 0, calls: 0 }
  assert.equal(isIdleForQuit(idle), true)
  assert.equal(isIdleForQuit({ ...idle, startedForAgent: false }), false, 'the user opened the app')
  assert.equal(isIdleForQuit({ ...idle, windowShown: true }), false, 'a window was shown')
  assert.equal(isIdleForQuit({ ...idle, clients: 1 }), false, 'a client is connected')
  assert.equal(isIdleForQuit({ ...idle, calls: 1 }), false, 'a call is running')
})

test('a hidden launch nobody connects to saves and quits after the idle time', async () => {
  const { clock, log } = watcher()
  await clock.advance(999)
  assert.deepEqual(log, { saves: 0, quits: 0 })
  await clock.advance(1)
  assert.deepEqual(log, { saves: 1, quits: 1 })
})

test('a health check (connect, then leave) restarts the wait', async () => {
  const { idle, clock, log } = watcher()
  await clock.advance(900)
  idle.activity('client-connected')
  await clock.advance(5000)
  assert.equal(log.quits, 0, 'no quit while a client is connected')
  idle.activity('client-closed')
  await clock.advance(999)
  assert.equal(log.quits, 0, 'the wait starts again from the last client')
  await clock.advance(1)
  assert.equal(log.quits, 1)
})

test('a running call holds the app, however long and with no client counted', async () => {
  const { idle, clock, log } = watcher()
  idle.activity('client-connected')
  idle.activity('call-started')
  idle.activity('client-closed')
  await clock.advance(10 * 1000)
  assert.equal(log.quits, 0)
  idle.activity('call-ended')
  await clock.advance(1000)
  assert.equal(log.quits, 1)
})

test('two clients: the wait starts only when the last one has left', async () => {
  const { idle, clock, log } = watcher()
  idle.activity('client-connected')
  idle.activity('client-connected')
  idle.activity('client-closed')
  await clock.advance(5000)
  assert.equal(log.quits, 0)
  idle.activity('client-closed')
  await clock.advance(1000)
  assert.equal(log.quits, 1)
})

test('an app the user opened never quits by itself', async () => {
  const { idle, clock, log } = watcher({ startedForAgent: false })
  assert.equal(clock.pending(), 0, 'no timer at all')
  idle.activity('client-connected')
  idle.activity('client-closed')
  await clock.advance(10 * IDLE_QUIT_MS)
  assert.deepEqual(log, { saves: 0, quits: 0 })
})

test('a window that was shown ends the wait for good, even after the client leaves', async () => {
  const { idle, clock, log } = watcher()
  await clock.advance(500)
  idle.windowShown()
  assert.equal(clock.pending(), 0)
  idle.activity('client-connected')
  idle.activity('client-closed')
  await clock.advance(10 * IDLE_QUIT_MS)
  assert.deepEqual(log, { saves: 0, quits: 0 })
})

test('a save that leaves edits behind keeps the app up and tries again later', async () => {
  const { clock, log } = watcher({ saves: false })
  await clock.advance(1000)
  assert.deepEqual(log, { saves: 1, quits: 0 })
  await clock.advance(1000)
  assert.deepEqual(log, { saves: 2, quits: 0 })
})

test('a client that connects while the save runs keeps the app up', async () => {
  const clock = createFakeClock()
  let finishSave
  const log = { quits: 0 }
  const idle = createIdleQuit({
    startedForAgent: true,
    idleMs: 1000,
    timer: clock.timer,
    save: () => new Promise((resolve) => (finishSave = resolve)),
    quit: () => {
      log.quits += 1
    },
  })
  await clock.advance(1000)
  idle.activity('client-connected')
  finishSave(true)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.equal(log.quits, 0)
})

test('dispose stops the watcher', async () => {
  const { idle, clock, log } = watcher()
  idle.dispose()
  await clock.advance(10 * 1000)
  assert.deepEqual(log, { saves: 0, quits: 0 })
})

test('the save before quitting: kept, failed, no page, busy', async () => {
  const answering = (answer) => ({ execute: () => Promise.resolve(answer) })
  assert.equal(await saveBeforeQuit(answering({ kept: true })), true)
  assert.equal(await saveBeforeQuit(answering({ kept: false })), false)
  assert.equal(
    await saveBeforeQuit({
      execute: () => Promise.reject(new PageUnavailableError('no window', 'no-window')),
    }),
    true,
    'there is no page to hold edits',
  )
  assert.equal(
    await saveBeforeQuit({ execute: () => Promise.reject(new Error('busy')) }),
    false,
    'an unknown failure keeps the app up',
  )
})

test('the server reports connections and calls to the watcher', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-idle-'))
  const events = []
  const access = createAgentAccess({
    userDataDir: dir,
    page: { execute: () => Promise.reject(new PageUnavailableError('no window', 'no-window')) },
    loadDocuments: () => Promise.resolve([]),
    logger: () => undefined,
    onActivity: (event) => events.push(event),
  })
  await access.enable()
  const client = await connectSocket(access.socketPath)
  try {
    client.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    })
    await client.receive()
    client.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    client.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'split', limit: 1 } },
    })
    await client.receive()
    assert.deepEqual(events, ['client-connected', 'call-started', 'call-ended'])
  } finally {
    client.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await access.disable()
    fs.rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(events.at(-1), 'client-closed')
})
