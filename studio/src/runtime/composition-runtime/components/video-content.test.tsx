import { act, cleanup, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { averageSpeed, type SpeedCurve } from '@/studio/speed'
import { secondsToFrame, toRate } from '@/studio/time'
import { shouldIssueCoalescedReverseVideoSeek } from '../utils/video-sync-plan'
import { getVideoTargetTimeSeconds } from '../utils/video-timing'
import { VideoContent } from './video-content'

/**
 * The 10-second ramp of design 7.1, section 5.2: 1x -> 4x, hold, 4x -> 1x, over 600 frames.
 * Its average, 3.85, is what the clip's `speed` holds; it is a length, never a position.
 */
const RAMP_600: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 30, speed: 4 },
    { frame: 570, speed: 4 },
    { frame: 600, speed: 1 },
  ],
}
const RAMP_AVERAGE = averageSpeed(RAMP_600)
const PROJECT_59_94 = 59.94

/**
 * The design's ramp cut at its frame 6, where its source position is 7.8 frames: the parent's
 * curve re-windowed to `[6, 600)` (a key at 0 with the speed there, the rest shifted back), its
 * `sourceStart` 7 and the 0.8 remainder `sourceFrameOffset` (design 7.1, section 4.6).
 */
const CUT_AT_SIX: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1.6 },
    { frame: 24, speed: 4 },
    { frame: 564, speed: 4 },
    { frame: 594, speed: 1 },
  ],
}

const testState = vi.hoisted(() => ({
  preloadSourceMock: vi.fn(() => Promise.resolve()),
  acquireForClipMock: vi.fn(),
  releaseClipMock: vi.fn(),
  registerDomVideoElementMock: vi.fn(),
  unregisterDomVideoElementMock: vi.fn(),
  pool: null as {
    preloadSource: ReturnType<typeof vi.fn>
    acquireForClip: ReturnType<typeof vi.fn>
    releaseClip: ReturnType<typeof vi.fn>
  } | null,
  playbackState: {
    currentFrame: 0,
    isPlaying: true,
    previewFrame: null as number | null,
    volume: 1,
    muted: false,
  },
  gizmoState: {
    activeGizmo: null,
    preview: null as Record<string, unknown> | null,
  },
  sequenceLocalFrame: 0,
  timelineFps: 30,
}))

testState.pool = {
  preloadSource: testState.preloadSourceMock,
  acquireForClip: testState.acquireForClipMock,
  releaseClip: testState.releaseClipMock,
}

const {
  preloadSourceMock,
  acquireForClipMock,
  releaseClipMock,
  registerDomVideoElementMock,
  unregisterDomVideoElementMock,
  playbackState,
  gizmoState,
} = testState

function createStoreHook<TState extends object>(state: TState) {
  const hook = ((selector?: (value: TState) => unknown) =>
    selector ? selector(state) : state) as ((selector?: (value: TState) => unknown) => unknown) & {
    getState: () => TState
  }
  hook.getState = () => state
  return hook
}

function createMockVideoElement(): HTMLVideoElement {
  const element = document.createElement('video')
  let currentTimeValue = 0
  let pausedValue = true

  Object.defineProperty(element, 'readyState', {
    configurable: true,
    get: () => 4,
  })
  Object.defineProperty(element, 'videoWidth', {
    configurable: true,
    get: () => 1920,
  })
  Object.defineProperty(element, 'duration', {
    configurable: true,
    get: () => 120,
  })
  Object.defineProperty(element, 'currentTime', {
    configurable: true,
    get: () => currentTimeValue,
    set: (value: number) => {
      currentTimeValue = value
    },
  })
  Object.defineProperty(element, 'paused', {
    configurable: true,
    get: () => pausedValue,
  })

  element.play = vi.fn(async () => {
    pausedValue = false
  })
  element.pause = vi.fn(() => {
    pausedValue = true
  })

  return element
}

vi.mock('@/runtime/composition-runtime/deps/player', () => ({
  useSequenceContext: () => ({
    localFrame: testState.sequenceLocalFrame,
    from: 0,
    durationInFrames: 120,
    parentFrom: 0,
  }),
  useVideoSourcePool: () => testState.pool!,
  useClock: () => ({
    currentFrame: 0,
    onFrameChange: () => () => {},
  }),
  useClockPlaybackRate: () => 1,
  interpolate: () => 0,
  isVideoPoolAbortError: () => false,
}))

vi.mock('@/runtime/composition-runtime/deps/stores', () => ({
  usePlaybackStore: createStoreHook(testState.playbackState),
  useGizmoStore: createStoreHook(testState.gizmoState),
}))

