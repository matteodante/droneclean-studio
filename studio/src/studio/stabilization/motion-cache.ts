// The motion cache (task 8.7, slice M1, finding S7): what Gyroflow's parsers consumed from a clip - the container's tables
// and the motion samples, a few MB out of a 3.7 GB file - kept so that opening the same clip again does not read it
// again (`gyroflow/wasm/src/lib.rs`, `motion trace`). The blob is the file's own bytes, not a parse of them, so it stays
// valid when the engine changes.
//
// Two layers, both local: the page's memory (one read of a clip per session: an export's engine, a settings change that
// opens a second engine of the same file, all find it) and the origin's private file system (OPFS), which is the app's
// own data on the user's disk and is what makes the next session's open fast. Nothing leaves the machine.
//
// A blob belongs to one file by its name, size and modification time: a file that was replaced or edited has another
// key and never finds the old blob (the engine also refuses a blob of another size and then reads the file).

/** Where blobs are kept between sessions; the default is OPFS, the tests hand in their own */
export interface MotionCacheStore {
  get(key: string): Promise<ArrayBuffer | null>
  put(key: string, blob: ArrayBuffer): Promise<void>
}

/** What a parse is cached by: a `File`, or a linked file's description, both name, size and modification time */
export type CachedFile = Pick<File, 'name' | 'size' | 'lastModified'>

/** The key a file's blob is kept under: its name, size and modification time */
export function motionCacheKey(file: CachedFile): string {
  return `${file.name}|${file.size}|${file.lastModified}`
}

/** File names are made of the key's hash: the key holds characters a file system does not take */
async function fileNameOf(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return `${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}.dcmt`
}

async function pipe(data: ArrayBuffer, stream: CompressionStream | DecompressionStream): Promise<ArrayBuffer> {
  return new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer()
}

/** What a bounded store keeps about each blob: the bytes it takes on the disk and when it was last used */
export interface MotionBlobIndex {
  [name: string]: { size: number; used: number }
}

/** The files under a bounded store: a flat set of named blobs and an index of them (OPFS in the app, a map in tests) */
export interface MotionBlobBackend {
  read(name: string): Promise<ArrayBuffer | null>
  write(name: string, data: ArrayBuffer): Promise<void>
  remove(name: string): Promise<void>
  readIndex(): Promise<MotionBlobIndex>
  writeIndex(index: MotionBlobIndex): Promise<void>
}

/** The most the app's origin storage keeps of motion blobs: about 25 clips of clip 0020's size */
const MOTION_STORE_CAP_BYTES = 1024 * 1024 * 1024

/**
 * A store of at most `capBytes` over `backend`, least recently used out first: a read touches the blob, a write evicts
 * the oldest blobs until it fits and never the blob it is writing, and a blob larger than the cap is not stored at all
 * (the cache keeps it in memory for the session). An evicted clip is simply read from its file the next time.
 * `encode` and `decode` are what is stored (gzip in the app); the cap counts the encoded bytes. `now` is the clock.
 */
export function createBoundedMotionStore(
  backend: MotionBlobBackend,
  options: {
    capBytes?: number
    now?: () => number
    encode?: (blob: ArrayBuffer) => Promise<ArrayBuffer>
    decode?: (stored: ArrayBuffer) => Promise<ArrayBuffer>
  } = {},
): MotionCacheStore {
  const capBytes = options.capBytes ?? MOTION_STORE_CAP_BYTES
  const now = options.now ?? Date.now
  const encode = options.encode ?? (async (blob) => blob)
  const decode = options.decode ?? (async (stored) => stored)
  // The index is read, changed and written back: one operation at a time, or two would write over each other
  let queue: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work)
    queue = run.catch(() => {})
    return run
  }

  return {
    get: (key) =>
      exclusive(async () => {
        const name = await fileNameOf(key)
        const index = await backend.readIndex()
        const entry = index[name]
        if (!entry) return null
        const stored = await backend.read(name)
        if (!stored) {
          delete index[name]
          await backend.writeIndex(index)
          return null
        }
        index[name] = { ...entry, used: now() }
        await backend.writeIndex(index)
        return decode(stored)
      }).catch(() => null), // the store cannot be read: the file is read instead
    put: (key, blob) =>
      exclusive(async () => {
        const name = await fileNameOf(key)
        const data = await encode(blob)
        if (data.byteLength > capBytes) return
        const index = await backend.readIndex()
        delete index[name]
        let total = Object.values(index).reduce((sum, entry) => sum + entry.size, 0)
        const oldestFirst = Object.entries(index).sort((a, b) => a[1].used - b[1].used)
        for (const [victim, entry] of oldestFirst) {
          if (total + data.byteLength <= capBytes) break
          await backend.remove(victim)
          delete index[victim]
          total -= entry.size
        }
        // The entry is recorded only once the data is whole. A write that fails half way leaves no partial file
        // under the name, and the index (without the entry, and without the blobs evicted for it) is still written,
        // so it never names a file that is gone nor leaves a file it does not name.
        try {
          await backend.write(name, data)
          index[name] = { size: data.byteLength, used: now() }
          await backend.writeIndex(index)
        } catch (error) {
          delete index[name]
          await backend.remove(name).catch(() => {})
          await backend.writeIndex(index).catch(() => {})
          throw error
        }
      }),
  }
}

