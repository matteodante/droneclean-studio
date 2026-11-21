// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { FrameFile } from '../types'
import { createMediabunnySampleReader, FORWARD_JUMP_SECONDS } from './mediabunny-reader'

const FILE: FrameFile = {
  key: 'source:a',
  src: 'blob:a',
  path: '/a.mp4',
  rate: { num: 30, den: 1 },
}

/** The fake file: 30 fps, frames 0..FRAMES-1, each sample 1/30 s long */
const FRAMES = 300

interface FakeSample {
  timestamp: number
  duration: number
  rotation: number
  displayWidth: number
  displayHeight: number
  closed: boolean
  draw(context: unknown, ...args: number[]): void
  toVideoFrame(): unknown
  close(): void
}

const state = vi.hoisted(() => ({
  opened: 0,
  disposed: 0,
  canDecode: true,
  hasTrack: true,
  rotation: 0,
  failOpens: 0,
  colourSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' } as Record<string, string | null>,
  /** The start time of each stream the reader opened */
  streams: [] as number[],
  /** Streams the reader ended */
  returned: 0,
  /** Samples a stream decoded */
  decoded: [] as Array<{ timestamp: number; closed: boolean }>,
  draws: [] as Array<{ context: unknown; timestamp: number; args: number[] }>,
  canvases: [] as Array<{ width: number; height: number; context: unknown }>,
}))

vi.mock('@/infrastructure/browser/mediabunny-input-source', () => ({
  createMediabunnyInputSource: () => ({ source: true }),
}))

vi.mock('mediabunny', () => {
  class Input {
    constructor() {
      if (state.failOpens > 0) {
        state.failOpens -= 1
        throw new Error('open failed')
      }
      state.opened += 1
    }
    async getPrimaryVideoTrack() {
      return state.hasTrack ? { canDecode: async () => state.canDecode, getColorSpace: async () => state.colourSpace } : null
    }
    dispose() {
      state.disposed += 1
    }
  }
  function sample(frame: number): FakeSample {
    const made: FakeSample = {
      timestamp: frame / 30,
      duration: 1 / 30,
      rotation: state.rotation,
      displayWidth: 1920,
      displayHeight: 1080,
      closed: false,
      draw: (context: unknown, ...args: number[]) =>
        state.draws.push({ context, timestamp: made.timestamp, args }),
      toVideoFrame: () => ({ videoFrameOf: made.timestamp }),
      close() {
        made.closed = true
      },
    }
    state.decoded.push(made)
    return made
  }
  class VideoSampleSink {
    // Like mediabunny: the first sample is the one on screen at `start`, then every sample in order
    async *samples(start: number) {
      state.streams.push(start)
      try {
        for (let frame = Math.max(0, Math.floor(start * 30 + 1e-9)); frame < FRAMES; frame += 1) {
          yield sample(frame)
        }
      } finally {
        state.returned += 1
      }
    }
  }
  return { Input, VideoSampleSink, ALL_FORMATS: [] }
})

class FakeCanvas {
  readonly context = { clearRect: vi.fn() }
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    state.canvases.push(this)
  }
  getContext() {
    return this.context
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  Object.assign(state, {
    opened: 0,
    disposed: 0,
    canDecode: true,
    hasTrack: true,
    rotation: 0,
    failOpens: 0,
    streams: [],
    returned: 0,
    decoded: [],
    draws: [],
    canvases: [],
  })
})

/** The middle of frame `n`, the time the backend asks for */
const mid = (n: number) => (n + 0.5) / 30

