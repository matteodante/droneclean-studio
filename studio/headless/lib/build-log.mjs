// Run a command whose log is bigger than a spawn buffer, and say why it failed.
//
// The app build prints a line per emitted asset, and the bundle now carries about 10,000 font
// files: over 1 MiB of log, which is `spawnSync`'s default `maxBuffer`. A buffered build is
// killed with ENOBUFS, and `status` is then null — indistinguishable from "the build failed"
// unless the caller looks at `error` and `signal`. These helpers write the child's output
// straight to a file (the parent never holds it) and describe a failure in the child's terms.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Run `command` with stdout and stderr written to `logPath`, creating its folder if needed.
 * Nothing is buffered in this process, so no output size can kill the child.
 */
export function runToLog(command, args, { cwd, logPath, env = process.env }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  const descriptor = fs.openSync(logPath, 'w')
  try {
    return spawnSync(command, args, { cwd, env, stdio: ['ignore', descriptor, descriptor] })
  } finally {
    fs.closeSync(descriptor)
  }
}

/** The last `bytes` of a log file, for an error message: never the whole build log. */
export function tailOf(logPath, bytes = 8000) {
  const { size } = fs.statSync(logPath)
  const length = Math.min(size, bytes)
  if (length === 0) return ''
  const buffer = Buffer.alloc(length)
  const descriptor = fs.openSync(logPath, 'r')
  try {
    fs.readSync(descriptor, buffer, 0, length, size - length)
  } finally {
    fs.closeSync(descriptor)
  }
  return buffer.toString('utf8')
}

/**
 * Why a child did not finish, in its own terms: the spawn error's code (ENOBUFS, ENOENT, …),
 * the signal that killed it, or its exit code.
 */
export function describeFailure(result) {
  if (result.error) return `${result.error.code ?? 'error'}: ${result.error.message}`
  if (result.signal) return `killed by ${result.signal}`
  return `exited with code ${result.status}`
}
