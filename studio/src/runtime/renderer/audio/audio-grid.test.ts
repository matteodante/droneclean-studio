/**
 * The audio grid: every frame→sample boundary is `sampleAt` at the project rate, so a 59.94
 * timeline sits on 800.8 samples per frame without the float formula's one-sample error, and two
 * segments that meet on the timeline share one index (design 1.5, 4.3).
 */

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { AudioItem, TimelineTrack } from '@/types/timeline'
import { useCompositionsStore } from '@/runtime/renderer/deps/timeline-compositions-contract'
import { bufferSamples, sampleAt, toRate, type Rate } from '@/studio/time'

const { sampleSinkStartTimes } = vi.hoisted(() => ({ sampleSinkStartTimes: [] as number[] }))

vi.mock('mediabunny', () => {
  class UrlSource {
    constructor(public readonly url: string) {}
  }

  class Input {
    constructor(private readonly params: { source: UrlSource }) {}

    async getPrimaryAudioTrack() {
      return { src: this.params.source.url }
    }

    async computeDuration() {
      return 60
    }

    dispose() {}
  }

  class AudioSampleSink {
    constructor(private readonly track: { src: string }) {}

    async *samples(startTime = 0, endTime = 0) {
      sampleSinkStartTimes.push(startTime)
      const frameCount = Math.max(1, Math.round((endTime - startTime) * 48_000))
      const makePlane = () => new Float32Array(frameCount).fill(0.1)
      const planes = [makePlane(), makePlane()]

      yield {
        numberOfFrames: frameCount,
        numberOfChannels: 2,
        sampleRate: 48_000,
        copyTo(destination: Float32Array, options: { planeIndex: number }) {
          destination.set(planes[options.planeIndex] ?? planes[0]!)
        },
        close() {},
        trackSrc: this.track.src,
      }
    }
  }

  return { ALL_FORMATS: [], Input, UrlSource, AudioSampleSink }
})

import { buildClipFadeSpan, resolveItemFadeFields } from './clip-fades'
import { clearAudioDecodeCache } from './decode'
import { applyClipFadeSpans } from './dsp'
import { createAudioMixBuffer, segmentSampleSpan } from './mixdown'
import { processAudio } from './pipeline'

const SAMPLE_RATE = 48_000
const RATE_59_94 = toRate(59.94)
const RATE_29_97 = toRate(29.97)

/** The sample span a segment with these frames occupies in the output buffer. */
function span(startFrame: number, durationFrames: number, rate: Rate) {
  return segmentSampleSpan({ startFrame, durationFrames }, rate, SAMPLE_RATE)
}

/**
 * What the editor computed before task 1.5: `floor((frame / fps) · sampleRate)` with the rate as
 * a double. Kept here as the reference the integer grid must agree with wherever it was exact.
 */
function legacySampleAt(frame: number, fps: number): number {
  return Math.floor((frame / fps) * SAMPLE_RATE)
}

function makeTrack(items: TimelineTrack['items']): TimelineTrack {
  return {
    id: 'track-a1',
    name: 'A1',
    kind: 'audio',
    order: 0,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items,
  }
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-a1',
    from: 0,
    durationInFrames: 90,
    src: 'blob:audio',
    mediaId: 'media-1',
    label: 'Audio',
    ...overrides,
  } as AudioItem
}

function composition(
  items: AudioItem[],
  fps: number,
  durationInFrames: number,
): CompositionInputProps {
  return {
    fps,
    durationInFrames,
    width: 1920,
    height: 1080,
    tracks: [makeTrack(items)],
    transitions: [],
    keyframes: [],
  }
}

beforeEach(() => {
  useCompositionsStore.setState({
    compositions: [],
    compositionById: {},
    mediaDependencyIds: [],
    mediaDependencyVersion: 0,
  })
  clearAudioDecodeCache()
  sampleSinkStartTimes.length = 0
})

