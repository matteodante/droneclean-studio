/**
 * A clip's sound through its speed curve (design 7.1, section 4.3): the click-track test the
 * task is defined by, the guards that keep a ramped clip off the copy and streaming paths, and
 * the cases where a curve is deliberately left to the clip of today.
 *
 * The source is a PCM16 WAV generated in memory — 10 seconds at 48 kHz with one sample of
 * impulse every half second of source — read back with a small PCM reader and handed to the
 * pipeline by a sink that returns exactly the range it is asked for, so where each source
 * sample sits in the decoded buffer is known exactly. The project is 30 fps in and out, so a
 * timeline frame is exactly 1,600 samples and a sample of the mix maps back to a source sample
 * with no rounding of its own.
 */

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { AudioItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { useCompositionsStore } from '@/runtime/renderer/deps/timeline-compositions-contract'
import { bufferSamples, sampleAt, toRate } from '@/studio/time'
import {
  areaAt,
  averageSpeed,
  frameAtArea,
  normalizeSourceRemainder,
  sourceFramesAt,
  speedAt,
  type SpeedCurve,
  type SpeedKey,
} from '@/studio/speed'

const SAMPLE_RATE = 48_000
const RATE_30 = toRate(30)
const RATE_59_94 = toRate(59.94)

/** The PCM16 WAV every decode reads, and the ranges the pipeline asked for. */
const decodeState = vi.hoisted(() => ({
  samples: new Float32Array(0) as Float32Array,
  requests: [] as { startTime: number; endTime: number }[],
}))

/** The buffers the constant-speed path hands to the time-stretch, to see the cut's trim. */
const stretchState = vi.hoisted(() => ({
  stretches: [] as { lengths: number[]; firstSamples: number[] }[],
}))

vi.mock('./dsp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dsp')>()
  return {
    ...actual,
    applySpeedAndPitch: async (
      channels: Float32Array[],
      speed: number,
      pitchShiftSemitones: number,
      sampleRate: number,
    ) => {
      stretchState.stretches.push({
        lengths: channels.map((channel) => channel.length),
        firstSamples: channels.map((channel) => channel[0] ?? 0),
      })
      return actual.applySpeedAndPitch(channels, speed, pitchShiftSemitones, sampleRate)
    },
  }
})

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
    async *samples(startTime = 0, endTime = 0) {
      decodeState.requests.push({ startTime, endTime })
      const from = Math.max(0, Math.round(startTime * 48_000))
      const to = Math.min(decodeState.samples.length, Math.round(endTime * 48_000))
      const frames = Math.max(0, to - from)
      const plane = decodeState.samples.subarray(from, to)
      yield {
        numberOfFrames: frames,
        numberOfChannels: 1,
        sampleRate: 48_000,
        copyTo(destination: Float32Array) {
          destination.set(plane)
        },
        close() {},
      }
    }
  }

  return { ALL_FORMATS: [], Input, UrlSource, AudioSampleSink }
})

import {
  extractAudioSegments,
  getAudioPacketPassthroughPlan,
  supportsWindowedAudioProcessing,
} from './planning'
import { clearAudioDecodeCache } from './decode'
import { processAudio } from './pipeline'

/** The 1x -> 4x -> 1x ramp over 96 frames: 288 source frames, 9.6 s, average 3x. */
const RAMP_96: SpeedCurve = {
  keys: [
    { frame: 0, speed: 1 },
    { frame: 32, speed: 4 },
    { frame: 64, speed: 4 },
    { frame: 96, speed: 1 },
  ],
}

/** A curve that averages exactly 1x while its speed moves: 1 / 0.5 -> 1.5 -> 0.5. */
const SYMMETRIC_96: SpeedCurve = {
  keys: [
    { frame: 0, speed: 0.5 },
    { frame: 48, speed: 1.5 },
    { frame: 96, speed: 0.5 },
  ],
}

/** The length of the generated track, in samples: 10 s at 48 kHz. */
const TRACK_SAMPLES = 480_000

