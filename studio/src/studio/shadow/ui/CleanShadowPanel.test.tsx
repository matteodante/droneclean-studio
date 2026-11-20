import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { i18n } from '@/i18n'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import type { VideoItem } from '@/types/timeline'
import {
  CONFIG,
  DEVICE_TOKEN,
  FULL_JOB_ID,
  QUOTE,
  TRACK_JOB,
  UPLOAD_ID,
} from '../api/__fixtures__/recorded'
import { createFakeCloud, type FakeCloud } from '../api/__fixtures__/fake-cloud'
import { createDroneCleanClient } from '../api/client'
import { createMemorySession } from '../api/session'
import type { ShadowPendingClean } from '../model'
import { CleanShadowPanel } from './CleanShadowPanel'
import {
  SHADOW_SESSION_IDLE,
  configureShadowSession,
  resumePendingCleans,
  useShadowSessionStore,
  type ShadowSessionStore,
} from './use-shadow-session'

// The English strings this test asserts on, which the wave's shared-file pass adds to
// `src/i18n/locales/partials/en/editor.json` (the keys are listed in the report).
beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { cancel: 'Cancel' },
      editor: {
        shadowSection: {
          clean: 'Clean',
          cleaned: 'Frames {{start}}–{{end}} are cleaned.',
          getCredits: 'Get credits',
          pendingRunning:
            'A paid clean of frames {{start}}–{{end}} is on its way; its result will be added to the clip.',
          pendingWaiting: 'A paid clean of frames {{start}}–{{end}} has not been brought in yet.',
          pendingUnreachable:
            'DroneClean could not be reached. The paid clean of frames {{start}}–{{end}} is kept and will be picked up again.',
          pendingRepriced:
            'The service reserved a different price ({{reserved}} credits, not the {{credits}} shown), so the job was not started. The cancel did not go through yet; it will be tried again.',
          pendingRetry: 'Try again',
          pendingMissing:
            'DroneClean does not know the job of the paid clean of frames {{start}}–{{end}}: it may belong to another DroneClean account.',
          pendingForget: 'Forget',
          forgetTitle: 'Forget this paid clean?',
          forgetBody:
            'The editor will stop waiting for it, and its paid result may be lost to this project. If the job was made, its cleaned file stays on your DroneClean profile for 30 days: droneclean.app/profile, under Videos, where you can download it.',
          forgetConfirm: 'Forget it',
          projectNotSaved:
            'The project could not be saved after the press. Save it now, so this paid clean is not lost if the editor closes.',
        },
      },
    },
    true,
    true,
  )
})

const MARK = { x: 1860.25, y: 2410.5, sourceFrame: 3630, radius: 96.5 }

const ITEM: VideoItem = {
  id: 'clip-1',
  trackId: 'track-1',
  type: 'video',
  label: 'DJI_0020',
  mediaId: 'media-1',
  src: 'blob:clip-1',
  from: 0,
  durationInFrames: 13_839,
  sourceFps: 59.94,
  shadowRemoval: { mark: { ...MARK }, ranges: [], pieces: [] },
}

const PASS = {
  jobId: TRACK_JOB.id,
  chargedCredits: 20,
  refundedCredits: 0,
  uploadId: 'upload-1',
  mark: { ...MARK },
  window: {
    startFrame: 3330,
    endFrame: 3930,
    startSeconds: 3330 / 59.94,
    endSeconds: 3930 / 59.94,
  },
  points: [{ frame: 3360, x: 1860.25, y: 2410.5, radius: 96.5 }],
  ranges: [{ startFrame: 3360, endFrame: 3390 }],
}

function show(state: Partial<ShadowSessionStore>): void {
  useShadowSessionStore.setState(state)
}

