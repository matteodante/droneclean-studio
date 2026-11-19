// The drone model a clip's file names in its tags (design 5.1, section 4.5), and the files that
// name none.

import { describe, expect, it } from 'vite-plus/test'
import { droneModelFromTags } from './drone-model'

describe('droneModelFromTags', () => {
  it('reads the model from the MP4 `©too` tag', () => {
    expect(droneModelFromTags({ raw: { '©too': 'DJI Avata2' } })).toBe('DJI Avata2')
    expect(droneModelFromTags({ raw: { '©too': 'DJI Mavic 3 Pro' } })).toBe('DJI Mavic 3 Pro')
  })

  it('falls back to the `©dji` blob, which holds the same string in a box shell', () => {
    const shell = new TextEncoder().encode(
      '\u0000\u0000\u0000\u001a\u00a9too\u0000\u0000\u0000\u0000DJI Avata2\u0000',
    )
    expect(droneModelFromTags({ raw: { '©dji': shell } })).toBe('DJI Avata2')
    expect(droneModelFromTags({ raw: { '©dji': '©too DJI Mavic 3 Pro' } })).toBe('DJI Mavic 3 Pro')
  })

  it('names no drone when the tags name something else or nothing', () => {
    // An ffmpeg re-mux writes its own writer string into `©too`.
    expect(droneModelFromTags({ raw: { '©too': 'Lavf63.1.102' } })).toBeUndefined()
    expect(droneModelFromTags({ raw: { '©cmt': 'EIS:OFF;FOV:Normal;' } })).toBeUndefined()
    expect(droneModelFromTags({ raw: {} })).toBeUndefined()
    expect(droneModelFromTags({})).toBeUndefined()
    expect(droneModelFromTags(null)).toBeUndefined()
    expect(droneModelFromTags(undefined)).toBeUndefined()
  })
})
