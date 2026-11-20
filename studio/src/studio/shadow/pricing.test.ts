import { describe, expect, it } from 'vite-plus/test'
import { CONFIG } from './api/__fixtures__/recorded'
import snapshot from './api/contract-snapshot.json'
import { TRACK_CREDITS, clipFollowCredits, pieceCredits, trackCredits } from './pricing'

describe('the price of following the shadow', () => {
  it("is the cloud's rule as its pricing.ts says it at the recorded commit, and so is the recorded GET /v1/config", () => {
    // `prices` is read from the cloud's own `pricing.ts` by `checks/shadow-contract-snapshot.mjs`.
    expect(TRACK_CREDITS).toEqual(snapshot.prices.track)
    expect(CONFIG.track.credits).toEqual(snapshot.prices.track)
    expect(CONFIG.preview.credits).toEqual(snapshot.prices.preview)
    expect(CONFIG.welcomeCredits).toBe(snapshot.prices.welcomeCredits)
  })

  it("gives every piece the price the cloud's own trackCredits gave it at the recorded commit", () => {
    const samples = snapshot.prices.trackSamples as [number, number | null, number][]
    expect(samples.length).toBeGreaterThan(10)
    for (const [seconds, fps, credits] of samples) {
      expect(trackCredits(seconds, fps ?? Number.NaN), `${seconds} s at ${fps} fps`).toBe(credits)
      expect(pieceCredits({ durationSeconds: seconds, frameRate: fps ?? undefined })).toBe(credits)
    }
  })

  it('counts a credit a second at 30 fps, twice at 60, 4 times at 120, at least 5, rounded up once', () => {
    expect([23.976, 30, 59.94, 60, 119.88, 120].map((fps) => trackCredits(10, fps))).toEqual([
      10, 10, 20, 20, 40, 40,
    ])
    expect(trackCredits(10.2, 30)).toBe(11)
    expect(trackCredits(2, 30)).toBe(5)
    expect(trackCredits(Number.NaN, 30)).toBe(5)
    expect(trackCredits(10, 0)).toBe(10)
  })

  it("prices a clip by its part of the source: its trim, its source's length, or the library's", () => {
    const rate = { num: 60000, den: 1001 }
    // 600 frames at 59.94 fps: 10.01 s, 1.998 times the work of a second at 30 fps.
    expect(clipFollowCredits({ sourceStart: 3000, sourceEnd: 3600 }, rate, 230.88)).toBe(20)
    expect(clipFollowCredits({ sourceDuration: 1800 }, { num: 30, den: 1 }, undefined)).toBe(60)
    expect(clipFollowCredits({}, { num: 30, den: 1 }, 95)).toBe(95)
    expect(clipFollowCredits({}, { num: 30, den: 1 }, undefined)).toBe(5)
  })
})
