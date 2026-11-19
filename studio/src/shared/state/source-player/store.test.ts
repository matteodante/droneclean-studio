// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useSourcePlayerStore } from './store'
import { getSourceWindow } from './types'

describe('source-player-store', () => {
  beforeEach(() => {
    useSourcePlayerStore.setState({
      hoveredPanel: null,
      playerMethods: null,
      currentMediaId: null,
      currentSourceFrame: 0,
      previewSourceFrame: null,
      inPoint: null,
      outPoint: null,
      marksByKey: {},
      activeSubclipId: null,
      activeWindow: null,
      pendingSeekFrame: null,
    })
  })

  it('clears source monitor state when the active owner releases it', () => {
    const store = useSourcePlayerStore.getState()

    store.setCurrentMediaId('media-1')
    store.setInPoint(12)
    store.setOutPoint(48)
    store.releaseCurrentMediaId('media-1')

    expect(useSourcePlayerStore.getState()).toMatchObject({
      currentMediaId: null,
      currentSourceFrame: 0,
      previewSourceFrame: null,
      inPoint: null,
      outPoint: null,
    })
  })

  it('preserves source monitor state when another media item has taken ownership', () => {
    const store = useSourcePlayerStore.getState()

    store.setCurrentMediaId('media-1')
    store.setCurrentMediaId('media-2')
    store.setInPoint(75)
    store.setOutPoint(150)
    store.setPendingSeekFrame(75)
    store.releaseCurrentMediaId('media-1')

    expect(useSourcePlayerStore.getState()).toMatchObject({
      currentMediaId: 'media-2',
      inPoint: 75,
      outPoint: 150,
      previewSourceFrame: null,
      pendingSeekFrame: 75,
    })
  })

  it('remembers in/out per media across switching media', () => {
    const store = useSourcePlayerStore.getState()
    store.setCurrentMediaId('media-1')
    store.setInPoint(10)
    store.setOutPoint(40)
    store.setCurrentMediaId('media-2')
    expect(useSourcePlayerStore.getState()).toMatchObject({ inPoint: null, outPoint: null })
    store.setInPoint(5)
    store.setCurrentMediaId('media-1')
    expect(useSourcePlayerStore.getState()).toMatchObject({ inPoint: 10, outPoint: 40 })
    store.releaseCurrentMediaId('media-1')
    store.setCurrentMediaId('media-1')
    expect(useSourcePlayerStore.getState()).toMatchObject({ inPoint: 10, outPoint: 40 })
    expect(useSourcePlayerStore.getState().marksByKey).toEqual({
      'media-1': { in: 10, out: 40 },
      'media-2': { in: 5, out: null },
    })
  })

  it('keys the marks of an open subclip by the subclip', () => {
    const store = useSourcePlayerStore.getState()
    store.setCurrentMediaId('media-1')
    store.setInPoint(10)
    store.setActiveSubclip('sub-1', { start: 100, end: 200 })
    expect(useSourcePlayerStore.getState()).toMatchObject({
      activeSubclipId: 'sub-1',
      activeWindow: { start: 100, end: 200 },
      inPoint: null,
    })
    store.setInPoint(120)
    store.setActiveSubclip(null, null)
    expect(useSourcePlayerStore.getState()).toMatchObject({ inPoint: 10, activeWindow: null })
    store.setActiveSubclip('sub-1', { start: 100, end: 200 })
    expect(useSourcePlayerStore.getState().inPoint).toBe(120)
    // another media closes the subclip
    store.setCurrentMediaId('media-2')
    expect(useSourcePlayerStore.getState().activeSubclipId).toBeNull()
  })

  it('has the whole file as the window without a subclip', () => {
    expect(getSourceWindow(useSourcePlayerStore.getState(), 600)).toEqual({ start: 0, end: 600 })
    const store = useSourcePlayerStore.getState()
    store.setCurrentMediaId('media-1')
    store.setActiveSubclip('s', { start: 10, end: 20 })
    expect(getSourceWindow(useSourcePlayerStore.getState(), 600)).toEqual({ start: 10, end: 20 })
  })

  it('replaces the remembered marks and refreshes the open pair', () => {
    const store = useSourcePlayerStore.getState()
    store.setCurrentMediaId('media-1')
    store.setMarksByKey({ 'media-1': { in: 3, out: 9 } })
    expect(useSourcePlayerStore.getState()).toMatchObject({ inPoint: 3, outPoint: 9 })
  })
})
