// The stabilization's look-ahead: which engines it asks, for which source positions, and when; and, on the engine host
// and the stabilization stage themselves, the cut of 20 Nov 2026: a clip whose range and speed changed after its engine
// opened, reached by a playhead the preview draws behind at a few frames a second, is ready at its first frame.

import { describe, expect, it, vi } from 'vite-plus/test'
import {
  type StabilizationClient,
  type StabilizationFrameData,
  type StabilizationInfo,
} from '@/studio/stabilization/client'
import { stabilizationEngineKey } from '@/studio/stabilization/engine-key'
import { createStabilizationSeat, type StabilizationSeat } from '@/studio/stabilization/seat'
import type { StabilizationFrame } from '@/studio/stabilization/stage'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { createDerivedSizeStore } from './derived-sizes'
import { createStabilizeStage } from './stabilize'
import { warmStabilizationAhead, type StabilizationLookAhead } from './stabilize-ahead'

vi.mock('@/studio/stabilization/stage-cache', () => ({
  stabilizationStageFor: vi.fn(async () => ({})),
  builtStabilizationStage: vi.fn(),
}))

const FPS = 60

function clip(extra: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-a',
    type: 'video',
    trackId: 'track-1',
    label: '1 Ridge',
    mediaId: 'media-a',
    src: 'blob:a',
    from: 0,
    durationInFrames: 240,
    sourceFps: FPS,
    sourceStart: 0,
    sourceEnd: 240,
    sourceDuration: 13_839,
    stabilization: {
      enabled: true,
      method: 'Default',
      params: { smoothness: 0.5, trim_range_only: 1 },
      fov: 1,
      horizonLockPercent: 0,
      horizonLockRoll: 0,
      adaptiveZoomSeconds: 4,
    },
    ...extra,
  } as VideoItem
}

/** A clip at a constant 4x through a speed curve, with motion blur at 360 degrees: the ends of a smooth edit */
function fast(extra: Partial<VideoItem>): VideoItem {
  const durationInFrames = extra.durationInFrames ?? 60
  return clip({
    speed: 4,
    speedCurve: { keys: [{ frame: 0, speed: 4 }, { frame: durationInFrames, speed: 4 }] },
    motionBlur: { shutterDegrees: 360 },
    ...extra,
    durationInFrames,
  } as Partial<VideoItem>)
}

/** The 2x clip after the cut, 4 seconds into the timeline */
const lake = (extra: Partial<VideoItem> = {}): VideoItem =>
  fast({ id: 'clip-b', label: '2 Lake reveal', mediaId: 'media-b', src: 'blob:b', from: 240, sourceStart: 1000, sourceEnd: 1240, ...extra })

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

/** A host that records what it is asked to warm */
function recordingHost() {
  const warm = vi.fn()
  const seat = { warm } as unknown as StabilizationSeat
  const host = vi.fn(() => seat)
  return { host, warm }
}

function lookAhead(items: TimelineItem[], frame: number, extra: Partial<StabilizationLookAhead> = {}): StabilizationLookAhead {
  return { items, transitions: [], frame, fps: FPS, playbackRate: 1, ...extra }
}

