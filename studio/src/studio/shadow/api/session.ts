/**
 * Where the editor's DroneClean token is kept.
 *
 * Both shells implement this one interface, so the API client never knows which one it runs in:
 * the web editor keeps the token in `sessionStorage` (per tab, gone when it closes) and the desktop
 * app in the main process, encrypted with `safeStorage` (design 4.1, section 5.1; that
 * implementation is slice E7). The token is a Better Auth session, so a 401 means it is gone: the
 * client calls `setToken(null)` and asks for a new sign-in.
 */
export interface DroneCleanSession {
  /** The bearer token, or null when signed out. */
  getToken(): Promise<string | null>
  /** Stores the token, or forgets it when null (sign-out, or a 401 from the API). */
  setToken(token: string | null): Promise<void>
}

/** A session held in memory: for the tests, and for a shell that has nowhere to keep it. */
export function createMemorySession(token: string | null = null): DroneCleanSession {
  let current = token
  return {
    getToken: async () => current,
    setToken: async (next) => {
      current = next
    },
  }
}
