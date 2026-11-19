/**
 * Review finding D9: every handler of the agent access IPC answers only the app's own frame.
 * Run on the real `mcp/ipc.js` against a stand-in `electron` (`test/support/fake-electron.cjs`).
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { afterEach, test } from 'node:test'
import { AGENT_ACCESS_CHANNELS } from '../out/shared/agent-access.js'

const require = createRequire(import.meta.url)
const { install } = require('./support/fake-electron.cjs')

let fake = null
afterEach(() => {
  fake?.restore()
  fake = null
})

function access() {
  return {
    socketPath: '/tmp/x.sock',
    isEnabled: () => false,
    status: () => 'off',
    enable: async () => {},
    disable: async () => {},
  }
}

test('every agent access channel refuses a foreign or missing sender frame', async () => {
  fake = install({ isPackaged: true })
  const { installAgentAccessIpc } = require('../out/main/mcp/ipc.js')
  installAgentAccessIpc(access())
  const channels = Object.values(AGENT_ACCESS_CHANNELS)
  assert.equal(channels.length, 4)
  for (const channel of channels) {
    const handler = fake.state.handles.get(channel)
    assert.ok(handler, `${channel} is registered`)
    await assert.rejects(async () => handler({ senderFrame: { url: 'https://evil.example/' } }), /only answers the app/, channel)
    await assert.rejects(async () => handler({ senderFrame: null }), /only answers the app/, channel)
    await assert.rejects(async () => handler({}), /only answers the app/, channel)
    await handler({ senderFrame: { url: 'droneclean://app/settings' } })
  }
})
