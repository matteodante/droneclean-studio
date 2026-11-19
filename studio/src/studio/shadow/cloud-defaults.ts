// The web editor's own way to reach the DroneClean cloud: the API's origin, the token kept in
// `sessionStorage`, and a client over them. The re-download of a missing piece builds its client
// from these; the shadow session builds the same one for the paid flow, and a shell that keeps
// the token elsewhere (the desktop's main process) replaces it by injection.

import { createDroneCleanClient, type DroneCleanClient } from './api/client'
import type { DroneCleanSession } from './api/session'
import { desktopShadowCloud } from './session-desktop'

/** The API's origin: the website, which passes `/v1/*` and `/api/auth/*` on to the API. */
const API_BASE_URL = 'https://droneclean.app'

/** Where the web editor keeps the bearer token: per tab, gone when the tab closes. */
const TOKEN_STORAGE_KEY = 'droneclean-token'

/** The token store over `sessionStorage`, or over nothing when the browser refuses storage. */
function createBrowserSession(): DroneCleanSession {
  return {
    getToken: async () => {
      try {
        return window.sessionStorage.getItem(TOKEN_STORAGE_KEY)
      } catch {
        return null
      }
    },
    setToken: async (token) => {
      try {
        if (token === null) window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
        else window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
      } catch {
        // A browser that refuses storage cannot keep a session: the next call signs in again.
      }
    },
  }
}

/** A client for the live cloud over the browser's `fetch` and the token in `sessionStorage`. */
export function createBrowserClient(): DroneCleanClient {
  return (
    desktopShadowCloud()?.client ??
    createDroneCleanClient({
      baseUrl: API_BASE_URL,
      fetch: (url, init) => fetch(url, init),
      session: createBrowserSession(),
      openUrl: (url) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      },
    })
  )
}
