import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { updateItem } from '@/features/timeline/stores/timeline-actions'
import { frameToSeconds, toRate } from '@/studio/time'
import { FULL_JOB_ID, UPLOAD_ID } from './api/__fixtures__/recorded'
import {
  createFakeCloud,
  type FakeCloud,
  type FakeCloudOptions,
} from './api/__fixtures__/fake-cloud'
import { createDroneCleanClient } from './api/client'
import { createMemorySession } from './api/session'
import type { ShadowPendingClean, ShadowRemoval } from './model'
import {
  cleanShadow,
  dropForgottenClean,
  pendingCleansOver,
  removeCleanedPieces,
  resumeClean,
  splitRangeCredits,
  type ShadowCleanDeps,
  type ShadowCleanRequest,
  type ShadowCleanStage,
} from './run'
import { resolveShadowSource } from './source-map'

const RATE = toRate(59.94)
const ATTEMPT_ID = '0b6f9c3e-7a52-4f0e-9d1c-2b8f4a6e5d30'
const PASS_JOB_ID = 'pass-1'
const NOW = new Date('2026-11-19T10:00:00.000Z')

const MARK = { x: 1860.25, y: 2410.5, sourceFrame: 3630, radius: 96.5 }

/** The ten-second window the tracking pass uploaded: 600 frames from source frame 3330. */
const WINDOW = {
  startFrame: 3330,
  endFrame: 3930,
  startSeconds: frameToSeconds(RATE, 3330),
  endSeconds: frameToSeconds(RATE, 3930),
}

const POINTS = [
  { frame: 3360, x: 1860.25, y: 2410.5, radius: 96.5 },
  { frame: 3420, x: 1882.75, y: 2425.5, radius: 99.5 },
]

const RANGES = [
  { startFrame: 3360, endFrame: 3390 },
  { startFrame: 3420, endFrame: 3430 },
]

const SEGMENTS = [
  {
    startSeconds: frameToSeconds(RATE, 30),
    endSeconds: frameToSeconds(RATE, 60),
    anchor: { x: 1860.25, y: 2410.5, timeSeconds: frameToSeconds(RATE, 30), radius: 96.5 },
    trackJobIds: [PASS_JOB_ID],
  },
  {
    startSeconds: frameToSeconds(RATE, 90),
    endSeconds: frameToSeconds(RATE, 100),
    anchor: { x: 1882.75, y: 2425.5, timeSeconds: frameToSeconds(RATE, 90), radius: 99.5 },
    trackJobIds: [PASS_JOB_ID],
  },
]

const PIECE_PATH = `media/media-1/shadow/3330_600_${ATTEMPT_ID}.mp4`

