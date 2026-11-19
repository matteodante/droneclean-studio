// Starts the desktop app's DroneClean session on the page (slice E7): when the shell offers
// `window.dronecleanDesktop.shadowSession`, the shadow flow is configured over it instead of the
// web defaults. The web editor has no such bridge and keeps `sessionStorage`. `src/main.tsx` calls
// this once, beside `installAgentBridges()`.

import { createDesktopShadowCloud, desktopShadowSessionBridge, setDesktopShadowCloud } from './session-desktop'

/** The cloud's origin, as the web defaults use it. */
const API_BASE_URL = 'https://droneclean.app'

/** Opens the website in the system browser: the shell routes `window.open` of an https page there. */
function openInSystemBrowser(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Configures the shadow flow over the main process's session; does nothing outside the desktop app. */
export function installDesktopShadowSession(): void {
  const bridge = desktopShadowSessionBridge()
  if (bridge === null) return
  const cloud = createDesktopShadowCloud(bridge, {
    baseUrl: API_BASE_URL,
    pageFetch: (url, init) => fetch(url, init),
    openUrl: openInSystemBrowser,
  })
  setDesktopShadowCloud(cloud)
  void import('./ui/use-shadow-session').then(({ configureShadowSession }) => {
    configureShadowSession({ session: cloud.session, client: cloud.client, openUrl: openInSystemBrowser })
  })
}
