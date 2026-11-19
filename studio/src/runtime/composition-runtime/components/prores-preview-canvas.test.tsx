import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { averageSpeed, type SpeedCurve } from '@/studio/speed'

/**
 * The design's 1x -> 4x -> 1x ramp (design 7.1, section 5.2) cut at its frame 6, where the
 * source position is 7.8 frames: `sourceStart` 7 and the 0.8 remainder `sourceFrameOffset`
 * (design 7.1, section 4.6).
 */
const CUT_AT_SIX: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1.6 },
    { frame: 24, speed: 4 },
    { frame: 564, speed: 4 },
    { frame: 594, speed: 1 },
  ],
}
const PROJECT_59_94 = 59.94

const clockMock = vi.hoisted(() => ({
  currentFrame: 0,
}))
const sessionMock = vi.hoisted(() => ({
  getSampleForTime: vi.fn((_sourceTime: number) => Promise.resolve(null)),
}))
const acquireProResSessionMock = vi.hoisted(() =>
  vi.fn(() => ({
    session: Promise.resolve(sessionMock),
    release: vi.fn(),
  })),
)

vi.mock('@/runtime/composition-runtime/deps/player', () => ({
  useClock: () => ({
    currentFrame: clockMock.currentFrame,
    onFrameChange: () => () => {},
  }),
  useSequenceContext: () => ({ from: 0 }),
}))

vi.mock('../hooks/use-player-compat', () => ({
  useVideoConfig: () => ({ fps: PROJECT_59_94 }),
}))

vi.mock('@/infrastructure/browser/prores-sink-cache', () => ({
  acquireProResSession: acquireProResSessionMock,
}))

import { ProResPreviewCanvas } from './prores-preview-canvas'

describe('ProResPreviewCanvas', () => {
  beforeEach(() => {
    clockMock.currentFrame = 0
    sessionMock.getSampleForTime.mockClear()
    acquireProResSessionMock.mockClear()
  })

  it('decodes the parent’s source frame after a cut between two source frames', async () => {
    clockMock.currentFrame = 1

    render(
      <ProResPreviewCanvas
        itemId="cut-clip"
        src="blob:prores"
        safeTrimBefore={7}
        sourceFps={PROJECT_59_94}
        playbackRate={averageSpeed(CUT_AT_SIX)}
        speedCurve={CUT_AT_SIX}
        sourceFrameOffset={{ num: 4, den: 5 }}
        onError={() => {}}
      />,
    )

    await waitFor(() => {
      expect(sessionMock.getSampleForTime).toHaveBeenCalledTimes(1)
    })

    // The child's frame 1 is source frame 9 of the parent (the parent's frame 7); without
    // the 0.8 remainder the curve's integral alone lands on frame 8.
    expect(sessionMock.getSampleForTime.mock.calls[0]?.[0]).toBeCloseTo(9 / PROJECT_59_94)
  })
})
