/**
 * A cleaned piece whose file is missing can be downloaded again while the service still keeps its
 * copy (30 days after the cleaning), with the recorded cloud and no network: the job is read again
 * for a fresh URL, the file is written to the path the clip records, and the clip gets it back.
 * After that date, or when the service dropped the job, the section says so and the range keeps
 * playing the original.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import type { MediaMetadata } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import { FULL_JOB, FULL_JOB_ID } from './api/__fixtures__/recorded'
import { createFakeServer, type FakeRoute } from './api/__fixtures__/fake-server'
import { createDroneCleanClient } from './api/client'
import { createMemorySession } from './api/session'
import type { Job } from './api/types'
import type { ShadowRemoval } from './model'
import {
  configurePieceRedownload,
  pieceExpired,
  redownloadShadowPiece,
  type PieceRedownloadDeps,
} from './pieces-redownload'
import { SHADOW_SESSION_IDLE, useShadowSessionStore } from './ui/use-shadow-session'
import { ShadowSection } from './ui/ShadowSection'

vi.mock('@/studio/feature-switches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/studio/feature-switches')>()
  return {
    ...actual,
    isFeatureShown: (id: Parameters<typeof actual.isFeatureShown>[0]) =>
      id === 'shadowRemovalClean' || actual.isFeatureShown(id),
  }
})

const NOW = Date.parse('2026-11-19T10:00:00.000Z')
const PIECE_PATH = 'media/media-1/shadow/30_30_attempt-1.mp4'
const FRESH_URL = `https://storage.test/results/${FULL_JOB_ID}/cleaned.mp4?X-Amz-Signature=fresh`
const BYTES = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2])

const MEDIA = {
  id: 'media-1',
  storageType: 'workspace',
  fileName: 'DJI_0020.MP4',
  fileSize: 100,
  mimeType: 'video/mp4',
  duration: 230,
  width: 3840,
  height: 2880,
  fps: 59.94,
  codec: 'hevc',
  bitrate: 1,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
} as MediaMetadata

function record(availableUntil: string | undefined, src?: string): ShadowRemoval {
  return {
    mark: { x: 100, y: 100, sourceFrame: 30, radius: 20 },
    ranges: [{ startFrame: 30, endFrame: 60, credits: 10, jobId: FULL_JOB_ID, passJobId: 'p' }],
    pieces: [
      {
        jobId: FULL_JOB_ID,
        path: PIECE_PATH,
        src,
        startFrame: 30,
        frames: 30,
        ...(availableUntil ? { availableUntil } : {}),
      },
    ],
  }
}

function clip(id: string, shadowRemoval: ShadowRemoval): VideoItem {
  return {
    id,
    trackId: 'track-1',
    type: 'video',
    label: id,
    mediaId: 'media-1',
    src: 'blob:source',
    from: 0,
    durationInFrames: 90,
    sourceFps: 59.94,
    sourceWidth: 3840,
    sourceHeight: 2880,
    shadowRemoval,
  } as VideoItem
}

function finishedJob(availableUntil: string | null): Job {
  return {
    ...FULL_JOB,
    status: 'succeeded',
    stage: 'done',
    progress: 1,
    result: { url: FRESH_URL, expiresAt: '2026-11-19T11:00:00.000Z', availableUntil },
  }
}

function routes(job: () => Job | null): FakeRoute[] {
  return [
    {
      method: 'GET',
      path: `/v1/jobs/${FULL_JOB_ID}`,
      respond: () => {
        const found = job()
        return found
          ? { body: found }
          : { status: 404, body: { error: { code: 'not_found', message: 'No such job' } } }
      },
    },
    {
      method: 'GET',
      path: `/results/${FULL_JOB_ID}/cleaned.mp4`,
      respond: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(BYTES)
              controller.close()
            },
          }),
          { headers: { 'content-type': 'video/mp4', 'content-length': String(BYTES.length) } },
        ),
    },
  ]
}

/** jsdom's Blob has no `arrayBuffer()`; a FileReader reads it. */
function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

