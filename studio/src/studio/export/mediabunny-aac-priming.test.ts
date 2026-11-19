import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * An AAC encoder starts its output with priming samples (2,112 for the platform's: 44 ms at 48 kHz).
 * The export is in step with the picture only because mediabunny measures that priming and stamps the
 * packets that much early, so the muxer writes an edit list that skips it (found on 19 Nov 2026: on
 * 1.54.0, which does neither, every AAC export had its sound 44.0 ms late). The browser measurement
 * `bench/measurements/aac-sync.mjs` proves the result; this test keeps the dependency from going back
 * to a version without it.
 */
const FIRST_VERSION_WITH_PRIMING_SHIFT = [1, 66, 1]

function atLeast(version: string, minimum: number[]): boolean {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10))
  for (let i = 0; i < minimum.length; i++) {
    const have = parts[i] ?? 0
    if (have !== minimum[i]!) return have > minimum[i]!
  }
  return true
}

function installed(path: string): string {
  return readFileSync(join(process.cwd(), 'node_modules/mediabunny', path), 'utf8')
}

describe('mediabunny and the AAC encoder delay', () => {
  it('is a version that stamps encoder priming and writes the edit list that skips it', () => {
    const manifest = JSON.parse(installed('package.json')) as { version: string }
    expect(atLeast(manifest.version, FIRST_VERSION_WITH_PRIMING_SHIFT)).toBe(true)
  })

  it('has the priming shift in the audio encoder wrapper', () => {
    expect(installed('dist/modules/src/media-source.js')).toContain('detectAudioEncoderPrimingShift')
  })
})
