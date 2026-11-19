/**
 * One owner of a workspace folder in the main process (task 2.3, design
 * `docs/designs/2.2-mcp.md` §4.10 layer 2): `.droneclean/owner.json`, who it is
 * live for, and how a stale owner is taken over.
 *
 * Every case drives the real class against a temporary folder, so the read, the
 * write, the atomic rename and the heartbeat are the ones the running app uses.
 * The clock, the token and the pid check are injected: the 60-second boundary and
 * a pid that is no longer running are not things a test can wait for.
 *
 * The preload is held to `shared/workspace-owner.ts` here too, as
 * `agent-access.test.mjs` holds the agent switch's preload to its shared module.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { mock } from 'node:test'
import { createRequire } from 'node:module'
import {
  WORKSPACE_OWNER_CHANNELS,
  WORKSPACE_OWNER_DIR,
  WORKSPACE_OWNER_FILE,
  WORKSPACE_OWNER_HEARTBEAT_MS,
  WORKSPACE_OWNER_LIVE_MS,
} from '../out/shared/workspace-owner.js'

const require = createRequire(import.meta.url)
const { install, FakeWebContents } = require('./support/fake-electron.cjs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-workspace-lock-'))
after(() => fs.rmSync(work, { recursive: true, force: true }))

// The compiled lock requires `electron`. No test loads the real package: in a
// folder installed without Electron's binary it would try to fetch one.
const electronForTheLock = install({ userData: path.join(work, 'electron-profile') })
after(() => electronForTheLock.restore())
const {
  WorkspaceOwnerHost,
  WorkspaceOwnerLock,
  isTemporaryFolder,
  isWorkspaceOwnerLive,
  parseWorkspaceOwnerRecord,
} = require('../out/main/workspace-lock.js')

const HOST = 'Mac.lan'
let folders = 0

/** A fresh workspace folder for one test. */
function workspace() {
  folders += 1
  const dir = path.join(work, `ws-${folders}`)
  fs.mkdirSync(dir)
  return dir
}

const ownerPath = (dir) => path.join(dir, WORKSPACE_OWNER_DIR, WORKSPACE_OWNER_FILE)

test('a workspace that cannot store the owner record is not granted ownership', (t) => {
  const dir = workspace()
  fs.writeFileSync(path.dirname(ownerPath(dir)), 'not a directory')
  const { lock } = lockFor(dir)
  t.after(() => lock.release())

  assert.deepEqual(lock.acquire(), { kind: 'blocked', stale: false })
  assert.equal(lock.isOwned, false)
  assert.deepEqual(lock.takeOver(), { kind: 'blocked', stale: false })
})

/** The design's record, as another instance would have written it. */
function record(overrides = {}) {
  return {
    version: 1,
    app: 'desktop',
    pid: 4242,
    host: HOST,
    startedAt: 1_000,
    heartbeatAt: 2_000,
    token: 'other-token',
    ...overrides,
  }
}

function writeRecord(dir, value) {
  fs.mkdirSync(path.dirname(ownerPath(dir)), { recursive: true })
  fs.writeFileSync(ownerPath(dir), JSON.stringify(value, null, 2))
}

function readRecord(dir) {
  return JSON.parse(fs.readFileSync(ownerPath(dir), 'utf8'))
}

/** A lock with a clock the test moves and a token it knows. */
function lockFor(dir, options = {}) {
  const clock = { now: options.now ?? 10_000 }
  const lock = new WorkspaceOwnerLock({
    workspaceDir: dir,
    pid: 777,
    hostname: HOST,
    now: () => clock.now,
    newToken: options.newToken ?? (() => 'our-token'),
    isPidAlive: options.isPidAlive ?? (() => true),
  })
  return { lock, clock }
}

