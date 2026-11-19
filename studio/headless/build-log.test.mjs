import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describeFailure, runToLog, tailOf } from './lib/build-log.mjs'

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-build-log-'))

test('a long build log goes to a file, not into the spawn buffer', () => {
  const logPath = path.join(tempDir(), 'nested', 'build.log')
  // About 1.7 MiB of output: more than spawnSync's default 1 MiB maxBuffer.
  const script = 'for (let i = 0; i < 60000; i++) console.log("asset-" + i + ".woff2 emitted")'
  const result = runToLog(process.execPath, ['-e', script], { cwd: process.cwd(), logPath })

  assert.equal(result.status, 0)
  assert.equal(result.stdout, null)
  assert.ok(fs.statSync(logPath).size > 1024 * 1024)
  assert.match(tailOf(logPath, 64), /asset-59999\.woff2 emitted\n$/)
})

test('a killed build reports the signal, not a missing exit code', () => {
  const logPath = path.join(tempDir(), 'build.log')
  const result = runToLog(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], {
    cwd: process.cwd(),
    logPath,
  })

  assert.equal(result.status, null)
  assert.equal(describeFailure(result), 'killed by SIGTERM')
})

test('a failed build reports its exit code and a spawn error its code', () => {
  const logPath = path.join(tempDir(), 'build.log')
  const failed = runToLog(process.execPath, ['-e', 'console.error("boom"); process.exit(3)'], {
    cwd: process.cwd(),
    logPath,
  })
  assert.equal(describeFailure(failed), 'exited with code 3')
  assert.match(tailOf(logPath), /boom/)

  const missing = runToLog(path.join(tempDir(), 'no-such-command'), [], {
    cwd: process.cwd(),
    logPath,
  })
  assert.match(describeFailure(missing), /^ENOENT: .*no-such-command ENOENT$/)
})

test('tailOf returns the end of the file, or the whole file when it is shorter', () => {
  const logPath = path.join(tempDir(), 'build.log')
  fs.writeFileSync(logPath, `${'x'.repeat(100)}THE END`)
  assert.equal(tailOf(logPath, 7), 'THE END')
  assert.equal(tailOf(logPath), `${'x'.repeat(100)}THE END`)
  fs.writeFileSync(logPath, '')
  assert.equal(tailOf(logPath), '')
})
