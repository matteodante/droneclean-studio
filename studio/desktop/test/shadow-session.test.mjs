/**
 * The cloud sign-in's token (task 4.6, slice E7; review finding C8): kept encrypted by the main
 * process, attached by the relay, never given to the page. Run on the real `main/shadow-session.js`
 * with a fake `safeStorage` and a fake cloud (nothing here reaches the network).
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { SHADOW_SESSION_CHANNELS, SHADOW_TOKEN_PLACEHOLDER } from '../out/shared/shadow-session.js'

const require = createRequire(import.meta.url)
const { install } = require('./support/fake-electron.cjs')

let fake = null
const folders = []
afterEach(() => {
  fake?.restore()
  fake = null
  while (folders.length) rmSync(folders.pop(), { recursive: true, force: true })
})

const REAL_TOKEN = 'real-secret-token-0123456789'
const ORIGIN = 'https://cloud.test'

/** A reversible, recognisable "encryption": the bytes on disk never contain the plain text. */
function fakeStorage({ available = true, backend } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: backend === undefined ? undefined : () => backend,
    encryptString: (plain) => Buffer.from(`enc:${Buffer.from(plain).reverse().toString('hex')}`),
    decryptString: (buffer) => {
      const text = buffer.toString()
      if (!text.startsWith('enc:')) throw new Error('not ours')
      return Buffer.from(text.slice(4), 'hex').reverse().toString()
    },
  }
}

/** A fake cloud: records every call; `answer` decides the reply. */
function fakeCloud(answer) {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    const reply = answer(new URL(url), init)
    return new Response(reply.body ?? '{}', {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, fetch: fetchFn }
}

async function session({ storage = fakeStorage(), cloud, dir } = {}) {
  fake ??= install({ isPackaged: true })
  const { ShadowSession } = require('../out/main/shadow-session.js')
  const folder = dir ?? mkdtempSync(path.join(tmpdir(), 'droneclean-shadow-session-'))
  if (dir === undefined) folders.push(folder)
  return {
    folder,
    value: new ShadowSession({ dir: folder, storage, origin: ORIGIN, fetch: cloud?.fetch }),
  }
}

const deviceTokenBody = (token) =>
  JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 5184000, scope: '' })

/** Signs in through the relay, as the page's device flow does. */
async function signIn(value) {
  return value.request({
    method: 'POST',
    path: '/api/auth/device/token',
    headers: { 'content-type': 'application/json' },
    body: '{"device_code":"d"}',
  })
}

test('a completed sign-in is stored encrypted, and the page gets the placeholder, not the token', async () => {
  const cloud = fakeCloud(() => ({ body: deviceTokenBody(REAL_TOKEN) }))
  const { folder, value } = await session({ cloud })
  assert.deepEqual(await value.status(), { signedIn: false, persistent: true })

  const answer = await signIn(value)
  assert.equal(answer.status, 200)
  assert.equal(JSON.parse(answer.body).access_token, SHADOW_TOKEN_PLACEHOLDER)
  assert.equal(answer.body.includes(REAL_TOKEN), false)
  assert.deepEqual(await value.status(), { signedIn: true, persistent: true })

  const onDisk = readFileSync(path.join(folder, 'shadow-session.bin'))
  assert.equal(onDisk.includes(REAL_TOKEN), false, 'the token is not on disk in the clear')
  assert.deepEqual(readdirSync(folder), ['shadow-session.bin'], 'no temporary file is left')
})

test('the token survives a restart: a new session over the same folder is signed in', async () => {
  const cloud = fakeCloud(() => ({ body: deviceTokenBody(REAL_TOKEN) }))
  const first = await session({ cloud })
  await signIn(first.value)

  const api = fakeCloud(() => ({ body: '{"ok":true}' }))
  const second = await session({ cloud: api, dir: first.folder })
  assert.deepEqual(await second.value.status(), { signedIn: true, persistent: true })
  await second.value.request({ method: 'GET', path: '/v1/me' })
  assert.equal(api.calls[0].init.headers.authorization, `Bearer ${REAL_TOKEN}`)
})

