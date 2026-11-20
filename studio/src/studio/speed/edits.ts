/**
 * The timing of the edits that cut or resize a clip — split, trim, join, an in/out export, an
 * edge stretch — computed from the one mapping, `clipSourcePosition` (review findings T3, T4,
 * T7, F2). FreeCut's store and trim helpers call these in one line each; the maths lives here.
 *
 * The rule every cut follows: the sub-clip of a clip's frames `[from, from + duration)` starts
 * where the clip's mapping is at `from`. The exact position there, `P(from)`, puts its whole
 * part into `sourceStart` and its fractional part into the remainder (`sourceFrameOffset`), and
 * a curve is re-windowed so its integral on the sub-clip is the parent's less the integral
 * before the cut. Every term is a fraction, so the sub-clip shows exactly the parent's source
 * frame on every frame, curved or not, at any pair of rates.
 *
 * A key a cut inserts holds the speed the parent's line has there, `(V_i·L + dV·u) / (100·L)`:
 * stored as its correctly rounded double, it reads back as that fraction (`exactSpeed`, up to a
 * segment of 83,886 frames), and a later cut inside the same segment lands on the same line,
 * so its denominator stays a divisor of `100·L`. Only an edit by a person — a curve edit, an
 * edge stretch — rounds speeds to the hundredth, and it re-authors the mapping, so it drops the
 * remainder (the first frame's source frame is unchanged).
 *
 * A reversed clip, a composition wrapper and a composition's audio keep FreeCut's own maths:
 * their mapping is not this one (v1 hides a curve there, design 7.1, section 4.6).
 */

import {
  addFractions,
  exactSpeed,
  floorFraction,
  fraction,
  fractionalPart,
  fractionToNumber,
  multiplyFractions,
  rateRatio,
  subtractFractions,
  divideFractions,
  type Rate,
} from '@/studio/time'
import { averageSpeed, constantSpeed, MAX_CURVE_SPEED, MIN_CURVE_SPEED } from './curve'
import type { SpeedCurve, SpeedKey } from './curve'
import { coalesceEaseSlices, easeFieldsForWindow, scaledEaseFields } from './ease-cut'
import { exactAreaAt, exactSpeedAt } from './exact-curve'
import { normalizeSpeedCurve } from './normalize'
import {
  clipRates,
  clipSourceBase,
  clipSourceOffset,
  mappedSpeedCurve,
  type ClipTiming,
} from './position'
import { remainderFraction, toSourceRemainder, type SourceRemainder } from './remainder'

/** A clip as the edits read it: its mapping, its length, and what bounds its source. */
export interface EditableClip extends ClipTiming {
  /** The clip's length in timeline frames. */
  readonly durationInFrames: number
  /** A composition's audio carries the sub-composition it plays; its time is not source frames. */
  readonly compositionId?: string
  /** The source's length in source frames, when known. */
  readonly sourceDuration?: number
}

/**
 * What an edit writes on a clip. A key present with `undefined` removes the field: a window
 * that holds one speed has no curve, a cut on a whole source frame has no remainder.
 */
export interface ClipTimingUpdate {
  sourceStart?: number
  sourceEnd?: number
  speed?: number
  speedCurve?: SpeedCurve
  sourceFrameOffset?: SourceRemainder
}

/** The two halves of a split. */
export interface SplitTiming {
  readonly left: ClipTimingUpdate
  readonly right: ClipTimingUpdate
}

/** How a rate stretch treats the clip's speed curve (design 7.1, section 4.6). */
export interface RateStretchOptions {
  /**
   * Keep the clip's curve and scale it with the duration, its shape unchanged: what dragging a
   * clip's edge does. Without it the curve is dropped and the clip plays at one speed — a
   * constant speed is the no-curve case (design 7.1, section 4.1), so every caller that sets a
   * speed (the clip panel's slider, the SDK's `clips.setSpeed`, a speed reset) leaves it off.
   */
  readonly keepSpeedCurve?: boolean
  /**
   * Push the clips after the stretched clip only by how far it now passes the next clip's
   * start on its track (`overlapPushAfterStretch`), not by the whole growth, and never pull
   * them back when the clip gets shorter. What a speed edit does (task 11.3); FreeCut's own
   * callers leave it off and keep its ripple.
   */
  readonly rippleOverlapOnly?: boolean
}

