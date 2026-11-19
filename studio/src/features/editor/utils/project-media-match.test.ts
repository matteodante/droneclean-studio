// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ProjectResolution } from '@/types/project'
import type { Rate } from '@/studio/time'
import { getProjectMediaMatchSuggestion } from './project-media-match'

const FPS_59_94 = 59.94005994005994

const PROJECT_30: ProjectResolution = { width: 1920, height: 1080, fps: 30 }
const PROJECT_59_94: ProjectResolution = { width: 1920, height: 1080, fps: FPS_59_94 }
const PROJECT_60: ProjectResolution = { width: 1920, height: 1080, fps: 60 }

const RATE_23_976: Rate = { num: 24000, den: 1001 }
const RATE_29_97: Rate = { num: 30000, den: 1001 }
const RATE_59_94: Rate = { num: 60000, den: 1001 }

function suggestionFor(project: ProjectResolution, sourceFps: number) {
  return getProjectMediaMatchSuggestion(project, { width: 1920, height: 1080, fps: sourceFps })
}

describe('getProjectMediaMatchSuggestion', () => {
  it.each([
    { sourceFps: FPS_59_94, rate: RATE_59_94, label: '59.94', rounded: false },
    { sourceFps: 60 / 1.001, rate: RATE_59_94, label: '59.94', rounded: false },
    { sourceFps: 29.97002997002997, rate: RATE_29_97, label: '29.97', rounded: false },
    { sourceFps: 23.976023976023978, rate: RATE_23_976, label: '23.976', rounded: false },
    { sourceFps: 25, rate: { num: 25, den: 1 }, label: '25', rounded: false },
    { sourceFps: 60, rate: { num: 60, den: 1 }, label: '60', rounded: false },
    { sourceFps: 120, rate: { num: 60, den: 1 }, label: '60', rounded: true },
  ])(
    'suggests the $label project rate for a $sourceFps fps clip (rounded: $rounded)',
    ({ sourceFps, rate, label, rounded }) => {
      const suggestion = suggestionFor(PROJECT_30, sourceFps)

      expect(suggestion.rate).toEqual(rate)
      expect(suggestion.matchedFpsLabel).toBe(label)
      expect(suggestion.fpsWasRounded).toBe(rounded)
      expect(suggestion.fpsDiffers).toBe(true)
      expect(suggestion.sizeDiffers).toBe(false)
      expect(suggestion.hasChanges).toBe(true)
    },
  )

  it('sees no rate difference between a 59.94 project and a 59.94 clip', () => {
    const suggestion = suggestionFor(PROJECT_59_94, FPS_59_94)

    expect(suggestion.fpsDiffers).toBe(false)
    expect(suggestion.hasChanges).toBe(false)
  })

  it('sees no rate difference between a 59.94 project and mediabunny 60/1.001', () => {
    const suggestion = suggestionFor(PROJECT_59_94, 60 / 1.001)

    expect(suggestion.fpsDiffers).toBe(false)
    expect(suggestion.hasChanges).toBe(false)
  })

  it('sees a rate difference between a 60 project and a 59.94 clip', () => {
    const suggestion = suggestionFor(PROJECT_60, FPS_59_94)

    expect(suggestion.fpsDiffers).toBe(true)
    expect(suggestion.hasChanges).toBe(true)
  })

  it('suggests the clip size when it differs', () => {
    const suggestion = getProjectMediaMatchSuggestion(PROJECT_30, {
      width: 3840,
      height: 2160,
      fps: 30,
    })

    expect(suggestion.width).toBe(3840)
    expect(suggestion.height).toBe(2160)
    expect(suggestion.sizeDiffers).toBe(true)
    expect(suggestion.fpsDiffers).toBe(false)
    expect(suggestion.hasChanges).toBe(true)
  })
})