/** One sample of impulse every half second of source, as a PCM16 mono WAV in memory. */
function buildClickTrackWav(): Uint8Array {
  const clicks = new Float32Array(TRACK_SAMPLES)
  for (let click = 24_000; click < TRACK_SAMPLES; click += 24_000) clicks[click] = 1

  const bytes = new Uint8Array(44 + TRACK_SAMPLES * 2)
  const view = new DataView(bytes.buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index++) {
      bytes[offset + index] = text.charCodeAt(index)
    }
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + TRACK_SAMPLES * 2, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM format chunk size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  view.setUint32(40, TRACK_SAMPLES * 2, true)
  for (let index = 0; index < TRACK_SAMPLES; index++) {
    view.setInt16(44 + index * 2, Math.round(clicks[index]! * 32_767), true)
  }
  return bytes
}

/** The samples a PCM16 mono WAV decodes to, which is what the sink hands over. */
function readPcm16Wav(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const format = view.getUint16(20, true)
  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const bits = view.getUint16(34, true)
  if (format !== 1 || channels !== 1 || bits !== 16 || sampleRate !== SAMPLE_RATE) {
    throw new Error('The click track is not a 48 kHz mono PCM16 WAV')
  }
  const frames = view.getUint32(40, true) / 2
  const samples = new Float32Array(frames)
  for (let index = 0; index < frames; index++) {
    samples[index] = view.getInt16(44 + index * 2, true) / 32_768
  }
  return samples
}

function makeTrack(items: TimelineItem[], kind: 'video' | 'audio' = 'audio'): TimelineTrack {
  return {
    id: kind === 'video' ? 'track-v1' : 'track-a1',
    name: kind === 'video' ? 'V1' : 'A1',
    kind,
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
    durationInFrames: 96,
    src: 'blob:click-track',
    mediaId: 'media-click',
    label: 'Click track',
    sourceStart: 0,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  } as AudioItem
}

/** A video clip with embedded sound: its audio segment is the transition planner's, not a plain one. */
function makeVideoItem(overrides: Partial<AudioItem> = {}): TimelineItem {
  return {
    ...makeAudioItem(),
    type: 'video',
    trackId: 'track-v1',
    ...overrides,
  } as unknown as TimelineItem
}

function composition(
  tracks: TimelineTrack[],
  durationInFrames = 96,
  transitions: Transition[] = [],
): CompositionInputProps {
  return {
    fps: 30,
    durationInFrames,
    width: 1920,
    height: 1080,
    tracks,
    transitions,
    keyframes: [],
  }
}

/** The output sample index at which the ramp reads source sample `sourceSample` of the track. */
function outputSampleFor(sourceSample: number): number {
  const area = sourceSample / (SAMPLE_RATE / 30)
  return frameAtArea(RAMP_96, area) * (SAMPLE_RATE / 30)
}

/**
 * The parent's curve over the clip-relative window `[from, from + duration)`, the way a cut
 * re-windows it (design 7.1, section 4.6 and the 7.1f contract): the keys inside the window,
 * shifted back, endpoints carrying the speed at 0 and at the duration.
 */
function restrictCurve(curve: SpeedCurve, from: number, duration: number): SpeedCurve {
  const keys: SpeedKey[] = [{ frame: 0, speed: speedAt(curve, from) }]
  for (const key of curve.keys) {
    if (key.frame > from && key.frame < from + duration) {
      keys.push({ frame: key.frame - from, speed: key.speed })
    }
  }
  keys.push({ frame: duration, speed: speedAt(curve, from + duration) })
  return { keys }
}

/** The strongest sample within `radius` of `expected`: the impulse the interpolation left. */
function peakNear(samples: Float32Array, expected: number, radius: number): number {
  const centre = Math.round(expected)
  let best = centre
  let strength = 0
  for (
    let index = Math.max(0, centre - radius);
    index <= Math.min(samples.length - 1, centre + radius);
    index++
  ) {
    const value = Math.abs(samples[index]!)
    if (value > strength) {
      strength = value
      best = index
    }
  }
  return best
}

