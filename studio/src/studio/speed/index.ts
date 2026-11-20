/**
 * Speed curves: a clip's speed as keys with linear interpolation, the exact source-frame
 * mapping and its inverse (design 7.1, sections 4.1-4.7).
 *
 * Other modules import from `@/studio/speed` and never from the files beside this one. The
 * clip's own `speed` is the curve's average (`averageSpeed`) and stays the value every length
 * calculation uses; a position — which source frame a timeline frame shows — always comes from
 * `sourceFrameAt`, never from `speed`. Motion blur (7.2) reads `sourceSpanCoveredBy` and
 * `speedAt`; the stabiliser (6.3) and the shadow ranges (4.1) read `sourceFrameAt`.
 */

/** The slowest speed a key may hold: 0.1, the project schema's lower limit. */
export { MIN_CURVE_SPEED } from './curve'

/** The fastest speed a key may hold: 10, the project schema's upper limit. */
export { MAX_CURVE_SPEED } from './curve'

/** One point of a speed curve: a clip-relative timeline frame and its speed. */
export type { SpeedKey } from './curve'

/** A clip's speed over its timeline frames, as ordered keys with linear interpolation. */
export type { SpeedCurve } from './curve'

/** The shape a speed segment follows between two keys: `linear`, `smooth`, `ease-in`, `ease-out`. */
export type { SpeedEase } from './ease'

/** Every ease, linear first. */
export { SPEED_EASES } from './ease'

/** Whether a value names an ease. */
export { isSpeedEase } from './ease'

/** Check a curve's invariants, throwing a `RangeError` that names the field that breaks one. */
export { validateSpeedCurve } from './curve'

/**
 * The closed-form integral of the curve's speed from frame 0, in "speed x timeline frames";
 * O(keys), a function of the frame index alone.
 */
export { areaAt } from './curve'

/** The inverse of `areaAt`: the real timeline frame at which the curve has a given integral. */
export { frameAtArea } from './curve'

/** The speed the curve holds at a frame: a key's, linear between two, the last one's beyond. */
export { speedAt } from './curve'

/** The curve's average over its own span: the value the clip's `speed` is set to. */
export { averageSpeed } from './curve'

/**
 * Normalise a curve against its clip's duration — sorted integer keys, endpoints pinned to 0
 * and the duration, speeds in 0.1..10 — or `undefined` when it cannot be repaired; every
 * write of a curve goes through this (design 7.1, 4.1).
 */
export { normalizeSpeedCurve } from './normalize'

/** A cut's remainder: the fractional part of the source position at a clip's first frame. */
export type { SourceRemainder } from './remainder'

/**
 * A stored remainder normalised — `{ num, den }` reduced, an old project's double read as the
 * nearest fraction up to 1,000,000 — or `undefined` for none.
 */
export { normalizeSourceRemainder } from './remainder'

/** The remainder as a double, in source frames: for audio, which reads between samples. */
export { sourceRemainderValue } from './remainder'

/** The fields of a clip the mapping reads; a timeline item is one. */
export type { ClipTiming } from './position'

/**
 * The one mapping (review finding T8): the source frame a clip frame shows and its exact
 * position, `floor(sourceStart) + rem + advance(m)`. Every reader asks here.
 */
export { clipSourcePosition } from './position'

/**
 * The one mapping in seconds, as a double: the source seconds a clip has advanced at a
 * clip-relative time, for the timeline's filmstrip and waveform; `undefined` where linear is
 * exact.
 */
export { clipSourceOffsetSeconds } from './position'

/** The source seconds a filmstrip thumbnail or waveform column shows at a clip time. */
export { drawnSourceSeconds } from './position'

/** What an edit writes on a clip's timing; a key with `undefined` removes the field. */
export type { ClipTimingUpdate } from './edits'

/** How a rate stretch treats the clip's speed curve: `keepSpeedCurve` for an edge drag. */
export type { RateStretchOptions } from './edits'

/**
 * The push the clips after a stretched clip need: the overlap with the next clip, zero when the
 * clip grew into a gap that fits it (task 11.3).
 */
export { overlapPushAfterStretch } from './ripple'

/** The speed a clip with a curve stores: the one speed of a flat curve, else the average. */
export { speedOfCurve } from './edits'

/** The sub-clip of a clip's frames: a split's half, a trim's kept range, an in/out export. */
export { windowClipTiming } from './edits'

/** The two halves of a split, exact on every frame; `null` for FreeCut's own clips. */
export { splitClipTiming } from './edits'

/** The timing a trim writes; `null` for FreeCut's own clips. */
export { trimClipTiming } from './edits'

/** The trim clamp of an extension, from the exact mapping; `null` for FreeCut's own clamp. */
export { clampTrimExtension } from './edits'

/** The curve of a joined clip. */
export { joinClipTiming } from './edits'

/** A rate-stretched clip with its mapping re-authored, or the clip unchanged when refused. */
export { retimedClip } from './edits'

/** The one speed of a constant curve, or `undefined` when the speed changes between keys. */
export { constantSpeed } from './curve'

/** A source span as real source frame indices, `sourceStart` included. */
export type { SourceFrameSpan } from './mapping'

/**
 * The exact source position at a timeline frame, in source frames: `area(n)` with the rate
 * ratio folded in, unfloored.
 */
export { sourceFramesAt } from './mapping'

/**
 * The source frame a timeline frame shows:
 * `sourceStart + floor(area(n)·sNum·pDen/(sDen·pNum))`; the time module's answer on a
 * constant curve.
 */
export { sourceFrameAt } from './mapping'

/**
 * The real timeline duration that spends a source span, the design's inverse; callers round
 * it.
 */
export { timelineDurationForSource } from './mapping'

/**
 * The clip's timeline length for a source span, `ceil` of the real duration; the time
 * module's answer on a constant curve.
 */
export { timelineFramesForSource } from './mapping'

/**
 * The source span output frame `n` covers, `[sourceFrames(n), sourceFrames(n + 1))`; motion
 * blur's input (7.2).
 */
export { sourceSpanCoveredBy } from './mapping'

/**
 * The keys of a speed-ramp preset — `ramp-in`, `ramp-out` or `ramp-in-out` — for a clip of a
 * given length: the one shape the curve panel's buttons and `clips.setSpeedPreset` both build
 * (design 7.1, section 4.8).
 */
export { speedPresetCurve } from './presets'

/** The three preset names (design 7.1, sections 4.8 and 4.9). */
export { SPEED_PRESET_NAMES } from './presets'

/** One of the three ramp shapes. */
export type { SpeedPresetName } from './presets'
