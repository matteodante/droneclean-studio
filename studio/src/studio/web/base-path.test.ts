import { describe, expect, it } from 'vitest'
import { stripBase, withBase } from './base-path'

describe('base path helpers', () => {
  it('joins a path to the base', () => {
    expect(withBase('gyroflow/wasm/js/gyro-worker.js', '/studio/')).toBe(
      '/studio/gyroflow/wasm/js/gyro-worker.js',
    )
    expect(withBase('/editor/a', '/studio/')).toBe('/studio/editor/a')
    expect(withBase('/sw.js', '/')).toBe('/sw.js')
  })

  it('strips the base from a pathname', () => {
    expect(stripBase('/studio/projects', '/studio/')).toBe('/projects')
    expect(stripBase('/studio/', '/studio/')).toBe('/')
    expect(stripBase('/studio', '/studio/')).toBe('/')
    expect(stripBase('/studiox/a', '/studio/')).toBe('/studiox/a')
    expect(stripBase('/editor/a', '/')).toBe('/editor/a')
  })
})
