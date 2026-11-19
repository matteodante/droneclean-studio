// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const bridge = vi.hoisted(() => ({ current: undefined as unknown }))
vi.mock('@/studio/desktop/bridge', () => ({ getDesktopBridge: () => bridge.current }))

import { hasNativeExportBridge, readNativePresetCapabilities } from './native-capabilities'
import { WEB_PRESET_CAPABILITIES } from './presets'

function shell(capabilities: () => Promise<unknown>, members: Record<string, unknown> = { mediaPaths: {}, exportFile: {} }) {
  return { version: 1, nativeMedia: { capabilities }, ...members }
}

afterEach(() => {
  bridge.current = undefined
})

describe('readNativePresetCapabilities', () => {
  it('is the web capabilities in a browser, without asking anything', async () => {
    expect(hasNativeExportBridge()).toBe(false)
    expect(await readNativePresetCapabilities()).toEqual(WEB_PRESET_CAPABILITIES)
  })

  it('offers both masters when the shell’s FFmpeg writes both formats', async () => {
    bridge.current = shell(async () => ({
      ok: true,
      value: { available: true, exportFormats: ['hevc-main10', 'prores-422-hq', 'h264-8bit'] },
    }))
    expect(await readNativePresetCapabilities()).toEqual({
      nativeEncoder: true,
      nativeFormats: ['hevc-main10', 'prores-422-hq'],
    })
  })

  it('offers only the master whose format is listed', async () => {
    bridge.current = shell(async () => ({ ok: true, value: { available: true, exportFormats: ['hevc-main10'] } }))
    expect(await readNativePresetCapabilities()).toEqual({ nativeEncoder: true, nativeFormats: ['hevc-main10'] })
  })

  it('offers none when the engine is missing, lists no master, refuses or throws', async () => {
    for (const capabilities of [
      async () => ({ ok: true, value: { available: false, exportFormats: ['hevc-main10'] } }),
      async () => ({ ok: true, value: { available: true, exportFormats: ['h264-8bit'] } }),
      async () => ({ ok: false }),
      async () => {
        throw new Error('ipc gone')
      },
    ]) {
      bridge.current = shell(capabilities)
      expect(await readNativePresetCapabilities()).toEqual(WEB_PRESET_CAPABILITIES)
    }
  })

  it('offers none from a shell that lacks the media registry or the save dialog', async () => {
    const capabilities = async () => ({ ok: true, value: { available: true, exportFormats: ['hevc-main10'] } })
    bridge.current = shell(capabilities, { exportFile: {} })
    expect(await readNativePresetCapabilities()).toEqual(WEB_PRESET_CAPABILITIES)
    bridge.current = shell(capabilities, { mediaPaths: {} })
    expect(await readNativePresetCapabilities()).toEqual(WEB_PRESET_CAPABILITIES)
  })
})
