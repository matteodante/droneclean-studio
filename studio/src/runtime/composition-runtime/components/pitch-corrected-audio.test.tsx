import { cleanup, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DEFAULT_AUDIO_EQ_SETTINGS } from '@/shared/utils/audio-eq'
import { averageSpeed, type SpeedCurve } from '@/studio/speed'
import { frameToSeconds, toRate } from '@/studio/time'

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

/** A ramp whose average is exactly 1x: 0.5x -> 1.5x -> 0.5x over 600 frames. */
const SYMMETRIC_RAMP: SpeedCurve = {
  keys: [
    { frame: 0, speed: 0.5 },
    { frame: 300, speed: 1.5 },
    { frame: 600, speed: 0.5 },
  ],
}

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioSliceForPlayback: vi.fn(),
}))
const clockRateMocks = vi.hoisted(() => ({ current: 1 }))

vi.mock('@/runtime/composition-runtime/deps/player', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/runtime/composition-runtime/deps/player')>()),
  useClockPlaybackRate: () => clockRateMocks.current,
}))

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
    resolvedPitchShiftSemitones: 0,
    resolvedAudioEqStages: [] as (typeof DEFAULT_AUDIO_EQ_SETTINGS)[],
  } as {
    frame: number
    fps: number
    playing: boolean
    transportPlaybackRate?: number
    isPreviewScrubbing?: boolean
    resolvedVolume: number
    resolvedPitchShiftSemitones: number
    resolvedAudioEqStages: (typeof DEFAULT_AUDIO_EQ_SETTINGS)[]
  },
}))

const previewAudioMocks = vi.hoisted(() => {
  const state: { current: HTMLAudioElement | null } = { current: null }
  const createAudio = () =>
    ({
      volume: 1,
      muted: false,
      playbackRate: 1,
      currentTime: 0,
      readyState: 4,
      paused: true,
      seeking: false,
      play: vi.fn().mockImplementation(function (this: { paused: boolean }) {
        this.paused = false
        return Promise.resolve()
      }),
      pause: vi.fn().mockImplementation(function (this: { paused: boolean }) {
        this.paused = true
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as HTMLAudioElement

  return {
    state,
    acquirePreviewAudioElement: vi.fn(() => {
      const audio = createAudio()
      state.current = audio
      return audio
    }),
    releasePreviewAudioElement: vi.fn(),
    markPreviewAudioElementUsesWebAudio: vi.fn(),
  }
})

const previewGraphMocks = vi.hoisted(() => {
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  }

  const graph = {
    context: {
      state: 'running' as const,
      currentTime: 0,
      resume: vi.fn(() => Promise.resolve()),
      createMediaElementSource: vi.fn(() => sourceNode),
    },
    sourceInputNode: {},
    outputGainNode: {
      gain: {
        value: 1,
      },
    },
    eqStageNodes: [],
    dispose: vi.fn(),
  }

  return {
    graph,
    sourceNode,
    createPreviewClipAudioGraph: vi.fn(() => graph),
    rampPreviewClipEq: vi.fn(),
    rampPreviewClipGain: vi.fn(),
    setPreviewClipGain: vi.fn(),
  }
})

const storeMocks = vi.hoisted(() => {
  const gizmoState = { activeGizmo: null, preview: null }
  const useGizmoStore = Object.assign(
    vi.fn((selector?: (state: typeof gizmoState) => unknown) =>
      selector ? selector(gizmoState) : gizmoState,
    ),
    {
      getState: () => gizmoState,
    },
  )

  return {
    useGizmoStore,
    usePlaybackStore: {
      getState: () => ({ isPlaying: false, previewFrame: null }),
    },
  }
})

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks)
vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}))
vi.mock('../utils/preview-audio-element-pool', () => previewAudioMocks)
vi.mock('../utils/preview-audio-graph', () => previewGraphMocks)
vi.mock('@/runtime/composition-runtime/deps/stores', () => storeMocks)
vi.mock('./soundtouch-worklet-audio', () => ({
  SoundTouchWorkletAudio: ({
    audioBuffer,
    sourceStartOffsetSec,
  }: {
    audioBuffer: AudioBuffer
    sourceStartOffsetSec?: number
  }) => (
    <div
      data-testid="pitch"
      data-frames={audioBuffer.length}
      data-offset={sourceStartOffsetSec ?? 0}
    />
  ),
}))

import { PitchCorrectedAudio } from './pitch-corrected-audio'

