/**
 * Crash reports of the editor page, to Sentry, only while the user has said yes (20 Nov 2026).
 *
 * Sentry's SDK is imported when reports are switched on, never before: a user who never says yes
 * never downloads or runs it, and nothing reaches Sentry. Switching off closes the client; the gate
 * in `beforeSend` drops anything still in flight.
 *
 * A report carries the error, its stack (made readable by the source maps a release uploads), the
 * version, the platform and the page's address without its query or project id. It carries no
 * breadcrumbs (they would hold the editor's log lines, which name files), no user, no IP address,
 * no session, no performance traces and no screen recording; messages lose their paths and file
 * names (`scrub.ts`).
 */
import type { ErrorEvent, EventHint } from '@sentry/browser'
import { SENTRY_DSN, SENTRY_RELEASE } from './config'
import { scrubText, scrubUrl } from './scrub'

type SentryModule = typeof import('@sentry/browser')

let wanted = false
let sentry: SentryModule | null = null
let starting: Promise<void> | null = null

/** Whether the editor runs in the desktop shell (its environment in Sentry) or in a browser. */
function environment(): 'studio-desktop' | 'studio-web' {
  return typeof window !== 'undefined' && window.dronecleanDesktop !== undefined
    ? 'studio-desktop'
    : 'studio-web'
}

/** The event as it may leave: messages and addresses scrubbed, no user, no request headers. */
function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (!wanted) return null
  const { user: _user, breadcrumbs: _breadcrumbs, extra: _extra, ...kept } = event
  // Sentry would otherwise fill in the sender's IP address from the request.
  const sdk = { ...kept.sdk, settings: { ...kept.sdk?.settings, infer_ip: 'never' as const } }
  return {
    ...kept,
    sdk,
    ...(kept.message !== undefined && { message: scrubText(kept.message) }),
    ...(kept.exception && { exception: { values: kept.exception.values?.map(scrubException) } }),
    ...(kept.request && { request: { url: scrubUrl(kept.request.url ?? '') } }),
  }
}

/** One exception with its message scrubbed; its type and stack stay. */
function scrubException<Value extends { value?: string }>(value: Value): Value {
  return value.value === undefined ? value : { ...value, value: scrubText(value.value) }
}

async function start(): Promise<void> {
  const module = await import('@sentry/browser')
  if (!wanted) return
  module.init({
    dsn: SENTRY_DSN,
    release: SENTRY_RELEASE,
    environment: environment(),
    defaultIntegrations: false,
    integrations: [
      module.eventFiltersIntegration(),
      module.functionToStringIntegration(),
      module.globalHandlersIntegration(),
      module.linkedErrorsIntegration(),
      module.dedupeIntegration(),
    ],
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    maxBreadcrumbs: 0,
    initialScope: { tags: { app: 'studio' } },
    beforeSend: (event: ErrorEvent, _hint: EventHint) => scrubEvent(event),
  })
  sentry = module
}

/** Start or stop crash reports to match the user's answer. */
export async function applyCrashReports(on: boolean): Promise<void> {
  wanted = on && SENTRY_DSN !== ''
  if (wanted) {
    if (sentry === null) {
      starting ??= start().finally(() => {
        starting = null
      })
      await starting
    }
    return
  }
  if (starting) await starting
  if (sentry !== null) {
    const closing = sentry
    sentry = null
    await closing.close(2000)
  }
}

/**
 * Report an error the editor caught itself (an error boundary, the router's error screen); errors
 * nobody catches are reported by Sentry's own handlers. Does nothing while reports are off.
 */
export function reportError(error: unknown, where: string): void {
  if (!wanted || sentry === null) return
  sentry.captureException(error, { tags: { where } })
}
