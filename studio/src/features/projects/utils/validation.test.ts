// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { createProjectFormSchema } from './validation'

const schema = createProjectFormSchema((key) => key)

function parseFps(fps: number) {
  return schema.safeParse({ name: 'Project', width: 1920, height: 1080, fps })
}

describe('createProjectFormSchema fps', () => {
  it.each([
    { fps: 23.976023976023978, reason: '23.976' },
    { fps: 24, reason: '24' },
    { fps: 25, reason: '25' },
    { fps: 29.97002997002997, reason: '29.97' },
    { fps: 30, reason: '30' },
    { fps: 50, reason: '50' },
    { fps: 59.94005994005994, reason: '59.94' },
    { fps: 60, reason: '60' },
    { fps: 120, reason: 'the legacy 120' },
    { fps: 240, reason: 'the legacy 240' },
    { fps: 59.94, reason: 'the decimal name 59.94' },
  ])('accepts $reason', ({ fps }) => {
    const result = parseFps(fps)

    expect(result.success).toBe(true)
    expect(result.data?.fps).toBe(fps)
  })

  it.each([
    { fps: 0, reason: 'zero' },
    { fps: 241, reason: 'above 240' },
    { fps: Number.NaN, reason: 'NaN' },
    { fps: 30.5, reason: 'a rate the project does not offer' },
    { fps: 47.5, reason: 'a rate between two offered ones' },
  ])('rejects $reason', ({ fps }) => {
    expect(parseFps(fps).success).toBe(false)
  })
})
