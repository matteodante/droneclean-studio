/**
 * The DroneClean API's shapes, as the editor sees them.
 *
 * Hand-written from the cloud's contract (`cloud/packages/shared/src/schemas.ts`) so the editor
 * and the API agree field by field, without an import across the two code bases: the cloud is a
 * separate product with its own build. Every shape here is what goes over the wire; the comments
 * keep the API's own wording where the meaning is not obvious (`endSeconds` excluded, what
 * `attemptId` answers). Nothing validates an answer at runtime, but a test does keep these types
 * and the recorded answers honest: `contract.test.ts` compares each one with
 * `contract-snapshot.json`, the cloud's zod schemas as JSON Schema, which
 * `checks/shadow-contract-snapshot.mjs` writes when the cloud's contract changes. A type edited
 * here that no longer matches the snapshot stops `check:quick`; a contract that moved on is
 * noticed by running the script and reading its diff.
 */

/** The one transport the client uses: the shell's `fetch`, or a recorded one in the tests. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

// ---------------------------------------------------------------------------
// Errors

/**
 * A call that failed: the HTTP status (0 when the server could not be reached) and the API's own
 * code and message. The message can be shown to people as it is, as the cloud's `ApiError` is
 * (`cloud/packages/shared/src/errors.ts`).
 */
export class DroneCleanApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'DroneCleanApiError'
    this.status = status
    this.code = code
  }
}

/**
 * The session is gone: the API answered 401. The client has deleted the stored token, so the
 * panel must ask the pilot to sign in again (design 4.1, section 5.1: no refresh, the sign-in
 * lasts 60 days).
 */
export class SignInRequiredError extends DroneCleanApiError {
  constructor(message: string) {
    super(401, 'unauthorized', message)
    this.name = 'SignInRequiredError'
  }
}

/**
 * The device sign-in ended without a token: the code expired, the pilot denied it on the website,
 * or the API refused the client. `code` is the RFC 8628 code the API sent (`expired_token`,
 * `access_denied`, `invalid_grant`, ...), so the panel can say which and offer "Start again".
 */
export class DeviceSignInError extends DroneCleanApiError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message)
    this.name = 'DeviceSignInError'
  }
}

/** Body of every `/v1/*` error response: `{ "error": { "code": "...", "message": "..." } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string }
}

/** What a call stopped with its `AbortSignal` rejects with: an error named `AbortError`. */
export function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('Stopped.', 'AbortError')
  const error = new Error('Stopped.')
  error.name = 'AbortError'
  return error
}

// ---------------------------------------------------------------------------
// Signing in with a device code (RFC 8628, Better Auth's device-authorization plugin). These
// routes speak the RFC's snake_case, unlike every `/v1/*` route.

/** `POST /api/auth/device/code`: the code the editor shows and polls. */
export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

/** `POST /api/auth/device/token` once the code is approved. */
export interface DeviceTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

/** `POST /api/auth/device/token` while it is not: `authorization_pending`, `slow_down`, `expired_token`, ... */
export interface DeviceErrorResponse {
  error: string
  error_description?: string
}

// ---------------------------------------------------------------------------
// Videos and uploads

/**
 * Where an uploaded piece comes from (design 4.1, section 5.2): only the seconds around the shadow
 * are uploaded, cut from the original without re-encoding; the original stays on the device.
 */
export interface PieceSource {
  /** The original's file name. */
  fileName: string
  /** When the piece starts on the original's timeline, in seconds. */
  startSeconds: number
  /** The original's length, in seconds. */
  durationSeconds: number
  /** The original's size in bytes. */
  sizeBytes: number
}

/** A video to upload, described before the upload. Dimensions are in displayed pixels. */
export interface VideoMeta {
  fileName: string
  /** A `video/` type. */
  contentType: string
  sizeBytes: number
  durationSeconds: number
  width: number
  height: number
  /** Frames per second; the API measures it after the upload and prices by its own probe. */
  frameRate?: number
  /** A piece: where it sits in the original clip. Absent for a whole clip. */
  source?: PieceSource
  /** The longest stretch between two points a decoder can start on, in seconds (unknown: 1 s). */
  entryGapSeconds?: number
}

export type UploadStatus = 'pending' | 'uploaded'

/** `POST /v1/uploads` and `POST /v1/uploads/parts`: one upload, described. */
export interface Upload {
  id: string
  status: UploadStatus
  video: VideoMeta
  createdAt: string
}

/** `POST /v1/uploads`: a short-lived, pre-signed URL the video bytes are PUT to. */
export interface UploadTicket {
  uploadId: string
  method: 'PUT'
  url: string
  /** Headers the PUT must carry (the signed content type). */
  headers: Record<string, string>
  expiresAt: string
}

