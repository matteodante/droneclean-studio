// The flows of the source gaps a render has measured (task 11.12): one gap's flow serves every output frame inside it
// (at 0.25x, three interpolated frames), so it is measured once and kept until the render has passed the gap.
//
// An export walks a clip forwards: once it measures gap g of a clip, the clip's gaps before g are passed and freed at
// once. A preview scrubs back and forth, so it keeps the most recently used few. Either way at most `capacity` gaps
// are held (two flows of 960x720 are 11 MB), and a gap that leaves is destroyed.

/** What a cached gap holds: its flows on the GPU */
export interface Destroyable {
  destroy(): void
}

interface Entry<T> {
  readonly clip: string
  readonly gap: number
  readonly value: T
}

/** The cache of one stage pipeline; see the file's header */
export class FlowGapCache<T extends Destroyable> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly capacity: number
  private readonly freePassed: boolean

  /**
   * @param capacity how many gaps are held at most (>= 1)
   * @param freePassed whether measuring gap g of a clip frees that clip's gaps before g (an export, which only goes forwards)
   */
  constructor(capacity: number, freePassed: boolean) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(`FlowGapCache: capacity must be a whole number >= 1, got ${capacity}`)
    }
    this.capacity = capacity
    this.freePassed = freePassed
  }

  /** The gap's flows under `key`, made the most recently used; `undefined` when they are not held */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  /**
   * Keeps the flows of gap `gap` (its first source frame) of clip `clip` under `key`, which names everything the flows
   * depend on. Frees what that passes (see the constructor) and the least recently used beyond the capacity.
   */
  set(key: string, clip: string, gap: number, value: T): void {
    this.drop(key)
    if (this.freePassed) {
      for (const [other, entry] of [...this.entries]) {
        if (entry.clip === clip && entry.gap < gap) this.drop(other)
      }
    }
    this.entries.set(key, { clip, gap, value })
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string
      this.drop(oldest)
    }
  }

  /** How many gaps are held */
  get size(): number {
    return this.entries.size
  }

  /** Frees every gap */
  clear(): void {
    for (const key of [...this.entries.keys()]) this.drop(key)
  }

  private drop(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    this.entries.delete(key)
    entry.value.destroy()
  }
}
