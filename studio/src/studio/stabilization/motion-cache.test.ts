// @vitest-environment node

// The motion cache (task 8.7, slice M1): a blob belongs to one file by name, size and modification time; the client
// gives the worker the blob of a file it has parsed before and parses each file once per session, an export's engine
// included. The engine's own bit-identity on clip 0020 is held by `gyroflow/wasm/test/motion-trace.test.mjs`.

import { describe, expect, it } from 'vite-plus/test'
import { createStabilizationClient, type StabilizationClip } from './client'
import { METHODS, RATE, fakeWorker, type FakeWorker } from './__fixtures__/fake-gyro-worker'
import {
  createBoundedMotionStore,
  createMotionCache,
  type MotionBlobBackend,
  type MotionBlobIndex,
  motionCacheKey,
  type MotionCacheStore,
} from './motion-cache'
import { stabilizationDefaults } from './settings'

const SETTINGS = stabilizationDefaults(METHODS)
const BLOB = new Uint8Array([1, 2, 3, 4]).buffer

const fileOf = (name: string, size: number, lastModified: number): File =>
  new File([new Uint8Array(size)], name, { lastModified })

function memoryStore(): MotionCacheStore & { saved: Map<string, ArrayBuffer> } {
  const saved = new Map<string, ArrayBuffer>()
  return {
    saved,
    get: async (key) => saved.get(key)?.slice(0) ?? null,
    put: async (key, blob) => {
      saved.set(key, blob.slice(0))
    },
  }
}

describe('the cache', () => {
  it('keys a blob by the file’s name, size and modification time', () => {
    const key = motionCacheKey(fileOf('a.MP4', 8, 100))
    expect(motionCacheKey(fileOf('a.MP4', 8, 100))).toBe(key)
    expect(motionCacheKey(fileOf('b.MP4', 8, 100))).not.toBe(key)
    expect(motionCacheKey(fileOf('a.MP4', 9, 100))).not.toBe(key)
    expect(motionCacheKey(fileOf('a.MP4', 8, 101))).not.toBe(key)
  })

  it('never finds the blob of a replaced or edited file', async () => {
    const cache = createMotionCache({ store: memoryStore() })
    await cache.put(fileOf('a.MP4', 8, 100), BLOB)

    expect(await cache.get(fileOf('a.MP4', 8, 100))).toEqual(BLOB)
    expect(await cache.get(fileOf('a.MP4', 8, 101))).toBeNull()
    expect(await cache.get(fileOf('a.MP4', 16, 100))).toBeNull()
    expect(cache.counts).toEqual({ hits: 1, misses: 2, puts: 1 })
  })

  it('serves a copy, so a caller that transfers it leaves the blob whole', async () => {
    const cache = createMotionCache({ store: null })
    const file = fileOf('a.MP4', 8, 100)
    await cache.put(file, BLOB)
    const first = await cache.get(file)
    structuredClone(first, { transfer: [first as ArrayBuffer] })
    expect(await cache.get(file)).toEqual(BLOB)
  })

  it('finds a blob an earlier session stored, and survives a store that cannot write', async () => {
    const store = memoryStore()
    await createMotionCache({ store }).put(fileOf('a.MP4', 8, 100), BLOB)
    expect(await createMotionCache({ store }).get(fileOf('a.MP4', 8, 100))).toEqual(BLOB)

    const broken = createMotionCache({
      store: { get: async () => null, put: async () => Promise.reject(new Error('disk full')) },
    })
    await broken.put(fileOf('b.MP4', 8, 1), BLOB)
    expect(await broken.get(fileOf('b.MP4', 8, 1))).toEqual(BLOB)
  })
})

function memoryBackend(): MotionBlobBackend & { files: Map<string, ArrayBuffer> } {
  const files = new Map<string, ArrayBuffer>()
  let index: MotionBlobIndex = {}
  return {
    files,
    read: async (name) => files.get(name)?.slice(0) ?? null,
    write: async (name, data) => {
      files.set(name, data.slice(0))
    },
    remove: async (name) => {
      files.delete(name)
    },
    readIndex: async () => structuredClone(index),
    writeIndex: async (next) => {
      index = structuredClone(next)
    },
  }
}

