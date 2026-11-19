/**
 * A recorded server for the API tests.
 *
 * `createFakeServer` answers `fetch` calls from the routes a test gives it and records every call
 * (method, path, headers, body), so a test can assert what the client sent and the client is
 * exercised as it runs in the editor: same URL building, same headers, same body. Nothing here
 * reaches the network.
 */
import type { FetchLike } from '../types'

/** One call the client made, as the recorded server saw it. */
export interface RecordedCall {
  method: string
  url: string
  /** The URL's path only, so a route never depends on the recorded host. */
  path: string
  headers: Record<string, string>
  /** The JSON body when the request sent JSON, the `Blob` when it sent bytes, undefined otherwise. */
  body: unknown
}

/** What a route answers: a status and a JSON body, or a whole `Response` for a streamed body. */
export interface FakeAnswer {
  status?: number
  body?: unknown
}

export interface FakeRoute {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT'
  /** The pathname a call must have, or a pattern for one. */
  path: string | RegExp
  /**
   * The answer. It may throw, which the client sees as a lost network, exactly as a real `fetch`
   * that cannot reach the host rejects.
   */
  respond: (call: RecordedCall) => FakeAnswer | Response | Promise<FakeAnswer | Response>
}

export interface FakeServer {
  fetch: FetchLike
  /** Every call the client made, in order. */
  calls: RecordedCall[]
  /** The calls to one path, in order. */
  to(path: string | RegExp): RecordedCall[]
}

function matches(route: FakeRoute, method: string, path: string): boolean {
  if (route.method !== method) return false
  return typeof route.path === 'string' ? route.path === path : route.path.test(path)
}

function parseBody(body: RequestInit['body']): unknown {
  if (body instanceof Blob) return body
  if (typeof body !== 'string' || body === '') return undefined
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

function json(answer: FakeAnswer): Response {
  const body = answer.body === undefined ? null : JSON.stringify(answer.body)
  return new Response(body, {
    status: answer.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

export function createFakeServer(routes: readonly FakeRoute[]): FakeServer {
  const calls: RecordedCall[] = []
  const fetch: FetchLike = async (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    const call: RecordedCall = {
      method,
      url,
      path: new URL(url).pathname,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: parseBody(init.body),
    }
    calls.push(call)
    const route = routes.find((candidate) => matches(candidate, method, call.path))
    if (!route) {
      return json({
        status: 404,
        body: {
          error: { code: 'not_found', message: `No recorded route for ${method} ${call.path}` },
        },
      })
    }
    const answer = await route.respond(call)
    return answer instanceof Response ? answer : json(answer)
  }
  return {
    fetch,
    calls,
    to: (path) =>
      calls.filter((call) =>
        typeof path === 'string' ? call.path === path : path.test(call.path),
      ),
  }
}
