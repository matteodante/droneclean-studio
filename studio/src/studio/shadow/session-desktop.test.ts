import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createFakeServer, type FakeServer } from './api/__fixtures__/fake-server'
import { DEVICE_CODE } from './api/__fixtures__/recorded'
import { SignInRequiredError } from './api/types'
import {
  SHADOW_TOKEN_PLACEHOLDER,
  createDesktopShadowCloud,
  createDesktopShadowFetch,
  createDesktopShadowSession,
  desktopShadowCloud,
  desktopShadowSessionBridge,
  setDesktopShadowCloud,
  type DesktopShadowSessionBridge,
} from './session-desktop'

const ORIGIN = 'https://droneclean.app'
const REAL_TOKEN = 'the-real-token-that-only-the-main-process-may-hold'

/**
 * The main process, in miniature: it keeps the token, attaches it to `/v1/*`, stores the one a
 * completed sign-in answers with and hands the page the placeholder, and clears it on a 401. The
 * real one is tested in `desktop/test/shadow-session.test.mjs`. `seen` is everything the page was
 * ever given by the bridge.
 */
function fakeMain(server: FakeServer) {
  let token: string | null = null
  const seen: string[] = []
  const signOut = vi.fn(async () => {
    token = null
  })
  const bridge: DesktopShadowSessionBridge = {
    status: async () => {
      const status = { signedIn: token !== null, persistent: true }
      seen.push(JSON.stringify(status))
      return status
    },
    request: async (request) => {
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        if (['accept', 'content-type', 'x-droneclean-contract'].includes(name)) headers[name] = value
      }
      const api = request.path.startsWith('/v1/')
      if (api && token !== null) headers.authorization = `Bearer ${token}`
      const response = await server.fetch(`${ORIGIN}${request.path}`, {
        method: request.method,
        headers,
        body: request.body,
      })
      let body = await response.text()
      if (api && response.status === 401) token = null
      if (request.path === '/api/auth/device/token' && response.ok) {
        const answer = JSON.parse(body) as { access_token: string }
        token = answer.access_token
        body = JSON.stringify({ ...answer, access_token: SHADOW_TOKEN_PLACEHOLDER })
      }
      const answer = { status: response.status, headers: {}, body }
      seen.push(JSON.stringify(answer))
      return answer
    },
    signOut,
  }
  return { bridge, seen, signOut, hasToken: () => token !== null }
}

function cloudServer(overrides: { me?: () => { status?: number; body?: unknown } } = {}): FakeServer {
  return createFakeServer([
    { method: 'POST', path: '/api/auth/device/code', respond: () => ({ body: DEVICE_CODE }) },
    {
      method: 'POST',
      path: '/api/auth/device/token',
      respond: () => ({
        body: { access_token: REAL_TOKEN, token_type: 'Bearer', expires_in: 5_184_000, scope: '' },
      }),
    },
    {
      method: 'GET',
      path: '/v1/me',
      respond: overrides.me ?? (() => ({ body: { user: { id: 'u1', email: 'pilot@example.com' } } })),
    },
  ])
}

function makeCloud(main: ReturnType<typeof fakeMain>) {
  const pageFetch = vi.fn(async () => new Response('page fetch'))
  const openUrl = vi.fn()
  const cloud = createDesktopShadowCloud(main.bridge, { baseUrl: ORIGIN, pageFetch, openUrl })
  return { cloud, pageFetch, openUrl }
}

afterEach(() => {
  setDesktopShadowCloud(null)
  delete window.dronecleanDesktop
})

describe('the desktop session (DroneCleanSession over the bridge)', () => {
  it('starts signed out and is signed out again by setToken(null), like the in-memory session', async () => {
    const main = fakeMain(cloudServer())
    const session = createDesktopShadowSession(main.bridge)

    expect(await session.getToken()).toBeNull()
    // The sign-in itself is made by the main process; the session only reports it.
    await createDesktopShadowCloud(main.bridge, {
      baseUrl: ORIGIN,
      pageFetch: vi.fn(),
      openUrl: vi.fn(),
    }).client.startSignIn().then((signIn) => signIn.waitForToken())
    expect(await session.getToken()).toBe(SHADOW_TOKEN_PLACEHOLDER)

    await session.setToken(null)
    expect(main.signOut).toHaveBeenCalledTimes(1)
    expect(await session.getToken()).toBeNull()
  })

  it('treats a token handed to setToken as the placeholder of a sign-in already stored: it does nothing', async () => {
    const main = fakeMain(cloudServer())
    const session = createDesktopShadowSession(main.bridge)
    await session.setToken('anything')
    expect(main.signOut).not.toHaveBeenCalled()
    expect(await session.getToken()).toBeNull()
  })

  it('reads as signed out when the bridge fails', async () => {
    const session = createDesktopShadowSession({
      ...fakeMain(cloudServer()).bridge,
      status: async () => {
        throw new Error('ipc gone')
      },
    })
    expect(await session.getToken()).toBeNull()
  })
})

