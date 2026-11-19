/**
 * Random-input (property) tests for the timing maths (PLAN.md D14; the time-core brief's
 * properties a–d). Each property draws at least 10,000 cases from a seeded generator — no
 * dependency, the same cases on every run — over random curves with speeds to the hundredth,
 * random cut points and every pair of the eight project rates, and checks every frame of each
 * case. A failure names its case so it can be replayed as a fixed test.
 */

import { beforeAll, describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { resetTimelineItemsTestState } from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { getVideoTargetTimeSeconds } from '@/runtime/composition-runtime/utils/video-timing'
import {
  getItemRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
} from '@/runtime/renderer/render-span'
import {
  exactSpeed,
  fraction,
  fractionToNumber,
  multiplyFractions,
  sampleAt,
  secondsToFrame,
  subtractFractions,
  toRate,
  type Fraction,
} from '@/studio/time'
import type { SpeedCurve, SpeedKey } from './curve'
import { averageSpeed } from './curve'
import { windowSpeedCurve } from './edits'
import { clipSourcePosition } from './position'
import { resampleThroughCurve } from './audio'
import { sourceRemainderValue, type SourceRemainder } from './remainder'

/** The eight project rates, as the store and the project file name them. */
const RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const

/** At least this many cases per property (the brief: 10,000, under 30 s each). */
const CASES = 10_000

/**
 * Each property's time limit: the brief's 30 s. Alone each takes 0.1–2.3 s on this Mac; the
 * default 5 s is not enough when the whole suite runs beside a verify.
 */
const PROPERTY_TIMEOUT_MS = 30_000

/** mulberry32: a small seeded generator, so every run draws the same cases. */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** An integer in `[low, high]`. */
function integer(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1))
}

/** A speed a person can enter: a hundredth in `0.1..10`. */
function hundredth(random: () => number): number {
  return integer(random, 10, 1_000) / 100
}

/** A random curve over `duration` frames with 2–5 keys and at least two different speeds. */
function randomCurve(random: () => number, duration: number): SpeedCurve {
  const inner = new Set<number>()
  const innerCount = Math.min(duration - 1, integer(random, 0, 3))
  while (inner.size < innerCount) inner.add(integer(random, 1, duration - 1))
  const frames = [0, ...[...inner].sort((a, b) => a - b), duration]
  const keys: SpeedKey[] = frames.map((frame) => ({ frame, speed: hundredth(random) }))
  if (keys.every((key) => key.speed === keys[0]!.speed)) {
    keys[keys.length - 1] = { frame: duration, speed: keys[0]!.speed === 10 ? 9.99 : 10 }
  }
  return { keys }
}

/** A random clip: a rate pair, a start, a curve or a hundredth speed, maybe a remainder. */
function randomClip(
  random: () => number,
  options: { curved: boolean; maxDuration: number },
): { item: VideoItem; projectFps: number } {
  const projectFps = RATES[integer(random, 0, RATES.length - 1)]!
  const sourceFps = RATES[integer(random, 0, RATES.length - 1)]!
  const durationInFrames = integer(random, 2, options.maxDuration)
  const speedCurve = options.curved ? randomCurve(random, durationInFrames) : undefined
  const remainder: SourceRemainder | undefined =
    random() < 0.5 ? undefined : { num: integer(random, 1, 999), den: 1_000 }
  const item: VideoItem = {
    id: 'clip',
    type: 'video',
    trackId: 'track-v',
    from: 0,
    durationInFrames,
    label: 'clip.mp4',
    src: 'blob:clip',
    mediaId: 'media-1',
    sourceStart: integer(random, 4_000, 6_000),
    sourceDuration: 1_000_000,
    sourceFps,
    speed: speedCurve === undefined ? hundredth(random) : averageSpeed(speedCurve),
    ...(speedCurve !== undefined ? { speedCurve } : {}),
    ...(remainder !== undefined ? { sourceFrameOffset: remainder } : {}),
  }
  return { item, projectFps }
}

/** The store's own copy of a clip, after its normaliser. */
function storeClip(item: VideoItem, projectFps: number): VideoItem {
  resetTimelineItemsTestState()
  useTimelineSettingsStore.setState({ fps: projectFps })
  useItemsStore.getState().setItems([item])
  return useItemsStore.getState().itemById[item.id] as VideoItem
}