describe('the stabilization’s look-ahead', () => {
  it('asks for the frames a clip’s first eight output frames read at 4x with motion blur, with the neighbour before', () => {
    const { host, warm } = recordingHost()
    const next = lake()
    warmStabilizationAhead(host, lookAhead([clip(), next], 200))

    // Frames 0-7 at 4x read source 1000-1031 (each frame's four samples), and the vector blur the neighbours either side
    expect(warm).toHaveBeenCalledTimes(1)
    expect(warm).toHaveBeenCalledWith(stabilizationEngineKey(next), range(999, 1032))
  })

  it('asks for an incoming transition’s pre-roll: the clip is first drawn where the transition starts, before its own first frame', () => {
    const { host, warm } = recordingHost()
    const before = clip()
    const next = lake()
    const crossfade = {
      id: 'x1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: before.id,
      rightClipId: next.id,
      trackId: 'track-1',
      durationInFrames: 20,
      alignment: 0.5,
    } as unknown as Transition
    warmStabilizationAhead(host, lookAhead([before, next], 200, { transitions: [crossfade] }))

    // The transition starts 10 frames before the cut; its span starts 10 frames x 4 = 40 source frames before the clip's
    // first, and draws one frame per output frame: 960, 964 ... 988 for the first eight
    expect(warm).toHaveBeenCalledWith(stabilizationEngineKey(next), range(959, 989))
  })

  it('asks for a clip within a second ahead, or one that started in the last eight frames, and for nothing else', () => {
    const { host, warm } = recordingHost()
    const items = [clip(), lake()]
    // At frame 8 the first clip started eight frames ago, and the second is more than a second ahead
    warmStabilizationAhead(host, lookAhead(items, 8))
    warmStabilizationAhead(host, lookAhead(items, 179))
    expect(host).not.toHaveBeenCalled()

    warmStabilizationAhead(host, lookAhead(items, 180))
    warmStabilizationAhead(host, lookAhead(items, 247))
    expect(warm).toHaveBeenCalledTimes(2)
    warm.mockClear()
    warmStabilizationAhead(host, lookAhead(items, 248))
    expect(warm).not.toHaveBeenCalled()

    // A clip that is not stabilized, or has no file, opens nothing
    const plain = lake({ stabilization: { ...lake().stabilization!, enabled: false } })
    warmStabilizationAhead(host, lookAhead([plain, lake({ mediaId: undefined })], 200))
    expect(warm).not.toHaveBeenCalled()
  })

  it('looks further ahead at a faster playback rate', () => {
    const { host, warm } = recordingHost()
    warmStabilizationAhead(host, lookAhead([clip(), lake()], 140, { playbackRate: 2 }))
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('asks once per engine for the clips of one file the playhead reaches together', () => {
    const { host, warm } = recordingHost()
    // The first started five frames ago and is still drawing its first frames; the second starts within the second
    const first = lake({ id: 'clip-b1', from: 240, sourceStart: 1000 })
    const second = lake({ id: 'clip-b2', from: 300, durationInFrames: 30, sourceStart: 5000 })
    warmStabilizationAhead(host, lookAhead([clip(), first, second], 245))
    expect(warm).toHaveBeenCalledTimes(1)
    expect(warm).toHaveBeenCalledWith(stabilizationEngineKey(first), [...range(999, 1032), ...range(4999, 5032)])
  })
})

// --- The cut, on the engine host and the stage ----------------------------------------------------------------------

const INFO = {
  input: [3840, 2880],
  output: [3840, 2160],
  fps: 59.94,
  frames: 13_839,
  orientations: 461_674,
} as unknown as StabilizationInfo

const FRAME: StabilizationFrame = {
  matrices: new Float32Array(16),
  params: new Uint8Array(416),
  mesh: new Float32Array(0),
}

/** An engine whose window holds nothing until asked: every frame not warmed is a request the preview would wait for */
function engines() {
  const frame = (sourceFrame: number): StabilizationFrameData => ({ ...FRAME, sourceFrame })
  const getFrameData = vi.fn(async (_id: string, sourceFrame: number) => frame(sourceFrame))
  const fetchFrames = vi.fn(async (_id: string, frames: readonly number[]) => frames.map(frame))
  const client = {
    open: vi.fn(async () => INFO),
    lensProfile: vi.fn(async () => ({ name: 'lens', model: 'opencv_fisheye' })),
    stageAssets: vi.fn(async () => ({})),
    infoOf: vi.fn(() => null),
    getFrameData,
    fetchFrames,
    peekFrame: vi.fn(() => undefined),
    slideWindow: vi.fn(),
    close: vi.fn(async () => undefined),
    destroy: vi.fn(),
  } as unknown as StabilizationClient
  const seat = createStabilizationSeat({ createClient: () => client, loadFile: async () => ({ name: 'x.mp4', size: 1 }) as File, projectFps: () => FPS })
  const stage = createStabilizeStage({ sizes: createDerivedSizeStore(), host: () => seat })
  return { seat, stage, getFrameData, fetchFrames }
}

describe('a cut after an agent’s edits (20 Nov 2026)', () => {
  it('has the next clip’s first frame ready when the playhead reaches it, although its range and speed changed after its engine opened', async () => {
    const { seat, stage, getFrameData, fetchFrames } = engines()
    // Both engines opened when the clips were stabilized, the second clip then at the start of its file and at 1x
    const ridge = fast({ durationInFrames: 240, sourceEnd: 960 })
    await seat.open(ridge)
    await seat.open(lake({ sourceStart: 0, sourceEnd: 240, speed: 1, speedCurve: undefined, motionBlur: undefined }))
    // The edits: the lake clip now starts 1000 frames into its file, at 4x, with motion blur (a smooth edit's end)
    const edited = lake()
    const items = [ridge, edited]

    // Playback to the cut. The playhead moves every frame; the preview draws a 4K blurred frame only every 12th, which
    // never lands in the ridge clip's last 30 source frames (7 timeline frames at 4x)
    for (let frame = 0; frame < edited.from; frame += 1) {
      warmStabilizationAhead(() => seat, lookAhead(items, frame))
      if (frame % 12 === 0) stage.ready(ridge, ridge.sourceStart! + frame * 4)
    }
    await Promise.all(fetchFrames.mock.results.map((result) => result.value))
    await Promise.resolve()
    getFrameData.mockClear()

    // The cut: the lake clip's first output frame reads source 1000-1003 and the vector blur's neighbours 999 and 1004
    for (const index of range(999, 1004)) expect(stage.ready(edited, index)).toBe(true)
    expect(getFrameData).not.toHaveBeenCalled()
  })
})
