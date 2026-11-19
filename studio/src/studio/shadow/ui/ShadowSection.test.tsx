import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { i18n } from '@/i18n'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { frameToSeconds, toRate } from '@/studio/time'
import type { MediaMetadata } from '@/types/storage'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import {
  ACCOUNT,
  CONFIG,
  DEVICE_CODE,
  DEVICE_TOKEN,
  FULL_JOB,
  FULL_JOB_ID,
  QUOTE,
  TRACK_DATA,
  TRACK_JOB,
  UPLOAD,
  UPLOAD_ID,
  UPLOAD_TICKET,
} from '../api/__fixtures__/recorded'
import { createFakeServer, type FakeRoute } from '../api/__fixtures__/fake-server'
import { createDroneCleanClient } from '../api/client'
import { createMemorySession } from '../api/session'
import type { Job } from '../api/types'
import type { ShadowCutter } from '../cut/interface'
import { ShadowSection } from './ShadowSection'
import {
  SHADOW_SESSION_IDLE,
  configureShadowSession,
  useShadowSessionStore,
} from './use-shadow-session'

vi.mock('@/studio/feature-switches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/studio/feature-switches')>()
  return {
    ...actual,
    isFeatureShown: (id: Parameters<typeof actual.isFeatureShown>[0]) =>
      id === 'shadowRemovalClean' || actual.isFeatureShown(id),
  }
})

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
          title: 'DroneClean shadow',
          intro: "Click the drone's shadow in the picture; the tracker follows it for free.",
          markShadow: 'Mark the shadow',
          markAgain: 'Mark again',
          armed: 'Click the shadow in the picture.',
          cancelMark: 'Cancel',
          markedAt: 'Marked on frame {{frame}}.',
          follow: 'Follow the shadow (free)',
          cutting: 'Cutting the seconds around the mark…',
          uploading: 'Uploading the piece… {{percent}}%',
          tracking: 'Following the shadow…',
          cleaning: 'Cleaning the shadow… {{percent}}%',
          downloading: 'Downloading the cleaned seconds…',
          saving: 'Saving the cleaned seconds…',
          signInCode: 'Code {{code}}',
          signInWaiting: 'Waiting for approval in your browser…',
          signInOpen: 'Open the page again',
          signedIn: 'Signed in as {{email}}.',
          signInAgain: 'Sign in again',
          rangesTitle: 'The shadow was found on:',
          range: 'Frames {{start}}–{{end}} · {{seconds}} s',
          notFound: 'The shadow was not found from that point. Click it again.',
          price: '{{seconds}} s · {{credits}} credits',
          balance: 'You have {{credits}} credits.',
          notEnough: 'You need {{credits}} credits; you have {{available}}.',
          freeBeta: 'The beta sells nothing: credits are free to ask for, and a clean uses them.',
          clean: 'Clean',
          cleaned: 'Frames {{start}}–{{end}} are cleaned.',
          getCredits: 'Get credits',
          removeCleaning: 'Remove the cleaning',
          noSource: "This clip's file is not open, so its shadow cannot be sent. Relink it first.",
          clickHint: 'Click the shadow here',
        },
      },
    },
    true,
    true,
  )
})

const RATE = toRate(59.94)

const MEDIA: MediaMetadata = {
  id: 'media-1',
  storageType: 'workspace',
  fileName: 'DJI_20261115124704_0020_D.MP4',
  fileSize: 3_764_360_098,
  mimeType: 'video/mp4',
  duration: 230.88065,
  width: 3840,
  height: 2880,
  fps: 59.94,
  codec: 'hevc',
  bitrate: 129_885_000,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
}

const MARK = { x: 1860.25, y: 2410.5, sourceFrame: 3630, radius: 96.5 }

function clip(extra: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'video',
    label: 'DJI_0020',
    mediaId: MEDIA.id,
    src: 'blob:clip-1',
    from: 0,
    durationInFrames: 13_839,
    sourceFps: 59.94,
    sourceWidth: 3840,
    sourceHeight: 2880,
    shadowRemoval: { mark: { ...MARK }, ranges: [], pieces: [] },
    ...extra,
  }
}

