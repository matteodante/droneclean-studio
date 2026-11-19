import { describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { NoLensProfileError, NoMotionDataError } from '../client'
import type { StabilizationSettings } from '../settings'

const { seat } = vi.hoisted(() => ({
  seat: {
    open: vi.fn(),
    smoothingMethods: vi.fn(async () => [{ name: 'Default', params: [] }]),
    setSettings: vi.fn(async () => undefined),
  },
}))
vi.mock('../seat', () => ({ stabilizationSeat: () => seat }))

import { pageEngine } from './engine'

const SETTINGS = { enabled: true, method: 'Default', params: {} } as unknown as StabilizationSettings
const ITEM = { id: 'c', type: 'video', mediaId: 'm' } as unknown as VideoItem

describe('the page engine', () => {
  it('reads the smoothing methods from the host, not from a client of its own', async () => {
    expect(await pageEngine.smoothingMethods()).toEqual([{ name: 'Default', params: [] }])
  })

  it('opens the clip on the host with the new settings, progress and a retry, and returns the lens', async () => {
    const lens = { name: 'Avata 2', model: 'opencv_fisheye' }
    seat.open.mockResolvedValue({ kind: 'ready', info: {}, lens })
    const onProgress = vi.fn()
    expect(await pageEngine.probe(ITEM, SETTINGS, 60, onProgress)).toBe(lens)
    expect(seat.open).toHaveBeenCalledWith(
      { ...ITEM, stabilization: SETTINGS },
      { fps: 60, onProgress, retry: true },
    )
  })

  it('rejects with the typed error of each result that is not ready', async () => {
    const noMotion = new NoMotionDataError()
    seat.open.mockResolvedValueOnce({ kind: 'no-motion-data', error: noMotion })
    await expect(pageEngine.probe(ITEM, SETTINGS, 60, vi.fn())).rejects.toBe(noMotion)
    const noLens = new NoLensProfileError()
    seat.open.mockResolvedValueOnce({ kind: 'no-lens-profile', info: {}, error: noLens })
    await expect(pageEngine.probe(ITEM, SETTINGS, 60, vi.fn())).rejects.toBe(noLens)
    const failed = new Error('engine words')
    seat.open.mockResolvedValueOnce({ kind: 'failed', error: failed })
    await expect(pageEngine.probe(ITEM, SETTINGS, 60, vi.fn())).rejects.toBe(failed)
  })

  it('applies settings through the host', async () => {
    await pageEngine.applySettings(ITEM, SETTINGS)
    expect(seat.setSettings).toHaveBeenCalledWith(ITEM, SETTINGS)
  })
})