/** The source frames a clip shows on each of its frames, through the one mapping. */
function framesOf(item: VideoItem, projectFps: number, count = item.durationInFrames): number[] {
  return Array.from(
    { length: count },
    (_, frame) => clipSourcePosition(item, frame, projectFps).frame,
  )
}

/** The first frame of `actual` that differs from `expected` (offset by `from`), or -1. */
function firstMismatch(actual: readonly number[], expected: readonly number[], from = 0): number {
  return actual.findIndex((frame, index) => frame !== expected[index + from])
}

beforeAll(() => {
  resetTimelineItemsTestState()
})

describe('property (a): a cut never changes a frame', () => {
  it(
    'splits a random curved clip at a random frame: both halves show the parent’s frames',
    () => {
      const random = generator(0xa11ce)
      const failures: string[] = []
      for (let index = 0; index < CASES && failures.length < 5; index++) {
        const { item, projectFps } = randomClip(random, { curved: true, maxDuration: 90 })
        const parent = storeClip(item, projectFps)
        const expected = framesOf(parent, projectFps)
        const cut = integer(random, 1, parent.durationInFrames - 1)
        const result = useItemsStore.getState()._splitItem('clip', cut)!
        const left = result.leftItem as VideoItem
        const right = result.rightItem as VideoItem
        const leftAt = firstMismatch(framesOf(left, projectFps), expected)
        const rightAt = firstMismatch(framesOf(right, projectFps), expected, cut)
        if (leftAt >= 0 || rightAt >= 0) {
          failures.push(
            `case ${index}: ${JSON.stringify({ item, projectFps, cut, leftAt, rightAt })}`,
          )
        }
      }
      expect(failures).toEqual([])
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    'splits, then joins the halves back: the joined clip shows the parent’s frames',
    () => {
      const random = generator(0xb0b)
      const failures: string[] = []
      for (let index = 0; index < CASES && failures.length < 5; index++) {
        const { item, projectFps } = randomClip(random, {
          curved: random() < 0.75,
          maxDuration: 90,
        })
        const parent = storeClip(item, projectFps)
        const expected = framesOf(parent, projectFps)
        const cut = integer(random, 1, parent.durationInFrames - 1)
        const { rightItem } = useItemsStore.getState()._splitItem('clip', cut)!
        useItemsStore.getState()._joinItems(['clip', rightItem.id])
        const joined = useItemsStore.getState().itemById['clip'] as VideoItem
        const at = firstMismatch(framesOf(joined, projectFps), expected)
        if (at >= 0 || joined.durationInFrames !== parent.durationInFrames) {
          failures.push(`case ${index}: ${JSON.stringify({ item, projectFps, cut, at })}`)
        }
      }
      expect(failures).toEqual([])
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    'trims a random clip and extends it back: the kept frames are the parent’s throughout',
    () => {
      // A trim forgets the part of a curve it removes (the curve's keys are the clip's), so the
      // frames a re-extension reveals hold the speed at the trimmed edge: on a clip at one speed
      // they are the parent's again, on a curved one they are the held speed's.
      const random = generator(0xc0ffee)
      const failures: string[] = []
      for (let index = 0; index < CASES && failures.length < 5; index++) {
        const curved = random() < 0.75
        const { item, projectFps } = randomClip(random, { curved, maxDuration: 90 })
        const parent = storeClip(item, projectFps)
        const expected = framesOf(parent, projectFps)
        const duration = parent.durationInFrames
        const amount = integer(random, 1, duration - 1)
        const atStart = random() < 0.5
        const store = useItemsStore.getState()
        if (atStart) store._trimItemStart('clip', amount)
        else store._trimItemEnd('clip', -amount)
        const trimmed = useItemsStore.getState().itemById['clip'] as VideoItem
        const kept = duration - amount
        const trimmedAt = firstMismatch(
          framesOf(trimmed, projectFps),
          expected,
          atStart ? amount : 0,
        )
        if (atStart) store._trimItemStart('clip', -amount)
        else store._trimItemEnd('clip', amount)
        const back = useItemsStore.getState().itemById['clip'] as VideoItem
        const backFrames = framesOf(back, projectFps)
        const keptBack = atStart ? backFrames.slice(amount) : backFrames.slice(0, kept)
        const keptAt = firstMismatch(keptBack, expected, atStart ? amount : 0)
        const wholeAt = curved ? -1 : firstMismatch(backFrames, expected)
        if (
          trimmed.durationInFrames !== kept ||
          back.durationInFrames !== duration ||
          trimmedAt >= 0 ||
          keptAt >= 0 ||
          wholeAt >= 0
        ) {
          failures.push(
            `case ${index}: ${JSON.stringify({ item, projectFps, amount, atStart, trimmedAt, keptAt, wholeAt })}`,
          )
        }
      }
      expect(failures).toEqual([])
    },
    PROPERTY_TIMEOUT_MS,
  )

  it(
    'cuts repeatedly inside one ramp segment: every inserted key stays on the parent’s line',
    () => {
      // A key a cut inserts at `u` of a segment `(0, V0) .. (L, V1)` holds `(V0·L + dV·u) / L`
      // hundredths; cut again and again, the keys still read back as that fraction, so their
      // denominators stay divisors of `100·L` (the reading's 2^23 bound holds up to the ramp
      // limit).
      const random = generator(0xd00d)
      const failures: string[] = []
      for (let index = 0; index < CASES && failures.length < 5; index++) {
        const length = integer(random, 2, 83_886)
        const first = integer(random, 10, 1_000)
        let last = integer(random, 10, 1_000)
        if (last === first) last = first === 1_000 ? 999 : first + 1
        let curve: SpeedCurve = {
          keys: [
            { frame: 0, speed: first / 100 },
            { frame: length, speed: last / 100 },
          ],
        }
        let offset = 0
        for (let cut = 0; cut < 4 && length - offset > 1; cut++) {
          const at = integer(random, 1, length - offset - 1)
          curve = windowSpeedCurve(curve, at, length - offset)
          offset += at
          const line = fraction(first * length + (last - first) * offset, 100 * length)
          const read = exactSpeed(curve.keys[0]!.speed)
          if (
            read.num !== line.num ||
            read.den !== line.den ||
            BigInt(100 * length) % read.den !== BigInt(0)
          ) {
            failures.push(`case ${index}: ${JSON.stringify({ first, last, length, offset })}`)
            break
          }
        }
      }
      expect(failures).toEqual([])
    },
    PROPERTY_TIMEOUT_MS,
  )
})

describe('property (b): the preview and the export pick the same source frame', () => {
  it(
    'agrees for random clips, curved or not, remainder or not, at every frame',
    () => {
      const random = generator(0xe1e)
      const failures: string[] = []
      for (let index = 0; index < CASES && failures.length < 5; index++) {
        const { item, projectFps } = randomClip(random, { curved: random() < 0.6, maxDuration: 40 })
        const clip = storeClip(item, projectFps)
        const sourceFps = clip.sourceFps!
        const span = getItemRenderTimelineSpan(clip)
        for (let frame = 0; frame < clip.durationInFrames; frame++) {
          const mapped = clipSourcePosition(clip, frame, projectFps).frame
          const preview = secondsToFrame(
            toRate(sourceFps),
            getVideoTargetTimeSeconds(
              clip.sourceStart ?? 0,
              sourceFps,
              frame,
              clip.speed ?? 1,
              projectFps,
              0,
              false,
              undefined,
              clip.speedCurve,
              clip.sourceFrameOffset,
            ),
          )
          const exported = secondsToFrame(
            toRate(sourceFps),
            resolveVideoRenderSourceTimeSeconds(clip, span, frame, projectFps),
          )
          if (preview !== mapped || exported !== mapped) {
            failures.push(
              `case ${index}: ${JSON.stringify({ item, projectFps, frame, mapped, preview, exported })}`,
            )
            break
          }
        }
      }
      expect(failures).toEqual([])
    },
    PROPERTY_TIMEOUT_MS,
  )
})

describe('property (c): the sound is where the picture is', () => {
  /** A decoded "source" whose sample `i` holds `i`: the read's value is the position it read. */
  const ramp = new Float32Array(8_000_000).map((_, index) => index)

  it(
    'reads each frame’s source position within one sample of the picture’s',
    () => {
      const random = generator(0xf00)
      const failures: string[] = []
      let checked = 0
      const sampleRate = 48_000
      for (let index = 0; index < CASES && failures.length < 5; index++) {
        const { item, projectFps } = randomClip(random, { curved: true, maxDuration: 120 })
        const clip = storeClip(item, projectFps)
        if (clip.speedCurve === undefined) continue
        const projectRate = toRate(projectFps)
        const sourceRate = toRate(clip.sourceFps!)
        // A frame whose instant falls on an output sample: every frame at 24, 25, 30, 50 and 60
        // fps and at 23.976 (2,002 samples a frame), every fifth at 29.97 and 59.94. There the
        // read and the picture ask for the same instant, so they must agree to the sample.
        const step = projectRate.den === 1001 && projectRate.num !== 24_000 ? 5 : 1
        const frame = step * integer(random, 0, Math.floor((clip.durationInFrames - 1) / step))
        // The picture: the exact position past the whole source frame the decode starts on.
        const position: Fraction = subtractFractions(
          clipSourcePosition(clip, frame, projectFps).position,
          fraction(clip.sourceStart ?? 0),
        )
        const expected = fractionToNumber(
          multiplyFractions(position, fraction(sampleRate * sourceRate.den, sourceRate.num)),
        )
        // The sound: the varispeed read of the output sample the frame starts on.
        const outputSample = sampleAt(frame, projectRate, sampleRate)
        const [read] = resampleThroughCurve([ramp], {
          curve: clip.speedCurve,
          projectRate,
          sourceRate,
          sourceSampleRate: sampleRate,
          outputSampleRate: sampleRate,
          firstOutputSample: outputSample,
          outputSampleCount: 1,
          clipStartFrame: 0,
          preRollFrames: 0,
          averageSpeed: clip.speed!,
          sourceFrameOffset: sourceRemainderValue(clip.sourceFrameOffset),
        })
        const heard = read![0]!
        checked += 1
        if (Math.abs(heard - expected) > 1) {
          failures.push(
            `case ${index}: ${JSON.stringify({ item, projectFps, frame, heard, expected })}`,
          )
        }
      }
      expect(failures).toEqual([])
      expect(checked).toBeGreaterThanOrEqual(CASES * 0.99)
    },
    PROPERTY_TIMEOUT_MS,
  )
})

describe('property (d): a clip at one speed of a different rate keeps every frame when cut', () => {
  it(
    'splits a constant-speed clip at any frame: both halves show the parent’s frames',
    () => {
      const random = generator(0x1d)
      const failures: string[] = []
      let differentRates = 0
      for (let index = 0; index < CASES && failures.length < 5; index++) {
        const { item, projectFps } = randomClip(random, { curved: false, maxDuration: 120 })
        if (item.sourceFps === projectFps && random() < 0.8) {
          // Mostly different rates: that is where a cut lands between two source frames.
          item.sourceFps = RATES[(RATES.indexOf(projectFps as (typeof RATES)[number]) + 1) % 8]
        }
        if (item.sourceFps !== projectFps) differentRates += 1
        const parent = storeClip(item, projectFps)
        const expected = framesOf(parent, projectFps)
        const cut = integer(random, 1, parent.durationInFrames - 1)
        const result = useItemsStore.getState()._splitItem('clip', cut)!
        const leftAt = firstMismatch(framesOf(result.leftItem as VideoItem, projectFps), expected)
        const rightAt = firstMismatch(
          framesOf(result.rightItem as VideoItem, projectFps),
          expected,
          cut,
        )
        if (leftAt >= 0 || rightAt >= 0) {
          failures.push(
            `case ${index}: ${JSON.stringify({ item, projectFps, cut, leftAt, rightAt })}`,
          )
        }
      }
      expect(failures).toEqual([])
      expect(differentRates).toBeGreaterThan(CASES * 0.8)
    },
    PROPERTY_TIMEOUT_MS,
  )
})