const TEXT: TextItem = {
  id: 'text-1',
  trackId: 'track-1',
  type: 'text',
  label: 'Title',
  text: 'Hello',
  color: '#ffffff',
  from: 0,
  durationInFrames: 60,
}

const WINDOW = {
  startFrame: 3330,
  endFrame: 3930,
  startSeconds: frameToSeconds(RATE, 3330),
  endSeconds: frameToSeconds(RATE, 3930),
}

const PASS = {
  jobId: TRACK_JOB.id,
  uploadId: UPLOAD_ID,
  mark: { ...MARK },
  window: WINDOW,
  points: [{ frame: 3360, x: 1860.25, y: 2410.5, radius: 96.5 }],
  ranges: [
    { startFrame: 3360, endFrame: 3390 },
    { startFrame: 3420, endFrame: 3430 },
  ],
}

const RESULT_URL = `https://storage.test/results/${FULL_JOB_ID}/cleaned.mp4?X-Amz-Signature=1f2e3d`

/** The full job the quote priced: its reservation is the 45 credits the section showed. */
function fullJob(extra: Partial<Job> = {}): Job {
  return { ...FULL_JOB, cost: { reservedCredits: QUOTE.costCredits, chargedCredits: 0 }, ...extra }
}

/** The finished full job: the pass's window, cleaned, with its file to download. */
function finishedJob(): Job {
  return fullJob({
    status: 'succeeded',
    stage: 'done',
    progress: 1,
    cost: { reservedCredits: QUOTE.costCredits, chargedCredits: QUOTE.costCredits },
    result: {
      url: RESULT_URL,
      expiresAt: '2026-11-18T10:50:00.000Z',
      availableUntil: '2026-12-18T09:50:00.000Z',
    },
  })
}

/** The cutter the section test runs: no mediabunny, the planned window and a few bytes. */
const CUTTER: ShadowCutter = {
  plan: async () => ({ ...WINDOW }),
  cut: async () => new Blob(['piece-bytes'], { type: 'video/mp4' }),
}

/** The recorded cloud: the free pass's routes, then the full job's, its reads and its file. */
function routes(): FakeRoute[] {
  let readIndex = 0
  const reads = [fullJob({ status: 'running' as const, progress: 0.7 }), finishedJob()]
  return [
    { method: 'POST', path: '/v1/uploads', respond: () => ({ body: UPLOAD_TICKET }) },
    {
      method: 'PUT',
      path: `/uploads/${UPLOAD_ID}/piece.mp4`,
      respond: () => ({ body: {} }),
    },
    {
      method: 'POST',
      path: `/v1/uploads/${UPLOAD_ID}/complete`,
      respond: () => ({ body: UPLOAD }),
    },
    {
      method: 'POST',
      path: '/v1/jobs',
      respond: (call) => ({
        body: (call.body as { kind?: string }).kind === 'full' ? fullJob() : TRACK_JOB,
      }),
    },
    {
      method: 'GET',
      path: `/v1/jobs/${TRACK_JOB.id}/track`,
      respond: () => ({ body: TRACK_DATA }),
    },
    {
      method: 'GET',
      path: `/v1/jobs/${FULL_JOB_ID}`,
      respond: () => ({ body: reads[Math.min(readIndex++, reads.length - 1)] }),
    },
    {
      method: 'POST',
      path: `/v1/jobs/${FULL_JOB_ID}/cancel`,
      respond: () => ({ body: fullJob({ status: 'canceled' }) }),
    },
    {
      method: 'GET',
      path: `/results/${FULL_JOB_ID}/cleaned.mp4`,
      respond: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
              controller.close()
            },
          }),
          { headers: { 'content-type': 'video/mp4', 'content-length': '8' } },
        ),
    },
    { method: 'POST', path: '/v1/jobs/quote', respond: () => ({ body: QUOTE }) },
    { method: 'GET', path: '/v1/config', respond: () => ({ body: CONFIG }) },
  ]
}

