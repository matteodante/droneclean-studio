// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { createFakeServer, type FakeRoute } from './__fixtures__/fake-server'
import {
  ACCOUNT,
  CONFIG,
  DELETE_JOB,
  DELETE_UPLOAD,
  DEVICE_CODE,
  DEVICE_TOKEN,
  FULL_JOB,
  FULL_JOB_ID,
  PARTS_TICKET,
  QUOTE,
  SIGNED_PARTS,
  TRACK_DATA,
  TRACK_JOB_ID,
  UPLOAD,
  UPLOAD_ID,
  UPLOAD_TICKET,
  VIDEO,
} from './__fixtures__/recorded'
import { createDroneCleanClient, type DroneCleanClientOptions } from './client'
import { createMemorySession } from './session'
import { DroneCleanApiError, SignInRequiredError, type CreateJobRequest } from './types'

const BASE = 'https://api.test'

/** The editor's client over a recorded server, with its token in memory. */
function setup(
  routes: readonly FakeRoute[],
  options: { token?: string | null } = {},
): {
  server: ReturnType<typeof createFakeServer>
  session: ReturnType<typeof createMemorySession>
  opened: string[]
  client: ReturnType<typeof createDroneCleanClient>
} {
  const server = createFakeServer(routes)
  const session = createMemorySession(options.token === undefined ? 'session-token' : options.token)
  const opened: string[] = []
  const clientOptions: DroneCleanClientOptions = {
    // A trailing slash, as a shell may pass it: the client strips it.
    baseUrl: `${BASE}/`,
    fetch: server.fetch,
    session,
    openUrl: (url) => {
      opened.push(url)
    },
  }
  return { server, session, opened, client: createDroneCleanClient(clientOptions) }
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

const ME: FakeRoute = { method: 'GET', path: '/v1/me', respond: () => ({ body: ACCOUNT }) }

describe('the account and the server', () => {
  it('reads the account with the bearer token and the contract version', async () => {
    const { server, client } = setup([ME])

    expect(client.baseUrl).toBe(BASE)
    expect(await client.getAccount()).toEqual(ACCOUNT)

    const [call] = server.to('/v1/me')
    expect(call?.headers).toEqual({
      accept: 'application/json',
      'x-droneclean-contract': '4',
      authorization: 'Bearer session-token',
    })
  })

  it('reads the server’s settings, and sends no token when signed out', async () => {
    const { server, client } = setup(
      [{ method: 'GET', path: '/v1/config', respond: () => ({ body: CONFIG }) }],
      { token: null },
    )

    expect(await client.getConfig()).toEqual(CONFIG)

    const [call] = server.to('/v1/config')
    expect(call?.headers.authorization).toBeUndefined()
    expect(call?.headers['x-droneclean-contract']).toBe('4')
  })

  it('forgets a token the API refused, and asks for a sign-in again', async () => {
    const { session, client } = setup(
      [
        {
          method: 'GET',
          path: '/v1/me',
          respond: () => ({
            status: 401,
            body: { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
          }),
        },
      ],
      { token: 'expired-token' },
    )

    const error = await failure(client.getAccount())

    expect(error).toBeInstanceOf(SignInRequiredError)
    expect(error.message).toBe('Sign in to continue.')
    expect((error as SignInRequiredError).status).toBe(401)
    expect((error as SignInRequiredError).code).toBe('unauthorized')
    // The panel reads the session to know it must offer the sign-in.
    expect(await session.getToken()).toBeNull()
  })

  it('keeps the API’s own code and message on every other failure', async () => {
    const { client } = setup([
      {
        method: 'POST',
        path: '/v1/jobs/quote',
        respond: () => ({
          status: 402,
          body: { error: { code: 'insufficient_credits', message: 'You need 45 credits.' } },
        }),
      },
    ])

    const error = await failure(client.quoteJob({ fps: 59.94, segments: FULL_JOB.segments ?? [] }))

    expect(error).toBeInstanceOf(DroneCleanApiError)
    expect((error as DroneCleanApiError).status).toBe(402)
    expect((error as DroneCleanApiError).code).toBe('insufficient_credits')
    expect(error.message).toBe('You need 45 credits.')
  })

  it('reports a server answer that is not ours, and a lost network, as typed errors', async () => {
    const notJson = setup([
      {
        method: 'GET',
        path: '/v1/me',
        respond: () => new Response('<html>Bad gateway</html>', { status: 502 }),
      },
    ])
    const serverError = await failure(notJson.client.getAccount())
    expect((serverError as DroneCleanApiError).status).toBe(502)
    expect((serverError as DroneCleanApiError).code).toBe('internal')
    expect(serverError.message).toBe('The server answered with error 502.')

    const offline = setup([
      {
        method: 'GET',
        path: '/v1/me',
        respond: () => {
          throw new TypeError('fetch failed')
        },
      },
    ])
    const networkError = await failure(offline.client.getAccount())
    expect((networkError as DroneCleanApiError).status).toBe(0)
    expect((networkError as DroneCleanApiError).code).toBe('network_error')
  })
})

describe('jobs', () => {
  it('creates one job per attempt, however often the same request is sent', async () => {
    const byAttempt = new Map<string, typeof FULL_JOB>()
    const create: FakeRoute = {
      method: 'POST',
      path: '/v1/jobs',
      respond: (call) => {
        const { attemptId } = call.body as CreateJobRequest
        if (!attemptId)
          return {
            status: 422,
            body: { error: { code: 'invalid_request', message: 'No attempt id.' } },
          }
        const known = byAttempt.get(attemptId)
        if (known) return { status: 201, body: known }
        byAttempt.set(attemptId, FULL_JOB)
        return { status: 201, body: FULL_JOB }
      },
    }
    const { server, client } = setup([create])
    const request: CreateJobRequest = {
      uploadId: UPLOAD_ID,
      segments: FULL_JOB.segments ?? [],
      options: { quality: 'standard', outputStep: 1 },
      // The same attempt, sent again because its answer was lost.
      attemptId: '9b1f2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
    }

    const first = await client.createJob(request)
    const second = await client.createJob(request)

    expect(first).toEqual(FULL_JOB)
    expect(second).toEqual(FULL_JOB)
    // One job was made, and both requests named the same attempt.
    expect(byAttempt.size).toBe(1)
    const [one, two] = server.to('/v1/jobs')
    expect(one?.body).toEqual(request)
    expect(two?.body).toEqual(request)
  })

  it('quotes the price of a job before it exists', async () => {
    const { server, client } = setup([
      { method: 'POST', path: '/v1/jobs/quote', respond: () => ({ body: QUOTE }) },
    ])
    const segments = FULL_JOB.segments ?? []

    expect(await client.quoteJob({ fps: 59.94, segments, options: { outputStep: 1 } })).toEqual(
      QUOTE,
    )
    expect(await client.quoteJob({ uploadId: UPLOAD_ID, options: { outputStep: 1 } })).toEqual(
      QUOTE,
    )

    const [before, afterUpload] = server.to('/v1/jobs/quote')
    expect(before?.body).toEqual({ fps: 59.94, segments, options: { outputStep: 1 } })
    expect(afterUpload?.body).toEqual({ uploadId: UPLOAD_ID, options: { outputStep: 1 } })
  })

  it('reads a job and its tracking pass, stops a running job and removes a finished one', async () => {
    const canceled = { ...FULL_JOB, status: 'canceled' as const }
    const { server, client } = setup([
      { method: 'GET', path: `/v1/jobs/${FULL_JOB_ID}`, respond: () => ({ body: FULL_JOB }) },
      {
        method: 'GET',
        path: `/v1/jobs/${TRACK_JOB_ID}/track`,
        respond: () => ({ body: TRACK_DATA }),
      },
      {
        method: 'POST',
        path: `/v1/jobs/${FULL_JOB_ID}/cancel`,
        respond: () => ({ body: canceled }),
      },
      { method: 'DELETE', path: `/v1/jobs/${FULL_JOB_ID}`, respond: () => ({ body: DELETE_JOB }) },
    ])

    expect(await client.getJob(FULL_JOB_ID)).toEqual(FULL_JOB)
    expect(await client.getTrack(TRACK_JOB_ID)).toEqual(TRACK_DATA)
    expect(await client.cancelJob(FULL_JOB_ID)).toEqual(canceled)
    expect(await client.deleteJob(FULL_JOB_ID)).toEqual(DELETE_JOB)
    expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /v1/jobs/${FULL_JOB_ID}`,
      `GET /v1/jobs/${TRACK_JOB_ID}/track`,
      `POST /v1/jobs/${FULL_JOB_ID}/cancel`,
      `DELETE /v1/jobs/${FULL_JOB_ID}`,
    ])
  })
})

describe('uploads', () => {
  it('sends a piece under the threshold in one PUT, then completes it', async () => {
    const { server, client } = setup([
      {
        method: 'POST',
        path: '/v1/uploads',
        respond: () => ({ status: 201, body: UPLOAD_TICKET }),
      },
      { method: 'PUT', path: `/uploads/${UPLOAD_ID}/piece.mp4`, respond: () => ({}) },
      {
        method: 'POST',
        path: `/v1/uploads/${UPLOAD_ID}/complete`,
        respond: () => ({ status: 201, body: UPLOAD }),
      },
    ])
    const progress: number[] = []

    const upload = await client.uploadPiece(
      new Blob(['a piece']),
      { ...VIDEO, sizeBytes: 7 },
      {
        onProgress: (fraction) => progress.push(fraction),
      },
    )

    expect(upload).toEqual(UPLOAD)
    expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /v1/uploads',
      `PUT /uploads/${UPLOAD_ID}/piece.mp4`,
      `POST /v1/uploads/${UPLOAD_ID}/complete`,
    ])
    const sent = server.to(`/uploads/${UPLOAD_ID}/piece.mp4`)[0]
    // The bytes go to signed storage without the editor's token.
    expect(sent?.headers).toEqual({ 'content-type': 'video/mp4' })
    const body = sent?.body
    expect(body).toBeInstanceOf(Blob)
    expect((body as Blob).size).toBe(7)
    expect(progress).toEqual([1])
  })

  it('asks for a parts ticket and signs the parts it is about to send', async () => {
    const { server, client } = setup([
      {
        method: 'POST',
        path: '/v1/uploads/parts',
        respond: () => ({ status: 201, body: PARTS_TICKET }),
      },
      {
        method: 'POST',
        path: `/v1/uploads/${UPLOAD_ID}/parts`,
        respond: () => ({ body: SIGNED_PARTS }),
      },
    ])

    expect(await client.createPartsUpload(VIDEO)).toEqual(PARTS_TICKET)
    expect(await client.signUploadParts(UPLOAD_ID, [1])).toEqual(SIGNED_PARTS)

    expect(server.to('/v1/uploads/parts')[0]?.body).toEqual(VIDEO)
    expect(server.to(`/v1/uploads/${UPLOAD_ID}/parts`)[0]?.body).toEqual({ partNumbers: [1] })
  })

  it('drops an upload that will not be used', async () => {
    const { server, client } = setup([
      {
        method: 'DELETE',
        path: `/v1/uploads/${UPLOAD_ID}`,
        respond: () => ({ body: DELETE_UPLOAD }),
      },
    ])

    expect(await client.abortUpload(UPLOAD_ID)).toEqual(DELETE_UPLOAD)
    expect(server.calls[0]?.method).toBe('DELETE')
  })
})

describe('the finished file', () => {
  it('downloads the result from signed storage, without the editor’s token', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const body = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 4))
          controller.enqueue(bytes.slice(4, 10))
          controller.enqueue(bytes.slice(10))
          controller.close()
        },
      }),
      { headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) } },
    )
    const { server, client } = setup([
      { method: 'GET', path: `/results/${FULL_JOB_ID}/cleaned.mp4`, respond: () => body },
    ])

    const blob = await client.downloadResult(
      `https://storage.test/results/${FULL_JOB_ID}/cleaned.mp4`,
    )

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
    expect(blob.type).toBe('video/mp4')
    expect(server.calls[0]?.headers.authorization).toBeUndefined()
  })
})

describe('signing in', () => {
  it('opens the website on the code and keeps the token it comes back with', async () => {
    const { session, opened, client } = setup(
      [
        {
          method: 'POST',
          path: '/api/auth/device/code',
          respond: () => ({ body: DEVICE_CODE }),
        },
        {
          method: 'POST',
          path: '/api/auth/device/token',
          respond: () => ({ body: DEVICE_TOKEN }),
        },
      ],
      { token: null },
    )

    const signIn = await client.startSignIn()

    expect(opened).toEqual([DEVICE_CODE.verification_uri_complete])
    expect(signIn.userCode).toBe(DEVICE_CODE.user_code)
    expect(await session.getToken()).toBeNull()
    await signIn.waitForToken()
    expect(await session.getToken()).toBe(DEVICE_TOKEN.access_token)
  })
})
