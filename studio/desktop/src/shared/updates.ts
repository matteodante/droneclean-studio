/**
 * "A new version is available" (21 Nov 2026): the desktop app is not signed, so on macOS it cannot
 * update itself. Instead the main process asks GitHub, once a day at most, for the latest release's
 * number and the page shows a small notice with a link to that release.
 *
 * This is the one request the editor makes that the user did not ask for (AGENTS.md: "the editor
 * makes no network request the user did not ask for"), by Matteo's decision of 21 Nov 2026: the
 * switch is on by default, Settings › Privacy turns it off, and off means no request at all. What
 * leaves the machine is the GET itself and a `User-Agent: DroneClean-Studio/<version>` header;
 * GitHub sees the IP address, as with any request.
 *
 * Shared by the main process, the test and the page's bridge (`window.dronecleanUpdates`,
 * `preload/updates.ts`, channels written out there for the sandbox).
 */

/** The repository whose releases are the app's downloads. */
const UPDATE_REPO = 'matteodante/droneclean-studio'

/** The one address the check asks. */
export const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`

/** The answer's file in the profile folder. */
export const UPDATES_FILE = 'updates.json'

/** One day, in milliseconds: the least time between two checks and the length of "Later". */
export const UPDATE_DAY_MS = 24 * 60 * 60 * 1000

/** The IPC channels, shared by the main process and the test. */
export const UPDATE_CHANNELS = {
  enabled: 'updates:enabled',
  setEnabled: 'updates:set-enabled',
  notice: 'updates:notice',
  dismiss: 'updates:dismiss',
  open: 'updates:open',
  available: 'updates:available',
} as const

/** A newer version, as the page is told: the number and the release page that carries the download. */
export interface UpdateNotice {
  version: string
  url: string
}

/** What `window.dronecleanUpdates` offers the page. */
export interface DesktopUpdates {
  readonly version: 1
  /** Whether the check is on (it is, until the user turns it off). */
  getEnabled(): Promise<boolean>
  setEnabled(on: boolean): Promise<boolean>
  /** The newer version found, if any and not hidden; `null` otherwise. */
  getNotice(): Promise<UpdateNotice | null>
  /** "Later": hide this version until tomorrow. */
  dismiss(): Promise<void>
  /** "Download": open the release page in the browser. */
  open(): Promise<void>
  /** Called when a check finds a newer version while the page is open; answers how to stop listening. */
  onAvailable(listener: (notice: UpdateNotice) => void): () => void
}

/** The stored state; a missing or unreadable file means the defaults (check on, nothing known). */
export interface UpdateSettings {
  version: 1
  /** `false` turns the check off; anything else is on. */
  enabled?: boolean
  /** When the last successful request was made (ms since the epoch). */
  lastCheck?: number
  /** The newest stable version that request found, `x.y.z`. */
  latest?: string
  /** The version "Later" or "Download" hid, and until when. */
  dismissedVersion?: string
  dismissedUntil?: number
}

interface Semver {
  major: number
  minor: number
  patch: number
  /** The text after `-`, or `''` for a release. */
  pre: string
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Read `1.2.3`, `v1.2.3` or `1.2.3-beta.1`; anything else is `null`. */
function parseSemver(text: unknown): Semver | null {
  if (typeof text !== 'string') return null
  const match = SEMVER.exec(text.trim())
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? '' }
}

function comparePre(a: string, b: string): number {
  if (a === b) return 0
  // A release is newer than its own pre-releases.
  if (a === '') return 1
  if (b === '') return -1
  const left = a.split('.')
  const right = b.split('.')
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i]
    const y = right[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal; `null` if either is not a version. */
export function compareSemver(a: unknown, b: unknown): number | null {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (left === null || right === null) return null
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  return comparePre(left.pre, right.pre)
}

/** The release page of a stable version `x.y.z`. */
export function releaseUrl(version: string): string {
  return `https://github.com/${UPDATE_REPO}/releases/tag/v${version}`
}

const RELEASE_URL = new RegExp(`^https://github\\.com/${UPDATE_REPO.replace('/', '\\/')}/releases/tag/v\\d+\\.\\d+\\.\\d+$`)

/** Whether `url` is exactly the release page of one stable version of this repository; the only link the shell opens for the notice. */
export function isReleaseUrl(url: unknown): url is string {
  return typeof url === 'string' && RELEASE_URL.test(url)
}

/**
 * The stable version a `releases/latest` answer names, `x.y.z`, or `null`: drafts, pre-releases and
 * tags that are not a plain `vX.Y.Z` are ignored. The page's link is built from this number, never
 * taken from the answer.
 */
export function latestStableVersion(release: unknown): string | null {
  const record = (typeof release === 'object' && release !== null ? release : {}) as Record<string, unknown>
  if (record.draft === true || record.prerelease === true) return null
  const tag = record.tag_name
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) return null
  return tag.slice(1)
}

/** Read the stored state; a broken file is the defaults. */
export function parseUpdateSettings(value: unknown): UpdateSettings {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const settings: UpdateSettings = { version: 1 }
  if (record.version !== 1) return settings
  if (typeof record.enabled === 'boolean') settings.enabled = record.enabled
  if (typeof record.lastCheck === 'number' && Number.isFinite(record.lastCheck)) settings.lastCheck = record.lastCheck
  if (typeof record.latest === 'string' && parseSemver(record.latest)?.pre === '') settings.latest = record.latest
  if (typeof record.dismissedVersion === 'string' && parseSemver(record.dismissedVersion)?.pre === '') {
    settings.dismissedVersion = record.dismissedVersion
  }
  if (typeof record.dismissedUntil === 'number' && Number.isFinite(record.dismissedUntil)) {
    settings.dismissedUntil = record.dismissedUntil
  }
  return settings
}
