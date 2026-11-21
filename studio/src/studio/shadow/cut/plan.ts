import { ALL_FORMATS, EncodedPacketSink, Input, type EncodedPacket } from 'mediabunny'
import { ShadowCutError } from './errors'
import { inputSourceOf } from './input-source'
import type { ShadowCutRange, ShadowCutWindow, ShadowSource, SourceRate } from './interface'

/** The source time of a frame: `frame · den / num`, from the integer frame, never accumulated. */
function frameSeconds(frame: number, sourceRate: SourceRate): number {
  return (frame * sourceRate.den) / sourceRate.num
}

/** The source frame nearest a time: one rounding of `seconds · num / den`. */
function sourceFrame(seconds: number, sourceRate: SourceRate): number {
  return Math.round((seconds * sourceRate.num) / sourceRate.den)
}

function requireRange(range: ShadowCutRange): void {
  const valid =
    Number.isInteger(range.startFrame) &&
    range.startFrame >= 0 &&
    Number.isInteger(range.endFrame) &&
    range.endFrame > range.startFrame
  if (!valid) {
    throw new TypeError(
      `shadow cut: the range must be whole source frames with endFrame greater than startFrame, got ${range.startFrame}..${range.endFrame}`,
    )
  }
}

function requireRate(sourceRate: SourceRate): void {
  if (!(sourceRate.num > 0) || !(sourceRate.den > 0)) {
    throw new TypeError(
      `shadow cut: the source rate must be positive, got ${sourceRate.num}/${sourceRate.den}`,
    )
  }
}

/** The time at which the track's last frame ends, the end of a window that runs to the file's end. */
async function trackEndSeconds(sink: EncodedPacketSink): Promise<number> {
  const last = await sink.getPacket(Infinity)
  if (!last) {
    throw new ShadowCutError('no-video')
  }
  return last.timestamp + last.duration
}

/**
 * The keyframe the window starts on and the time it ends at.
 *
 * A range that begins before the file's first keyframe (its first frame, when the file's first
 * timestamp is above 0 or its leading frames are not key frames) starts on that first keyframe:
 * `getKeyPacket` finds nothing before it, and nothing earlier can be decoded anyway.
 */
async function windowKeys(
  sink: EncodedPacketSink,
  range: ShadowCutRange,
  sourceRate: SourceRate,
): Promise<{ start: EncodedPacket; endSeconds: number }> {
  const start =
    (await sink.getKeyPacket(frameSeconds(range.startFrame, sourceRate), {
      verifyKeyPackets: true,
    })) ?? (await sink.getFirstKeyPacket({ verifyKeyPackets: true }))
  if (!start) {
    throw new ShadowCutError('no-keyframe')
  }

  // The range's last frame sits in the GOP that starts at `lastFrameKey`; the window ends at the
  // keyframe after that GOP, which is the range's end itself when the range ends on a keyframe.
  const lastFrameKey =
    (await sink.getKeyPacket(frameSeconds(range.endFrame - 1, sourceRate), {
      verifyKeyPackets: true,
    })) ?? start
  const nextKey = await sink.getNextKeyPacket(lastFrameKey, { verifyKeyPackets: true })
  return { start, endSeconds: nextKey ? nextKey.timestamp : await trackEndSeconds(sink) }
}

/**
 * Widens a range of source frames to the keyframes around it, and reads the window's two times
 * from the key packets themselves.
 *
 * The window starts at the last keyframe at or before the range's first frame, and ends at the
 * keyframe after the one the range's last frame belongs to — the first keyframe at or after the
 * range's end, or the track's end when the range runs into the last GOP. A range that already ends
 * on a keyframe therefore does not pull in the next GOP. The window is expressed both as integer
 * source frames (one rounding of `timestamp · num / den`) and as the packets' own times, so `cut`
 * can read exactly the frames this window names.
 *
 * A range that starts before the file's first keyframe starts on that keyframe, so the window may
 * begin after the range's first frame; the frames before it cannot be decoded and do not exist.
 *
 * Throws a `ShadowCutError` when the source has no video track or packets, or no keyframe at all.
 */
export async function planShadowCut(
  file: ShadowSource,
  range: ShadowCutRange,
  sourceRate: SourceRate,
): Promise<ShadowCutWindow> {
  requireRange(range)
  requireRate(sourceRate)

  const input = new Input({ source: inputSourceOf(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) {
      throw new ShadowCutError('no-video')
    }
    const sink = new EncodedPacketSink(track)

    const { start, endSeconds } = await windowKeys(sink, range, sourceRate)

    return {
      startFrame: sourceFrame(start.timestamp, sourceRate),
      endFrame: sourceFrame(endSeconds, sourceRate),
      startSeconds: start.timestamp,
      endSeconds,
    }
  } finally {
    input.dispose()
  }
}