beforeEach(() => {
  useCompositionsStore.setState({
    compositions: [],
    compositionById: {},
    mediaDependencyIds: [],
    mediaDependencyVersion: 0,
  })
  clearAudioDecodeCache()
  decodeState.requests.length = 0
  decodeState.samples = readPcm16Wav(buildClickTrackWav())
  stretchState.stretches.length = 0
})

describe('the click track through a 1x -> 4x -> 1x ramp', () => {
  it('puts every impulse within one sample of its curve position, in order', async () => {
    const result = await processAudio(
      composition([
        makeTrack([
          makeAudioItem({
            durationInFrames: 96,
            speed: averageSpeed(RAMP_96),
            speedCurve: RAMP_96,
          }),
        ]),
      ]),
    )

    expect(result).not.toBeNull()
    const mix = result!.samples[0]!
    // The mix covers the timeline exactly: `bufferSamples` of the composition, and at 30 fps
    // that is `sampleAt` of the last frame's end, 153,600 samples for 3.2 s.
    expect(mix).toHaveLength(bufferSamples(96, RATE_30, SAMPLE_RATE))
    expect(mix).toHaveLength(sampleAt(96, RATE_30, SAMPLE_RATE))

    const span = areaAt(RAMP_96, 96) * (SAMPLE_RATE / 30)
    expect(span).toBe(460_800)
    const clicks: number[] = []
    for (let click = 24_000; click < span; click += 24_000) clicks.push(click)

    const found = clicks.map((click) => peakNear(mix, outputSampleFor(click), 8))
    expect(found).toHaveLength(19)
    // A single-sample impulse is read through the cubic kernel, so its peak shrinks as the read
    // positions straddle it (at 4x they are four source samples apart); what is asserted is its
    // place, not its height.
    for (const [index, sample] of found.entries()) {
      const expected = outputSampleFor(clicks[index]!)
      expect(Math.abs(sample - expected)).toBeLessThanOrEqual(1)
      expect(Math.abs(mix[sample]!)).toBeGreaterThan(0)
      if (index > 0) expect(sample).toBeGreaterThan(found[index - 1]!)
    }
  })

  it('asks the decoder for the curve’s exact span, not the average times the frames', async () => {
    await processAudio(
      composition([
        makeTrack([
          makeAudioItem({
            durationInFrames: 96,
            speed: averageSpeed(RAMP_96),
            speedCurve: RAMP_96,
          }),
        ]),
      ]),
    )

    expect(decodeState.requests).toHaveLength(1)
    expect(decodeState.requests[0]!.startTime).toBe(0)
    // 9.6 s of source for 3.2 s of timeline, plus the read's two-sample reach into the source.
    expect(decodeState.requests[0]!.endTime).toBeCloseTo(9.6 + 2 / 48_000, 9)
  })

  it('reads from the decoded range’s own start, so a trim cancels out of the position', async () => {
    // The clip starts two seconds into the source and the decoder hands back from there: the
    // read's positions are offsets into that range. Adding the trim again would move every
    // sample by two seconds.
    const accelerating: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 96, speed: 4 },
      ],
    }
    const result = await processAudio(
      composition([
        makeTrack([
          makeAudioItem({
            durationInFrames: 96,
            sourceStart: 60, // 2 s at 30 fps
            speed: averageSpeed(accelerating),
            speedCurve: accelerating,
          }),
        ]),
      ]),
    )

    expect(decodeState.requests[0]!.startTime).toBe(2)
    const mix = result!.samples[0]!
    // Source sample 240,000 is 90 frames of source into the clip, which the curve reaches at
    // area 90 (equal rates); that is output sample 90 · 1,600 at the far side of the walk.
    const expected = frameAtArea(accelerating, 90) * (SAMPLE_RATE / 30)
    const found = peakNear(mix, expected, 8)
    expect(Math.abs(found - expected)).toBeLessThanOrEqual(1)
    expect(Math.abs(mix[found]!)).toBeGreaterThan(0)
  })

  it('puts a cut clip’s impulses where its parent’s are, on the same timeline frames', async () => {
    // A cut at clip frame 15 of the ramp starts at source frame 25.546875: frame 25 plus a
    // remainder of 0.546875 (875 samples), which the read adds before any rounding — the
    // picture's `floor(area(n) + remainder)`. Without it every impulse would land 875 source
    // samples early, hundreds of output samples away from the parent's.
    const cut = 15
    const cutPosition = areaAt(RAMP_96, cut)
    const remainder = cutPosition - Math.floor(cutPosition)
    expect(remainder).toBeCloseTo(0.546875, 12)
    const childCurve = restrictCurve(RAMP_96, cut, 96 - cut)

    const parent = await processAudio(
      composition([
        makeTrack([
          makeAudioItem({
            durationInFrames: 96,
            speed: averageSpeed(RAMP_96),
            speedCurve: RAMP_96,
          }),
        ]),
      ]),
    )
    const child = await processAudio(
      composition([
        makeTrack([
          makeAudioItem({
            from: cut,
            durationInFrames: 96 - cut,
            sourceStart: Math.floor(cutPosition),
            // The store holds the remainder as a fraction (review finding T4); these are 35/64, 919/1001.
            sourceFrameOffset: normalizeSourceRemainder(remainder),
            sourceEnd: 288,
            speed: averageSpeed(childCurve),
            speedCurve: childCurve,
          }),
        ]),
      ]),
    )

    expect(parent).not.toBeNull()
    expect(child).not.toBeNull()
    // The child decodes from the whole source frame the cut floored to; the remainder is the
    // read's, not the decode's.
    expect(decodeState.requests[1]!.startTime).toBeCloseTo(25 / 30, 12)

    const clicks: number[] = []
    for (let click = 24_000; click < 288 * 1_600; click += 24_000) {
      if (click >= cutPosition * 1_600) clicks.push(click)
    }
    const parentMix = parent!.samples[0]!
    const childMix = child!.samples[0]!
    const foundParent = clicks.map((click) => peakNear(parentMix, outputSampleFor(click), 8))
    const foundChild = clicks.map((click) => peakNear(childMix, outputSampleFor(click), 8))

    expect(foundChild.length).toBeGreaterThan(10)
    for (const [index] of foundChild.entries()) {
      // The impulse must be at the parent's own index, not merely somewhere nearby: without the
      // remainder the nearest read is hundreds of output samples away and this sample is silent.
      expect(Math.abs(childMix[foundParent[index]!]!)).toBeGreaterThan(0)
      expect(Math.abs(foundChild[index]! - foundParent[index]!)).toBeLessThanOrEqual(1)
      if (index > 0) expect(foundChild[index]!).toBeGreaterThan(foundChild[index - 1]!)
    }
  })
})