function connect(job: () => Job | null, token: string | null = 'token') {
  const server = createFakeServer(routes(job))
  const client = createDroneCleanClient({
    baseUrl: 'https://droneclean.test',
    fetch: server.fetch,
    session: createMemorySession(token),
    openUrl: () => undefined,
  })
  const saved: { segments: string[]; bytes: Uint8Array }[] = []
  const deps: PieceRedownloadDeps = {
    client,
    savePiece: async (segments, blob) => {
      saved.push({ segments, bytes: await readBytes(blob) })
      return 'blob:redownloaded'
    },
    now: () => NOW,
  }
  return { server, deps, saved }
}

beforeEach(() => {
  useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE })
  useItemsStore.getState().setItems([])
  useTimelineSettingsStore.setState({ fps: 59.94 })
  useMediaLibraryStore.setState({ mediaItems: [MEDIA], brokenMediaIds: [] })
  configurePieceRedownload(null)
})

describe('pieceExpired', () => {
  it('is false with no date and before it, true at and after it', () => {
    expect(pieceExpired(undefined, NOW)).toBe(false)
    expect(pieceExpired('2026-12-01T00:00:00.000Z', NOW)).toBe(false)
    expect(pieceExpired('2026-11-19T10:00:00.000Z', NOW)).toBe(true)
    expect(pieceExpired('2026-11-01T00:00:00.000Z', NOW)).toBe(true)
  })
})

describe('redownloadShadowPiece', () => {
  it('reads the job again for a fresh URL, writes the file at the recorded path and gives every clip its piece back', async () => {
    const until = '2026-12-18T09:50:00.000Z'
    useItemsStore
      .getState()
      .setItems([clip('clip-1', record(until)), clip('clip-2', record(until))])
    const { server, deps, saved } = connect(() => finishedJob(until))

    const piece = useItemsStore.getState().itemById['clip-1'] as VideoItem
    const outcome = await redownloadShadowPiece(piece.shadowRemoval!.pieces[0]!, deps)

    expect(outcome).toEqual({ status: 'restored', src: 'blob:redownloaded' })
    expect(server.to(`/v1/jobs/${FULL_JOB_ID}`)).toHaveLength(1)
    expect(server.to(`/results/${FULL_JOB_ID}/cleaned.mp4`)).toHaveLength(1)
    expect(server.calls.find((call) => call.path.startsWith('/results'))?.url).toBe(FRESH_URL)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.segments).toEqual(PIECE_PATH.split('/'))
    expect(saved[0]!.bytes).toEqual(BYTES)
    for (const id of ['clip-1', 'clip-2']) {
      const live = useItemsStore.getState().itemById[id] as VideoItem
      expect(live.shadowRemoval!.pieces[0]!.src).toBe('blob:redownloaded')
    }
  })

  it('does not call the service for a piece past its date', async () => {
    useItemsStore.getState().setItems([clip('clip-1', record('2026-11-18T00:00:00.000Z'))])
    const { server, deps, saved } = connect(() => finishedJob(null))
    const piece = (useItemsStore.getState().itemById['clip-1'] as VideoItem).shadowRemoval!
      .pieces[0]!

    expect(await redownloadShadowPiece(piece, deps)).toEqual({
      status: 'unavailable',
      reason: 'expired',
    })
    expect(server.calls).toHaveLength(0)
    expect(saved).toHaveLength(0)
  })

  it('says the piece is gone when the service dropped the job, and downloads nothing', async () => {
    useItemsStore.getState().setItems([clip('clip-1', record(undefined))])
    const { server, deps, saved } = connect(() => null)
    const piece = (useItemsStore.getState().itemById['clip-1'] as VideoItem).shadowRemoval!
      .pieces[0]!

    expect(await redownloadShadowPiece(piece, deps)).toEqual({
      status: 'unavailable',
      reason: 'gone',
    })
    expect(server.to(/^\/results/)).toHaveLength(0)
    expect(saved).toHaveLength(0)
    const live = useItemsStore.getState().itemById['clip-1'] as VideoItem
    expect(live.shadowRemoval!.pieces[0]!.src).toBeUndefined()
  })

  it('treats a job whose file the service already deleted as expired', async () => {
    useItemsStore.getState().setItems([clip('clip-1', record(undefined))])
    const { server, deps } = connect(() => finishedJob('2026-11-19T09:00:00.000Z'))
    const piece = (useItemsStore.getState().itemById['clip-1'] as VideoItem).shadowRemoval!
      .pieces[0]!

    expect(await redownloadShadowPiece(piece, deps)).toEqual({
      status: 'unavailable',
      reason: 'expired',
    })
    expect(server.to(/^\/results/)).toHaveLength(0)
  })
})

