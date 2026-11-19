import * as React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vite-plus/test'
import { render } from '@testing-library/react'
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

const getClipElementMock = vi.fn()
const onFrameChangeMock = vi.fn(() => vi.fn())
const clockMock = {
  currentFrame: 0,
  onFrameChange: onFrameChangeMock,
}
let isPlayingMock = true

vi.mock('@/runtime/composition-runtime/deps/player', () => ({
  useClock: () => clockMock,
  useVideoSourcePool: () => ({ getClipElement: getClipElementMock }),
}))

vi.mock('./use-player-compat', () => ({
  useIsPlaying: () => isPlayingMock,
}))

import {
  getTransitionSyncPlaybackRate,
  useTransitionParticipantSync,
  type TransitionSyncParticipant,
} from './use-transition-participant-sync'

function SyncHarness({
  participants,
  groupMinFrom,
  timelineFps,
}: {
  participants: TransitionSyncParticipant[]
  groupMinFrom: number
  timelineFps: number
}) {
  useTransitionParticipantSync(participants, groupMinFrom, timelineFps)
  return null
}

const createVideo = (overrides: Partial<HTMLVideoElement> = {}) => {
  const video = document.createElement('video')
  Object.defineProperties(video, {
    duration: { configurable: true, value: overrides.duration ?? 100 },
    paused: { configurable: true, writable: true, value: overrides.paused ?? false },
    readyState: { configurable: true, value: overrides.readyState ?? 4 },
  })
  video.currentTime = overrides.currentTime ?? 0
  video.playbackRate = overrides.playbackRate ?? 1
  video.pause = vi.fn(() => {
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
  })
  video.play = vi.fn(() => Promise.resolve())
  return video
}

describe('getTransitionSyncPlaybackRate', () => {
  it('keeps the leader on the nominal playback rate', () => {
    expect(getTransitionSyncPlaybackRate(1, 0.04, 'leader')).toBe(1)
  })

  it('slows down a follower when it is ahead of the shared target', () => {
    expect(getTransitionSyncPlaybackRate(1, 0.08, 'follower')).toBeLessThan(1)
  })

  it('speeds up a follower when it is behind the shared target', () => {
    expect(getTransitionSyncPlaybackRate(1, -0.08, 'follower')).toBeGreaterThan(1)
  })

  it('clamps follower correction to a bounded range', () => {
    expect(getTransitionSyncPlaybackRate(1, 10, 'follower')).toBeGreaterThanOrEqual(0.94)
    expect(getTransitionSyncPlaybackRate(1, -10, 'follower')).toBeLessThanOrEqual(1.06)
  })
})

describe('useTransitionParticipantSync', () => {
  beforeEach(() => {
    clockMock.currentFrame = 10
    getClipElementMock.mockReset()
    onFrameChangeMock.mockClear()
    isPlayingMock = true
  })

  it('does not pause or seek premount participants held by a transition session', () => {
    clockMock.currentFrame = 20
    const heldVideo = createVideo({ currentTime: 1.5, paused: false })
    heldVideo.dataset.transitionHold = '1'
    const freeVideo = createVideo({ currentTime: 1.5, paused: false })
    getClipElementMock.mockImplementation((clipId: string) =>
      clipId === 'held' ? heldVideo : freeVideo,
    )

    render(
      React.createElement(SyncHarness, {
        participants: [
          {
            poolClipId: 'held',
            safeTrimBefore: 48,
            sourceFps: 24,
            playbackRate: 1,
            sequenceFrameOffset: 20,
            role: 'leader',
          },
          {
            poolClipId: 'free',
            safeTrimBefore: 48,
            sourceFps: 24,
            playbackRate: 1,
            sequenceFrameOffset: 20,
            role: 'follower',
          },
        ],
        groupMinFrom: 10,
        timelineFps: 30,
      }),
    )

    expect(heldVideo.pause).not.toHaveBeenCalled()
    expect(heldVideo.currentTime).toBe(1.5)
    expect(freeVideo.pause).toHaveBeenCalledTimes(1)
    expect(freeVideo.currentTime).toBe(2)
  })

  it('does not overwrite active participants owned by a transition session', () => {
    clockMock.currentFrame = 40
    const heldVideo = createVideo({ currentTime: 3.25, paused: false })
    heldVideo.dataset.transitionHold = '1'
    heldVideo.playbackRate = 1.5
    getClipElementMock.mockReturnValue(heldVideo)

    render(
      React.createElement(SyncHarness, {
        participants: [
          {
            poolClipId: 'held',
            safeTrimBefore: 0,
            sourceFps: 30,
            playbackRate: 1,
            sequenceFrameOffset: 0,
            role: 'leader',
          },
        ],
        groupMinFrom: 0,
        timelineFps: 30,
      }),
    )

    expect(heldVideo.currentTime).toBe(3.25)
    expect(heldVideo.playbackRate).toBe(1.5)
    expect(heldVideo.play).not.toHaveBeenCalled()
  })

  it('syncs participants against source-native FPS and per-item sequence offsets', () => {
    clockMock.currentFrame = 25
    const leader = createVideo({ currentTime: 0, paused: true })
    const follower = createVideo({ currentTime: 0, paused: true })
    getClipElementMock.mockImplementation((clipId: string) =>
      clipId === 'leader' ? leader : follower,
    )

    render(
      React.createElement(SyncHarness, {
        participants: [
          {
            poolClipId: 'leader',
            safeTrimBefore: 48,
            sourceFps: 24,
            playbackRate: 1,
            sequenceFrameOffset: 0,
            role: 'leader',
          },
          {
            poolClipId: 'follower',
            safeTrimBefore: 120,
            sourceFps: 60,
            playbackRate: 1,
            sequenceFrameOffset: 10,
            role: 'follower',
          },
        ],
        groupMinFrom: 10,
        timelineFps: 30,
      }),
    )

    expect(leader.currentTime).toBeCloseTo(2.5)
    expect(follower.currentTime).toBeCloseTo(2 + 5 / 30)
    expect(leader.play).toHaveBeenCalledTimes(1)
    expect(follower.play).toHaveBeenCalledTimes(1)
  })

  it('places a cut curved clip on the parent’s source frame', () => {
    clockMock.currentFrame = 11
    const video = createVideo({ currentTime: 0, paused: true })
    getClipElementMock.mockReturnValue(video)

    render(
      React.createElement(SyncHarness, {
        participants: [
          {
            poolClipId: 'cut-clip',
            safeTrimBefore: 7,
            sourceFps: PROJECT_59_94,
            playbackRate: averageSpeed(CUT_AT_SIX),
            sequenceFrameOffset: 10,
            role: 'leader',
            speedCurve: CUT_AT_SIX,
            sourceFrameOffset: { num: 4, den: 5 },
          },
          {
            poolClipId: 'follower',
            safeTrimBefore: 0,
            sourceFps: PROJECT_59_94,
            playbackRate: 1,
            sequenceFrameOffset: 0,
            role: 'follower',
          },
        ],
        groupMinFrom: 0,
        timelineFps: PROJECT_59_94,
      }),
    )

    // The clip's frame 1 is source frame 9 of the parent (the parent's frame 7); without the
    // 0.8 remainder the curve's integral alone lands on frame 8.
    expect(video.currentTime).toBeCloseTo(9 / PROJECT_59_94)
  })
})
