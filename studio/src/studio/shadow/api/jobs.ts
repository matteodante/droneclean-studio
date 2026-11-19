/**
 * The jobs' boundary between the editor's integer source frames and the API's seconds.
 *
 * The editor keeps every position as an integer source frame, counted from the source's first
 * frame (design 1.5, section 4.0; design 4.1, section 5.4). The API speaks seconds, measured from
 * the start of the upload: a piece uploaded from source frame `k` has frame `j` at source frame
 * `k + j`, always (design 4.1, section 5.2). Every conversion here is one rounding with the clip's
 * exact rate (`{num, den}`, from `@/studio/time`), never the float frame rate, so a frame survives
 * the round trip exactly for the whole length of clip 0020 (60000/1001, 230.88 s).
 *
 * Nothing here talks to the network: the caller builds the API's request with these values and
 * sends it with the client's `createJob`.
 */
import { frameToSeconds, secondsToFrame, type Rate } from '@/studio/time'
import type { Segment, ShadowClick, TrackData, TrackSummary } from './types'

/** A point on the shadow, in the editor's terms: video pixels and an integer source frame. */
export interface SourceMark {
  x: number
  y: number
  /** The source frame the point was picked on. */
  frame: number
  /** Radius of a circle that covers the whole shadow, in video pixels. */
  radius: number
}

/** A stretch of the clip to clean, in integer source frames (`endFrame` excluded), and its anchor. */
export interface SourceRange {
  startFrame: number
  endFrame: number
  /** A point on the shadow, on a frame inside the range. */
  anchor: SourceMark
  /** The tracking passes the range comes from, reused instead of tracking again. */
  trackJobIds?: string[]
}

/** A tracked frame in the source's own frames: what the preview draws while scrubbing. */
export interface SourceTrackPoint {
  frame: number
  x: number
  y: number
  radius: number
}

/** A stretch of the source where the shadow was found, in integer source frames. */
export interface SourceFrameRange {
  startFrame: number
  endFrame: number
}

/** The API's seconds from the upload's start of a source frame; the two positions must be frames. */
function uploadSeconds(rate: Rate, pieceStartFrame: number, frame: number): number {
  if (!Number.isInteger(pieceStartFrame) || !Number.isInteger(frame)) {
    throw new RangeError(
      `A position must be an integer source frame, not ${pieceStartFrame} (piece start) and ${frame}`,
    )
  }
  return frameToSeconds(rate, frame - pieceStartFrame)
}

/**
 * The API's point on the shadow (`ShadowClick`) for a mark: the frame becomes the upload's
 * `timeSeconds` with the clip's exact rate, so the engine picks exactly that frame.
 */
export function shadowClick(rate: Rate, pieceStartFrame: number, mark: SourceMark): ShadowClick {
  return {
    x: mark.x,
    y: mark.y,
    timeSeconds: uploadSeconds(rate, pieceStartFrame, mark.frame),
    radius: mark.radius,
  }
}

/**
 * The API's `Segment` for a range in source frames: `startSeconds = (startFrame - k) / fps` and
 * `endSeconds = (endFrame - k) / fps`, `endSeconds` excluded, with the anchor's own frame.
 *
 * The anchor must be a frame inside the range: the API accepts a `timeSeconds` at the end, but the
 * engine then moves the anchor to the range's last frame while its position stays the one of the
 * frame it was picked on, so the tracker would start from the wrong place.
 */
export function shadowSegment(rate: Rate, pieceStartFrame: number, range: SourceRange): Segment {
  const start = uploadSeconds(rate, pieceStartFrame, range.startFrame)
  const end = uploadSeconds(rate, pieceStartFrame, range.endFrame)
  if (range.endFrame <= range.startFrame) {
    throw new RangeError(
      `A range must end after it starts: ${range.startFrame} to ${range.endFrame}`,
    )
  }
  if (range.anchor.frame < range.startFrame || range.anchor.frame >= range.endFrame) {
    throw new RangeError(
      `The anchor frame ${range.anchor.frame} is not inside ${range.startFrame}..${range.endFrame}`,
    )
  }
  return {
    startSeconds: start,
    endSeconds: end,
    anchor: shadowClick(rate, pieceStartFrame, range.anchor),
    trackJobIds: range.trackJobIds,
  }
}

/**
 * `GET /v1/jobs/{id}/track`'s keyframes in source frames: a keyframe at upload frame `j` is source
 * frame `k + j`, an integer addition and nothing else (design 4.1, section 5.2).
 */
export function trackPointsInSourceFrames(
  pieceStartFrame: number,
  track: TrackData,
): SourceTrackPoint[] {
  if (!Number.isInteger(pieceStartFrame)) {
    throw new RangeError(`A piece must start on an integer source frame, not ${pieceStartFrame}`)
  }
  return track.keyframes.map(([frame, x, y, radius]) => ({
    frame: pieceStartFrame + frame,
    x,
    y,
    radius,
  }))
}

/**
 * The ranges a tracking pass found, in source frames: the pass reports seconds of the upload, so
 * each edge is rounded once with the clip's exact rate and shifted by the piece's first source
 * frame. A range that starts at upload frame 480 of a 60000/1001 piece starting at source frame
 * 3600 is source frame 4080, exactly.
 */
export function trackRangesInSourceFrames(
  rate: Rate,
  pieceStartFrame: number,
  track: Pick<TrackSummary, 'ranges'>,
): SourceFrameRange[] {
  if (!Number.isInteger(pieceStartFrame)) {
    throw new RangeError(`A piece must start on an integer source frame, not ${pieceStartFrame}`)
  }
  return track.ranges.map((range) => ({
    startFrame: pieceStartFrame + secondsToFrame(rate, range.startSeconds),
    endFrame: pieceStartFrame + secondsToFrame(rate, range.endSeconds),
  }))
}