vi.mock('../hooks/use-player-compat', () => ({
  useVideoConfig: () => ({
    fps: testState.timelineFps,
    width: 1280,
    height: 720,
    durationInFrames: 120,
  }),
  useIsPlaying: () => testState.playbackState.isPlaying,
}))

vi.mock('../contexts/keyframes-context', () => ({
  useItemKeyframesFromContext: () => null,
}))

vi.mock('@/runtime/composition-runtime/deps/keyframes', () => ({
  getPropertyKeyframes: () => [],
  interpolatePropertyValue: (_keyframes: unknown, _frame: number, fallback: number) => fallback,
}))

vi.mock('@/runtime/composition-runtime/utils/dom-video-element-registry', () => ({
  registerDomVideoElement: testState.registerDomVideoElementMock,
  unregisterDomVideoElement: testState.unregisterDomVideoElementMock,
}))

vi.mock('./video-audio-context', () => ({
  applyVideoElementAudioState: vi.fn(),
  useVideoAudioState: vi.fn(() => ({ audioVolume: 1, resolvedAudioEqStages: [] })),
  connectedVideoElements: new WeakSet<HTMLVideoElement>(),
  videoAudioContexts: new WeakMap<HTMLVideoElement, AudioContext>(),
  ensureAudioContextResumed: vi.fn(),
}))