interface Connection {
  server: ReturnType<typeof createFakeServer>
  session: ReturnType<typeof createMemorySession>
  openUrl: ReturnType<typeof vi.fn>
  savePiece: ReturnType<typeof vi.fn>
  gate: { hold: boolean; release: (() => void) | null }
}

function connect(server: ReturnType<typeof createFakeServer>, token: string | null): Connection {
  const gate: { hold: boolean; release: (() => void) | null } = { hold: false, release: null }
  const session = createMemorySession(token)
  const client = createDroneCleanClient({
    baseUrl: 'https://droneclean.test',
    fetch: server.fetch,
    session,
    openUrl: () => undefined,
  })
  const openUrl = vi.fn()
  const savePiece = vi.fn(async (_segments: string[], _blob: Blob) => 'blob:cleaned-piece')
  configureShadowSession({
    client,
    session,
    cutter: CUTTER,
    getSourceBlob: async () => new Blob(['the source']),
    savePiece,
    openUrl,
    sleep: () =>
      gate.hold
        ? new Promise<void>((resolve) => {
            gate.release = resolve
          })
        : Promise.resolve(),
    newAttemptId: () => '0b6f9c3e-7a52-4f0e-9d1c-2b8f4a6e5d30',
  })
  return { server, session, openUrl, savePiece, gate }
}

function renderSection(items: TimelineItem[]) {
  return render(<ShadowSection items={items} />)
}

/** A click outside React's act, then a turn of the microtask queue: the flow starts. */
function fireEventClick(element: HTMLElement): void {
  act(() => {
    element.click()
  })
}

/** Waits for the flow to reach a state the test can act on. */
async function waitForStage(stage: string): Promise<void> {
  await waitFor(() => expect(useShadowSessionStore.getState().stage).toBe(stage))
}

