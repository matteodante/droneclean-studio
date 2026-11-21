import { describe, expect, it } from 'vite-plus/test'
import { ShadowCutError } from './errors'

describe('ShadowCutError', () => {
  it.each(['no-video', 'no-keyframe'] as const)('says %s in plain words', (code) => {
    const error = new ShadowCutError(code)

    expect(error.code).toBe(code)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/^This (file|video) /)
    expect(error.message).not.toMatch(/shadow cut:/)
  })
})