/** Whether a clip's edits are computed here: a forward video or audio clip of a media source. */
function hasExactTiming(clip: EditableClip): boolean {
  return (
    (clip.type === 'video' || clip.type === 'audio') &&
    clip.isReversed !== true &&
    clip.compositionId === undefined
  )
}

/** The speed a clip with `curve` stores: one speed when the curve holds one, else the average. */
export function speedOfCurve(curve: SpeedCurve): number {
  return constantSpeed(curve) ?? averageSpeed(curve)
}

/**
 * The speed a cut at the integer `frame` gives the key it inserts: a key's own stored double on
 * a key, the last key's past the last key, and inside a segment the correctly rounded double of
 * the line's exact value there (which `exactSpeed` reads back as that value).
 */
function cutSpeed(curve: SpeedCurve, frame: number): number {
  const last = curve.keys[curve.keys.length - 1]!
  if (frame >= last.frame) return last.speed
  const onKey = curve.keys.find((key) => key.frame === frame)
  if (onKey !== undefined) return onKey.speed
  return fractionToNumber(exactSpeedAt(curve, frame))
}

/**
 * The part of `curve` over the clip frames `[fromFrame, toFrame]`, rebased to start at frame 0
 * (design 7.1, section 4.6): the keys strictly inside keep their speed and a key is placed on
 * both ends with the speed the curve holds there, so the window's integral is the parent's less
 * the integral before `fromFrame`, exactly (see the module comment). An eased segment the window
 * cuts keeps the parent's ramp as a slice (`ease-cut.ts`), so the window still shows the parent's
 * frames.
 */
export function windowSpeedCurve(
  curve: SpeedCurve,
  fromFrame: number,
  toFrame: number,
): SpeedCurve {
  const from = Math.round(fromFrame)
  const to = Math.round(toFrame)
  const length = Math.max(1, to - from)
  const inner = curve.keys.filter((key) => key.frame > from && key.frame < to)
  const cutFrames = [from, ...inner.map((key) => key.frame), to]
  const keys: SpeedKey[] = [
    { frame: 0, speed: cutSpeed(curve, from) },
    ...inner.map((key) => ({ frame: key.frame - from, speed: key.speed })),
    { frame: length, speed: cutSpeed(curve, to) },
  ].map((key, index) =>
    index < cutFrames.length - 1
      ? { ...key, ...easeFieldsForWindow(curve, cutFrames[index]!, cutFrames[index + 1]!) }
      : key,
  )
  // `length >= 1`, at least two keys and speeds on the parent's lines: the normaliser keeps it.
  return normalizeSpeedCurve({ keys }, length) ?? curve
}

/**
 * The curve with `frames` frames held at its first speed placed before it: a trim that extends
 * a clip to the left reveals source the curve never covered, and the speed a curve holds before
 * its first key is the first key's (design 7.1, section 4.6).
 */
function extendSpeedCurveStart(curve: SpeedCurve, frames: number, duration: number): SpeedCurve {
  const keys: SpeedKey[] = [
    { frame: 0, speed: curve.keys[0]!.speed },
    ...curve.keys.map((key) => ({ ...key, frame: key.frame + frames })),
  ]
  return normalizeSpeedCurve({ keys }, duration) ?? curve
}

