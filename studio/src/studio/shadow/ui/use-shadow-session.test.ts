import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { frameToSeconds, toRate } from '@/studio/time'
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
  TRACK_JOB_ID,
  UPLOAD,
  UPLOAD_ID,
  UPLOAD_TICKET,
} from '../api/__fixtures__/recorded'
import { createFakeServer, type FakeRoute } from '../api/__fixtures__/fake-server'
import { createFakeCloud, type FakeCloudOptions } from '../api/__fixtures__/fake-cloud'
import { createDroneCleanClient } from '../api/client'
import { createMemorySession } from '../api/session'
import type { Job } from '../api/types'
import type { ShadowCutter, ShadowCutRange, SourceRate } from '../cut/interface'
import type { ShadowPendingClean, ShadowRemoval } from '../model'
import {
  SHADOW_SESSION_IDLE,
  cancelPendingClean,
  cleanKey,
  configureShadowSession,
  resumePendingCleans,
  useRunningCleans,
  useShadowSessionStore,
} from './use-shadow-session'

const RATE = toRate(59.94)
const ATTEMPT_ID = '0b6f9c3e-7a52-4f0e-9d1c-2b8f4a6e5d30'

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

/** The window the cutter plans for the clip's part of the source (frames 3330-3929 of clip 0020). */
const WINDOW = {
  startFrame: 3330,
  endFrame: 3930,
  startSeconds: frameToSeconds(RATE, 3330),
  endSeconds: frameToSeconds(RATE, 3930),
}

const RESULT_URL = `https://storage.test/results/${FULL_JOB_ID}/cleaned.mp4?X-Amz-Signature=1f2e3d`

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

/** Every route the free flow uses, answering the recorded cloud. */
function trackingRoutes() {
  return [
    { method: 'POST' as const, path: '/v1/uploads', respond: () => ({ body: UPLOAD_TICKET }) },
    {
      method: 'PUT' as const,
      path: `/uploads/${UPLOAD_ID}/piece.mp4`,
      respond: () => ({ body: {} }),
    },
    {
      method: 'POST' as const,
      path: `/v1/uploads/${UPLOAD_ID}/complete`,
      respond: () => ({ body: UPLOAD }),
    },
    {
      method: 'POST' as const,
      path: '/v1/jobs',
      respond: () => ({ body: TRACK_JOB }),
    },
    {
      method: 'GET' as const,
      path: `/v1/jobs/${TRACK_JOB.id}/track`,
      respond: () => ({ body: TRACK_DATA }),
    },
    {
      method: 'POST' as const,
      path: `/v1/jobs/${TRACK_JOB.id}/cancel`,
      respond: () => ({ body: { ...TRACK_JOB, status: 'canceled' } }),
    },
    { method: 'POST' as const, path: '/v1/jobs/quote', respond: () => ({ body: QUOTE }) },
    { method: 'GET' as const, path: '/v1/config', respond: () => ({ body: CONFIG }) },
  ]
}