function clip(extra: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'video',
    label: 'DJI_0020',
    mediaId: 'media-1',
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

/** The clip's record as the store has it now. */
function record(): ShadowRemoval | undefined {
  const item = useItemsStore.getState().itemById['clip-1']
  return item?.type === 'video' ? item.shadowRemoval : undefined
}

interface Setup {
  cloud: FakeCloud
  savePiece: ReturnType<typeof vi.fn>
  /** The project saves after each press: what the record and the cloud held at that moment. */
  saves: { pending: ShadowPendingClean[] | undefined; jobs: number }[]
  stages: ShadowCleanStage[]
  progress: number[]
  jobs: (string | null)[]
  /** What each wait saw on the clip's record, in order. */
  seen: (ShadowRemoval | undefined)[]
  deps: ShadowCleanDeps
  cancel: () => void
}

/** The cloud as the clean uses it, and the shell around the flow. */
function setup(
  options: {
    cloud?: FakeCloudOptions
    saveFails?: boolean
    /** The project save after the press fails. */
    projectSaveFails?: boolean
    /** Called at every wait of the poll or a retry, with its number (from 1). */
    onSleep?: (count: number) => void
  } = {},
): Setup {
  const cloud = createFakeCloud(options.cloud)
  const client = createDroneCleanClient({
    baseUrl: 'https://droneclean.test',
    fetch: cloud.server.fetch,
    session: createMemorySession('fixture-token'),
    openUrl: () => undefined,
  })
  const savePiece = vi.fn(async (_segments: string[], _blob: Blob) => {
    if (options.saveFails) throw new Error('The project folder could not write the file.')
    return 'blob:cleaned-piece'
  })
  const stages: ShadowCleanStage[] = []
  const progress: number[] = []
  const jobs: (string | null)[] = []
  const seen: (ShadowRemoval | undefined)[] = []
  const saves: Setup['saves'] = []
  let cancelled = false
  let sleeps = 0
  const deps: ShadowCleanDeps = {
    client,
    sleep: async () => {
      sleeps += 1
      seen.push(record())
      options.onSleep?.(sleeps)
    },
    now: () => NOW,
    savePiece,
    savePress: async () => {
      saves.push({ pending: record()?.pending, jobs: cloud.jobs().length })
      if (options.projectSaveFails) throw new Error('The disk is full.')
    },
    onJob: (jobId) => jobs.push(jobId),
    onStage: (stage) => stages.push(stage),
    onProgress: (fraction) => progress.push(fraction),
    isCancelled: () => cancelled,
  }
  return {
    cloud,
    savePiece,
    saves,
    stages,
    progress,
    jobs,
    seen,
    deps,
    cancel: () => {
      cancelled = true
    },
  }
}

/** The same cloud, seen from a fresh editor (a restart): new client, nothing in memory. */
function reopened(cloud: FakeCloud): ShadowCleanDeps & { savePiece: ReturnType<typeof vi.fn> } {
  const savePiece = vi.fn(async (_segments: string[], _blob: Blob) => 'blob:reopened-piece')
  return {
    client: createDroneCleanClient({
      baseUrl: 'https://droneclean.test',
      fetch: cloud.server.fetch,
      session: createMemorySession('fixture-token'),
      openUrl: () => undefined,
    }),
    sleep: async () => undefined,
    now: () => NOW,
    savePiece,
    savePress: async () => undefined,
    onJob: () => undefined,
    onStage: () => undefined,
    onProgress: () => undefined,
    isCancelled: () => false,
  }
}

function request(extra: Partial<ShadowCleanRequest> = {}): ShadowCleanRequest {
  return {
    item: clip(),
    rate: RATE,
    pass: { jobId: PASS_JOB_ID, uploadId: UPLOAD_ID, window: WINDOW, points: POINTS },
    ranges: RANGES,
    credits: 45,
    attemptId: ATTEMPT_ID,
    ...extra,
  }
}

/** The project as it was saved: a copy of the clip's record, read back into a fresh store. */
function reopenProjectWith(saved: ShadowRemoval | undefined): void {
  useItemsStore.getState().setItems([clip({ shadowRemoval: structuredClone(saved) })])
  useTimelineCommandStore.getState().clearHistory()
}

const fullJobCreations = (cloud: FakeCloud) =>
  cloud.server
    .to('/v1/jobs')
    .filter((call) => call.method === 'POST' && (call.body as { kind?: string }).kind === 'full')

describe('cleaning a clip’s shadow ranges', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([clip()])
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 59.94 })
  })

  it('creates one full job on the pass’s upload and records its file in one undo step', async () => {
    const { cloud, savePiece, stages, progress, jobs, deps } = setup()

    const outcome = await cleanShadow(request(), deps)

    // Nothing is cut or uploaded again: the job runs on the tracking pass's upload.
    expect(cloud.server.to('/v1/uploads')).toHaveLength(0)
    expect(cloud.server.calls.filter((call) => call.method === 'PUT')).toHaveLength(0)
    expect(cloud.server.to('/v1/jobs')[0]?.body).toEqual({
      uploadId: UPLOAD_ID,
      kind: 'full',
      segments: SEGMENTS,
      options: { quality: 'standard', outputStep: 1 },
      attemptId: ATTEMPT_ID,
    })
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(cloud.charged()).toBe(45)

    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(savePiece.mock.calls[0]?.[0]).toEqual([
      'media',
      'media-1',
      'shadow',
      `3330_600_${ATTEMPT_ID}.mp4`,
    ])
    expect((savePiece.mock.calls[0]?.[1] as Blob).size).toBe(8)

    expect(record()).toEqual({
      mark: MARK,
      ranges: [
        { ...RANGES[0], credits: 34, jobId: FULL_JOB_ID, passJobId: PASS_JOB_ID },
        { ...RANGES[1], credits: 11, jobId: FULL_JOB_ID, passJobId: PASS_JOB_ID },
      ],
      pieces: [
        {
          jobId: FULL_JOB_ID,
          path: PIECE_PATH,
          src: 'blob:cleaned-piece',
          startFrame: 3330,
          frames: 600,
          availableUntil: '2026-12-18T09:50:00.000Z',
        },
      ],
    })
    expect(outcome.piece.jobId).toBe(FULL_JOB_ID)
    expect(stages).toEqual(['cleaning', 'downloading', 'saving'])
    expect(progress).toContain(0.7)
    expect(jobs).toEqual([FULL_JOB_ID, null])

    // One undo step takes the piece and its ranges away together, and brings no pending clean back.
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    useTimelineCommandStore.getState().undo()
    expect(record()).toEqual({ mark: MARK, ranges: [], pieces: [] })
  })

  it('writes the press on the clip’s record before the job is asked for, outside the undo history', async () => {
    const { cloud, seen, deps } = setup()
    cloud.failNext('createJob', 1, { kind: 'lost-request' })

    await cleanShadow(request(), deps)

    // The first wait is the retry of the lost creation: the press is already on the record.
    expect(seen[0]?.pending).toEqual([
      {
        attemptId: ATTEMPT_ID,
        uploadId: UPLOAD_ID,
        startFrame: 3330,
        frames: 600,
        ranges: RANGES,
        passJobId: PASS_JOB_ID,
        credits: 45,
        segments: SEGMENTS,
        startedAt: NOW.toISOString(),
      },
    ])
    // Once the creation answered, the record knows its job.
    expect(seen[1]?.pending?.[0]?.jobId).toBe(FULL_JOB_ID)
    // The pending clean is no edit: the only undo step is the recorded clean.
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(record()?.pending).toBeUndefined()
  })

  it('saves the project once the press is on the record, before the job is asked for', async () => {
    const { cloud, saves, deps } = setup()

    await cleanShadow(request(), deps)

    expect(saves).toHaveLength(1)
    expect(saves[0]?.pending?.map((entry) => entry.attemptId)).toEqual([ATTEMPT_ID])
    expect(saves[0]?.jobs).toBe(0)
    expect(cloud.fullJobs()).toHaveLength(1)
  })

  it('goes on with the press when the project cannot be saved', async () => {
    const { cloud, saves, savePiece, deps } = setup({ projectSaveFails: true })

    await cleanShadow(request(), deps)

    expect(saves).toHaveLength(1)
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toHaveLength(1)
  })

  it('keeps a clean whose job the service does not know as missing; forgetting it frees its frames', async () => {
    const { cloud, savePiece, deps } = setup()
    // Signed in with another account: the job is not this account's.
    cloud.failNext('getJob', 1, {
      kind: 'status',
      status: 404,
      code: 'not_found',
      message: 'This job does not exist.',
    })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).message).toBe(
      'DroneClean does not know this job: it may belong to another account. The paid clean is kept.',
    )
    expect(savePiece).not.toHaveBeenCalled()
    expect(record()?.pending?.[0]).toMatchObject({ jobId: FULL_JOB_ID, state: 'missing' })
    expect(pendingCleansOver(record(), WINDOW.startFrame, WINDOW.endFrame)).toHaveLength(1)

    dropForgottenClean('clip-1', ATTEMPT_ID)

    expect(record()?.pending).toBeUndefined()
    expect(pendingCleansOver(record(), WINDOW.startFrame, WINDOW.endFrame)).toHaveLength(0)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('picks a missing clean up again once the service knows its job, and lets the state go', async () => {
    const { cloud, deps } = setup()
    cloud.failNext('getJob', 1, { kind: 'status', status: 404, code: 'not_found' })
    await cleanShadow(request(), deps).catch(() => undefined)
    expect(record()?.pending?.[0]?.state).toBe('missing')

    const later = reopened(cloud)
    await resumeClean('clip-1', ATTEMPT_ID, later)

    expect(later.savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toHaveLength(1)
    expect(record()?.pending).toBeUndefined()
  })

  it('asks for the job again with the same attempt after its answer was lost, and gets the one job', async () => {
    const { cloud, savePiece, deps } = setup()
    cloud.failNext('createJob', 1, { kind: 'lost-answer' })

    await cleanShadow(request(), deps)

    const creations = fullJobCreations(cloud)
    expect(creations).toHaveLength(2)
    expect(creations.map((call) => (call.body as { attemptId: string }).attemptId)).toEqual([
      ATTEMPT_ID,
      ATTEMPT_ID,
    ])
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(cloud.charged()).toBe(45)
    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toHaveLength(1)
  })

  it('asks again after requests that never reached the cloud, too', async () => {
    const { cloud, deps } = setup()
    cloud.failNext('createJob', 2, { kind: 'lost-request' })
    cloud.failNext('createJob', 1, { kind: 'status', status: 503 })

    await cleanShadow(request(), deps)

    expect(fullJobCreations(cloud)).toHaveLength(4)
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(record()?.pieces).toHaveLength(1)
  })

  it('keeps the press as unreachable when the creation never answers, and finds the same job when picked up again', async () => {
    const { cloud, savePiece, deps } = setup()
    // Seven tries in all: the first makes the job, and every answer is lost.
    cloud.failNext('createJob', 7, { kind: 'lost-answer' })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).message).toBe(
      'Could not reach DroneClean. The paid clean is kept and will be picked up again.',
    )
    expect(fullJobCreations(cloud)).toHaveLength(7)
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(savePiece).not.toHaveBeenCalled()
    const pending = record()?.pending
    expect(pending).toHaveLength(1)
    expect(pending?.[0]?.state).toBe('unreachable')
    expect(pending?.[0]?.jobId).toBeUndefined()

    // The app restarts: the saved record is all the editor knows.
    reopenProjectWith(record())
    const later = reopened(cloud)
    await resumeClean('clip-1', ATTEMPT_ID, later)

    expect(fullJobCreations(cloud)).toHaveLength(8)
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(cloud.charged()).toBe(45)
    expect(later.savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toHaveLength(1)
    expect(record()?.pending).toBeUndefined()
  })

  it('picks up a pending job after a restart: read, downloaded and recorded once', async () => {
    const { cloud, savePiece, deps } = setup()
    // The job is made, then the network goes for longer than the retries.
    cloud.failNext('getJob', 7, { kind: 'lost-request' })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).message).toContain('The paid clean is kept')
    expect(savePiece).not.toHaveBeenCalled()
    expect(record()?.pending?.[0]).toMatchObject({ jobId: FULL_JOB_ID, state: 'unreachable' })

    reopenProjectWith(record())
    const later = reopened(cloud)
    const outcome = await resumeClean('clip-1', ATTEMPT_ID, later)

    expect(outcome?.piece.jobId).toBe(FULL_JOB_ID)
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(fullJobCreations(cloud)).toHaveLength(1)
    expect(later.savePiece).toHaveBeenCalledTimes(1)
    expect(later.savePiece.mock.calls[0]?.[0]).toEqual(PIECE_PATH.split('/'))
    expect(record()?.pieces).toHaveLength(1)
    expect(record()?.ranges).toHaveLength(2)
    expect(record()?.pending).toBeUndefined()

    // Picking it up again finds nothing left to do.
    expect(await resumeClean('clip-1', ATTEMPT_ID, later)).toBeNull()
    expect(later.savePiece).toHaveBeenCalledTimes(1)
  })

  it('keeps following a job through lost reads and server errors', async () => {
    const { cloud, savePiece, deps } = setup()
    cloud.failNext('getJob', 2, { kind: 'lost-request' })
    cloud.failNext('getJob', 1, { kind: 'status', status: 503 })
    cloud.failNext('getJob', 1, { kind: 'lost-answer' })

    await cleanShadow(request(), deps)

    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toHaveLength(1)
    expect(record()?.pending).toBeUndefined()
  })

  it('downloads again on a fresh URL when a download fails', async () => {
    const { cloud, savePiece, deps } = setup()
    cloud.failNext('download', 1, { kind: 'status', status: 403 })

    await cleanShadow(request(), deps)

    const downloads = cloud.server.to(/^\/results\//)
    expect(downloads).toHaveLength(2)
    expect(downloads[0]?.url).not.toBe(downloads[1]?.url)
    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toHaveLength(1)
  })

  it('cancels a job whose reservation is not the price the section showed', async () => {
    const { cloud, savePiece, deps } = setup({ cloud: { reservedCredits: 50 } })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect(cloud.server.to(`/v1/jobs/${FULL_JOB_ID}/cancel`)).toHaveLength(1)
    expect(cloud.reserved()).toBe(0)
    expect(cloud.charged()).toBe(0)
    expect(savePiece).not.toHaveBeenCalled()
    expect((error as Error).message).toBe(
      'The job would take 50 credits, not the 45 shown, so it was cancelled and nothing was charged.',
    )
    expect(record()).toEqual({ mark: MARK, ranges: [], pieces: [] })
  })

  it('keeps a repriced job whose cancel fails as pending, says so, and cancels it when picked up again', async () => {
    const { cloud, savePiece, deps } = setup({ cloud: { reservedCredits: 50 } })
    cloud.failNext('cancelJob', 7, { kind: 'lost-request' })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).message).toBe(
      'The service reserved 50 credits, not the 45 shown, so the job was not started. The cancel did not go through yet; it will be tried again.',
    )
    expect(record()?.pending?.[0]).toMatchObject({
      jobId: FULL_JOB_ID,
      state: 'repriced',
      reservedCredits: 50,
      credits: 45,
    })
    expect(cloud.reserved()).toBe(50)
    expect(savePiece).not.toHaveBeenCalled()

    reopenProjectWith(record())
    const retried = await resumeClean('clip-1', ATTEMPT_ID, reopened(cloud)).catch(
      (caught: unknown) => caught,
    )

    expect((retried as Error).message).toBe(
      'The job would take 50 credits, not the 45 shown, so it was cancelled and nothing was charged.',
    )
    expect(cloud.reserved()).toBe(0)
    expect(cloud.charged()).toBe(0)
    expect(record()?.pending).toBeUndefined()
    expect(record()?.pieces).toEqual([])
  })

  it('brings in a repriced job that succeeded before its cancel got through: it was paid for', async () => {
    const { cloud, deps } = setup({ cloud: { reservedCredits: 50, reads: ['succeeded'] } })
    cloud.failNext('cancelJob', 7, { kind: 'lost-request' })
    await cleanShadow(request(), deps).catch(() => undefined)

    reopenProjectWith(record())
    const later = reopened(cloud)
    const outcome = await resumeClean('clip-1', ATTEMPT_ID, later)

    expect(outcome?.piece.jobId).toBe(FULL_JOB_ID)
    expect(cloud.charged()).toBe(50)
    expect(later.savePiece).toHaveBeenCalledTimes(1)
    // The ranges say what the job really took.
    expect(record()?.ranges.map((range) => range.credits)).toEqual([38, 12])
    expect(record()?.pending).toBeUndefined()
  })

  it('shows the cloud’s message for a job that failed, records nothing and forgets the press', async () => {
    const { cloud, savePiece, deps } = setup({ cloud: { reads: ['failed'] } })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).message).toBe('The engine could not follow the shadow.')
    expect(cloud.charged()).toBe(0)
    expect(savePiece).not.toHaveBeenCalled()
    expect(record()).toEqual({ mark: MARK, ranges: [], pieces: [] })
  })

  it('forgets the press when the API refuses the job: nothing was made', async () => {
    const { cloud, deps } = setup()
    cloud.failNext('createJob', 1, {
      kind: 'status',
      status: 409,
      code: 'conflict',
      message: 'This video is no longer stored. Please upload it again.',
    })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).message).toBe('This video is no longer stored. Please upload it again.')
    expect(cloud.jobs()).toHaveLength(0)
    expect(record()).toEqual({ mark: MARK, ranges: [], pieces: [] })
  })

  it('keeps the press when sign-in is refused after a lost answer: the job may exist', async () => {
    const { cloud, savePiece, deps } = setup()
    // The first creation makes the job and its answer is lost; the session ends before the retry.
    cloud.failNext('createJob', 1, { kind: 'lost-answer' })
    cloud.failNext('createJob', 1, {
      kind: 'status',
      status: 401,
      code: 'unauthorized',
      message: 'Sign in to continue.',
    })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).message).toBe('Sign in to continue.')
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(savePiece).not.toHaveBeenCalled()
    expect(record()?.pending?.[0]?.attemptId).toBe(ATTEMPT_ID)

    // Signed in again, the same attempt finds the job it made: one job, recorded once.
    const later = reopened(cloud)
    await resumeClean('clip-1', ATTEMPT_ID, later)

    expect(cloud.fullJobs()).toHaveLength(1)
    expect(later.savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toHaveLength(1)
    expect(record()?.pending).toBeUndefined()
  })

  it('forgets the press when sign-in is refused before any answer was lost: nothing was made', async () => {
    const { cloud, deps } = setup()
    cloud.failNext('createJob', 1, {
      kind: 'status',
      status: 401,
      code: 'unauthorized',
      message: 'Sign in to continue.',
    })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).name).toBe('SignInRequiredError')
    expect(cloud.jobs()).toHaveLength(0)
    expect(record()?.pending).toBeUndefined()
  })

  it('stops the job when the pilot presses Cancel, and records nothing', async () => {
    let pressCancel = () => undefined as void
    const { cloud, savePiece, deps, cancel } = setup({ onSleep: () => pressCancel() })
    pressCancel = cancel

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).name).toBe('AbortError')
    expect(cloud.server.to(`/v1/jobs/${FULL_JOB_ID}/cancel`)).toHaveLength(1)
    expect(cloud.reserved()).toBe(0)
    expect(savePiece).not.toHaveBeenCalled()
    expect(record()).toEqual({ mark: MARK, ranges: [], pieces: [] })
  })

  it('still brings in a job that succeeded before the pilot’s Cancel reached it', async () => {
    let pressCancel = () => undefined as void
    const { cloud, savePiece, deps, cancel } = setup({
      cloud: { reads: ['succeeded'] },
      onSleep: () => pressCancel(),
    })
    pressCancel = cancel
    // The job succeeds on the cloud while the editor waits, before the cancel arrives.
    const advance = cloud.server.fetch
    await cleanShadow(request(), {
      ...deps,
      sleep: async (ms) => {
        await advance(`https://droneclean.test/v1/jobs/${FULL_JOB_ID}`)
        await deps.sleep(ms)
      },
    })

    expect(cloud.server.to(`/v1/jobs/${FULL_JOB_ID}/cancel`)).toHaveLength(1)
    expect(cloud.charged()).toBe(45)
    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toHaveLength(1)
  })

  it('keeps the press when the project folder refuses the file, and records it once when picked up again', async () => {
    const { savePiece, cloud, deps } = setup({ saveFails: true })

    const error = await cleanShadow(request(), deps).catch((caught: unknown) => caught)

    expect((error as Error).message).toBe('The project folder could not write the file.')
    expect(savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toEqual([])
    expect(record()?.pending?.[0]).toMatchObject({ jobId: FULL_JOB_ID })

    const later = reopened(cloud)
    await resumeClean('clip-1', ATTEMPT_ID, later)

    expect(later.savePiece).toHaveBeenCalledTimes(1)
    expect(record()?.pieces).toHaveLength(1)
    expect(record()?.pending).toBeUndefined()
  })

  it('writes the press back when an undo takes it away while the job runs', async () => {
    // An edit before the press: undoing it restores a clip that never heard of the press.
    updateItem('clip-1', { label: 'renamed' })
    let afterUndo: ShadowRemoval | undefined
    const { deps, seen } = setup({
      onSleep: (count) => {
        if (count !== 1) return
        useTimelineCommandStore.getState().undo()
        afterUndo = record()
      },
      cloud: { reads: ['running', 'running', 'succeeded'] },
    })

    await cleanShadow(request(), deps)

    // The undo took the pending clean away during the first wait; the next read wrote it back.
    expect(seen[0]?.pending).toHaveLength(1)
    expect(afterUndo).toEqual({ mark: MARK, ranges: [], pieces: [] })
    expect(seen[1]?.pending?.[0]).toMatchObject({ attemptId: ATTEMPT_ID, jobId: FULL_JOB_ID })
    expect(record()?.pieces).toHaveLength(1)
    expect(record()?.pending).toBeUndefined()
  })

  it('keeps an earlier piece the new clean overlaps: both were paid for', async () => {
    const earlier: ShadowRemoval = {
      mark: { ...MARK },
      ranges: [{ startFrame: 3800, endFrame: 3850, credits: 10, jobId: 'job-0', passJobId: 'p-0' }],
      pieces: [
        {
          jobId: 'job-0',
          path: 'media/media-1/shadow/3600_600_a.mp4',
          src: 'blob:old',
          startFrame: 3600,
          frames: 600,
        },
      ],
    }
    useItemsStore.getState().setItems([clip({ shadowRemoval: earlier })])
    const { deps } = setup()

    await cleanShadow(request({ item: clip({ shadowRemoval: earlier }) }), deps)

    const pieces = record()?.pieces ?? []
    expect(pieces.map((piece) => piece.jobId)).toEqual(['job-0', FULL_JOB_ID])
    expect(record()?.ranges).toHaveLength(3)
    // Frames only the new job cleaned come from it; the older job's paid frames stay its own.
    expect(resolveShadowSource(record(), 3370)?.src).toBe('blob:cleaned-piece')
    expect(resolveShadowSource(record(), 3820)?.src).toBe('blob:old')
    // Where neither cleaned the frame, the newer piece answers.
    expect(resolveShadowSource(record(), 3700)?.src).toBe('blob:cleaned-piece')
    expect(resolveShadowSource(record(), 4000)?.src).toBe('blob:old')
  })

  it('refuses a range with no tracked point before anything is sent', async () => {
    const { cloud, deps } = setup()

    const error = await cleanShadow(
      request({ ranges: [{ startFrame: 10, endFrame: 20 }] }),
      deps,
    ).catch((caught: unknown) => caught)

    expect((error as Error).message).toBe('There is no range to clean.')
    expect(cloud.server.calls).toHaveLength(0)
    expect(record()?.pending).toBeUndefined()
  })
})

