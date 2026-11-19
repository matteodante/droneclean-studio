/**
 * Two processes claiming one workspace folder at the same instant never both own
 * it (task 2.3, review finding D1).
 *
 * Each contender is a separate Node process (`support/workspace-claimer.mjs`)
 * holding the main process's real `WorkspaceOwnerLock` on one shared folder, as
 * two desktop apps with different profiles would. Every round the parent tells
 * both to act at the same millisecond and counts who answers "owned": a lock
 * whose read and write are separate steps lets both through, and one round of
 * two hundred is enough to show it.
 *
 * The second test does the same for Take over: both contenders replace one
 * record whose owner stopped signalling two minutes ago, the record Take over is
 * allowed to replace. (A record of a dead pid would do as well, but a busy
 * machine can give that pid to a new process during the run.)
 *
 * The test must fail, never hang, on a loaded machine: every request to a child
 * and the start of each child has a time limit that fails the test with what was
 * awaited; a child that exits or cannot start fails every request still waiting
 * on it, with its stderr; and the children are killed in a `finally`. Readiness
 * and the end of each step are messages from the child, never a fixed sleep.
 */
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { WORKSPACE_OWNER_DIR, WORKSPACE_OWNER_FILE } from '../out/shared/workspace-owner.js'

const ROUNDS = 200
/** A child's start: Node, then the compiled lock. Generous, for a machine with every core busy. */
const START_LIMIT_MS = 30_000
/** One step of one child: a claim or a release is a few file operations. */
const STEP_LIMIT_MS = 20_000
/** A killed child is gone at once; this only keeps a stuck kill from hanging the run. */
const STOP_LIMIT_MS = 10_000
/** The whole test, as a backstop behind the limits above. */
const TEST_LIMIT_MS = 180_000

const here = path.dirname(new URL(import.meta.url).pathname)
const claimer = path.join(here, 'support', 'workspace-claimer.mjs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-workspace-race-'))
after(() => fs.rmSync(work, { recursive: true, force: true }))

/**
 * A contender: a child process, and requests to it that each settle — with the
 * answer, with the child's own error, or with a clear failure when the child
 * exits or the time limit passes.
 */
function contender(name, workspaceDir) {
  const child = fork(claimer, [workspaceDir], {
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let output = ''
  const collect = (chunk) => {
    output = `${output}${chunk}`.slice(-4_000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  /** Requests waiting for an answer, by id. */
  const waiting = new Map()
  let ended = null
  const failAll = (reason) => {
    ended = reason
    for (const [id, request] of waiting) {
      clearTimeout(request.timer)
      request.reject(new Error(`${name} contender ${reason} while the test waited for ${id}${tail()}`))
    }
    waiting.clear()
  }
  const tail = () => (output.trim() ? `\n--- its output ---\n${output.trim()}` : '')

  child.on('message', (message) => {
    const request = waiting.get(message.id)
    if (!request) return
    waiting.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(`${name} contender failed ${message.id}: ${message.error}`))
    else request.resolve(message)
  })
  child.on('exit', (code, signal) => failAll(`exited (code ${code}, signal ${signal})`))
  child.on('error', (error) => failAll(`could not run (${error.message})`))

  /** Wait for the answer with this id, for at most `limit` milliseconds. */
  function answer(id, limit) {
    if (ended) return Promise.reject(new Error(`${name} contender ${ended}${tail()}`))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error(`${name} contender gave no answer to ${id} within ${limit} ms${tail()}`))
      }, limit)
      waiting.set(id, { resolve, reject, timer })
    })
  }

  const ready = answer('ready', START_LIMIT_MS)
  // A start that fails is reported by the await below; this keeps it from also
  // being reported as unhandled when the other contender fails first.
  ready.catch(() => undefined)
  let next = 0

  return {
    ready,
    ask(op, at) {
      next += 1
      const id = `${op} #${next}`
      const answered = answer(id, STEP_LIMIT_MS)
      if (!ended) {
        try {
          child.send({ id, op, at }, (error) => {
            if (error) failAll(`could not be sent ${id} (${error.message})`)
          })
        } catch (error) {
          failAll(`could not be sent ${id} (${error.message})`)
        }
      }
      return answered
    },
    /** Kill the child and wait until it is gone; a child that already exited is left as it is. */
    stop() {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${name} contender (pid ${child.pid}) did not exit after SIGKILL`)),
          STOP_LIMIT_MS,
        )
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        child.kill('SIGKILL')
      })
    },
  }
}

async function race(op, prepare) {
  const dir = fs.mkdtempSync(path.join(work, 'ws-'))
  const ownerPath = path.join(dir, WORKSPACE_OWNER_DIR, WORKSPACE_OWNER_FILE)
  const a = contender('first', dir)
  const b = contender('second', dir)
  const wins = { a: 0, b: 0 }
  try {
    await Promise.all([a.ready, b.ready])
    for (let round = 0; round < ROUNDS; round += 1) {
      prepare?.(ownerPath)
      const at = Date.now() + 3
      const [first, second] = await Promise.all([a.ask(op, at), b.ask(op, at)])
      assert.ok(!(first.owned && second.owned), `round ${round}: both processes own the folder`)
      if (first.owned) wins.a += 1
      if (second.owned) wins.b += 1
      if (first.owned || second.owned) {
        const winner = first.owned ? first : second
        const onDisk = JSON.parse(fs.readFileSync(ownerPath, 'utf8'))
        assert.equal(onDisk.pid, winner.pid, `round ${round}: the record names the winner`)
      }
      await Promise.all([a.ask('release', 0), b.ask('release', 0)])
      assert.equal(fs.existsSync(ownerPath), false, `round ${round}: release leaves the folder free`)
    }
  } finally {
    await Promise.all([a.stop(), b.stop()])
  }
  return wins
}

test(
  `two processes claiming one free folder ${ROUNDS} times never both own it`,
  { timeout: TEST_LIMIT_MS },
  async () => {
    const wins = await race('acquire')
    assert.equal(wins.a + wins.b, ROUNDS, 'every round has exactly one owner')
  },
)

test(
  `two processes taking over one silent owner ${ROUNDS} times never both own it`,
  { timeout: TEST_LIMIT_MS },
  async () => {
    const wins = await race('takeOver', (ownerPath) => {
      fs.mkdirSync(path.dirname(ownerPath), { recursive: true })
      const silentSince = Date.now() - 120_000
      fs.writeFileSync(
        ownerPath,
        JSON.stringify({
          version: 1,
          app: 'desktop',
          pid: 4242,
          host: 'another-machine',
          startedAt: silentSince,
          heartbeatAt: silentSince,
          token: 'silent-owner',
        }),
      )
    })
    assert.equal(wins.a + wins.b, ROUNDS, 'every round has exactly one owner')
  },
)
