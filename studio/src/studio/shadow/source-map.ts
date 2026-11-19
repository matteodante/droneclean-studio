import type { ShadowPiece, ShadowRemoval } from './model'

/** Whether the job of `piece` was paid to clean `sourceFrame` (one of its own ranges covers it). */
function cleanedByOwnJob(record: ShadowRemoval, piece: ShadowPiece, sourceFrame: number): boolean {
  return record.ranges.some(
    (range) =>
      range.jobId === piece.jobId &&
      range.startFrame <= sourceFrame &&
      sourceFrame < range.endFrame,
  )
}

/**
 * Which file a source frame comes from, and its frame inside that file.
 *
 * The one place that knows about cleaned pieces: preview, browser export and the precise decode
 * path all ask this question here, so they agree. Frames are integer source frames counted from
 * the source's first frame, so the clip's trim, split, speed and the project's frame rate never
 * enter into it. Pure: no React, no store, no I/O.
 *
 * Pieces may overlap: a second clean of some of the same frames keeps the first, which was paid
 * for. Where several pieces cover the frame, the answer is the newest (the latest in the record)
 * whose own job cleaned that frame, so a newer clean wins where both repainted it, and a newer
 * piece's untouched copy of the source never hides a frame an older job was paid to clean. When no
 * covering piece's job cleaned the frame, the newest covering piece answers, as a lone piece does
 * for the frames around its ranges.
 *
 * Returns `null` when no piece covers the frame (the source's own file is the answer), and a
 * `src` of `undefined` when the piece is recorded but its file is not open yet.
 */
export function resolveShadowSource(
  record: ShadowRemoval | undefined,
  sourceFrame: number,
): { src: string | undefined; path: string; pieceFrame: number } | null {
  if (!record) return null
  let newestCovering: ShadowPiece | null = null
  for (let index = record.pieces.length - 1; index >= 0; index--) {
    const piece = record.pieces[index]!
    const pieceFrame = sourceFrame - piece.startFrame
    if (pieceFrame < 0 || pieceFrame >= piece.frames) continue
    if (cleanedByOwnJob(record, piece, sourceFrame)) {
      return { src: piece.src, path: piece.path, pieceFrame }
    }
    newestCovering ??= piece
  }
  if (!newestCovering) return null
  return {
    src: newestCovering.src,
    path: newestCovering.path,
    pieceFrame: sourceFrame - newestCovering.startFrame,
  }
}

/**
 * The pieces of a record whose file is not open, and whose frames therefore cannot be drawn:
 * a project opened before the record was written, or a file that did not open (`hydrate.ts`
 * proves a piece's file by reading it, and leaves `src` unset when it cannot). Pure — the
 * caller owns the registry and the read. The clip panel says a piece is missing with it, and
 * an export refuses to run while one of the clip's pieces would be read.
 */
export function shadowPiecesWithoutFile(record: ShadowRemoval | undefined): ShadowPiece[] {
  return (record?.pieces ?? []).filter((piece) => piece.src === undefined)
}

/**
 * The time to ask the decoder for frame `pieceFrame` of a piece, in seconds: one rounding of
 * `pieceFrame · den / num`, computed from the integer frame rather than accumulated, so a long
 * run of frames cannot drift.
 */
export function pieceTimeSeconds(
  pieceFrame: number,
  sourceRate: { num: number; den: number },
): number {
  return (pieceFrame * sourceRate.den) / sourceRate.num
}
