// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  formatSignedFrameDelta,
  formatTimecode,
  formatTimecodeCompact,
  formatTimecodeDotFrames,
  framesToSeconds,
  secondsToFrames,
} from './time-utils'

const RATE_23_976 = 24000 / 1001
const RATE_29_97 = 30000 / 1001
const RATE_59_94 = 60000 / 1001

describe('formatTimecodeDotFrames', () => {
  it('formats sub-minute durations as MM:SS.FF', () => {
    expect(formatTimecodeDotFrames(0, 30)).toBe('00:00.00')
    // 45 frames at 30fps = 1s 15f
    expect(formatTimecodeDotFrames(45, 30)).toBe('00:01.15')
  })

  it('rolls over into hours once the duration reaches an hour', () => {
    // Regression: previously produced total-minutes with no hour rollover
    // (e.g. "97:27.24"). 175434 frames at 30fps = 1h 37m 27s 24f.
    expect(formatTimecodeDotFrames(175434, 30)).toBe('01:37:27.24')
  })

  it('omits the hours segment below one hour', () => {
    // 59m 59s 29f at 30fps — still MM:SS.FF, no leading hours
    expect(formatTimecodeDotFrames(60 * 60 * 30 - 1, 30)).toBe('59:59.29')
  })

  it('shows hours at exactly one hour', () => {
    expect(formatTimecodeDotFrames(60 * 60 * 30, 30)).toBe('01:00:00.00')
  })
})

describe('formatTimecode at a fractional rate', () => {
  it('counts 60 frames per timecode second at 59.94, non-drop', () => {
    const cases = [
      { frame: 0, expected: '00:00:00:00' },
      { frame: 59, expected: '00:00:00:59' },
      { frame: 60, expected: '00:00:01:00' },
      { frame: 1_200, expected: '00:00:20:00' },
      { frame: 3_600, expected: '00:01:00:00' },
      { frame: 36_000, expected: '00:10:00:00' },
      { frame: 71_928, expected: '00:19:58:48' },
    ]

    for (const row of cases) {
      expect(formatTimecode(row.frame, RATE_59_94)).toBe(row.expected)
    }
  })

  it('reads the decimal name 59.94 as the same non-drop rate', () => {
    for (const fps of [59.94, 60 / 1.001, RATE_59_94]) {
      expect(formatTimecode(3_600, fps)).toBe('00:01:00:00')
    }
  })

  it('counts 30 frames per timecode second at 29.97 and at 30', () => {
    const cases = [
      { frame: 0, expected: '00:00:00:00' },
      { frame: 29, expected: '00:00:00:29' },
      { frame: 30, expected: '00:00:01:00' },
      { frame: 1_799, expected: '00:00:59:29' },
      { frame: 1_800, expected: '00:01:00:00' },
      { frame: 108_000, expected: '01:00:00:00' },
    ]

    for (const fps of [RATE_29_97, 30]) {
      for (const row of cases) {
        expect(formatTimecode(row.frame, fps)).toBe(row.expected)
      }
    }
  })

  it('keeps 23.976, 24, 25 and 50 on their nominal frame counts', () => {
    const cases = [
      { fps: RATE_23_976, frame: 23, expected: '00:00:00:23' },
      { fps: RATE_23_976, frame: 24, expected: '00:00:01:00' },
      { fps: RATE_23_976, frame: 1_440, expected: '00:01:00:00' },
      { fps: 24, frame: 1_440, expected: '00:01:00:00' },
      { fps: 25, frame: 24, expected: '00:00:00:24' },
      { fps: 25, frame: 25, expected: '00:00:01:00' },
      { fps: 25, frame: 1_499, expected: '00:00:59:24' },
      { fps: 25, frame: 1_500, expected: '00:01:00:00' },
      { fps: 50, frame: 49, expected: '00:00:00:49' },
      { fps: 50, frame: 50, expected: '00:00:01:00' },
    ]

    for (const row of cases) {
      expect(formatTimecode(row.frame, row.fps)).toBe(row.expected)
    }
  })

  it('leaves the integer rates exactly as they were', () => {
    const cases = [
      { fps: 30, frame: 0, expected: '00:00:00:00' },
      { fps: 30, frame: 45, expected: '00:00:01:15' },
      { fps: 30, frame: 1_234, expected: '00:00:41:04' },
      { fps: 25, frame: 1_499, expected: '00:00:59:24' },
      { fps: 120, frame: 119, expected: '00:00:00:119' },
    ]

    for (const row of cases) {
      expect(formatTimecode(row.frame, row.fps)).toBe(row.expected)
    }
  })
})

