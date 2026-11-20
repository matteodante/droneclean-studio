/**
 * The first-launch notice and Settings › Privacy, through the desktop shell's bridge faked on
 * `window` exactly as `desktop/src/preload/telemetry.ts` installs it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import '@/i18n'

vi.mock('./config', () => ({
  SENTRY_DSN: 'https://public@o1.ingest.de.sentry.io/2',
  SENTRY_RELEASE: 'droneclean-studio@9.9.9',
  POSTHOG_KEY: 'phc_test',
  POSTHOG_HOST: 'https://eu.i.posthog.com',
  STUDIO_VERSION: '9.9.9',
  TELEMETRY_FEATURES: { crashReports: true, usageStats: true },
}))

const { useTelemetryConsent } = await import('./consent')
const { TelemetryNotice } = await import('./consent-notice')
const { PrivacyPanel } = await import('./privacy-panel')

type Stored = Record<string, unknown> | null

function fakeBridge(initial: Stored) {
  let stored = initial
  const bridge = {
    version: 1 as const,
    get: vi.fn(async () => stored),
    set: vi.fn(async (choice: Record<string, boolean>) => {
      stored = { version: 1, ...(stored ?? {}), ...choice }
      return stored
    }),
  }
  window.dronecleanTelemetry = bridge as unknown as typeof window.dronecleanTelemetry
  return bridge
}

beforeEach(() => {
  useTelemetryConsent.setState({ loaded: false, settings: null })
})

afterEach(() => {
  delete window.dronecleanTelemetry
})

describe('TelemetryNotice', () => {
  it('asks on a profile that never answered and stores "no" for both halves', async () => {
    const bridge = fakeBridge(null)
    await useTelemetryConsent.getState().load()
    render(<TelemetryNotice />)
    expect(screen.getByTestId('telemetry-notice')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "Don't allow" }))
    await waitFor(() => expect(screen.queryByTestId('telemetry-notice')).toBeNull())
    expect(bridge.set).toHaveBeenCalledWith({ crashReports: false, usageStats: false })
  })

  it('stores "yes" for both halves', async () => {
    const bridge = fakeBridge(null)
    await useTelemetryConsent.getState().load()
    render(<TelemetryNotice />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(screen.queryByTestId('telemetry-notice')).toBeNull())
    expect(bridge.set).toHaveBeenCalledWith({ crashReports: true, usageStats: true })
  })

  it('stays hidden once answered, and before the answer is read', async () => {
    fakeBridge({ version: 1, crashReports: false, usageStats: true, installId: 'x' })
    const { rerender } = render(<TelemetryNotice />)
    expect(screen.queryByTestId('telemetry-notice')).toBeNull()
    await useTelemetryConsent.getState().load()
    rerender(<TelemetryNotice />)
    expect(screen.queryByTestId('telemetry-notice')).toBeNull()
  })
})

describe('PrivacyPanel', () => {
  it('shows each half as stored and changes one at a time', async () => {
    const bridge = fakeBridge({ version: 1, crashReports: false, usageStats: false })
    await useTelemetryConsent.getState().load()
    render(<PrivacyPanel />)
    const crash = screen.getByRole('switch', { name: 'Send crash reports' })
    const usage = screen.getByRole('switch', { name: 'Send anonymous usage statistics' })
    expect(crash.getAttribute('aria-checked')).toBe('false')
    expect(usage.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(crash)
    await waitFor(() => expect(crash.getAttribute('aria-checked')).toBe('true'))
    expect(bridge.set).toHaveBeenCalledWith({ crashReports: true })
    expect(usage.getAttribute('aria-checked')).toBe('false')
  })
})
