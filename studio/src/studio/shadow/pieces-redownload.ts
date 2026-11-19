// Downloading a cleaned piece again.
//
// A piece is recorded on the clip but its file can be gone (a bundle made before pieces were
// carried, a folder copied without it, a file deleted by hand). The service keeps a job's result
// for 30 days after the cleaning (`ShadowPiece.availableUntil`), so while that time has not
// passed the file can be fetched again without paying: the job is read again (the result URL is
// pre-signed and expires within the hour, a fresh one comes with every read), the file is
// downloaded, written to the path the clip already records, and handed back to the clips that
// use it as a blob URL. After that date, or when the service no longer has the job, the range
// keeps playing the original until it is cleaned again.

import { useItemsStore } from '@/features/timeline/stores/items-store'
import type { VideoItem } from '@/types/timeline'
import type { DroneCleanClient } from './api/client'
import { DroneCleanApiError } from './api/types'
import { createBrowserClient } from './cloud-defaults'
import { validateShadowRemoval, type ShadowPiece } from './model'
import { savePieceInWorkspace } from './run'

/** What a re-download needs; the tests pass the recorded client and a clock. */
export interface PieceRedownloadDeps {
  client: Pick<DroneCleanClient, 'getJob' | 'downloadResult'>
  /** Writes the file at the piece's workspace path and gives the URL the renderer reads. */
  savePiece: (segments: string[], blob: Blob) => Promise<string>
  /** The current time in milliseconds. */
  now: () => number
}

/** Why a piece cannot be fetched again: the service's copy is past its date, or is gone. */
export type PieceRedownloadOutcome =
  | { status: 'restored'; src: string }
  | { status: 'unavailable'; reason: 'expired' | 'gone' }

/** Whether the service's copy is past the date it gave. A piece with no date is tried. */
export function pieceExpired(availableUntil: string | null | undefined, now: number): boolean {
  if (!availableUntil) return false
  const until = Date.parse(availableUntil)
  return Number.isFinite(until) && until <= now
}

/** The clips that record a piece at this path, so every one of them gets the file back. */
function clipsUsingPiece(path: string): VideoItem[] {
  return useItemsStore
    .getState()
    .items.filter(
      (item): item is VideoItem =>
        item.type === 'video' && (item.shadowRemoval?.pieces ?? []).some((p) => p.path === path),
    )
}

/** Gives the piece its URL on every clip that records it. Runtime only: no undo step, nothing saved. */
function attachPieceSource(path: string, src: string): void {
  for (const clip of clipsUsingPiece(path)) {
    const record = clip.shadowRemoval
    if (!record) continue
    const pieces = record.pieces.map((piece) => (piece.path === path ? { ...piece, src } : piece))
    useItemsStore
      .getState()
      ._updateItem(clip.id, { shadowRemoval: validateShadowRemoval({ ...record, pieces }) })
  }
}

/**
 * Fetches `piece` again from the job that made it. Throws the API's own error when the service
 * cannot be reached or the pilot is signed out (`SignInRequiredError`), so the section can say so;
 * a piece past its date, or a job the service has dropped, is `unavailable`, not an error.
 */
export async function redownloadShadowPiece(
  piece: ShadowPiece,
  deps: PieceRedownloadDeps,
): Promise<PieceRedownloadOutcome> {
  if (pieceExpired(piece.availableUntil, deps.now())) {
    return { status: 'unavailable', reason: 'expired' }
  }
  let job
  try {
    job = await deps.client.getJob(piece.jobId)
  } catch (error) {
    if (error instanceof DroneCleanApiError && error.status === 404) {
      return { status: 'unavailable', reason: 'gone' }
    }
    throw error
  }
  if (job.status !== 'succeeded' || !job.result) return { status: 'unavailable', reason: 'gone' }
  if (pieceExpired(job.result.availableUntil, deps.now())) {
    return { status: 'unavailable', reason: 'expired' }
  }
  const blob = await deps.client.downloadResult(job.result.url)
  if (blob.size === 0) throw new Error('The cleaned file could not be downloaded. Try again.')
  const src = await deps.savePiece(piece.path.split('/'), blob)
  attachPieceSource(piece.path, src)
  return { status: 'restored', src }
}

let injected: PieceRedownloadDeps | null = null
let browserDefaults: PieceRedownloadDeps | null = null

/** Replaces the re-download's dependencies (the tests, the desktop shell); null restores the web's. */
export function configurePieceRedownload(deps: PieceRedownloadDeps | null): void {
  injected = deps
  browserDefaults = null
}

/** The dependencies a press of "Download again" uses: the injected ones, else the web editor's. */
export function pieceRedownloadDeps(): PieceRedownloadDeps {
  if (injected) return injected
  browserDefaults ??= {
    client: createBrowserClient(),
    savePiece: savePieceInWorkspace,
    now: () => Date.now(),
  }
  return browserDefaults
}
