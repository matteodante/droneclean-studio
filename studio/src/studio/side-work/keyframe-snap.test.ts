import { describe, expect, it } from 'vite-plus/test'
import {
  chooseFilmstripFrameTime,
  createKeyframeLookup,
  medianGap,
  tileSpacings,
  type KeyPacketSource,
} from './keyframe-snap'

const hevc = { interval: 0.5, frameDuration: 1 / 60 }

describe('chooseFilmstripFrameTime', () => {
  it('takes the nearest keyframe within half a spacing when tiles are wider than the keyframes', () => {
    // keyframes every 0.5 s, tiles 1 s apart: tile at 3.0 sits on a keyframe, tile at 3.2 snaps back to 3.0
    expect(chooseFilmstripFrameTime(3.2, 1, { prev: 3.0, next: 3.5 }, hevc)).toBe(3.0)
    expect(chooseFilmstripFrameTime(3.4, 1, { prev: 3.0, next: 3.5 }, hevc)).toBe(3.5)
  })

  it('keeps the exact frame when tiles are as dense as the keyframes or denser', () => {
    expect(chooseFilmstripFrameTime(3.2, 0.5, { prev: 3.0, next: 3.5 }, hevc)).toBe(3.2)
    expect(chooseFilmstripFrameTime(3.2, 0.25, { prev: 3.0, next: 3.5 }, hevc)).toBe(3.2)
  })

  it('keeps the exact frame when no keyframe is within half a spacing', () => {
    const sparse = { interval: 3, frameDuration: 1 / 30 }
    // keyframes at 0 and 3, tile at 1.5 with spacing 2: both are 1.5 away, bound is 1
    expect(chooseFilmstripFrameTime(1.5, 2, { prev: 0, next: 3 }, sparse)).toBe(1.5)
    expect(chooseFilmstripFrameTime(1.5, 2, { prev: null, next: null }, sparse)).toBe(1.5)
  })

  it('never moves a tile further than half its spacing', () => {
    const sparse = { interval: 1.2, frameDuration: 1 / 30 }
    for (let t = 0; t < 10; t += 0.13) {
      const prev = Math.floor(t / 1.2) * 1.2
      const out = chooseFilmstripFrameTime(t, 2, { prev, next: prev + 1.2 }, sparse)
      expect(Math.abs(out - t)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('leaves an all-keyframe (intra) clip unchanged', () => {
    const intra = { interval: 1 / 30, frameDuration: 1 / 30 }
    expect(chooseFilmstripFrameTime(3.2, 1, { prev: 3.2, next: 3.2333 }, intra)).toBe(3.2)
  })
})

describe('tileSpacings', () => {
  it('uses the smaller gap to a neighbouring tile, in seconds', () => {
    const map = tileSpacings([0, 2, 3, 10], 1)
    expect(map.get(0)).toBe(2)
    expect(map.get(2)).toBe(1)
    expect(map.get(10)).toBe(7)
  })
  it('falls back to one tile period for a single tile', () => {
    expect(tileSpacings([5], 1).get(5)).toBe(1)
  })
})

describe('medianGap', () => {
  it('is the median of consecutive gaps', () => {
    expect(medianGap([0, 0.5, 1, 1.5, 3])).toBe(0.5)
    expect(medianGap([1])).toBe(0)
  })
})

describe('createKeyframeLookup', () => {
  const keys = Array.from({ length: 20 }, (_, i) => i * 0.5)
  const source: KeyPacketSource = {
    getFirstPacket: async () => ({ timestamp: 0 }),
    getKeyPacket: async (t) => {
      const k = keys.filter((k) => k <= t)
      return k.length ? { timestamp: k[k.length - 1]! } : null
    },
    getNextKeyPacket: async (p) => {
      const next = keys.find((k) => k > (p as unknown as { timestamp: number }).timestamp)
      return next === undefined ? null : { timestamp: next }
    },
  }

  it('finds the keyframe interval and the neighbours of a time', async () => {
    const lookup = await createKeyframeLookup(source, 1 / 60)
    expect(lookup?.profile.interval).toBeCloseTo(0.5)
    expect(await lookup!.neighbours(3.2)).toEqual({ prev: 3, next: 3.5 })
    expect(await lookup!.neighbours(9.9)).toEqual({ prev: 9.5, next: null })
  })

  it('returns null when the track has no packets', async () => {
    const empty: KeyPacketSource = {
      getFirstPacket: async () => null,
      getKeyPacket: async () => null,
      getNextKeyPacket: async () => null,
    }
    expect(await createKeyframeLookup(empty, 1 / 30)).toBeNull()
  })
})