/** The paid flow's routes on top: a full job that runs, then succeeds, and its file. */
function cleanRoutes(
  reads: Job[] = [fullJob({ status: 'running', progress: 0.7 }), finishedJob()],
) {
  let readIndex = 0
  return [
    {
      method: 'POST' as const,
      path: '/v1/jobs',
      respond: (call: { body: unknown }) => ({
        body: (call.body as { kind?: string }).kind === 'full' ? fullJob() : TRACK_JOB,
      }),
    },
    {
      method: 'GET' as const,
      path: `/v1/jobs/${FULL_JOB_ID}`,
      respond: () => ({ body: reads[Math.min(readIndex++, reads.length - 1)] }),
    },
    {
      method: 'POST' as const,
      path: `/v1/jobs/${FULL_JOB_ID}/cancel`,
      respond: () => ({ body: fullJob({ status: 'canceled' }) }),
    },
    {
      method: 'GET' as const,
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
  ]
}

/** The whole recorded API of the free pass, with the paid flow's routes replacing the job route. */
function allRoutes(reads?: Job[]) {
  const paid = cleanRoutes(reads)
  const free = trackingRoutes().filter((route) => route.path !== '/v1/jobs')
  return [...free, ...paid]
}

function setup(
  options: {
    token?: string | null
    routes?: readonly FakeRoute[]
    sleep?: () => Promise<void>
  } = {},
) {
  const server = createFakeServer(options.routes ?? allRoutes())
  const session = createMemorySession(
    options.token === undefined ? DEVICE_TOKEN.access_token : options.token,
  )
  const client = createDroneCleanClient({
    baseUrl: 'https://droneclean.test',
    fetch: server.fetch,
    session,
    openUrl: () => undefined,
  })
  const plan = vi.fn(async (_file: Blob, _range: ShadowCutRange, _rate: SourceRate) => ({
    ...WINDOW,
  }))
  const cut = vi.fn(async () => new Blob(['piece-bytes'], { type: 'video/mp4' }))
  const cutter: ShadowCutter = { plan, cut }
  const getSourceBlob = vi.fn(async () => new Blob(['the source']))
  const savePiece = vi.fn(async (_segments: string[], _blob: Blob) => 'blob:cleaned-piece')
  const openUrl = vi.fn()
  configureShadowSession({
    client,
    session,
    cutter,
    getSourceBlob,
    savePiece,
    openUrl,
    sleep: options.sleep ?? (async () => undefined),
    newAttemptId: () => ATTEMPT_ID,
  })
  return { server, session, client, plan, cut, getSourceBlob, savePiece, openUrl }
}

describe('the shadow session', () => {
  beforeEach(() => {
    // What the open clip panel does before its buttons are pressed: the section for `clip-1` is open.
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE, clipId: 'clip-1', isOpen: true })
    useItemsStore.getState().setItems([])
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [MEDIA] })
  })

  it('writes the mark through the item store, in one undo step', () => {
    useItemsStore.getState().setItems([clip({ shadowRemoval: undefined })])
    const item = useItemsStore.getState().itemById['clip-1'] as VideoItem

    useShadowSessionStore.getState().setMark(item, { x: 120.5, y: 40, sourceFrame: 42, radius: 7 })

    expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval).toEqual({
      mark: { x: 120.5, y: 40, sourceFrame: 42, radius: 7 },
      ranges: [],
      pieces: [],
    })
    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval).toBeUndefined()
  })

  it('keeps a mark set before: the record’s ranges and pieces stay', () => {
    useItemsStore.getState().setItems([
      clip({
        shadowRemoval: {
          mark: { ...MARK },
          ranges: [
            { startFrame: 3600, endFrame: 3660, credits: 15, jobId: 'job-1', passJobId: 'pass-1' },
          ],
          pieces: [
            {
              jobId: 'job-1',
              path: 'media/media-1/shadow/3600_60.mp4',
              startFrame: 3600,
              frames: 60,
            },
          ],
        },
      }),
    ])
    const item = useItemsStore.getState().itemById['clip-1'] as VideoItem

    useShadowSessionStore.getState().setMark(item, { x: 1, y: 2, sourceFrame: 3, radius: 4 })

    const record = useItemsStore.getState().itemById['clip-1']?.shadowRemoval
    expect(record?.mark).toEqual({ x: 1, y: 2, sourceFrame: 3, radius: 4 })
    expect(record?.ranges).toHaveLength(1)
    expect(record?.pieces).toHaveLength(1)
  })

  it('runs the free pass: cuts the part of the source the clip shows, uploads it, tracks, prices', async () => {
    const { server, plan, cut, getSourceBlob } = setup()

    await useShadowSessionStore.getState().track(clip({ sourceStart: 3330, sourceEnd: 3930 }))

    expect(plan).toHaveBeenCalledTimes(1)
    expect(plan.mock.calls[0]?.[1]).toEqual({ startFrame: 3330, endFrame: 3930 })
    expect(plan.mock.calls[0]?.[2]).toEqual({ num: 60000, den: 1001 })
    expect(cut).toHaveBeenCalledTimes(1)
    expect(getSourceBlob).toHaveBeenCalledWith(MEDIA.id)

    const uploaded = server.to('/v1/uploads')[0]?.body as Record<string, unknown>
    expect(uploaded).toEqual({
      fileName: MEDIA.fileName,
      contentType: 'video/mp4',
      sizeBytes: 11,
      durationSeconds: 10.01,
      width: 3840,
      height: 2880,
      frameRate: 59.94005994005994,
      source: {
        fileName: MEDIA.fileName,
        startSeconds: WINDOW.startSeconds,
        durationSeconds: MEDIA.duration,
        sizeBytes: MEDIA.fileSize,
      },
    })

    // A free tracking job: the money kind is never asked for, and only the tap is sent.
    const created = server.to('/v1/jobs')[0]?.body as Record<string, unknown>
    expect(created.kind).toBe('track')
    expect(created.uploadId).toBe(UPLOAD_ID)
    expect(created.attemptId).toBe(ATTEMPT_ID)
    expect(created.segments).toBeUndefined()
    expect(created.click).toEqual({
      x: MARK.x,
      y: MARK.y,
      timeSeconds: frameToSeconds(RATE, 300),
      radius: MARK.radius,
    })

    const state = useShadowSessionStore.getState()
    expect(state.stage).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.pass?.jobId).toBe(TRACK_JOB.id)
    expect(state.pass?.uploadId).toBe(UPLOAD_ID)
    expect(state.pass?.mark).toEqual(MARK)
    expect(state.pass?.window).toEqual(WINDOW)
    expect(state.pass?.points[0]).toEqual({ frame: 3360, x: 1860.25, y: 2410.5, radius: 96.5 })
    expect(state.pass?.ranges).toEqual([
      { startFrame: 3360, endFrame: 3390 },
      { startFrame: 3420, endFrame: 3430 },
    ])
    expect(state.quote).toEqual(QUOTE)
    expect(state.config).toEqual(CONFIG)
    expect(state.account).toBeNull()
  })

  it('sends the whole clip when it is not trimmed', async () => {
    const { plan } = setup()

    await useShadowSessionStore.getState().track(clip())
    expect(plan.mock.calls[0]?.[1]).toEqual({ startFrame: 0, endFrame: 13_839 })
  })

  it('proposes, prices and cleans only inside the clip’s part, not in the GOPs the cut adds around it', async () => {
    setup()

    await useShadowSessionStore.getState().track(clip({ sourceStart: 3370, sourceEnd: 3425 }))
    expect(useShadowSessionStore.getState().pass?.ranges).toEqual([
      { startFrame: 3370, endFrame: 3390 },
      { startFrame: 3420, endFrame: 3425 },
    ])
  })

  it('quotes the proposed ranges in the piece’s seconds, on the uploaded piece itself', async () => {
    const { server } = setup()

    await useShadowSessionStore.getState().track(clip())

    // The server prices the upload by the frame rate it measured: the client's rate is not sent.
    const quote = server.to('/v1/jobs/quote')[0]?.body as Record<string, unknown>
    expect(quote.uploadId).toBe(UPLOAD_ID)
    expect(quote.fps).toBeUndefined()
    expect(quote.options).toEqual({ quality: 'standard', outputStep: 1 })
    expect(quote.segments).toEqual([
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
    ])
  })

  it('reuses a finished pass when the mark has not changed, instead of another free job', async () => {
    const { server, plan } = setup()

    await useShadowSessionStore.getState().track(clip())
    const first = useShadowSessionStore.getState().pass

    await useShadowSessionStore.getState().track(clip())

    // Each pass counts against the cloud's limits: a second press makes no second upload or job.
    expect(plan).toHaveBeenCalledTimes(1)
    expect(server.to('/v1/uploads')).toHaveLength(1)
    expect(server.to('/v1/jobs')).toHaveLength(1)
    expect(useShadowSessionStore.getState().pass).toBe(first)
  })

  it('cleans the pass’s ranges with one full job, keeps its file and records it in one undo step', async () => {
    const { server, savePiece } = setup()
    const item = clip()
    useItemsStore.getState().setItems([item])
    const live = useItemsStore.getState().itemById['clip-1'] as VideoItem

    await useShadowSessionStore.getState().track(live)
    await useShadowSessionStore.getState().clean(live)

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
      attemptId: ATTEMPT_ID,
    })

    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(savePiece.mock.calls[0]?.[0]).toEqual([
      'media',
      'media-1',
      'shadow',
      `3330_600_${ATTEMPT_ID}.mp4`,
    ])
    expect(useShadowSessionStore.getState().stage).toBe('ready')
    expect(useShadowSessionStore.getState().error).toBeNull()

    const record = useItemsStore.getState().itemById['clip-1']?.shadowRemoval
    expect(record?.pieces).toEqual([
      {
        jobId: FULL_JOB_ID,
        path: `media/media-1/shadow/3330_600_${ATTEMPT_ID}.mp4`,
        src: 'blob:cleaned-piece',
        startFrame: 3330,
        frames: 600,
        availableUntil: '2026-12-18T09:50:00.000Z',
      },
    ])
    expect(record?.ranges).toHaveLength(2)

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval?.pieces).toEqual([])
  })

  it('cancels a running clean and records nothing', async () => {
    let hold = false
    const gate: { release: (() => void) | null } = { release: null }
    const sleep = () =>
      hold
        ? new Promise<void>((resolve) => {
            gate.release = resolve
          })
        : Promise.resolve()
    const { server } = setup({ sleep })
    const item = clip()
    useItemsStore.getState().setItems([item])
    const live = useItemsStore.getState().itemById['clip-1'] as VideoItem

    // The free pass runs with the immediate clock; the clean is held at its first poll.
    await useShadowSessionStore.getState().track(live)
    hold = true
    const clean = useShadowSessionStore.getState().clean(live)

    await vi.waitFor(() => expect(useShadowSessionStore.getState().activeJobId).toBe(FULL_JOB_ID))
    expect(useShadowSessionStore.getState().stage).toBe('cleaning')

    await useShadowSessionStore.getState().cancel()
    gate.release?.()
    await clean

    expect(server.to(`/v1/jobs/${FULL_JOB_ID}/cancel`)).toHaveLength(1)
    expect(useShadowSessionStore.getState().stage).toBe('idle')
    expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval?.pieces).toEqual([])
    // The pass and its price survive: the press can be tried again.
    expect(useShadowSessionStore.getState().pass?.jobId).toBe(TRACK_JOB_ID)
    expect(useShadowSessionStore.getState().quote).toEqual(QUOTE)
  })

  it('cancels a running tracking pass', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    const sleep = () =>
      new Promise<void>((resolve) => {
        gate.release = resolve
      })
    const routes = trackingRoutes().map((route) =>
      route.path === '/v1/jobs'
        ? { ...route, respond: () => ({ body: { ...TRACK_JOB, status: 'running' as const } }) }
        : route,
    )
    const { server } = setup({ routes, sleep })

    const tracking = useShadowSessionStore.getState().track(clip())
    await vi.waitFor(() => expect(useShadowSessionStore.getState().activeJobId).toBe(TRACK_JOB_ID))
    expect(useShadowSessionStore.getState().stage).toBe('tracking')

    await useShadowSessionStore.getState().cancel()
    gate.release?.()
    await tracking

    expect(server.to(`/v1/jobs/${TRACK_JOB_ID}/cancel`)).toHaveLength(1)
    expect(useShadowSessionStore.getState().stage).toBe('idle')
    expect(useShadowSessionStore.getState().pass).toBeNull()
  })

  it('shows an upload that failed and keeps the press available', async () => {
    const routes = trackingRoutes().map((route) =>
      route.path === `/uploads/${UPLOAD_ID}/piece.mp4`
        ? { ...route, respond: () => ({ status: 403, body: 'Request has expired' }) }
        : route,
    )
    const { server } = setup({ routes })

    await useShadowSessionStore.getState().track(clip())

    const state = useShadowSessionStore.getState()
    expect(state.stage).toBe('idle')
    expect(state.error).toBe('The upload failed. Please try again.')
    expect(state.pass).toBeNull()
    expect(server.to('/v1/jobs')).toHaveLength(0)

    // The way out is the same press again: nothing was charged and no job was made.
    await useShadowSessionStore.getState().track(clip())
    expect(useShadowSessionStore.getState().error).toBe('The upload failed. Please try again.')
    expect(server.to('/v1/uploads')).toHaveLength(2)
  })

  it('asks for a new sign-in when the API ends the session, then signs in again', async () => {
    const routes = [
      {
        method: 'POST' as const,
        path: '/api/auth/device/code',
        respond: () => ({ body: DEVICE_CODE }),
      },
      {
        method: 'POST' as const,
        path: '/api/auth/device/token',
        respond: () => ({ body: DEVICE_TOKEN }),
      },
      { method: 'GET' as const, path: '/v1/me', respond: () => ({ body: ACCOUNT }) },
      ...allRoutes().map((route) =>
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
    ]
    const { server, session } = setup({ routes, token: 'an-expired-token' })

    await useShadowSessionStore.getState().track(clip())

    expect(useShadowSessionStore.getState().needsSignIn).toBe(true)
    expect(useShadowSessionStore.getState().error).toBe('Sign in to continue.')
    expect(await session.getToken()).toBeNull()

    await useShadowSessionStore.getState().signInAgain()

    expect(await session.getToken()).toBe(DEVICE_TOKEN.access_token)
    expect(useShadowSessionStore.getState().account).toEqual(ACCOUNT)
    expect(useShadowSessionStore.getState().needsSignIn).toBe(false)
    expect(server.to('/api/auth/device/code')).toHaveLength(1)
  })

  it('shows a failure and keeps the clip untouched when there is no mark', async () => {
    const { server } = setup()

    await useShadowSessionStore.getState().track(clip({ shadowRemoval: undefined }))

    const state = useShadowSessionStore.getState()
    expect(state.stage).toBe('idle')
    expect(state.error).toBe('Mark the shadow first.')
    expect(state.pass).toBeNull()
    expect(server.calls).toHaveLength(0)
  })

  it('opens the website’s shop for credits, and its request page during the free beta', async () => {
    const { openUrl } = setup()
    useShadowSessionStore.setState({ config: { ...CONFIG, freeBeta: false } })
    await useShadowSessionStore.getState().getCredits()
    expect(openUrl).toHaveBeenLastCalledWith('https://droneclean.app/profile?buy=1')

    useShadowSessionStore.setState({ config: { ...CONFIG, freeBeta: true } })
    await useShadowSessionStore.getState().getCredits()
    expect(openUrl).toHaveBeenLastCalledWith('https://droneclean.app/profile')
  })
})

