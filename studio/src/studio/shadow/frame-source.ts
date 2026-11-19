// The cleaned piece as a source of frames (design 3.6 section 2.12, finding C13). One place answers "which file, which
// frame" for every path that decodes a clip's picture: the canvas path in FreeCut's `video.ts` and the staged path's
// frame provider both ask here, so a cleaned range reads the piece's file on both and nothing can disagree.
//
// Frames are integer source frames counted from the source's first frame (`source-map.ts`), so the clip's trim,
// split, speed and the project's rate never enter into it: the question is "source frame n", and the piece, which has
// the source's size and frame times (design 4.1 section 5.4), answers with its own frame `n - startFrame`.

import type { VideoItem } from '@/types/timeline'
import { shadowPieceStillOpens, unavailableShadowPieces } from './hydrate'
import { pieceTimeSeconds, resolveShadowSource } from './source-map'

/**
 * The source's rate as the integer fraction a cleaned piece's frames are counted
 * in. Cameras write a whole rate (24, 25, 30, …) or an NTSC one (N·1001), whose
 * double a denominator of 1001 recovers exactly; anything else lands within
 * 1/2000 fps, far below a frame over any piece, so the decoder still opens the
 * frame that was asked for.
 */
function sourceRateOf(sourceFps: number): { num: number; den: number } {
  const rate = Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 1
  return { num: Math.max(1, Math.round(rate * 1001)), den: 1001 }
}

/** A clip with cleaned pieces is never drawn from a live <video> element or a copied file. */
export function hasShadowPieces(item: VideoItem): boolean {
  return (item.shadowRemoval?.pieces.length ?? 0) > 0
}

/** The file, and the time inside it, that one rendered frame reads. */
export interface ShadowVideoFrame {
  /** The piece's file; undefined when the piece is recorded but its file is not open. */
  src: string | undefined
  /** The piece's workspace path, for the preview state and the export's error. */
  path: string
  /** The frame inside the piece. */
  pieceFrame: number
  /** The time to ask the piece's decoder for, in seconds. */
  timeSeconds: number
}

/**
 * The cleaned piece a rendered frame reads, or null when the source's own file is
 * the answer.
 *
 * The source time is turned into its integer source frame with one rounding (the
 * caller's time is already snapped to a frame, `render-span.ts:287-290`), and the
 * piece is asked which of its frames that source frame is. Frames are counted
 * from the source's first frame, so the clip's trim, split, speed and the
 * project's frame rate never enter into it. Pure: no store, no I/O.
 */
export function resolveShadowVideoFrame(
  item: VideoItem,
  sourceTime: number,
  sourceFps: number,
): ShadowVideoFrame | null {
  const record = item.shadowRemoval
  if (!record?.pieces.length) return null
  const rate = sourceRateOf(sourceFps)
  const sourceFrame = Math.round(sourceTime * Math.max(1, sourceFps))
  const found = resolveShadowSource(record, sourceFrame)
  if (!found) return null
  return {
    src: found.src,
    path: found.path,
    pieceFrame: found.pieceFrame,
    timeSeconds: pieceTimeSeconds(found.pieceFrame, rate),
  }
}

/**
 * The decoder and the time a GPU transition participant's frame reads (FreeCut's `gpu.ts`). A transition's time names
 * no single source frame: each participant resolves its own, through the rule the canvas path uses, so a cleaned range
 * comes from the piece's decoder (`keyOf(item.id, piece.src)`) at the piece's own time. `null` in an export when the
 * frame is inside a cleaned range whose file is not open: the canvas path it falls back to refuses the clip. A preview
 * reads the source there and keeps playing.
 */
export function shadowParticipantFrame(
  item: VideoItem,
  sourceTime: number,
  context: { readonly fps: number; readonly renderMode: 'export' | 'preview' },
  keyOf: (itemId: string, src: string) => string,
): { key: string; time: number } | null {
  const shadowFrame = resolveShadowVideoFrame(item, sourceTime, item.sourceFps ?? context.fps)
  if (!shadowFrame) return { key: item.id, time: sourceTime }
  if (shadowFrame.src === undefined) {
    return context.renderMode === 'preview' ? { key: item.id, time: sourceTime } : null
  }
  return { key: keyOf(item.id, shadowFrame.src), time: shadowFrame.timeSeconds }
}