describe('the other timecode formatters at 59.94', () => {
  it('formats compact non-drop timecode on the nominal rate', () => {
    expect(formatTimecodeCompact(59, RATE_59_94)).toBe('00:00:59')
    expect(formatTimecodeCompact(1_200, RATE_59_94)).toBe('00:20:00')
    expect(formatTimecodeCompact(3_600, RATE_59_94)).toBe('01:00:00')
    expect(formatTimecodeCompact(36_000, RATE_59_94)).toBe('10:00:00')
    expect(formatTimecodeCompact(71_928, RATE_59_94)).toBe('19:58:48')
  })

  it('formats dot-frame non-drop timecode on the nominal rate', () => {
    expect(formatTimecodeDotFrames(59, RATE_59_94)).toBe('00:00.59')
    expect(formatTimecodeDotFrames(1_200, RATE_59_94)).toBe('00:20.00')
    expect(formatTimecodeDotFrames(3_600, RATE_59_94)).toBe('01:00.00')
    expect(formatTimecodeDotFrames(36_000, RATE_59_94)).toBe('10:00.00')
    expect(formatTimecodeDotFrames(71_928, RATE_59_94)).toBe('19:58.48')
  })

  it('formats a signed delta on the nominal rate', () => {
    expect(formatSignedFrameDelta(3_600, RATE_59_94)).toBe('+01:00:00')
    expect(formatSignedFrameDelta(-59, RATE_59_94)).toBe('-00:59')
  })

  it('rejects a rate that is not positive', () => {
    expect(() => formatTimecode(0, 0)).toThrowError(/Invalid FPS/)
    expect(() => formatTimecodeCompact(0, -1)).toThrowError(/Invalid FPS/)
    expect(() => formatTimecodeDotFrames(0, 0)).toThrowError(/Invalid FPS/)
  })
})

describe('framesToSeconds and secondsToFrames at a fractional rate', () => {
  it('converts with the fraction, not the decimal name', () => {
    // 71,928 · 1001 / 60,000 = 1199.9988 s. The old division by the double 59.94 gave 1200 s.
    expect(framesToSeconds(71_928, 59.94)).toBe(1199.9988)
    expect(71_928 / 59.94).toBe(1_200)
    expect(framesToSeconds(3_596, RATE_59_94)).toBe(59.99326666666666)
    expect(framesToSeconds(45, 30)).toBe(1.5)
  })

  it('finds the frame that contains a time', () => {
    expect(secondsToFrames(1_199.9988, 59.94)).toBe(71_928)
    expect(secondsToFrames(1, 59.94)).toBe(60)
    expect(secondsToFrames(20, 59.94)).toBe(1_199)
    expect(secondsToFrames(1.5, 30)).toBe(45)
  })

  it('round-trips a frame through the fraction', () => {
    expect(secondsToFrames(framesToSeconds(71_928, 59.94), 59.94)).toBe(71_928)
  })

  it('rejects a rate that is not positive', () => {
    expect(() => framesToSeconds(0, 0)).toThrowError(/Invalid FPS/)
    expect(() => secondsToFrames(0, -1)).toThrowError(/Invalid FPS/)
  })
})
