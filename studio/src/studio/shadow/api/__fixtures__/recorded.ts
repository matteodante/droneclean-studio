/**
 * The API answers the tests replay: the shapes are the cloud's own (commit 628004889;
 * `cloud/packages/shared/src/schemas.ts` and the API's tests, `services/api/test/auth-device.test.ts`,
 * `jobs.test.ts`, `uploads.test.ts`), filled with the numbers of clip 0020's 10.01 s piece
 * (design 4.1, sections 5.2 and 6). Nothing here was captured from a live call: the tests never
 * reach the network, and no request left this Mac.
 */
import type {
  Account,
  DeviceCodeResponse,
  DeviceErrorResponse,
  DeviceTokenResponse,
  Job,
  JobQuote,
  Keyframe,
  PartsTicket,
  ServiceConfig,
  SignedParts,
  TrackData,
  TrackSummary,
  Upload,
  UploadTicket,
  VideoMeta,
} from '../types'

/** Clip 0020, as the editor has it (design 4.1, section 6, `ffprobe`). */
export const ORIGINAL = {
  fileName: 'DJI_20261115124704_0020_D.mp4',
  durationSeconds: 230.88065,
  sizeBytes: 3_764_360_098,
} as const

/**
 * The piece of it the editor cut and uploaded: 10.01 s from 60.06 s, six hundred frames at
 * 60000/1001, 162,505,440 bytes, byte-identical to `ffmpeg -c copy` on the same window.
 */
export const VIDEO: VideoMeta = {
  fileName: ORIGINAL.fileName,
  contentType: 'video/mp4',
  sizeBytes: 162_505_440,
  durationSeconds: 10.01,
  width: 3840,
  height: 2880,
  frameRate: 59.94,
  source: {
    fileName: ORIGINAL.fileName,
    startSeconds: 60.06,
    durationSeconds: ORIGINAL.durationSeconds,
    sizeBytes: ORIGINAL.sizeBytes,
  },
}

// ---------------------------------------------------------------------------
// Signing in: `cloud/services/api/test/auth-device.test.ts` (code, token and the RFC's errors).

export const DEVICE_CODE: DeviceCodeResponse = {
  device_code: 'Yt3kQ2mZ8bV4nR7xL1pW6cJ9hS5dF0gA2eK8uT4i',
  user_code: 'ABCD2345',
  verification_uri: 'https://droneclean.app/device',
  verification_uri_complete: 'https://droneclean.app/device?user_code=ABCD2345',
  expires_in: 1800,
  interval: 5,
}

/** The approval's answer: Better Auth's session token as a bearer token, 60 days minus a second. */
export const DEVICE_TOKEN: DeviceTokenResponse = {
  access_token: 'fixture-access-token-not-a-real-session-000',
  token_type: 'Bearer',
  expires_in: 5_183_999,
  scope: '',
}

function deviceError(error: string, error_description: string): DeviceErrorResponse {
  return { error, error_description }
}

export const DEVICE_PENDING = deviceError('authorization_pending', 'Authorization pending')
export const DEVICE_SLOW_DOWN = deviceError('slow_down', 'Polling too frequently')
export const DEVICE_EXPIRED = deviceError('expired_token', 'Device code has expired')
export const DEVICE_DENIED = deviceError('access_denied', 'Access denied')

// ---------------------------------------------------------------------------
// Uploads

export const UPLOAD_ID = '2f1c9a44-0b3d-4e71-9a55-6d0c8e2b7f10'

export const UPLOAD_TICKET: UploadTicket = {
  uploadId: UPLOAD_ID,
  method: 'PUT',
  url: `https://storage.test/uploads/${UPLOAD_ID}/piece.mp4?X-Amz-Signature=5d4e3c2b1a`,
  headers: { 'content-type': 'video/mp4' },
  expiresAt: '2026-11-18T10:15:00.000Z',
}

/** Ten parts of 16 MiB for the measured 162,505,440 bytes (`partSizeFor` in the API). */
export const PARTS_TICKET: PartsTicket = {
  uploadId: UPLOAD_ID,
  partSizeBytes: 16_777_216,
  partCount: 10,
}