/**
 * The curve scaled to a new clip length with its shape kept — an edge stretch (design 7.1,
 * section 4.6): every key's frame by `toDuration / fromDuration`, every speed by the inverse and
 * rounded to the hundredth, as a person's edit is. `undefined` when a speed would leave
 * `0.1..10` (review finding T7: the stretch is refused, not clamped) or the normaliser refuses
 * the result (a ramp longer than `MAX_RAMP_SEGMENT_FRAMES`).
 */
export function stretchSpeedCurve(
  curve: SpeedCurve,
  fromDuration: number,
  toDuration: number,
): SpeedCurve | undefined {
  const factor = toDuration / fromDuration
  const keys: SpeedKey[] = []
  for (const key of curve.keys) {
    const speed = key.speed / factor
    if (!(speed >= MIN_CURVE_SPEED && speed <= MAX_CURVE_SPEED)) return undefined
    keys.push({
      frame: key.frame * factor,
      speed: Math.round(speed * 100) / 100,
      ...scaledEaseFields(key, factor, factor),
    })
  }
  return normalizeSpeedCurve({ keys }, toDuration)
}

/** Place one part's keys in the joined clip's frames, one key at a seam when it can be. */
function placePartKeys(keys: SpeedKey[], curve: SpeedCurve, offset: number): void {
  for (const key of curve.keys) {
    const frame = offset + key.frame
    const previous = keys[keys.length - 1]
    if (previous === undefined || frame > previous.frame) {
      keys.push({ ...key, frame })
    } else if (key.speed !== previous.speed) {
      // The seam: the same frame from both parts is one key when the speed agrees (two halves
      // of a split always agree, the cut's key being one double), and a one-frame ramp when it
      // does not, because a linear speed cannot hold a step.
      keys.push({ ...key, frame: previous.frame + 1 })
    } else {
      // One key: the part that starts there owns the segment that follows, and so its ease.
      keys[keys.length - 1] = { ...key, frame: previous.frame }
    }
  }
}

/**
 * The curve of a clip joined from `parts` (design 7.1, section 4.6), or `undefined` when no part
 * has one: each part's keys moved to its place, a part without a curve contributing the flat
 * curve of its own speed. Joining the two halves of a split puts back the parent's curve, with
 * the cut's key a point on its line.
 */
function joinSpeedCurves(
  parts: readonly (EditableClip & { readonly from: number })[],
  totalDuration: number,
  firstFrom: number,
): SpeedCurve | undefined {
  if (!parts.some((part) => mappedSpeedCurve(part) !== undefined)) return undefined
  const keys: SpeedKey[] = []
  for (const part of parts) {
    const curve =
      mappedSpeedCurve(part) ??
      normalizeSpeedCurve(
        { keys: [{ frame: 0, speed: part.speed ?? 1 }] },
        Math.round(part.durationInFrames),
      )
    if (curve === undefined) continue
    placePartKeys(keys, curve, Math.round(part.from) - Math.round(firstFrom))
  }
  const joined = normalizeSpeedCurve({ keys }, totalDuration)
  return joined === undefined ? undefined : { keys: coalesceEaseSlices(joined.keys) }
}

/** The whole source frame and the remainder of an exact position past `floor(sourceStart)`. */
function splitPosition(
  base: number,
  offset: ReturnType<typeof clipSourceOffset>,
): {
  sourceStart: number
  sourceFrameOffset: SourceRemainder | undefined
} {
  return {
    sourceStart: base + Number(floorFraction(offset)),
    sourceFrameOffset: toSourceRemainder(fractionalPart(offset)),
  }
}

/** `floor(sourceStart) + floor(P(clipFrame))`: the source end of a clip that stops at `clipFrame`. */
function sourceEndAt(clip: EditableClip, clipFrame: number, projectFps: number | Rate): number {
  return clipSourceBase(clip) + Number(floorFraction(clipSourceOffset(clip, clipFrame, projectFps)))
}

