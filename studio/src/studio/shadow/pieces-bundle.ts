// The cleaned pieces inside a project bundle.
//
// A piece is a file the user paid for, kept at `media/{mediaId}/shadow/{name}` in the workspace
// and recorded on the clip. A bundle without it would import a project whose cleaned ranges play
// the original again, so the bundle carries every piece a clip uses: the files sit under
// `shadow-pieces/{originalMediaId}/` in the zip and the manifest lists them with their size and
// SHA-256. Import writes each one under the new media's folder and points the clips' piece paths
// at it, because an import gives every media a new id.

import { createLogger } from '@/shared/logging/logger'
import { requireWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { writeBlob } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { readWorkspaceBlob } from '@/infrastructure/storage/workspace-fs/cache-mirror'
import type { ShadowPiece, ShadowRemoval } from './model'

const logger = createLogger('ShadowPiecesBundle')

/** Where the pieces sit inside the zip. */
const BUNDLE_PIECES_DIR = 'shadow-pieces'

/** One piece file in the manifest. */
export interface BundleShadowPieceEntry {
  /** The media the piece belongs to, as it was in the exported project. */
  originalMediaId: string
  /** The piece's workspace path in the exported project: `media/{originalMediaId}/shadow/{fileName}`. */
  path: string
  /** Path within the bundle: `shadow-pieces/{originalMediaId}/{fileName}`. */
  relativePath: string
  fileName: string
  fileSize: number
  sha256: string
}

/** The part of a project's timeline that holds clips: the root items and each composition's. */
interface TimelineLike {
  items: unknown[]
  compositions?: { items: unknown[] }[]
}

interface PieceLocation {
  mediaId: string
  fileName: string
}

/** `media/{mediaId}/shadow/{fileName}` taken apart; null for any other path. */
function parsePiecePath(path: string): PieceLocation | null {
  const parts = path.split('/')
  if (parts.length !== 4 || parts[0] !== 'media' || parts[2] !== 'shadow') return null
  const mediaId = parts[1]
  const fileName = parts[3]
  if (!mediaId || !fileName) return null
  return { mediaId, fileName }
}

function shadowRecordOf(item: unknown): ShadowRemoval | undefined {
  const candidate = item as { type?: unknown; shadowRemoval?: ShadowRemoval }
  return candidate.type === 'video' ? candidate.shadowRemoval : undefined
}

function allItems(timeline: TimelineLike | undefined): unknown[] {
  if (!timeline) return []
  return [...timeline.items, ...(timeline.compositions ?? []).flatMap((c) => c.items)]
}

/** Every distinct piece the project's clips record, by workspace path. */
function collectPieces(timeline: TimelineLike | undefined): ShadowPiece[] {
  const byPath = new Map<string, ShadowPiece>()
  for (const item of allItems(timeline)) {
    for (const piece of shadowRecordOf(item)?.pieces ?? []) {
      if (!byPath.has(piece.path)) byPath.set(piece.path, piece)
    }
  }
  return [...byPath.values()]
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Adds every piece file the project's clips use to the zip and returns the manifest entries (an
 * empty list for a project with none). A piece whose file cannot be read is left out with a
 * warning: the clip still records it, and the clip panel offers to download it again.
 */
export async function addShadowPiecesToBundle(
  timeline: TimelineLike | undefined,
  addFile: (relativePath: string, contents: Uint8Array) => void,
): Promise<BundleShadowPieceEntry[]> {
  const entries: BundleShadowPieceEntry[] = []
  for (const piece of collectPieces(timeline)) {
    const location = parsePiecePath(piece.path)
    if (!location) {
      logger.warn(`Shadow piece has an unexpected path, not bundled: ${piece.path}`)
      continue
    }
    const blob = await readWorkspaceBlob(piece.path.split('/'))
    if (!blob) {
      logger.warn(`Shadow piece file not found, not bundled: ${piece.path}`)
      continue
    }
    const buffer = await blob.arrayBuffer()
    const relativePath = `${BUNDLE_PIECES_DIR}/${location.mediaId}/${location.fileName}`
    addFile(relativePath, new Uint8Array(buffer))
    entries.push({
      originalMediaId: location.mediaId,
      path: piece.path,
      relativePath,
      fileName: location.fileName,
      fileSize: buffer.byteLength,
      sha256: await sha256Hex(buffer),
    })
  }
  return entries
}

/**
 * Writes the bundled pieces under the new media's folder, `media/{newMediaId}/shadow/{fileName}`.
 * A piece whose media was not imported, whose file is missing from the zip, or whose bytes do not
 * match the manifest is skipped with a warning (the clip then shows it missing). Returns how many
 * files were written.
 */
export async function restoreShadowPiecesFromBundle(
  entries: readonly BundleShadowPieceEntry[] | undefined,
  files: Record<string, Uint8Array>,
  mediaIdMap: ReadonlyMap<string, string>,
): Promise<number> {
  let restored = 0
  for (const entry of entries ?? []) {
    const newMediaId = mediaIdMap.get(entry.originalMediaId)
    const bytes = files[entry.relativePath]
    if (!newMediaId || !bytes) {
      logger.warn(`Shadow piece not restored: ${entry.relativePath}`)
      continue
    }
    const buffer = new Uint8Array(bytes).buffer
    if (bytes.byteLength !== entry.fileSize || (await sha256Hex(buffer)) !== entry.sha256) {
      logger.warn(`Shadow piece does not match its manifest entry: ${entry.relativePath}`)
      continue
    }
    try {
      await writeBlob(
        requireWorkspaceRoot(),
        ['media', newMediaId, 'shadow', entry.fileName],
        new Blob([buffer], { type: 'video/mp4' }),
      )
      restored++
    } catch (error) {
      logger.warn(`Shadow piece could not be written: ${entry.relativePath}`, error)
    }
  }
  return restored
}

function mapRecords<T extends TimelineLike>(
  timeline: T,
  map: (record: ShadowRemoval) => ShadowRemoval,
): T {
  const mapItem = (item: unknown): unknown => {
    const record = shadowRecordOf(item)
    return record ? { ...(item as object), shadowRemoval: map(record) } : item
  }
  return {
    ...timeline,
    items: timeline.items.map(mapItem),
    compositions: timeline.compositions?.map((composition) => ({
      ...composition,
      items: composition.items.map(mapItem),
    })),
  }
}

/** The timeline as a bundle stores it: the pieces' blob URLs are runtime only and never leave. */
export function stripShadowPieceUrls<T extends TimelineLike>(timeline: T): T {
  return mapRecords(timeline, (record) => ({
    ...record,
    pieces: record.pieces.map((piece) => {
      const saved: ShadowPiece = { ...piece }
      delete saved.src
      return saved
    }),
  }))
}

/** Points every piece path at the new media id the import gave its media. */
export function remapShadowPiecePaths<T extends TimelineLike>(
  timeline: T,
  mediaIdMap: ReadonlyMap<string, string>,
): T {
  return mapRecords(timeline, (record) => ({
    ...record,
    pieces: record.pieces.map((piece) => {
      const location = parsePiecePath(piece.path)
      const newId = location ? mediaIdMap.get(location.mediaId) : undefined
      return newId && location
        ? { ...piece, path: `media/${newId}/shadow/${location.fileName}` }
        : piece
    }),
  }))
}
