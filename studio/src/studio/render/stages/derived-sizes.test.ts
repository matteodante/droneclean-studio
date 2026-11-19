import { describe, expect, it, vi } from 'vite-plus/test'
import { createDerivedSizeStore, derivedSizeKey } from './derived-sizes'

describe('derived-size store', () => {
  it('keys a size by stage and the stage key', () => {
    expect(derivedSizeKey('stabilize', 'media-1|abc')).toBe('stabilize|media-1|abc')
    expect(derivedSizeKey('look', 'media-1|abc')).not.toBe(
      derivedSizeKey('stabilize', 'media-1|abc'),
    )
  })

  it('stores, reads and forgets; new settings are a new key', () => {
    const store = createDerivedSizeStore()
    const old = derivedSizeKey('stabilize', 'm|fov1')
    const changed = derivedSizeKey('stabilize', 'm|fov2')
    store.set(old, { width: 3840, height: 2160 })
    expect(store.get(old)).toEqual({ width: 3840, height: 2160 })
    expect(store.get(changed)).toBeUndefined()
    store.delete(old)
    expect(store.get(old)).toBeUndefined()
  })

  it('tells subscribers once per real change, and stops after unsubscribe', () => {
    const store = createDerivedSizeStore()
    const listener = vi.fn()
    const stop = store.subscribe(listener)
    store.set('k', { width: 10, height: 20 })
    store.set('k', { width: 10, height: 20 })
    expect(listener).toHaveBeenCalledTimes(1)
    store.set('k', { width: 11, height: 20 })
    store.delete('k')
    store.delete('k')
    expect(listener.mock.calls).toEqual([['k'], ['k'], ['k']])
    stop()
    store.set('k', { width: 1, height: 1 })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('keeps its own copy of a size', () => {
    const store = createDerivedSizeStore()
    const size = { width: 4, height: 4 }
    store.set('k', size)
    size.width = 99
    expect(store.get('k')).toEqual({ width: 4, height: 4 })
  })

  it('rejects a size that is not whole pixels above 0', () => {
    const store = createDerivedSizeStore()
    expect(() => store.set('k', { width: 0, height: 10 })).toThrow(RangeError)
    expect(() => store.set('k', { width: 10.5, height: 10 })).toThrow(RangeError)
    expect(() => store.set('k', { width: 10, height: Number.NaN })).toThrow(RangeError)
  })
})