export function signedPart(partNumber: number, uploadId = UPLOAD_ID) {
  return {
    partNumber,
    url: `https://storage.test/uploads/${uploadId}/part${partNumber}?X-Amz-Signature=part`,
    headers: {},
  }
}

export const SIGNED_PARTS: SignedParts = {
  parts: [signedPart(1)],
  expiresAt: '2026-11-18T10:45:00.000Z',
}

export const UPLOAD: Upload = {
  id: UPLOAD_ID,
  status: 'uploaded',
  video: VIDEO,
  createdAt: '2026-11-18T09:41:07.000Z',
}

export const DELETE_UPLOAD = { deleted: true } as const

// ---------------------------------------------------------------------------
// Jobs and their tracking pass. The keyframes are the tracked frames of the piece: piece frame
// `j` is source frame 3600 + j, because the piece starts on source frame 3600 (60.06 s at
// 60000/1001). The ranges are what the engine's own rule (`trackRanges`) makes of them: runs of
// found frames joined across gaps of at most 8 frames, edges as `frame / fps`.

const TRACK_FPS = 60000 / 1001

/** Every frame of the two runs where the shadow was followed, with its centre and radius. */
const FOUND = [
  [30, 1860.25, 2410.5, 96.5],
  [31, 1861, 2411, 96.6],
  [32, 1861.75, 2411.5, 96.7],
  [33, 1862.5, 2412, 96.8],
  [34, 1863.25, 2412.5, 96.9],
  [35, 1864, 2413, 97],
  [36, 1864.75, 2413.5, 97.1],
  [37, 1865.5, 2414, 97.2],
  [38, 1866.25, 2414.5, 97.3],
  [39, 1867, 2415, 97.4],
  [40, 1867.75, 2415.5, 97.5],
  [41, 1868.5, 2416, 97.6],
  [42, 1869.25, 2416.5, 97.7],
  [43, 1870, 2417, 97.8],
  [44, 1870.75, 2417.5, 97.9],
  [45, 1871.5, 2418, 98],
  [46, 1872.25, 2418.5, 98.1],
  [47, 1873, 2419, 98.2],
  [48, 1873.75, 2419.5, 98.3],
  [49, 1874.5, 2420, 98.4],
  [50, 1875.25, 2420.5, 98.5],
  [51, 1876, 2421, 98.6],
  [52, 1876.75, 2421.5, 98.7],
  [53, 1877.5, 2422, 98.8],
  [54, 1878.25, 2422.5, 98.9],
  [55, 1879, 2423, 99],
  [56, 1879.75, 2423.5, 99.1],
  [57, 1880.5, 2424, 99.2],
  [58, 1881.25, 2424.5, 99.3],
  [59, 1882, 2425, 99.4],
  [90, 1882.75, 2425.5, 99.5],
  [91, 1883.5, 2426, 99.6],
  [92, 1884.25, 2426.5, 99.7],
  [93, 1885, 2427, 99.8],
  [94, 1885.75, 2427.5, 99.9],
  [95, 1886.5, 2428, 100],
  [96, 1887.25, 2428.5, 100.1],
  [97, 1888, 2429, 100.2],
  [98, 1888.75, 2429.5, 100.3],
  [99, 1889.5, 2430, 100.4],
] as const

/** `GET /v1/jobs/{id}/track` for the piece: the keyframes in the upload's own frames. */
export const TRACK_DATA: TrackData = {
  fps: TRACK_FPS,
  frames: 600,
  width: 3840,
  height: 2880,
  keyframes: FOUND.map(([frame, x, y, radius]): Keyframe => [frame, x, y, radius]),
}

/** The job's own summary: the two runs as seconds of the upload (`frame / fps`, `(frame + 1) / fps`). */
export const TRACK_SUMMARY: TrackSummary = {
  fps: TRACK_FPS,
  frames: 600,
  ranges: [
    { startSeconds: 30 / TRACK_FPS, endSeconds: 60 / TRACK_FPS },
    { startSeconds: 90 / TRACK_FPS, endSeconds: 100 / TRACK_FPS },
  ],
  continues: { before: false, after: false },
}

export const TRACK_JOB_ID = '7d0f2c1e-5a6b-4c8d-9e0f-1a2b3c4d5e6f'

