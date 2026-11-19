// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { createFakeServer, type FakeAnswer, type FakeRoute } from './__fixtures__/fake-server'
import {
  DEVICE_CODE,
  DEVICE_DENIED,
  DEVICE_EXPIRED,
  DEVICE_PENDING,
  DEVICE_SLOW_DOWN,
  DEVICE_TOKEN,
} from './__fixtures__/recorded'
import { beginDeviceSignIn } from './device'
import { DeviceSignInError } from './types'

const BASE = 'https://api.test'

/** `POST /api/auth/device/code`, recorded from `cloud/services/api/test/auth-device.test.ts`. */
const codeRoute: FakeRoute = {
  method: 'POST',
  path: '/api/auth/device/code',
  respond: () => ({ body: DEVICE_CODE }),
}

/** The token route, answering `answers` in turn (the last one repeats, as a state would). */
function tokenRoute(answers: readonly FakeAnswer[]): FakeRoute {
  let polled = 0
  return {
    method: 'POST',
    path: '/api/auth/device/token',
    respond: () => {
      const answer = answers[Math.min(polled, answers.length - 1)] ?? { status: 500 }
      polled += 1
      return answer
    },
  }
}

/** A sleep that records how long the client said it would wait, without waiting. */
function sleeping(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = []
  return {
    delays,
    sleep: async (ms) => {
      delays.push(ms)
    },
  }
}

/** The error a call rejects with, or a failure when it resolved. */
async function failure(call: Promise<unknown>): Promise<Error> {
  try {
    await call
  } catch (error) {
    return error as Error
  }
  throw new Error('the call resolved, but it should have failed')
}

/** One poll of the RFC's token request: the body every test expects the editor to send. */
const TOKEN_REQUEST = {
  grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  device_code: DEVICE_CODE.device_code,
  client_id: 'droneclean-studio',
}

describe('the device sign-in', () => {
  it('asks for a code for the editor only, and returns it for the panel', async () => {
    const server = createFakeServer([codeRoute])

    const signIn = await beginDeviceSignIn({ baseUrl: BASE, fetch: server.fetch })

    const [asked] = server.to('/api/auth/device/code')
    expect(asked?.method).toBe('POST')
    expect(asked?.headers['content-type']).toBe('application/json')
    expect(asked?.body).toEqual({ client_id: 'droneclean-studio' })
    expect(signIn.userCode).toBe('ABCD2345')
    expect(signIn.verificationUriComplete).toBe('https://droneclean.app/device?user_code=ABCD2345')
    expect(signIn.expiresInSeconds).toBe(1800)
    expect(signIn.intervalSeconds).toBe(5)
  })

  it('takes the token as soon as the code is approved', async () => {
    const { sleep, delays } = sleeping()
    const server = createFakeServer([codeRoute, tokenRoute([{ body: DEVICE_TOKEN }])])

    const signIn = await beginDeviceSignIn({ baseUrl: BASE, fetch: server.fetch, sleep })
    const token = await signIn.waitForToken()

    expect(token).toEqual({
      accessToken: DEVICE_TOKEN.access_token,
      tokenType: 'Bearer',
      expiresInSeconds: DEVICE_TOKEN.expires_in,
      scope: '',
    })
    expect(server.to('/api/auth/device/token')[0]?.body).toEqual(TOKEN_REQUEST)
    // Approved at the first poll: nothing waited.
    expect(delays).toEqual([])
  })

  it('waits the code interval while nobody has approved it', async () => {
    const { sleep, delays } = sleeping()
    const server = createFakeServer([
      codeRoute,
      tokenRoute([{ status: 400, body: DEVICE_PENDING }, { body: DEVICE_TOKEN }]),
    ])

    const signIn = await beginDeviceSignIn({ baseUrl: BASE, fetch: server.fetch, sleep })
    const token = await signIn.waitForToken()

    expect(token.accessToken).toBe(DEVICE_TOKEN.access_token)
    // The code asked for a poll every 5 seconds; the pending answer is not an error.
    expect(delays).toEqual([5000])
    expect(server.to('/api/auth/device/token')).toHaveLength(2)
  })

  it('waits five seconds more after each slow_down', async () => {
    const { sleep, delays } = sleeping()
    const server = createFakeServer([
      codeRoute,
      tokenRoute([
        { status: 400, body: DEVICE_SLOW_DOWN },
        { status: 400, body: DEVICE_SLOW_DOWN },
        { body: DEVICE_TOKEN },
      ]),
    ])

    const signIn = await beginDeviceSignIn({ baseUrl: BASE, fetch: server.fetch, sleep })
    await signIn.waitForToken()

    // 5 s + 5 s, then 10 s + 5 s: the interval the API told the editor to add to.
    expect(delays).toEqual([10_000, 15_000])
    expect(server.to('/api/auth/device/token')).toHaveLength(3)
  })

  it('ends when the code expired, with the API code the panel reads', async () => {
    const { sleep, delays } = sleeping()
    const server = createFakeServer([
      codeRoute,
      tokenRoute([{ status: 400, body: DEVICE_EXPIRED }]),
    ])

    const signIn = await beginDeviceSignIn({ baseUrl: BASE, fetch: server.fetch, sleep })
    const error = await failure(signIn.waitForToken())

    expect(error).toBeInstanceOf(DeviceSignInError)
    expect(error.message).toBe('Device code has expired')
    expect((error as DeviceSignInError).code).toBe('expired_token')
    expect((error as DeviceSignInError).status).toBe(400)
    // An expired code is not asked for again.
    expect(delays).toEqual([])
    expect(server.to('/api/auth/device/token')).toHaveLength(1)
  })

  it('ends when the pilot denied the code', async () => {
    const { sleep } = sleeping()
    const server = createFakeServer([codeRoute, tokenRoute([{ status: 400, body: DEVICE_DENIED }])])

    const signIn = await beginDeviceSignIn({ baseUrl: BASE, fetch: server.fetch, sleep })
    const error = await failure(signIn.waitForToken())

    expect((error as DeviceSignInError).code).toBe('access_denied')
    expect(error.message).toBe('Access denied')
  })

  it('refuses a client id the API does not know', async () => {
    const server = createFakeServer([
      {
        method: 'POST',
        path: '/api/auth/device/code',
        respond: () => ({
          status: 400,
          body: { error: 'invalid_client', error_description: 'Invalid client ID' },
        }),
      },
    ])

    const error = await failure(beginDeviceSignIn({ baseUrl: BASE, fetch: server.fetch }))

    expect((error as DeviceSignInError).code).toBe('invalid_client')
  })

  it('reports a lost network as a typed error instead of hanging', async () => {
    const server = createFakeServer([
      {
        method: 'POST',
        path: '/api/auth/device/code',
        respond: () => {
          throw new TypeError('fetch failed')
        },
      },
    ])

    const error = await failure(beginDeviceSignIn({ baseUrl: BASE, fetch: server.fetch }))

    expect(error).toBeInstanceOf(DeviceSignInError)
    expect((error as DeviceSignInError).status).toBe(0)
    expect((error as DeviceSignInError).code).toBe('network_error')
  })
})
