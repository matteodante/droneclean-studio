import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { askDesktopMicrophone, isMicrophoneBlockedBySystem } from './microphone'

function setBridge(bridge: unknown): void {
  Object.defineProperty(window, 'dronecleanDesktop', { configurable: true, value: bridge })
}

afterEach(() => {
  Reflect.deleteProperty(window, 'dronecleanDesktop')
})

describe('askDesktopMicrophone', () => {
  it('is null in the web editor and in a shell without the bridge member', async () => {
    expect(await askDesktopMicrophone()).toBeNull()
    setBridge({ version: 1 })
    expect(await askDesktopMicrophone()).toBeNull()
  })

  it('reports what the shell says', async () => {
    const request = vi.fn(async () => 'denied')
    setBridge({ version: 1, microphone: { request } })
    expect(await askDesktopMicrophone()).toBe('denied')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('is null when the shell fails to answer', async () => {
    setBridge({
      version: 1,
      microphone: {
        request: async () => {
          throw new Error('gone')
        },
      },
    })
    expect(await askDesktopMicrophone()).toBeNull()
  })
})

describe('isMicrophoneBlockedBySystem', () => {
  it('is true only for a refusal only System Settings can change', () => {
    expect(isMicrophoneBlockedBySystem('denied')).toBe(true)
    expect(isMicrophoneBlockedBySystem('restricted')).toBe(true)
    for (const access of ['granted', 'not-determined', 'unknown', null] as const) {
      expect(isMicrophoneBlockedBySystem(access)).toBe(false)
    }
  })
})