/** The attempt ids a session makes, one per job it asks for, as `crypto.randomUUID` would. */
function attemptIds(): () => string {
  let count = 0
  return () => {
    count += 1
    return `0b6f9c3e-7a52-4f0e-9d1c-${String(count).padStart(12, '0')}`
  }
}

/** The session over the stateful fake cloud, which honours `attemptId` the way the API does. */
function setupCloud(
  options: {
    cloud?: FakeCloudOptions
    sleep?: () => Promise<void>
    now?: () => Date
    saveProject?: () => Promise<void>
    savePiece?: (segments: string[], blob: Blob) => Promise<string>
  } = {},
) {
  const cloud = createFakeCloud(options.cloud)
  const session = createMemorySession(DEVICE_TOKEN.access_token)
  const client = createDroneCleanClient({
    baseUrl: 'https://droneclean.test',
    fetch: cloud.server.fetch,
    session,
    openUrl: () => undefined,
  })
  const plan = vi.fn(async () => ({ ...WINDOW }))
  const cut = vi.fn(async () => new Blob(['piece-bytes'], { type: 'video/mp4' }))
  const savePiece = vi.fn(
    options.savePiece ?? (async (_segments: string[], _blob: Blob) => 'blob:cleaned-piece'),
  )
  const saveProject = vi.fn(options.saveProject ?? (async () => undefined))
  configureShadowSession({
    client,
    session,
    saveProject,
    cutter: { plan, cut },
    getSourceBlob: async () => new Blob(['the source']),
    savePiece,
    openUrl: vi.fn(),
    sleep: options.sleep ?? (async () => undefined),
    newAttemptId: attemptIds(),
    now: options.now ?? (() => new Date('2026-11-18T10:00:00.000Z')),
  })
  return { cloud, plan, cut, savePiece, saveProject }
}

