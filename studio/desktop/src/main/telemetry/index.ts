/**
 * The main process's side of the opt-in reports (20 Nov 2026): it reads the user's answer at
 * launch, reports its own uncaught errors and dead child processes while crash reports are on,
 * sends `mcp_connected` once per launch while usage statistics are on, and stores the page's new
 * answers (`telemetry:get` / `telemetry:set`). Nothing is sent while a half is off or unanswered.
 */
import type { App, IpcMain } from 'electron'
import { appOnly } from '../sender'
import {
  TELEMETRY_CHANNELS,
  TELEMETRY_DESTINATIONS,
  parseTelemetryChoice,
  type TelemetrySettings,
} from '../../shared/telemetry'
import { errorEvent, processGoneEvent, sentryEnvelope, usageRequest, type ReportContext } from './report'
import { readTelemetrySettings, telemetrySettingsPath, writeTelemetryChoice } from './settings'

/** The `fetch` the reports go through: Electron's `net.fetch` in the app, a fake in tests. */
type Fetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<unknown>

export interface MainTelemetry {
  /** The answer as stored now. */
  settings(): TelemetrySettings | null
  /** Report an error, if crash reports are on. */
  reportError(error: unknown, where: string): void
  /** Report a dead child process, if crash reports are on; a clean exit is not reported. */
  reportProcessGone(processType: string, reason: string, exitCode: number): void
  /** `mcp_connected`, once per launch, if usage statistics are on. */
  agentConnected(): void
  /** Store the page's answer and apply it at once. */
  choose(choice: unknown): TelemetrySettings
}

/** Reasons a child process ends that are not a crash. */
const ORDINARY_EXITS = new Set(['clean-exit', 'killed'])

export function createMainTelemetry(options: {
  userDataDir: string
  context: ReportContext
  fetch: Fetch
}): MainTelemetry {
  const filePath = telemetrySettingsPath(options.userDataDir)
  let settings = readTelemetrySettings(filePath)
  let agentSent = false

  const post = (request: { url: string; body: string } | null, contentType: string) => {
    if (request === null) return
    // Through a promise: `net.fetch` throws, rather than rejects, before the app is ready.
    void Promise.resolve()
      .then(() =>
        options.fetch(request.url, { method: 'POST', headers: { 'Content-Type': contentType }, body: request.body }),
      )
      .catch(() => {
        // Best effort: a report that cannot be sent is dropped, never kept for later.
      })
  }
  const crashOn = () => TELEMETRY_DESTINATIONS.sentryDsn !== '' && settings?.crashReports === true

  return {
    settings: () => settings,
    reportError(error, where) {
      if (!crashOn()) return
      post(sentryEnvelope(errorEvent(error, where, options.context)), 'application/x-sentry-envelope')
    },
    reportProcessGone(processType, reason, exitCode) {
      if (!crashOn() || ORDINARY_EXITS.has(reason)) return
      post(
        sentryEnvelope(processGoneEvent(processType, reason, exitCode, options.context)),
        'application/x-sentry-envelope',
      )
    },
    agentConnected() {
      if (agentSent || TELEMETRY_DESTINATIONS.posthogKey === '' || settings?.usageStats !== true || !settings.installId) return
      agentSent = true
      post(usageRequest('mcp_connected', settings.installId, options.context), 'application/json')
    },
    choose(choice) {
      settings = writeTelemetryChoice(filePath, parseTelemetryChoice(choice))
      return settings
    },
  }
}

/**
 * Wire the main process's reports: its uncaught errors (observed, so Electron's own handling stays
 * as it is), the renderer's and helper processes' deaths, and the page's two channels.
 */
export function installMainTelemetry(app: App, ipcMain: IpcMain, telemetry: MainTelemetry): void {
  // A monitor only observes: Electron's own handling of an uncaught error (and of a rejection Node turns into one)
  // stays as it was, which an `unhandledRejection` listener would change.
  process.on('uncaughtExceptionMonitor', (error, origin) => telemetry.reportError(error, `main:${origin}`))
  app.on('render-process-gone', (_event, _contents, details) => {
    telemetry.reportProcessGone('renderer', details.reason, details.exitCode)
  })
  app.on('child-process-gone', (_event, details) => {
    telemetry.reportProcessGone(details.type, details.reason, details.exitCode)
  })
  ipcMain.handle(
    TELEMETRY_CHANNELS.get,
    appOnly(() => telemetry.settings()),
  )
  ipcMain.handle(
    TELEMETRY_CHANNELS.set,
    appOnly((_event, choice: unknown) => telemetry.choose(choice)),
  )
}
