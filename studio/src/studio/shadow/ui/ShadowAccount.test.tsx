import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { i18n } from '@/i18n'
import type { DesktopShadowCloud } from '../session-desktop'
import { ShadowAccount } from './ShadowAccount'

function cloud(options: { signedIn: boolean; email?: string | null; accountFails?: boolean }) {
  let signedIn = options.signedIn
  const setToken = vi.fn(async (token: string | null) => {
    if (token === null) signedIn = false
  })
  const value = {
    session: { getToken: async () => (signedIn ? 'placeholder' : null), setToken },
    client: {
      getAccount: async () => {
        if (options.accountFails) throw new Error('offline')
        return { user: { email: options.email ?? null } }
      },
    },
  } as unknown as DesktopShadowCloud
  return { value, setToken }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('ShadowAccount', () => {
  it('shows who is signed in and signs out on the button', async () => {
    const { value, setToken } = cloud({ signedIn: true, email: 'pilot@example.com' })
    render(<ShadowAccount cloud={value} />)

    expect((await screen.findByTestId('shadow-account-status')).textContent).toBe(
      'Signed in as pilot@example.com',
    )
    fireEvent.click(screen.getByTestId('shadow-sign-out'))
    await vi.waitFor(() => expect(screen.queryByTestId('shadow-account')).toBeNull())
    expect(setToken).toHaveBeenCalledWith(null)
  })

  it('says only "Signed in" when the account cannot be read, and still offers the way out', async () => {
    render(<ShadowAccount cloud={cloud({ signedIn: true, accountFails: true }).value} />)
    expect((await screen.findByTestId('shadow-account-status')).textContent).toBe('Signed in')
    expect(screen.getByTestId('shadow-sign-out')).toBeTruthy()
  })

  it('renders nothing while signed out, and nothing in the web editor', async () => {
    const out = render(<ShadowAccount cloud={cloud({ signedIn: false }).value} />)
    await Promise.resolve()
    expect(out.container.textContent).toBe('')
    const web = render(<ShadowAccount cloud={null} />)
    expect(web.container.textContent).toBe('')
  })
})
