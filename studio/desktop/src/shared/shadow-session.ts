/**
 * The cloud sign-in's token, kept by the main process (design 4.1 section 7, slice E7; review
 * finding C8).
 *
 * The bearer token of the pilot's DroneClean account never reaches the page. The main process
 * keeps it, encrypted with Electron's `safeStorage`, and attaches `Authorization: Bearer` itself to
 * the page's calls to the cloud: the page hands over a request for `/v1/*` (or one of the two
 * sign-in routes of the device flow) and gets the answer back. The only token the page ever sees
 * is the placeholder it is told stands for it.
 *
 * `preload/index.ts` writes the channel names out (a sandboxed preload cannot import this file);
 * `test/shadow-session.test.mjs` holds the two copies together.
 */

/** The channels of the `shadowSession` bridge member. */
export const SHADOW_SESSION_CHANNELS = {
  status: 'shadow-session:status',
  request: 'shadow-session:request',
  signOut: 'shadow-session:sign-out',
} as const

/** What the page may know about the session. */
export interface ShadowSessionStatus {
  /** A token is held, so a request to `/v1/*` carries one. */
  readonly signedIn: boolean
  /**
   * The token survives a restart: it is on disk, encrypted. False when the system has no secret
   * store to encrypt with (the token then lives in memory until the app closes, and is never
   * written in the clear).
   */
  readonly persistent: boolean
}

/** One call the page asks the main process to make to the cloud. */
export interface ShadowRelayRequest {
  readonly method: string
  /** The path and query on the cloud's origin: `/v1/me`, `/api/auth/device/code`. */
  readonly path: string
  /** The caller's headers; the main process keeps only the ones the cloud needs and adds the token. */
  readonly headers?: Readonly<Record<string, string>>
  /** A JSON body as text; the cloud's `/v1/*` routes take no other (the pieces go to signed URLs). */
  readonly body?: string
}

/** The cloud's answer, the token of a completed sign-in replaced by the placeholder. */
export interface ShadowRelayResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

/**
 * What the page is given where a token would be: the sign-in's answer carries it in place of the
 * real one, and the page's session reports it while signed in. It stands for the session and
 * authorises nothing; the main process ignores any `Authorization` header a page sends.
 */
export const SHADOW_TOKEN_PLACEHOLDER = 'held-by-the-desktop-app'