test('the record has the shape the design gives, and nothing else is a record', () => {
  const parsed = parseWorkspaceOwnerRecord(JSON.stringify(record()))
  assert.deepEqual(parsed, record())
  assert.equal(parseWorkspaceOwnerRecord('{ not json'), null)
  assert.equal(parseWorkspaceOwnerRecord('null'), null)
  assert.equal(parseWorkspaceOwnerRecord('[]'), null)
  for (const broken of [
    record({ version: 2 }),
    record({ app: 'electron' }),
    record({ pid: '4242' }),
    record({ host: 3 }),
    record({ startedAt: 'yesterday' }),
    record({ heartbeatAt: null }),
    record({ token: '' }),
  ]) {
    assert.equal(parseWorkspaceOwnerRecord(JSON.stringify(broken)), null, JSON.stringify(broken))
  }
})

test('an owner is live while its heartbeat is younger than 60 s', () => {
  const check = (heartbeatAt, at = 60_000) => ({
    now: at,
    hostname: HOST,
    isPidAlive: () => true,
  })
  assert.equal(isWorkspaceOwnerLive(record({ heartbeatAt: 1 }), check(1)), true)
  assert.equal(
    isWorkspaceOwnerLive(record({ heartbeatAt: 1 }), check(1, 1 + WORKSPACE_OWNER_LIVE_MS - 1)),
    true,
  )
  assert.equal(
    isWorkspaceOwnerLive(record({ heartbeatAt: 1 }), check(1, 1 + WORKSPACE_OWNER_LIVE_MS)),
    false,
  )
})

test('only this app on this machine is checked for a running pid', () => {
  const at = (heartbeatAt) => ({ now: heartbeatAt + 1_000, hostname: HOST, isPidAlive: () => false })
  assert.equal(isWorkspaceOwnerLive(record({ app: 'web', pid: 0, host: '' }), at(2_000)), true)
  assert.equal(isWorkspaceOwnerLive(record({ host: 'Other-Mac' }), at(2_000)), true)
  assert.equal(isWorkspaceOwnerLive(record(), at(2_000)), false, 'dead pid on this host')
  const unknown = { now: 3_000, hostname: HOST, isPidAlive: () => null }
  assert.equal(isWorkspaceOwnerLive(record(), unknown), true, 'a pid it cannot check stays live')
})

test('a folder nobody holds is taken, and the record is the design’s', () => {
  const dir = workspace()
  const { lock } = lockFor(dir)
  assert.deepEqual(lock.acquire(), { kind: 'owned' })
  assert.deepEqual(readRecord(dir), {
    version: 1,
    app: 'desktop',
    pid: 777,
    host: HOST,
    startedAt: 10_000,
    heartbeatAt: 10_000,
    token: 'our-token',
  })
  assert.equal(fs.statSync(ownerPath(dir)).mode & 0o777, 0o600)
  assert.equal(
    fs.readdirSync(path.dirname(ownerPath(dir))).filter((name) => name.endsWith('.tmp')).length,
    0,
    'no temporary file is left behind',
  )
  lock.release()
})

test('a poll reports the folder without taking it', () => {
  const dir = workspace()
  const { lock } = lockFor(dir)
  assert.deepEqual(lock.status(), { kind: 'free' })
  assert.equal(fs.existsSync(ownerPath(dir)), false, 'a poll writes nothing')
  lock.acquire()
  assert.deepEqual(lock.status(), { kind: 'owned' })
  lock.release()
  assert.deepEqual(lock.status(), { kind: 'free' })
  assert.equal(fs.existsSync(ownerPath(dir)), false)
})

test('a second claim keeps the start and moves the heartbeat', () => {
  const dir = workspace()
  const { lock, clock } = lockFor(dir)
  lock.acquire()
  clock.now += 5_000
  assert.deepEqual(lock.acquire(), { kind: 'owned' })
  assert.equal(readRecord(dir).startedAt, 10_000)
  assert.equal(readRecord(dir).heartbeatAt, 15_000)
  lock.release()
})

test('a live owner blocks the folder, names itself and is left untouched', () => {
  const dir = workspace()
  const other = record({ heartbeatAt: 9_500 })
  writeRecord(dir, other)
  const { lock } = lockFor(dir, { isPidAlive: () => true })
  const status = lock.acquire()
  assert.equal(status.kind, 'blocked')
  assert.equal(status.stale, false)
  assert.deepEqual(status.holder, { app: 'desktop', startedAt: 1_000, heartbeatAt: 9_500 })
  assert.deepEqual(readRecord(dir), other)
  assert.deepEqual(lock.takeOver(), status, 'a live owner is never displaced')
  assert.deepEqual(readRecord(dir), other)
  lock.release()
})

