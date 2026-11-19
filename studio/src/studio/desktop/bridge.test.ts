import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { getDesktopBridge, type DesktopBridge } from './bridge'

function makeBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    version: 1,
    platform: 'darwin',
    getPathForFile: vi.fn(() => '/Volumes/Media/clip.mp4'),
    ...overrides,
  }
}

afterEach(() => {
  delete window.dronecleanDesktop
})

describe('desktop bridge accessor', () => {
  it('is undefined in the browser, where the shell exposes nothing', () => {
    expect(getDesktopBridge()).toBeUndefined()
  })

  it('returns the preload API when its version is 1', () => {
    const bridge = makeBridge()
    window.dronecleanDesktop = bridge

    expect(getDesktopBridge()).toBe(bridge)

    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
    expect(getDesktopBridge()?.getPathForFile(file)).toBe('/Volumes/Media/clip.mp4')
  })

  it('ignores an API whose version it does not know', () => {
    window.dronecleanDesktop = { ...makeBridge(), version: 2 } as unknown as DesktopBridge

    expect(getDesktopBridge()).toBeUndefined()
  })
})
