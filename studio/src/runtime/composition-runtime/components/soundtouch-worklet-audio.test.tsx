import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DEFAULT_AUDIO_EQ_SETTINGS } from '@/shared/utils/audio-eq'
import { averageSpeed, type SpeedCurve } from '@/studio/speed'
import { SoundTouchWorkletAudio } from './soundtouch-worklet-audio'

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

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    transportPlaybackRate: 1,
    resolvedVolume: 1,
    resolvedPitchShiftSemitones: 0,
    resolvedAudioEqStages: [] as (typeof DEFAULT_AUDIO_EQ_SETTINGS)[],
  },
}))

const previewGraphMocks = vi.hoisted(() => ({
  createPreviewClipAudioGraph: vi.fn(() => ({
    context: {
      state: 'running' as const,
      currentTime: 0,
      sampleRate: 48000,
      resume: vi.fn(() => Promise.resolve()),
      audioWorklet: {},
    },
    sourceInputNode: {},
    outputGainNode: {
      gain: {
        value: 1,
      },
    },
    eqStageNodes: [],
    dispose: vi.fn(),
  })),
  rampPreviewClipEq: vi.fn(),
  rampPreviewClipGain: vi.fn(),
}))

const soundTouchWorkletMocks = vi.hoisted(() => ({
  ensureSoundTouchPreviewWorkletLoaded: vi.fn(),
  prepareAudioBufferForSoundTouchPreview: vi.fn(async () => ({
    leftChannel: new Float32Array(0),
    rightChannel: new Float32Array(0),
    frameCount: 0,
    sampleRate: 48000,
  })),
}))
const workletNodeMocks = vi.hoisted(() => ({
  messages: [] as unknown[],
}))

vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}))
vi.mock('../utils/preview-audio-graph', () => ({
  createPreviewClipAudioGraph: previewGraphMocks.createPreviewClipAudioGraph,
  rampPreviewClipEq: previewGraphMocks.rampPreviewClipEq,
  rampPreviewClipGain: previewGraphMocks.rampPreviewClipGain,
}))
vi.mock('../utils/soundtouch-preview-worklet', () => ({
  ensureSoundTouchPreviewWorkletLoaded: soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded,
  prepareAudioBufferForSoundTouchPreview:
    soundTouchWorkletMocks.prepareAudioBufferForSoundTouchPreview,
  SOUND_TOUCH_PREVIEW_PROCESSOR_NAME: 'soundtouch-preview-processor',
}))
vi.mock('@/runtime/composition-runtime/deps/stores', () => ({
  useGizmoStore: {
    getState: () => ({ activeGizmo: null }),
  },
  usePlaybackStore: {
    getState: () => ({ isPlaying: false, previewFrame: null }),
  },
}))

function makeAudioBuffer(durationSeconds = 2): AudioBuffer {
  const sampleRate = 48000
  const length = sampleRate * durationSeconds
  return {
    duration: durationSeconds,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer
}

describe('SoundTouchWorkletAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      transportPlaybackRate: 1,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    }
    workletNodeMocks.messages = []
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port = {
          postMessage: (message: unknown) => {
            workletNodeMocks.messages.push(message)
          },
        }
        connect() {}
        disconnect() {}
      },
    )
  })

  it('does not render fallback while the worklet is still loading', async () => {
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockReturnValue(
      new Promise<boolean>(() => {}),
    )

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        fallback={<div data-testid="fallback" />}
      />,
    )

    await waitFor(() => {
      expect(soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByTestId('fallback')).toBeNull()
  })

  it('keeps the preview graph alive while EQ stages change', async () => {
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockReturnValue(
      new Promise<boolean>(() => {}),
    )

    const { rerender } = render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        volumeMultiplier={1}
        fallback={<div data-testid="fallback" />}
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
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        volumeMultiplier={1.01}
        fallback={<div data-testid="fallback" />}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.rampPreviewClipEq).toHaveBeenLastCalledWith(expect.anything(), [
        DEFAULT_AUDIO_EQ_SETTINGS,
      ])
    })

    expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    expect(soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded).toHaveBeenCalledTimes(1)
  })

  it('renders fallback after the worklet path fails', async () => {
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockResolvedValue(false)

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        fallback={<div data-testid="fallback" />}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toBeInTheDocument()
    })
  })

  it('runs reverse shuttle through SoundTouch with stable pitch and signed source direction', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 300,
      playing: true,
      transportPlaybackRate: -4,
    }
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockResolvedValue(true)

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer(12)}
        itemId="nested-audio-1"
        durationInFrames={600}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(workletNodeMocks.messages).toContainEqual({
        type: 'set-tempo',
        tempo: 4,
      })
      expect(workletNodeMocks.messages).toContainEqual({
        type: 'seek',
        frame: 480000,
        direction: -1,
      })
      expect(workletNodeMocks.messages).toContainEqual({
        type: 'set-pitch',
        pitch: 1,
      })
      expect(workletNodeMocks.messages).toContainEqual({
        type: 'set-playing',
        playing: true,
      })
    })
  })

  it('reads an authored reversed clip backwards without reversing its buffer on the UI thread', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 90,
      playing: true,
      transportPlaybackRate: 1,
    }
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockResolvedValue(true)

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer(12)}
        itemId="reversed-audio-1"
        durationInFrames={360}
        playbackRate={1}
        isReversed
        reverseSourceEnd={360}
      />,
    )

    await waitFor(() => {
      expect(workletNodeMocks.messages).toContainEqual(
        expect.objectContaining({
          type: 'seek',
          direction: -1,
        }),
      )
    })
  })
})

