// @vitest-environment node

// What the two colour passes share, held without a GPU: the vertex stage that covers the target
// and the size check every `encode` makes. The pipelines themselves are the probe's.

import { describe, expect, it } from 'vite-plus/test'
import { FULLSCREEN_VERTEX_WGSL, assertPassSize } from './pass'

describe('FULLSCREEN_VERTEX_WGSL', () => {
  it('declares the vertex stage both colour passes draw with, and no vertex buffer', () => {
    expect(FULLSCREEN_VERTEX_WGSL).toContain('@vertex')
    expect(FULLSCREEN_VERTEX_WGSL).toContain('fn vertexMain(@builtin(vertex_index) index: u32)')
    expect(FULLSCREEN_VERTEX_WGSL).not.toContain('@location')
    expect(FULLSCREEN_VERTEX_WGSL).not.toContain('@group')
    // Three corners outside the target: one triangle covers it whole
    expect(FULLSCREEN_VERTEX_WGSL.match(/vec2f\(/g)).toHaveLength(3)
  })
})

describe('assertPassSize', () => {
  it('accepts a positive whole size, the smallest one included', () => {
    expect(() => assertPassSize('encode', { width: 1, height: 1 })).not.toThrow()
    expect(() => assertPassSize('encode', { width: 3840, height: 2160 })).not.toThrow()
  })

  it('refuses a size no texture can have, naming the call', () => {
    expect(() => assertPassSize('InputColorPass.encode', { width: 0, height: 1 })).toThrow(
      /InputColorPass\.encode: the size must be positive whole pixels, got 0x1/,
    )
    expect(() => assertPassSize('LookPass.encode', { width: 1, height: -2 })).toThrow(/1x-2/)
    expect(() => assertPassSize('encode', { width: 1.5, height: 2 })).toThrow(/1\.5x2/)
  })
})