describe('CleanShadowPanel', () => {
  beforeEach(() => {
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE })
    useItemsStore.getState().setItems([ITEM])
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [] })
    configureShadowSession({ openUrl: () => undefined })
  })

  it('renders nothing until the clip has a priced pass', () => {
    const { container } = render(<CleanShadowPanel item={ITEM} />)
    expect(container.innerHTML).toBe('')

    show({ isOpen: true, clipId: ITEM.id, stage: 'ready', pass: PASS, quote: null, config: CONFIG })
    const withPass = render(<CleanShadowPanel item={ITEM} />)
    // The pass exists but there is no price: there is nothing whose cost the pilot could see.
    expect(withPass.container.innerHTML).toBe('')
  })

  it('offers the press, and takes it away while a flow is running', () => {
    show({
      isOpen: true,
      clipId: ITEM.id,
      stage: 'ready',
      pass: PASS,
      quote: QUOTE,
      config: CONFIG,
    })
    render(<CleanShadowPanel item={ITEM} />)
    expect(screen.getByTestId('shadow-clean-button')).toBeEnabled()

    act(() => {
      useShadowSessionStore.setState({ stage: 'cleaning' })
    })
    expect(screen.getByTestId('shadow-clean-button')).toBeDisabled()
  })

  it('says the window is cleaned once a piece covers it, with no second press', () => {
    const cleaned: VideoItem = {
      ...ITEM,
      shadowRemoval: {
        mark: { ...MARK },
        ranges: [],
        pieces: [
          {
            jobId: 'job-1',
            path: 'media/media-1/shadow/3330_600.mp4',
            src: 'blob:cleaned-piece',
            startFrame: 3330,
            frames: 600,
          },
        ],
      },
    }
    useItemsStore.getState().setItems([cleaned])
    show({
      isOpen: true,
      clipId: ITEM.id,
      stage: 'ready',
      pass: PASS,
      quote: QUOTE,
      config: CONFIG,
    })

    render(<CleanShadowPanel item={cleaned} />)

    expect(screen.getByTestId('shadow-cleaned').textContent).toBe('Frames 3330–3929 are cleaned.')
    expect(screen.queryByTestId('shadow-clean-button')).toBeNull()
  })

  it('blocks the press on a short balance and offers the shop', async () => {
    const openUrl = vi.fn()
    configureShadowSession({ openUrl })
    show({
      isOpen: true,
      clipId: ITEM.id,
      stage: 'ready',
      pass: PASS,
      quote: { ...QUOTE, availableCredits: 20, enough: false },
      config: { ...CONFIG, freeBeta: false },
    })
    render(<CleanShadowPanel item={ITEM} />)

    expect(screen.getByTestId('shadow-clean-button')).toBeDisabled()
    act(() => {
      screen.getByTestId('shadow-get-credits').click()
    })
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith('https://droneclean.app/profile?buy=1'),
    )
  })

  it('asks for credits during the free beta instead of selling them', async () => {
    const openUrl = vi.fn()
    configureShadowSession({ openUrl })
    show({
      isOpen: true,
      clipId: ITEM.id,
      stage: 'ready',
      pass: PASS,
      quote: { ...QUOTE, availableCredits: 20, enough: false },
      config: { ...CONFIG, freeBeta: true },
    })
    render(<CleanShadowPanel item={ITEM} />)

    act(() => {
      screen.getByTestId('shadow-get-credits').click()
    })
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://droneclean.app/profile'))
  })
})

/** The panel's session over the stateful fake cloud. */
function connectCloud(
  cloud: FakeCloud,
  options: {
    sleep?: () => Promise<void>
    savePiece?: (segments: string[], blob: Blob) => Promise<string>
  } = {},
): ReturnType<typeof vi.fn> {
  const session = createMemorySession(DEVICE_TOKEN.access_token)
  const savePiece = vi.fn(
    options.savePiece ?? (async (_segments: string[], _blob: Blob) => 'blob:cleaned-piece'),
  )
  configureShadowSession({
    client: createDroneCleanClient({
      baseUrl: 'https://droneclean.test',
      fetch: cloud.server.fetch,
      session,
      openUrl: () => undefined,
    }),
    session,
    savePiece,
    openUrl: () => undefined,
    sleep: options.sleep ?? (async () => undefined),
    now: () => new Date('2026-11-18T10:00:00.000Z'),
    saveProject: async () => undefined,
  })
  return savePiece
}

