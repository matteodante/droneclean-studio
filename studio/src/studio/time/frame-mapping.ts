/**
 * Where a timeline frame takes its picture from: the clip's source frame, and that frame's own
 * start time in seconds.
 *
 * The mapping is a pure function of the timeline frame index — `floor(n · speed · sNum · pDen /
 * (sDen · pNum))` counted from the clip's trim-in — so it cannot accumulate an error, and the
 * decoder is asked for the source frame's own timestamp, so it cannot land on a neighbour
 * (design 1.5, section 4.2). The speed is read as the fraction it stands for (`exactSpeed`)
 * and the floor is taken exactly (`exact.ts`), so a whole-frame product is never one frame low.
 */

import { ceilFraction, exactSpeed, floorScaledFrames, fraction } from './exact'
import { ratesEqual, toRate, type Rate } from './rate'

/**
 * One question to `sourceFrameAt` / `sourceTimeAt`: which source frame does a timeline frame
 * show?
 */
export interface SourceFrameQuery {
  /** The timeline frame index: an integer >= 0. */
  timelineFrame: number
  /** The source frame shown at timeline frame 0 (the clip's trim-in): an integer >= 0. */
  sourceStart: number
  /** Playback speed as a multiplier: finite and > 0; 1 is normal speed. */
  speed: number
  /** The source clip's rate. */
  sourceRate: Rate
  /** The timeline's (project's) rate. */
  projectRate: Rate
}

/** A frame count must be an integer >= 0; the error names the argument and the function. */
function assertFrameCount(functionName: string, argumentName: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${functionName}: ${argumentName} must be an integer >= 0, got ${value}`)
  }
}

/** A speed must be a finite number > 0; the error names the argument and the function. */
function assertSpeed(functionName: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${functionName}: speed must be a finite number > 0, got ${value}`)
  }
}

/**
 * The source frame shown at `query.timelineFrame`:
 *
 *     sourceStart + floor(n · speed · sNum · pDen / (sDen · pNum))
 *
 * **Rounded down**, from the frame index: a source frame is shown from its own timestamp until
 * the next one starts, which is what `<video>` and WebCodecs do. Round-half-up would show a
 * frame before its timestamp — a preview that disagrees with the file. When the rates are equal
 * and the speed is 1 the answer is `sourceStart + n`, with no division at all (design 1.5, 4.2).
 *
 * @throws RangeError when `timelineFrame` or `sourceStart` is not an integer >= 0, when `speed`
 * is not a finite number > 0, or when either rate is not a rate of positive integers.
 */
export function sourceFrameAt(query: SourceFrameQuery): number {
  const { timelineFrame, sourceStart, speed } = query
  assertFrameCount('sourceFrameAt', 'timelineFrame', timelineFrame)
  assertFrameCount('sourceFrameAt', 'sourceStart', sourceStart)
  assertSpeed('sourceFrameAt', speed)
  const sourceRate = toRate(query.sourceRate)
  const projectRate = toRate(query.projectRate)
  if (speed === 1 && ratesEqual(sourceRate, projectRate)) {
    return sourceStart + timelineFrame
  }
  // The speed is read back as the fraction it was stored as (0.29 is 29/100), and the floor is
  // exact: a double product lands one frame low wherever the true value is a whole frame.
  return sourceStart + floorScaledFrames(timelineFrame, exactSpeed(speed), sourceRate, projectRate)
}

/**
 * The start time in seconds of the source frame that `query.timelineFrame` shows:
 * `sourceFrame · sDen / sNum`. That is the frame's own timestamp, which is exactly what the
 * decoder must be asked for; the extractor's 1e-4 s tolerance stays for container quantisation
 * only (design 1.5, 4.2). Use `frameToSeconds` from `rate.ts` when the source frame is already
 * known.
 *
 * @throws RangeError with the same rules as `sourceFrameAt`.
 */
export function sourceTimeAt(query: SourceFrameQuery): number {
  const sourceFrame = sourceFrameAt(query)
  const sourceRate = toRate(query.sourceRate)
  return (sourceFrame * sourceRate.den) / sourceRate.num
}

/**
 * The inverse of `sourceFrameAt` for clip lengths: how many timeline frames it takes to show
 * `sourceFrames` source frames at `sourceRate` in a `projectRate` timeline at `speed`.
 *
 * **Rounded up** (`ceil(sourceFrames · sDen · pNum / (sNum · pDen · speed))`). A clip must cover
 * its whole source, and the last source frame has to be shown: floor would cut up to one source
 * frame off the end of every clip whose source length is not a whole number of timeline frames
 * (1200 source frames at 60 fps in a 59.94 project: floor 1198, ceil 1199). Rounding up adds at
 * most one timeline frame, so the end of the source is never cut; when the source has more
 * frames than the timeline can show (60 in 59.94) one source frame is skipped — that is the
 * 1.001 ratio, not a rounding. Equal rates at speed 1 return `sourceFrames` unchanged, so a
 * 1,199-frame 59.94 source stays 1,199 timeline frames. With a speed other than 1 the speed is
 * read as its fraction and the ceiling is exact, as the floor of `sourceFrameAt` is.
 *
 * @throws RangeError when `sourceFrames` is not an integer >= 0, when `speed` is not a finite
 * number > 0, or when either rate is not a rate of positive integers.
 */
export function timelineFramesForSource(
  sourceFrames: number,
  sourceRate: Rate,
  projectRate: Rate,
  speed: number,
): number {
  assertFrameCount('timelineFramesForSource', 'sourceFrames', sourceFrames)
  assertSpeed('timelineFramesForSource', speed)
  const source = toRate(sourceRate)
  const project = toRate(projectRate)
  if (speed === 1 && ratesEqual(source, project)) {
    return sourceFrames
  }
  const exact = exactSpeed(speed)
  return Number(
    ceilFraction(
      fraction(
        BigInt(sourceFrames) * BigInt(source.den) * BigInt(project.num) * exact.den,
        BigInt(source.num) * BigInt(project.den) * exact.num,
      ),
    ),
  )
}
