/**
 * The new-version card and Settings › Privacy's switch, through the desktop shell's bridge faked on
 * `window` exactly as `desktop/src/preload/updates.ts` installs it.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import '@/i18n'
import { useTelemetryConsent } from '@/studio/telemetry/consent'
import { PrivacyPanel } from '@/studio/telemetry/privacy-panel'
import { UpdateNotice } from './update-notice'
import { hasUpdateCheck, useUpdates, type UpdateNotice as Notice } from './updates'

const NOTICE: Notice = { version: '0.2.0', url: 'https://github.com/matteodante/droneclean-studio/releases/tag/v0.2.0' }

function fakeBridge(initial: { enabled?: boolean; notice?: Notice | null } = {}) {
  let listener: ((notice: Notice) => void) | undefined
  let enabled = initial.enabled ?? true
  const bridge = {
    version: 1 as const,
    getEnabled: vi.fn(async () => enabled),
    setEnabled: vi.fn(async (on: boolean) => {
      enabled = on
      return on
    }),
    getNotice: vi.fn(async () => initial.notice ?? null),
    dismiss: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    onAvailable: vi.fn((next: (notice: Notice) => void) => {
      listener = next
      return () => {
        listener = undefined
      }
    }),
  }
  window.dronecleanUpdates = bridge as unknown as typeof window.dronecleanUpdates
  return { bridge, push: (notice: Notice) => listener?.(notice) }
}

beforeEach(() => {
  useUpdates.setState({ loaded: false, enabled: true, notice: null })
  // Privacy question already answered, so the card is not held back.
  useTelemetryConsent.setState({ loaded: true, settings: { version: 1, crashReports: false, usageStats: false } })
})

afterEach(() => {
  delete window.dronecleanUpdates
})

describe('UpdateNotice', () => {
  it('is absent in the browser, where there is no bridge', async () => {
    expect(hasUpdateCheck()).toBe(false)
    render(<UpdateNotice />)
    await act(async () => undefined)
    expect(screen.queryByTestId('update-notice')).toBeNull()
  })

  it('shows a version found before the page was ready, and "Download" asks the shell to open it', async () => {
    const { bridge } = fakeBridge({ notice: NOTICE })
    render(<UpdateNotice />)
    expect(await screen.findByText('DroneClean Studio 0.2.0 is available')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(screen.queryByTestId('update-notice')).toBeNull())
    expect(bridge.open).toHaveBeenCalledTimes(1)
    expect(bridge.open).toHaveBeenCalledWith()
  })

  it('shows a version the shell finds later, and "Later" hides it', async () => {
    const { bridge, push } = fakeBridge()
    render(<UpdateNotice />)
    await waitFor(() => expect(bridge.getNotice).toHaveBeenCalled())
    expect(screen.queryByTestId('update-notice')).toBeNull()
    act(() => push(NOTICE))
    expect(await screen.findByTestId('update-notice')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    await waitFor(() => expect(screen.queryByTestId('update-notice')).toBeNull())
    expect(bridge.dismiss).toHaveBeenCalledTimes(1)
  })

  it('waits while the first-launch privacy question is on screen', async () => {
    useTelemetryConsent.setState({ loaded: true, settings: null })
    fakeBridge({ notice: NOTICE })
    render(<UpdateNotice />)
    await act(async () => undefined)
    expect(screen.queryByTestId('update-notice')).toBeNull()
  })

  it('stays out of the way while an export renders', async () => {
    fakeBridge({ notice: NOTICE })
    const { useRenderQueueStore } = await import('@/features/export/stores/render-queue-store')
    const before = useRenderQueueStore.getState().jobs
    useRenderQueueStore.setState({ jobs: [{ id: 'j', status: 'rendering' } as never] })
    try {
      render(<UpdateNotice />)
      await act(async () => undefined)
      expect(screen.queryByTestId('update-notice')).toBeNull()
      act(() => useRenderQueueStore.setState({ jobs: [] }))
      expect(await screen.findByTestId('update-notice')).toBeTruthy()
    } finally {
      useRenderQueueStore.setState({ jobs: before })
    }
  })

  it('ignores a pushed notice once the switch is off', async () => {
    const { push } = fakeBridge({ enabled: false })
    render(<UpdateNotice />)
    await waitFor(() => expect(useUpdates.getState().loaded).toBe(true))
    act(() => push(NOTICE))
    expect(screen.queryByTestId('update-notice')).toBeNull()
  })
})

describe('Settings › Privacy', () => {
  it('shows the switch as stored and turns the check off through the shell', async () => {
    const { bridge } = fakeBridge({ notice: NOTICE })
    render(<PrivacyPanel />)
    const toggle = await screen.findByRole('switch', { name: 'Check for new versions' })
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByText(/GitHub sees your IP address/)).toBeTruthy()
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    expect(bridge.setEnabled).toHaveBeenCalledWith(false)
    expect(useUpdates.getState().notice).toBeNull()
  })

  it('has no such switch in the browser', () => {
    render(<PrivacyPanel />)
    expect(screen.queryByRole('switch', { name: 'Check for new versions' })).toBeNull()
  })
})