describe('the missing piece in the shadow section', () => {
  function mountSection(item: VideoItem) {
    useItemsStore.getState().setItems([item])
    return render(<ShadowSection items={[item]} />)
  }

  it('says one piece is missing and downloads it again with one press', async () => {
    const until = '2026-12-18T09:50:00.000Z'
    const item = clip('clip-1', record(until))
    const { deps, saved } = connect(() => finishedJob(until))
    configurePieceRedownload({ ...deps, now: () => NOW })
    mountSection(item)

    expect(screen.getByTestId('shadow-missing-line').textContent).toBe(
      '1 cleaned piece is missing.',
    )
    act(() => {
      screen.getByTestId('shadow-redownload').click()
    })

    await waitFor(() => expect(screen.queryByTestId('shadow-missing-pieces')).toBeNull())
    expect(saved).toHaveLength(1)
    expect(
      (useItemsStore.getState().itemById['clip-1'] as VideoItem).shadowRemoval!.pieces[0]!.src,
    ).toBe('blob:redownloaded')
  })

  it('offers no button for a piece past its date and says it is no longer on the service', () => {
    const item = clip('clip-1', record('2020-01-01T00:00:00.000Z'))
    mountSection(item)

    expect(screen.queryByTestId('shadow-redownload')).toBeNull()
    expect(screen.getByTestId('shadow-pieces-gone').textContent).toContain(
      'no longer available on the service',
    )
  })

  it('says so when the service no longer has the job', async () => {
    const item = clip('clip-1', record(undefined))
    const { deps } = connect(() => null)
    configurePieceRedownload(deps)
    mountSection(item)

    act(() => {
      screen.getByTestId('shadow-redownload').click()
    })

    await waitFor(() => expect(screen.getByTestId('shadow-pieces-gone')).toBeInTheDocument())
    expect(screen.queryByTestId('shadow-redownload')).toBeNull()
  })

  it('asks to sign in again when the session is gone', async () => {
    const item = clip('clip-1', record(undefined))
    const { deps } = connect(() => finishedJob(null), null)
    const server401 = createFakeServer([
      {
        method: 'GET',
        path: `/v1/jobs/${FULL_JOB_ID}`,
        respond: () => ({
          status: 401,
          body: { error: { code: 'unauthorized', message: 'Sign in again.' } },
        }),
      },
    ])
    const client = createDroneCleanClient({
      baseUrl: 'https://droneclean.test',
      fetch: server401.fetch,
      session: createMemorySession('stale'),
      openUrl: () => undefined,
    })
    configurePieceRedownload({ ...deps, client })
    mountSection(item)

    act(() => {
      screen.getByTestId('shadow-redownload').click()
    })

    await waitFor(() => expect(screen.getByTestId('shadow-redownload-sign-in')).toBeInTheDocument())
    expect(screen.getByTestId('shadow-redownload-error').textContent).toBe('Sign in again.')
  })

  it('shows nothing when every piece has its file', () => {
    const item = clip('clip-1', record(undefined, 'blob:open'))
    mountSection(item)
    expect(screen.queryByTestId('shadow-missing-pieces')).toBeNull()
  })
})
