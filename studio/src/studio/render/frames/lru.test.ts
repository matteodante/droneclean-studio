// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { FrameLru } from './lru'

function lru(capacity: number) {
  const disposed: string[] = []
  const cache = new FrameLru<string>(capacity, (value) => disposed.push(value))
  return { cache, disposed }
}

describe('FrameLru', () => {
  it('evicts the least recently used entry nobody holds, in order', () => {
    const { cache, disposed } = lru(3)
    cache.insert('a', 'A')
    cache.insert('b', 'B')
    cache.insert('c', 'C')
    for (const key of ['a', 'b', 'c']) cache.release(key)

    cache.insert('d', 'D')
    expect(disposed).toEqual(['A'])
    expect(cache.keys()).toEqual(['b', 'c', 'd'])

    // Touching b makes c the oldest.
    expect(cache.acquire('b')).toBe('B')
    cache.release('b')
    cache.release('d')
    cache.insert('e', 'E')
    expect(disposed).toEqual(['A', 'C'])
    expect(cache.keys()).toEqual(['d', 'b', 'e'])
  })

  it('never holds more entries than its capacity', () => {
    const { cache } = lru(4)
    for (let i = 0; i < 50; i += 1) {
      cache.insert(`k${i}`, `V${i}`)
      cache.release(`k${i}`)
      expect(cache.size).toBeLessThanOrEqual(4)
    }
    expect(cache.size).toBe(4)
  })

  it('does not evict a held entry', () => {
    const { cache, disposed } = lru(2)
    cache.insert('a', 'A') // held
    cache.insert('b', 'B')
    cache.release('b')
    cache.insert('c', 'C')
    expect(disposed).toEqual(['B'])
    expect(cache.keys()).toEqual(['a', 'c'])
  })

  it('throws when every entry is held and another is inserted, and says so before decoding with hasRoom', () => {
    const { cache } = lru(2)
    cache.insert('a', 'A')
    cache.insert('b', 'B')
    expect(cache.hasRoom()).toBe(false)
    expect(() => cache.insert('c', 'C')).toThrow(/all 2 frames are held/)
    cache.release('a')
    expect(cache.hasRoom()).toBe(true)
  })

  it('counts holds: two acquires need two releases', () => {
    const { cache, disposed } = lru(1)
    cache.insert('a', 'A')
    cache.acquire('a')
    cache.release('a')
    expect(cache.hasRoom()).toBe(false)
    cache.release('a')
    cache.insert('b', 'B')
    expect(disposed).toEqual(['A'])
  })

  it('disposes everything on clear, held or not', () => {
    const { cache, disposed } = lru(3)
    cache.insert('a', 'A')
    cache.insert('b', 'B')
    cache.release('b')
    cache.clear()
    expect(disposed.sort()).toEqual(['A', 'B'])
    expect(cache.size).toBe(0)
  })

  it('refuses a capacity that is not a positive integer', () => {
    expect(() => new FrameLru(0, () => {})).toThrow(RangeError)
    expect(() => new FrameLru(1.5, () => {})).toThrow(RangeError)
  })
})
