// The shipped state of the looks area: shown. The switch was turned on once the packaged end-to-end test
// (`desktop/test/e2e.mjs`) had added a look to the library, chosen it on a clip, read the preview and the
// exported frame, and undone it; this file fails if the switch is turned off again without a decision.

import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { render } from '@testing-library/react'
import { i18n } from '@/i18n'
import { FEATURE_SWITCHES } from '@/studio/feature-switches'
import { ColorPresetSection } from '@/studio/presets/ColorPresetSection'
import type { VideoItem } from '@/types/timeline'
import { LooksSection } from './LooksSection'

// This file reads the real switches: the clip panel draws the look group beside the colour profile group.

beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      presets: {
        profile: {
          label: 'Colour profile',
          unset: 'Not set',
          suggested: 'Suggested: {{profile}}?',
          apply: 'Apply',
        },
        looks: { title: 'Looks' },
      },
    },
    true,
    true,
  )
})

const CLIP: VideoItem = {
  id: 'clip-1',
  trackId: 'track-1',
  type: 'video',
  label: 'DJI_20261115124704_0020_D.MP4',
  src: 'blob:clip-1',
  from: 0,
  durationInFrames: 60,
  sourceFps: 59.94,
  sourceWidth: 3840,
  sourceHeight: 2880,
}

describe('the looks area (shipped switch)', () => {
  it('is shown by default', () => {
    const { container } = render(<LooksSection items={[CLIP]} />)

    expect(FEATURE_SWITCHES.looks).toBe(true)
    expect(container.querySelector('[data-testid="looks-section"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="look-select"]')).toBeTruthy()
  })

  it('is drawn in the clip panel beside the colour profile section', () => {
    const { container } = render(<ColorPresetSection items={[CLIP]} />)

    expect(container.querySelector('[data-testid="color-preset-section"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="looks-section"]')).toBeTruthy()
  })
})