describe('ShadowSection', () => {
  beforeEach(() => {
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE })
    useItemsStore.getState().setItems([])
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [MEDIA], brokenMediaIds: [] })
  })

  it('is not rendered for a text clip or a reversed clip', () => {
    useItemsStore.getState().setItems([TEXT, clip({ id: 'clip-2', isReversed: true })])

    const text = renderSection([TEXT])
    expect(text.container.querySelector('[data-testid="shadow-section"]')).toBeNull()
    text.unmount()

    const reversed = renderSection([{ ...clip({ id: 'clip-2', isReversed: true }) }])
    expect(reversed.container.querySelector('[data-testid="shadow-section"]')).toBeNull()
  })

  it('says plainly when the clip’s file cannot be read', () => {
    const item = clip({ id: 'clip-2', mediaId: 'gone' })
    useItemsStore.getState().setItems([item])

    renderSection([item])

    expect(screen.getByTestId('shadow-no-source')).toBeInTheDocument()
    expect(screen.queryByTestId('shadow-follow-button')).toBeNull()
  })

  it('shows the code and the waiting state, then the signed-in account', async () => {
    const item = clip()
    useItemsStore.getState().setItems([item])
    let approve: (() => void) | null = null
    const approved = new Promise<void>((resolve) => {
      approve = resolve
    })
    const server = createFakeServer([
      { method: 'POST', path: '/api/auth/device/code', respond: () => ({ body: DEVICE_CODE }) },
      {
        method: 'POST',
        path: '/api/auth/device/token',
        respond: () => approved.then(() => ({ body: DEVICE_TOKEN })),
      },
      { method: 'GET', path: '/v1/me', respond: () => ({ body: ACCOUNT }) },
      ...routes(),
    ])
    connect(server, null)
    renderSection([item])

    fireEventClick(screen.getByTestId('shadow-follow-button'))

    await waitFor(() => expect(screen.getByTestId('shadow-sign-in')).toBeInTheDocument())
    expect(screen.getByTestId('shadow-sign-in').textContent).toContain('Code ABCD2345')
    expect(screen.getByTestId('shadow-sign-in').textContent).toContain(
      'Waiting for approval in your browser…',
    )

    await act(async () => {
      approve?.()
    })

    await waitFor(() =>
      expect(screen.getByTestId('shadow-signed-in').textContent).toBe(
        'Signed in as pilot@example.com.',
      ),
    )
    expect(screen.queryByTestId('shadow-sign-in')).toBeNull()
  })

  it('shows the found stretches and their price, and creates no job before the press', async () => {
    const item = clip()
    useItemsStore.getState().setItems([item])
    const server = createFakeServer(routes())
    connect(server, DEVICE_TOKEN.access_token)
    renderSection([item])

    fireEventClick(screen.getByTestId('shadow-follow-button'))

    await waitFor(() => expect(screen.getByTestId('shadow-price')).toBeInTheDocument())

    const ranges = screen.getAllByTestId('shadow-range').map((row) => row.textContent)
    expect(ranges).toEqual(['Frames 3360–3390 · 0.5 s', 'Frames 3420–3430 · 0.17 s'])
    expect(screen.getByTestId('shadow-price').textContent).toContain('3 s · 45 credits')
    expect(screen.getByTestId('shadow-price').textContent).toContain('You have 1200 credits.')
    expect(screen.getByTestId('shadow-free-beta').textContent).toBe(
      'The beta sells nothing: credits are free to ask for, and a clean uses them.',
    )
    // The free pass made one track job and priced the ranges; the press is the paid one.
    const kinds = server.to('/v1/jobs').map((call) => (call.body as { kind: string }).kind)
    expect(kinds).toEqual(['track'])
    expect(server.to('/v1/jobs/quote')).toHaveLength(1)
    expect(screen.getByTestId('shadow-clean-button')).toBeEnabled()
    expect(screen.queryByTestId('shadow-cleaned')).toBeNull()
  })

  it('pays for the seconds with one press: a full job, its progress, and the cleaned window', async () => {
    const item = clip()
    useItemsStore.getState().setItems([item])
    const server = createFakeServer(routes())
    const connection = connect(server, DEVICE_TOKEN.access_token)
    renderSection([item])

    fireEventClick(screen.getByTestId('shadow-follow-button'))
    await waitFor(() => expect(screen.getByTestId('shadow-price')).toBeInTheDocument())

    connection.gate.hold = true
    fireEventClick(screen.getByTestId('shadow-clean-button'))
    await waitForStage('cleaning')

    // The job's own progress is what the stage line says while the cloud works.
    act(() => connection.gate.release?.())
    await waitFor(() =>
      expect(screen.getByTestId('shadow-stage').textContent).toBe('Cleaning the shadow… 70%'),
    )

    act(() => connection.gate.release?.())
    await waitForStage('ready')
    await waitFor(() =>
      expect(screen.getByTestId('shadow-cleaned').textContent).toBe(
        'Frames 3330–3929 are cleaned.',
      ),
    )

    const created = server.to('/v1/jobs')[1]?.body as Record<string, unknown>
    expect(created).toEqual({
      uploadId: UPLOAD_ID,
      kind: 'full',
      segments: [
        {
          startSeconds: frameToSeconds(RATE, 30),
          endSeconds: frameToSeconds(RATE, 60),
          anchor: { x: 1860.25, y: 2410.5, timeSeconds: frameToSeconds(RATE, 30), radius: 96.5 },
          trackJobIds: [TRACK_JOB.id],
        },
        {
          startSeconds: frameToSeconds(RATE, 90),
          endSeconds: frameToSeconds(RATE, 100),
          anchor: { x: 1882.75, y: 2425.5, timeSeconds: frameToSeconds(RATE, 90), radius: 99.5 },
          trackJobIds: [TRACK_JOB.id],
        },
      ],
      options: { quality: 'standard', outputStep: 1 },
      attemptId: '0b6f9c3e-7a52-4f0e-9d1c-2b8f4a6e5d30',
    })
    expect(connection.savePiece).toHaveBeenCalledTimes(1)
    expect(connection.savePiece.mock.calls[0]?.[0]).toEqual([
      'media',
      'media-1',
      'shadow',
      '3330_600_0b6f9c3e-7a52-4f0e-9d1c-2b8f4a6e5d30.mp4',
    ])
    // The cleaned record is on the clip, so the preview knows which frames come from the file.
    expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval?.pieces).toHaveLength(1)
  })

  it('blocks the press with a short balance and opens the shop instead', async () => {
    const item = clip()
    useItemsStore.getState().setItems([item])
    const connection = connect(createFakeServer([]), DEVICE_TOKEN.access_token)
    useShadowSessionStore.setState({
      isOpen: true,
      clipId: item.id,
      stage: 'ready',
      pass: PASS,
      quote: { ...QUOTE, availableCredits: 20, enough: false },
      config: { ...CONFIG, freeBeta: false },
    })

    renderSection([item])

    expect(screen.getByTestId('shadow-short').textContent).toBe('You need 45 credits; you have 20.')
    expect(screen.queryByTestId('shadow-balance')).toBeNull()
    expect(screen.getByTestId('shadow-clean-button')).toBeDisabled()

    fireEventClick(screen.getByTestId('shadow-get-credits'))
    await waitFor(() =>
      expect(connection.openUrl).toHaveBeenCalledWith('https://droneclean.app/profile?buy=1'),
    )
  })

  it('sends a short balance during the free beta to the page that asks for credits', async () => {
    const item = clip()
    useItemsStore.getState().setItems([item])
    const connection = connect(createFakeServer([]), DEVICE_TOKEN.access_token)
    useShadowSessionStore.setState({
      isOpen: true,
      clipId: item.id,
      stage: 'ready',
      pass: PASS,
      quote: { ...QUOTE, availableCredits: 20, enough: false },
      config: { ...CONFIG, freeBeta: true },
    })

    renderSection([item])
    fireEventClick(screen.getByTestId('shadow-get-credits'))

    await waitFor(() =>
      expect(connection.openUrl).toHaveBeenCalledWith('https://droneclean.app/profile'),
    )
  })

  it('stops a running clean with Cancel, and records nothing', async () => {
    const item = clip()
    useItemsStore.getState().setItems([item])
    const server = createFakeServer(routes())
    const connection = connect(server, DEVICE_TOKEN.access_token)
    renderSection([item])

    fireEventClick(screen.getByTestId('shadow-follow-button'))
    await waitFor(() => expect(screen.getByTestId('shadow-price')).toBeInTheDocument())

    connection.gate.hold = true
    fireEventClick(screen.getByTestId('shadow-clean-button'))
    await waitForStage('cleaning')

    await waitFor(() => expect(screen.getByTestId('shadow-cancel')).toBeInTheDocument())
    fireEventClick(screen.getByTestId('shadow-cancel'))
    await waitForStage('idle')
    act(() => connection.gate.release?.())
    await waitFor(() => expect(server.to(`/v1/jobs/${FULL_JOB_ID}/cancel`)).toHaveLength(1))

    expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval?.pieces).toEqual([])
    // The pass and its price are still there: the pilot can try the press again.
    expect(screen.getByTestId('shadow-price')).toBeInTheDocument()
    expect(screen.queryByTestId('shadow-cleaned')).toBeNull()
  })

  it('offers a new sign-in when the API ended the session', async () => {
    const item = clip()
    useItemsStore.getState().setItems([item])
    const server = createFakeServer([
      { method: 'POST', path: '/api/auth/device/code', respond: () => ({ body: DEVICE_CODE }) },
      { method: 'POST', path: '/api/auth/device/token', respond: () => ({ body: DEVICE_TOKEN }) },
      { method: 'GET', path: '/v1/me', respond: () => ({ body: ACCOUNT }) },
      ...routes().map((route) =>
        route.path === '/v1/jobs/quote'
          ? {
              ...route,
              respond: () => ({
                status: 401,
                body: { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
              }),
            }
          : route,
      ),
    ])
    connect(server, 'an-expired-token')
    renderSection([item])

    fireEventClick(screen.getByTestId('shadow-follow-button'))

    await waitFor(() => expect(screen.getByTestId('shadow-sign-in-again')).toBeInTheDocument())
    expect(screen.getByTestId('shadow-error').textContent).toBe('Sign in to continue.')

    fireEventClick(screen.getByTestId('shadow-sign-in-again'))

    await waitFor(() =>
      expect(screen.getByTestId('shadow-signed-in').textContent).toBe(
        'Signed in as pilot@example.com.',
      ),
    )
    expect(server.to('/api/auth/device/code')).toHaveLength(1)
  })

  it('says the window is cleaned once a piece covers it, and draws no second press', () => {
    const item = clip({
      shadowRemoval: {
        mark: { ...MARK },
        ranges: [
          {
            startFrame: 3360,
            endFrame: 3390,
            credits: 8,
            jobId: FULL_JOB_ID,
            passJobId: TRACK_JOB.id,
          },
        ],
        pieces: [
          {
            jobId: FULL_JOB_ID,
            path: 'media/media-1/shadow/3330_600.mp4',
            src: 'blob:cleaned-piece',
            startFrame: 3330,
            frames: 600,
          },
        ],
      },
    })
    useItemsStore.getState().setItems([item])
    connect(createFakeServer([]), DEVICE_TOKEN.access_token)
    useShadowSessionStore.setState({
      isOpen: true,
      clipId: item.id,
      stage: 'ready',
      pass: PASS,
      quote: QUOTE,
      config: CONFIG,
    })

    renderSection([item])

    expect(screen.getByTestId('shadow-cleaned').textContent).toBe('Frames 3330–3929 are cleaned.')
    expect(screen.queryByTestId('shadow-clean-button')).toBeNull()
    expect(screen.getByTestId('shadow-remove-cleaning').textContent).toBe('Remove the cleaning')
  })

  it('removes the cleaning in one undo step, leaving the mark and the ranges', async () => {
    const item = clip({
      shadowRemoval: {
        mark: { ...MARK },
        ranges: [
          {
            startFrame: 3360,
            endFrame: 3390,
            credits: 8,
            jobId: FULL_JOB_ID,
            passJobId: TRACK_JOB.id,
          },
        ],
        pieces: [
          {
            jobId: FULL_JOB_ID,
            path: 'media/media-1/shadow/3330_600.mp4',
            src: 'blob:cleaned-piece',
            startFrame: 3330,
            frames: 600,
          },
        ],
      },
    })
    useItemsStore.getState().setItems([item])
    connect(createFakeServer([]), DEVICE_TOKEN.access_token)
    useShadowSessionStore.setState({
      isOpen: true,
      clipId: item.id,
      stage: 'ready',
      pass: PASS,
      quote: QUOTE,
      config: CONFIG,
    })

    renderSection([item])
    fireEventClick(screen.getByTestId('shadow-remove-cleaning'))

    await waitFor(() =>
      expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval?.pieces).toEqual([]),
    )
    const record = useItemsStore.getState().itemById['clip-1']?.shadowRemoval
    expect(record?.mark).toEqual(MARK)
    expect(record?.ranges).toHaveLength(1)
    // The clip is no longer cleaned: the press to clean it again is back, the removal is gone.
    await waitFor(() => expect(screen.queryByTestId('shadow-remove-cleaning')).toBeNull())
    expect(screen.getByTestId('shadow-clean-button')).toBeInTheDocument()

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval?.pieces).toHaveLength(1)
  })

  it('offers no removal while the clip has no cleaned piece', () => {
    const item = clip()
    useItemsStore.getState().setItems([item])
    connect(createFakeServer([]), DEVICE_TOKEN.access_token)
    useShadowSessionStore.setState({
      isOpen: true,
      clipId: item.id,
      stage: 'ready',
      pass: PASS,
      quote: QUOTE,
      config: CONFIG,
    })

    renderSection([item])

    expect(screen.queryByTestId('shadow-remove-cleaning')).toBeNull()
  })
})