/** The origin's private file system, in a folder of its own; `null` where the browser has none */
function opfsBackend(): MotionBlobBackend | null {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage || typeof storage.getDirectory !== 'function') return null
  const folder = async () => (await storage.getDirectory()).getDirectoryHandle('motion-cache', { create: true })
  return {
    async read(name) {
      try {
        return await (await (await folder()).getFileHandle(name)).getFile().then((f) => f.arrayBuffer())
      } catch {
        return null
      }
    },
    async write(name, data) {
      const handle = await (await folder()).getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      try {
        await writable.write(data)
      } catch (error) {
        // `close()` would commit the half-written swap file over the name; `abort()` throws it away
        await writable.abort().catch(() => {})
        throw error
      }
      await writable.close()
    },
    async remove(name) {
      await (await folder()).removeEntry(name).catch(() => {})
    },
    async readIndex() {
      const raw = await this.read('index.json')
      try {
        return raw ? (JSON.parse(new TextDecoder().decode(raw)) as MotionBlobIndex) : {}
      } catch {
        return {}
      }
    },
    async writeIndex(index) {
      await this.write('index.json', new TextEncoder().encode(JSON.stringify(index)).buffer as ArrayBuffer)
    },
  }
}

/** Blobs (gzipped, 1 GB at most) in the origin's private file system; `null` where the browser has none */
function createOpfsMotionStore(): MotionCacheStore | null {
  const backend = opfsBackend()
  if (!backend) return null
  return createBoundedMotionStore(backend, {
    encode: (blob) => pipe(blob, new CompressionStream('gzip')),
    decode: (stored) => pipe(stored, new DecompressionStream('gzip')),
  })
}

/** What a cache did, for the tests and the measurements */
export interface MotionCacheCounts {
  /** Lookups answered from memory or from the store */
  hits: number
  /** Lookups that found nothing: the file is parsed */
  misses: number
  /** Blobs recorded */
  puts: number
}

export interface MotionCache {
  /** A copy of the file's blob (the caller may transfer it), or `null` when there is none */
  get(file: CachedFile): Promise<ArrayBuffer | null>
  /** Keeps the blob an open recorded; a store that fails to write is not the open's failure */
  put(file: CachedFile, blob: ArrayBuffer): Promise<void>
  readonly counts: MotionCacheCounts
}

/**
 * Creates a cache over `store` (OPFS when there is one, memory only otherwise). `maxMemoryBytes` bounds what the page
 * holds: a blob over it is only in the store.
 */
export function createMotionCache(
  options: { store?: MotionCacheStore | null; maxMemoryBytes?: number } = {},
): MotionCache {
  const store = options.store === undefined ? createOpfsMotionStore() : options.store
  const maxMemoryBytes = options.maxMemoryBytes ?? 256 * 1024 * 1024
  const memory = new Map<string, ArrayBuffer>()
  let memoryBytes = 0
  const counts: MotionCacheCounts = { hits: 0, misses: 0, puts: 0 }

  const remember = (key: string, blob: ArrayBuffer): void => {
    const old = memory.get(key)
    if (old) {
      memoryBytes -= old.byteLength
      memory.delete(key)
    }
    // Oldest first out, as a Map keeps insertion order
    while (memoryBytes + blob.byteLength > maxMemoryBytes && memory.size > 0) {
      const [oldest, value] = memory.entries().next().value as [string, ArrayBuffer]
      memory.delete(oldest)
      memoryBytes -= value.byteLength
    }
    if (blob.byteLength <= maxMemoryBytes) {
      memory.set(key, blob)
      memoryBytes += blob.byteLength
    }
  }

  return {
    counts,
    async get(file) {
      const key = motionCacheKey(file)
      let blob = memory.get(key) ?? null
      if (!blob && store) {
        blob = await store.get(key)
        if (blob) remember(key, blob)
      }
      if (!blob) {
        counts.misses += 1
        return null
      }
      counts.hits += 1
      return blob.slice(0)
    },
    async put(file, blob) {
      const key = motionCacheKey(file)
      counts.puts += 1
      remember(key, blob.slice(0))
      try {
        await store?.put(key, blob)
      } catch {
        // Disk full, a private window: the memory layer still serves this session
      }
    },
  }
}
