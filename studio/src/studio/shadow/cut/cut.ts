import {
  ALL_FORMATS,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import type { EncodedPacket, InputVideoTrack } from 'mediabunny'
import { ShadowCutError } from './errors'
import { inputSourceOf } from './input-source'
import type { ShadowCutWindow, ShadowCutter, ShadowSource } from './interface'
import { planShadowCut } from './plan'

/** How far the window's start may sit from its key packet, in seconds (far below one frame). */
const START_TOLERANCE_SECONDS = 1e-6

/** How far a frame may sit from the window's own grid, in frames: float noise, not a VFR source. */
const GRID_TOLERANCE_FRAMES = 1e-3

function requireWindow(window: ShadowCutWindow): void {
  const valid =
    Number.isInteger(window.startFrame) &&
    window.startFrame >= 0 &&
    Number.isInteger(window.endFrame) &&
    window.endFrame > window.startFrame
  if (!valid) {
    throw new TypeError(
      `shadow cut: the window must be whole source frames with endFrame greater than startFrame, got ${window.startFrame}..${window.endFrame}`,
    )
  }
}

/** The source key packet the window starts on; a window that does not start on one cannot be cut. */
async function windowKeyframe(
  track: InputVideoTrack,
  window: ShadowCutWindow,
): Promise<EncodedPacket> {
  const first = await new EncodedPacketSink(track).getKeyPacket(window.startSeconds, {
    verifyKeyPackets: true,
  })
  if (!first) {
    throw new ShadowCutError('no-keyframe')
  }
  if (Math.abs(first.timestamp - window.startSeconds) > START_TOLERANCE_SECONDS) {
    throw new Error(
      `shadow cut: the window starts at ${window.startSeconds} s, but its keyframe is at ${first.timestamp} s; plan the window first`,
    )
  }
  return first
}

interface StartedOutput {
  source: EncodedVideoPacketSource
  target: BufferTarget
  output: Output
  /** The window's frame count. */
  frames: number
  /** One frame's length, derived from the window's own frames and times. */
  frameSeconds: number
}

/**
 * Starts an MP4 output whose track carries the source's rotation and whose timescale holds the
 * window's own frame rate. The rate matters: without it mediabunny uses 57600, which cannot hold
 * a 1001/60000 frame exactly (961 ticks instead of 1001). With it the piece's frame times are the
 * source's own, to the tick.
 */
async function startOutput(
  track: InputVideoTrack,
  window: ShadowCutWindow,
): Promise<StartedOutput> {
  const codec = await track.getCodec()
  if (!codec) {
    throw new ShadowCutError('no-video')
  }
  const frames = window.endFrame - window.startFrame
  const frameSeconds = (window.endSeconds - window.startSeconds) / frames
  if (!(frameSeconds > 0)) {
    throw new Error(
      `shadow cut: the window's end ${window.endSeconds} s is not after its start ${window.startSeconds} s`,
    )
  }
  const source = new EncodedVideoPacketSource(codec)
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat(), target })
  output.addVideoTrack(source, { rotation: await track.getRotation(), frameRate: 1 / frameSeconds })
  await output.start()
  return { source, target, output, frames, frameSeconds }
}

/** The frame's index in the window, or an error when it is not a whole frame of the window. */
function frameOf(
  packet: EncodedPacket,
  first: EncodedPacket,
  frames: number,
  frameSeconds: number,
): number {
  if (packet.timestamp < first.timestamp) {
    throw new Error(
      `shadow cut: the packet at ${packet.timestamp} s decodes before the window's keyframe`,
    )
  }
  const index = (packet.timestamp - first.timestamp) / frameSeconds
  const rounded = Math.round(index)
  if (Math.abs(index - rounded) > GRID_TOLERANCE_FRAMES || rounded >= frames) {
    throw new Error(
      `shadow cut: the frame at ${packet.timestamp} s is not a frame of the ${1 / frameSeconds} fps window; it cannot be cut frame-exactly`,
    )
  }
  return rounded
}

/** Copies the window's packets to the output, every one on the window's own frame grid. */
async function copyWindow(
  track: InputVideoTrack,
  first: EncodedPacket,
  window: ShadowCutWindow,
  started: StartedOutput,
): Promise<{ copied: number; distinct: number }> {
  const sink = new EncodedPacketSink(track)
  const meta = { decoderConfig: (await track.getDecoderConfig()) ?? undefined }
  const seen = new Set<number>()
  let copied = 0
  for await (const packet of sink.packets(first, undefined, { verifyKeyPackets: true })) {
    if (packet.timestamp >= window.endSeconds) {
      break
    }
    seen.add(frameOf(packet, first, started.frames, started.frameSeconds))
    await started.source.add(packet.clone({ timestamp: packet.timestamp - first.timestamp }), meta)
    copied += 1
  }
  return { copied, distinct: seen.size }
}

/**
 * Cuts the window's frames into a new MP4 with the source's encoded samples copied, nothing
 * re-encoded: the piece's first sample is the source's keyframe packet, its timestamps start at 0,
 * and its frame `j` is source frame `window.startFrame + j`.
 *
 * Mediabunny's `Conversion({ trim })` cannot do this: its copy path requires the trim to start at
 * or before the file's first timestamp (`firstTimestamp < this._startTimestamp` forces a
 * transcode in 1.54.0's `conversion.js`), so any window inside the file would be re-encoded. This
 * drives the same primitives that path uses — an `EncodedPacketSink` and an
 * `EncodedVideoPacketSource` — from the window's keyframe instead.
 *
 * Throws when the source has no video track, when the window does not start exactly on a keyframe,
 * when a packet would land before the window's first frame or off the window's frame grid (a
 * source that is not constant frame rate at the rate the window was planned with), and when the
 * number of packets is not the window's frame count.
 */
export async function cutShadowPiece(file: ShadowSource, window: ShadowCutWindow): Promise<Blob> {
  requireWindow(window)

  const input = new Input({ source: inputSourceOf(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) {
      throw new ShadowCutError('no-video')
    }
    const first = await windowKeyframe(track, window)
    const started = await startOutput(track, window)
    const { copied, distinct } = await copyWindow(track, first, window, started)
    started.source.close()
    await started.output.finalize()

    if (copied !== started.frames || distinct !== started.frames) {
      throw new Error(
        `shadow cut: cut ${copied} frames in ${distinct} places of the window's ${started.frames}; the source's times do not follow the rate the window was planned with`,
      )
    }
    const buffer = started.target.buffer
    if (!buffer) {
      throw new Error('shadow cut: the output was finalized without data')
    }
    return new Blob([buffer], { type: 'video/mp4' })
  } finally {
    input.dispose()
  }
}

/** The in-browser cutter: mediabunny's packet sink to plan, its packet copy to cut. */
export const mediabunnyShadowCutter: ShadowCutter = {
  plan: planShadowCut,
  cut: cutShadowPiece,
}
