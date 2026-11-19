/**
 * The page's access to the shell's Agent access bridge (task 2.2 slice 7).
 *
 * The shell's preload is the only thing that can answer; this module decides
 * whether it is there and whether this page knows its shape. A bridge with
 * another version is ignored exactly as `getDesktopBridge()` ignores one, so a
 * future shell cannot be driven by a stale page.
 */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { getAgentAccess, hasAgentAccess, type AgentAccessInfo } from './access'

const INFO: AgentAccessInfo = {
  enabled: false,
  status: 'off',
  socketPath: '/Users/test/Library/Application Support/DroneClean Studio/mcp.sock',
  launcherPath: '/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp',
}

function makeBridge() {
  return {
    version: 1 as const,
    status: vi.fn(async () => INFO),
    enable: vi.fn(async () => ({ ...INFO, enabled: true, status: 'on' as const })),
    disable: vi.fn(async () => INFO),
    log: vi.fn(async () => []),
  }
}

afterEach(() => {
  delete window.dronecleanAgentAccess
})

describe('agent access bridge accessor', () => {
  it('is undefined in the browser, where the shell exposes nothing', () => {
    expect(getAgentAccess()).toBeUndefined()
    expect(hasAgentAccess()).toBe(false)
  })

  it('returns the bridge when it speaks version 1', () => {
    const bridge = makeBridge()
    window.dronecleanAgentAccess = bridge

    expect(getAgentAccess()).toBe(bridge)
    expect(hasAgentAccess()).toBe(true)
  })

  it('ignores a bridge whose version it does not know', () => {
    window.dronecleanAgentAccess = {
      ...makeBridge(),
      version: 2,
    } as unknown as NonNullable<Window['dronecleanAgentAccess']>

    expect(getAgentAccess()).toBeUndefined()
    expect(hasAgentAccess()).toBe(false)
  })
})