/** A sleep that holds every wait until the test lets it go. */
function heldSleep() {
  const gate: { hold: boolean; release: (() => void) | null } = { hold: false, release: null }
  const sleep = () =>
    gate.hold
      ? new Promise<void>((resolve) => {
          gate.release = resolve
        })
      : Promise.resolve()
  return { gate, sleep }
}

function liveRecord(id = 'clip-1'): ShadowRemoval | undefined {
  const item = useItemsStore.getState().itemById[id]
  return item?.type === 'video' ? item.shadowRemoval : undefined
}

function liveClip(id = 'clip-1'): VideoItem {
  return useItemsStore.getState().itemById[id] as VideoItem
}

describe('the paid clean, on the cloud’s rules', () => {
  beforeEach(() => {
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE, clipId: 'clip-1', isOpen: true })
    useItemsStore.getState().setItems([clip(), clip({ id: 'clip-2', from: 20_000 })])
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [MEDIA] })
  })

  it('cleans on the tracking pass’s upload: one cut and one upload for the pass and the clean', async () => {
    const { cloud, plan, cut, savePiece } = setupCloud()

    await useShadowSessionStore.getState().track(liveClip())
    await useShadowSessionStore.getState().clean(liveClip())

    expect(plan).toHaveBeenCalledTimes(1)
    expect(cut).toHaveBeenCalledTimes(1)
    expect(cloud.server.to('/v1/uploads')).toHaveLength(1)
    expect(cloud.server.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
    const full = cloud.fullJobs()
    expect(full).toHaveLength(1)
    expect(full[0]?.uploadId).toBe(UPLOAD_ID)
    expect(cloud.charged()).toBe(QUOTE.costCredits)
    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(liveRecord()?.pieces).toHaveLength(1)
    expect(liveRecord()?.pending).toBeUndefined()
    expect(useShadowSessionStore.getState().stage).toBe('ready')
  })

  it('records a clean that succeeded after the pilot moved to another clip', async () => {
    const { gate, sleep } = heldSleep()
    const { cloud, savePiece } = setupCloud({ sleep })
    await useShadowSessionStore.getState().track(liveClip())

    gate.hold = true
    const clean = useShadowSessionStore.getState().clean(liveClip())
    await vi.waitFor(() => expect(useShadowSessionStore.getState().stage).toBe('cleaning'))
    await vi.waitFor(() => expect(gate.release).not.toBeNull())

    // The pilot selects another clip: the section for clip-1 is gone, its session with it.
    useShadowSessionStore.getState().open('clip-2')
    gate.hold = false
    gate.release?.()
    await clean

    expect(cloud.server.to(/\/cancel$/)).toHaveLength(0)
    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(liveRecord()?.pieces).toHaveLength(1)
    expect(liveRecord()?.pending).toBeUndefined()
    // The other clip's section heard nothing of it.
    expect(useShadowSessionStore.getState().clipId).toBe('clip-2')
    expect(useShadowSessionStore.getState().stage).toBe('idle')
    expect(useShadowSessionStore.getState().error).toBeNull()
  })

  it('records a clean that succeeded after the section closed', async () => {
    const { gate, sleep } = heldSleep()
    const { savePiece } = setupCloud({ sleep })
    await useShadowSessionStore.getState().track(liveClip())

    gate.hold = true
    const clean = useShadowSessionStore.getState().clean(liveClip())
    await vi.waitFor(() => expect(gate.release).not.toBeNull())
    useShadowSessionStore.getState().close()
    gate.hold = false
    gate.release?.()
    await clean

    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(liveRecord()?.pieces).toHaveLength(1)
  })

  it('refuses a second press on frames a clean is still on its way for', async () => {
    const { gate, sleep } = heldSleep()
    const { cloud } = setupCloud({ sleep })
    await useShadowSessionStore.getState().track(liveClip())

    gate.hold = true
    const clean = useShadowSessionStore.getState().clean(liveClip())
    await vi.waitFor(() => expect(gate.release).not.toBeNull())
    // The pilot leaves and comes back: the session is fresh, the record still has the press.
    useShadowSessionStore.getState().open('clip-2')
    useShadowSessionStore.getState().open('clip-1')
    useShadowSessionStore.setState({
      stage: 'ready',
      pass: {
        jobId: TRACK_JOB_ID,
        uploadId: UPLOAD_ID,
        mark: MARK,
        window: WINDOW,
        points: [{ frame: 3360, x: 1860.25, y: 2410.5, radius: 96.5 }],
        ranges: [{ startFrame: 3360, endFrame: 3390 }],
      },
      quote: QUOTE,
    })
    await useShadowSessionStore.getState().clean(liveClip())

    expect(useShadowSessionStore.getState().error).toBe(
      'A paid clean of these frames is already on its way.',
    )
    expect(cloud.fullJobs()).toHaveLength(1)

    gate.hold = false
    gate.release?.()
    await clean
    expect(liveRecord()?.pieces).toHaveLength(1)
  })

  it('asks the price again on the pass’s upload, so the press works once credits were bought', async () => {
    const { cloud } = setupCloud({ cloud: { availableCredits: 20 } })
    await useShadowSessionStore.getState().track(liveClip())
    expect(useShadowSessionStore.getState().quote?.enough).toBe(false)

    // The pilot buys credits in the browser and comes back.
    cloud.setAvailableCredits(1200)
    await useShadowSessionStore.getState().refreshQuote(liveClip())

    expect(useShadowSessionStore.getState().quote).toMatchObject({
      enough: true,
      availableCredits: 1200,
    })
    const asked = cloud.server
      .to('/v1/jobs/quote')
      .map((call) => call.body as { uploadId?: string })
    expect(asked.map((body) => body.uploadId)).toEqual([UPLOAD_ID, UPLOAD_ID])
    await useShadowSessionStore.getState().clean(liveClip())
    expect(liveRecord()?.pieces).toHaveLength(1)
  })

  it('asks a short price again when the same mark is followed again, without a second pass', async () => {
    const { cloud, plan } = setupCloud({ cloud: { availableCredits: 20 } })
    await useShadowSessionStore.getState().track(liveClip())
    cloud.setAvailableCredits(1200)

    await useShadowSessionStore.getState().track(liveClip())

    expect(plan).toHaveBeenCalledTimes(1)
    expect(cloud.jobs().filter((job) => job.kind === 'track')).toHaveLength(1)
    expect(useShadowSessionStore.getState().quote?.enough).toBe(true)
  })

  it('drops a pass whose upload the cloud no longer keeps, so following the shadow uploads afresh', async () => {
    const { cloud } = setupCloud({
      cloud: { uploadCreatedAt: '2026-11-10T09:00:00.000Z' },
      now: () => new Date('2026-11-18T10:00:00.000Z'),
    })
    await useShadowSessionStore.getState().track(liveClip())

    await useShadowSessionStore.getState().clean(liveClip())

    expect(useShadowSessionStore.getState().error).toBe(
      'DroneClean no longer keeps the uploaded seconds. Follow the shadow again.',
    )
    expect(useShadowSessionStore.getState().pass).toBeNull()
    expect(cloud.fullJobs()).toHaveLength(0)
    await useShadowSessionStore.getState().track(liveClip())
    expect(cloud.server.to('/v1/uploads')).toHaveLength(2)
  })

  it('drops the pass when the API refuses the job on its upload', async () => {
    const { cloud } = setupCloud()
    await useShadowSessionStore.getState().track(liveClip())
    cloud.failNext('createJob', 1, {
      kind: 'status',
      status: 409,
      code: 'conflict',
      message: 'This video is no longer stored. Please upload it again.',
    })

    await useShadowSessionStore.getState().clean(liveClip())

    const state = useShadowSessionStore.getState()
    expect(state.error).toBe('This video is no longer stored. Please upload it again.')
    expect(state.pass).toBeNull()
    expect(state.stage).toBe('idle')
    expect(liveRecord()?.pending).toBeUndefined()
  })

  it('picks up a pending clean when the project opens, once even when asked twice', async () => {
    const { cloud, savePiece } = setupCloud()
    // A job the cloud made for a press before the restart; the saved record knows its attempt.
    const attemptId = '0b6f9c3e-7a52-4f0e-9d1c-00000000aaaa'
    await cloud.server.fetch('https://droneclean.test/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({ uploadId: UPLOAD_ID, kind: 'full', attemptId, segments: [] }),
    })
    const pending: ShadowPendingClean = {
      attemptId,
      uploadId: UPLOAD_ID,
      jobId: FULL_JOB_ID,
      startFrame: 3330,
      frames: 600,
      ranges: [{ startFrame: 3360, endFrame: 3390 }],
      passJobId: TRACK_JOB_ID,
      credits: QUOTE.costCredits,
      segments: [
        {
          startSeconds: frameToSeconds(RATE, 30),
          endSeconds: frameToSeconds(RATE, 60),
          anchor: { x: 1860.25, y: 2410.5, timeSeconds: frameToSeconds(RATE, 30), radius: 96.5 },
          trackJobIds: [TRACK_JOB_ID],
        },
      ],
      startedAt: '2026-11-18T09:50:00.000Z',
      state: 'unreachable',
    }
    useItemsStore
      .getState()
      .setItems([
        clip({ shadowRemoval: { mark: { ...MARK }, ranges: [], pieces: [], pending: [pending] } }),
      ])

    await Promise.all([resumePendingCleans(), resumePendingCleans()])

    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(cloud.server.to(/^\/results\//)).toHaveLength(1)
    const record = liveRecord()
    expect(record?.pieces).toHaveLength(1)
    expect(record?.pieces[0]?.path).toBe(`media/media-1/shadow/3330_600_${attemptId}.mp4`)
    expect(record?.ranges).toEqual([
      {
        startFrame: 3360,
        endFrame: 3390,
        credits: QUOTE.costCredits,
        jobId: FULL_JOB_ID,
        passJobId: TRACK_JOB_ID,
      },
    ])
    expect(record?.pending).toBeUndefined()
  })

  it('keeps the cleans on their way when the mark is set again', () => {
    const pending = {
      attemptId: 'a-1',
      uploadId: UPLOAD_ID,
      jobId: FULL_JOB_ID,
      startFrame: 3330,
      frames: 600,
      ranges: [{ startFrame: 3360, endFrame: 3390 }],
      passJobId: TRACK_JOB_ID,
      credits: 45,
      segments: [
        {
          startSeconds: 0.5,
          endSeconds: 1,
          anchor: { x: 1, y: 2, timeSeconds: 0.5, radius: 4 },
        },
      ],
      startedAt: '2026-11-18T09:50:00.000Z',
    }
    useItemsStore
      .getState()
      .setItems([
        clip({ shadowRemoval: { mark: { ...MARK }, ranges: [], pieces: [], pending: [pending] } }),
      ])

    useShadowSessionStore.getState().setMark(liveClip(), { x: 1, y: 2, sourceFrame: 3, radius: 4 })

    expect(liveRecord()?.pending).toEqual([pending])
  })
})

