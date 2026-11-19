/**
 * A fake DroneClean cloud that keeps state, for the tests of the paid clean.
 *
 * It answers the editor's calls the way the API does (`cloud/services/api/src/jobs/service.ts`,
 * `create`, `findAttempt`, `cancel` and `quote`; `app.ts`, `askedBefore`, commit 628004889):
 *
 * - `POST /v1/jobs` with an `attemptId` the account used before, for the same upload and kind,
 *   answers the job that attempt made and reserves nothing; for another upload or kind it refuses
 *   with 409. A new job reserves its credits when it is made.
 * - `GET /v1/jobs/{id}` walks the job through `reads` (the last one repeats); a succeeded job is
 *   charged and comes with a result URL signed afresh for every read.
 * - `POST /v1/jobs/{id}/cancel` cancels a queued or running job and gives its credits back; a job
 *   that ended is refused with 409 ("This job is already succeeded.").
 * - `POST /v1/jobs/quote` prices on the upload, and says whether the balance covers it.
 *
 * Faults are queued per kind of call (`failNext`): the network lost before the cloud acts, the
 * answer lost after it acted (the dangerous one: the job exists, the editor does not know), or an
 * HTTP error. Nothing here reaches the network.
 */
import type { CreateJobRequest, Job, JobStatus, Upload } from '../types'
import { createFakeServer, type FakeAnswer, type FakeServer } from './fake-server'
import {
  CONFIG,
  FULL_JOB,
  FULL_JOB_ID,
  QUOTE,
  TRACK_DATA,
  TRACK_JOB,
  UPLOAD,
  UPLOAD_ID,
  UPLOAD_TICKET,
} from './recorded'

/** The calls a fault can be queued on. */
export type FakeCloudCall = 'upload' | 'createJob' | 'getJob' | 'cancelJob' | 'quote' | 'download'

/** How one call fails. */
export type FakeFault =
  | { kind: 'lost-request' }
  | { kind: 'lost-answer' }
  | { kind: 'status'; status: number; code?: string; message?: string }

export interface FakeCloudOptions {
  /** What a new full job reserves, in credits. Default: the quote's price. */
  reservedCredits?: number
  /** What the quote prices the ranges at. Default: the recorded quote's 45 credits. */
  price?: number
  /** The account's credits to spend. Default: the recorded quote's 1,200. */
  availableCredits?: number
  /** The states successive reads of a full job report; the last repeats. Default: running, then succeeded. */
  reads?: JobStatus[]
  /** When the upload was stored, as `POST /v1/uploads/{id}/complete` answers. */
  uploadCreatedAt?: string
}

export interface FakeCloud {
  server: FakeServer
  /** Every job the cloud made, in order: an attempt asked again adds none. */
  jobs(): Job[]
  /** The full jobs it made. */
  fullJobs(): Job[]
  /** Credits held by jobs still queued or running. */
  reserved(): number
  /** Credits taken by jobs that succeeded. */
  charged(): number
  /** The next `count` calls of one kind fail as `fault` says. */
  failNext(call: FakeCloudCall, count: number, fault: FakeFault): void
  /** The account's credits change (credits bought in the browser). */
  setAvailableCredits(credits: number): void
}

interface StoredJob {
  job: Job
  attemptId: string | undefined
  reads: number
  signatures: number
}

const NETWORK_DOWN = 'The network is down.'

/** The id of the n-th full job (1-based): the recorded one first, then made-up ones. */
function fullJobId(n: number): string {
  return n === 1 ? FULL_JOB_ID : `${FULL_JOB_ID.slice(0, -2)}${String(n).padStart(2, '0')}`
}

function errorAnswer(status: number, code: string, message: string): FakeAnswer {
  return { status, body: { error: { code, message } } }
}