function rateMessages(): { rate: number }[] {
  return workletNodeMocks.messages.filter(
    (message) => (message as { type?: string }).type === 'set-rate',
  ) as { rate: number }[]
}

describe('SoundTouchWorkletAudio on a speed ramp', () => {
  beforeEach(() => {
    // Components from the tests above stay mounted otherwise and post into the same port.
    cleanup()
    workletNodeMocks.messages = []
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockResolvedValue(true)
  })

  it('asks for the curve’s speed and the curve’s seek, never the clip’s average', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 7,
      fps: 60,
      playing: true,
    }

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer(12)}
        itemId="ramped-audio-1"
        durationInFrames={600}
        playbackRate={RAMP_AVERAGE}
        sourceFps={60}
        trimBefore={0}
        speedCurve={RAMP_600}
      />,
    )

    await waitFor(() => {
      expect(rateMessages()).toHaveLength(1)
    })

    // Frame 7 of the ramp runs at 1.7x: `rate` moves speed and pitch together (varispeed), and
    // `tempo` holds only the transport's factor, 1 here (design 7.1, section 4.3).
    expect(rateMessages()[0]?.rate).toBeCloseTo(1.7, 10)
    expect(workletNodeMocks.messages).toContainEqual({ type: 'set-tempo', tempo: 1 })
    // The seek is the curve's source position: frame 7 is source frame 9 (design 7.1, 5.2).
    expect(workletNodeMocks.messages).toContainEqual({ type: 'seek', frame: 7200, direction: 1 })
    // The average speed would have asked for source frame 26.
    expect(Math.floor((7 * RAMP_AVERAGE * 48000) / 60)).not.toBe(7200)
  })

  it('posts one set-rate per change of speed', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 7,
      fps: 60,
      playing: true,
    }
    const props = {
      audioBuffer: makeAudioBuffer(12),
      itemId: 'ramped-audio-1',
      durationInFrames: 600,
      playbackRate: RAMP_AVERAGE,
      sourceFps: 60,
      trimBefore: 0,
      speedCurve: RAMP_600,
    }
    const { rerender } = render(<SoundTouchWorkletAudio {...props} volumeMultiplier={1} />)

    await waitFor(() => {
      expect(rateMessages()).toHaveLength(1)
    })

    // Frame 37 is inside the ramp's 4x hold.
    playbackStateMocks.current = { ...playbackStateMocks.current, frame: 37 }
    rerender(<SoundTouchWorkletAudio {...props} volumeMultiplier={1.01} />)

    await waitFor(() => {
      expect(rateMessages()).toHaveLength(2)
    })
    expect(rateMessages()[1]?.rate).toBe(4)

    // A re-render that does not move the playhead posts nothing.
    rerender(<SoundTouchWorkletAudio {...props} volumeMultiplier={1.02} />)
    expect(rateMessages()).toHaveLength(2)
  })

  it('asks for the identity rate and the clip’s tempo when there is no curve', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 300,
      fps: 30,
      playing: true,
    }

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer(20)}
        itemId="constant-audio-1"
        durationInFrames={600}
        playbackRate={1.5}
        sourceFps={30}
      />,
    )

    await waitFor(() => {
      expect(rateMessages()).toHaveLength(1)
    })

    // A constant-speed clip keeps today's pitch-preserved tempo and a rate of 1.
    expect(rateMessages()[0]?.rate).toBe(1)
    expect(workletNodeMocks.messages).toContainEqual({ type: 'set-tempo', tempo: 1.5 })
    // Frame 300 at 1.5x is source frame 450, i.e. 15 s at 30 fps.
    expect(workletNodeMocks.messages).toContainEqual({ type: 'seek', frame: 720_000, direction: 1 })
  })

  it('seeks with the cut’s source-frame remainder', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 1,
      fps: PROJECT_59_94,
      playing: true,
    }

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer(12)}
        itemId="cut-audio-1"
        durationInFrames={594}
        playbackRate={averageSpeed(CUT_AT_SIX)}
        sourceFps={PROJECT_59_94}
        trimBefore={7}
        speedCurve={CUT_AT_SIX}
        sourceFrameOffset={0.8}
      />,
    )

    await waitFor(() => {
      expect(rateMessages()).toHaveLength(1)
    })

    // The child's frame 1 is source frame 9 of the parent (the parent's frame 7), i.e.
    // 0.15015 s at 48 kHz; dropping the 0.8 remainder would ask for 6406.
    expect(rateMessages()[0]?.rate).toBeCloseTo(1.7, 10)
    expect(workletNodeMocks.messages).toContainEqual({ type: 'seek', frame: 7207, direction: 1 })
  })
})
