// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { createFakeServer } from './__fixtures__/fake-server'
import { downloadResult } from './download'
import { DroneCleanApiError } from './types'

const RESULT_URL = 'https://storage.test/results/7d0f2c1e/cleaned.mp4?X-Amz-Signature=1f2e3d'

/** A response whose body arrives in `chunks`, with the size the storage would declare. */
function streamed(chunks: readonly Uint8Array[], type = 'video/mp4'): Response {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { headers: { 'content-type': type, 'content-length': String(size) } },
  )
}

describe('downloading a finished job', () => {
  it('reads the body chunk by chunk and makes one blob of it', async () => {
    const chunks = [new Uint8Array([0, 1, 2]), new Uint8Array([3, 4]), new Uint8Array([5, 6, 7, 8])]
    const server = createFakeServer([
      { method: 'GET', path: '/results/7d0f2c1e/cleaned.mp4', respond: () => streamed(chunks) },
    ])
    const progress: number[] = []

    const blob = await downloadResult(RESULT_URL, {
      fetch: server.fetch,
      onProgress: (fraction) => progress.push(fraction),
    })

    expect(blob.type).toBe('video/mp4')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    )
    // Progress follows the chunks as they arrive: 3, then 5, then all 9 bytes.
    expect(progress).toEqual([3 / 9, 5 / 9, 1])
    // The signed URL carries its own permission: no token is sent to storage.
    expect(server.calls[0]?.headers.authorization).toBeUndefined()
    expect(server.calls[0]?.headers.accept).toBeUndefined()
  })

  it('keeps the storage’s status when the file cannot be fetched', async () => {
    const server = createFakeServer([
      {
        method: 'GET',
        path: '/results/7d0f2c1e/cleaned.mp4',
        respond: () => ({ status: 403, body: 'Request has expired' }),
      },
    ])

    const error = await downloadResult(RESULT_URL, { fetch: server.fetch }).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(DroneCleanApiError)
    expect((error as DroneCleanApiError).status).toBe(403)
    expect((error as DroneCleanApiError).code).toBe('download_failed')
  })

  it('reports a lost network as a typed error', async () => {
    const server = createFakeServer([
      {
        method: 'GET',
        path: '/results/7d0f2c1e/cleaned.mp4',
        respond: () => {
          throw new TypeError('fetch failed')
        },
      },
    ])

    const error = await downloadResult(RESULT_URL, { fetch: server.fetch }).catch(
      (caught: unknown) => caught,
    )

    expect((error as DroneCleanApiError).status).toBe(0)
    expect((error as DroneCleanApiError).code).toBe('network_error')
  })

  it('falls back to the whole blob when the response has no stream', async () => {
    const server = createFakeServer([
      { method: 'GET', path: '/results/7d0f2c1e/cleaned.mp4', respond: () => new Response(null) },
    ])
    const progress: number[] = []

    const blob = await downloadResult(RESULT_URL, {
      fetch: server.fetch,
      onProgress: (fraction) => progress.push(fraction),
    })

    expect(blob.size).toBe(0)
    expect(progress).toEqual([1])
  })

  it('throws an AbortError, not a network error, when it was stopped', async () => {
    const controller = new AbortController()
    controller.abort()
    const server = createFakeServer([
      {
        method: 'GET',
        path: '/results/7d0f2c1e/cleaned.mp4',
        respond: () => {
          throw new DOMException('Stopped.', 'AbortError')
        },
      },
    ])

    const error = await downloadResult(RESULT_URL, {
      fetch: server.fetch,
      signal: controller.signal,
    }).catch((caught: unknown) => caught)

    expect((error as Error).name).toBe('AbortError')
  })
})