/** `POST /v1/uploads/parts`: a video sent in `partCount` parts of `partSizeBytes` (the last shorter). */
export interface PartsTicket {
  uploadId: string
  partSizeBytes: number
  partCount: number
}

/** One part's PUT URL, signed for an hour. */
export interface SignedPart {
  /** Numbered from 1; part n holds the bytes from (n - 1) x `partSizeBytes`. */
  partNumber: number
  url: string
  headers: Record<string, string>
}

/** `POST /v1/uploads/{id}/parts`: URLs for some of the parts. */
export interface SignedParts {
  parts: SignedPart[]
  expiresAt: string
}

/** `DELETE /v1/uploads/{id}`: an upload not completed is dropped, with the parts that arrived. */
export interface DeleteUploadResult {
  deleted: true
}

// ---------------------------------------------------------------------------
// Jobs

/** `full`: the ranges to clean, paid; `preview`: free, a few seconds; `track`: free, the shadow followed. */
export type JobKind = 'full' | 'preview' | 'track'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

/** Engine steps, in order: tracking the shadow, repainting it, blending, encoding the file. */
export type JobStage = 'waiting' | 'tracking' | 'removing' | 'blending' | 'encoding' | 'done'

export type ExportQuality = 'standard' | 'maximum'

/** One in `outputStep` of the clip's frames is kept: 1 is the clip's own rate. */
export type OutputStep = 1 | 2 | 4 | 8

/** Where the drone's shadow is: one point on it, the moment it was picked, and its rough size. */
export interface ShadowClick {
  /** Horizontal position in video pixels. */
  x: number
  /** Vertical position in video pixels. */
  y: number
  /** Time of the frame where the point was picked, in seconds from the start of the upload. */
  timeSeconds: number
  /** Radius of a circle that covers the whole shadow, in video pixels. */
  radius: number
}

/**
 * A stretch of the upload where the shadow is removed and the point the tracker starts from. The
 * shadow is removed only inside the range; the frames outside are copied as they are.
 */
export interface Segment {
  startSeconds: number
  /** Excluded: a range [start, end). */
  endSeconds: number
  /** A point on the shadow on a frame inside the range. */
  anchor: ShadowClick
  /** The tracking passes the range comes from, reused instead of tracking again. */
  trackJobIds?: string[]
}

/** The parts of a job's options the editor sends; the engine's defaults are left out. */
export interface JobOptions {
  harmonize?: boolean
  /** Largest shadow motion between two frames, in video pixels. */
  motion?: number
  quality?: ExportQuality
  /** An export's step: how many of the clip's frames it keeps one of. */
  outputStep?: OutputStep
}

/**
 * A job's options as every answer shows them: the API has applied its defaults, so these three are
 * always there. `outputStep` is left out of an export made before 10 Oct 2026 and of a preview or
 * a tracking pass.
 */
export interface JobSettings {
  harmonize: boolean
  motion: number
  quality: ExportQuality
  outputStep?: OutputStep
}

/** `POST /v1/jobs`: what the editor sends (the API applies its defaults). */
export interface CreateJobRequest {
  uploadId: string
  click?: ShadowClick
  /** A full job's ranges; without them it cleans the whole upload. */
  segments?: Segment[]
  options?: JobOptions
  kind?: JobKind
  /** A preview: the tracking passes of the range it shows. */
  trackJobIds?: string[]
  /**
   * The client's id for this attempt: the API makes one job per account and attempt, so the same
   * request sent again after its answer was lost returns the same job, never a second one charged.
   */
  attemptId?: string
}

/** Where to preview and download the cleaned file (a pre-signed URL that expires). */
export interface JobResult {
  url: string
  /** When this URL stops working (a fresh one comes with every read of the job). */
  expiresAt: string | null
  /** When the file itself is deleted from storage (results are kept 30 days). */
  availableUntil: string | null
}

export interface JobError {
  code: string
  message: string
}

/** A stretch of the upload, in seconds from its start (`endSeconds` excluded). */
export interface TimeRange {
  startSeconds: number
  endSeconds: number
}

/** What a finished `track` job says in the job itself: where the shadow was found. */
export interface TrackSummary {
  /** Frames per second of the uploaded clip, as the engine read it. */
  fps: number
  /** Frames in the uploaded clip. */
  frames: number
  /** Where the shadow was found, in order (empty: not found from that tap). */
  ranges: TimeRange[]
  /** Whether the shadow is still there at the first or the last frame of the upload. */
  continues?: { before: boolean; after: boolean }
}

