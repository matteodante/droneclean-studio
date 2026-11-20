/**
 * The page's copies of the desktop shell's telemetry values (`desktop/src/shared/telemetry.ts`,
 * `desktop/src/main/telemetry/report.ts`), which the page cannot import: the same addresses and
 * the same scrubbing. `desktop/test/telemetry.test.mjs` holds the launcher's copy.
 */
import { describe, expect, it } from 'vite-plus/test'
import * as shared from '../../../desktop/src/shared/telemetry'
import { scrubText as mainScrub } from '../../../desktop/src/main/telemetry/report'
import { POSTHOG_HOST, POSTHOG_KEY, SENTRY_DSN } from './config'
import { scrubText } from './scrub'

describe('the page and the desktop shell', () => {
  it('name the same Sentry project and PostHog project', () => {
    expect(SENTRY_DSN).toBe(shared.TELEMETRY_DESTINATIONS.sentryDsn)
    expect(POSTHOG_KEY).toBe(shared.TELEMETRY_DESTINATIONS.posthogKey)
    expect(POSTHOG_HOST).toBe(shared.TELEMETRY_DESTINATIONS.posthogHost)
  })

  it('scrub messages the same way', () => {
    for (const sample of [
      'ENOENT: /Volumes/SSD/Avata 2 - 15 novembre 2026/DJI_0001.MP4 missing',
      'failed on "DJI_20261115124704_0020_D.MP4"',
      'C:\\Users\\Ann Lee\\Videos\\clip.mov is busy',
      'look sunset.cube not found',
      'TypeError: undefined is not a function',
    ]) {
      expect(scrubText(sample)).toBe(mainScrub(sample))
    }
    expect(scrubText('ENOENT: /Volumes/SSD/Avata 2 - 15 novembre 2026/DJI_0001.MP4 missing')).toBe(
      'ENOENT: <path> missing',
    )
  })
})
