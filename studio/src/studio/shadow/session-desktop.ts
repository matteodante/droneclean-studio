// The desktop app's DroneClean session (design 4.1, section 5.1; slice E7; review finding C8).
//
// The web editor keeps the bearer token in `sessionStorage`. The desktop app does not keep it in
// the page at all: the main process holds it, encrypted with `safeStorage`
// (`desktop/src/main/shadow-session.ts`), and attaches it itself to the page's calls to the cloud.
// This module is the page's half. It makes two things from the bridge's `shadowSession`:
//
// - a `fetch` that sends the calls the cloud's client makes to `/v1/*` and to the device sign-in's
//   two routes through the main process, and everything else (the signed upload and download
//   URLs, which carry their own signature) through the page's own `fetch`;
// - a `DroneCleanSession` whose `getToken` says "signed in" with a placeholder and whose
//   `setToken(null)` signs out. The real token never crosses the bridge, so a script in the page
//   cannot read it, and `setToken` of a token is a no-op: the device sign-in's answer already made
//   the main process store it, and the page was handed the placeholder in its place.
//
// The unchanged `api/client.ts` works over the two: it adds `Authorization: Bearer <placeholder>`,
// which the main process drops for its own.

import { createDroneCleanClient, type DroneCleanClient } from './api/client'
import type { DroneCleanSession } from './api/session'
import type { FetchLike } from './api/types'

/** What the page is given where a token would be (`desktop/src/shared/shadow-session.ts`). */
export const SHADOW_TOKEN_PLACEHOLDER = 'held-by-the-desktop-app'

/** The shell's `shadowSession` bridge member (`desktop/src/shared/bridge.ts`), as the page sees it. */
export interface DesktopShadowSessionBridge {
  status(): Promise<{ readonly signedIn: boolean; readonly persistent: boolean }>
  request(request: {
    readonly method: string
    readonly path: string
    readonly headers?: Readonly<Record<string, string>>
    readonly body?: string
  }): Promise<{
    readonly status: number
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
  }>
  signOut(): Promise<void>
}

const DEVICE_PATHS = new Set(['/api/auth/device/code', '/api/auth/device/token'])

/** The bridge's session when the page runs in the desktop shell that has one. */
export function desktopShadowSessionBridge(): DesktopShadowSessionBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.dronecleanDesktop as
    | { readonly shadowSession?: DesktopShadowSessionBridge }
    | undefined
  return bridge?.shadowSession ?? null
}

/** The page's token store over the bridge: no token is ever read, written or stored here. */
export function createDesktopShadowSession(bridge: DesktopShadowSessionBridge): DroneCleanSession {
  return {
    getToken: async () => {
      try {
        return (await bridge.status()).signedIn ? SHADOW_TOKEN_PLACEHOLDER : null
      } catch {
        return null
      }
    },
    setToken: async (token) => {
      // A token is the placeholder of a sign-in the main process already stored; only null acts.
      if (token === null) await bridge.signOut()
    },
  }
}

/** The headers of a call as a plain object, whichever shape the caller used. */
function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {}
  if (headers === undefined) return record
  new Headers(headers).forEach((value, name) => {
    record[name] = value
  })
  return record
}

/** Whether `url` is one of the calls the main process makes for the page. */
function isRelayed(url: string, origin: string): boolean {
  if (!url.startsWith(origin)) return false
  const path = url.slice(origin.length)
  return path.startsWith('/v1/') || DEVICE_PATHS.has(path)
}

/** The body of a relayed call: JSON as text, or none. */
function relayBody(body: RequestInit['body']): { body?: string } {
  if (body === undefined || body === null) return {}
  if (typeof body !== 'string') throw new TypeError('A call to the cloud carries a JSON body as text.')
  return { body }
}

/** A status with no body (204, 304) cannot carry one in a `Response`. */
function hasNoBody(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}

/**
 * A `fetch` that makes the cloud's own calls through the main process, which attaches the token.
 * `baseUrl` is the cloud's origin; a call to any other URL is the page's own.
 */
export function createDesktopShadowFetch(
  bridge: DesktopShadowSessionBridge,
  baseUrl: string,
  pageFetch: FetchLike,
): FetchLike {
  const origin = baseUrl.replace(/\/+$/, '')
  return async (url, init = {}) => {
    if (!isRelayed(url, origin)) return pageFetch(url, init)
    const answer = await bridge.request({
      method: init.method ?? 'GET',
      path: url.slice(origin.length),
      headers: headerRecord(init.headers),
      ...relayBody(init.body),
    })
    const body = hasNoBody(answer.status) ? null : answer.body
    return new Response(body, { status: answer.status, headers: answer.headers })
  }
}

/** The session and the cloud client the desktop app uses, over one bridge. */
export interface DesktopShadowCloud {
  readonly session: DroneCleanSession
  readonly client: DroneCleanClient
}

export function createDesktopShadowCloud(
  bridge: DesktopShadowSessionBridge,
  options: {
    baseUrl: string
    pageFetch: FetchLike
    openUrl: (url: string) => void | Promise<void>
  },
): DesktopShadowCloud {
  const session = createDesktopShadowSession(bridge)
  const client = createDroneCleanClient({
    baseUrl: options.baseUrl,
    fetch: createDesktopShadowFetch(bridge, options.baseUrl, options.pageFetch),
    session,
    openUrl: options.openUrl,
  })
  return { session, client }
}

let installed: DesktopShadowCloud | null = null

/** Remembers the desktop's cloud (null forgets it): `install-desktop.ts` sets it, the account control reads it. */
export function setDesktopShadowCloud(cloud: DesktopShadowCloud | null): void {
  installed = cloud
}

/** The desktop's cloud, or null in the web editor and before the install. */
export function desktopShadowCloud(): DesktopShadowCloud | null {
  return installed
}
