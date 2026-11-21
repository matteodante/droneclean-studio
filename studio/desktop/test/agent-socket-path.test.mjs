/**
 * A profile whose path is too long for a Unix socket (audit of 21 Nov 2026): `bind` and `connect` refuse a path longer
 * than `sockaddr_un` holds (measured on this Mac with Node 24.14: 104 bytes bind, 105 fail with EINVAL), so such a
 * profile had no agent access at all. Its socket now moves to `/tmp/droneclean-mcp-<uid>/<profile hash>.sock`, in a
 * folder made 0700 and checked; the launcher computes the same path and refuses a folder that is not the user's.
 *
 * The rule is tested on fake homes; the server, the folder and the launcher on the real `/tmp`.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as fixture from '../../mcp/fixture.mjs'
import * as launcher from '../../mcp/launcher.mjs'
import * as protocol from '../out/main/mcp/protocol.js'
import { createAgentAccess } from '../out/main/mcp/server.js'
import { preparePrivateSocketDir } from '../out/main/mcp/socket-dir.js'
import { createVmPage } from './support/fake-page.mjs'
import { connectSocket } from './support/socket-client.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LAUNCHER = path.resolve(HERE, '..', '..', 'mcp', 'launcher.mjs')
const POSIX = process.platform !== 'win32'
const UID = POSIX ? process.getuid() : -1

/** The default profile of a user whose home is `home`, as Electron and the launcher place it. */
const profileIn = (home, platform) => launcher.userDataDirFor(platform, {}, home)

/** A profile folder whose `mcp.sock` path is exactly `bytes` long. */
function profileOfSocketLength(bytes) {
  const tail = '/mcp.sock'.length
  return `/Users/${'p'.repeat(bytes - tail - '/Users/'.length)}`
}

test('a short profile keeps its socket inside, as before', () => {
  for (const platform of ['darwin', 'linux']) {
    const profile = profileIn('/Users/matteo', platform)
    assert.equal(protocol.socketPathFor(profile, platform, 'matteo', 501), path.join(profile, 'mcp.sock'))
    assert.equal(protocol.shortSocketDirOf(protocol.socketPathFor(profile, platform, 'matteo', 501), 501), null)
  }
})

test('a long home moves the socket to the per-user folder in /tmp, short enough for the platform', () => {
  const home = `/Users/${'a-very-long-user-name-'.repeat(4)}`
  for (const platform of ['darwin', 'linux']) {
    const profile = profileIn(home, platform)
    assert.ok(Buffer.byteLength(path.join(profile, 'mcp.sock')) > protocol.maxSocketPathBytes(platform))
    const socketPath = protocol.socketPathFor(profile, platform, 'u', 501)
    assert.match(socketPath, /^\/tmp\/droneclean-mcp-501\/[0-9a-f]{16}\.sock$/, platform)
    assert.ok(Buffer.byteLength(socketPath) <= protocol.maxSocketPathBytes(platform))
    assert.equal(protocol.shortSocketDirOf(socketPath, 501), '/tmp/droneclean-mcp-501')
    assert.equal(launcher.socketPathFor(profile, platform, 'u', 501), socketPath, 'the launcher agrees')
  }
})

