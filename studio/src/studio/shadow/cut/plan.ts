import { ALL_FORMATS, EncodedPacketSink, Input } from 'mediabunny'
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
    throw new Error('shadow cut: the video track has no packets')
  }
  return last.timestamp + last.duration
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
 * Throws when the source has no video track, when no keyframe is at or before the range's first
 * frame, and when the track has no packets.
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
      throw new Error('shadow cut: the file has no video track')
    }
    const sink = new EncodedPacketSink(track)

    const start = await sink.getKeyPacket(frameSeconds(range.startFrame, sourceRate), {
      verifyKeyPackets: true,
    })
    if (!start) {
      throw new Error(`shadow cut: no keyframe at or before source frame ${range.startFrame}`)
    }

    // The range's last frame sits in the GOP that starts at `lastFrameKey`; the window ends at the
    // keyframe after that GOP, which is the range's end itself when the range ends on a keyframe.
    const lastFrameKey = await sink.getKeyPacket(frameSeconds(range.endFrame - 1, sourceRate), {
      verifyKeyPackets: true,
    })
    const nextKey = lastFrameKey
      ? await sink.getNextKeyPacket(lastFrameKey, { verifyKeyPackets: true })
      : null
    const endSeconds = nextKey ? nextKey.timestamp : await trackEndSeconds(sink)

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