test('a /v1 call carries the token, the contract header and nothing the page sent as authorization', async () => {
  const cloud = fakeCloud((url) =>
    url.pathname === '/api/auth/device/token'
      ? { body: deviceTokenBody(REAL_TOKEN) }
      : { body: '{"id":"j1"}' },
  )
  const { value } = await session({ cloud })
  await signIn(value)
  const answer = await value.request({
    method: 'POST',
    path: '/v1/jobs?x=1',
    headers: {
      Authorization: 'Bearer stolen-by-the-page',
      'Content-Type': 'application/json',
      'x-droneclean-contract': '4',
      cookie: 'a=b',
      'x-other': 'no',
    },
    body: '{"a":1}',
  })
  assert.equal(answer.body, '{"id":"j1"}')
  const call = cloud.calls.at(-1)
  assert.equal(call.url, `${ORIGIN}/v1/jobs?x=1`)
  assert.deepEqual(call.init.headers, {
    'content-type': 'application/json',
    'x-droneclean-contract': '4',
    authorization: `Bearer ${REAL_TOKEN}`,
  })
  assert.equal(call.init.redirect, 'error')
})

test('the sign-in routes get no token, and a /v1 call while signed out gets none either', async () => {
  const cloud = fakeCloud(() => ({ body: '{}' }))
  const { value } = await session({ cloud })
  await value.request({ method: 'POST', path: '/api/auth/device/code', body: '{}' })
  await value.request({ method: 'GET', path: '/v1/config' })
  for (const call of cloud.calls) assert.equal(call.init.headers.authorization, undefined)
})

test('a 401 from /v1 clears the stored token, in memory and on disk', async () => {
  const cloud = fakeCloud((url) =>
    url.pathname === '/api/auth/device/token'
      ? { body: deviceTokenBody(REAL_TOKEN) }
      : { status: 401, body: '{"error":{"code":"unauthorized","message":"no"}}' },
  )
  const { folder, value } = await session({ cloud })
  await signIn(value)
  assert.equal(existsSync(path.join(folder, 'shadow-session.bin')), true)

  const answer = await value.request({ method: 'GET', path: '/v1/me' })
  assert.equal(answer.status, 401)
  assert.deepEqual(await value.status(), { signedIn: false, persistent: true })
  assert.equal(existsSync(path.join(folder, 'shadow-session.bin')), false)
})

test('sign-out deletes the token first and then tells the cloud, with the token', async () => {
  const cloud = fakeCloud((url) =>
    url.pathname === '/api/auth/device/token'
      ? { body: deviceTokenBody(REAL_TOKEN) }
      : { body: '{"success":true}' },
  )
  const { folder, value } = await session({ cloud })
  await signIn(value)
  await value.signOut()

  assert.deepEqual(await value.status(), { signedIn: false, persistent: true })
  assert.equal(existsSync(path.join(folder, 'shadow-session.bin')), false)
  const call = cloud.calls.at(-1)
  assert.equal(call.url, `${ORIGIN}/api/auth/sign-out`)
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.headers.authorization, `Bearer ${REAL_TOKEN}`)
})

test('sign-out signs out on this Mac even when the cloud cannot be reached, and twice is fine', async () => {
  const calls = []
  const cloud = {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      if (new URL(url).pathname === '/api/auth/sign-out') throw new TypeError('offline')
      return new Response(deviceTokenBody(REAL_TOKEN), { status: 200 })
    },
  }
  const { value } = await session({ cloud })
  await signIn(value)
  await value.signOut()
  await value.signOut()
  assert.deepEqual(await value.status(), { signedIn: false, persistent: true })
  assert.equal(
    calls.filter((call) => call.url.endsWith('/sign-out')).length,
    1,
    'no token, no call',
  )
})