/** A job the cloud made for a press before the editor closed, and the clip's record that knows it. */
async function pendingOnRecord(
  cloud: ReturnType<typeof createFakeCloud>,
): Promise<ShadowPendingClean> {
  const attemptId = '0b6f9c3e-7a52-4f0e-9d1c-00000000bbbb'
  await cloud.server.fetch('https://droneclean.test/v1/jobs', {
    method: 'POST',
    body: JSON.stringify({ uploadId: UPLOAD_ID, kind: 'full', attemptId, segments: [] }),
  })
  const pending: ShadowPendingClean = {
    attemptId,
    uploadId: UPLOAD_ID,
    jobId: FULL_JOB_ID,
    startFrame: 3330,
    frames: 600,
    ranges: [{ startFrame: 3360, endFrame: 3390 }],
    passJobId: TRACK_JOB_ID,
    credits: QUOTE.costCredits,
    segments: [
      {
        startSeconds: frameToSeconds(RATE, 30),
        endSeconds: frameToSeconds(RATE, 60),
        anchor: { x: 1860.25, y: 2410.5, timeSeconds: frameToSeconds(RATE, 30), radius: 96.5 },
      },
    ],
    startedAt: '2026-11-18T09:50:00.000Z',
  }
  useItemsStore
    .getState()
    .setItems([
      clip({ shadowRemoval: { mark: { ...MARK }, ranges: [], pieces: [], pending: [pending] } }),
    ])
  return pending
}