/** One tracked frame: its index in the upload, the centre of the shadow and its radius, in pixels. */
export type Keyframe = [frame: number, x: number, y: number, radius: number]

/** `GET /v1/jobs/{id}/track`: the shadow's position and size on every frame where it was found. */
export interface TrackData {
  fps: number
  frames: number
  /** The upload's size in the frame's pixels (the keyframes' coordinate space). */
  width: number
  height: number
  /** Sorted by frame index. */
  keyframes: Keyframe[]
}

/** Where a preview's few seconds sit in the uploaded clip. */
export interface PreviewWindow {
  startSeconds: number
  durationSeconds: number
}

/** A job, as `POST /v1/jobs` and every read of it answer. */
export interface Job {
  id: string
  kind: JobKind
  status: JobStatus
  stage: JobStage
  /** 0 to 1. */
  progress: number
  createdAt: string
  updatedAt: string
  uploadId: string
  video: VideoMeta
  click: ShadowClick
  /** Full jobs: the ranges cleaned, or null for the whole upload. */
  segments: Segment[] | null
  options: JobSettings
  cost: {
    /** Credits held when the job is created (0 for previews and tracks, which are free). */
    reservedCredits: number
    /** Taken when the job succeeds; a failed or canceled job gives the reserved credits back. */
    chargedCredits: number
  }
  result: JobResult | null
  /** The original upload of a full job, to compare with the result; kept 7 days, then null. */
  input: JobResult | null
  error: JobError | null
  /** Previews only: the cleaned window. */
  preview: PreviewWindow | null
  /** Tracks only, once done: where the shadow was found (the keyframes are a separate call). */
  track: TrackSummary | null
  /** Full jobs, once done: the samples of the result the engine re-encoded, [start, end) in decode order. */
  spliced: [number, number][] | null
}

/** `DELETE /v1/jobs/{id}`: the job is gone and its file from storage. */
export interface DeleteJobResult {
  deleted: true
}

/** What a price may depend on: the export's quality and step. */
export interface JobQuoteOptions {
  quality?: ExportQuality
  outputStep?: OutputStep
}

/**
 * `POST /v1/jobs/quote`: what a full job would reserve, before it is created (design 4.1,
 * decision 2). The upload prices it by the frame rate the server probed, or, before uploading,
 * the piece's own `fps`; without ranges the whole upload is priced, so ranges are required
 * without an upload.
 */
export type JobQuoteRequest = {
  segments?: Segment[]
  options?: JobQuoteOptions
} & ({ uploadId: string; fps?: never } | { fps: number; uploadId?: never; segments: Segment[] })

/** `POST /v1/jobs/quote`: what the job costs now, and whether the balance covers it. */
export interface JobQuote {
  /** Seconds of shadow it would remove: the ranges' seconds, or the whole upload's. */
  seconds: number
  /** Credits for one second, by the frame rate and the export's choice. */
  creditsPerSecond: number
  /** What the job would reserve, in credits. */
  costCredits: number
  /** The least a job costs, for a job shorter than that. */
  minimumCredits: number
  /** The account's credits available to spend now. */
  availableCredits: number
  /** Whether the balance covers the job. */
  enough: boolean
}

// ---------------------------------------------------------------------------
// The account and the server's settings

/** Credits available to spend, and held by jobs that have not finished. */
export interface CreditBalance {
  availableCredits: number
  reservedCredits: number
}

/** `GET /v1/me`: who is signed in, the balance and the settings. */
export interface Account {
  user: {
    id: string
    email: string | null
    name: string | null
    image: string | null
    /** Can make coupons. */
    admin: boolean
    /** A creator of the creator program; absent from an older API. */
    creator?: boolean
  }
  balance: CreditBalance
  /** The welcome credits were paused by the free beta's daily limits; absent from an older API. */
  welcomePaused?: boolean
  settings: {
    /** Uploaded clips, marks and results may be used to train our models. */
    trainingAllowed: boolean
  }
}

/** `GET /v1/config`: what this server offers (no secrets), so the editor shows only what works. */
export interface ServiceConfig {
  /** The engine follows and removes the shadow (false while no GPU is deployed). */
  engine: boolean
  auth: { google: boolean; apple: boolean; appleNative: boolean; devPassword: boolean }
  payments: {
    apple: boolean
    /** Stripe's embedded checkout; null while it is not set up. */
    stripe: { publishableKey: string; managedPayments: boolean } | null
  }
  preview: { seconds: number; perUpload: number; perDay: number }
  track: { perUpload: number; perDay: number }
  /** The free beta: nothing can be bought, credits are asked for instead. */
  freeBeta: boolean
  /** The credits a new account gets once. */
  welcomeCredits?: number
}
