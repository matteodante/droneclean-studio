/**
 * One contender of `workspace-lock-race.test.mjs`: a Node process holding the
 * main process's real `WorkspaceOwnerLock` on the folder given as its argument,
 * with the tests' stand-in for `electron` (`fake-electron.cjs`).
 *
 * It says `{ id: 'ready' }` once it can take requests. The parent then sends
 * `{ id, op, at }`; the child waits until the wall clock reaches `at` (so both
 * contenders act in the same millisecond), runs the lock's `acquire()`,
 * `takeOver()` or `release()`, and answers `{ id, kind, owned, pid }` — or
 * `{ id, error }` when the lock threw, so the parent fails with the reason
 * instead of waiting. When the parent goes away (its IPC channel closes) the
 * child exits, so a killed test run leaves no process behind.
 */
import { createRequire } from 'node:module'
import path from 'node:path'

const workspaceDir = process.argv[2]
if (!workspaceDir) throw new Error('usage: workspace-claimer.mjs <workspace folder>')

// The compiled lock requires `electron`, and this is plain Node: the test's
// stand-in is registered first, so the real package (which has no binary in a
// folder installed without it, and would try to fetch one) is never loaded.
const require = createRequire(import.meta.url)
require('./fake-electron.cjs').install({
  userData: path.join(path.dirname(workspaceDir), 'electron-profile'),
})
const { WorkspaceOwnerLock } = require('../../out/main/workspace-lock.js')
const realElectron = Object.keys(require.cache).find((file) => file.includes(`${path.sep}node_modules${path.sep}electron${path.sep}`))
if (realElectron) throw new Error(`the real electron package was loaded (${realElectron})`)

const lock = new WorkspaceOwnerLock({ workspaceDir })

function run(op) {
  if (op === 'acquire') return lock.acquire().kind
  if (op === 'takeOver') return lock.takeOver().kind
  if (op === 'release') {
    lock.release()
    return 'released'
  }
  throw new Error(`unknown op ${op}`)
}

process.on('message', ({ id, op, at }) => {
  while (Date.now() < at) {
    // Spin: a timer would let the two contenders drift apart by a tick.
  }
  try {
    const kind = run(op)
    process.send({ id, kind, owned: lock.isOwned, pid: process.pid })
  } catch (error) {
    process.send({ id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  }
})

process.on('disconnect', () => process.exit(0))

process.send({ id: 'ready', pid: process.pid })