describe('a cut inside a hold (a constant curve)', () => {
  /** A parent whose whole second half holds 4x: a cut from frame 32 on has a constant curve. */
  const HOLD_64: SpeedCurve = {
    keys: [
      { frame: 0, speed: 1 },
      { frame: 32, speed: 4 },
      { frame: 64, speed: 4 },
    ],
  }

  it('carries the cut’s remainder and trims the decoded start by it, before the stretch', async () => {
    // Cut at clip frame 41, inside the 4x hold, of a 59.94 source in a 30 fps project: the cut
    // falls 0.768 of a source frame between two frames, and the child's curve is a constant 4x,
    // so it keeps the pitch-preserving path and its remainder is a trim of the decoded start.
    const cut = 41
    const cutPosition = sourceFramesAt(HOLD_64, cut, RATE_59_94, RATE_30)
    const remainder = cutPosition - Math.floor(cutPosition)
    const childCurve = restrictCurve(HOLD_64, cut, 64 - cut)
    const childComposition = composition([
      makeTrack([
        makeAudioItem({
          from: cut,
          durationInFrames: 64 - cut,
          sourceStart: Math.floor(cutPosition),
          // The store holds the remainder as a fraction (review finding T4); these are 35/64, 919/1001.
          sourceFrameOffset: normalizeSourceRemainder(remainder),
          sourceEnd: Math.floor(sourceFramesAt(HOLD_64, 64, RATE_59_94, RATE_30)),
          sourceFps: 59.94,
          speed: averageSpeed(childCurve),
          speedCurve: childCurve,
        }),
      ]),
    ])

    const segments = extractAudioSegments(childComposition, 30)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.speedCurve).toBeUndefined()
    expect(segments[0]!.speed).toBe(4)
    expect(segments[0]!.sourceFrameOffset).toBeCloseTo(remainder, 12)

    // The decoded range starts on the whole source frame the cut floored to; the trim is the
    // remainder's samples. A marker at the trimmed sample identifies the stretch's input.
    const decodedStart = Math.round(((Math.floor(cutPosition) * 1001) / 60_000) * SAMPLE_RATE)
    const trim = Math.round((remainder * SAMPLE_RATE * 1001) / 60_000)
    expect(trim).toBe(615)
    decodeState.samples[decodedStart + trim] = 0.25

    const result = await processAudio(childComposition)
    expect(result).not.toBeNull()
    expect(decodeState.requests).toHaveLength(1)
    const request = decodeState.requests[0]!
    expect(Math.round(request.startTime * SAMPLE_RATE)).toBe(decodedStart)
    // The child ends where its parent's span does: 208 speed x frames = 332,800 source samples
    // at 59.94 over 48 kHz, 6.9333 s.
    expect(request.endTime).toBeCloseTo((208 * 2000) / 60_000, 9)
    expect(stretchState.stretches).toHaveLength(1)
    const decodedLength =
      Math.round(request.endTime * SAMPLE_RATE) - Math.round(request.startTime * SAMPLE_RATE)
    expect(stretchState.stretches[0]!.lengths[0]).toBe(decodedLength - trim)
    expect(stretchState.stretches[0]!.firstSamples[0]).toBe(0.25)
  })

  it('starts a cut inside a hold on the picture’s source sample, every click within one', async () => {
    // The same cut at 1x, where no time-stretch runs: every click of the track is measurable.
    const cut = 41
    const parentCurve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 96, speed: 1 },
      ],
    }
    const cutPosition = sourceFramesAt(parentCurve, cut, RATE_59_94, RATE_30)
    const remainder = cutPosition - Math.floor(cutPosition)
    const childCurve = restrictCurve(parentCurve, cut, 96 - cut)
    expect(remainder).toBeCloseTo(0.918081918, 9)

    const parent = await processAudio(
      composition([
        makeTrack([
          makeAudioItem({ durationInFrames: 96, sourceFps: 59.94, speedCurve: parentCurve }),
        ]),
      ]),
    )
    const child = await processAudio(
      composition([
        makeTrack([
          makeAudioItem({
            from: cut,
            durationInFrames: 96 - cut,
            sourceStart: Math.floor(cutPosition),
            // The store holds the remainder as a fraction (review finding T4); these are 35/64, 919/1001.
            sourceFrameOffset: normalizeSourceRemainder(remainder),
            sourceEnd: Math.floor(sourceFramesAt(parentCurve, 96, RATE_59_94, RATE_30)),
            sourceFps: 59.94,
            speedCurve: childCurve,
          }),
        ]),
      ]),
    )

    expect(parent).not.toBeNull()
    expect(child).not.toBeNull()
    // 0.918 of a source frame at 59.94 is 735 samples of 48 kHz, taken off the decoded start.
    expect(Math.round((remainder * SAMPLE_RATE * 1001) / 60_000)).toBe(735)
    expect(stretchState.stretches).toHaveLength(0)

    const parentMix = parent!.samples[0]!
    const childMix = child!.samples[0]!
    // At 1x the parent's clips are the WAV's own samples: its clicks sit on the multiples of
    // 24,000 samples, and the cut's sound must put them at the same timeline samples.
    for (const click of [72_000, 96_000, 120_000, 144_000]) {
      const parentPeak = peakNear(parentMix, click, 8)
      const childPeak = peakNear(childMix, click, 8)
      expect(parentPeak).toBe(click)
      expect(Math.abs(childMix[parentPeak]!)).toBeGreaterThan(0)
      expect(Math.abs(childPeak - parentPeak)).toBeLessThanOrEqual(1)
    }
  })

  it('is the audio of today, byte for byte, when the curve carries no remainder', async () => {
    const constant: SpeedCurve = {
      keys: [
        { frame: 0, speed: 2 },
        { frame: 96, speed: 2 },
      ],
    }
    const withCurve = await processAudio(
      composition([makeTrack([makeAudioItem({ speed: 2, speedCurve: constant })])]),
    )
    const withoutCurve = await processAudio(composition([makeTrack([makeAudioItem({ speed: 2 })])]))

    expect(withCurve).not.toBeNull()
    expect(withCurve!.samples[0]).toEqual(withoutCurve!.samples[0])
    expect(decodeState.requests[0]).toEqual(decodeState.requests[1])
  })

  it('refuses the copy and streaming paths for a remainder without a varying curve', () => {
    const constant: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 96, speed: 1 },
      ],
    }
    const item = makeAudioItem({
      speed: 1,
      speedCurve: constant,
      sourceFrameOffset: { num: 1, den: 2 },
    })

    expect(
      getAudioPacketPassthroughPlan(composition([makeTrack([makeAudioItem()])])),
    ).not.toBeNull()
    expect(getAudioPacketPassthroughPlan(composition([makeTrack([item])]))).toBeNull()
    expect(supportsWindowedAudioProcessing(composition([makeTrack([item])]))).toBe(false)
    const segments = extractAudioSegments(composition([makeTrack([item])]), 30)
    expect(segments[0]!.speedCurve).toBeUndefined()
    expect(segments[0]!.sourceFrameOffset).toBe(0.5)
  })
})

