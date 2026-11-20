/**
 * Where DroneClean Studio's opt-in reports go (20 Nov 2026, Matteo: "colleghiamo sito, editor etc").
 *
 * Both values are public by design: a Sentry DSN and a PostHog project key can only send new events,
 * and the site already carries the same DSN in its own pages. They are sent nowhere until the user
 * says yes (`consent.ts`); an empty value hides that half of the choice (the notice and Settings ›
 * Privacy then offer only what is configured).
 *
 * The same values are written out in `desktop/src/shared/telemetry.ts` (the Electron main process
 * cannot import this file) and in `mcp/launcher.mjs`; `desktop/test/telemetry.test.mjs` holds the
 * copies together.
 */

/** Sentry project `droneclean` (org `matteo-dante`, EU region); the site's and API's events share it. */
export const SENTRY_DSN: string =
  'https://cc591f18b25bdcf7689a5814e4e4d8ad@o4510946315403264.ingest.de.sentry.io/4512177723474000'

/** PostHog (EU) project "DroneClean": empty until the project exists, so usage statistics stay hidden. */
export const POSTHOG_KEY: string = ''

/** PostHog's EU capture host. */
export const POSTHOG_HOST = 'https://eu.i.posthog.com'

/**
 * desktop/package.json's version, replaced at build time by `define` in vite.config.ts. Declared here,
 * not in a global .d.ts, so every compilation that reaches this file (the SDK reference's declaration
 * emit among them) knows the name.
 */
declare const __DRONECLEAN_VERSION__: string | undefined

/** The desktop app's version (desktop/package.json), injected by vite.config.ts. */
export const STUDIO_VERSION: string =
  typeof __DRONECLEAN_VERSION__ === 'string' ? __DRONECLEAN_VERSION__ : '0.0.0'

/** The release name Sentry groups events and source maps under; the site's releases are named apart. */
export const SENTRY_RELEASE = `droneclean-studio@${STUDIO_VERSION}`

/** Which halves of the choice this build can offer. */
export interface TelemetryFeatures {
  crashReports: boolean
  usageStats: boolean
}

export const TELEMETRY_FEATURES: TelemetryFeatures = {
  crashReports: SENTRY_DSN !== '',
  usageStats: POSTHOG_KEY !== '',
}
