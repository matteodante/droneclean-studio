/**
 * A clip's speed curve: speed keys on clip-relative timeline frames, linear between them, with
 * the closed-form integral of the speed and its exact inverse (design 7.1, sections 4.1-4.2).
 *
 * A key is `{ frame, speed }`. `frame` is a timeline frame counted from the clip's start, the
 * origin the clip's keyframes use; `speed` is a multiplier in `0.1..10`, the project schema's
 * range (task 1.5's maths allows 16; the curve and the schema stop at 10). The first key sits
 * at frame 0 and the speed is linear between neighbouring keys; past the last key it holds, so
 * every function here answers for any frame >= 0. The normaliser that writes a curve pins its
 * last key to the clip's duration and keeps the clip's `speed` equal to `averageSpeed` (slice B
 * of the design); the maths below does not need either.
 *
 * The integral is
 *
 *     area(n) = B_i + u·v_i + dv_i·u²/(2·L_i)     (u = n - f_i, L_i = f_(i+1) - f_i)
 *
 * with `B_i` the same expression evaluated at each earlier segment's end, in "speed x timeline
 * frames". The mapping folds the rate ratio in once, `sourceFrames(n) = area(n)·sNum·pDen/
 * (sDen·pNum)`, so a clip consumes source frames at the rate it plays at. One expression per
 * segment and a prefix sum over at most one term per key: every value is a function of the
 * frame index alone, which is what keeps preview, export and the stabiliser in agreement in any
 * order. A per-frame midpoint sum also lands within 1e-6 source frames over 20 minutes (design
 * 7.1, 5.2): the closed form's virtue is random access and agreement, not a visible error.
 *
 * With a linear speed the source position is quadratic in the frame, so `frameAtArea` is that
 * quadratic's root and is closed form too. The loop that walks the segments is shared with
 * `areaAt`; neither accumulates anything across calls.
 *
 * A key may also carry an `ease` (`ease.ts`): the segment that starts at it then follows
 * `v0 + (v1 - v0)·g(u/L)` instead of the line, with an area that is as closed as the linear one;
 * only the inverse is solved by bisection. Without `ease` a segment is linear, so a curve
 * written before eases existed means what it always meant.
 */

import {
  easeIntegral,
  easeValue,
  isSpeedEase,
  type SpeedEase,
  type SpeedEaseSlice,
} from './ease'

/** The slowest speed a key may hold: 0.1, the project schema's lower limit. */
export const MIN_CURVE_SPEED = 0.1

/** The fastest speed a key may hold: 10, the project schema's upper limit. */
export const MAX_CURVE_SPEED = 10

/** One point of a speed curve. */
export interface SpeedKey {
  /**
   * The clip-relative timeline frame the key sits on: an integer >= 0, the first key's 0,
   * strictly increasing along the keys.
   */
  readonly frame: number
  /** The playback speed at that frame: a finite number in `MIN_CURVE_SPEED..MAX_CURVE_SPEED`. */
  readonly speed: number
  /**
   * The shape of the segment that starts at this key, up to the next one; absent means
   * `linear`. Meaningless on the last key (nothing starts there), where a normaliser drops it.
   */
  readonly ease?: SpeedEase
  /**
   * Set by an edit that cut an eased segment: this key's segment is a piece of a longer ramp
   * (`SpeedEaseSlice`), so the speed on every frame stays the parent's. Never set by hand.
   */
  readonly easeSlice?: SpeedEaseSlice
}

/** A clip's speed over its timeline frames, as keys with linear interpolation between them. */
export interface SpeedCurve {
  /**
   * The keys, ordered by frame: at least one, the first at frame 0. A normaliser pins the last
   * one to the clip's duration when it writes the curve (design 7.1, 4.1).
   */
  readonly keys: readonly SpeedKey[]
}

/** A curve whose keys passed `checkedCurve`: at least one key, so `first` and `last` exist. */
interface ValidatedSpeedCurve {
  /** The curve's keys, unchanged. */
  readonly keys: readonly SpeedKey[]
  /** The key at frame 0. */
  readonly first: SpeedKey
  /** The last key; its speed holds for every frame after it. */
  readonly last: SpeedKey
}

