// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { PrerenderCache, type CachedRun } from './cache'
import type { FrameRange } from './ranges'
import { usePrerenderStore } from './store'

const DECODER: VideoDecoderConfig = { codec: 'avc1.640033', codedWidth: 640, codedHeight: 360 }

/** A state whose hash of frame `f` is `hashOf(f)`; tests edit `hashOf` to make frames stale */
let hashOf: (frame: number) => number = () => 1
const source = (range: FrameRange) =>
  Float64Array.from({ length: range.end - range.start }, (_, index) => hashOf(range.start + index))

function render(cache: PrerenderCache, start: number, end: number, keyInterval = 10): CachedRun {
  const run = cache.beginRun(start, source({ start, end }), DECODER, keyInterval)
  for (let frame = start; frame < end; frame += 1) {
    cache.appendChunk(run, { data: new Uint8Array(100), key: (frame - start) % keyInterval === 0 })
  }
  cache.flush()
  return run
}

let cache: PrerenderCache

beforeEach(() => {
  hashOf = () => 1
  cache = new PrerenderCache()
  cache.setHashSource(source)
  cache.useProject('p1')
})

describe('PrerenderCache', () => {
  it('holds a rendered run as valid and publishes its range and size', () => {
    render(cache, 0, 60)
    expect(cache.validRanges()).toEqual([{ start: 0, end: 60 }])
    expect(cache.validRunAt(59)).not.toBeNull()
    expect(cache.validRunAt(60)).toBeNull()
    expect(usePrerenderStore.getState().ranges).toEqual([{ start: 0, end: 60 }])
    expect(usePrerenderStore.getState().bytes).toBe(6000)
  })

  it('never answers a stale frame: a change is checked before the next answer', () => {
    render(cache, 0, 60)
    hashOf = (frame) => (frame >= 20 && frame < 30 ? 2 : 1)
    cache.markDirty()
    // Asked at once, before the delayed check: the hashes are checked first
    expect(cache.validRunAt(25)).toBeNull()
    expect(cache.validRunAt(19)).not.toBeNull()
    expect(cache.validRanges()).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 60 },
    ])
  })

  it('frees a group of pictures with no valid frame, and keeps a group a valid frame needs', () => {
    render(cache, 0, 60)
    // Frames 20-29 (one whole group) and 35 (inside the group 30-39) become stale
    hashOf = (frame) => ((frame >= 20 && frame < 30) || frame === 35 ? 2 : 1)
    cache.markDirty()
    cache.ensureFresh()
    expect(cache.totalBytes).toBe(5000)
    expect(cache.validRanges()).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 35 },
      { start: 36, end: 60 },
    ])
  })

  it('makes a frame valid again when an undo brings its drawing back, while its group is kept', () => {
    render(cache, 0, 60)
    hashOf = (frame) => (frame === 35 ? 2 : 1)
    cache.markDirty()
    expect(cache.validRunAt(35)).toBeNull()
    hashOf = () => 1
    cache.markDirty()
    expect(cache.validRunAt(35)).not.toBeNull()
  })

  it('drops a run all of whose frames went stale', () => {
    const run = render(cache, 0, 30)
    hashOf = () => 3
    cache.markDirty()
    cache.ensureFresh()
    expect(cache.holds(run)).toBe(false)
    expect(cache.totalBytes).toBe(0)
    expect(usePrerenderStore.getState().ranges).toEqual([])
  })

  it('forgets everything when another project opens', () => {
    render(cache, 0, 30)
    cache.useProject('p2')
    expect(cache.validRanges()).toEqual([])
    expect(cache.totalBytes).toBe(0)
  })

  it('merges adjacent runs into one range for the ruler', () => {
    render(cache, 0, 30)
    render(cache, 30, 50)
    expect(cache.validRanges()).toEqual([{ start: 0, end: 50 }])
    expect(cache.validRunAt(40)?.start).toBe(30)
  })

  it('counts every change, so a running job can tell', () => {
    const before = cache.changeCount
    cache.markDirty()
    cache.markDirty()
    expect(cache.changeCount).toBe(before + 2)
  })
})
