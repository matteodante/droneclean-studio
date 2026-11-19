import { exactSpeed, floorScaledFrames, frameToSeconds, toRate } from '@/studio/time'
import {
  clipSourcePosition,
  normalizeSourceRemainder,
  type SourceRemainder,
  type SpeedCurve,
} from '@/studio/speed'

/**
 * The source frame a clip's (sequence-local) frame shows, through the one mapping
 * (`clipSourcePosition`, review finding T8): from the clip's first frame on, its speed curve's
 * integral or its constant speed, with the cut's remainder added before the floor (design 7.1,
 * sections 4.2 and 4.6). Before the first frame (a transition's pre-roll, the rolling-edit
 * panel) the constant speed answers, floored from the frame index as design 1.5, section 4.2
 * does for any frame. A reversed clip shows `reverseSourceEnd - 1 - advance`: it starts on the
 * last source frame and steps back as the forward advance grows, with no curve and no remainder
 * (design 7.1, section 4.6).
 */
function sourceFrameOf(
  trimBefore: number,
  sourceFps: number,
  localFrame: number,
  playbackRate: number,
  timelineFps: number,
  isReversed: boolean,
  reverseSourceEnd: number | undefined,
  speedCurve: SpeedCurve | undefined,
  sourceFrameOffset: SourceRemainder | undefined,
): number {
  const sourceRate = toRate(sourceFps)
  const projectRate = toRate(timelineFps)
  // Frame bounds are frame counts; a legacy fractional trim is floored to the frame it lands
  // in, which is the frame the decoder would pick for that time.
  const trimFrame = Math.max(0, Math.floor(trimBefore))
  if (isReversed) {
    const advance = floorScaledFrames(localFrame, exactSpeed(playbackRate), sourceRate, projectRate)
    const sourceEnd = Math.max(0, Math.floor(reverseSourceEnd ?? trimFrame))
    return Math.max(0, sourceEnd - 1 - advance)
  }
  if (localFrame < 0) {
    return (
      trimFrame + floorScaledFrames(localFrame, exactSpeed(playbackRate), sourceRate, projectRate)
    )
  }
  return clipSourcePosition(
    {
      sourceStart: trimFrame,
      sourceFps,
      speed: playbackRate,
      speedCurve,
      sourceFrameOffset,
    },
    localFrame,
    projectRate,
  ).frame
}

/**
 * Calculate source playback time (seconds) for a video clip.
 * Supports shared Sequence rendering by applying a per-item frame offset.
 *
 * The result is the source frame's own start time, exactly what the decoder must be asked for
 * (design 1.5, 4.2): the frame is chosen by the exact mapping, and no snap moves the request to
 * a neighbour. A reversed clip shows `reverseSourceEnd - 1 - advance`, so it starts on the last
 * source frame and steps back as the forward mapping advances.
 *
 * `speedCurve` is the item's curve (design 7.1) and `sourceFrameOffset` its cut remainder, the
 * exact fraction the item stores (design 7.1, section 4.6): both go into `clipSourcePosition`,
 * so the preview shows the frame the export shows. A reversed clip ignores both.
 */
export function getVideoTargetTimeSeconds(
  safeTrimBefore: number,
  sourceFps: number,
  sequenceLocalFrame: number,
  playbackRate: number,
  timelineFps: number,
  sequenceFrameOffset: number = 0,
  isReversed: boolean = false,
  reverseSourceEnd?: number,
  speedCurve?: SpeedCurve,
  sourceFrameOffset?: SourceRemainder,
): number {
  const sourceFrame = sourceFrameOf(
    safeTrimBefore,
    sourceFps,
    sequenceLocalFrame - sequenceFrameOffset,
    playbackRate,
    timelineFps,
    isReversed,
    reverseSourceEnd,
    speedCurve,
    sourceFrameOffset,
  )
  return frameToSeconds(toRate(sourceFps), sourceFrame)
}

/**
 * Calculate source playback time (seconds) for an audio clip.
 *
 * IMPORTANT: `trimBefore` is in **source FPS** frames (not timeline FPS).
 * Using timeline FPS to convert trimBefore to seconds will produce the wrong
 * seek position for sources whose FPS differs from the project FPS.
 *
 * This function must produce the same result as `getVideoTargetTimeSeconds`
 * (with sequenceFrameOffset=0) so that video and audio stay in sync. It calls the same exact
 * mapping, so both ask for the same source frame's start time (design 1.5, 4.2; design 7.1,
 * section 4.2). `sourceFrameOffset` is the cut's remainder as the double the audio components
 * carry (audio reads between samples and needs no fraction); it is read back as the nearest
 * fraction up to 1,000,000, which is the item's own whenever its denominator fits, so the seek
 * frame is the picture's.
 */
export function getAudioTargetTimeSeconds(
  trimBefore: number,
  sourceFps: number,
  sequenceLocalFrame: number,
  playbackRate: number,
  timelineFps: number,
  isReversed: boolean = false,
  reverseSourceEnd?: number,
  speedCurve?: SpeedCurve,
  sourceFrameOffset: number = 0,
): number {
  const sourceFrame = sourceFrameOf(
    trimBefore,
    sourceFps,
    sequenceLocalFrame,
    playbackRate,
    timelineFps,
    isReversed,
    reverseSourceEnd,
    speedCurve,
    normalizeSourceRemainder(sourceFrameOffset),
  )
  return frameToSeconds(toRate(sourceFps), sourceFrame)
}