describe('the 59.94 sample grid', () => {
  it.each([
    [0, 0],
    [1, 800],
    [2, 1601],
    [3, 2402],
    [4, 3203],
    [5, 4004],
  ])('frame %i begins at sample %i', (frame, expected) => {
    expect(span(frame, 1, RATE_59_94).startSample).toBe(expected)
  })

  it('gives each frame 800 or 801 samples and sums to the exact boundary', () => {
    const frameLengths = [0, 1, 2, 3, 4, 5].map(
      (frame) => span(frame, 1, RATE_59_94).endSample - span(frame, 1, RATE_59_94).startSample,
    )

    // 800.8 samples per frame: a frame is 800 or 801 samples, and the six of them add up to
    // the exact boundary of frame 6.
    expect(frameLengths).toEqual([800, 801, 801, 801, 801, 800])
    expect(frameLengths.reduce((total, length) => total + length, 0)).toBe(
      sampleAt(6, RATE_59_94, SAMPLE_RATE),
    )
  })

  it('keeps a pre-rolled segment before frame 0 at a negative sample', () => {
    // A transition at the timeline's start can pre-roll a trimmed clip to a negative frame; the
    // mix shifts such a segment back into place, so its start sample must stay negative too.
    const preRoll = span(-3, 10, RATE_59_94)

    expect(preRoll.startSample).toBe(-2_403)
    expect(preRoll.startSample).toBe(legacySampleAt(-3, 59.94))
    expect(preRoll.endSample).toBe(sampleAt(7, RATE_59_94, SAMPLE_RATE))
  })
})

describe('adjacent segments tile', () => {
  it.each([
    ['59.94', RATE_59_94, [0, 7, 800, 801, 1_601, 4_004, 5_000]],
    ['29.97', RATE_29_97, [0, 3, 100, 1_001, 2_002, 5_000]],
  ])('no gap and no overlap at %s across every cut', (_label, rate, cuts) => {
    const spans = cuts.slice(0, -1).map((cut, index) => span(cut, cuts[index + 1]! - cut, rate))

    expect(spans[0]!.startSample).toBe(0)
    for (let index = 1; index < spans.length; index++) {
      expect(spans[index]!.startSample).toBe(spans[index - 1]!.endSample)
    }
    const last = spans[spans.length - 1]!
    expect(last.endSample).toBe(sampleAt(cuts[cuts.length - 1]!, rate, SAMPLE_RATE))
  })

  it.each([
    ['59.94', RATE_59_94, 1_199],
    ['29.97', RATE_29_97, 599],
  ])('%s: two equal clips sharing the cut share one boundary sample', (_label, rate, cut) => {
    const first = span(0, cut, rate)
    const second = span(cut, cut, rate)

    expect(first.endSample).toBe(second.startSample)
    expect(second.startSample).toBe(sampleAt(cut, rate, SAMPLE_RATE))
    // Both clips are non-empty and meet at one index: no sample belongs to neither or both.
    expect(first.endSample - first.startSample).toBeGreaterThan(0)
  })
})

describe('the mix buffer covers the last frame', () => {
  it('allocates 960,160 samples for 1,199 frames at 59.94', () => {
    const channels = createAudioMixBuffer({
      sampleRate: SAMPLE_RATE,
      channels: 2,
      fps: 59.94,
      totalFrames: 1_199,
    })

    expect(channels).toHaveLength(2)
    expect(channels[0]).toHaveLength(960_160)
    expect(bufferSamples(1_199, RATE_59_94, SAMPLE_RATE)).toBe(960_160)
  })

  it.each([
    [59.94, 1_199],
    [29.97, 599],
    [23.976, 480],
    [24, 7],
    [25, 7],
    [30, 31],
    [50, 7],
    [60, 31],
    [60, 1_199],
  ])('at %s fps, %i frames need the exact ceiling, never one sample less', (fps, frames) => {
    const rate = toRate(fps)
    const exact = Math.ceil((frames * SAMPLE_RATE * rate.den) / rate.num)
    const channels = createAudioMixBuffer({
      sampleRate: SAMPLE_RATE,
      channels: 2,
      fps,
      totalFrames: frames,
    })

    expect(channels[0]).toHaveLength(exact)
    expect(channels[0]).toHaveLength(bufferSamples(frames, rate, SAMPLE_RATE))
    // The float formula rounded up a hair past the integer at 25, 30, 50 and 60 fps: the exact
    // ceiling is never longer, and is one sample shorter where that rounding appeared.
    expect(channels[0]!.length).toBeLessThanOrEqual(Math.ceil((frames / fps) * SAMPLE_RATE))
  })
})