const PENDING: ShadowPendingClean = {
  attemptId: '0b6f9c3e-7a52-4f0e-9d1c-00000000aaaa',
  uploadId: UPLOAD_ID,
  startFrame: 3330,
  frames: 600,
  ranges: [{ startFrame: 3360, endFrame: 3390 }],
  passJobId: TRACK_JOB.id,
  credits: 45,
  segments: [
    {
      startSeconds: 0.5,
      endSeconds: 1,
      anchor: { x: 1860.25, y: 2410.5, timeSeconds: 0.5, radius: 96.5 },
      trackJobIds: [TRACK_JOB.id],
    },
  ],
  startedAt: '2026-11-18T09:50:00.000Z',
}

function withPending(...pending: ShadowPendingClean[]): VideoItem {
  return { ...ITEM, shadowRemoval: { mark: { ...MARK }, ranges: [], pieces: [], pending } }
}

describe('CleanShadowPanel after credits are bought', () => {
  beforeEach(() => {
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE })
    useItemsStore.getState().setItems([ITEM])
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [] })
  })

  it('asks the price again when the window regains focus, and the press comes back', async () => {
    const cloud = createFakeCloud({ availableCredits: 20 })
    connectCloud(cloud)
    show({
      isOpen: true,
      clipId: ITEM.id,
      stage: 'ready',
      pass: { ...PASS, uploadId: UPLOAD_ID },
      quote: { ...QUOTE, availableCredits: 20, enough: false },
      config: { ...CONFIG, freeBeta: false },
    })
    render(<CleanShadowPanel item={ITEM} />)
    expect(screen.getByTestId('shadow-clean-button')).toBeDisabled()

    // Credits bought in the browser; the pilot comes back to the editor.
    cloud.setAvailableCredits(1200)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(screen.getByTestId('shadow-clean-button')).toBeEnabled())
    expect(screen.queryByTestId('shadow-get-credits')).toBeNull()
    const asked = cloud.server.to('/v1/jobs/quote')
    expect(asked).toHaveLength(1)
    expect((asked[0]?.body as { uploadId: string }).uploadId).toBe(UPLOAD_ID)
  })

  it('asks nothing on focus while the balance covers the price', () => {
    const cloud = createFakeCloud()
    connectCloud(cloud)
    show({
      isOpen: true,
      clipId: ITEM.id,
      stage: 'ready',
      pass: PASS,
      quote: QUOTE,
      config: CONFIG,
    })
    render(<CleanShadowPanel item={ITEM} />)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(cloud.server.calls).toHaveLength(0)
  })
})