/**
 * The sub-clip of a clip's frames `[fromFrame, fromFrame + duration)`: where it starts (whole
 * source frame and remainder), where it ends — the clip's own `sourceEnd` when the sub-clip
 * reaches the clip's end, else the mapping's floor there — and its re-windowed curve. A split's
 * halves, a trim's kept range and an in/out export's clip are all this.
 */
function windowTiming(
  clip: EditableClip,
  fromFrame: number,
  duration: number,
  projectFps: number | Rate,
): ClipTimingUpdate {
  const from = Math.round(fromFrame)
  const to = from + Math.max(1, Math.round(duration))
  const update: ClipTimingUpdate = {
    ...splitPosition(clipSourceBase(clip), clipSourceOffset(clip, from, projectFps)),
    sourceEnd:
      to === Math.round(clip.durationInFrames) && clip.sourceEnd !== undefined
        ? clip.sourceEnd
        : sourceEndAt(clip, to, projectFps),
  }
  const curve = mappedSpeedCurve(clip)
  if (curve === undefined) return update
  const windowed = windowSpeedCurve(curve, from, to)
  return { ...update, speedCurve: windowed, speed: speedOfCurve(windowed) }
}

/**
 * The sub-clip of a forward media clip's frames `[fromFrame, fromFrame + duration)` (see
 * `windowTiming`) — an in/out export's clip — or `null` for a clip FreeCut's own maths cuts
 * (see `hasExactTiming`).
 */
export function windowClipTiming(
  clip: EditableClip,
  fromFrame: number,
  duration: number,
  projectFps: number | Rate,
): ClipTimingUpdate | null {
  return hasExactTiming(clip) ? windowTiming(clip, fromFrame, duration, projectFps) : null
}

/**
 * The two halves of a clip split after `leftDuration` frames, or `null` for a clip FreeCut's
 * own maths splits (see `hasExactTiming`). The left half keeps the parent's start and
 * remainder; the right half starts on the cut's exact position.
 */
export function splitClipTiming(
  clip: EditableClip,
  leftDuration: number,
  projectFps: number | Rate,
): SplitTiming | null {
  if (!hasExactTiming(clip)) return null
  const left = Math.round(leftDuration)
  const total = Math.round(clip.durationInFrames)
  return {
    left: windowTiming(clip, 0, left, projectFps),
    right: windowTiming(clip, left, total - left, projectFps),
  }
}

/** The speed at the clip's frame `frame` as a fraction: its curve's there, or its one speed. */
function speedFractionAt(clip: EditableClip, frame: number): ReturnType<typeof exactSpeed> {
  const curve = mappedSpeedCurve(clip)
  return curve === undefined ? exactSpeed(clip.speed ?? 1) : exactSpeedAt(curve, frame)
}

/**
 * A start trim that reveals `frames` frames before the clip: they hold the speed the clip has
 * at its first frame, so the start moves back by exactly that many source frames and the
 * remainder follows. A position before source 0 — which the clamp normally prevents — stops at
 * 0 with no remainder.
 */
function extendStartTiming(
  clip: EditableClip,
  frames: number,
  projectFps: number | Rate,
): ClipTimingUpdate {
  const { sourceRate, projectRate } = clipRates(clip, projectFps)
  const revealed = multiplyFractions(
    multiplyFractions(speedFractionAt(clip, 0), fraction(frames)),
    rateRatio(sourceRate, projectRate),
  )
  const offset = subtractFractions(remainderFraction(clip.sourceFrameOffset), revealed)
  const start = splitPosition(clipSourceBase(clip), offset)
  const update: ClipTimingUpdate =
    start.sourceStart < 0 ? { sourceStart: 0, sourceFrameOffset: undefined } : start
  const curve = mappedSpeedCurve(clip)
  if (curve === undefined) return update
  const extended = extendSpeedCurveStart(curve, frames, Math.round(clip.durationInFrames) + frames)
  return { ...update, speedCurve: extended, speed: speedOfCurve(extended) }
}