describe('the cloud client over the desktop session', () => {
  let server: FakeServer
  beforeEach(() => {
    server = cloudServer()
  })

  it('signs in through the device flow without the page ever holding the token', async () => {
    const main = fakeMain(server)
    const { cloud, openUrl, pageFetch } = makeCloud(main)
    const spies = [vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(Storage.prototype, 'getItem')]

    const signIn = await cloud.client.startSignIn()
    expect(openUrl).toHaveBeenCalledWith(DEVICE_CODE.verification_uri_complete)
    const token = await signIn.waitForToken()
    expect(token.accessToken).toBe(SHADOW_TOKEN_PLACEHOLDER)
    expect(main.hasToken()).toBe(true)

    const account = await cloud.client.getAccount()
    expect(account.user.email).toBe('pilot@example.com')
    // The cloud saw the real token; the page was given none of it, nor wrote any storage.
    expect(server.to('/v1/me')[0]?.headers.authorization).toBe(`Bearer ${REAL_TOKEN}`)
    expect(main.seen.join('')).not.toContain(REAL_TOKEN)
    expect(JSON.stringify(token)).not.toContain(REAL_TOKEN)
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
    expect(window.sessionStorage.length).toBe(0)
    expect(pageFetch).not.toHaveBeenCalled()
    spies.forEach((spy) => spy.mockRestore())
  })

  it('ignores a token the page itself puts in the header: the main process attaches its own', async () => {
    const main = fakeMain(server)
    const { cloud } = makeCloud(main)
    await (await cloud.client.startSignIn()).waitForToken()
    await cloud.client.getAccount()
    // The client sent `Bearer <placeholder>`; the cloud saw the real one only.
    expect(server.to('/v1/me')[0]?.headers.authorization).not.toContain(SHADOW_TOKEN_PLACEHOLDER)
  })

  it('a 401 clears the stored token and asks for a new sign-in', async () => {
    const main = fakeMain(
      cloudServer({ me: () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'Sign in.' } } }) }),
    )
    const { cloud } = makeCloud(main)
    await (await cloud.client.startSignIn()).waitForToken()
    expect(main.hasToken()).toBe(true)

    await expect(cloud.client.getAccount()).rejects.toBeInstanceOf(SignInRequiredError)
    expect(main.hasToken()).toBe(false)
    expect(await cloud.session.getToken()).toBeNull()
    expect(main.signOut).toHaveBeenCalled()
  })

  it('sends a signed upload or download URL through the page, not the relay', async () => {
    const main = fakeMain(server)
    const { cloud, pageFetch } = makeCloud(main)
    const request = vi.spyOn(main.bridge, 'request')
    await cloud.client.downloadResult('https://storage.example/signed?sig=abc').catch(() => undefined)
    expect(pageFetch).toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
})

describe('the desktop fetch', () => {
  it('relays only /v1/* and the two device routes of the cloud, and gives the rest to the page', async () => {
    const main = fakeMain(cloudServer())
    const request = vi.spyOn(main.bridge, 'request')
    const pageFetch = vi.fn(async () => new Response('page'))
    const fetch = createDesktopShadowFetch(main.bridge, ORIGIN, pageFetch)

    await fetch(`${ORIGIN}/v1/me`)
    await fetch(`${ORIGIN}/api/auth/device/code`, { method: 'POST', body: '{}' })
    expect(request).toHaveBeenCalledTimes(2)

    await fetch(`${ORIGIN}/api/auth/get-session`)
    await fetch('https://evil.example/v1/me')
    await fetch(`${ORIGIN}.evil.example/v1/me`)
    expect(request).toHaveBeenCalledTimes(2)
    expect(pageFetch).toHaveBeenCalledTimes(3)
  })

  it('refuses to relay a body that is not text and passes the headers as a plain object', async () => {
    const main = fakeMain(cloudServer())
    const request = vi.spyOn(main.bridge, 'request')
    const fetch = createDesktopShadowFetch(main.bridge, ORIGIN, vi.fn())
    await expect(fetch(`${ORIGIN}/v1/jobs`, { method: 'POST', body: new Blob(['x']) })).rejects.toThrow(TypeError)
    await fetch(`${ORIGIN}/v1/me`, { headers: new Headers({ Accept: 'application/json' }) })
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/v1/me', headers: { accept: 'application/json' } }),
    )
  })

  it('a lost relay is a rejected fetch, which the client turns into a network error', async () => {
    const main = fakeMain(cloudServer())
    main.bridge.request = async () => {
      throw new Error('ipc gone')
    }
    const { cloud } = makeCloud(main)
    await expect(cloud.client.getConfig()).rejects.toMatchObject({ code: 'network_error' })
  })
})

describe('the bridge accessor and the installed cloud', () => {
  it('finds no bridge in the web editor and the shell\'s one in the desktop app', () => {
    expect(desktopShadowSessionBridge()).toBeNull()
    expect(desktopShadowCloud()).toBeNull()
    const { bridge } = fakeMain(cloudServer())
    window.dronecleanDesktop = { version: 1, platform: 'darwin', getPathForFile: () => '', shadowSession: bridge } as never
    expect(desktopShadowSessionBridge()).toBe(bridge)
  })

  it('uses the same placeholder as the main process', () => {
    const shared = readFileSync(
      path.resolve(process.cwd(), 'desktop/src/shared/shadow-session.ts'),
      'utf8',
    )
    expect(shared).toContain(`SHADOW_TOKEN_PLACEHOLDER = '${SHADOW_TOKEN_PLACEHOLDER}'`)
  })
})
