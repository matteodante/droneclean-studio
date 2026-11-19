// @vitest-environment node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { FREECUT_LICENSE_TEXT } from './freecut-license'

describe('FreeCut licence notice', () => {
  it('is exactly the text of studio/LICENSE', () => {
    const licensePath = fileURLToPath(new URL('../../../LICENSE', import.meta.url))
    expect(FREECUT_LICENSE_TEXT).toBe(readFileSync(licensePath, 'utf8').trimEnd())
  })

  it('is the MIT licence that credits FreeCut', () => {
    expect(FREECUT_LICENSE_TEXT).toContain('MIT License')
    expect(FREECUT_LICENSE_TEXT).toContain('Copyright (c) 2025 FreeCut')
    expect(FREECUT_LICENSE_TEXT).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  })
})