/**
 * An end trim to `newDuration` frames: a shorter clip is its own first `newDuration` frames, a
 * longer one holds its last speed over the frames it reveals. The start and remainder do not
 * move, so only the end, and a curve, are written.
 */
function trimEndTiming(
  clip: EditableClip,
  newDuration: number,
  projectFps: number | Rate,
): ClipTimingUpdate {
  const curve = mappedSpeedCurve(clip)
  const shorter = newDuration < Math.round(clip.durationInFrames)
  const resized =
    curve === undefined
      ? undefined
      : shorter
        ? windowSpeedCurve(curve, 0, newDuration)
        : (normalizeSpeedCurve(curve, newDuration) ?? curve)
  const update: ClipTimingUpdate = {
    sourceEnd: sourceEndAt({ ...clip, speedCurve: resized }, newDuration, projectFps),
  }
  if (resized === undefined) return update
  return { ...update, speedCurve: resized, speed: speedOfCurve(resized) }
}

/**
 * The timing a trim writes on a forward media clip, or `null` where FreeCut's own maths trims:
 * a clip `hasExactTiming` refuses, and the end of a clip at one speed. `amount` is the trim in
 * timeline frames — positive shrinks a start, extends an end — and `newDuration` the length
 * after it.
 *
 * A start trim moves the clip's first frame, so it is a cut: the new start and remainder come
 * from the mapping, curved or not (review finding T4). An end trim moves neither the start nor
 * the remainder, so the frames a clip at one speed shows do not depend on it; FreeCut's
 * delta-based source end (which keeps a clip's explicit bounds from drifting) stays. A curved
 * clip's end follows its curve — re-windowed, or holding its last speed past it — and the source
 * end is the mapping's there, kept within one source frame of the start and inside the media,
 * as FreeCut's trim keeps it.
 */
export function trimClipTiming(
  clip: EditableClip,
  handle: 'start' | 'end',
  amount: number,
  newDuration: number,
  projectFps: number | Rate,
): ClipTimingUpdate | null {
  if (!hasExactTiming(clip)) return null
  const frames = Math.round(amount)
  const duration = Math.max(1, Math.round(newDuration))
  if (frames === 0) return {}
  if (handle === 'start') {
    if (frames < 0) return extendStartTiming(clip, -frames, projectFps)
    const { sourceEnd: _end, ...kept } = windowTiming(clip, frames, duration, projectFps)
    return kept
  }
  if (mappedSpeedCurve(clip) === undefined) return null
  const update = trimEndTiming(clip, duration, projectFps)
  const sourceStart = clipSourceBase(clip)
  const atLeastOne = Math.max(sourceStart + 1, update.sourceEnd!)
  return {
    ...update,
    sourceEnd:
      clip.sourceDuration !== undefined ? Math.min(atLeastOne, clip.sourceDuration) : atLeastOne,
  }
}

/**
 * How far a trim may extend a forward media clip, in timeline frames: at the start, until the
 * revealed frames (at the first frame's speed) reach source frame 0; at the end, until the
 * position at the clip's end (at the last frame's speed) reaches the media's length. With no
 * curve and no remainder this is FreeCut's `getMaxStartExtension` / `getMaxTimelineDuration`
 * rule, exactly.
 */
function maxTrimExtension(
  clip: EditableClip,
  handle: 'start' | 'end',
  projectFps: number | Rate,
  sourceDuration: number,
): number {
  const { sourceRate, projectRate } = clipRates(clip, projectFps)
  const ratio = rateRatio(sourceRate, projectRate)
  const base = clipSourceBase(clip)
  if (handle === 'start') {
    const before = addFractions(fraction(base), remainderFraction(clip.sourceFrameOffset))
    const perFrame = multiplyFractions(speedFractionAt(clip, 0), ratio)
    return Number(floorFraction(divideFractions(before, perFrame)))
  }
  const duration = Math.round(clip.durationInFrames)
  const left = subtractFractions(
    fraction(sourceDuration - base),
    clipSourceOffset(clip, duration, projectFps),
  )
  const perFrame = multiplyFractions(speedFractionAt(clip, duration), ratio)
  return Number(floorFraction(divideFractions(left, perFrame)))
}