export const TRACK_JOB: Job = {
  id: TRACK_JOB_ID,
  kind: 'track',
  status: 'succeeded',
  stage: 'done',
  progress: 1,
  createdAt: '2026-11-18T09:42:00.000Z',
  updatedAt: '2026-11-18T09:42:31.000Z',
  uploadId: UPLOAD_ID,
  video: VIDEO,
  click: { x: 1860.25, y: 2410.5, timeSeconds: 30 / TRACK_FPS, radius: 96.5 },
  segments: null,
  options: { harmonize: true, motion: 30, quality: 'standard' },
  // The 10.01 s piece at 59.94 fps, a credit a second at 30 fps (contract 5): 20, kept since it found the shadow.
  cost: { reservedCredits: 20, chargedCredits: 20 },
  result: {
    url: `https://storage.test/results/${TRACK_JOB_ID}/keyframes.json?X-Amz-Signature=1f2e3d`,
    expiresAt: '2026-11-18T10:42:31.000Z',
    availableUntil: '2026-12-18T09:42:31.000Z',
  },
  input: null,
  error: null,
  preview: null,
  track: TRACK_SUMMARY,
  spliced: null,
}

export const FULL_JOB_ID = '5c6d7e8f-90a1-4b2c-8d3e-4f5061728394'

/**
 * A full job still running on the one range the editorial passes the price guard on: 30 frames of
 * the piece, shorter than the 10-credit minimum, so it reserves 10 credits (the cloud's
 * `jobs.test.ts`, "costs the minimum for a piece shorter than it").
 */
export const FULL_JOB: Job = {
  id: FULL_JOB_ID,
  kind: 'full',
  status: 'running',
  stage: 'removing',
  progress: 0.42,
  createdAt: '2026-11-18T09:50:00.000Z',
  updatedAt: '2026-11-18T09:50:12.000Z',
  uploadId: UPLOAD_ID,
  video: VIDEO,
  click: { x: 1871.5, y: 2418, timeSeconds: 45 / TRACK_FPS, radius: 98 },
  segments: [
    {
      startSeconds: 30 / TRACK_FPS,
      endSeconds: 60 / TRACK_FPS,
      anchor: { x: 1871.5, y: 2418, timeSeconds: 45 / TRACK_FPS, radius: 98 },
      trackJobIds: [TRACK_JOB_ID],
    },
  ],
  options: { harmonize: true, motion: 30, quality: 'standard', outputStep: 1 },
  cost: { reservedCredits: 10, chargedCredits: 0 },
  result: null,
  input: {
    url: `https://storage.test/uploads/${UPLOAD_ID}/piece.mp4?X-Amz-Signature=input`,
    expiresAt: '2026-11-18T10:50:00.000Z',
    availableUntil: '2026-11-25T09:40:00.000Z',
  },
  error: null,
  preview: null,
  track: null,
  spliced: null,
}

export const DELETE_JOB = { deleted: true } as const

/** `POST /v1/jobs/quote`: three seconds of the piece at the 59.94 band's 15 credits a second. */
export const QUOTE: JobQuote = {
  seconds: 3,
  creditsPerSecond: 15,
  costCredits: 45,
  minimumCredits: 10,
  availableCredits: 1200,
  enough: true,
}

// ---------------------------------------------------------------------------
// The account and the server's settings

export const ACCOUNT: Account = {
  user: {
    id: 'kR2m9Qx4Tb7',
    email: 'pilot@example.com',
    name: 'Pilot',
    image: null,
    admin: false,
  },
  balance: { availableCredits: 1200, reservedCredits: 10 },
  settings: { trainingAllowed: true },
}

/** `GET /v1/config` during the free beta (`cloud/services/api/test/beta.test.ts`). */
export const CONFIG: ServiceConfig = {
  engine: true,
  auth: { google: true, apple: false, appleNative: false, devPassword: false },
  payments: { apple: false, stripe: null },
  preview: { seconds: 3, perUpload: 3, perDay: 20, credits: { standard: 30, maximum: 45 } },
  track: { perUpload: 12, perDay: 60, credits: { perSecond: 1, minimum: 5 } },
  freeBeta: true,
  welcomeCredits: 600,
}