test('the limit is the platform’s sun_path less its terminator, counted in bytes', () => {
  assert.equal(protocol.maxSocketPathBytes('darwin'), 103)
  assert.equal(protocol.maxSocketPathBytes('linux'), 107)
  assert.equal(protocol.maxSocketPathBytes('freebsd'), 103)
  for (const [platform, limit] of [['darwin', 103], ['linux', 107]]) {
    const fits = profileOfSocketLength(limit)
    assert.equal(protocol.socketPathFor(fits, platform, 'u', 501), `${fits}/mcp.sock`, `${platform}: ${limit} bytes fit`)
    const over = profileOfSocketLength(limit + 1)
    assert.notEqual(protocol.socketPathFor(over, platform, 'u', 501), `${over}/mcp.sock`, `${platform}: one more does not`)
  }
  // 68 characters but 118 bytes ("è" is two bytes in UTF-8): what the kernel counts is bytes.
  const accented = `/Users/${'è'.repeat(50)}/x`
  assert.ok(`${accented}/mcp.sock`.length <= 103 && Buffer.byteLength(`${accented}/mcp.sock`) > 103)
  assert.match(protocol.socketPathFor(accented, 'darwin', 'u', 501), /^\/tmp\/droneclean-mcp-501\//)
})

test('one socket per profile and per user; Windows keeps its pipe', () => {
  const home = `/Users/${'x'.repeat(80)}`
  const real = profileIn(home, 'darwin')
  const throwaway = path.join(home, 'Library', 'Application Support', 'DroneClean Studio Test')
  const a = protocol.socketPathFor(real, 'darwin', 'u', 501)
  assert.equal(protocol.socketPathFor(real, 'darwin', 'u', 501), a, 'stable')
  assert.notEqual(protocol.socketPathFor(throwaway, 'darwin', 'u', 501), a, 'another profile, another socket')
  assert.equal(path.dirname(protocol.socketPathFor(real, 'darwin', 'u', 502)), '/tmp/droneclean-mcp-502')
  const windows = `C:\\Users\\${'w'.repeat(200)}\\AppData\\Roaming\\DroneClean Studio`
  assert.equal(
    protocol.socketPathFor(windows, 'win32', 'alice', 501),
    `${protocol.WINDOWS_PIPE_NAME_PREFIX}${protocol.pipeUserPart('alice')}`,
  )
  assert.equal(protocol.shortSocketDirOf(protocol.socketPathFor(windows, 'win32', 'alice', 501), 501), null)
})

test('the app and the launcher compute the same path, short or long, on every platform', () => {
  const profiles = ['/tmp/u', profileIn('/Users/matteo', 'darwin'), profileOfSocketLength(103), profileOfSocketLength(104)]
  profiles.push(profileOfSocketLength(108), `/home/${'l'.repeat(120)}/.config/DroneClean Studio`)
  for (const profile of profiles) {
    for (const platform of ['darwin', 'linux', 'win32']) {
      for (const uid of [0, 501, 1000]) {
        assert.equal(
          launcher.socketPathFor(profile, platform, 'example', uid),
          protocol.socketPathFor(profile, platform, 'example', uid),
          `${platform} ${uid} ${profile}`,
        )
      }
    }
    assert.equal(launcher.maxSocketPathBytes('darwin'), protocol.maxSocketPathBytes('darwin'))
    assert.equal(launcher.maxSocketPathBytes('linux'), protocol.maxSocketPathBytes('linux'))
    assert.equal(launcher.shortSocketDirFor(501), protocol.shortSocketDirFor(501))
  }
})

test('the private folder is made 0700, and a folder that is not the user’s own is refused', { skip: !POSIX }, () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-socket-dir-'))
  try {
    const fresh = path.join(work, 'fresh')
    preparePrivateSocketDir(fresh, UID)
    assert.equal(fs.statSync(fresh).mode & 0o777, 0o700)
    preparePrivateSocketDir(fresh, UID) // a second start finds it as it left it

    const open = path.join(work, 'open')
    fs.mkdirSync(open)
    fs.chmodSync(open, 0o755)
    assert.throws(() => preparePrivateSocketDir(open, UID), /its mode is 755, not 700/)

    const link = path.join(work, 'link')
    fs.symlinkSync(fresh, link, 'dir')
    assert.throws(() => preparePrivateSocketDir(link, UID), /it is not a folder/)

    const file = path.join(work, 'file')
    fs.writeFileSync(file, '')
    assert.throws(() => preparePrivateSocketDir(file, UID), /it is not a folder/)

    assert.throws(() => preparePrivateSocketDir(fresh, UID + 1), /another user owns it/)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})

test('the launcher trusts the short folder only when it is the user’s, private and not a link', { skip: !POSIX }, () => {
  // A user id that is not ours stands for "another user": the folder this test makes is owned by us, not by it.
  const other = 4_000_000_000 + (process.pid % 1000)
  const folder = launcher.shortSocketDirFor(other)
  const socketPath = path.posix.join(folder, 'abc.sock')
  fs.rmSync(folder, { recursive: true, force: true })
  try {
    assert.equal(launcher.socketFolderState('/Users/u/Library/Application Support/DroneClean Studio/mcp.sock', other), 'profile')
    assert.equal(launcher.socketFolderState(socketPath, other), 'missing')
    fs.mkdirSync(folder, { mode: 0o700 })
    assert.equal(launcher.socketFolderState(socketPath, other), 'foreign', 'owned by someone else')
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

/** A profile folder under `os.tmpdir()` whose socket path is too long for this platform. */
function longProfile() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-long-profile-'))
  const profile = path.join(base, 'a-folder-name-long-enough-to-push-the-socket-path-over-the-limit', 'DroneClean Studio')
  fs.mkdirSync(profile, { recursive: true })
  assert.ok(Buffer.byteLength(path.join(profile, 'mcp.sock')) > protocol.maxSocketPathBytes(process.platform))
  return { base, profile }
}

function startLauncher(env, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, LAUNCHER], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
  return { child, exited, stdout: () => stdout, stderr: () => stderr }
}

async function firstLine(launched, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const line = launched.stdout().split('\n').find((text) => text.length > 0)
    if (line !== undefined) return JSON.parse(line)
    if (Date.now() >= deadline) throw new Error(`no answer from the launcher; stderr: ${launched.stderr()}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test(
  'a long profile gets agent access: the app listens in the private folder, 0600, and the launcher reaches it',
  { skip: !POSIX },
  async (t) => {
    const { base, profile } = longProfile()
    const access = createAgentAccess({
      userDataDir: profile,
      page: createVmPage(),
      loadDocuments: async () => fixture.CORPUS,
      logger: () => undefined,
    })
    // With the chmod a no-op, only the umask can make the socket 0600: it is so from its first moment.
    const chmod = t.mock.method(fs, 'chmodSync', () => undefined)
    let launched = null
    try {
      await access.startIfEnabled()
      assert.equal(access.status(), 'on')
      assert.equal(access.socketPath, protocol.socketPathFor(profile))
      assert.equal(access.socketPath, launcher.socketPathFor(profile), 'the launcher computes the same path')
      assert.equal(path.dirname(access.socketPath), protocol.shortSocketDirFor(UID))
      const folder = fs.lstatSync(path.dirname(access.socketPath))
      assert.equal(folder.isDirectory() && folder.uid === UID && (folder.mode & 0o777) === 0o700, true)
      assert.equal(fs.statSync(access.socketPath).mode & 0o777, 0o600)
      assert.ok(chmod.mock.callCount() > 0)
      chmod.mock.restore()

      const client = await connectSocket(access.socketPath)
      client.send(fixture.INITIALIZE_REQUEST)
      assert.equal((await client.receive()).result.serverInfo.name, fixture.CONSTANTS.serverName)
      client.close()

      launched = startLauncher({
        DRONECLEAN_USER_DATA: profile,
        DRONECLEAN_APP_BINARY: path.join(base, 'not-needed-the-app-is-running'),
      })
      launched.child.stdin.write(`${JSON.stringify(fixture.INITIALIZE_REQUEST)}\n`)
      assert.equal((await firstLine(launched)).result.serverInfo.name, fixture.CONSTANTS.serverName)
      launched.child.stdin.end()
      assert.equal(await launched.exited, 0)
    } finally {
      launched?.child.kill()
      await access.dispose()
      assert.equal(fs.existsSync(access.socketPath), false, 'the socket is removed when access stops')
      try {
        fs.rmdirSync(path.dirname(access.socketPath))
      } catch {
        // Another long profile of this user may be using the folder.
      }
      fs.rmSync(base, { recursive: true, force: true })
    }
  },
)

test('the launcher does not connect through a short folder that is not the user’s', { skip: !POSIX }, async () => {
  const { base, profile } = longProfile()
  // The launcher runs as a user id that is not the owner of the folder this test makes for it.
  const other = 4_000_000_000 + (process.pid % 1000) + 1
  const folder = launcher.shortSocketDirFor(other)
  fs.rmSync(folder, { recursive: true, force: true })
  fs.mkdirSync(folder, { mode: 0o700 })
  try {
    const launched = startLauncher(
      { DRONECLEAN_USER_DATA: profile, DRONECLEAN_APP_BINARY: path.join(base, 'missing-app') },
      ['--import', `data:text/javascript,process.getuid=()=>${other}`],
    )
    const code = await launched.exited
    assert.equal(code, 2)
    assert.match(launched.stderr(), /is not a private folder of this user/)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
    fs.rmSync(base, { recursive: true, force: true })
  }
})
