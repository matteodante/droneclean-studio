// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { prerenderCache } from './cache'
import {
  prerenderPlayer,
  prerenderServesFrame,
  prerenderShowedLaterFrame,
  presentPrerenderedFrame,
} from './playback'
import type { FrameRange } from './ranges'

/** A WebCodecs decoder that delivers what it was fed only when the test says so */
class FakeDecoder {
  static instances: FakeDecoder[] = []
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured'
  decodeQueueSize = 0
  fed: number[] = []
  resets = 0
  private pending: number[] = []
  constructor(
    private readonly init: { output: (frame: unknown) => void; error: (e: Error) => void },
  ) {
    FakeDecoder.instances.push(this)
  }
  configure() {
    this.state = 'configured'
  }
  decode(chunk: { timestamp: number }) {
    this.fed.push(chunk.timestamp)
    this.pending.push(chunk.timestamp)
  }
  reset() {
    this.resets += 1
    this.pending = []
    this.fed = []
  }
  close() {
    this.state = 'closed'
  }
  deliver() {
    const pending = this.pending
    this.pending = []
    for (const timestamp of pending) {
      this.init.output({ timestamp, displayWidth: 64, displayHeight: 36, close: () => undefined })
    }
  }
  fail() {
    this.init.error(new Error('decode failed'))
  }
}

class FakeCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return { drawImage: () => undefined }
  }
}

class FakeChunk {
  readonly timestamp: number
  constructor(init: { timestamp: number }) {
    this.timestamp = init.timestamp
  }
}

let hashOf: (frame: number) => number = () => 1
const source = (range: FrameRange) =>
  Float64Array.from({ length: range.end - range.start }, (_, index) => hashOf(range.start + index))

function cacheRun(start: number, end: number, keyInterval = 10) {
  const run = prerenderCache.beginRun(
    start,
    source({ start, end }),
    { codec: 'avc1.640033', codedWidth: 64, codedHeight: 36 },
    keyInterval,
  )
  for (let frame = start; frame < end; frame += 1) {
    prerenderCache.appendChunk(run, {
      data: new Uint8Array(4),
      key: (frame - start) % keyInterval === 0,
    })
  }
  prerenderCache.flush()
  return run
}

function decoder(): FakeDecoder {
  const last = FakeDecoder.instances.at(-1)
  if (last === undefined) throw new Error('no decoder was made')
  return last
}

beforeEach(() => {
  vi.stubGlobal('VideoDecoder', FakeDecoder)
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal('EncodedVideoChunk', FakeChunk)
  FakeDecoder.instances = []
  hashOf = () => 1
  prerenderPlayer.reset()
  prerenderCache.setHashSource(source)
  prerenderCache.clear()
})

afterEach(() => {
  prerenderPlayer.reset()
  prerenderCache.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('prerenderPlayer.frameFor', () => {
  it('decodes ahead of the playhead and answers each frame once it is decoded', () => {
    cacheRun(0, 60)
    expect(prerenderPlayer.frameFor(0, 1).kind).toBe('pending')
    expect(decoder().fed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    decoder().deliver()
    expect(prerenderPlayer.frameFor(0, 1).kind).toBe('ready')
    expect(prerenderPlayer.frameFor(1, 1).kind).toBe('ready')
    // The look-ahead moves with the playhead
    expect(decoder().fed.at(-1)).toBe(9)
  })

  it('answers no for a frame outside every run, and for reverse playback', () => {
    cacheRun(0, 60)
    expect(prerenderPlayer.frameFor(80, 1).kind).toBe('none')
    expect(prerenderPlayer.frameFor(10, -1).kind).toBe('none')
  })

  it('never answers a stale frame, even one already decoded', () => {
    cacheRun(0, 60)
    prerenderPlayer.frameFor(0, 1)
    decoder().deliver()
    expect(prerenderPlayer.frameFor(2, 1).kind).toBe('ready')
    hashOf = (frame) => (frame === 3 ? 2 : 1)
    prerenderCache.markDirty()
    expect(prerenderPlayer.frameFor(3, 1).kind).toBe('none')
    expect(prerenderPlayer.frameFor(4, 1).kind).toBe('ready')
  })

  it('starts from the key frame before a frame the playhead jumped to', () => {
    cacheRun(0, 60)
    prerenderPlayer.frameFor(0, 1)
    decoder().deliver()
    expect(prerenderPlayer.frameFor(45, 1).kind).toBe('pending')
    expect(decoder().resets).toBe(1)
    expect(decoder().fed[0]).toBe(40)
    decoder().deliver()
    expect(prerenderPlayer.frameFor(45, 1).kind).toBe('ready')
  })

  it('decodes the start of a range before the playhead reaches it', () => {
    cacheRun(20, 60)
    expect(prerenderPlayer.frameFor(15, 1).kind).toBe('none')
    expect(decoder().fed).toEqual([20, 21, 22, 23])
    decoder().deliver()
    for (let frame = 16; frame < 20; frame += 1) prerenderPlayer.frameFor(frame, 1)
    expect(prerenderPlayer.frameFor(20, 1).kind).toBe('ready')
  })

  it('gives up waiting after a while, so the frame is rendered live', () => {
    cacheRun(0, 60)
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    expect(prerenderPlayer.frameFor(0, 1).kind).toBe('pending')
    now.mockReturnValue(1100)
    expect(prerenderPlayer.frameFor(0, 1).kind).toBe('pending')
    now.mockReturnValue(1200)
    expect(prerenderPlayer.frameFor(0, 1).kind).toBe('none')
  })

  it('drops a run its decoder cannot read, and the frames play live', () => {
    const run = cacheRun(0, 60)
    prerenderPlayer.frameFor(0, 1)
    decoder().fail()
    expect(prerenderCache.holds(run)).toBe(false)
    expect(prerenderPlayer.frameFor(1, 1).kind).toBe('none')
  })

  it('primes the decoder while paused, so playback starts on a ready picture', () => {
    cacheRun(0, 60)
    prerenderPlayer.prime(12)
    decoder().deliver()
    expect(prerenderPlayer.frameFor(12, 1).kind).toBe('ready')
  })
})

describe('presentPrerenderedFrame and prerenderShowedLaterFrame', () => {
  it('draws a cached frame, and keeps a late live render of an earlier frame off the screen', () => {
    cacheRun(0, 60)
    prerenderPlayer.prime(0)
    decoder().deliver()
    const drawn: unknown[] = []
    expect(presentPrerenderedFrame(5, 1, (canvas) => drawn.push(canvas))).toBe('presented')
    expect(drawn).toHaveLength(1)
    expect(prerenderShowedLaterFrame(3, true, 1)).toBe(true)
    expect(prerenderShowedLaterFrame(6, true, 1)).toBe(false)
    // Paused, the live render of the paused frame is always shown
    expect(prerenderShowedLaterFrame(3, false, 1)).toBe(false)
  })

  it('tells the pump which frames need no live render', () => {
    cacheRun(0, 60)
    expect(prerenderServesFrame(10, 1)).toBe(true)
    expect(prerenderServesFrame(70, 1)).toBe(false)
    expect(prerenderServesFrame(10, -1)).toBe(false)
  })

  it('hands the frame back to the live path outside the cache', () => {
    cacheRun(0, 60)
    expect(presentPrerenderedFrame(70, 1, () => undefined)).toBe('live')
    expect(prerenderShowedLaterFrame(65, true, 1)).toBe(false)
  })
})