test('without a secret store the token is kept in memory and never written', async () => {
  for (const storage of [
    fakeStorage({ available: false }),
    fakeStorage({ backend: 'basic_text' }),
  ]) {
    const cloud = fakeCloud(() => ({ body: deviceTokenBody(REAL_TOKEN) }))
    const { folder, value } = await session({ storage, cloud })
    await signIn(value)
    assert.deepEqual(await value.status(), { signedIn: true, persistent: false })
    assert.deepEqual(readdirSync(folder), [], 'nothing on disk')
  }
})

test('a file that cannot be decrypted is removed and the pilot is signed out', async () => {
  const cloud = fakeCloud(() => ({ body: deviceTokenBody(REAL_TOKEN) }))
  const first = await session({ cloud })
  await signIn(first.value)
  const other = fakeStorage()
  other.decryptString = () => {
    throw new Error('another keychain')
  }
  const cloud2 = fakeCloud(() => ({ body: '{}' }))
  const second = await session({ storage: other, dir: first.folder, cloud: cloud2 })
  // The status is a flag and reads no secret: the unreadable file is found when a call needs the token.
  assert.deepEqual(await second.value.status(), { signedIn: true, persistent: true })
  await second.value.request({ method: 'GET', path: '/v1/me' })
  assert.deepEqual(await second.value.status(), { signedIn: false, persistent: true })
  assert.equal(existsSync(path.join(first.folder, 'shadow-session.bin')), false)
  assert.equal(cloud2.calls[0].init.headers.authorization, undefined)
})

/** A secret store that counts how often it is asked to decrypt: on macOS each one can be a keychain prompt. */
function countingStorage() {
  const storage = fakeStorage()
  const counts = { decrypt: 0, available: 0 }
  const decrypt = storage.decryptString
  storage.decryptString = (buffer) => {
    counts.decrypt += 1
    return decrypt(buffer)
  }
  const available = storage.isEncryptionAvailable
  storage.isEncryptionAvailable = () => {
    counts.available += 1
    return available()
  }
  return { storage, counts }
}

test('the status never reads the secret, however often it is asked; a call that needs the token does', async () => {
  const first = await session({ cloud: fakeCloud(() => ({ body: deviceTokenBody(REAL_TOKEN) })) })
  await signIn(first.value)

  const { storage, counts } = countingStorage()
  const api = fakeCloud(() => ({ body: '{"ok":true}' }))
  const second = await session({ storage, cloud: api, dir: first.folder })
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(await second.value.status(), { signedIn: true, persistent: true })
  }
  assert.equal(counts.decrypt, 0, 'no decrypt')
  assert.equal(counts.available, 0, 'the secret store is not even asked')

  await second.value.request({ method: 'GET', path: '/v1/me' })
  assert.equal(counts.decrypt, 1, 'the call read the token')
  assert.equal(api.calls[0].init.headers.authorization, `Bearer ${REAL_TOKEN}`)
  await second.value.request({ method: 'GET', path: '/v1/me' })
  assert.equal(counts.decrypt, 1, 'and only once')
})

test('signing out reads the secret to tell the cloud, but a signed-out app never does', async () => {
  const first = await session({ cloud: fakeCloud(() => ({ body: deviceTokenBody(REAL_TOKEN) })) })
  await signIn(first.value)

  const out = countingStorage()
  const second = await session({
    storage: out.storage,
    cloud: fakeCloud(() => ({ body: '{}' })),
    dir: first.folder,
  })
  await second.value.signOut()
  assert.equal(out.counts.decrypt, 1)
  assert.deepEqual(await second.value.status(), { signedIn: false, persistent: true })

  const idle = countingStorage()
  const third = await session({
    storage: idle.storage,
    cloud: fakeCloud(() => ({ body: '{}' })),
    dir: first.folder,
  })
  await third.value.signOut()
  assert.equal(idle.counts.decrypt, 0)
  assert.equal(idle.counts.available, 0)
})