describe('the bounded store', () => {
  const blob = (bytes: number, fill = 1): ArrayBuffer => new Uint8Array(bytes).fill(fill).buffer
  let tick = 0
  const setupStore = (capBytes: number) => {
    const backend = memoryBackend()
    const store = createBoundedMotionStore(backend, { capBytes, now: () => (tick += 1) })
    return { backend, store }
  }

  it('evicts the least recently used blobs first, until the new one fits', async () => {
    const { backend, store } = setupStore(30)
    await store.put('a', blob(10))
    await store.put('b', blob(10))
    await store.put('c', blob(10))
    await store.put('d', blob(15)) // needs 15: a and b go, c stays

    expect(await store.get('a')).toBeNull()
    expect(await store.get('b')).toBeNull()
    expect(await store.get('c')).not.toBeNull()
    expect(await store.get('d')).not.toBeNull()
    expect(backend.files.size).toBe(2)
  })

  it('touches a blob on read, so the one read is evicted last', async () => {
    const { store } = setupStore(30)
    await store.put('a', blob(10))
    await store.put('b', blob(10))
    await store.put('c', blob(10))
    expect(await store.get('a')).not.toBeNull() // a is now the newest
    await store.put('d', blob(10)) // b is the oldest

    expect(await store.get('b')).toBeNull()
    expect(await store.get('a')).not.toBeNull()
    expect(await store.get('c')).not.toBeNull()
    expect(await store.get('d')).not.toBeNull()
  })

  it('never evicts the blob it is writing: a rewrite of a key replaces its own entry', async () => {
    const { store } = setupStore(20)
    await store.put('a', blob(10, 1))
    await store.put('b', blob(10, 2))
    await store.put('a', blob(20, 3)) // the old a is replaced, b makes room

    expect(new Uint8Array((await store.get('a')) as ArrayBuffer)[0]).toBe(3)
    expect(await store.get('b')).toBeNull()
  })

  it('keeps a blob larger than the cap out of the store and the others where they are', async () => {
    const { backend, store } = setupStore(30)
    await store.put('a', blob(10))
    await store.put('huge', blob(31))

    expect(await store.get('huge')).toBeNull()
    expect(await store.get('a')).not.toBeNull()
    expect(backend.files.size).toBe(1)
  })

  it('serves the oversized blob from memory for the session through the cache', async () => {
    const { store } = setupStore(30)
    const cache = createMotionCache({ store })
    const file = fileOf('big.MP4', 8, 1)
    await cache.put(file, blob(31))

    expect(await store.get(motionCacheKey(file))).toBeNull()
    expect((await cache.get(file))?.byteLength).toBe(31)
  })

  it('lets an evicted clip be read from its file again, in a later session', async () => {
    const { store } = setupStore(10)
    const first = createMotionCache({ store })
    await first.put(fileOf('a.MP4', 8, 1), blob(10))
    await first.put(fileOf('b.MP4', 8, 1), blob(10)) // evicts a

    const later = createMotionCache({ store })
    expect(await later.get(fileOf('a.MP4', 8, 1))).toBeNull()
    expect(await later.get(fileOf('b.MP4', 8, 1))).not.toBeNull()
    expect(later.counts).toEqual({ hits: 1, misses: 1, puts: 0 })
  })

  it('stores what the encoder gives and counts those bytes against the cap', async () => {
    const backend = memoryBackend()
    const store = createBoundedMotionStore(backend, {
      capBytes: 10,
      encode: async (b) => b.slice(0, b.byteLength / 2),
      decode: async (b) => b,
    })
    await store.put('a', blob(20)) // stored as 10: fits

    expect([...backend.files.values()][0]?.byteLength).toBe(10)
  })
})

describe('the client', () => {
  const clipOf = (id: string, file: File): StabilizationClip => ({ id, mediaId: `media-${id}`, file, rate: RATE })

  function setup(store = memoryStore()) {
    const workers: FakeWorker[] = []
    const cache = createMotionCache({ store })
    const client = createStabilizationClient({
      createWorker: () => {
        const worker = fakeWorker()
        workers.push(worker)
        return worker as unknown as Worker
      },
      recomputeDelayMs: 5,
      motionCache: cache,
    })
    const opens = () => workers.flatMap((w) => w.requests('open'))
    return { client, cache, workers, opens, store }
  }

  it('parses a file once per session: the export’s engine of the same file opens from the blob', async () => {
    const { client, opens } = setup()
    const file = fileOf('a.MP4', 8, 100)

    await client.open(clipOf('1', file), SETTINGS)
    // The same source with other settings is another engine (a second `open` of the file): it is given the blob
    await client.open({ ...clipOf('1', file), id: '2', mediaId: 'media-1' }, { ...SETTINGS, fov: 1.3 })

    const messages = opens()
    expect(messages).toHaveLength(2)
    expect(messages[0]?.motionTrace).toBeUndefined()
    expect(new Uint8Array(messages[1]?.motionTrace as ArrayBuffer)).toEqual(new Uint8Array([9, 9, 9]))
  })

  it('parses once when two engines of the same file open at the same time', async () => {
    const { client, opens } = setup()
    const file = fileOf('a.MP4', 8, 100)

    await Promise.all([
      client.open(clipOf('1', file), SETTINGS),
      client.open({ ...clipOf('2', file), mediaId: 'media-1' }, { ...SETTINGS, fov: 1.3 }),
    ])

    expect(opens().filter((m) => m.motionTrace === undefined)).toHaveLength(1)
    expect(opens().filter((m) => m.motionTrace !== undefined)).toHaveLength(1)
  })

  it('opens from the blob in a later session, from the store', async () => {
    const store = memoryStore()
    await setup(store).client.open(clipOf('1', fileOf('a.MP4', 8, 100)), SETTINGS)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const later = setup(store)
    await later.client.open(clipOf('1', fileOf('a.MP4', 8, 100)), SETTINGS)

    expect(later.opens()[0]?.motionTrace).toBeDefined()
  })

  it('reads a changed file again: another size or modification time never uses the old blob', async () => {
    const store = memoryStore()
    await setup(store).client.open(clipOf('1', fileOf('a.MP4', 8, 100)), SETTINGS)
    await new Promise((resolve) => setTimeout(resolve, 0))

    for (const changed of [fileOf('a.MP4', 8, 101), fileOf('a.MP4', 16, 100)]) {
      const later = setup(store)
      await later.client.open(clipOf('1', changed), SETTINGS)
      expect(later.opens()[0]?.motionTrace).toBeUndefined()
    }
  })
})
