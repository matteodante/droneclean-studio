/**
 * Signing the editor in with a device code (RFC 8628): the flow the cloud added for it
 * (design 4.1, section 5.1; `cloud/services/api/src/auth/device.ts`).
 *
 * The editor asks for a code, opens the website's `/device` page (the caller does, with
 * `verification_uri_complete`), shows the short `user_code`, and polls
 * `POST /api/auth/device/token` until the pilot approves it there. While nobody has approved,
 * the API answers `authorization_pending`; when the editor polls sooner than the `interval` it
 * asked for, `slow_down` (five seconds are added, as the RFC says); the code ends with
 * `expired_token` after 30 minutes or `access_denied` when the pilot refused it. The answer to the
 * approval is the session token the editor sends as `Authorization: Bearer`, not a cookie: the
 * same account, in both shells.
 *
 * These routes are Better Auth's, so they speak the RFC's snake_case; everything this module gives
 * the rest of the editor is camelCase like the `/v1/*` answers (`types.ts`).
 */
import {
  DeviceSignInError,
  abortError,
  type DeviceCodeResponse,
  type DeviceErrorResponse,
  type DeviceTokenResponse,
  type FetchLike,
} from './types'

/** The only client id the API gives a code to (`cloud/services/api/src/auth/device.ts`). */
const DEVICE_CLIENT_ID = 'droneclean-studio'

/** The grant type RFC 8628 defines for the token request. */
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

/** RFC 8628, section 3.5: `slow_down` adds five seconds to every later poll. */
const SLOW_DOWN_SECONDS = 5

const NETWORK_MESSAGE = 'Could not reach DroneClean. Check your connection.'

/** How the device flow reaches the API. */
export interface DeviceFlowOptions {
  /** The API's origin, without a trailing slash: droneclean.app, or the API's own address on the PC. */
  baseUrl: string
  fetch: FetchLike
  /**
   * How the poll waits between attempts. The tests pass a fake, so a pending code costs nothing;
   * the client leaves it out and the real timer waits.
   */
  sleep?: (ms: number) => Promise<void>
}

/** The token a completed sign-in gives: a Better Auth session, as a bearer token. */
export interface DeviceToken {
  accessToken: string
  tokenType: 'Bearer'
  /** How long the session lasts, in seconds (60 days, extended while it is used). */
  expiresInSeconds: number
  scope: string
}

/** A sign-in waiting for the pilot: the code to show, and the poll that ends it. */
export interface DeviceSignIn {
  /** The short code to show: eight characters, no 0, O, 1, I or L. */
  userCode: string
  /** The website's page with the code already filled in; the client opens it in the browser. */
  verificationUriComplete: string
  /** How long the code works, in seconds (30 minutes). */
  expiresInSeconds: number
  /** How often the API lets the editor poll, in seconds; a `slow_down` raises it. */
  intervalSeconds: number
  /**
   * Polls until the pilot approves the code, and resolves with the token. Rejects with a
   * `DeviceSignInError` when the code expired (`expired_token`), was denied (`access_denied`) or
   * the API refused it for another reason, and with an `AbortError` when `signal` stops it.
   */
  waitForToken(options?: { signal?: AbortSignal }): Promise<DeviceToken>
}

/** Parse a JSON body, or undefined for one that is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** One POST to the sign-in routes: the answer, its body parsed, a lost network as a typed error. */
async function post(
  options: DeviceFlowOptions,
  path: string,
  body: unknown,
): Promise<{ response: Response; json: unknown }> {
  let response: Response
  try {
    response = await options.fetch(`${options.baseUrl}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new DeviceSignInError(0, 'network_error', NETWORK_MESSAGE)
  }
  let text: string
  try {
    text = await response.text()
  } catch {
    throw new DeviceSignInError(0, 'network_error', NETWORK_MESSAGE)
  }
  return { response, json: text ? parseJson(text) : undefined }
}

/** What one poll of the token route answered: the token, the wait, or the end of the sign-in. */
type PollAnswer =
  | { kind: 'token'; token: DeviceToken }
  | { kind: 'pending' }
  | { kind: 'slow-down' }
  | { kind: 'failed'; error: DeviceSignInError }

/** One poll of `POST /api/auth/device/token`. */
async function pollOnce(options: DeviceFlowOptions, deviceCode: string): Promise<PollAnswer> {
  const { response, json } = await post(options, '/api/auth/device/token', {
    grant_type: DEVICE_GRANT_TYPE,
    device_code: deviceCode,
    client_id: DEVICE_CLIENT_ID,
  })
  if (response.ok) {
    const token = json as DeviceTokenResponse
    return {
      kind: 'token',
      token: {
        accessToken: token.access_token,
        tokenType: 'Bearer',
        expiresInSeconds: token.expires_in,
        scope: token.scope,
      },
    }
  }
  const error = json as DeviceErrorResponse | undefined
  if (error?.error === 'slow_down') return { kind: 'slow-down' }
  if (error?.error === 'authorization_pending') return { kind: 'pending' }
  return { kind: 'failed', error: signInFailure({ error, status: response.status }) }
}

/** The typed failure of a poll that ended the sign-in, with the API's own code and words. */
function signInFailure(answer: { error?: DeviceErrorResponse; status: number }): DeviceSignInError {
  return new DeviceSignInError(
    answer.status,
    answer.error?.error ?? 'invalid_request',
    answer.error?.error_description ?? 'Signing in failed. Try again.',
  )
}

/**
 * Polls `POST /api/auth/device/token` until the code is approved, waiting `interval` seconds
 * between attempts and five more after each `slow_down`. `authorization_pending` is not an error:
 * it is the answer while the page has not been used.
 */
async function pollForToken(
  options: DeviceFlowOptions,
  deviceCode: string,
  intervalSeconds: number,
  waitOptions: { signal?: AbortSignal } = {},
): Promise<DeviceToken> {
  const sleep = options.sleep ?? wait
  let interval = Math.max(1, intervalSeconds)
  for (;;) {
    if (waitOptions.signal?.aborted) throw abortError()
    const answer = await pollOnce(options, deviceCode)
    if (answer.kind === 'token') return answer.token
    if (answer.kind === 'failed') throw answer.error
    if (answer.kind === 'slow-down') interval += SLOW_DOWN_SECONDS
    await sleep(interval * 1000)
  }
}

/**
 * Starts a sign-in: asks `POST /api/auth/device/code` for a code and returns it with the poll that
 * ends it. The caller shows `userCode` and opens `verificationUriComplete`; nothing is stored here
 * (the client stores the token in the session once `waitForToken` resolves). A client id the API
 * does not know is refused (`invalid_client`).
 */
export async function beginDeviceSignIn(options: DeviceFlowOptions): Promise<DeviceSignIn> {
  const { response, json } = await post(options, '/api/auth/device/code', {
    client_id: DEVICE_CLIENT_ID,
  })
  if (!response.ok) {
    const error = json as DeviceErrorResponse | undefined
    throw new DeviceSignInError(
      response.status,
      error?.error ?? 'invalid_request',
      error?.error_description ?? 'Signing in could not start. Try again.',
    )
  }
  const code = json as DeviceCodeResponse
  return {
    userCode: code.user_code,
    verificationUriComplete: code.verification_uri_complete,
    expiresInSeconds: code.expires_in,
    intervalSeconds: code.interval,
    waitForToken: (waitOptions) =>
      pollForToken(options, code.device_code, code.interval, waitOptions),
  }
}