test('the relay refuses every route and request it is not for', async () => {
  const cloud = fakeCloud(() => ({ body: '{}' }))
  const { value } = await session({ cloud })
  const refused = [
    { method: 'GET', path: '/api/auth/get-session' },
    { method: 'POST', path: '/api/auth/sign-out' },
    { method: 'GET', path: '/api/auth/device/token' },
    { method: 'POST', path: '/api/auth/device/token?x=1' },
    { method: 'GET', path: '/v1/../api/auth/get-session' },
    { method: 'GET', path: '/v1/%2e%2e/api/auth/get-session' },
    { method: 'GET', path: '//evil.example/v1/me' },
    { method: 'GET', path: 'https://evil.example/v1/me' },
    { method: 'GET', path: '/v1' },
    { method: 'GET', path: 'v1/me' },
    { method: 'PUT', path: '/v1/me' },
    { method: 'PATCH', path: '/v1/me' },
    { method: 'POST', path: '/v1/jobs', body: 'x'.repeat(1024 * 1024 + 1) },
    { method: 'POST', path: '/v1/jobs', body: new Uint8Array(4) },
  ]
  for (const request of refused) {
    await assert.rejects(
      () => value.request(request),
      /refused/,
      JSON.stringify(request).slice(0, 80),
    )
  }
  await assert.rejects(() => value.request(null), /refused/)
  assert.equal(cloud.calls.length, 0, 'nothing reached the cloud')
})

test('a sign-in answer that carries no token is passed through and stores nothing', async () => {
  const cloud = fakeCloud(() => ({ status: 400, body: '{"error":"authorization_pending"}' }))
  const { folder, value } = await session({ cloud })
  const answer = await signIn(value)
  assert.equal(answer.status, 400)
  assert.equal(JSON.parse(answer.body).error, 'authorization_pending')
  assert.deepEqual(await value.status(), { signedIn: false, persistent: true })
  assert.deepEqual(readdirSync(folder), [])
})

test('every channel refuses a foreign or missing sender frame, and answers the app', async () => {
  fake = install({ isPackaged: true })
  // The module binds `ipcMain` when it loads: load it again against this test's stand-in.
  delete require.cache[require.resolve('../out/main/shadow-session.js')]
  const { ShadowSession, installShadowSessionIpc } = require('../out/main/shadow-session.js')
  const folder = mkdtempSync(path.join(tmpdir(), 'droneclean-shadow-ipc-'))
  folders.push(folder)
  const cloud = fakeCloud(() => ({ body: '{}' }))
  installShadowSessionIpc(
    new ShadowSession({ dir: folder, storage: fakeStorage(), origin: ORIGIN, fetch: cloud.fetch }),
  )
  const channels = Object.values(SHADOW_SESSION_CHANNELS)
  assert.equal(channels.length, 3)
  for (const channel of channels) {
    const handler = fake.state.handles.get(channel)
    assert.ok(handler, `${channel} is registered`)
    const args =
      channel === SHADOW_SESSION_CHANNELS.request ? [{ method: 'GET', path: '/v1/me' }] : []
    await assert.rejects(
      async () => handler({ senderFrame: { url: 'https://evil.example/' } }, ...args),
      /only answers the app/,
      channel,
    )
    await assert.rejects(
      async () => handler({ senderFrame: null }, ...args),
      /only answers the app/,
      channel,
    )
    await assert.rejects(async () => handler({}, ...args), /only answers the app/, channel)
    await handler({ senderFrame: { url: 'droneclean://app/settings' } }, ...args)
  }
  assert.equal(cloud.calls.length, 1, 'only the app frame reached the cloud')
})

test('the preload writes the same channel names as the shared file', () => {
  const source = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
  for (const [key, channel] of Object.entries(SHADOW_SESSION_CHANNELS)) {
    assert.ok(source.includes(`${key}: '${channel}'`), `preload has ${key}: '${channel}'`)
  }
  assert.equal(source.includes('shadowSession,'), true, 'the bridge exposes shadowSession')
})