test('a killed owner is stale at once, and Take over takes its place', () => {
  const dir = workspace()
  writeRecord(dir, record({ heartbeatAt: 9_500 }))
  const { lock } = lockFor(dir, { isPidAlive: () => false })
  const status = lock.acquire()
  assert.equal(status.kind, 'blocked')
  assert.equal(status.stale, true, 'a dead pid on this machine is stale before the 60 s')

  const taken = lock.takeOver()
  assert.deepEqual(taken, { kind: 'owned' })
  const written = readRecord(dir)
  assert.equal(written.token, 'our-token')
  assert.equal(written.pid, 777)
  assert.equal(written.startedAt, 10_000)
  lock.release()
})

test('an owner the shell cannot check goes stale after 60 s, and not before', () => {
  const dir = workspace()
  writeRecord(dir, record({ app: 'web', pid: 0, host: '', heartbeatAt: 10_000 }))
  const { lock, clock } = lockFor(dir, { isPidAlive: () => true })
  assert.equal(lock.acquire().stale, false)
  clock.now = 10_000 + WORKSPACE_OWNER_LIVE_MS - 1
  assert.equal(lock.acquire().stale, false)
  clock.now = 10_000 + WORKSPACE_OWNER_LIVE_MS
  const status = lock.acquire()
  assert.equal(status.stale, true)
  assert.deepEqual(status.holder, { app: 'web', startedAt: 1_000, heartbeatAt: 10_000 })
  assert.deepEqual(lock.takeOver(), { kind: 'owned' })
  lock.release()
})

test('release removes this process’s record and nobody else’s', () => {
  const dir = workspace()
  const { lock } = lockFor(dir)
  lock.acquire()
  lock.release()
  assert.equal(fs.existsSync(ownerPath(dir)), false)

  const other = record()
  writeRecord(dir, other)
  const second = lockFor(dir).lock
  second.release()
  assert.deepEqual(readRecord(dir), other, 'a release without the lock leaves the file alone')
})

test('a file that holds no record is replaced only after 60 s and a click', () => {
  // An owner that is writing its record right now is, for an instant, a file
  // that holds no record; so is a record another program left. Neither can be
  // told apart from here, so neither is replaced at once.
  const dir = workspace()
  fs.mkdirSync(path.dirname(ownerPath(dir)), { recursive: true })
  fs.writeFileSync(ownerPath(dir), 'half a record, from something else\n')
  fs.utimesSync(ownerPath(dir), 0, 0)
  const { lock, clock } = lockFor(dir)
  assert.deepEqual(lock.acquire(), { kind: 'blocked', stale: false })
  assert.deepEqual(lock.takeOver(), { kind: 'blocked', stale: false })
  assert.equal(fs.readFileSync(ownerPath(dir), 'utf8'), 'half a record, from something else\n')

  clock.now = WORKSPACE_OWNER_LIVE_MS
  assert.deepEqual(lock.acquire(), { kind: 'blocked', stale: true }, 'a claim never replaces it')
  assert.deepEqual(lock.takeOver(), { kind: 'owned' })
  assert.equal(readRecord(dir).token, 'our-token')
  lock.release()
})

test('an owner whose record was replaced is told so, and stops writing', () => {
  const dir = workspace()
  const { lock } = lockFor(dir, { isPidAlive: () => true })
  assert.deepEqual(lock.acquire(), { kind: 'owned' })
  const other = record({ heartbeatAt: 9_900, token: 'winner-token' })
  fs.writeFileSync(ownerPath(dir), JSON.stringify(other))

  const status = lock.status()
  assert.equal(status.kind, 'blocked', 'the poll reads the folder, not a remembered answer')
  assert.equal(status.stale, false)
  assert.deepEqual(status.holder, { app: 'desktop', startedAt: 1_000, heartbeatAt: 9_900 })
  assert.equal(lock.isOwned, false)
  assert.deepEqual(lock.acquire().kind, 'blocked', 'nor does a second claim take it back')
  lock.release()
  assert.deepEqual(readRecord(dir), other, 'and the winner’s record is left alone')
})