describe('the pending cleans over a window', () => {
  const pending = (startFrame: number, frames: number): ShadowPendingClean => ({
    attemptId: `attempt-${startFrame}`,
    uploadId: UPLOAD_ID,
    startFrame,
    frames,
    ranges: [{ startFrame, endFrame: startFrame + 1 }],
    passJobId: PASS_JOB_ID,
    credits: 10,
    segments: [SEGMENTS[0]!],
    startedAt: NOW.toISOString(),
  })

  it('names the ones that share a frame with the window, and only those', () => {
    const withPending: ShadowRemoval = {
      mark: { ...MARK },
      ranges: [],
      pieces: [],
      pending: [pending(3000, 330), pending(3929, 10), pending(5000, 600)],
    }

    expect(pendingCleansOver(withPending, 3330, 3930).map((entry) => entry.startFrame)).toEqual([
      3929,
    ])
    expect(pendingCleansOver(withPending, 3329, 3330)).toHaveLength(1)
    expect(pendingCleansOver(undefined, 0, 10)).toEqual([])
  })
})

describe('splitting a job’s credits over its ranges', () => {
  it('gives one range the whole reservation', () => {
    expect(splitRangeCredits(10, [{ startFrame: 30, endFrame: 60 }])).toEqual([10])
  })

  it('splits by length, with the rounding remainder on the first range', () => {
    const shares = splitRangeCredits(10, RANGES)
    expect(shares).toEqual([8, 2])
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(10)
  })

  it('never loses a credit to rounding', () => {
    const ranges = [
      { startFrame: 0, endFrame: 1 },
      { startFrame: 1, endFrame: 2 },
      { startFrame: 2, endFrame: 3 },
    ]
    const shares = splitRangeCredits(10, ranges)
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(10)
  })
})

