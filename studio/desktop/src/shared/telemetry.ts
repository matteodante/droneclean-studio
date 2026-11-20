/**
 * The opt-in crash reports and usage statistics of the desktop shell (20 Nov 2026): where they go,
 * the answer's file format, and the page's bridge.
 *
 * The answer lives in `userData/telemetry.json` as `{ version: 1, crashReports?, usageStats?,
 * installId? }`; a missing file, or a half that is absent, was never answered and sends nothing.
 * The main process reads it at launch (its own errors, `mcp_connected`), the page reads and writes
 * it through `window.dronecleanTelemetry` (`preload/telemetry.ts`, channels written out there for
 * the sandbox), and the MCP launcher reads it for its own crash reports. The page's copy of these
 * shapes is `src/studio/telemetry/consent.ts`, of the addresses `src/studio/telemetry/config.ts`;
 * `test/telemetry.test.mjs` holds every copy together.
 */

/**
 * Where the reports go: Sentry project `droneclean` (org `matteo-dante`, EU region), whose DSN is
 * public (it can only send events), and PostHog (EU) project "DroneClean", whose key is empty until
 * the project exists.
 */
export const TELEMETRY_DESTINATIONS: {
  readonly sentryDsn: string
  readonly posthogKey: string
  readonly posthogHost: string
} = {
  sentryDsn:
    'https://cc591f18b25bdcf7689a5814e4e4d8ad@o4510946315403264.ingest.de.sentry.io/4512177723474000',
  posthogKey: '',
  posthogHost: 'https://eu.i.posthog.com',
}

/** The answer's file in the profile folder. */
export const TELEMETRY_FILE = 'telemetry.json'

/** The two IPC channels, shared by the main process and the test. */
export const TELEMETRY_CHANNELS = {
  get: 'telemetry:get',
  set: 'telemetry:set',
} as const

/** What the user answered; an absent half was never asked. */
export interface TelemetryChoice {
  crashReports?: boolean
  usageStats?: boolean
}

/** The stored answer; `installId` exists only while usage statistics are on. */
export interface TelemetrySettings extends TelemetryChoice {
  version: 1
  installId?: string
}

/** What `window.dronecleanTelemetry` offers the page. */
export interface DesktopTelemetry {
  readonly version: 1
  get(): Promise<TelemetrySettings | null>
  set(choice: TelemetryChoice): Promise<TelemetrySettings>
}

/** Read a stored answer; anything but the version-1 object (broken, a future format) is never answered. */
export function parseTelemetrySettings(value: unknown): TelemetrySettings | null {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  if (record.version !== 1) return null
  const settings: TelemetrySettings = { version: 1, ...parseTelemetryChoice(record) }
  const id = record.installId
  if (settings.usageStats === true && typeof id === 'string' && id !== '') settings.installId = id
  return settings
}

/** The boolean halves of a value (a choice from the page: the IPC carries whatever the caller sent). */
export function parseTelemetryChoice(value: unknown): TelemetryChoice {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const choice: TelemetryChoice = {}
  if (typeof record.crashReports === 'boolean') choice.crashReports = record.crashReports
  if (typeof record.usageStats === 'boolean') choice.usageStats = record.usageStats
  return choice
}

/** Merge a new answer into the stored one; the id is made with usage statistics and dropped with them. */
export function mergeTelemetryChoice(
  previous: TelemetrySettings | null,
  choice: TelemetryChoice,
  makeId: () => string,
): TelemetrySettings {
  const next: TelemetrySettings = {
    version: 1,
    ...parseTelemetryChoice(previous),
    ...parseTelemetryChoice(choice),
  }
  if (next.usageStats === true) next.installId = previous?.installId ?? makeId()
  return next
}