describe('CleanShadowPanel with paid cleans on their way', () => {
  beforeEach(() => {
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE })
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [] })
  })

  it('says a clean of the same frames is on its way and offers no second press for them', () => {
    const item = withPending({ ...PENDING, jobId: FULL_JOB_ID })
    useItemsStore.getState().setItems([item])
    connectCloud(createFakeCloud())
    show({
      isOpen: true,
      clipId: ITEM.id,
      stage: 'ready',
      pass: PASS,
      quote: QUOTE,
      config: CONFIG,
    })

    render(<CleanShadowPanel item={item} />)

    expect(screen.getByTestId('shadow-pending').textContent).toContain(
      'A paid clean of frames 3330–3929 has not been brought in yet.',
    )
    expect(screen.getByTestId('shadow-clean-button')).toBeDisabled()
  })

  it('says why a clean waits: the service out of reach, or a price it must cancel', () => {
    const item = withPending(
      { ...PENDING, state: 'unreachable' },
      { ...PENDING, attemptId: 'a-2', jobId: FULL_JOB_ID, state: 'repriced', reservedCredits: 50 },
    )
    useItemsStore.getState().setItems([item])
    show({ isOpen: true, clipId: ITEM.id, stage: 'idle', pass: null, quote: null, config: null })

    render(<CleanShadowPanel item={item} />)

    const lines = screen.getAllByTestId('shadow-pending').map((line) => line.textContent)
    expect(lines[0]).toContain(
      'DroneClean could not be reached. The paid clean of frames 3330–3929 is kept and will be picked up again.',
    )
    expect(lines[1]).toContain(
      'The service reserved a different price (50 credits, not the 45 shown), so the job was not started.',
    )
    expect(screen.getAllByTestId('shadow-pending-retry')).toHaveLength(2)
  })

  it('brings a waiting clean in with Try again, and the panel lets it go', async () => {
    const cloud = createFakeCloud()
    const savePiece = connectCloud(cloud)
    // The job the press made before the editor closed.
    await cloud.server.fetch('https://droneclean.test/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({ uploadId: UPLOAD_ID, kind: 'full', attemptId: PENDING.attemptId }),
    })
    const item = withPending({ ...PENDING, state: 'unreachable' })
    useItemsStore.getState().setItems([item])
    show({ isOpen: true, clipId: ITEM.id, stage: 'idle', pass: null, quote: null, config: null })
    const view = render(<CleanShadowPanel item={item} />)

    act(() => {
      screen.getByTestId('shadow-pending-retry').click()
    })

    const liveItem = () => useItemsStore.getState().itemById[ITEM.id] as VideoItem
    await waitFor(() => expect(liveItem().shadowRemoval?.pieces).toHaveLength(1))
    expect(liveItem().shadowRemoval?.pending).toBeUndefined()
    expect(savePiece).toHaveBeenCalledTimes(1)
    const live = liveItem()
    view.rerender(<CleanShadowPanel item={live} />)
    expect(screen.queryByTestId('shadow-pending')).toBeNull()
  })
})

/** The job a press made before the editor closed, as the fake cloud keeps it. */
function madeBefore(cloud: FakeCloud): Promise<Response> {
  return cloud.server.fetch('https://droneclean.test/v1/jobs', {
    method: 'POST',
    body: JSON.stringify({ uploadId: UPLOAD_ID, kind: 'full', attemptId: PENDING.attemptId }),
  })
}

function liveItem(): VideoItem {
  return useItemsStore.getState().itemById[ITEM.id] as VideoItem
}