test('an owner whose record was removed is told so, and does not write it again', () => {
  const dir = workspace()
  const { lock } = lockFor(dir)
  lock.acquire()
  fs.rmSync(ownerPath(dir))
  assert.deepEqual(lock.status(), { kind: 'free' })
  assert.equal(lock.isOwned, false)
  assert.equal(fs.existsSync(ownerPath(dir)), false)
})

/** The page's proof that `dir` is its workspace: `.droneclean/claim-<nonce>`, written through its handle. */
function prove(dir, nonce) {
  fs.mkdirSync(path.join(dir, WORKSPACE_OWNER_DIR), { recursive: true })
  fs.writeFileSync(path.join(dir, WORKSPACE_OWNER_DIR, `claim-${nonce}`), nonce)
}

/**
 * A host whose locks read no real clock, pid or host name, and whose heartbeat
 * runs only when the test ticks it: nothing in these cases depends on how busy
 * the machine is. The test folders live in the system's temporary folder, which
 * the shell refuses (review finding E1), so a case names its temporary roots.
 */
function hostFor(t, temporaryRoots = []) {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const host = new WorkspaceOwnerHost(
    {
      pid: 777,
      hostname: HOST,
      now: () => 10_000,
      newToken: () => 'our-token',
      isPidAlive: () => true,
    },
    { temporaryRoots },
  )
  t.after(() => host.release())
  return host
}

test('the shell takes the folder the page proves, not the first folder it was shown', (t) => {
  const footage = workspace()
  const dir = workspace()
  const host = hostFor(t)
  host.observe(footage)
  host.observe(dir)
  assert.equal(fs.existsSync(path.join(footage, WORKSPACE_OWNER_DIR)), false, 'seeing a folder writes nothing')

  const nonce = '6f1c2a4e-9d3b-4c55-8e21-0a7b3c9d1e2f'
  prove(dir, nonce)
  assert.deepEqual(host.acquire(nonce), { kind: 'owned' })
  assert.equal(readRecord(dir).pid, 777)
  assert.equal(fs.existsSync(path.join(footage, WORKSPACE_OWNER_DIR)), false, 'the footage folder is untouched')
})

test('a claim the shell cannot place is unowned and writes nothing', (t) => {
  const dir = workspace()
  const host = hostFor(t)
  host.observe(dir)
  assert.deepEqual(host.acquire('0d6c9f0e-1b2a-4c3d-8e4f-5a6b7c8d9e0f'), { kind: 'unowned' })
  assert.deepEqual(host.acquire('../../etc'), { kind: 'unowned' })
  assert.deepEqual(host.acquire(undefined), { kind: 'unowned' })
  assert.equal(fs.existsSync(path.join(dir, WORKSPACE_OWNER_DIR)), false)
})

test('a workspace switch moves the lock to the new folder', (t) => {
  const first = workspace()
  const second = workspace()
  const host = hostFor(t)

  host.observe(first)
  prove(first, '11111111-2222-4333-8444-555555555555')
  assert.deepEqual(host.acquire('11111111-2222-4333-8444-555555555555'), { kind: 'owned' })
  assert.equal(fs.existsSync(ownerPath(first)), true)

  // The indicator reloads the page; the page proves the new folder.
  host.observe(second)
  prove(second, '66666666-7777-4888-8999-aaaaaaaaaaaa')
  assert.deepEqual(host.acquire('66666666-7777-4888-8999-aaaaaaaaaaaa'), { kind: 'owned' })
  assert.equal(readRecord(second).pid, 777, 'the new folder is held')
  assert.equal(fs.existsSync(ownerPath(first)), false, 'the old folder is given back')

  // And back again, as a second switch would.
  prove(first, 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff')
  assert.deepEqual(host.acquire('bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'), { kind: 'owned' })
  assert.equal(fs.existsSync(ownerPath(first)), true)
  assert.equal(fs.existsSync(ownerPath(second)), false)
})

test('the heartbeat refreshes every 5 s while the record is ours', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const dir = workspace()
  const { lock, clock } = lockFor(dir)
  lock.acquire()
  const started = readRecord(dir)
  clock.now = 15_000
  t.mock.timers.tick(WORKSPACE_OWNER_HEARTBEAT_MS)
  const refreshed = readRecord(dir)
  assert.equal(refreshed.token, started.token)
  assert.equal(refreshed.heartbeatAt, 15_000)
  lock.release()
  t.mock.timers.reset()
})

