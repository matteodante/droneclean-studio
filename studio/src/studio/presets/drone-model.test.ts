// The drone model a clip's file names in its tags (design 5.1, section 4.5), and the files that
// name none.

import { describe, expect, it } from 'vite-plus/test'
import { dlogMUncheckedFor, droneDisplayName, droneModelFromTags, knownDjiDrone } from './drone-model'

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

describe('knownDjiDrone', () => {
  it('recognises the Avata 2, Mini 4 Pro and Air 3 by name, spaced or not, and the Mini 4 Pro by its FC8482 code', () => {
    expect(knownDjiDrone('DJI Avata2')).toBe('avata-2')
    expect(knownDjiDrone('DJI Avata 2')).toBe('avata-2')
    expect(knownDjiDrone('DJI Mini4Pro')).toBe('mini-4-pro')
    expect(knownDjiDrone('DJI Mini 4 Pro')).toBe('mini-4-pro')
    expect(knownDjiDrone('DJI FC8482')).toBe('mini-4-pro')
    expect(knownDjiDrone('DJI Air3')).toBe('air-3')
    expect(knownDjiDrone('DJI Air 3')).toBe('air-3')
  })

  it('does not take the Air 3S, other drones or nothing for one of them', () => {
    expect(knownDjiDrone('DJI Air3S')).toBeNull()
    expect(knownDjiDrone('DJI Mini 3 Pro')).toBeNull()
    expect(knownDjiDrone('DJI Mavic 3 Pro')).toBeNull()
    expect(knownDjiDrone(null)).toBeNull()
    expect(knownDjiDrone(undefined)).toBeNull()
  })

  it('writes the names a person uses and flags only the drones D-Log M was not checked on', () => {
    expect(droneDisplayName('DJI Avata2')).toBe('DJI Avata 2')
    expect(droneDisplayName('DJI Mavic 3 Pro')).toBe('DJI Mavic 3 Pro')
    expect(dlogMUncheckedFor('DJI Mini4Pro')).toBe(true)
    expect(dlogMUncheckedFor('DJI Air3')).toBe(true)
    expect(dlogMUncheckedFor('DJI Avata2')).toBe(false)
    expect(dlogMUncheckedFor('DJI Mavic 3 Pro')).toBe(false)
  })
})
