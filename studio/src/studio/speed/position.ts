/**
 * The one mapping from a clip frame to its source position (review finding T8):
 * `clipSourcePosition(clip, clipFrame, projectFps)`. The preview, the export, the audio, the
 * filmstrip, the shadow mark, motion blur and every edit (split, trim, join, stretch, in/out
 * export) ask here, so they cannot disagree about which source frame a clip frame shows.
 *
 * For a forward clip the position is
 *
 *     floor(sourceStart) + rem + advance(m)
 *
 * where `rem` is the cut's remainder (`sourceFrameOffset`, a fraction in `[0, 1)`) and
 * `advance(m)` is the curve's integral `area(m)` — or `m · speed` without a curve — times the
 * rate ratio `sNum · pDen / (sDen · pNum)`. Every term is exact (`@/studio/time`'s fractions,
 * `exact-curve.ts`), so the source frame, the floor of the position, is the same wherever it is
 * asked. Before the clip's first frame (a transition's pre-roll) the clip's constant `speed`
 * holds, which on a curved clip is the curve's average — the speed the transition span is built
 * with. A reversed clip has no curve and no remainder (v1 hides both, design 7.1, section 4.6):
 * it shows `sourceEnd − 1 − floor(m · speed · ratio)`.
 *
 * Two readers stay outside this mapping on purpose. A reversed clip keeps FreeCut's own maths
 * everywhere (its split, trim and in/out export too): v1 gives it neither a curve nor a remainder.
 * The preview's DOM `<video>` fast path in `canvas-item-renderer/gpu.ts` lets the element play at
 * one constant rate, so on a constant-speed clip that carries a remainder its picture can be one
 * frame off while playing; the render redesign removes that fast path for exact-frame clips.
 */

import {
  addFractions,
  exactSpeed,
  fraction,
  floorFraction,
  floorScaledFrames,
  multiplyFractions,
  rateRatio,
  toRate,
  type Fraction,
  type Rate,
} from '@/studio/time'
import { areaAt, type SpeedCurve } from './curve'
import { exactAreaAt } from './exact-curve'
import { remainderFraction, sourceRemainderValue, type SourceRemainder } from './remainder'

/** The fields of a clip the mapping reads; a timeline item is one. */
export interface ClipTiming {
  /** The item's kind: a curve maps only on video and audio clips. */
  readonly type?: string
  /** The source frame at the clip's first frame, before the remainder; floored if fractional. */
  readonly sourceStart?: number
  /** The source frame the clip ends on (a reversed clip starts there). */
  readonly sourceEnd?: number
  /** The source's frame rate; the project's when absent. */
  readonly sourceFps?: number
  /** The constant speed, or a curved clip's average (a length, used only before frame 0). */
  readonly speed?: number
  /** The speed curve, on a forward video or audio clip. */
  readonly speedCurve?: SpeedCurve
  /** The cut's remainder: the fractional part of the position at frame 0. */
  readonly sourceFrameOffset?: SourceRemainder
  /** Whether the clip plays its source backwards. */
  readonly isReversed?: boolean
  /** The clip's length in timeline frames: a reversed clip without a `sourceEnd` needs it. */
  readonly durationInFrames?: number
}

/** Where a clip frame takes its picture from. */
export interface ClipSourcePosition {
  /** The source frame shown: the floor of `position`. */
  readonly frame: number
  /** The exact source position, in source frames, `floor(sourceStart)` included. */
  readonly position: Fraction
}

/** The clip's curve when the mapping uses it: a forward video or audio clip's. */
export function mappedSpeedCurve(clip: ClipTiming): SpeedCurve | undefined {
  if (clip.isReversed === true) return undefined
  if (clip.type !== undefined && clip.type !== 'video' && clip.type !== 'audio') return undefined
  return clip.speedCurve
}

/** The rates a clip maps between: its source's, the project's when it has none, and the project's. */
export function clipRates(
  clip: ClipTiming,
  projectFps: number | Rate,
): { sourceRate: Rate; projectRate: Rate } {
  const projectRate = toRate(projectFps)
  return {
    sourceRate: clip.sourceFps === undefined ? projectRate : toRate(clip.sourceFps),
    projectRate,
  }
}

/** The source frame of the clip's frame 0 before the remainder: a legacy fractional start floored. */
export function clipSourceBase(clip: ClipTiming): number {
  return Math.max(0, Math.floor(clip.sourceStart ?? 0))
}

/**
 * The exact advance from frame 0 to `clipFrame`, in source frames: the curve's integral, or
 * `clipFrame · speed`, times the rate ratio. A frame before 0 advances backwards at the clip's
 * constant speed.
 */
function advanceAt(
  clip: ClipTiming,
  clipFrame: number,
  sourceRate: Rate,
  projectRate: Rate,
): Fraction {
  const ratio = rateRatio(sourceRate, projectRate)
  const curve = mappedSpeedCurve(clip)
  if (curve !== undefined && clipFrame >= 0) {
    return multiplyFractions(exactAreaAt(curve, clipFrame), ratio)
  }
  return multiplyFractions(
    multiplyFractions(exactSpeed(clip.speed ?? 1), fraction(clipFrame)),
    ratio,
  )
}