export function createFakeCloud(options: FakeCloudOptions = {}): FakeCloud {
  const price = options.price ?? QUOTE.costCredits
  const reservedCredits = options.reservedCredits ?? price
  const reads = options.reads ?? ['running', 'succeeded']
  let availableCredits = options.availableCredits ?? QUOTE.availableCredits
  const stored = new Map<string, StoredJob>()
  const order: string[] = []
  const attempts = new Map<string, string>()
  const faults = new Map<FakeCloudCall, FakeFault[]>()

  /** The next fault of one kind of call, if one is queued. */
  function takeFault(call: FakeCloudCall): FakeFault | undefined {
    return faults.get(call)?.shift()
  }

  /** Applies a fault that acts before the cloud does; the answer to give instead, if any. */
  function before(fault: FakeFault | undefined): FakeAnswer | null {
    if (fault?.kind === 'lost-request') throw new Error(NETWORK_DOWN)
    if (fault?.kind === 'status') {
      return errorAnswer(fault.status, fault.code ?? 'internal', fault.message ?? 'Server error.')
    }
    return null
  }

  /** Applies a fault that acts after the cloud did: the answer is lost on its way back. */
  function after(fault: FakeFault | undefined): void {
    if (fault?.kind === 'lost-answer') throw new Error(NETWORK_DOWN)
  }

  function signedResult(entry: StoredJob): Job['result'] {
    entry.signatures += 1
    return {
      url: `https://storage.test/results/${entry.job.id}/cleaned.mp4?X-Amz-Signature=read${entry.signatures}`,
      expiresAt: '2026-11-18T10:50:00.000Z',
      availableUntil: '2026-12-18T09:50:00.000Z',
    }
  }

  function makeJob(request: CreateJobRequest): StoredJob {
    if (request.kind === 'track') {
      return { job: { ...TRACK_JOB }, attemptId: request.attemptId, reads: 0, signatures: 0 }
    }
    const id = fullJobId(order.filter((jobId) => stored.get(jobId)?.job.kind === 'full').length + 1)
    const job: Job = {
      ...FULL_JOB,
      id,
      status: 'queued',
      progress: 0,
      uploadId: request.uploadId,
      segments: request.segments ?? null,
      cost: { reservedCredits, chargedCredits: 0 },
    }
    return { job, attemptId: request.attemptId, reads: 0, signatures: 0 }
  }

  function createJob(request: CreateJobRequest): FakeAnswer {
    const earlierId = request.attemptId ? attempts.get(request.attemptId) : undefined
    const earlier = earlierId ? stored.get(earlierId) : undefined
    if (earlier) {
      if (earlier.job.uploadId !== request.uploadId || earlier.job.kind !== request.kind) {
        return errorAnswer(
          409,
          'conflict',
          'This attempt already made another job. Please try again.',
        )
      }
      return { status: 201, body: earlier.job }
    }
    const entry = makeJob(request)
    stored.set(entry.job.id, entry)
    if (!order.includes(entry.job.id)) order.push(entry.job.id)
    if (request.attemptId) attempts.set(request.attemptId, entry.job.id)
    return { status: 201, body: entry.job }
  }

  /** A full job moved on to `status`, as the engine reports it. */
  function advanced(job: Job, status: JobStatus): Job {
    const succeeded = status === 'succeeded'
    return {
      ...job,
      status,
      stage: succeeded ? 'done' : 'removing',
      progress: succeeded ? 1 : 0.7,
      cost: succeeded ? { ...job.cost, chargedCredits: job.cost.reservedCredits } : job.cost,
      error:
        status === 'failed'
          ? { code: 'engine_failed', message: 'The engine could not follow the shadow.' }
          : null,
    }
  }

  function readJob(jobId: string): FakeAnswer {
    const entry = stored.get(jobId)
    if (!entry) return errorAnswer(404, 'not_found', 'This job does not exist.')
    const running = entry.job.status === 'queued' || entry.job.status === 'running'
    if (entry.job.kind === 'full' && running) {
      entry.job = advanced(entry.job, reads[Math.min(entry.reads, reads.length - 1)] ?? 'succeeded')
      entry.reads += 1
    }
    if (entry.job.status === 'succeeded' && entry.job.kind === 'full') {
      entry.job = { ...entry.job, result: signedResult(entry) }
    }
    return { body: entry.job }
  }

  function cancelJob(jobId: string): FakeAnswer {
    const entry = stored.get(jobId)
    if (!entry) return errorAnswer(404, 'not_found', 'This job does not exist.')
    if (entry.job.status !== 'queued' && entry.job.status !== 'running') {
      return errorAnswer(409, 'conflict', `This job is already ${entry.job.status}.`)
    }
    entry.job = { ...entry.job, status: 'canceled' }
    return { body: entry.job }
  }

  const upload: Upload = { ...UPLOAD, createdAt: options.uploadCreatedAt ?? UPLOAD.createdAt }

  const server = createFakeServer([
    {
      method: 'POST',
      path: '/v1/uploads',
      respond: () => before(takeFault('upload')) ?? { body: UPLOAD_TICKET },
    },
    { method: 'PUT', path: `/uploads/${UPLOAD_ID}/piece.mp4`, respond: () => ({ body: {} }) },
    {
      method: 'POST',
      path: `/v1/uploads/${UPLOAD_ID}/complete`,
      respond: () => ({ body: upload }),
    },
    {
      method: 'POST',
      path: '/v1/jobs/quote',
      respond: () =>
        before(takeFault('quote')) ?? {
          body: {
            ...QUOTE,
            costCredits: price,
            availableCredits,
            enough: availableCredits >= price,
          },
        },
    },
    {
      method: 'POST',
      path: '/v1/jobs',
      respond: (call) => {
        const fault = takeFault('createJob')
        const refused = before(fault)
        if (refused) return refused
        const answer = createJob(call.body as CreateJobRequest)
        after(fault)
        return answer
      },
    },
    {
      method: 'GET',
      path: /^\/v1\/jobs\/[^/]+\/track$/,
      respond: () => ({ body: TRACK_DATA }),
    },
    {
      method: 'POST',
      path: /^\/v1\/jobs\/[^/]+\/cancel$/,
      respond: (call) => {
        const fault = takeFault('cancelJob')
        const refused = before(fault)
        if (refused) return refused
        const answer = cancelJob(decodeURIComponent(call.path.split('/')[3] ?? ''))
        after(fault)
        return answer
      },
    },
    {
      method: 'GET',
      path: /^\/v1\/jobs\/[^/]+$/,
      respond: (call) => {
        const fault = takeFault('getJob')
        const refused = before(fault)
        if (refused) return refused
        const answer = readJob(decodeURIComponent(call.path.split('/')[3] ?? ''))
        after(fault)
        return answer
      },
    },
    {
      method: 'GET',
      path: /^\/results\/[^/]+\/cleaned\.mp4$/,
      respond: () => {
        const refused = before(takeFault('download'))
        if (refused) return refused
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
              controller.close()
            },
          }),
          { headers: { 'content-type': 'video/mp4', 'content-length': '8' } },
        )
      },
    },
    { method: 'GET', path: '/v1/config', respond: () => ({ body: CONFIG }) },
  ])

  const all = () => order.map((id) => stored.get(id)!.job)
  return {
    server,
    jobs: all,
    fullJobs: () => all().filter((job) => job.kind === 'full'),
    reserved: () =>
      all()
        .filter((job) => job.status === 'queued' || job.status === 'running')
        .reduce((sum, job) => sum + job.cost.reservedCredits, 0),
    charged: () => all().reduce((sum, job) => sum + job.cost.chargedCredits, 0),
    failNext(call, count, fault) {
      const queue = faults.get(call) ?? []
      for (let index = 0; index < count; index++) queue.push(fault)
      faults.set(call, queue)
    },
    setAvailableCredits(credits) {
      availableCredits = credits
    },
  }
}
