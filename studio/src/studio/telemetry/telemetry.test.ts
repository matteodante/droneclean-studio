/**
 * The opt-in reports send nothing until the user says yes, and only the named fields afterwards.
 * PostHog's key is mocked so both halves are offered, the way a build with both configured is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  close: vi.fn(async () => true),
  captureException: vi.fn(),
  eventFiltersIntegration: vi.fn(() => ({ name: 'EventFilters' })),
  functionToStringIntegration: vi.fn(() => ({ name: 'FunctionToString' })),
  globalHandlersIntegration: vi.fn(() => ({ name: 'GlobalHandlers' })),
  linkedErrorsIntegration: vi.fn(() => ({ name: 'LinkedErrors' })),
  dedupeIntegration: vi.fn(() => ({ name: 'Dedupe' })),
}))

vi.mock('@sentry/browser', () => sentry)
vi.mock('./config', () => ({
  SENTRY_DSN: 'https://public@o1.ingest.de.sentry.io/2',
  SENTRY_RELEASE: 'droneclean-studio@9.9.9',
  POSTHOG_KEY: 'phc_test',
  POSTHOG_HOST: 'https://eu.i.posthog.com',
  STUDIO_VERSION: '9.9.9',
  TELEMETRY_FEATURES: { crashReports: true, usageStats: true },
}))

const { isTelemetryOn, needsTelemetryAnswer, useTelemetryConsent } = await import('./consent')
const { applyCrashReports, reportError } = await import('./crash')
const { track, roundSeconds } = await import('./usage')
const { scrubText, scrubUrl } = await import('./scrub')

const fetchSpy = vi.fn(async () => new Response('{}'))

beforeEach(() => {
  window.localStorage.clear()
  useTelemetryConsent.setState({ loaded: false, settings: null })
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  for (const mock of Object.values(sentry)) mock.mockClear()
})

afterEach(async () => {
  await applyCrashReports(false)
  vi.unstubAllGlobals()
})

describe('the stored answer', () => {
  it('is unanswered on a fresh profile, which asks and sends nothing', async () => {
    await useTelemetryConsent.getState().load()
    const { settings } = useTelemetryConsent.getState()
    expect(settings).toBeNull()
    expect(needsTelemetryAnswer(settings)).toBe(true)
    expect(isTelemetryOn(settings, 'crashReports')).toBe(false)
    expect(isTelemetryOn(settings, 'usageStats')).toBe(false)
  })

  it('reads a broken or future value as never answered', async () => {
    for (const stored of ['not json', '{"version":2,"crashReports":true}', '[true]']) {
      window.localStorage.setItem('droneclean-telemetry', stored)
      await useTelemetryConsent.getState().load()
      expect(useTelemetryConsent.getState().settings).toBeNull()
    }
  })

  it('keeps each half on its own, and makes the id only with usage statistics', async () => {
    await useTelemetryConsent.getState().load()
    await useTelemetryConsent.getState().choose({ crashReports: true, usageStats: false })
    let stored = JSON.parse(window.localStorage.getItem('droneclean-telemetry') ?? 'null')
    expect(stored).toEqual({ version: 1, crashReports: true, usageStats: false })
    expect(needsTelemetryAnswer(useTelemetryConsent.getState().settings)).toBe(false)

    await useTelemetryConsent.getState().choose({ usageStats: true })
    stored = JSON.parse(window.localStorage.getItem('droneclean-telemetry') ?? 'null')
    expect(stored.crashReports).toBe(true)
    expect(stored.usageStats).toBe(true)
    expect(stored.installId).toMatch(/^[0-9a-f-]{36}$/)

    await useTelemetryConsent.getState().choose({ usageStats: false })
    stored = JSON.parse(window.localStorage.getItem('droneclean-telemetry') ?? 'null')
    expect(stored).toEqual({ version: 1, crashReports: true, usageStats: false })
  })

  it('asks again only for a half that was never answered', () => {
    expect(needsTelemetryAnswer({ version: 1, crashReports: false })).toBe(true)
    expect(needsTelemetryAnswer({ version: 1, crashReports: false }, { crashReports: true, usageStats: false })).toBe(
      false,
    )
  })
})

describe('usage statistics', () => {
  it('send nothing before an answer, and nothing after "no"', async () => {
    track('app_opened', {})
    useTelemetryConsent.setState({ loaded: true, settings: { version: 1, crashReports: false, usageStats: false } })
    track('project_created', { width: 1920, height: 1080, fps: 30 })
    await Promise.resolve()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('send the named event with the install id and no person profile after "yes"', async () => {
    useTelemetryConsent.setState({
      loaded: true,
      settings: { version: 1, usageStats: true, installId: '11111111-2222-3333-4444-555555555555' },
    })
    track('export_finished', {
      via: 'dialog',
      engine: 'native',
      codec: 'h265',
      container: 'mp4',
      width: 3840,
      height: 2160,
      seconds: roundSeconds(12.345),
    })
    await Promise.resolve()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://eu.i.posthog.com/i/v0/e/')
    expect(init.credentials).toBe('omit')
    const body = JSON.parse(String(init.body))
    expect(body.api_key).toBe('phc_test')
    expect(body.event).toBe('export_finished')
    expect(body.distinct_id).toBe('11111111-2222-3333-4444-555555555555')
    expect(body.properties).toMatchObject({
      via: 'dialog',
      engine: 'native',
      seconds: 12.3,
      app: 'studio',
      version: '9.9.9',
      $process_person_profile: false,
    })
    expect(Object.keys(body.properties).sort()).toEqual(
      [
        '$ip',
        '$lib',
        '$process_person_profile',
        'app',
        'codec',
        'container',
        'engine',
        'height',
        'os',
        'platform',
        'seconds',
        'version',
        'via',
        'width',
      ].sort(),
    )
  })
})

describe('crash reports', () => {
  it('never load Sentry while off', async () => {
    await applyCrashReports(false)
    reportError(new Error('boom'), 'test')
    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('start with no breadcrumbs or personal data, scrub what they send, and stop on "no"', async () => {
    await applyCrashReports(true)
    expect(sentry.init).toHaveBeenCalledTimes(1)
    const options = sentry.init.mock.calls[0]?.[0] as Record<string, unknown> & {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown> | null
    }
    expect(options.defaultIntegrations).toBe(false)
    expect(options.maxBreadcrumbs).toBe(0)
    expect(options.release).toBe('droneclean-studio@9.9.9')
    expect(options.dataCollection).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false })

    const sent = options.beforeSend({
      message: 'Could not open /Users/ann/Flights/DJI_0020.MP4',
      exception: { values: [{ type: 'Error', value: 'Decode failed for C:\\Users\\ann\\clip.mov' }] },
      user: { ip_address: '1.2.3.4' },
      breadcrumbs: [{ message: 'opened DJI_0020.MP4' }],
      request: { url: 'droneclean://app/editor/abc-123?x=1', headers: { a: 'b' } },
      sdk: { name: 'sentry.javascript.browser' },
    })
    expect(sent).toMatchObject({
      message: 'Could not open <path>',
      exception: { values: [{ value: 'Decode failed for <path>' }] },
      request: { url: 'droneclean://app/editor/<id>' },
      sdk: { settings: { infer_ip: 'never' } },
    })
    expect(sent?.user).toBeUndefined()
    expect(sent?.breadcrumbs).toBeUndefined()

    reportError(new Error('boom'), 'boundary:app')
    expect(sentry.captureException).toHaveBeenCalledTimes(1)

    await applyCrashReports(false)
    expect(sentry.close).toHaveBeenCalledTimes(1)
    expect(options.beforeSend({ message: 'late' })).toBeNull()
    reportError(new Error('after'), 'test')
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
  })
})

describe('scrubbing', () => {
  it('removes paths, media file names and project ids', () => {
    expect(scrubText('ENOENT: /Volumes/SSD/Avata/DJI_0001.MP4 missing')).toBe('ENOENT: <path> missing')
    expect(scrubText('failed on "DJI_20261115124704_0020_D.MP4"')).toBe('failed on "<file>"')
    expect(scrubText('look sunset.cube not found')).toBe('look <file> not found')
    expect(scrubText('at file:///home/ann/x.js')).toBe('at <path>')
    expect(scrubText('TypeError: undefined is not a function')).toBe('TypeError: undefined is not a function')
    expect(scrubUrl('https://droneclean.app/studio/editor/123?token=x#a')).toBe(
      'https://droneclean.app/studio/editor/<id>',
    )
  })
})
