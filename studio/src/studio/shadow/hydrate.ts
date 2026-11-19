// The cleaned pieces of a clip, opened for the renderer when a project opens.
//
// A piece is kept beside its source as a workspace file and the project records its
// path, never a URL: a blob URL dies with the page (the model strips it before a save).
// On project open the path becomes a blob URL again, exactly as the reverse conform does
// for its file. A piece whose file cannot be read is left without `src`: the preview
// draws the source for its frames, the clip panel says the file is missing, and an
// export refuses to run rather than ship an uncleaned range the user paid for.
//
// The file is proven to open before its URL is handed out, and again before an export
// draws a frame that reads it: a `File` whose bytes are gone (the piece was truncated by
// a failed download, or its permission was withdrawn, or the user deleted it while the
// project was open) still reports its size, so both checks read a byte through the
// object-url registry the renderer itself reads. A URL that cannot give one is thrown
// away when the project opens (`unavailableShadowPieces`), and `shadowPieceStillOpens`
// lets an export refuse the clip instead of drawing nothing for a range that was paid for.
//
// `unavailableShadowPieces` is pure and is read by the renderer, so the workspace reader
// is imported when a project opens rather than with this module: the render graph (and
// its export worker) never carries the storage layer.

import type { TimelineItem, VideoItem } from '@/types/timeline'
import {
  getObjectUrlBlob,
  registerObjectUrl,
  unregisterObjectUrl,
} from '@/infrastructure/browser/object-url-registry'
import type { ShadowPiece, ShadowRemoval } from './model'
import { shadowPiecesWithoutFile } from './source-map'

/** One blob URL per workspace path, shared by every load of the same piece. */
const objectUrlByPath = new Map<string, string>()

/**
 * The URL of a piece's file, registered in the object-url registry the renderer reads
 * (its mediabunny input asks that registry for the blob behind a URL), so a piece is a
 * file the app knows rather than a string only this module holds.
 */
function getSharedObjectUrl(path: string, blob: Blob): string {
  const existing = objectUrlByPath.get(path)
  if (existing) return existing
  const file = new Blob([blob], { type: blob.type || 'video/mp4' })
  const url = URL.createObjectURL(file)
  registerObjectUrl(url, file)
  objectUrlByPath.set(path, url)
  return url
}

/**
 * Whether a blob can still give a byte. A `File` whose content is gone (deleted or
 * truncated on disk, or no longer permitted) still reports the size it had, so a size
 * is no evidence that the content is there; a read is.
 */
async function blobGivesAByte(blob: Blob): Promise<boolean> {
  try {
    const bytes = await blob.slice(0, 1).arrayBuffer()
    return bytes.byteLength > 0
  } catch {
    return false
  }
}

/**
 * Whether the file behind a piece's URL can still be read. The renderer reads the file
 * through the object-url registry, so this asks it there. A URL this context does not
 * know (a piece in another context's registry, or a project that was never opened here)
 * is not judged: only a file the registry names can be said to have gone.
 */
export async function shadowPieceStillOpens(src: string | undefined): Promise<boolean> {
  const blob = src === undefined ? null : getObjectUrlBlob(src)
  if (!blob) return true
  return blobGivesAByte(blob)
}

/** Forgets a URL whose file no longer opens, so a later open can make a fresh one. */
function dropObjectUrl(path: string, url: string): void {
  if (objectUrlByPath.get(path) === url) objectUrlByPath.delete(path)
  unregisterObjectUrl(url)
  URL.revokeObjectURL(url)
}

function hasShadowPieces(
  item: TimelineItem,
): item is TimelineItem & { type: 'video'; shadowRemoval: ShadowRemoval } {
  return item.type === 'video' && (item.shadowRemoval?.pieces.length ?? 0) > 0
}

async function hydratePiece(
  piece: ShadowPiece,
  readWorkspaceBlob: (segments: string[]) => Promise<Blob | null>,
): Promise<ShadowPiece> {
  const blob = await readWorkspaceBlob(piece.path.split('/').filter(Boolean))
  const url = blob ? getSharedObjectUrl(piece.path, blob) : undefined
  // The URL must be one the registry the renderer reads knows, and its file must give a
  // byte: the size of a piece whose content is gone is not evidence that it is there.
  const registered = url === undefined ? null : getObjectUrlBlob(url)
  const src = registered && (await blobGivesAByte(registered)) ? url : undefined
  if (url !== undefined && src === undefined) dropObjectUrl(piece.path, url)
  if (src === piece.src) return piece
  if (src === undefined) {
    const withoutSrc = { ...piece }
    delete withoutSrc.src
    return withoutSrc
  }
  return { ...piece, src }
}

async function hydrateItem(
  item: TimelineItem,
  readWorkspaceBlob: (segments: string[]) => Promise<Blob | null>,
): Promise<TimelineItem> {
  if (!hasShadowPieces(item)) return item
  const record = item.shadowRemoval
  const pieces = await Promise.all(
    record.pieces.map((piece) => hydratePiece(piece, readWorkspaceBlob)),
  )
  if (pieces.every((piece, index) => piece === record.pieces[index])) return item
  return { ...item, shadowRemoval: { ...record, pieces } }
}

/**
 * Gives every clip's cleaned pieces their `src` again, from the workspace file their
 * path names, and drops the ones whose file can no longer be read. The same shape and
 * the same reason as the reverse conform's hydration: called once where
 * `timeline-persistence.ts` hydrates the timeline's items. Returns the same items when
 * no clip has a piece.
 */
export async function hydrateShadowPieces(items: TimelineItem[]): Promise<TimelineItem[]> {
  if (!items.some(hasShadowPieces)) return items
  const { readWorkspaceBlob } = await import('@/infrastructure/storage/workspace-fs/cache-mirror')
  return Promise.all(items.map((item) => hydrateItem(item, readWorkspaceBlob)))
}

/**
 * The pieces of a clip that are recorded but cannot be read: their file was not found
 * when the project opened, or it could not give a byte, so `src` is undefined. The
 * renderer draws the source for their frames in preview, the clip panel reads this to
 * say the cleaned file is missing, and an export refuses to run while one of them is
 * still missing.
 */
export function unavailableShadowPieces(item: VideoItem): ShadowPiece[] {
  if (readsReverseConform(item)) return item.shadowRemoval?.pieces ?? []
  return shadowPiecesWithoutFile(item.shadowRemoval)
}

/**
 * Whether the clip draws from a reverse conform instead of its source. A piece is a stretch of
 * the source's own frames, and a conform is a different file in the opposite order, so no piece
 * resolves to a frame of such a clip: every piece counts as unavailable and an export refuses it
 * rather than ship the source where the pilot paid for a cleaning.
 */
function readsReverseConform(item: VideoItem): boolean {
  return (
    item.src !== undefined &&
    (item.src === item.reverseConformSrc || item.src === item.reverseConformPreviewSrc)
  )
}