function makeAudioBuffer(durationSeconds = 8): AudioBuffer {
  const sampleRate = 22050
  const length = sampleRate * durationSeconds
  return {
    duration: durationSeconds,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer
}

describe('PitchCorrectedAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clockRateMocks.current = 1
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    }
  })

  it('keeps 1x playback on the native preview path', async () => {
    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(previewAudioMocks.acquirePreviewAudioElement).toHaveBeenCalledWith('blob:audio')
    })

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled()
    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="pitch"]')).toBeNull()
  })

  it('keeps the native preview graph alive while EQ stages change', async () => {
    const { rerender } = render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        volumeMultiplier={1}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    })

    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      resolvedAudioEqStages: [DEFAULT_AUDIO_EQ_SETTINGS],
    }

    rerender(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        volumeMultiplier={1.01}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.rampPreviewClipEq).toHaveBeenLastCalledWith(
        previewGraphMocks.graph,
        [DEFAULT_AUDIO_EQ_SETTINGS],
      )
    })

    expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    expect(previewAudioMocks.acquirePreviewAudioElement).toHaveBeenCalledTimes(1)
  })

  it('uses playback-first decode for stretched clips with media ids', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 4,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        trimBefore={120}
        sourceFps={30}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'media-1',
        'blob:audio',
        {
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
          targetTimeSeconds: 4,
        },
      )
    })

    await waitFor(() => {
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute(
        'data-frames',
        String(22050 * 2),
      )
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-offset', '4')
    })

    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
  })

  it('defers decoded pitch audio until an active preview scrub settles', async () => {
    playbackStateMocks.current.isPreviewScrubbing = true
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    const { rerender } = render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
      />,
    )

    await Promise.resolve()
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled()
    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()

    playbackStateMocks.current.isPreviewScrubbing = false
    rerender(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        volumeMultiplier={1.01}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
      expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
    })
  })

  it('uses a synthetic decode key when pitch correction is needed without a media id', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.25}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'legacy-src:blob:audio',
        'blob:audio',
        expect.objectContaining({
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
        }),
      )
    })

    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })

  it('uses the decoded path for pitch-only shifts at 1x playback', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        audioPitchSemitones={4}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })

    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })

  it('uses a reverse-ready decoded window for transient reverse shuttle', async () => {
    clockRateMocks.current = -4
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 300,
      playing: true,
      transportPlaybackRate: -4,
    }
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(6),
      startTime: 6,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="nested-audio-1"
        durationInFrames={600}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })
    const reverseOptions =
      audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[0]?.[2]
    expect(reverseOptions?.targetTimeSeconds).toBeCloseTo(10, 4)
    expect(reverseOptions?.preRollSeconds).toBe(4)
    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })
})

describe('PitchCorrectedAudio on a speed ramp', () => {
  beforeEach(() => {
    // Components from the tests above stay mounted otherwise and decode into the same mocks.
    cleanup()
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockReset()
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))
  })

  it('keeps a curved clip on the decoded path at a 1x playhead', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={600}
        playbackRate={1}
        sourceFps={60}
        speedCurve={SYMMETRIC_RAMP}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })

    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
    // The clip's average is exactly 1x, and the element path plays one constant rate: a ramp
    // still plays through the worklet (design 7.1, sections 4.3-4.4).
    expect(averageSpeed(SYMMETRIC_RAMP)).toBe(1)
  })

  it('extends the decoded window to the curve’s source time', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 7,
      fps: 60,
      playing: true,
    }
    // A 40 ms window from the clip start does not cover frame 7, which is 0.15 s in.
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(0.04),
      startTime: 0,
      isComplete: false,
    })

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={600}
        playbackRate={RAMP_AVERAGE}
        sourceFps={60}
        speedCurve={RAMP_600}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2)
    })

    // Frame 7 of the ramp is source frame 9, i.e. 0.15 s at 60 fps (design 7.1, 5.2); the
    // average speed would have asked for 0.45 s and 1x for 0.117 s.
    const lastOptions = audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls.at(-1)?.[2]
    expect(lastOptions?.targetTimeSeconds).toBeCloseTo(0.15, 10)
  })

  it('counts the cut’s source-frame remainder in the decoded window', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 1,
      fps: PROJECT_59_94,
      playing: true,
    }
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(0.04),
      startTime: 0,
      isComplete: false,
    })

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={594}
        playbackRate={averageSpeed(CUT_AT_SIX)}
        sourceFps={PROJECT_59_94}
        trimBefore={7}
        speedCurve={CUT_AT_SIX}
        sourceFrameOffset={0.8}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2)
    })

    // The child's frame 1 is source frame 9 of the parent (the parent's frame 7); without the
    // 0.8 remainder the window would open on source frame 8.
    const lastOptions = audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls.at(-1)?.[2]
    expect(lastOptions?.targetTimeSeconds).toBe(
      frameToSeconds(toRate(PROJECT_59_94), 9),
    )
    expect(lastOptions?.targetTimeSeconds).not.toBe(
      frameToSeconds(toRate(PROJECT_59_94), 8),
    )
  })
})