describe('removing a clip’s cleaned pieces', () => {
  const PIECES = [
    {
      jobId: 'job-1',
      path: 'media/media-1/shadow/3330_600.mp4',
      src: 'blob:piece-1',
      startFrame: 3330,
      frames: 600,
    },
    {
      jobId: 'job-2',
      path: 'media/media-1/shadow/0_72.mp4',
      src: 'blob:piece-2',
      startFrame: 0,
      frames: 72,
    },
  ]
  const RECORD = {
    mark: { ...MARK, sourceFrame: 0 },
    ranges: [{ startFrame: 3360, endFrame: 3390, credits: 8, jobId: 'job-1', passJobId: 'pass-1' }],
    pieces: PIECES,
  }

  it('detaches the pieces in one undo step without changing another clip that shares them', () => {
    const otherClip = { ...clip({ shadowRemoval: RECORD }), id: 'clip-2' }
    useItemsStore.getState().setItems([clip({ shadowRemoval: RECORD }), otherClip])

    removeCleanedPieces(clip())

    const removed = useItemsStore.getState().itemById['clip-1']?.shadowRemoval
    expect(removed?.pieces).toEqual([])
    // The mark and the ranges paid for stay: the clip can be cleaned again from the same shadow.
    expect(removed?.mark).toEqual(RECORD.mark)
    expect(removed?.ranges).toEqual(RECORD.ranges)
    expect(useItemsStore.getState().itemById['clip-2']?.shadowRemoval?.pieces).toEqual(PIECES)

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval?.pieces).toEqual(PIECES)
  })

  it('does nothing for a clip without a piece', () => {
    const empty = { mark: { ...MARK }, ranges: [], pieces: [] }
    useItemsStore.getState().setItems([clip({ shadowRemoval: empty })])
    removeCleanedPieces(clip())

    expect(useItemsStore.getState().itemById['clip-1']?.shadowRemoval).toBe(empty)
  })

  it('leaves a clip that is no longer on the timeline alone', () => {
    useItemsStore.getState().setItems([])
    expect(() => removeCleanedPieces(clip())).not.toThrow()
  })
})