describe('the mediabunny sample reader', () => {
  it('reads frames asked in order off one stream, each decoded once (task 8.2: no decode from the key frame per frame)', async () => {
    const reader = createMediabunnySampleReader()
    const timestamps: number[] = []
    for (let n = 600 / 30; n < 30; n += 1) {
      const answer = await reader.sampleAt(FILE, mid(n))
      timestamps.push(Math.round(answer!.timestamp * 30))
    }
    expect(timestamps).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29])
    expect(state.opened).toBe(1)
    expect(state.streams).toEqual([mid(20)])
    expect(state.decoded.map((s) => Math.round(s.timestamp * 30))).toEqual([
      20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    ])
    // A sample is closed once the stream moves past it, never while it is the one on screen
    expect(state.decoded.slice(0, 9).every((s) => s.closed)).toBe(true)
    expect(state.decoded[9]!.closed).toBe(false)
  })

  it('answers a frame asked again with the sample it holds (a 59.94 clip in a 60 project)', async () => {
    const reader = createMediabunnySampleReader()
    const first = await reader.sampleAt(FILE, mid(40))
    const again = await reader.sampleAt(FILE, mid(40) + 0.001)
    expect(again!.timestamp).toBe(first!.timestamp)
    expect(state.streams).toHaveLength(1)
  })

  it('reads through a short jump forward, and starts again for a step back or a long jump', async () => {
    const reader = createMediabunnySampleReader()
    await reader.sampleAt(FILE, mid(10))
    await reader.sampleAt(FILE, mid(15))
    expect(state.streams).toHaveLength(1)
    const back = await reader.sampleAt(FILE, mid(5))
    expect(Math.round(back!.timestamp * 30)).toBe(5)
    expect(state.streams).toEqual([mid(10), mid(5)])
    expect(state.returned).toBe(1)
    const far = await reader.sampleAt(FILE, mid(5) + FORWARD_JUMP_SECONDS + 0.5)
    expect(far!.timestamp).toBeCloseTo(Math.floor((mid(5) + FORWARD_JUMP_SECONDS + 0.5) * 30) / 30)
    expect(state.streams).toHaveLength(3)
  })

  it('draws the sample on a 2D canvas at its size, as FreeCut’s decoder does, when its picture is read', async () => {
    const reader = createMediabunnySampleReader()
    const first = await reader.sampleAt(FILE, mid(60))
    // Nothing is drawn until the picture is asked for: the preview takes the frame itself
    expect(state.draws).toEqual([])
    expect(first?.image).toBe(first?.image)
    const second = await reader.sampleAt(FILE, mid(61))
    expect(second?.image).toBe(state.canvases[0])
    expect(state.canvases).toHaveLength(1)
    expect(state.canvases[0]).toMatchObject({ width: 1920, height: 1080 })
    expect(state.draws.map((d) => [Math.round(d.timestamp * 30), d.args])).toEqual([
      [60, [0, 0, 1920, 1080]],
      [61, [0, 0, 1920, 1080]],
    ])
    // The stream owns its samples: the caller's close frees nothing the next frame may still need
    second!.close()
    expect(state.decoded.at(-1)!.closed).toBe(false)
  })

  it('hands the preview the decoder’s own frame, a new one each time, without drawing anything', async () => {
    const reader = createMediabunnySampleReader()
    const sample = await reader.sampleAt(FILE, mid(30))
    const frame = sample!.videoFrame!() as unknown as { videoFrameOf: number }
    expect(Math.round(frame.videoFrameOf * 30)).toBe(30)
    expect(state.draws).toEqual([])
    expect(state.canvases).toEqual([])
  })

  it('hands over the colour tags of the track with every sample, for the provider’s BT.709 check', async () => {
    state.colourSpace = { primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl' }
    const sample = await createMediabunnySampleReader().sampleAt(FILE, 1)
    expect(sample?.colour).toEqual({ primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl' })
  })

  it('answers null past the last frame', async () => {
    expect(await createMediabunnySampleReader().sampleAt(FILE, (FRAMES + 5) / 30)).toBeNull()
  })

  it('refuses a rotated source rather than drawing it sideways', async () => {
    state.rotation = 90
    await expect(createMediabunnySampleReader().sampleAt(FILE, 1)).rejects.toThrow(
      /rotated 90 degrees/,
    )
  })

  it('refuses a file with no video track and one the browser cannot decode', async () => {
    state.hasTrack = false
    await expect(createMediabunnySampleReader().sampleAt(FILE, 1)).rejects.toThrow(/no video track/)
    state.hasTrack = true
    state.canDecode = false
    await expect(createMediabunnySampleReader().sampleAt(FILE, 1)).rejects.toThrow(/cannot be decoded/)
    expect(state.disposed).toBe(2)
  })

  it('does not remember a failed open: the next frame asks again', async () => {
    const reader = createMediabunnySampleReader()
    state.failOpens = 1
    await expect(reader.sampleAt(FILE, 1)).rejects.toThrow('open failed')
    await expect(reader.sampleAt(FILE, 1)).resolves.not.toBeNull()
    expect(state.opened).toBe(1)
  })

  it('ends every stream and disposes every input on destroy', async () => {
    const reader = createMediabunnySampleReader()
    await reader.sampleAt(FILE, 1)
    await reader.sampleAt({ ...FILE, key: 'piece:b' }, 1)
    reader.destroy()
    await vi.waitFor(() => expect(state.disposed).toBe(2))
    expect(state.returned).toBe(2)
    expect(state.decoded.every((s) => s.closed)).toBe(true)
  })
})
