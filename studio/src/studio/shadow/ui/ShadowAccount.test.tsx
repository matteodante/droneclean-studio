import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { i18n } from '@/i18n'
import { createDesktopShadowCloud, type DesktopShadowCloud } from '../session-desktop'
import { ShadowAccount } from './ShadowAccount'

function cloud(options: { signedIn: boolean }) {
  let signedIn = options.signedIn
  const setToken = vi.fn(async (token: string | null) => {
    if (token === null) signedIn = false
  })
  const getAccount = vi.fn(async () => ({ user: { email: 'pilot@example.com' } }))
  const value = {
    session: { getToken: async () => (signedIn ? 'placeholder' : null), setToken },
    client: { getAccount },
  } as unknown as DesktopShadowCloud
  return { value, setToken, getAccount }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('ShadowAccount', () => {
  it('shows that the pilot is signed in and signs out on the button', async () => {
    const { value, setToken } = cloud({ signedIn: true })
    render(<ShadowAccount cloud={value} />)

    expect((await screen.findByTestId('shadow-account-status')).textContent).toBe('Signed in')
    fireEvent.click(screen.getByTestId('shadow-sign-out'))
    await vi.waitFor(() => expect(screen.queryByTestId('shadow-account')).toBeNull())
    expect(setToken).toHaveBeenCalledWith(null)
  })

  it('never asks the cloud on its own: that call carries the token, and reading it asks the keychain', async () => {
    const { value, getAccount } = cloud({ signedIn: true })
    render(<ShadowAccount cloud={value} />)
    await screen.findByTestId('shadow-account-status')
    expect(getAccount).not.toHaveBeenCalled()
  })

  it('reads only the non-secret status through the desktop bridge, and makes no call to the cloud', async () => {
    const bridge = {
      status: vi.fn(async () => ({ signedIn: true, persistent: true })),
      request: vi.fn(async () => ({ status: 200, headers: {}, body: '{}' })),
      signOut: vi.fn(async () => {}),
    }
    const real = createDesktopShadowCloud(bridge, {
      baseUrl: 'https://cloud.test',
      pageFetch: async () => new Response('{}'),
      openUrl: () => {},
    })
    render(<ShadowAccount cloud={real} />)
    await screen.findByTestId('shadow-account-status')
    expect(bridge.status).toHaveBeenCalled()
    expect(bridge.request).not.toHaveBeenCalled()
  })

  it('renders nothing while signed out, and nothing in the web editor', async () => {
    const out = render(<ShadowAccount cloud={cloud({ signedIn: false }).value} />)
    await Promise.resolve()
    expect(out.container.textContent).toBe('')
    const web = render(<ShadowAccount cloud={null} />)
    expect(web.container.textContent).toBe('')
  })
})
