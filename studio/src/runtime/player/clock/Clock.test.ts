import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Clock } from './Clock'

describe('Clock playback timing', () => {
  let nowMs = 0
  let nextRafId = 1
  let rafCallbacks = new Map<number, FrameRequestCallback>()

  const runNextAnimationFrame = (nextNowMs: number) => {
    const [id, callback] = rafCallbacks.entries().next().value as [number, FrameRequestCallback]
    rafCallbacks.delete(id)
    nowMs = nextNowMs
    callback(nextNowMs)
  }

  beforeEach(() => {
    nowMs = 0
    nextRafId = 1
    rafCallbacks = new Map<number, FrameRequestCallback>()

    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
      const id = nextRafId++
      rafCallbacks.set(id, callback)
      return id
    }) as typeof requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', ((id: number) => {
      rafCallbacks.delete(id)
    }) as typeof cancelAnimationFrame)

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
  })

  it('keeps advancing with elapsed time while the tab is hidden', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    })

    clock.play()
    expect(rafCallbacks.size).toBe(1)

    runNextAnimationFrame(1000)
    expect(clock.currentFrame).toBe(30)

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })

    runNextAnimationFrame(2000)
    expect(clock.currentFrame).toBe(60)

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })

    runNextAnimationFrame(2500)
    expect(clock.currentFrame).toBe(75)

    clock.dispose()
  })

  it('advances reverse shuttle at display cadence while skipping intermediate frames', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
      initialFrame: 120,
    })
    clock.playbackRate = -2

    clock.play()
    runNextAnimationFrame(500)

    expect(clock.currentFrame).toBe(90)
    clock.dispose()
  })

  it('restarts reverse playback from the last frame only at the first boundary', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
      initialFrame: 0,
    })
    clock.playbackRate = -1

    clock.play()

    expect(clock.currentFrame).toBe(299)
    clock.dispose()
  })

  it('catches up immediately when window focus returns before the next RAF', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    })

    clock.play()
    expect(rafCallbacks.size).toBe(1)

    runNextAnimationFrame(1000)
    expect(clock.currentFrame).toBe(30)

    nowMs = 2500
    window.dispatchEvent(new Event('focus'))
    expect(clock.currentFrame).toBe(75)

    clock.dispose()
  })

  it('keeps advancing when a suspended audio clock resumes after play starts', () => {
    let audioState: AudioContextState = 'suspended'
    let audioTime = 40
    const audioContext = {
      get state() {
        return audioState
      },
      get currentTime() {
        return audioTime
      },
    } as unknown as AudioContext
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    })

    nowMs = 1_000_000
    clock.setAudioContext(audioContext)
    clock.play()
    runNextAnimationFrame(1_000_016)

    audioState = 'running'
    audioTime = 40.02
    runNextAnimationFrame(1_000_032)
    expect(clock.currentFrame).toBeGreaterThanOrEqual(0)

    audioTime = 40.52
    runNextAnimationFrame(1_000_532)
    expect(clock.currentFrame).toBe(15)

    clock.dispose()
  })

  it('keeps advancing when the audio clock suspends during playback', () => {
    let audioState: AudioContextState = 'running'
    let audioTime = 25
    const audioContext = {
      get state() {
        return audioState
      },
      get currentTime() {
        return audioTime
      },
    } as unknown as AudioContext
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    })

    clock.setAudioContext(audioContext)
    clock.play()
    audioTime = 25.5
    runNextAnimationFrame(500)
    expect(clock.currentFrame).toBe(15)

    audioState = 'suspended'
    runNextAnimationFrame(1_000_000)
    expect(clock.currentFrame).toBe(15)

    runNextAnimationFrame(1_000_500)
    expect(clock.currentFrame).toBe(30)

    clock.dispose()
  })

  it('keeps an integer rate on the frames it reported before', () => {
    const cases = [
      { fps: 24, elapsedMs: 1_000, frame: 24 },
      { fps: 25, elapsedMs: 250, frame: 6 },
      { fps: 30, elapsedMs: 1_234, frame: 37 },
      { fps: 50, elapsedMs: 500, frame: 25 },
      { fps: 60, elapsedMs: 5_000, frame: 300 },
    ]

    for (const row of cases) {
      nowMs = 0
      const clock = new Clock({ fps: row.fps, durationInFrames: 1_000 })
      clock.play()
      runNextAnimationFrame(row.elapsedMs)

      expect(clock.currentFrame).toBe(row.frame)
      // The float formula the clock used before this change gives the same frame here.
      expect(Math.floor((row.elapsedMs / 1000) * row.fps)).toBe(row.frame)
      clock.dispose()
    }
  })

  it('reports the exact frame where the old float landed one ulp short', () => {
    // (4,100 / 1000) · 30 is 122.99999999999999 in a double, so the old float formula floored
    // it to 122; 4,100 ms is exactly 123 frames at 30 fps.
    const clock = new Clock({ fps: 30, durationInFrames: 1_000 })
    clock.play()
    runNextAnimationFrame(4_100)

    expect(clock.currentFrame).toBe(123)
    clock.dispose()
  })

  describe('at 59.94', () => {
    const RATE_59_94 = 60000 / 1001

    it('lands on frame 3,596 after 60 s', () => {
      const clock = new Clock({ fps: RATE_59_94, durationInFrames: 4_000 })
      clock.play()
      runNextAnimationFrame(60_000)

      expect(clock.currentFrame).toBe(3_596)
      clock.dispose()
    })

    it('reads the decimal name 59.94 as the same rate', () => {
      const clock = new Clock({ fps: 59.94, durationInFrames: 4_000 })

      expect(clock.fps).toBe(59.94)
      expect(clock.durationInSeconds).toBe((4_000 * 1001) / 60_000)

      clock.play()
      runNextAnimationFrame(60_000)
      expect(clock.currentFrame).toBe(3_596)
      clock.dispose()
    })

    it('uses the new rate when the fps is set after construction', () => {
      const clock = new Clock({ fps: 30, durationInFrames: 4_000 })
      clock.fps = RATE_59_94

      expect(clock.fps).toBe(RATE_59_94)
      expect(clock.timeToFrame(60)).toBe(3_596)
      expect(clock.frameToTime(1)).toBe(1001 / 60_000)
      clock.dispose()
    })

    it('round-trips frames and seconds with the fraction', () => {
      const clock = new Clock({ fps: RATE_59_94, durationInFrames: 72_000 })

      for (const frame of [0, 1, 59, 60, 1_200, 3_596, 71_928]) {
        expect(clock.timeToFrame(clock.frameToTime(frame))).toBe(frame)
      }

      expect(clock.frameToTime(3_596)).toBe(59.99326666666666)
      expect(clock.timeToFrame(20)).toBe(1_199)
      expect(clock.durationInSeconds).toBe(1_201.2)

      clock.seekToTime(20)
      expect(clock.currentFrame).toBe(1_199)
      expect(clock.currentTime).toBe(clock.frameToTime(1_199))
      clock.dispose()
    })

    it('restarts its anchor at a seek while playing', () => {
      const clock = new Clock({ fps: RATE_59_94, durationInFrames: 80_000 })
      clock.play()
      runNextAnimationFrame(30_000)
      expect(clock.currentFrame).toBe(1_798)

      clock.seekToFrame(100)
      runNextAnimationFrame(31_000)
      expect(clock.currentFrame).toBe(159)

      clock.dispose()
    })

    it('stays within 1e-5 frames of the exact position after 20 minutes', () => {
      const clock = new Clock({ fps: RATE_59_94, durationInFrames: 80_000 })
      clock.play()

      // One anchor at 0, then times that ascend: the clock recomputes its position from the
      // anchor, so it sums nothing. At each boundary it is read 1e-5 frames either side; a
      // clock that had drifted, or that used the double 59.94 (0.07 frames off after 20
      // minutes), would leave the frame between the two reads. At 20 minutes exactly the
      // position is 71,928.07 frames, which floors to 71,928.
      for (const frame of [0, 1, 1_000, 35_964, 71_927]) {
        for (const offset of [1e-5, 1 - 1e-5]) {
          runNextAnimationFrame(((frame + offset) * 1000 * 1001) / 60_000)
          expect(clock.currentFrame).toBe(frame)
        }
      }

      runNextAnimationFrame(20 * 60 * 1000)
      expect(clock.currentFrame).toBe(71_928)

      clock.dispose()
    })
  })
})
