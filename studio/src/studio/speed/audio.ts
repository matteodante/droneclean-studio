/**
 * The varispeed read of a clip's sound through its speed curve (design 7.1, section 4.3).
 *
 * On a ramp the sound follows the speed: the pitch rises with the speed, as on tape, and it
 * never loses sync because there is no second clock. Every output sample reads the source at
 * the position the curve's own integral puts under it — the same mapping the picture uses —
 * with 4-point (Catmull-Rom) interpolation between samples. A constant curve never reaches this
 * module: the planner leaves it off and the clip plays through the existing pitch-preserving
 * path, because a constant curve is the clip of today at that speed (design 7.1, section 4.1).
 *
 * Output sample `j` sits at timeline frame `j · pNum / (outputSampleRate · pDen)` (design 7.1,
 * 4.3), and its read position in the decoded buffer is
 *
 *     sourceSample(j) = (preRoll · speed + area(clipFrame)) · sourceSampleRate · pDen / pNum
 *                       + cut · sourceSampleRate · sDen / sNum
 *
 * counted from the decode's first sample, where `clipFrame` is that timeline frame measured
 * from the clip's start, `area` is the curve's integral in "speed x timeline frames", `cut` is
 * the remainder of a cut between two source frames (0 for a clip that starts on one), and the
 * pre-roll term is 0 unless the segment starts before its clip. The expression is the design's
 * `sourceSample(n)` before the floor — the interpolator reads between samples. The curve's term
 * does not contain the source's frame rate (its integral is in timeline time); the remainder is
 * in source frames, so it is converted with the source's rate (review finding T5).
 *
 * Before the clip's first frame — a transition pre-roll, where the segment starts before the
 * clip — the clip's average speed holds, the render span's rule for the picture (up to the one
 * source frame that pre-roll's source start is floored by, as a constant-speed clip's pre-roll
 * already is). Outside the decoded range there are no samples and the read is silence: a decode
 * that ends a sample short must not repeat its last sample.
 */

import { toRate, type Rate } from '@/studio/time'
import { areaAt, type SpeedCurve } from './curve'

/**
 * Everything the varispeed read needs: the curve, the rates, and where the segment and its
 * clip sit on the timeline and in the mix.
 */
export interface CurveAudioRead {
  /** The clip's speed curve; the caller makes sure it varies, a constant one is the clip of today. */
  curve: SpeedCurve
  /** The timeline rate: the curve's frames and the sample grid share it. */
  projectRate: Rate
  /** The source's frame rate: the unit of `sourceFrameOffset` (review finding T5). */
  sourceRate: Rate
  /** The rate of the decoded buffer being read, in samples per second. */
  sourceSampleRate: number
  /** The mix rate the segment is placed on, in samples per second (48,000). */
  outputSampleRate: number
  /** The segment's first output sample in the mix (`segmentSampleSpan`); may be negative. */
  firstOutputSample: number
  /** How many output samples the segment covers: `endSample - startSample`. */
  outputSampleCount: number
  /** The clip's own first timeline frame (`item.from`): the curve's frame 0. */
  clipStartFrame: number
  /** The timeline frames the segment starts before the clip: a transition pre-roll, else 0. */
  preRollFrames: number
  /** The clip's `speed`, the curve's average: the speed held before the clip's first frame. */
  averageSpeed: number
  /**
   * The remainder of a cut between two source frames, in source frames: the fractional part,
   * in [0, 1), of the source position at the clip's first frame (design 7.1, section 4.6), 0 for
   * a clip that starts on one. It is converted with the source's rate — a source frame is not a
   * timeline frame when the rates differ (review finding T5) — and added to the read before any
   * rounding, where the picture adds it, so a cut curved clip reads its parent's frames.
   */
  sourceFrameOffset: number
}

/** The `CurveAudioRead` resolved to what one read costs per output sample, checked once. */
interface ReadGeometry {
  curve: SpeedCurve
  project: Rate
  outputSampleRate: number
  clipStartFrame: number
  preRollFrames: number
  averageSpeed: number
  /** The cut's remainder in decoded samples: `rem · sourceSampleRate · sDen / sNum`. */
  remainderSamples: number
  /** Samples per "speed x timeline frame": the mapping's rate ratio, see `sourceSampleAt`. */
  samplesPerArea: number
}