describe('a curved clip whose curve is flat at 1x', () => {
  it('is the uncurved clip, sample for sample', async () => {
    const flat: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 96, speed: 1 },
      ],
    }
    const withCurve = await processAudio(
      composition([makeTrack([makeAudioItem({ speed: 1, speedCurve: flat })])]),
    )
    const withoutCurve = await processAudio(composition([makeTrack([makeAudioItem({ speed: 1 })])]))

    expect(withCurve).not.toBeNull()
    expect(withoutCurve).not.toBeNull()
    expect(withCurve!.samples[0]).toEqual(withoutCurve!.samples[0])
    // Not two silences: a constant curve is the clip of today, so the mix is the WAV itself.
    const track = decodeState.samples
    expect(withoutCurve!.samples[0]![24_000]).toBe(track[24_000]!)
    expect(withoutCurve!.samples[0]![24_001]).toBe(track[24_001]!)
    expect(withoutCurve!.samples[0]).toHaveLength(153_600)
  })
})

describe('the segment the planner builds', () => {
  it('carries the curve of a video clip’s embedded sound', () => {
    const segments = extractAudioSegments(
      composition([makeTrack([makeVideoItem({ speed: 3, speedCurve: RAMP_96 })], 'video')]),
      30,
    )

    expect(segments).toHaveLength(1)
    expect(segments[0]!.speedCurve).toEqual(RAMP_96)
    expect(segments[0]!.speed).toBe(3)
  })

  it('leaves a constant curve to the clip of today’s speed', () => {
    const segments = extractAudioSegments(
      composition([
        makeTrack([
          makeAudioItem({
            speed: 1,
            speedCurve: {
              keys: [
                { frame: 0, speed: 1 },
                { frame: 96, speed: 1 },
              ],
            },
          }),
        ]),
      ]),
      30,
    )

    expect(segments).toHaveLength(1)
    expect(segments[0]!.speedCurve).toBeUndefined()
  })

  it('leaves a reversed clip’s curve to the store, which drops it', () => {
    const segments = extractAudioSegments(
      composition([
        makeTrack([makeAudioItem({ isReversed: true, speed: 3, speedCurve: RAMP_96 })]),
      ]),
      30,
    )

    expect(segments).toHaveLength(1)
    expect(segments[0]!.speedCurve).toBeUndefined()
  })

  it('keeps the curve on a segment a transition extends, pre-roll included', () => {
    // A centred 12-frame transition: the incoming clip's segment starts six frames early and
    // reads them at the clip's average speed, 3x — 18 source frames, exactly the source below
    // the clip's own start that the transition gave it.
    const curve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 48, speed: 5 },
      ],
    }
    const transition: Transition = {
      id: 't1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-a1',
      durationInFrames: 12,
      alignment: 0.5,
    }
    const segments = extractAudioSegments(
      composition(
        [
          makeTrack([
            makeAudioItem({ id: 'left', from: 0, durationInFrames: 48, sourceEnd: 48 }),
            makeAudioItem({
              id: 'right',
              from: 48,
              durationInFrames: 48,
              sourceStart: 96,
              sourceEnd: 144,
              speed: averageSpeed(curve),
              speedCurve: curve,
            }),
          ]),
        ],
        96,
        [transition],
      ),
      30,
    )

    expect(averageSpeed(curve)).toBe(3)
    const incoming = segments.find((segment) => segment.itemId === 'right')!
    expect(incoming.startFrame).toBe(42)
    expect(incoming.durationFrames).toBe(54)
    expect(incoming.contentStartOffsetFrames).toBe(6)
    expect(incoming.speedCurve).toEqual(curve)
    // The pre-roll reads six frames at 3x from the segment's decode start, which lands exactly
    // on the clip's own source start.
    expect(incoming.sourceStartFrame + 6 * incoming.speed).toBe(96)
    expect(segments.find((segment) => segment.itemId === 'left')!.speedCurve).toBeUndefined()
  })

  it('never merges the two halves of a split curved clip, so each keeps its own curve (T2)', () => {
    // The two halves of a 1x -> 4x -> 1x ramp cut in its middle play the same source back to
    // back at the same average speed, which is what the continuity merge looks for; one
    // segment cannot carry two curves, so curved clips are never merged.
    const leftCurve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 1 },
        { frame: 48, speed: 4 },
      ],
    }
    const rightCurve: SpeedCurve = {
      keys: [
        { frame: 0, speed: 4 },
        { frame: 48, speed: 1 },
      ],
    }
    const segments = extractAudioSegments(
      composition([
        makeTrack(
          [
            makeVideoItem({
              id: 'video-1',
              from: 0,
              durationInFrames: 48,
              sourceStart: 0,
              sourceEnd: 120,
              speedCurve: leftCurve,
              speed: averageSpeed(leftCurve),
            }),
            makeVideoItem({
              id: 'video-2',
              from: 48,
              durationInFrames: 48,
              sourceStart: 120,
              sourceEnd: 240,
              speedCurve: rightCurve,
              speed: averageSpeed(rightCurve),
            }),
          ],
          'video',
        ),
      ]),
      30,
    )

    expect(averageSpeed(leftCurve)).toBe(averageSpeed(rightCurve))
    expect(segments.map((segment) => segment.itemId).sort()).toEqual(['video-1', 'video-2'])
    expect(segments.find((segment) => segment.itemId === 'video-1')!.speedCurve).toEqual(leftCurve)
    expect(segments.find((segment) => segment.itemId === 'video-2')!.speedCurve).toEqual(rightCurve)
  })
})

describe('the paths that copy or stream a whole file', () => {
  const symmetricItem = (): AudioItem =>
    makeAudioItem({
      durationInFrames: 96,
      speed: averageSpeed(SYMMETRIC_96),
      speedCurve: SYMMETRIC_96,
    })

  it('refuses the audio packet copy for a curve that averages exactly 1x', () => {
    expect(averageSpeed(SYMMETRIC_96)).toBe(1)
    expect(
      getAudioPacketPassthroughPlan(composition([makeTrack([makeAudioItem()])])),
    ).not.toBeNull()
    expect(getAudioPacketPassthroughPlan(composition([makeTrack([symmetricItem()])]))).toBeNull()
  })

  it('refuses the windowed mixer for a curve that averages exactly 1x', () => {
    expect(supportsWindowedAudioProcessing(composition([makeTrack([makeAudioItem()])]))).toBe(true)
    expect(supportsWindowedAudioProcessing(composition([makeTrack([symmetricItem()])]))).toBe(false)
  })
})