/** Which file source frame `n` is read from: the source's own, a piece's frame, or a piece whose file is not open. */
export type ShadowFrameRead =
  | { readonly kind: 'source' }
  | {
      readonly kind: 'piece'
      readonly src: string
      readonly path: string
      readonly pieceFrame: number
    }
  | { readonly kind: 'missing'; readonly path: string; readonly pieceFrame: number }

/**
 * Where integer source frame `sourceIndex` comes from, with no time in between: inside a cleaned range its piece's
 * frame, outside it the source (the range is half-open: a piece of `frames` frames from `startFrame` covers
 * `startFrame … startFrame + frames - 1`). The staged path's provider asks this for every frame it decodes.
 */
export function shadowFrameRead(item: VideoItem, sourceIndex: number): ShadowFrameRead {
  const found = resolveShadowSource(item.shadowRemoval, sourceIndex)
  if (!found) return { kind: 'source' }
  if (found.src === undefined)
    return { kind: 'missing', path: found.path, pieceFrame: found.pieceFrame }
  return { kind: 'piece', src: found.src, path: found.path, pieceFrame: found.pieceFrame }
}

/** What the refusal reads of a frame being rendered: the clip, whether it is a preview, and the piece the frame reads. */
export interface ShadowRenderState {
  readonly item: VideoItem
  readonly isPreviewMode: boolean
  readonly shadowFrame: ShadowVideoFrame | null
}

/**
 * A recorded cleaned piece that cannot be read, and that this render has to
 * answer for: the frame itself reads it, or the clip's played range includes
 * frames of it (a reversed clip reads its piece from the far end of the range).
 */
function missingShadowPiece(
  state: ShadowRenderState,
  playedFrames: () => { first: number; last: number },
): { path: string } | null {
  if (state.shadowFrame && state.shadowFrame.src === undefined) {
    return { path: state.shadowFrame.path }
  }
  const pieces = unavailableShadowPieces(state.item)
  if (pieces.length === 0) return null
  const { first, last } = playedFrames()
  const played = pieces.find(
    (piece) => piece.startFrame <= last && first < piece.startFrame + piece.frames,
  )
  return played ? { path: played.path } : null
}

/** A piece the frame reads whose file no longer gives a byte. */
async function vanishedShadowPiece(state: ShadowRenderState): Promise<{ path: string } | null> {
  const frame = state.shadowFrame
  if (!frame?.src) return null
  return (await shadowPieceStillOpens(frame.src)) ? null : { path: frame.path }
}

/**
 * Refuses to render a clip whose cleaned range cannot be read in export: the
 * export would show the source inside a range the user paid to clean. A preview
 * shows the source there instead (its clip panel reads
 * `unavailableShadowPieces(item)`), and keeps playing.
 *
 * The file is asked again here, at the moment an export draws a frame that reads
 * it: a piece whose file disappeared after the project opened still has its URL,
 * and without this the export would draw nothing for the range and say nothing.
 *
 * `playedFrames` is the clip's first and last integer source frame, asked only when the frame itself reads no
 * missing piece.
 */
export async function refuseMissingShadowPiece(
  state: ShadowRenderState,
  playedFrames: () => { first: number; last: number },
): Promise<void> {
  if (state.isPreviewMode) return
  const missing = missingShadowPiece(state, playedFrames) ?? (await vanishedShadowPiece(state))
  if (!missing) return
  throw new Error(
    `Clip "${state.item.label || state.item.id}" is missing its cleaned piece "${missing.path}": ` +
      'the export would show the source inside a range that was paid to be cleaned. ' +
      'Restore the file, or remove the shadow removal, and export again.',
  )
}