/** A position or length must be a finite number >= 0; the error names the argument. */
function assertFiniteNonNegative(functionName: string, argumentName: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${functionName}: ${argumentName} must be a finite number >= 0, got ${value}`,
    )
  }
}

/**
 * Check one key's frame: an integer >= 0, the first key's exactly 0, each later one strictly
 * after the previous. `previousFrame` is -1 for the first key.
 */
function checkedFrame(
  functionName: string,
  index: number,
  frame: number,
  previousFrame: number,
): void {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError(
      `${functionName}: keys[${index}].frame must be an integer >= 0, got ${frame}`,
    )
  }
  if (index === 0) {
    if (frame !== 0) {
      throw new RangeError(`${functionName}: keys[0].frame must be 0, got ${frame}`)
    }
    return
  }
  if (frame <= previousFrame) {
    throw new RangeError(
      `${functionName}: keys[${index}].frame must be greater than keys[${index - 1}].frame ` +
        `(${previousFrame}), got ${frame}`,
    )
  }
}

/** Check one key's speed: a finite number in `MIN_CURVE_SPEED..MAX_CURVE_SPEED`. */
function checkedSpeed(functionName: string, index: number, speed: number): void {
  if (!Number.isFinite(speed) || speed < MIN_CURVE_SPEED || speed > MAX_CURVE_SPEED) {
    throw new RangeError(
      `${functionName}: keys[${index}].speed must be within ` +
        `${MIN_CURVE_SPEED}..${MAX_CURVE_SPEED}, got ${speed}`,
    )
  }
}

/** Check one key's ease: absent, or one of `SPEED_EASES`. */
function checkedEase(functionName: string, index: number, key: SpeedKey): void {
  if (key.ease !== undefined && !isSpeedEase(key.ease)) {
    throw new RangeError(
      `${functionName}: keys[${index}].ease must be one of linear, smooth, ease-in, ease-out, ` +
        `got ${String(key.ease)}`,
    )
  }
}

/**
 * Check the slice on `key`, whose segment is `segmentLength` frames long: whole frames inside
 * a parent ramp, endpoints in the speed range. A linear key must not carry one.
 */
function checkedSlice(
  functionName: string,
  index: number,
  key: SpeedKey,
  segmentLength: number,
): void {
  const slice = key.easeSlice
  if (slice === undefined) return
  const where = `keys[${index}].easeSlice`
  if (key.ease === undefined || key.ease === 'linear') {
    throw new RangeError(`${functionName}: ${where} needs keys[${index}].ease to be eased`)
  }
  if (
    !Number.isSafeInteger(slice.offset) ||
    !Number.isSafeInteger(slice.length) ||
    slice.offset < 0 ||
    slice.length < 1 ||
    slice.offset + segmentLength > slice.length
  ) {
    throw new RangeError(
      `${functionName}: ${where} must put ${segmentLength} frames inside its ramp, ` +
        `got offset ${slice.offset} of length ${slice.length}`,
    )
  }
  checkedSpeed(functionName, index, slice.from)
  checkedSpeed(functionName, index, slice.to)
}

/**
 * Check a curve's invariants and return its first and last key. Every public function here
 * starts with this, so a curve built by hand cannot reach the maths broken.
 *
 * @throws RangeError naming the field: `curve.keys` when it is not a non-empty array, and
 * `keys[i].frame` (an integer >= 0, the first 0, strictly increasing) or `keys[i].speed`
 * (a finite number in `MIN_CURVE_SPEED..MAX_CURVE_SPEED`) for the first key that breaks one.
 */
function checkedCurve(curve: SpeedCurve, functionName: string): ValidatedSpeedCurve {
  if (!Array.isArray(curve.keys)) {
    throw new RangeError(`${functionName}: curve.keys must be an array of speed keys`)
  }
  const { keys } = curve
  let first: SpeedKey | undefined
  let last: SpeedKey | undefined
  let previousFrame = -1
  for (const [index, key] of keys.entries()) {
    checkedFrame(functionName, index, key.frame, previousFrame)
    checkedSpeed(functionName, index, key.speed)
    checkedEase(functionName, index, key)
    if (index > 0) {
      checkedSlice(functionName, index - 1, keys[index - 1]!, key.frame - previousFrame)
    }
    if (index === 0) {
      first = key
    }
    last = key
    previousFrame = key.frame
  }
  if (first === undefined || last === undefined) {
    throw new RangeError(`${functionName}: curve.keys must hold at least one key`)
  }
  return { keys, first, last }
}

/**
 * One segment between two keys: the line when `ease` is `linear`, else a piece (`offset`,
 * `length` of the parent ramp `parentLength` frames long) of the ramp from `parentStart` by
 * `parentDelta`. An unsliced eased segment is its own parent: `offset 0`, `length` equal.
 */
interface Segment {
  readonly ease: SpeedEase
  readonly startSpeed: number
  readonly speedDelta: number
  readonly length: number
  readonly parentLength: number
  readonly offset: number
}

/** The segment from `start` to the next key `end`. */
function segmentBetween(start: SpeedKey, end: SpeedKey): Segment {
  const length = end.frame - start.frame
  const ease = start.ease ?? 'linear'
  if (ease === 'linear') {
    return {
      ease,
      startSpeed: start.speed,
      speedDelta: end.speed - start.speed,
      length,
      parentLength: length,
      offset: 0,
    }
  }
  const slice = start.easeSlice
  if (slice === undefined) {
    return {
      ease,
      startSpeed: start.speed,
      speedDelta: end.speed - start.speed,
      length,
      parentLength: length,
      offset: 0,
    }
  }
  return {
    ease,
    startSpeed: slice.from,
    speedDelta: slice.to - slice.from,
    length,
    parentLength: slice.length,
    offset: slice.offset,
  }
}

/** The area under an eased ramp from its own start to `t` frames in. */
function rampArea(segment: Segment, t: number): number {
  const { startSpeed, speedDelta, parentLength, ease } = segment
  return t * startSpeed + speedDelta * parentLength * easeIntegral(ease, t / parentLength)
}

/**
 * The area of one speed segment over `offset` frames of its length. A linear segment is
 * `offset·startSpeed + speedDelta·offset²/(2·length)`; an eased one is the parent ramp's area
 * between its two ends.
 *
 * `areaOf` calls it with `offset === length` for the prefix sums, so the integral at a key is
 * the same double whether it is reached from the segment that ends there or from the one that
 * starts there (which adds `offset === 0`, i.e. zero): the integral has no jump at a key.
 */
function segmentArea(segment: Segment, offset: number): number {
  if (segment.ease === 'linear') {
    return (
      offset * segment.startSpeed +
      (segment.speedDelta * offset * offset) / (2 * segment.length)
    )
  }
  if (segment.offset === 0) return rampArea(segment, offset)
  return rampArea(segment, segment.offset + offset) - rampArea(segment, segment.offset)
}

/**
 * The offset in frames at which a segment has accumulated `area`. A linear segment solves
 * `u·v + dv·u²/(2L) = area` as `2·area/(v + √(v² + 2·area·dv/L))` — the `+` root of design
 * 7.1's `(−L·v + √(L²v² + 2·L·area·dv))/dv` written so that a tiny `dv` does not subtract two
 * nearly equal numbers; with `dv === 0` it is `area / v`. An eased segment's area is a
 * polynomial of degree 3 or 4 in the offset, increasing because the speed is positive, so it is
 * found by bisection to the double's last digit.
 */
function segmentOffsetForArea(segment: Segment, area: number): number {
  const { startSpeed, speedDelta, length } = segment
  if (segment.ease === 'linear') {
    if (speedDelta === 0) {
      return area / startSpeed
    }
    const root = Math.sqrt(startSpeed * startSpeed + (2 * area * speedDelta) / length)
    return (2 * area) / (startSpeed + root)
  }
  let low = 0
  let high = length
  for (let step = 0; step < 64; step++) {
    const middle = (low + high) / 2
    if (segmentArea(segment, middle) < area) {
      low = middle
    } else {
      high = middle
    }
  }
  return (low + high) / 2
}

/** The integral from frame 0 to `frame` for a curve that passed `checkedCurve`. */
function areaOf(keys: readonly SpeedKey[], first: SpeedKey, frame: number): number {
  let area = 0
  let start = first
  for (const [index, key] of keys.entries()) {
    if (index === 0) {
      continue
    }
    const segment = segmentBetween(start, key)
    if (frame <= key.frame) {
      return area + segmentArea(segment, frame - start.frame)
    }
    area += segmentArea(segment, segment.length)
    start = key
  }
  return area + (frame - start.frame) * start.speed
}

/**
 * Check a speed curve against its invariants: at least one key, the first at frame 0, frames
 * integers >= 0 and strictly increasing, speeds finite in `MIN_CURVE_SPEED..MAX_CURVE_SPEED`.
 * The normaliser that writes a curve calls this before it stores one (design 7.1, 4.1).
 *
 * @throws RangeError naming the field that breaks an invariant (`curve.keys`,
 * `keys[i].frame`, `keys[i].speed`).
 */
export function validateSpeedCurve(curve: SpeedCurve): void {
  checkedCurve(curve, 'validateSpeedCurve')
}

/**
 * The integral of the curve's speed from frame 0 to `frame`, in "speed x timeline frames":
 *
 *     area(n) = B_i + u·v_i + dv_i·u²/(2·L_i)     (u = n - f_i, f_i <= n <= f_(i+1))
 *
 * with `B_i` the closed-form value at the start of the segment. O(keys), never a sum over
 * frames, so `n` is answered directly and no caller's starting point can change the answer.
 * `frame` may be fractional (the duration an inverse produced); past the last key the last
 * speed holds.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does) or `frame` when it is
 * not a finite number >= 0.
 */
export function areaAt(curve: SpeedCurve, frame: number): number {
  const { keys, first } = checkedCurve(curve, 'areaAt')
  assertFiniteNonNegative('areaAt', 'frame', frame)
  return areaOf(keys, first, frame)
}

/**
 * The inverse of `areaAt`: the clip-relative timeline frame at which the curve has accumulated
 * `area` — a real number, not rounded (a caller that needs a frame count rounds it, as the
 * retime does; `timelineFramesForSource` in `mapping.ts` is the rates-aware ceil for a clip's
 * length). Exact for a linear segment: it is that segment's quadratic root. Past the last key
 * the last speed holds.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does) or `area` when it is
 * not a finite number >= 0.
 */
export function frameAtArea(curve: SpeedCurve, area: number): number {
  const { keys, first } = checkedCurve(curve, 'frameAtArea')
  assertFiniteNonNegative('frameAtArea', 'area', area)
  let consumed = 0
  let start = first
  for (const [index, key] of keys.entries()) {
    if (index === 0) {
      continue
    }
    const segment = segmentBetween(start, key)
    const endArea = consumed + segmentArea(segment, segment.length)
    if (area <= endArea) {
      return start.frame + segmentOffsetForArea(segment, area - consumed)
    }
    consumed = endArea
    start = key
  }
  return start.frame + (area - consumed) / start.speed
}

/** The speed inside a segment `offset` frames after its start. */
function segmentSpeedAt(segment: Segment, offset: number): number {
  if (segment.ease === 'linear') {
    return segment.startSpeed + (offset / segment.length) * segment.speedDelta
  }
  const shape = easeValue(segment.ease, (segment.offset + offset) / segment.parentLength)
  return segment.startSpeed + segment.speedDelta * shape
}

/**
 * The speed the curve holds at `frame`: a key's own speed on a key, the segment's shape
 * (linear unless the key says otherwise) between two, and the last key's speed past the last key. `frame` may be fractional. Never
 * the clip's `speed`, which is the curve's average. Motion blur does not weight samples by
 * this value: its samples are weighted by each source frame's overlap with the shutter
 * window (design 7.2, section 4.1).
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does) or `frame` when it is
 * not a finite number >= 0.
 */
export function speedAt(curve: SpeedCurve, frame: number): number {
  const { keys, first } = checkedCurve(curve, 'speedAt')
  assertFiniteNonNegative('speedAt', 'frame', frame)
  let start = first
  for (const [index, key] of keys.entries()) {
    if (index === 0) {
      continue
    }
    if (frame <= key.frame) {
      if (frame === key.frame) {
        return key.speed
      }
      return segmentSpeedAt(segmentBetween(start, key), frame - start.frame)
    }
    start = key
  }
  return start.speed
}

/**
 * The curve's average speed over its own span, `area(lastFrame) / lastFrame`: the one
 * expression the clip's `speed` is set to, so every length calculation of the editor
 * (`timelineToSourceFrames(duration, speed)` and the clamp that reads it) returns the curve's
 * source span without knowing about curves (design 7.1, 4.1). A curve whose keys all sit at
 * frame 0 has no span; its average is the first key's speed.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does).
 */
export function averageSpeed(curve: SpeedCurve): number {
  const { keys, first, last } = checkedCurve(curve, 'averageSpeed')
  if (last.frame === 0) {
    return first.speed
  }
  return areaOf(keys, first, last.frame) / last.frame
}

/**
 * The one speed a constant curve holds, or `undefined` when the speed changes between keys.
 * A constant curve is the no-curve case: the mapping delegates to `@/studio/time`'s flat
 * formula and `clips.setSpeed` clears the curve (design 7.1, 4.1).
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does).
 */
export function constantSpeed(curve: SpeedCurve): number | undefined {
  const { keys, first } = checkedCurve(curve, 'constantSpeed')
  for (const key of keys) {
    if (key.speed !== first.speed) {
      return undefined
    }
    // A piece of an eased ramp that really changes speed has end keys that may round alike.
    if (key.easeSlice !== undefined && key.easeSlice.from !== key.easeSlice.to) {
      return undefined
    }
  }
  return first.speed
}

/**
 * Whether any segment of the curve is eased: the curves whose frame count for a source span
 * `mapping.ts` settles against the exact integral, because the double inverse is a bisection.
 *
 * @throws RangeError naming a broken key (as `validateSpeedCurve` does).
 */
export function hasEasedSegments(curve: SpeedCurve): boolean {
  const { keys } = checkedCurve(curve, 'hasEasedSegments')
  return keys.slice(0, -1).some((key) => key.ease !== undefined && key.ease !== 'linear')
}