/**
 * The trim clamp of a forward clip with a speed curve (`clampTrimAmount`): an extension — a
 * negative start amount, a positive end amount — limited to `maxTrimExtension`, priced at the
 * speed the curve holds at that edge (its average is a length, never a rate), with that limit
 * as `maxExtend`. `null` when FreeCut's own clamp applies: a clip without a curve (its constant
 * speed prices both edges, and the remainder cannot take its start below source 0), a clip
 * `hasExactTiming` refuses, a shrink, or an end extension of a clip whose media length is
 * unknown.
 */
export function clampTrimExtension(
  clip: EditableClip,
  handle: 'start' | 'end',
  trimAmount: number,
  projectFps: number | Rate,
): { clampedAmount: number; maxExtend: number } | null {
  if (!hasExactTiming(clip) || mappedSpeedCurve(clip) === undefined) return null
  if (handle === 'start' ? trimAmount >= 0 : trimAmount <= 0) return null
  if (handle === 'start') {
    const maxExtend = maxTrimExtension(clip, handle, projectFps, 0)
    return { clampedAmount: Math.max(-maxExtend, trimAmount), maxExtend }
  }
  if (clip.sourceDuration === undefined) return null
  const maxExtend = maxTrimExtension(clip, handle, projectFps, clip.sourceDuration)
  return { clampedAmount: Math.min(trimAmount, maxExtend), maxExtend }
}

/**
 * The curve of a clip joined from `parts` in timeline order (design 7.1, section 4.6): the
 * parts' curves end to end, or no curve when none has one. The joined clip keeps the first
 * part's start and remainder, which a join takes from it.
 */
export function joinClipTiming(
  parts: readonly (EditableClip & { readonly from: number })[],
  totalDuration: number,
): ClipTimingUpdate {
  const first = parts[0]
  if (first === undefined) return {}
  const curve = joinSpeedCurves(parts, Math.round(totalDuration), first.from)
  return curve === undefined ? {} : { speedCurve: curve, speed: speedOfCurve(curve) }
}

/**
 * The clip after a rate stretch (`_rateStretchItem`): FreeCut's retimed clip `after`, with the
 * mapping re-authored. The remainder always goes (a new speed has no parent to agree with; the
 * first frame's source frame is unchanged). The curve goes too unless `keepSpeedCurve` asks to
 * scale it — an edge drag — and then it is stretched (`stretchSpeedCurve`), the source end is
 * recomputed from it (review finding T7), and a stretch the curve cannot take returns `before`
 * unchanged: refused, not clamped.
 */
export function retimedClip<T extends EditableClip>(
  before: T,
  after: T,
  options: RateStretchOptions | undefined,
  projectFps: number | Rate,
): T {
  const next = { ...after, sourceFrameOffset: undefined, speedCurve: undefined } as T
  const curve = mappedSpeedCurve(before)
  if (curve === undefined || options?.keepSpeedCurve !== true) return next
  const duration = Math.round(after.durationInFrames)
  const stretched = stretchSpeedCurve(curve, Math.round(before.durationInFrames), duration)
  if (stretched === undefined) return before
  const { sourceRate, projectRate } = clipRates(before, projectFps)
  const span = multiplyFractions(
    exactAreaAt(stretched, duration),
    rateRatio(sourceRate, projectRate),
  )
  const end = clipSourceBase(before) + Number(floorFraction(span))
  return {
    ...next,
    speedCurve: stretched,
    speed: speedOfCurve(stretched),
    sourceEnd: before.sourceDuration !== undefined ? Math.min(end, before.sourceDuration) : end,
  }
}
