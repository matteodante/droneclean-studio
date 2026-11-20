/**
 * Anonymous usage statistics, to PostHog (EU), only while the user has said yes (20 Nov 2026).
 *
 * A handful of named events and nothing else: no page views, no autocapture, no session
 * recording, no `identify`, no person profiles. Each event carries the installation's random id
 * (`consent.ts`), the version, the platform and the operating system, plus the few numbers named
 * in `UsageEvents`; never a file name, a path, a project name, a clip or a frame. Events go
 * straight to PostHog's capture endpoint with `fetch`: no SDK, no cookies.
 *
 * `mcp_connected` happens in the desktop main process, which sends it itself
 * (`desktop/src/main/telemetry/usage.ts`) with the same id.
 */
import type { ExportSettings, ExtendedExportSettings } from '@/types/export'
import { POSTHOG_HOST, POSTHOG_KEY, STUDIO_VERSION } from './config'
import { isTelemetryOn, useTelemetryConsent } from './consent'

/** How an export or a shadow clean ended. */
export type RunResult = 'succeeded' | 'failed' | 'canceled'

/** The events the editor page sends, with their properties. */
export interface UsageEvents {
  /** The editor started (sent once per launch, or when the user switches statistics on). */
  app_opened: Record<string, never>
  /** A project was made: its frame size and rate. */
  project_created: { width: number; height: number; fps: number }
  /** An export wrote its file: how, in which format and size, and how long the video is. */
  export_finished: {
    via: 'dialog' | 'queue'
    engine: 'native' | 'browser' | 'smart-copy'
    codec: string
    container: string
    width: number
    height: number
    seconds: number
  }
  /** A shadow clean through DroneClean's service ended: how, and how long the cleaned piece is. */
  shadow_removal_used: { result: RunResult; seconds: number }
}

function platform(): 'desktop' | 'web' {
  return typeof window !== 'undefined' && window.dronecleanDesktop !== undefined ? 'desktop' : 'web'
}

function operatingSystem(): 'mac' | 'windows' | 'linux' | 'other' {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Mac OS X|Macintosh/.test(agent)) return 'mac'
  if (/Windows/.test(agent)) return 'windows'
  if (/Linux/.test(agent)) return 'linux'
  return 'other'
}

/** The request body PostHog's capture endpoint takes. */
function usageEventBody(
  event: string,
  properties: Record<string, string | number | boolean>,
  installId: string,
  apiKey: string = POSTHOG_KEY,
): string {
  return JSON.stringify({
    api_key: apiKey,
    event,
    distinct_id: installId,
    timestamp: new Date().toISOString(),
    properties: {
      ...properties,
      app: 'studio',
      platform: platform(),
      os: operatingSystem(),
      version: STUDIO_VERSION,
      $lib: 'droneclean-studio',
      $process_person_profile: false,
      $ip: null,
    },
  })
}

/**
 * Send one event; does nothing unless the user switched usage statistics on. Never throws: the
 * callers are a project's creation, an export's end and a clean's end, which a statistic must not
 * break.
 */
export function track<Name extends keyof UsageEvents>(name: Name, properties: UsageEvents[Name]): void {
  const { settings } = useTelemetryConsent.getState()
  if (!isTelemetryOn(settings, 'usageStats') || settings?.installId === undefined) return
  const installId = settings.installId
  // Statistics are best effort: a failed send is dropped, never retried or kept.
  Promise.resolve()
    .then(() =>
      fetch(`${POSTHOG_HOST}/i/v0/e/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: usageEventBody(name, properties, installId),
        credentials: 'omit',
        keepalive: true,
      }),
    )
    .catch(() => undefined)
}

/** Seconds, rounded to a tenth: enough to tell a reel from a film, no more. */
export function roundSeconds(seconds: number): number {
  return Number.isFinite(seconds) ? Math.round(seconds * 10) / 10 : 0
}

/** The format of an export as its settings give it; any missing field reads as empty or 0. */
interface ExportedFormat {
  codec?: string
  container?: string
  resolution?: { width?: number; height?: number }
}

/**
 * `export_finished` from what an export path knows; the duration in seconds. Never throws: a
 * statistic must not turn a finished export into a failed one.
 */
export function trackExportFinished(
  via: UsageEvents['export_finished']['via'],
  engine: UsageEvents['export_finished']['engine'],
  settings: ExportedFormat | undefined,
  seconds: number,
): void {
  track('export_finished', {
    via,
    engine,
    codec: settings?.codec ?? '',
    container: settings?.container ?? '',
    width: settings?.resolution?.width ?? 0,
    height: settings?.resolution?.height ?? 0,
    seconds: roundSeconds(seconds),
  })
}

/** The format half of `export_finished` from the export dialog's settings. */
export function exportedFormat(settings: ExportSettings | ExtendedExportSettings | undefined): ExportedFormat {
  const container = settings !== undefined && 'videoContainer' in settings ? settings.videoContainer : undefined
  return { codec: settings?.codec, container, resolution: settings?.resolution }
}
