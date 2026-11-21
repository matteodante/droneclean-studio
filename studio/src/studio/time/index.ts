/**
 * The exact time module: rates as fractions, the timeline-to-source frame mapping and audio
 * sample positions, every one of them a function of an integer index so nothing drifts.
 *
 * Other modules import from `@/studio/time` and never from the files beside this one. The
 * design is `docs/designs/1.5-exact-frame-rates.md` (sections 4.0-4.3); the doc comment on each
 * export is the reference.
 */

/** An exact frame rate: `num / den` frames per second, both integers, reduced, `den > 0`. */
export type { Rate } from './rate'

/**
 * The eight rates a project can have, in display order: 23.976, 24, 25, 29.97, 30, 50, 59.94,
 * 60.
 */
export { RATES } from './rate'

/** The two legacy rates an old project may still hold: 120 and 240 fps. */
export { LEGACY_RATES } from './rate'

/** The rate as frames per second: `num / den`, one rounding. For display and external APIs only. */
export { rateValue } from './rate'

/** The only way a number becomes a rate; total, and the fractions win over the decimal names. */
export { toRate } from './rate'

/** Whether two rates are the same, by cross-multiplication and without division. */
export { ratesEqual } from './rate'

/** The start time in seconds of a frame: `frame · den / num`, one rounding. */
export { frameToSeconds } from './rate'

/** The frame whose start is nearest to a time in seconds: `round(seconds · num / den)` (see `rate.ts`). */
export { secondsToFrame } from './rate'

/** The label a UI list shows for a rate: "60", "59.94", "29.97", "23.976". */
export { formatRate } from './rate'

/** The question `sourceFrameAt` and `sourceTimeAt` answer. */
export type { SourceFrameQuery } from './frame-mapping'

/**
 * The source frame a timeline frame shows:
 * `sourceStart + floor(n · speed · sNum · pDen / (sDen · pNum))`.
 */
export { sourceFrameAt } from './frame-mapping'

/** The source frame's own start time in seconds, which is what the decoder is asked for. */
export { sourceTimeAt } from './frame-mapping'

/**
 * The inverse for clip lengths: timeline frames needed to show a number of source frames,
 * rounded up.
 */
export { timelineFramesForSource } from './frame-mapping'

/** The output sample at which a frame starts: `floor(frame · sampleRate · den / num)`. */
export { sampleAt } from './audio-samples'

/**
 * The output samples that cover a whole timeline:
 * `ceil(totalFrames · sampleRate · den / num)`.
 */
export { bufferSamples } from './audio-samples'

/** An exact rational: BigInt `num / den`, `den > 0`, reduced. */
export type { Fraction } from './exact'

/** The fraction `num / den`, reduced. */
export { fraction } from './exact'

/** 0 as a fraction. */
export { ZERO_FRACTION } from './exact'

/** Exact sum, difference, product and quotient of two fractions. */
export { addFractions, subtractFractions, multiplyFractions, divideFractions } from './exact'

/** Exact comparison, floor, ceiling and fractional part of a fraction. */
export { compareFractions, floorFraction, ceilFraction, fractionalPart } from './exact'

/** The double nearest a fraction, within one ulp: for display and audio, never for a floor. */
export { fractionToNumber } from './exact'

/** The nearest fraction with a bounded denominator (continued fractions). */
export { nearestFraction } from './exact'

/** 2^23: the largest denominator a stored speed is read back with. */
export { MAX_SPEED_DENOMINATOR } from './exact'

/** A stored speed read back as the fraction it stands for (0.29 is 29/100). */
export { exactSpeed } from './exact'

/** The ratio `sNum · pDen / (sDen · pNum)` of two rates: source frames per timeline frame. */
export { rateRatio } from './exact'

/** `floor(frames · speed · sNum · pDen / (sDen · pNum))`, exactly, for a signed frame count. */
export { floorScaledFrames } from './exact'
