// The frame cache (design 3.6 section 2.4): the N frames one output frame needs, and the overlap with its neighbour.
// Entries are counted; an entry a caller holds is never evicted; the cache never holds more than `capacity` entries,
// so a caller that holds more frames than that gets a loud error instead of a quiet leak.

interface Entry<V> {
  readonly value: V
  refs: number
}

/** A least-recently-used map whose entries can be held. `dispose` runs once for every entry that leaves. */
export class FrameLru<V> {
  private readonly entries = new Map<string, Entry<V>>()

  constructor(
    readonly capacity: number,
    private readonly dispose: (value: V) => void,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`frame cache: the capacity must be a positive integer, got ${capacity}`)
    }
  }

  /** How many entries it holds now. */
  get size(): number {
    return this.entries.size
  }

  /** The keys, least recently used first. */
  keys(): string[] {
    return [...this.entries.keys()]
  }

  /** Holds the entry for `key` and makes it the most recent; undefined when it is not cached. */
  acquire(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    entry.refs += 1
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  /** Lets go of one hold on `key`. */
  release(key: string): void {
    const entry = this.entries.get(key)
    if (entry !== undefined && entry.refs > 0) entry.refs -= 1
  }

  /** Whether a new entry fits: the cache has a free place or an entry nobody holds. */
  hasRoom(): boolean {
    if (this.entries.size < this.capacity) return true
    for (const entry of this.entries.values()) if (entry.refs === 0) return true
    return false
  }

  /** Adds `value` held once, evicting the least recently used entry nobody holds when the cache is full. */
  insert(key: string, value: V): void {
    if (this.entries.has(key)) throw new Error(`frame cache: '${key}' is already cached`)
    if (this.entries.size >= this.capacity) {
      const victim = [...this.entries].find(([, entry]) => entry.refs === 0)
      if (victim === undefined) {
        throw new Error(
          `frame cache: all ${this.capacity} frames are held; release the frames of the last output frame before asking for more`,
        )
      }
      this.entries.delete(victim[0])
      this.dispose(victim[1].value)
    }
    this.entries.set(key, { value, refs: 1 })
  }

  /** Disposes every entry, held or not. */
  clear(): void {
    const all = [...this.entries.values()]
    this.entries.clear()
    for (const entry of all) this.dispose(entry.value)
  }
}
