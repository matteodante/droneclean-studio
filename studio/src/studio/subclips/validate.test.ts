// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Subclip } from './model'
import { getParentFrameCount, getRangeError, getSubclipValidity } from './validate'

const subclip: Subclip = {
  id: 's',
  mediaId: 'm',
  name: 'n',
  startFrame: 100,
  endFrame: 500,
  sourceFps: 59.94,
  createdAt: 0,
}

describe('subclip validity', () => {
  it('counts frames of a 10 s file at 59.94', () => {
    expect(getParentFrameCount({ duration: 10.01, fps: 59.94 })).toBe(600)
  })

  it('is valid for the file it was cut from', () => {
    expect(getSubclipValidity(subclip, { duration: 10.01, fps: 59.94 })).toEqual({ valid: true })
  })

  it('marks a shorter parent invalid, never clamped', () => {
    expect(getSubclipValidity(subclip, { duration: 5, fps: 59.94 })).toEqual({
      valid: false,
      reason: 'range-past-end',
    })
    expect(subclip.endFrame).toBe(500)
  })

  it('marks a changed rate invalid, and a missing parent', () => {
    expect(getSubclipValidity(subclip, { duration: 10, fps: 60 })).toEqual({
      valid: false,
      reason: 'rate-changed',
    })
    expect(getSubclipValidity(subclip, undefined)).toEqual({
      valid: false,
      reason: 'parent-missing',
    })
  })

  it('describes range errors', () => {
    expect(getRangeError(0, 1)).toBeNull()
    expect(getRangeError(0, 601, 600)).not.toBeNull()
    expect(getRangeError(0, 600, 600)).toBeNull()
  })
})
