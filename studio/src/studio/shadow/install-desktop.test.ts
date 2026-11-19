import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const configureShadowSession = vi.fn()
vi.mock('./ui/use-shadow-session', () => ({ configureShadowSession }))

import { installDesktopShadowSession } from './install-desktop'
import { SHADOW_TOKEN_PLACEHOLDER, desktopShadowCloud, setDesktopShadowCloud } from './session-desktop'

afterEach(() => {
  setDesktopShadowCloud(null)
  delete window.dronecleanDesktop
  configureShadowSession.mockClear()
})

describe('installDesktopShadowSession', () => {
  it('leaves the web defaults alone when the shell has no shadowSession', async () => {
    installDesktopShadowSession()
    window.dronecleanDesktop = { version: 1, platform: 'darwin', getPathForFile: () => '' }
    installDesktopShadowSession()
    await Promise.resolve()
    expect(desktopShadowCloud()).toBeNull()
    expect(configureShadowSession).not.toHaveBeenCalled()
  })

  it('configures the shadow flow over the main process session in the desktop app', async () => {
    window.dronecleanDesktop = {
      version: 1,
      platform: 'darwin',
      getPathForFile: () => '',
      shadowSession: {
        status: async () => ({ signedIn: true, persistent: true }),
        request: async () => ({ status: 200, headers: {}, body: '{}' }),
        signOut: async () => undefined,
      },
    } as never
    installDesktopShadowSession()
    await vi.waitFor(() => expect(configureShadowSession).toHaveBeenCalledTimes(1))
    const given = configureShadowSession.mock.calls[0]?.[0] as { session: { getToken(): Promise<string | null> } }
    expect(await given.session.getToken()).toBe(SHADOW_TOKEN_PLACEHOLDER)
    expect(desktopShadowCloud()).not.toBeNull()
  })
})
