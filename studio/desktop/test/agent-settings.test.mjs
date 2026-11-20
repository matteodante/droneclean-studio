/**
 * The "Allow AI agents" setting (task 2.2): off by default, in
 * `userData/agent-access.json`, with only the exact version-1 shape reading as
 * on. The socket's own off-by-default behaviour is in `agent-server.test.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  AGENT_ACCESS_DEFAULT,
  AGENT_ACCESS_OFF,
  isAgentAccessEnabled,
  readAgentAccessSettings,
  writeAgentAccessSettings,
} from '../out/main/mcp/settings.js'

function tempFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-agent-settings-'))
  return { dir, file: path.join(dir, 'agent-access.json') }
}

test('a profile without the file is on: agent access is on by default (Matteo, 20 Nov 2026)', () => {
  const { file } = tempFolder()
  assert.deepEqual(readAgentAccessSettings(file), AGENT_ACCESS_DEFAULT)
  assert.equal(isAgentAccessEnabled(file), true)
  assert.equal(fs.existsSync(file), false, 'reading writes nothing')
})

test('switched off, it stays off', () => {
  const { file } = tempFolder()
  writeAgentAccessSettings(file, { version: 1, enabled: false })
  assert.deepEqual(readAgentAccessSettings(file), AGENT_ACCESS_OFF)
})

test('a setting path that cannot be read (a folder) is off, not the default', () => {
  const { file } = tempFolder()
  fs.mkdirSync(file)
  assert.deepEqual(readAgentAccessSettings(file), AGENT_ACCESS_OFF)
})

test('on is written and read back; the file says version 1 and enabled', () => {
  const { file } = tempFolder()
  writeAgentAccessSettings(file, { version: 1, enabled: true })
  assert.deepEqual(readAgentAccessSettings(file), { version: 1, enabled: true })
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, enabled: true })
  writeAgentAccessSettings(file, { version: 1, enabled: false })
  assert.equal(isAgentAccessEnabled(file), false)
})

test('a broken or future file reads as off, never as an accident', () => {
  const { dir, file } = tempFolder()
  for (const contents of [
    '',
    '{',
    'null',
    '[]',
    '"on"',
    '{"version":2,"enabled":true}',
    '{"enabled":true}',
    '{"version":1,"enabled":"yes"}',
  ]) {
    fs.writeFileSync(file, contents)
    assert.equal(isAgentAccessEnabled(file), false, contents)
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
