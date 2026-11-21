/**
 * Which links leave the app for the system browser (audit of 21 Nov 2026).
 *
 * A page link with `target="_blank"` or a `window.open` reaches `setWindowOpenHandler` in `index.ts`, which never
 * opens a window of the app: it hands the address to the system browser when this module says so, and drops it
 * otherwise. Until then every `https:` address was handed over, so anything that could put a link in the page could
 * open any site. Pure on purpose (no Electron), so the test runs the rule itself.
 */
import { isAppUrl } from './sender'

/**
 * The hosts the editor links to, found by searching `studio/src` for `window.open` and `target="_blank"`
 * (21 Nov 2026). A host is matched exactly: no subdomain of a listed host is in.
 */
export const EXTERNAL_LINK_HOSTS: readonly string[] = [
  // The site: the sign-in code page (`/device`), credits (`/profile`), the desktop app's download.
  'droneclean.app',
  'www.droneclean.app',
  // Licenses page: the fonts' own repositories (one is written with `www.`).
  'github.com',
  'www.github.com',
  // Licenses page: the SIL Open Font License and the Apache License 2.0.
  'openfontlicense.org',
  'www.apache.org',
  // AI panel: MusicGen's licence and Supertonic's model card.
  'creativecommons.org',
  'huggingface.co',
  // Lottie browser: LottieFiles' licence.
  'lottiefiles.com',
]

export type ExternalLinkDecision =
  | { readonly open: true; readonly url: string }
  | { readonly open: false; readonly reason: string }

/**
 * Whether `rawUrl` may be opened in the system browser: `https:`, a listed host, the default port, and no user name or
 * password in it (`https://droneclean.app@evil.example` is a link to `evil.example`). An allowed link is answered as
 * the parsed address, so the browser gets exactly what was checked. A refusal's reason names the host at most, never
 * the path or the query, which may carry a code.
 */
export function decideExternalLink(rawUrl: string): ExternalLinkDecision {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { open: false, reason: 'not a valid address' }
  }
  if (url.protocol !== 'https:') return { open: false, reason: `a ${url.protocol} address, not https:` }
  if (url.username !== '' || url.password !== '') {
    return { open: false, reason: 'an address with a user name or password in it' }
  }
  if (url.port !== '') return { open: false, reason: `${url.hostname} on port ${url.port}` }
  if (!EXTERNAL_LINK_HOSTS.includes(url.hostname)) {
    return { open: false, reason: `${url.hostname} is not a host the app links to` }
  }
  return { open: true, url: url.href }
}

/**
 * A page of the app's own user guide (`/docs` and below, on the app's origin or the dev server's): the toolbar opens
 * it "in a new tab", which the desktop app shows in its one window instead.
 */
export function isGuideUrl(rawUrl: string, dev: string | null): boolean {
  if (!isAppUrl(rawUrl, dev)) return false
  const { pathname } = new URL(rawUrl)
  return pathname === '/docs' || pathname.startsWith('/docs/')
}