test('the heartbeat stops instead of overwriting another owner’s live record', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const dir = workspace()
  const { lock, clock } = lockFor(dir, { isPidAlive: () => true })
  lock.acquire()
  const ours = readRecord(dir)
  clock.now = 15_000
  const other = record({ heartbeatAt: 14_900, token: 'winner-token' })
  fs.writeFileSync(ownerPath(dir), JSON.stringify(other))
  t.mock.timers.tick(WORKSPACE_OWNER_HEARTBEAT_MS)
  assert.deepEqual(readRecord(dir), other, 'the other owner’s record is not touched')
  clock.now = 20_000
  t.mock.timers.tick(WORKSPACE_OWNER_HEARTBEAT_MS)
  assert.deepEqual(readRecord(dir), other, 'and the heartbeat stays stopped')
  assert.notEqual(ours.token, readRecord(dir).token)
  lock.release()
  t.mock.timers.reset()
})

test('the preload carries the main process’s channels and loads nothing but electron', () => {
  const here = path.dirname(new URL(import.meta.url).pathname)
  const preload = fs.readFileSync(
    path.resolve(here, '..', 'out', 'preload', 'workspace-owner.js'),
    'utf8',
  )
  for (const [member, channel] of Object.entries(WORKSPACE_OWNER_CHANNELS)) {
    assert.ok(preload.includes(`'${channel}'`), `the preload carries ${member} as ${channel}`)
  }
  const required = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(required)], ['electron'])
  assert.match(preload, /exposeInMainWorld\('dronecleanWorkspaceOwner'/)
  assert.equal(preload.match(/exposeInMainWorld\(/g)?.length, 1)
  for (const method of ['acquire', 'status', 'takeOver', 'close']) {
    assert.match(preload, new RegExp(`${method}\\(`), `the bridge has ${method}()`)
  }
})

test('no case here loads the real electron package', () => {
  const real = Object.keys(require.cache).filter((file) =>
    file.includes(`${path.sep}node_modules${path.sep}electron${path.sep}`),
  )
  assert.deepEqual(real, [], 'the compiled lock reached the real electron instead of fake-electron.cjs')
})

test('the names the shell and the page agree on are the design’s file', () => {
  assert.equal(WORKSPACE_OWNER_DIR, '.droneclean')
  assert.equal(WORKSPACE_OWNER_FILE, 'owner.json')
  assert.equal(WORKSPACE_OWNER_HEARTBEAT_MS, 5_000)
  assert.equal(WORKSPACE_OWNER_LIVE_MS, 60_000)
})

// ── A workspace in a temporary folder is refused (review finding E1) ──────────

