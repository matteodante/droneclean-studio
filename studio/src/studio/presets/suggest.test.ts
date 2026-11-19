// The suggestion table of design 5.1, sections 3.2 and 4.5: DJI's file-name suffixes, the drone
// model shown beside the question, and the files that hint at nothing.

import { describe, expect, it } from 'vite-plus/test'
import { suggestColorProfile } from './suggest'

const CLIP_0020 = 'DJI_20261115124704_0020_D.MP4'

describe('suggestColorProfile', () => {
  it('suggests D-Log M for clip 0020’s `_D` suffix, with the model from the tags', () => {
    expect(suggestColorProfile({ fileName: CLIP_0020, droneModel: 'DJI Avata2' })).toEqual({
      profile: 'dlog-m',
      drone: 'DJI Avata2',
    })
  })

  it('reads the suffix through the extension and the case', () => {
    expect(suggestColorProfile({ fileName: 'DJI_20261115124704_0020_d.mp4' })).toEqual({
      profile: 'dlog-m',
      drone: null,
    })
    expect(suggestColorProfile({ fileName: 'DJI_20261115130000_0042_D-Log-M.MP4' })?.profile).toBe(
      'dlog-m',
    )
    expect(suggestColorProfile({ fileName: 'DJI_20261115130000_0042_D-Log.mov' })?.profile).toBe(
      'dlog',
    )
    expect(suggestColorProfile({ fileName: 'DJI_20261115130000_0042_d-log' })?.profile).toBe('dlog')
  })

  it('hints at nothing without the DJI suffix', () => {
    expect(suggestColorProfile({ fileName: 'DJI_20261115124704_0020.MP4' })).toBeNull()
    expect(suggestColorProfile({ fileName: 'holiday.mp4' })).toBeNull()
    expect(suggestColorProfile({ fileName: 'DJI_2026_D.MP4' })).toBeNull()
    expect(suggestColorProfile({ fileName: '' })).toBeNull()
    // A file name that merely ends in `_D` is not DJI footage.
    expect(suggestColorProfile({ fileName: 'clip_D.mp4' })).toBeNull()
    expect(suggestColorProfile({ fileName: 'IMG_0042_D.MP4' })).toBeNull()
  })

  it('keeps a drone model only when the tags carried one', () => {
    expect(suggestColorProfile({ fileName: CLIP_0020, droneModel: '  ' })?.drone).toBeNull()
    expect(suggestColorProfile({ fileName: CLIP_0020, droneModel: null })?.drone).toBeNull()
    expect(suggestColorProfile({ fileName: CLIP_0020, droneModel: 'DJI Mini 4 Pro' })?.drone).toBe(
      'DJI Mini 4 Pro',
    )
  })
})
