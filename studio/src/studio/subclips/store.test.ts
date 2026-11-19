// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { countSubclipsForMedia, getSubclipsForMedia, useSubclipsStore } from './store'

const base = { mediaId: 'media-1', name: 'Gap', sourceFps: 59.94 }

describe('subclips store', () => {
  beforeEach(() => useSubclipsStore.getState().reset())

  it('creates, renames and removes', () => {
    const store = useSubclipsStore.getState()
    const a = store.create({ ...base, startFrame: 10, endFrame: 70 })
    const b = store.create({ ...base, name: ' Dive ', startFrame: 100, endFrame: 130 })
    expect(b.name).toBe('Dive')
    expect(a.id).not.toBe(b.id)
    expect(getSubclipsForMedia('media-1')).toHaveLength(2)

    expect(store.rename(a.id, 'Gap one')).toBe(true)
    expect(store.rename(a.id, '   ')).toBe(false)
    expect(store.rename('missing', 'x')).toBe(false)
    expect(useSubclipsStore.getState().subclips[0]?.name).toBe('Gap one')

    expect(store.remove([a.id, 'missing'])).toBe(1)
    expect(useSubclipsStore.getState().subclips.map((s) => s.id)).toEqual([b.id])
  })

  it('refuses bad ranges and never clamps', () => {
    const store = useSubclipsStore.getState()
    expect(() => store.create({ ...base, startFrame: -1, endFrame: 5 })).toThrow(RangeError)
    expect(() => store.create({ ...base, startFrame: 5, endFrame: 5 })).toThrow(RangeError)
    expect(() => store.create({ ...base, startFrame: 1.5, endFrame: 5 })).toThrow(RangeError)
    expect(() =>
      store.create({ ...base, startFrame: 0, endFrame: 601, parentFrameCount: 600 }),
    ).toThrow(RangeError)
    expect(() => store.create({ ...base, name: '  ', startFrame: 0, endFrame: 5 })).toThrow(
      RangeError,
    )
    expect(useSubclipsStore.getState().subclips).toEqual([])
  })

  it('deleting the parent removes its subclips and the count is known first', () => {
    const store = useSubclipsStore.getState()
    store.create({ ...base, startFrame: 0, endFrame: 10 })
    store.create({ ...base, startFrame: 20, endFrame: 30 })
    const other = store.create({ ...base, mediaId: 'media-2', startFrame: 0, endFrame: 10 })

    expect(countSubclipsForMedia(['media-1'])).toBe(2)
    expect(countSubclipsForMedia(['media-1', 'media-2'])).toBe(3)
    expect(store.removeForMedia('media-1')).toHaveLength(2)
    expect(useSubclipsStore.getState().subclips.map((s) => s.id)).toEqual([other.id])
    expect(store.removeForMedia('media-1')).toEqual([])
  })

  it('drops malformed and repeated records when loading', () => {
    const good = { ...base, id: 's1', startFrame: 0, endFrame: 10, createdAt: 5 }
    useSubclipsStore
      .getState()
      .setSubclips([good, good, { ...good, id: 's2', endFrame: 0 }, null, { id: 's3' }])
    expect(useSubclipsStore.getState().subclips).toEqual([good])
  })
})
