import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { i18n } from '@/i18n'
import type { DesktopBridge } from '@/studio/desktop/bridge'
import {
  DESKTOP_APP_URL,
  DESKTOP_NOTICE_DISMISSED_KEY,
  DesktopAppNotice,
} from './desktop-app-notice'

describe('DesktopAppNotice', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    cleanup()
    delete window.dronecleanDesktop
  })

  it('renders in a browser and links to the download options in a new tab', () => {
    render(<DesktopAppNotice />)
    expect(screen.getByText(/10-bit masters/)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Get the desktop app' })
    expect(link.getAttribute('href')).toBe(DESKTOP_APP_URL)
    expect(DESKTOP_APP_URL).toBe('https://droneclean.app/#get-studio')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('hides after dismissal and stays hidden on the next visit', () => {
    const first = render(<DesktopAppNotice />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('link')).toBeNull()
    expect(window.localStorage.getItem(DESKTOP_NOTICE_DISMISSED_KEY)).toBe('1')
    first.unmount()

    render(<DesktopAppNotice />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders nothing when the desktop bridge exists', () => {
    const bridge: DesktopBridge = { version: 1, platform: 'darwin', getPathForFile: () => '' }
    window.dronecleanDesktop = bridge
    const { container } = render(<DesktopAppNotice />)
    expect(container.innerHTML).toBe('')
  })
})