describe('saving the press, and canceling a clean from its own line', () => {
  beforeEach(() => {
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE, clipId: 'clip-1', isOpen: true })
    useItemsStore.getState().setItems([clip(), clip({ id: 'clip-2', from: 20_000 })])
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [MEDIA] })
  })

  it('saves the project once the press is on the record, before the job is asked for', async () => {
    const seen: { pending: number; fullJobs: number }[] = []
    const cloudRef: { current: ReturnType<typeof createFakeCloud> | null } = { current: null }
    const { cloud, saveProject } = setupCloud({
      saveProject: async () => {
        seen.push({
          pending: liveRecord()?.pending?.length ?? 0,
          fullJobs: cloudRef.current?.fullJobs().length ?? -1,
        })
      },
    })
    cloudRef.current = cloud
    await useShadowSessionStore.getState().track(liveClip())

    await useShadowSessionStore.getState().clean(liveClip())

    expect(saveProject).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ pending: 1, fullJobs: 0 }])
    expect(useShadowSessionStore.getState().projectNotSaved).toBe(false)
    expect(liveRecord()?.pieces).toHaveLength(1)
  })

  it('says the project could not be saved, and the press still goes through', async () => {
    const { cloud } = setupCloud({
      saveProject: async () => {
        throw new Error('The disk is full.')
      },
    })
    await useShadowSessionStore.getState().track(liveClip())

    await useShadowSessionStore.getState().clean(liveClip())

    expect(useShadowSessionStore.getState().projectNotSaved).toBe(true)
    expect(useShadowSessionStore.getState().error).toBeNull()
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(liveRecord()?.pieces).toHaveLength(1)

    // The next press starts with a clean slate.
    useShadowSessionStore.getState().open('clip-2')
    expect(useShadowSessionStore.getState().projectNotSaved).toBe(false)
  })

  it('cancels a clean from its own line once the pilot has left its section', async () => {
    const { gate, sleep } = heldSleep()
    const { cloud, savePiece } = setupCloud({ sleep })
    await useShadowSessionStore.getState().track(liveClip())
    gate.hold = true
    const clean = useShadowSessionStore.getState().clean(liveClip())
    await vi.waitFor(() => expect(gate.release).not.toBeNull())
    useShadowSessionStore.getState().open('clip-2')
    const attemptId = liveRecord()?.pending?.[0]?.attemptId ?? ''

    cancelPendingClean('clip-1', attemptId)
    gate.hold = false
    gate.release?.()
    await clean

    expect(cloud.server.to(`/v1/jobs/${FULL_JOB_ID}/cancel`)).toHaveLength(1)
    expect(cloud.reserved()).toBe(0)
    expect(savePiece).not.toHaveBeenCalled()
    expect(liveRecord()?.pending).toBeUndefined()
    expect(liveRecord()?.pieces).toEqual([])
    // A stop is no failure: nothing is left to show on its line.
    expect(useRunningCleans.getState().errors[cleanKey('clip-1', attemptId)]).toBeUndefined()
  })

  it('cancels a clean picked up after a restart from its own line', async () => {
    const { gate, sleep } = heldSleep()
    const { cloud, savePiece } = setupCloud({ sleep })
    const pending = await pendingOnRecord(cloud)
    gate.hold = true

    const resumed = resumePendingCleans()
    await vi.waitFor(() => expect(gate.release).not.toBeNull())
    cancelPendingClean('clip-1', pending.attemptId)
    gate.hold = false
    gate.release?.()
    await resumed

    expect(cloud.server.to(`/v1/jobs/${FULL_JOB_ID}/cancel`)).toHaveLength(1)
    expect(cloud.reserved()).toBe(0)
    expect(savePiece).not.toHaveBeenCalled()
    expect(liveRecord()?.pending).toBeUndefined()
  })

  it('records a clean whose job succeeded even if Cancel is pressed while it is brought in', async () => {
    const save: { finish: (() => void) | null } = { finish: null }
    const { cloud, savePiece } = setupCloud({
      savePiece: () =>
        new Promise<string>((resolve) => {
          save.finish = () => resolve('blob:cleaned-piece')
        }),
    })
    const pending = await pendingOnRecord(cloud)
    const key = cleanKey('clip-1', pending.attemptId)

    const resumed = resumePendingCleans()
    await vi.waitFor(() => expect(save.finish).not.toBeNull())
    expect(useRunningCleans.getState().paid).toContain(key)

    cancelPendingClean('clip-1', pending.attemptId)
    save.finish?.()
    await resumed

    expect(cloud.server.to(/\/cancel$/)).toHaveLength(0)
    expect(cloud.charged()).toBe(QUOTE.costCredits)
    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(liveRecord()?.pieces).toHaveLength(1)
    expect(useRunningCleans.getState().paid).not.toContain(key)
  })
})
