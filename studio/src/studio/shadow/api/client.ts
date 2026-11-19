/**
 * The typed client of the DroneClean cloud API: one function per call the editor makes, over an
 * injected `fetch` and token (design 4.1, section 7, slice E3).
 *
 * Every `/v1/*` call carries `Authorization: Bearer <token>` and `x-droneclean-contract: 4`, the
 * version of the API's contract this client speaks (`cloud/packages/shared/src/constants.ts`): an
 * older client is refused before it can spend credits on an answer it cannot read. A 401 means the
 * session is gone: the token is deleted from the session and the call throws `SignInRequiredError`,
 * which the panel shows as "sign in again". Every other failure is a `DroneCleanApiError` with the
 * API's own code and message, ready to show. The client takes its `fetch`, its token store and its
 * way of opening the browser from the shell, so the web editor and the desktop app share this one
 * module (design 4.1, section 5.1).
 *
 * Sign-in is the RFC 8628 device flow (`device.ts`); the calls are the ones the cloud already
 * serves for pieces: `POST /v1/uploads/parts` with parts, or one PUT, then `POST /v1/jobs`, reads
 * of the job and its tracking pass, `POST /v1/jobs/quote` for the price, and the result's download.
 */
import { beginDeviceSignIn, type DeviceSignIn } from './device'
import { downloadResult, type DownloadOptions } from './download'
import type { DroneCleanSession } from './session'
import {
  DroneCleanApiError,
  SignInRequiredError,
  type Account,
  type ApiErrorBody,
  type CreateJobRequest,
  type DeleteJobResult,
  type DeleteUploadResult,
  type FetchLike,
  type Job,
  type JobQuote,
  type JobQuoteRequest,
  type PartsTicket,
  type ServiceConfig,
  type SignedParts,
  type TrackData,
  type Upload,
  type UploadTicket,
  type VideoMeta,
} from './types'
import { uploadPiece, type UploadApi, type UploadOptions } from './uploads'

/** The version of the API's contract this client speaks, sent with every `/v1/*` request. */
const API_CONTRACT = 4
const API_CONTRACT_HEADER = 'x-droneclean-contract'

const NETWORK_MESSAGE = 'Could not reach DroneClean. Check your connection.'

/** What the client needs from the shell it runs in. */
export interface DroneCleanClientOptions {
  /** The API's origin, without a trailing slash: `https://droneclean.app` (the site passes both `/v1/*` and `/api/auth/*` on to it). */
  baseUrl: string
  /** The shell's `fetch`; the tests pass the recorded server. */
  fetch: FetchLike
  /** Where the bearer token is kept: `sessionStorage` on the web, the main process on the desktop. */
  session: DroneCleanSession
  /** Opens the browser at the website's `/device` page with the code filled in (`shell.openExternal`, `window.open`). */
  openUrl: (url: string) => void | Promise<void>
}

/** Every call the editor makes, typed, with no UI and no React. */
export interface DroneCleanClient {
  readonly baseUrl: string
  /** Asks for a device code, opens the browser on it, and polls until it is approved (then stores the token). */
  startSignIn(): Promise<DeviceSignIn>
  /** `GET /v1/me`: who is signed in and the credits (the balance is `account.balance.availableCredits`). */
  getAccount(): Promise<Account>
  /** `GET /v1/config`: whether the engine runs and whether the beta is free. */
  getConfig(): Promise<ServiceConfig>
  /** `POST /v1/uploads`: a signed PUT URL for a piece under the parts threshold. */
  createUpload(video: VideoMeta): Promise<UploadTicket>
  /** `POST /v1/uploads/parts`: a piece sent in parts, each with its own URL. */
  createPartsUpload(video: VideoMeta): Promise<PartsTicket>
  /** `POST /v1/uploads/{id}/parts`: PUT URLs for these parts (numbered from 1), signed for an hour. */
  signUploadParts(uploadId: string, partNumbers: number[]): Promise<SignedParts>
  /** `POST /v1/uploads/{id}/complete`: the API checks the file and measures it. */
  completeUpload(uploadId: string): Promise<Upload>
  /** `DELETE /v1/uploads/{id}`: drops an upload not completed, with the parts that arrived. */
  abortUpload(uploadId: string): Promise<DeleteUploadResult>
  /** A piece end to end: the video described, the bytes sent (one PUT or parts), the upload completed. */
  uploadPiece(body: Blob, video: VideoMeta, options?: UploadOptions): Promise<Upload>
  /** `POST /v1/jobs`: a full job over its ranges, a free preview, or a free tracking pass. */
  createJob(request: CreateJobRequest): Promise<Job>
  /** `GET /v1/jobs/{id}`: the job's state, its cost and, once it succeeded, its result. */
  getJob(jobId: string): Promise<Job>
  /** `GET /v1/jobs/{id}/track`: the keyframes of a finished tracking pass, in the upload's frames. */
  getTrack(jobId: string): Promise<TrackData>
  /** `POST /v1/jobs/{id}/cancel`: stops a job that has not finished; its reserved credits come back. */
  cancelJob(jobId: string): Promise<Job>
  /** `DELETE /v1/jobs/{id}`: removes a finished job and its file from storage. */
  deleteJob(jobId: string): Promise<DeleteJobResult>
  /**
   * `POST /v1/jobs/quote`: what a full job would reserve, before it is created, and whether the
   * balance covers it (design 4.1, decision 2). The same numbers the job's cost then holds.
   */
  quoteJob(request: JobQuoteRequest): Promise<JobQuote>
  /** `job.result.url` as one `Blob`, read in chunks (design 4.1, section 5.3). */
  downloadResult(url: string, options?: Omit<DownloadOptions, 'fetch'>): Promise<Blob>
}