/** A folder in `parent`, made for this test. */
function folderIn(parent, name) {
  const dir = path.join(parent, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

test('E1: a folder inside a temporary location is temporary, a normal folder is not', () => {
  const temporary = folderIn(workspace(), 'tmp')
  const normal = folderIn(workspace(), 'documents')
  const inside = folderIn(temporary, 'projects/Domenica')
  assert.equal(isTemporaryFolder(inside, [temporary]), true)
  assert.equal(isTemporaryFolder(temporary, [temporary]), true, 'the temporary folder itself')
  assert.equal(isTemporaryFolder(normal, [temporary]), false)
  assert.equal(isTemporaryFolder(os.homedir()), false, 'with the real locations, the home folder is normal')
  assert.equal(isTemporaryFolder(os.tmpdir()), true)
  assert.equal(isTemporaryFolder(path.join(os.tmpdir(), 'droneclean-e2e-x', 'workspace')), true)
})

test('E1: a symlink into a temporary folder is temporary (real paths are compared)', () => {
  const temporary = folderIn(workspace(), 'tmp')
  const target = folderIn(temporary, 'real-workspace')
  const links = workspace()
  const link = path.join(links, 'My projects')
  fs.symlinkSync(target, link)
  assert.equal(isTemporaryFolder(link, [temporary]), true)
  // And the other way round: a symlink named inside the temporary folder that leads out is not.
  const outside = folderIn(workspace(), 'documents')
  const leaving = path.join(temporary, 'leaving')
  fs.symlinkSync(outside, leaving)
  assert.equal(isTemporaryFolder(leaving, [temporary]), false)
})

test('E1: the shell refuses to hold a workspace in a temporary folder and writes nothing there', (t) => {
  const dir = workspace()
  const host = hostFor(t, [work])
  host.observe(dir)
  const nonce = 'e1e1e1e1-2222-4333-8444-555555555555'
  prove(dir, nonce)
  assert.deepEqual(host.acquire(nonce), { kind: 'temporary' })
  assert.equal(fs.existsSync(ownerPath(dir)), false, 'no owner record in the refused folder')
  assert.deepEqual(host.status(), { kind: 'temporary' }, 'the page polls the same answer')
  assert.deepEqual(host.takeOver(), { kind: 'temporary' })
})

test('E1: after a temporary folder, a normal one is held again', (t) => {
  const temporary = workspace()
  const normal = folderIn(path.dirname(temporary), 'elsewhere')
  const host = hostFor(t, [temporary])
  host.observe(temporary)
  host.observe(normal)
  prove(temporary, 'a1a1a1a1-2222-4333-8444-555555555555')
  assert.deepEqual(host.acquire('a1a1a1a1-2222-4333-8444-555555555555'), { kind: 'temporary' })
  prove(normal, 'b2b2b2b2-2222-4333-8444-555555555555')
  assert.deepEqual(host.acquire('b2b2b2b2-2222-4333-8444-555555555555'), { kind: 'owned' })
  assert.equal(readRecord(normal).pid, 777)
})

// ── Every handler checks the sender (review finding D9) ───────────────────────

const APP_FRAME = { url: 'droneclean://app/projects' }
const FOREIGN_FRAME = { url: 'https://evil.example/' }

test('D9: every workspace-owner handler refuses a sender that is not the app page', async () => {
  const outMain = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../out')
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(outMain)) delete require.cache[key]
  }
  const fake = install()
  try {
    const electron = require('electron')
    let quits = 0
    electron.app.quit = () => {
      quits += 1
    }
    const { installWorkspaceOwnerLock } = require('../out/main/workspace-lock.js')
    const host = installWorkspaceOwnerLock(electron.session.defaultSession)
    let released = 0
    const release = host.release.bind(host)
    host.release = () => {
      released += 1
      release()
    }
    const { handles, listeners } = fake.state
    const sender = new FakeWebContents(1)

    for (const channel of [
      WORKSPACE_OWNER_CHANNELS.acquire,
      WORKSPACE_OWNER_CHANNELS.status,
      WORKSPACE_OWNER_CHANNELS.takeOver,
    ]) {
      const handler = handles.get(channel)
      assert.ok(handler, `${channel} is registered`)
      for (const senderFrame of [FOREIGN_FRAME, null]) {
        assert.throws(
          () => handler({ sender, senderFrame }, 'c1c1c1c1-2222-4333-8444-555555555555'),
          { name: 'ForeignSenderError' },
          `${channel} refuses ${senderFrame?.url ?? 'a destroyed frame'}`,
        )
      }
    }
    assert.deepEqual(
      handles.get(WORKSPACE_OWNER_CHANNELS.status)({ sender, senderFrame: APP_FRAME }),
      { kind: 'unowned' },
      'the app page is answered',
    )

    const close = listeners.get(WORKSPACE_OWNER_CHANNELS.close)
    assert.ok(close, 'close is registered')
    close({ sender, senderFrame: FOREIGN_FRAME })
    assert.equal(quits, 0, 'a foreign close does not quit the app')
    assert.equal(released, 0, 'and does not give the folder back')
    close({ sender, senderFrame: APP_FRAME })
    assert.equal(quits, 1, 'the app page can close the app')
  } finally {
    fake.restore()
  }
})