describe('fades are whole frames at the project rate', () => {
  it.each([
    [30, 0.5, 15],
    [30, 1, 30],
    [24, 0.25, 6],
    [60, 0.75, 45],
    [59.94, 0.5, 30],
    [59.94, 1, 60],
    [29.97, 0.5, 15],
    [23.976, 1, 24],
  ])('%s fps: an authored %s s fade is %i frames', (fps, seconds, expected) => {
    const fields = resolveItemFadeFields({ audioFadeIn: seconds, audioFadeOut: seconds }, fps)

    expect(fields.fadeInFrames).toBe(expected)
    expect(fields.fadeOutFrames).toBe(expected)
  })

  it.each([
    [59.94, [1, 2, 30, 59, 60, 299, 1_199]],
    [30, [1, 2, 15, 29, 30, 149, 600]],
  ])('at %s fps, a handle-authored fade keeps its frame count', (fps, lengths) => {
    for (const frames of lengths) {
      // The editor's handles store whole frames back as seconds (`fadeFrames / fps`).
      const fields = resolveItemFadeFields({ audioFadeIn: frames / fps }, fps)
      expect(fields.fadeInFrames).toBe(frames)
    }
  })

  it('starts and ends a clip fade span on the sample grid', () => {
    const samples = new Float32Array(SAMPLE_RATE * 2).fill(1)

    const faded = applyClipFadeSpans(
      samples,
      [buildClipFadeSpan({ startFrame: 60, durationInFrames: 60, fadeInFrames: 60 })],
      SAMPLE_RATE,
      59.94,
    )

    // Frames 0..59 are outside the span and untouched; the fade-in starts exactly at frame 60.
    expect(faded[0]).toBe(1)
    expect(faded[sampleAt(60, RATE_59_94, SAMPLE_RATE) - 1]).toBe(1)
    expect(faded[sampleAt(60, RATE_59_94, SAMPLE_RATE)]).toBe(0)
    expect(faded[sampleAt(60, RATE_59_94, SAMPLE_RATE) + 1]).toBeLessThan(0.01)
    expect(faded[sampleAt(60, RATE_59_94, SAMPLE_RATE) + 1]).toBeGreaterThan(0)
  })
})

describe('integer rates keep the samples that were exact', () => {
  it.each([24, 25, 30, 50, 60])('at %i fps every exact frame is unchanged', (fps) => {
    const rate = toRate(fps)
    const changed = []
    let exactFrames = 0

    for (let frame = 0; frame <= 20_000; frame++) {
      const exact = (frame * SAMPLE_RATE) / fps
      const legacy = legacySampleAt(frame, fps)
      // Only the frames today's float divide got exactly right are a promise to keep; where it
      // was one low, the exact integer is the correction this task exists to make.
      if (legacy !== exact) continue
      exactFrames++
      if (span(frame, 1, rate).startSample !== legacy) changed.push(frame)
    }

    expect(changed).toEqual([])
    // The check must not be vacuous: at 24 fps the float divide is exact for every frame, at
    // 25/30/50/60 for most of them.
    expect(exactFrames).toBeGreaterThan(18_000)
  })
})

describe('the mix places segments on the grid', () => {
  it.each([
    [0, 0],
    [1, 800],
    [2, 1601],
    [3, 2402],
    [4, 3203],
    [5, 4004],
  ])('frame %i is heard from sample %i through processAudio', async (from, expected) => {
    const result = await processAudio(
      composition([makeAudioItem({ from, durationInFrames: 1 })], 59.94, 10),
    )

    expect(result).not.toBeNull()
    const mixed = result!.samples[0]!
    expect(mixed).toHaveLength(bufferSamples(10, RATE_59_94, SAMPLE_RATE))
    expect(mixed[expected]).toBeCloseTo(0.1, 4)
    if (expected > 0) expect(mixed[expected - 1]).toBe(0)
    expect(mixed[expected + 800]).toBeCloseTo(0.1, 4)
  })

  it('asks the decoder for the trimmed source frame’s own start time', async () => {
    await processAudio(
      composition(
        [makeAudioItem({ from: 0, durationInFrames: 1, sourceStart: 100, sourceFps: 59.94 })],
        59.94,
        10,
      ),
    )

    // A trim stays in seconds, taken from the integer source frame at the source's exact rate:
    // 100 · 1001 / 60000, not 100 / 59.94.
    expect(sampleSinkStartTimes).toHaveLength(1)
    expect(sampleSinkStartTimes[0]).toBe((100 * 1_001) / 60_000)
  })

  it('gives a 1,199-frame clip at 59.94 a 960,160-sample buffer', async () => {
    const result = await processAudio(
      composition([makeAudioItem({ durationInFrames: 1_199 })], 59.94, 1_199),
    )

    expect(result).not.toBeNull()
    expect(result!.samples).toHaveLength(2)
    expect(result!.samples[0]).toHaveLength(960_160)
    expect(result!.sampleRate).toBe(SAMPLE_RATE)
  })
})