describe('VideoContent pooled handoff', () => {
  beforeEach(() => {
    preloadSourceMock.mockClear()
    acquireForClipMock.mockClear()
    releaseClipMock.mockClear()
    registerDomVideoElementMock.mockClear()
    unregisterDomVideoElementMock.mockClear()
    playbackState.currentFrame = 0
    playbackState.isPlaying = true
    playbackState.previewFrame = null
    playbackState.volume = 1
    playbackState.muted = false
    gizmoState.activeGizmo = null
    gizmoState.preview = null
    testState.sequenceLocalFrame = 0
    testState.timelineFps = 30
  })

  it('keeps the acquired pool element when only itemId changes on the same pool lane', async () => {
    const pooledElement = createMockVideoElement()
    acquireForClipMock.mockReturnValue(pooledElement)

    const { rerender } = render(
      <VideoContent
        item={{
          id: 'clip-a',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip A',
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    )

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(1)
      expect(registerDomVideoElementMock).toHaveBeenCalledWith('clip-a', pooledElement)
    })

    rerender(
      <VideoContent
        item={{
          id: 'clip-b',
          type: 'video',
          trackId: 'track-1',
          from: 30,
          durationInFrames: 60,
          label: 'Clip B',
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
        }}
        muted={false}
        safeTrimBefore={30}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    )

    await waitFor(() => {
      expect(unregisterDomVideoElementMock).toHaveBeenCalledWith('clip-a', pooledElement)
      expect(registerDomVideoElementMock).toHaveBeenCalledWith('clip-b', pooledElement)
    })

    expect(acquireForClipMock).toHaveBeenCalledTimes(1)
    expect(releaseClipMock).not.toHaveBeenCalled()
  })

  it('keeps a decoder pre-warm single-flight and restores its paused source time', async () => {
    vi.useFakeTimers()
    playbackState.isPlaying = false
    const pooledElement = createMockVideoElement()
    let resolvePlay!: () => void
    pooledElement.play = vi.fn(() => {
      Object.defineProperty(pooledElement, 'paused', {
        configurable: true,
        get: () => false,
      })
      return new Promise<void>((resolve) => {
        resolvePlay = resolve
      })
    })
    acquireForClipMock.mockReturnValue(pooledElement)

    const rendered = render(
      <VideoContent
        item={{
          id: 'clip-a',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip A',
          src: 'blob:test',
          _poolClipId: 'group-origin-1',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(pooledElement.play).toHaveBeenCalledTimes(1)
    const preWarmStartTime = pooledElement.currentTime

    // play() can emit canplay while its promise is still pending. That signal
    // must not start another warm or leave the element on a decoded-ahead frame.
    pooledElement.currentTime = 0.25
    pooledElement.dispatchEvent(new Event('canplay'))
    await act(async () => {
      resolvePlay()
      await Promise.resolve()
    })

    expect(pooledElement.pause).toHaveBeenCalled()
    expect(pooledElement.currentTime).toBe(preWarmStartTime)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(pooledElement.play).toHaveBeenCalledTimes(1)
    rendered.unmount()
    vi.useRealTimers()
  })

  it('never plays a visibly presented paused video to warm its decoder', async () => {
    vi.useFakeTimers()
    playbackState.isPlaying = false
    const pooledElement = createMockVideoElement()
    pooledElement.getClientRects = vi.fn(
      () => ({ length: 1 }) as unknown as DOMRectList,
    )
    acquireForClipMock.mockReturnValue(pooledElement)

    const rendered = render(
      <VideoContent
        item={{
          id: 'clip-visible',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Visible clip',
          src: 'blob:test',
          _poolClipId: 'group-origin-visible',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(pooledElement.isConnected).toBe(true)
    expect(pooledElement.play).not.toHaveBeenCalled()
    rendered.unmount()
    vi.useRealTimers()
  })
})

describe('coalesced reverse video seeking', () => {
  it('keeps only one browser seek in flight and accepts the newest target after settlement', () => {
    expect(
      shouldIssueCoalescedReverseVideoSeek({
        seeking: false,
        seekInFlight: false,
        currentTime: 8,
        targetTime: 7.5,
      }),
    ).toBe(true)
    expect(
      shouldIssueCoalescedReverseVideoSeek({
        seeking: true,
        seekInFlight: true,
        currentTime: 8,
        targetTime: 6,
      }),
    ).toBe(false)
    expect(
      shouldIssueCoalescedReverseVideoSeek({
        seeking: false,
        seekInFlight: false,
        currentTime: 6.0005,
        targetTime: 6,
      }),
    ).toBe(false)
  })
})

describe('VideoContent with a speed curve', () => {
  it('places the element at the curve’s source frame, not the average speed', async () => {
    cleanup()
    acquireForClipMock.mockClear()
    playbackState.isPlaying = false
    testState.sequenceLocalFrame = 7
    testState.timelineFps = PROJECT_59_94
    const pooledElement = createMockVideoElement()
    acquireForClipMock.mockReturnValue(pooledElement)

    render(
      <VideoContent
        item={{
          id: 'clip-ramped',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 600,
          label: 'Ramped clip',
          src: 'blob:test',
          sourceFps: PROJECT_59_94,
          speed: RAMP_AVERAGE,
          speedCurve: RAMP_600,
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={RAMP_AVERAGE}
        sourceFps={PROJECT_59_94}
        audioEqStages={[]}
      />,
    )

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(1)
    })

    // Frame 7 of the 1x -> 4x -> 1x ramp is source frame 9 (design 7.1, 5.2), not
    // floor(3.85 * 7) = 26, the clip's average speed.
    const sourceFrame = secondsToFrame(toRate(PROJECT_59_94), pooledElement.currentTime)
    expect(sourceFrame).toBe(9)
    expect(sourceFrame).not.toBe(Math.floor(RAMP_AVERAGE * 7))
  })

  it('places the element on the parent’s source frame after a cut between two source frames', async () => {
    cleanup()
    acquireForClipMock.mockClear()
    playbackState.isPlaying = false
    testState.sequenceLocalFrame = 1
    testState.timelineFps = PROJECT_59_94
    const cutSpeed = averageSpeed(CUT_AT_SIX)
    const pooledElement = createMockVideoElement()
    acquireForClipMock.mockReturnValue(pooledElement)

    render(
      <VideoContent
        item={{
          id: 'clip-cut',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 594,
          label: 'Cut clip',
          src: 'blob:test',
          sourceFps: PROJECT_59_94,
          sourceStart: 7,
          speed: cutSpeed,
          speedCurve: CUT_AT_SIX,
          sourceFrameOffset: { num: 4, den: 5 },
        }}
        muted={false}
        safeTrimBefore={7}
        playbackRate={cutSpeed}
        sourceFps={PROJECT_59_94}
        audioEqStages={[]}
      />,
    )

    await waitFor(() => {
      expect(acquireForClipMock).toHaveBeenCalledTimes(1)
    })

    // The cut sits 7.8 source frames into the parent; the child's frame 1 is another 1.65, so
    // the 0.8 remainder makes it source frame 9 - the parent's frame 7 - where dropping the
    // remainder would show frame 8.
    expect(pooledElement.currentTime).toBe(
      getVideoTargetTimeSeconds(
        0,
        PROJECT_59_94,
        7,
        RAMP_AVERAGE,
        PROJECT_59_94,
        0,
        false,
        undefined,
        RAMP_600,
      ),
    )
    expect(secondsToFrame(toRate(PROJECT_59_94), pooledElement.currentTime)).toBe(9)
  })
})