/** A JSON body, or undefined for one that is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** The API's `{ error: { code, message } }` body, when the answer carried one. */
function apiErrorBody(json: unknown): ApiErrorBody['error'] | null {
  const body = json as Partial<ApiErrorBody> | undefined
  const error = body?.error
  return error && typeof error.code === 'string' && typeof error.message === 'string' ? error : null
}

/** A failed call with whatever the API said: its own code and message, or a plain status. */
function failure(status: number, error: ApiErrorBody['error'] | null): DroneCleanApiError {
  return new DroneCleanApiError(
    status,
    error?.code ?? 'internal',
    error?.message ?? `The server answered with error ${status}.`,
  )
}

/** One request's answer and its body, with a lost network or a cut answer as a typed error. */
async function send(
  doFetch: FetchLike,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ response: Response; json: unknown }> {
  let response: Response
  try {
    response = await doFetch(url, init)
  } catch {
    throw new DroneCleanApiError(0, 'network_error', NETWORK_MESSAGE)
  }
  let text: string
  try {
    text = await response.text()
  } catch {
    // The answer was cut while it came in: the request may have been carried out, so the caller
    // retries only what is safe to repeat (a job sends its `attemptId`).
    throw new DroneCleanApiError(0, 'network_error', NETWORK_MESSAGE)
  }
  return { response, json: text ? parseJson(text) : undefined }
}

/** The headers of every `/v1/*` call: the contract, and the token when the pilot is signed in. */
async function callHeaders(session: DroneCleanSession): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    [API_CONTRACT_HEADER]: String(API_CONTRACT),
  }
  const token = await session.getToken()
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

export function createDroneCleanClient(options: DroneCleanClientOptions): DroneCleanClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const doFetch = options.fetch
  const session = options.session
  const id = (value: string) => encodeURIComponent(value)

  /** One JSON call to the API: the typed answer, and the typed failure the caller can show. */
  async function request<T>(
    path: string,
    init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {},
  ): Promise<T> {
    const headers = await callHeaders(session)
    let body: string | undefined
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.body)
    }
    const method = init.method ?? 'GET'
    const { response, json } = await send(doFetch, `${baseUrl}${path}`, { method, headers, body })
    const error = apiErrorBody(json)
    if (response.status === 401) {
      // The session expired or was revoked: forget it, so the panel asks for a new sign-in.
      await session.setToken(null)
      throw new SignInRequiredError(error?.message ?? 'Sign in to continue.')
    }
    if (!response.ok) throw failure(response.status, error)
    return json as T
  }

  const api: UploadApi = {
    createUpload: (video) => request('/v1/uploads', { method: 'POST', body: video }),
    createPartsUpload: (video) => request('/v1/uploads/parts', { method: 'POST', body: video }),
    signUploadParts: (uploadId, partNumbers) =>
      request(`/v1/uploads/${id(uploadId)}/parts`, { method: 'POST', body: { partNumbers } }),
    completeUpload: (uploadId) =>
      request(`/v1/uploads/${id(uploadId)}/complete`, { method: 'POST' }),
    abortUpload: (uploadId) => request(`/v1/uploads/${id(uploadId)}`, { method: 'DELETE' }),
  }

  return {
    baseUrl,
    async startSignIn() {
      const signIn = await beginDeviceSignIn({ baseUrl, fetch: doFetch })
      await options.openUrl(signIn.verificationUriComplete)
      return {
        ...signIn,
        waitForToken: async (waitOptions) => {
          const token = await signIn.waitForToken(waitOptions)
          await session.setToken(token.accessToken)
          return token
        },
      }
    },
    getAccount: () => request('/v1/me'),
    getConfig: () => request('/v1/config'),
    createUpload: api.createUpload,
    createPartsUpload: api.createPartsUpload,
    signUploadParts: api.signUploadParts,
    completeUpload: api.completeUpload,
    abortUpload: api.abortUpload,
    uploadPiece: (body, video, uploadOptions = {}) =>
      uploadPiece(api, body, video, { ...uploadOptions, fetch: doFetch }),
    createJob: (job) => request('/v1/jobs', { method: 'POST', body: job }),
    getJob: (jobId) => request(`/v1/jobs/${id(jobId)}`),
    getTrack: (jobId) => request(`/v1/jobs/${id(jobId)}/track`),
    cancelJob: (jobId) => request(`/v1/jobs/${id(jobId)}/cancel`, { method: 'POST' }),
    deleteJob: (jobId) => request(`/v1/jobs/${id(jobId)}`, { method: 'DELETE' }),
    quoteJob: (quote) => request('/v1/jobs/quote', { method: 'POST', body: quote }),
    downloadResult: (url, downloadOptions = {}) =>
      downloadResult(url, { ...downloadOptions, fetch: doFetch }),
  }
}
