// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fetchOnnxModelBytes, fetchOnnxModelText } from './onnx-model-cache'

const cacheEntries = new Map<string, Response>()
const cachePut = vi.fn(async (request: RequestInfo | URL, response: Response) => {
  const url = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
  cacheEntries.set(url, response.clone())
})

function stubCacheStorage(): void {
  vi.stubGlobal('caches', {
    async has() {
      return true
    },
    async open() {
      return {
        async match(request: RequestInfo | URL) {
          const url =
            typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
          return cacheEntries.get(url)?.clone()
        },
        async put(request: RequestInfo | URL, response: Response) {
          return cachePut(request, response)
        },
        async keys() {
          return [...cacheEntries.keys()].map((url) => new Request(url))
        },
        async delete(request: RequestInfo | URL) {
          const url =
            typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
          return cacheEntries.delete(url)
        },
      }
    },
  })
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

describe('onnx-model-cache cancellation', () => {
  beforeEach(() => {
    cacheEntries.clear()
    cachePut.mockClear()
    stubCacheStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes the abort signal to the download and caches nothing when it fires mid-read', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(streamOf(new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])), {
          headers: { 'content-length': '8' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchOnnxModelBytes(
      'https://example.com/aborted.onnx',
      () => controller.abort(),
      controller.signal,
    )

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal })
    expect(cachePut).not.toHaveBeenCalled()
  })

  it('does not start a request when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchOnnxModelBytes('https://example.com/never.onnx', undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves an aborted small asset uncached and reads a complete one into the cache', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn())

    await expect(
      fetchOnnxModelText('https://example.com/config.json', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(cachePut).not.toHaveBeenCalled()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')))
    await expect(fetchOnnxModelText('https://example.com/complete-config.json')).resolves.toBe(
      '{"ok":true}',
    )
    expect(cachePut).toHaveBeenCalledTimes(1)
  })
})
