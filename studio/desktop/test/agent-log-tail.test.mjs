/**
 * The read side of the agent log (task 2.2 slice 7): the Agent access panel's
 * last 50 lines.
 *
 * What is pinned: a profile with no log is empty, not an error; the last 50
 * physical entries are answered oldest first; what `createAgentLog` appends is
 * what the panel reads; and a line that is not an `AgentLogLine` is skipped
 * rather than rendered.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  PANEL_LOG_LINES,
  agentLogLine,
  createAgentLog,
  readAgentLogTail,
} from '../out/main/mcp/log.js'

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-agent-log-'))
  return { dir, file: path.join(dir, '2026-11-18.jsonl') }
}

/** One line about a `search` call, with a chosen summary and time. */
function line(summary, at = '2026-11-18T10:00:00.000Z') {
  return {
    ...agentLogLine('search', { query: summary }, { at: new Date(at), durationMs: 4, code: 'OK' }),
  }
}

test('a profile without a log folder reads as an empty list', async () => {
  const { dir, file } = tempFile()
  assert.deepEqual(await readAgentLogTail(dir), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the last 50 entries are answered, oldest first', async () => {
  assert.equal(PANEL_LOG_LINES, 50)
  const { dir, file } = tempFile()
  const lines = Array.from({ length: 60 }, (_, index) =>
    line(`call ${index}`, new Date(Date.UTC(2026, 10, 18, 10, 0, index)).toISOString()),
  )
  fs.writeFileSync(file, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`)

  const tail = await readAgentLogTail(dir)
  assert.equal(tail.length, 50)
  assert.equal(tail[0].summary, 'search "call 10"')
  assert.equal(tail[49].summary, 'search "call 59"')

  const short = await readAgentLogTail(dir, 3)
  assert.deepEqual(
    short.map((entry) => entry.summary),
    ['search "call 57"', 'search "call 58"', 'search "call 59"'],
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('what the server appends is what the panel reads', async () => {
  const { dir, file } = tempFile()
  const log = createAgentLog(dir)
  await log.append(
    agentLogLine(
      'run',
      { script: 'studio.clips.list()', label: 'list' },
      { durationMs: 12, code: 'OK', undoSteps: 1 },
    ),
  )
  await log.append(
    agentLogLine(
      'frame',
      { frame: 120 },
      { durationMs: 300, code: 'TIMEOUT', error: 'the frame took too long' },
    ),
  )

  const tail = await readAgentLogTail(dir)
  assert.equal(tail.length, 2)
  assert.equal(tail[0].tool, 'run')
  assert.equal(tail[0].undoSteps, 1)
  assert.equal(tail[1].tool, 'frame')
  assert.equal(tail[1].code, 'TIMEOUT')
  assert.equal(tail[1].error, 'the frame took too long')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a line this build cannot render is skipped, not guessed at', async () => {
  const { dir, file } = tempFile()
  const good = line('kept')
  const broken = [
    '{',
    'null',
    '[]',
    '{"at":1,"tool":"search","argsHash":"x","summary":"s","durationMs":1,"code":"OK"}',
    '{"at":"2026-11-18T10:00:00.000Z","tool":"unknown","argsHash":"x","summary":"s","durationMs":1,"code":"OK"}',
    '{"at":"2026-11-18T10:00:00.000Z","tool":"search","argsHash":"x","summary":"s","durationMs":1,"code":"OK","error":7}',
  ]
  fs.writeFileSync(file, `${[...broken, JSON.stringify(good)].join('\n')}\n`)

  const tail = await readAgentLogTail(dir)
  assert.equal(tail.length, 1)
  assert.equal(tail[0].summary, 'search "kept"')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('an unreadable log folder is an error, not an empty log', async () => {
  const { dir } = tempFile()
  fs.rmSync(dir, { recursive: true, force: true })
  fs.writeFileSync(dir, 'a file where the folder should be')
  await assert.rejects(() => readAgentLogTail(dir))
  fs.rmSync(dir, { force: true })
})
