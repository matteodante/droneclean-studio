// Pipeline caches keyed by device (design 3.6 section 2.8). A GPU object belongs to the device that made it, so every
// cache of pipelines, stages, LUT textures or frame providers goes through `perDevice`: a second device (the export
// worker's, section 2.15) gets its own entries instead of the page's.

/** The part of a `GPUDevice` the cache needs; a real device satisfies it, and a test's fake can. */
export interface CachedDevice {
  readonly lost: Promise<unknown>
}

const caches = new WeakMap<object, Map<string, unknown>>()

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * The value for `key` on `device`, built by `build` the first time and shared afterwards. When the device is lost its
 * entries are forgotten. A `build` that throws caches nothing; one that returns a promise caches the promise, so a
 * second caller awaits the first build instead of starting another, and drops it when it rejects so a later call
 * retries (failure is state with a retry, not a sticky answer).
 */
export function perDevice<T>(device: CachedDevice, key: string, build: () => T): T {
  let entries = caches.get(device)
  if (entries === undefined) {
    const created = new Map<string, unknown>()
    entries = created
    caches.set(device, created)
    // A lost device's objects are dead: forget them, but only if this map is still the device's.
    void device.lost.then(() => {
      if (caches.get(device) === created) caches.delete(device)
    })
  }
  if (entries.has(key)) return entries.get(key) as T
  const value = build()
  entries.set(key, value)
  if (isPromiseLike(value)) {
    const owner = entries
    value.then(undefined, () => {
      if (owner.get(key) === value) owner.delete(key)
    })
  }
  return value
}