/** A value that did not reach the maths as a positive number. */
function assertPositive(functionName: string, argumentName: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${functionName}: ${argumentName} must be a positive number, got ${value}`)
  }
}

/** Resolve and check a `CurveAudioRead` once, before the per-sample loop. */
function geometryOf(read: CurveAudioRead): ReadGeometry {
  assertPositive('resampleThroughCurve', 'sourceSampleRate', read.sourceSampleRate)
  assertPositive('resampleThroughCurve', 'outputSampleRate', read.outputSampleRate)
  assertPositive('resampleThroughCurve', 'averageSpeed', read.averageSpeed)
  if (!Number.isFinite(read.sourceFrameOffset)) {
    throw new RangeError(
      'resampleThroughCurve: sourceFrameOffset must be finite, ' + `got ${read.sourceFrameOffset}`,
    )
  }
  const project = toRate(read.projectRate)
  const source = toRate(read.sourceRate)
  return {
    curve: read.curve,
    project,
    outputSampleRate: read.outputSampleRate,
    clipStartFrame: read.clipStartFrame,
    preRollFrames: read.preRollFrames,
    averageSpeed: read.averageSpeed,
    remainderSamples: (read.sourceFrameOffset * read.sourceSampleRate * source.den) / source.num,
    // `area · pDen / pNum` is the source seconds a read consumes, and this buffer holds
    // `sourceSampleRate` samples of them: the source's frame rate cancels out of the read.
    samplesPerArea: (read.sourceSampleRate * project.den) / project.num,
  }
}

/**
 * The sample of the decoded range the output sample at `outputSample` reads, as a real number:
 *
 *     (preRollFrames + clipFrame) · speed · samplesPerArea                         before the clip
 *     (preRollFrames · speed + area(clipFrame)) · samplesPerArea + cutSamples      inside it
 *
 * `outputSample` is absolute in the mix, the index `segmentSampleSpan` placed the segment at,
 * so a caller never has to translate between the two grids. The value is not rounded: the
 * interpolator reads between samples, and the design's floored `sourceSample(n)` is what a
 * whole-sample reader would take instead.
 */
function sourceSampleAt(geometry: ReadGeometry, outputSample: number): number {
  const { project } = geometry
  // Frames are `seconds · rate`, so one sample is `pNum / (outputSampleRate · pDen)` frames.
  const timelineFrame = (outputSample * project.num) / (geometry.outputSampleRate * project.den)
  const clipFrame = timelineFrame - geometry.clipStartFrame
  const preRollArea = geometry.preRollFrames * geometry.averageSpeed
  if (clipFrame < 0) {
    return (preRollArea + clipFrame * geometry.averageSpeed) * geometry.samplesPerArea
  }
  return (
    (preRollArea + areaAt(geometry.curve, clipFrame)) * geometry.samplesPerArea +
    geometry.remainderSamples
  )
}

/**
 * The source seconds a segment with a curve consumes from its decoded start, for the decoder's
 * end time: the pre-roll at the clip's average speed plus the curve's integral over the clip's
 * frames, `(preRoll · speed + area(clipFrames)) · pDen / pNum`. `clipFrames` may run past the
 * curve's last key — a transition post-roll — where the last key's speed holds, as it does
 * after the key itself.
 */
export function curveSourceSeconds(
  read: Pick<CurveAudioRead, 'curve' | 'projectRate' | 'preRollFrames' | 'averageSpeed'>,
  clipFrames: number,
): number {
  assertPositive('curveSourceSeconds', 'averageSpeed', read.averageSpeed)
  if (!Number.isFinite(clipFrames) || clipFrames < 0) {
    throw new RangeError(
      `curveSourceSeconds: clipFrames must be a finite number >= 0, got ${clipFrames}`,
    )
  }
  const project = toRate(read.projectRate)
  const consumed = read.preRollFrames * read.averageSpeed + areaAt(read.curve, clipFrames)
  return (consumed * project.den) / project.num
}

/**
 * The Catmull-Rom weights of the four samples around a read position, for the fraction
 * `t` between the sample below it and the next one. At `t === 0` the weights are
 * `(0, 1, 0, 0)`, so a whole-sample position reads that sample itself: at 1x the read is the
 * decoded sample, unchanged.
 */
function cubicWeights(t: number): [number, number, number, number] {
  const t2 = t * t
  const t3 = t2 * t
  return [
    -0.5 * t + t2 - 0.5 * t3,
    1 - 2.5 * t2 + 1.5 * t3,
    0.5 * t + 2 * t2 - 1.5 * t3,
    -0.5 * t2 + 0.5 * t3,
  ]
}

/** One channel's sample at `index`, or 0 outside the decoded range. */
function sampleOrSilence(samples: Float32Array, index: number): number {
  return index >= 0 && index < samples.length ? samples[index]! : 0
}

/**
 * Resample decoded audio through the clip's speed curve, the varispeed of design 7.1's 4.3:
 * the returned channels are exactly `outputSampleCount` samples long — the segment's own span
 * on the mix grid — and output sample `i` is read at `sourceSampleAt(read, first + i)`.
 *
 * The read is 4-point Catmull-Rom interpolation of the decoded samples, which is the identity
 * at a whole-sample position and smooth through a ramp. Past either end of the decoded range
 * the read is silent.
 */
export function resampleThroughCurve(
  channels: readonly Float32Array[],
  read: CurveAudioRead,
): Float32Array[] {
  const geometry = geometryOf(read)
  if (!Number.isInteger(read.outputSampleCount) || read.outputSampleCount < 0) {
    throw new RangeError(
      'resampleThroughCurve: outputSampleCount must be an integer >= 0, ' +
        `got ${read.outputSampleCount}`,
    )
  }
  if (!Number.isFinite(read.firstOutputSample)) {
    throw new RangeError(
      'resampleThroughCurve: firstOutputSample must be finite, ' + `got ${read.firstOutputSample}`,
    )
  }

  const count = read.outputSampleCount
  const output = channels.map(() => new Float32Array(count))
  for (let index = 0; index < count; index++) {
    const position = sourceSampleAt(geometry, read.firstOutputSample + index)
    const base = Math.floor(position)
    const [w0, w1, w2, w3] = cubicWeights(position - base)
    for (const [channel] of output.entries()) {
      const source = channels[channel]!
      output[channel]![index] =
        w0 * sampleOrSilence(source, base - 1) +
        w1 * sampleOrSilence(source, base) +
        w2 * sampleOrSilence(source, base + 1) +
        w3 * sampleOrSilence(source, base + 2)
    }
  }
  return output
}