/**
 * The exact source position of a forward clip's frame, counted from `floor(sourceStart)`:
 * `rem + advance(clipFrame)`. The edits read it to place a cut.
 *
 * @throws RangeError when `clipFrame` is not a safe integer, or a rate, the speed or a key is
 * broken (as `toRate`, `exactSpeed` and `validateSpeedCurve` name them).
 */
export function clipSourceOffset(
  clip: ClipTiming,
  clipFrame: number,
  projectFps: number | Rate,
): Fraction {
  if (!Number.isSafeInteger(clipFrame)) {
    throw new RangeError(`clipSourcePosition: clipFrame must be an integer, got ${clipFrame}`)
  }
  const { sourceRate, projectRate } = clipRates(clip, projectFps)
  return addFractions(
    remainderFraction(clip.sourceFrameOffset),
    advanceAt(clip, clipFrame, sourceRate, projectRate),
  )
}

/**
 * Where the clip's frame `clipFrame` (counted from its first frame; negative inside a
 * transition's pre-roll) takes its picture from: the integer source frame and the exact
 * position. The one mapping every reader asks (see the module comment).
 *
 * @throws RangeError when `clipFrame` is not a safe integer, or a rate, the speed or a key is
 * broken (as `toRate`, `exactSpeed` and `validateSpeedCurve` name them).
 */
export function clipSourcePosition(
  clip: ClipTiming,
  clipFrame: number,
  projectFps: number | Rate,
): ClipSourcePosition {
  const base = clipSourceBase(clip)
  if (clip.isReversed === true) {
    if (!Number.isSafeInteger(clipFrame)) {
      throw new RangeError(`clipSourcePosition: clipFrame must be an integer, got ${clipFrame}`)
    }
    const { sourceRate, projectRate } = clipRates(clip, projectFps)
    const speed = exactSpeed(clip.speed ?? 1)
    const end = Math.floor(
      clip.sourceEnd ??
        base +
          floorScaledFrames(Math.round(clip.durationInFrames ?? 0), speed, sourceRate, projectRate),
    )
    const frame = end - 1 - floorScaledFrames(clipFrame, speed, sourceRate, projectRate)
    return { frame, position: fraction(frame) }
  }
  const position = addFractions(fraction(base), clipSourceOffset(clip, clipFrame, projectFps))
  return { frame: Number(floorFraction(position)), position }
}

/**
 * The one mapping in seconds, for the timeline's filmstrip and waveform (review finding T8): the
 * source seconds a forward clip has advanced past its first frame's whole source frame at a
 * clip-relative timeline time — the cut's remainder plus the curve's integral, which in seconds
 * is `area(t · fps) / fps` whatever the source's rate. A double: a drawing reads between frames
 * and needs no floor. Before the clip's first frame the clip's constant speed holds.
 *
 * `undefined` where a drawing linear in the clip's speed is already exact — no curve and no
 * remainder — and for a reversed clip, which keeps its constant speed (see the module comment).
 */
export function clipSourceOffsetSeconds(
  clip: ClipTiming,
  projectFps: number | Rate,
): ((clipSeconds: number) => number) | undefined {
  if (clip.isReversed === true) return undefined
  const curve = mappedSpeedCurve(clip)
  const remainder = sourceRemainderValue(clip.sourceFrameOffset)
  if (curve === undefined && remainder === 0) return undefined
  const { sourceRate, projectRate } = clipRates(clip, projectFps)
  const remainderSeconds = (remainder * sourceRate.den) / sourceRate.num
  const framesPerSecond = projectRate.num / projectRate.den
  const speed = clip.speed ?? 1
  return (clipSeconds) => {
    if (curve === undefined || !(clipSeconds >= 0)) return remainderSeconds + clipSeconds * speed
    return remainderSeconds + areaAt(curve, clipSeconds * framesPerSecond) / framesPerSecond
  }
}

/**
 * The source time, in seconds, a timeline drawing — a filmstrip thumbnail, a waveform column —
 * puts at the clip-relative time `clipSeconds`: `effectiveStart` plus the clip's mapping
 * (`clipSourceOffsetSeconds`) when it has one, else FreeCut's linear `clipSeconds · speed`; a
 * reversed clip counts back from `effectiveEnd` at its constant speed.
 */
export function drawnSourceSeconds(params: {
  readonly clipSeconds: number
  readonly effectiveStart: number
  readonly effectiveEnd: number
  readonly speed: number
  readonly isReversed: boolean
  readonly sourceOffsetAt: ((clipSeconds: number) => number) | undefined
}): number {
  const { clipSeconds, effectiveStart, effectiveEnd, speed, isReversed, sourceOffsetAt } = params
  if (isReversed) return effectiveEnd - clipSeconds * speed
  if (sourceOffsetAt !== undefined) return effectiveStart + sourceOffsetAt(clipSeconds)
  return effectiveStart + clipSeconds * speed
}
