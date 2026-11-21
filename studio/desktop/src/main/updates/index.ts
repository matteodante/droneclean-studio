/**
 * The main process's side of "a new version is available" (21 Nov 2026; see `shared/updates.ts` for
 * why this one request exists and what it sends).
 *
 * `createUpdateChecker` holds the rules, free of Electron so the test can run them: off means no
 * request at all, a request at most once in 24 hours (a launch inside that time reuses what the
 * last one found), a draft, a pre-release or a tag that is not `vX.Y.Z` is ignored, and a failure
 * is logged locally and shown to no one. `installUpdatesIpc` and `scheduleUpdateCheck` wire it to
 * the page and to the window.
 */
import type { BrowserWindow, IpcMain } from 'electron'
import { appOnly } from '../sender'
import {
  UPDATE_API_URL,
  UPDATE_CHANNELS,
  UPDATE_DAY_MS,
  compareSemver,
  isReleaseUrl,
  latestStableVersion,
  releaseUrl,
  type UpdateNotice,
  type UpdateSettings,
} from '../../shared/updates'
import { readUpdateSettings, updateSettingsPath, writeUpdateSettings } from './settings'

/** The parts of a `fetch` response the check reads. */
interface UpdateResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

/** The `fetch` the check goes through: Electron's `net.fetch` in the app, a fake in tests. */
export type UpdateFetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; credentials: 'omit'; signal: AbortSignal },
) => Promise<UpdateResponse>

/** How long the request may take before it is dropped. */
const REQUEST_TIMEOUT_MS = 8000

/** The delay between the window being ready and the check. */
export const UPDATE_CHECK_DELAY_MS = 10_000

export interface UpdateChecker {
  enabled(): boolean
  setEnabled(on: boolean): boolean
  /** One check, by the rules above; answers the notice to show, or `null`. */
  check(): Promise<UpdateNotice | null>
  /** The notice to show now: the last check's, unless it was hidden, outdated or the check is off. */
  notice(): UpdateNotice | null
  /** Hide the shown version until tomorrow. */
  dismiss(): void
}

export function createUpdateChecker(options: {
  userDataDir: string
  appVersion: string
  fetch: UpdateFetch
  now?: () => number
}): UpdateChecker {
  const filePath = updateSettingsPath(options.userDataDir)
  const now = options.now ?? Date.now
  const userAgent = `DroneClean-Studio/${options.appVersion}`

  const visible = (): string | null => {
    const settings = readUpdateSettings(filePath)
    if (settings.enabled === false || settings.latest === undefined) return null
    const newer = compareSemver(settings.latest, options.appVersion)
    if (newer === null || newer <= 0) return null
    if (settings.dismissedVersion === settings.latest && now() < (settings.dismissedUntil ?? 0)) return null
    return settings.latest
  }
  const noticeFor = (version: string | null): UpdateNotice | null =>
    version === null ? null : { version, url: releaseUrl(version) }

  return {
    enabled: () => readUpdateSettings(filePath).enabled !== false,
    setEnabled(on) {
      writeUpdateSettings(filePath, { ...readUpdateSettings(filePath), enabled: on })
      return on
    },
    notice: () => noticeFor(visible()),
    dismiss() {
      const settings = readUpdateSettings(filePath)
      if (settings.latest === undefined) return
      writeUpdateSettings(filePath, {
        ...settings,
        dismissedVersion: settings.latest,
        dismissedUntil: now() + UPDATE_DAY_MS,
      })
    },
    async check() {
      const settings = readUpdateSettings(filePath)
      if (settings.enabled === false) return null
      const sinceLast = now() - (settings.lastCheck ?? Number.NEGATIVE_INFINITY)
      if (sinceLast >= 0 && sinceLast < UPDATE_DAY_MS) return noticeFor(visible())
      try {
        const response = await options.fetch(UPDATE_API_URL, {
          method: 'GET',
          headers: { 'User-Agent': userAgent, Accept: 'application/vnd.github+json' },
          credentials: 'omit',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
        const latest = latestStableVersion(await response.json())
        // The switch may have been turned off while the request was out: then the answer is dropped.
        const current = readUpdateSettings(filePath)
        if (current.enabled === false) return null
        const next: UpdateSettings = { ...current, lastCheck: now() }
        if (latest === null) delete next.latest
        else next.latest = latest
        writeUpdateSettings(filePath, next)
      } catch (error) {
        // Silent for the user, on purpose: an offline machine or a rate limit is not worth a message.
        console.warn('[desktop] update check did not complete:', error instanceof Error ? error.message : error)
        return null
      }
      return noticeFor(visible())
    },
  }
}

/** The page's channels: the switch, the notice, "Later" and "Download". */
export function installUpdatesIpc(
  ipcMain: IpcMain,
  checker: UpdateChecker,
  openExternal: (url: string) => unknown,
): void {
  ipcMain.handle(
    UPDATE_CHANNELS.enabled,
    appOnly(() => checker.enabled()),
  )
  ipcMain.handle(
    UPDATE_CHANNELS.setEnabled,
    appOnly((_event, on: unknown) => checker.setEnabled(on === true)),
  )
  ipcMain.handle(
    UPDATE_CHANNELS.notice,
    appOnly(() => checker.notice()),
  )
  ipcMain.handle(
    UPDATE_CHANNELS.dismiss,
    appOnly(() => checker.dismiss()),
  )
  // The page sends no address: the shell opens the release page of the version it found itself,
  // and only when that is exactly a release page of this repository.
  ipcMain.handle(
    UPDATE_CHANNELS.open,
    appOnly(() => {
      const notice = checker.notice()
      if (notice === null || !isReleaseUrl(notice.url)) return
      void openExternal(notice.url)
      checker.dismiss()
    }),
  )
}

/** Check once, `delayMs` after the window is ready to show, and tell the page if a newer version exists. */
export function scheduleUpdateCheck(
  window: BrowserWindow,
  checker: UpdateChecker,
  delayMs: number = UPDATE_CHECK_DELAY_MS,
): void {
  window.once('ready-to-show', () => {
    const timer = setTimeout(() => {
      void checker.check().then((notice) => {
        if (notice !== null && !window.isDestroyed()) window.webContents.send(UPDATE_CHANNELS.available, notice)
      })
    }, delayMs)
    timer.unref()
    window.once('closed', () => clearTimeout(timer))
  })
}
