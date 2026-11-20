import { describe, expect, it, vi } from 'vite-plus/test'
import { FlowGapCache } from './cache'

const flows = () => ({ destroy: vi.fn() })

describe('the gap cache', () => {
  it('gives back a gap it holds, and nothing for one it does not', () => {
    const cache = new FlowGapCache(4, false)
    const gap = flows()
    cache.set('clip|10', 'clip', 10, gap)
    expect(cache.get('clip|10')).toBe(gap)
    expect(cache.get('clip|11')).toBeUndefined()
  })

  it('in an export, frees the clip’s gaps before the one it measures, and no other clip’s', () => {
    const cache = new FlowGapCache(4, true)
    const nine = flows()
    const other = flows()
    cache.set('a|9', 'a', 9, nine)
    cache.set('b|3', 'b', 3, other)
    cache.set('a|10', 'a', 10, flows())
    expect(nine.destroy).toHaveBeenCalledOnce()
    expect(cache.get('a|9')).toBeUndefined()
    expect(other.destroy).not.toHaveBeenCalled()
    expect(cache.size).toBe(2)
  })

  it('in a preview, keeps the gaps behind (a scrub goes back) and frees the least recently used beyond its capacity', () => {
    const cache = new FlowGapCache(2, false)
    const first = flows()
    const second = flows()
    cache.set('a|9', 'a', 9, first)
    cache.set('a|10', 'a', 10, second)
    expect(cache.get('a|9')).toBe(first)
    cache.set('a|11', 'a', 11, flows())
    expect(second.destroy).toHaveBeenCalledOnce()
    expect(first.destroy).not.toHaveBeenCalled()
    expect(cache.get('a|9')).toBe(first)
  })

  it('replaces a gap stored again under its key, and frees everything on clear', () => {
    const cache = new FlowGapCache(3, false)
    const old = flows()
    const fresh = flows()
    cache.set('a|1', 'a', 1, old)
    cache.set('a|1', 'a', 1, fresh)
    expect(old.destroy).toHaveBeenCalledOnce()
    cache.clear()
    expect(fresh.destroy).toHaveBeenCalledOnce()
    expect(cache.size).toBe(0)
  })

  it('refuses a capacity below one', () => {
    expect(() => new FlowGapCache(0, true)).toThrowError(RangeError)
  })
})
