/**
 * Crash reports and usage events of the main process, written without an SDK (20 Nov 2026).
 *
 * The main process is compiled by `tsc` without a bundler, and Sentry's Node SDK would bring
 * OpenTelemetry and automatic instrumentation into it. What the main process needs is small: an
 * error with its stack, or a renderer or GPU process that died, sent as one Sentry envelope; and
 * one PostHog event. Both are built here as plain JSON and sent by the caller's `fetch`, which
 * keeps them testable under plain Node.
 *
 * No minidumps: a native crash dump holds raw memory, which can hold file names and pixels, and
 * the promise is that none leave the computer. A process that dies is reported by its reason and
 * exit code instead.
 */
import { randomUUID } from 'node:crypto'
import { TELEMETRY_DESTINATIONS } from '../../shared/telemetry'

/** What every report says about this app. */
export interface ReportContext {
  /** desktop/package.json's version. */
  version: string
  /** `process.platform`. */
  platform: string
}

/** One frame of a V8 stack, in Sentry's shape. */
interface StackFrame {
  function?: string
  filename: string
  lineno?: number
  colno?: number
  in_app: boolean
}

/**
 * An absolute path: a POSIX one under a user or volume folder, a Windows drive path, a UNC path, or a file:// URL.
 * Folders may hold spaces (`/Volumes/SSD/Avata 2 - 15 novembre/`); the last part ends at a space.
 */
const ABSOLUTE_PATH =
  /(?:(?:file:\/\/\/?)?\/(?:Users|home|Volumes|private|var|tmp|mnt|media|run|opt|root)(?:\/[^\/\n'"`)\]>,;]*(?=\/))*\/[^\s'"`)\]>,;]*|[A-Za-z]:(?:[\\\/][^\\\/\n'"`)\]>,;]*(?=[\\\/]))*[\\\/][^\s'"`)\]>,;]*|\\\\[^\s'"`)\]>,;]+)/g

/** A bare file name with a media, project or look extension. */
const FILE_NAME =
  /[^\s/\\'"`()[\]<>,;:]+\.(?:mp4|mov|m4v|mkv|avi|mxf|insv|lrv|lrf|mts|m2ts|webm|wav|mp3|m4a|aac|flac|aiff?|ogg|opus|png|jpe?g|heic|webp|gif|dng|tiff?|cube|3dl|srt|vtt|gcsv|bbl|osd|fcpxml|xml|otio|edl|fcproject|zip)\b/gi

/** The same text with paths and media file names replaced (the page's `scrub.ts` rules). */
export function scrubText(text: string): string {
  return text.replace(ABSOLUTE_PATH, '<path>').replace(FILE_NAME, '<file>')
}

/**
 * A frame's file as it may leave: the app's own files from their folder inside the app
 * (`app:///out/main/index.js`), anything else without its folders.
 */
export function frameFile(file: string): string {
  const normal = file.replace(/\\/g, '/').replace(/^file:\/\//, '')
  for (const marker of ['/app.asar/', '/desktop/']) {
    const at = normal.lastIndexOf(marker)
    if (at !== -1) return `app:///${normal.slice(at + marker.length)}`
  }
  if (normal.startsWith('node:')) return normal
  return normal.split('/').pop() ?? 'unknown'
}

/** V8's `at fn (file:line:col)` and `at file:line:col` lines, oldest call first as Sentry wants. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return []
  const frames: StackFrame[] = []
  for (const line of stack.split('\n')) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line)
    if (!match) continue
    const [, fn, file = '', lineNo, colNo] = match
    const filename = frameFile(file)
    frames.push({
      ...(fn !== undefined && { function: fn }),
      filename,
      lineno: Number(lineNo),
      colno: Number(colNo),
      in_app: filename.startsWith('app:///') && !filename.includes('node_modules'),
    })
  }
  return frames.reverse()
}

/** The Sentry event of an error the main process did not catch. */
export function errorEvent(error: unknown, where: string, context: ReportContext): Record<string, unknown> {
  const isError = error instanceof Error
  const type = isError ? error.name : 'NonError'
  const value = scrubText(isError ? error.message : String(error))
  const frames = isError ? parseStack(error.stack) : []
  return baseEvent(context, where, {
    level: 'error',
    exception: {
      values: [{ type, value, ...(frames.length > 0 && { stacktrace: { frames } }) }],
    },
  })
}

/** The Sentry event of a renderer, GPU or helper process that died. */
export function processGoneEvent(
  processType: string,
  reason: string,
  exitCode: number,
  context: ReportContext,
): Record<string, unknown> {
  return baseEvent(context, 'process-gone', {
    level: 'fatal',
    message: `${processType} process gone: ${reason} (exit code ${exitCode})`,
    fingerprint: ['process-gone', processType, reason],
    tags: { process: processType, reason },
  })
}

function baseEvent(
  context: ReportContext,
  where: string,
  fields: Record<string, unknown> & { tags?: Record<string, string> },
): Record<string, unknown> {
  const { tags, ...rest } = fields
  return {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: 'node',
    logger: 'droneclean-studio.main',
    release: `droneclean-studio@${context.version}`,
    environment: 'studio-desktop',
    tags: { app: 'studio', where, os: context.platform, ...tags },
    contexts: { os: { name: context.platform } },
    sdk: { name: 'droneclean-studio.main', version: context.version, settings: { infer_ip: 'never' } },
    ...rest,
  }
}

/** Where and how a Sentry event is posted: the envelope endpoint of the DSN, with the key in the URL. */
export function sentryEnvelope(
  event: Record<string, unknown>,
  dsn: string = TELEMETRY_DESTINATIONS.sentryDsn,
): { url: string; body: string } | null {
  const match = /^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn)
  if (!match) return null
  const [, scheme, key, host, project] = match
  const header = { event_id: event.event_id, sent_at: new Date().toISOString() }
  return {
    url: `${scheme}://${host}/api/${project}/envelope/?sentry_key=${key}&sentry_version=7`,
    body: `${JSON.stringify(header)}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`,
  }
}

/** PostHog's capture request for one event, or null when no project is configured. */
export function usageRequest(
  event: string,
  installId: string,
  context: ReportContext,
  apiKey: string = TELEMETRY_DESTINATIONS.posthogKey,
): { url: string; body: string } | null {
  if (apiKey === '') return null
  return {
    url: `${TELEMETRY_DESTINATIONS.posthogHost}/i/v0/e/`,
    body: JSON.stringify({
      api_key: apiKey,
      event,
      distinct_id: installId,
      timestamp: new Date().toISOString(),
      properties: {
        app: 'studio',
        platform: 'desktop',
        os: context.platform === 'darwin' ? 'mac' : context.platform === 'win32' ? 'windows' : context.platform,
        version: context.version,
        $lib: 'droneclean-studio',
        $process_person_profile: false,
        $ip: null,
      },
    }),
  }
}