describe('CleanShadowPanel: canceling, forgetting, saving', () => {
  beforeEach(() => {
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE })
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [] })
  })

  it('offers Cancel on a clean that is still running, and stops its job', async () => {
    const cloud = createFakeCloud()
    const gate: { release: (() => void) | null } = { release: null }
    const savePiece = connectCloud(cloud, {
      sleep: () =>
        new Promise<void>((resolve) => {
          gate.release = resolve
        }),
    })
    await madeBefore(cloud)
    useItemsStore.getState().setItems([withPending({ ...PENDING, jobId: FULL_JOB_ID })])
    show({ isOpen: true, clipId: ITEM.id, stage: 'idle', pass: null, quote: null, config: null })
    const view = render(<CleanShadowPanel item={liveItem()} />)

    let resumed: Promise<void> = Promise.resolve()
    act(() => {
      resumed = resumePendingCleans()
    })
    await waitFor(() => expect(screen.getByTestId('shadow-pending-cancel')).toBeInTheDocument())
    expect(screen.queryByTestId('shadow-pending-retry')).toBeNull()
    expect(screen.getByTestId('shadow-pending').textContent).toContain('is on its way')

    act(() => {
      screen.getByTestId('shadow-pending-cancel').click()
    })
    await act(async () => {
      gate.release?.()
      await resumed
    })

    expect(cloud.server.to(`/v1/jobs/${FULL_JOB_ID}/cancel`)).toHaveLength(1)
    expect(cloud.reserved()).toBe(0)
    expect(savePiece).not.toHaveBeenCalled()
    expect(liveItem().shadowRemoval?.pending).toBeUndefined()
    view.rerender(<CleanShadowPanel item={liveItem()} />)
    expect(screen.queryByTestId('shadow-pending')).toBeNull()
  })

  it('offers no Cancel once the job succeeded: it was paid for and is being brought in', async () => {
    const cloud = createFakeCloud()
    const save: { finish: (() => void) | null } = { finish: null }
    connectCloud(cloud, {
      savePiece: () =>
        new Promise<string>((resolve) => {
          save.finish = () => resolve('blob:cleaned-piece')
        }),
    })
    await madeBefore(cloud)
    useItemsStore.getState().setItems([withPending({ ...PENDING, jobId: FULL_JOB_ID })])
    show({ isOpen: true, clipId: ITEM.id, stage: 'idle', pass: null, quote: null, config: null })
    render(<CleanShadowPanel item={liveItem()} />)

    let resumed: Promise<void> = Promise.resolve()
    act(() => {
      resumed = resumePendingCleans()
    })
    await waitFor(() => expect(save.finish).not.toBeNull())
    await waitFor(() =>
      expect(screen.getByTestId('shadow-pending').textContent).toContain('on its way'),
    )
    expect(screen.queryByTestId('shadow-pending-cancel')).toBeNull()

    await act(async () => {
      save.finish?.()
      await resumed
    })
    expect(liveItem().shadowRemoval?.pieces).toHaveLength(1)
  })

  it('forgets a clean the service does not know only after a confirmation that names the website', async () => {
    const item = withPending({ ...PENDING, jobId: FULL_JOB_ID, state: 'missing' })
    useItemsStore.getState().setItems([item])
    connectCloud(createFakeCloud())
    show({
      isOpen: true,
      clipId: ITEM.id,
      stage: 'ready',
      pass: PASS,
      quote: QUOTE,
      config: CONFIG,
    })
    const view = render(<CleanShadowPanel item={item} />)

    expect(screen.getByTestId('shadow-pending').textContent).toContain(
      'DroneClean does not know the job of the paid clean of frames 3330–3929',
    )
    expect(screen.getByTestId('shadow-clean-button')).toBeDisabled()

    // A second thought keeps it.
    act(() => {
      screen.getByTestId('shadow-pending-forget').click()
    })
    expect(screen.getByRole('alertdialog').textContent).toContain('droneclean.app/profile')
    expect(screen.getByRole('alertdialog').textContent).toContain('may be lost')
    act(() => {
      screen.getByRole('button', { name: 'Cancel' }).click()
    })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(liveItem().shadowRemoval?.pending).toHaveLength(1)

    act(() => {
      screen.getByTestId('shadow-pending-forget').click()
    })
    act(() => {
      screen.getByTestId('shadow-pending-forget-confirm').click()
    })

    expect(liveItem().shadowRemoval?.pending).toBeUndefined()
    view.rerender(<CleanShadowPanel item={liveItem()} />)
    expect(screen.queryByTestId('shadow-pending')).toBeNull()
    expect(screen.getByTestId('shadow-clean-button')).toBeEnabled()
  })

  it('offers Forget only for a clean the service does not know', () => {
    const item = withPending({ ...PENDING, state: 'unreachable' })
    useItemsStore.getState().setItems([item])
    show({ isOpen: true, clipId: ITEM.id, stage: 'idle', pass: null, quote: null, config: null })

    render(<CleanShadowPanel item={item} />)

    expect(screen.getByTestId('shadow-pending-retry')).toBeInTheDocument()
    expect(screen.queryByTestId('shadow-pending-forget')).toBeNull()
  })

  it('says the project could not be saved after the press', () => {
    useItemsStore.getState().setItems([ITEM])
    show({
      isOpen: true,
      clipId: ITEM.id,
      stage: 'ready',
      pass: PASS,
      quote: QUOTE,
      config: CONFIG,
      projectNotSaved: true,
    })

    render(<CleanShadowPanel item={ITEM} />)

    expect(screen.getByTestId('shadow-project-not-saved').textContent).toBe(
      'The project could not be saved after the press. Save it now, so this paid clean is not lost if the editor closes.',
    )
  })
})
