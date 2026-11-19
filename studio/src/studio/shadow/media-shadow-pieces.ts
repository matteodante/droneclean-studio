/**
 * The cleaned shadow pieces kept under `media/{id}/shadow/`, and the rule that protects them.
 *
 * A piece is a file the user paid for. A media's folder is removed with the media, but its pieces
 * leave with it only when the user has said so: the delete dialogs wrap their deletion in
 * `withShadowPieceDeletionApproved` after telling how many pieces there are. Any other path that
 * deletes a media (an agent through the SDK, a project removal) leaves `media/{id}/shadow/` where
 * it is, so no paid file is lost without the question being asked.
 */

import { listDirectory, removeEntry } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { mediaDir } from '@/infrastructure/storage/workspace-fs/paths'

const SHADOW_DIR_NAME = 'shadow'

/** Media whose pieces the user agreed to delete, for the length of one deletion. */
const approved = new Set<string>()

/** Segments for `media/{id}/shadow/`. */
function mediaShadowDir(id: string): string[] {
  return [...mediaDir(id), SHADOW_DIR_NAME]
}

/** The file names of the media's cleaned pieces (none when it has no `shadow/` folder). */
export async function listMediaShadowPieceFiles(
  root: FileSystemDirectoryHandle,
  id: string,
): Promise<string[]> {
  const entries = await listDirectory(root, mediaShadowDir(id))
  return entries.filter((entry) => entry.kind === 'file').map((entry) => entry.name)
}

/**
 * Runs `run` while these media's pieces may be deleted with them. The approval ends when `run`
 * ends, whether it succeeds or throws, so a deletion that failed half way leaves nothing approved.
 */
export async function withShadowPieceDeletionApproved<T>(
  ids: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  const added = ids.filter((id) => !approved.has(id))
  for (const id of added) approved.add(id)
  try {
    return await run()
  } finally {
    for (const id of added) approved.delete(id)
  }
}

/**
 * Removes a media's folder. The pieces are removed with it only when the user approved it;
 * otherwise everything else goes and `shadow/` stays.
 */
export async function removeMediaFolder(
  root: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  if (approved.has(id)) {
    await removeEntry(root, mediaDir(id), { recursive: true })
    return
  }
  const entries = await listDirectory(root, mediaDir(id))
  const keeps = entries.some(
    (entry) => entry.kind === 'directory' && entry.name === SHADOW_DIR_NAME,
  )
  if (!keeps || (await listMediaShadowPieceFiles(root, id)).length === 0) {
    await removeEntry(root, mediaDir(id), { recursive: true })
    return
  }
  for (const entry of entries) {
    if (entry.name === SHADOW_DIR_NAME) continue
    await removeEntry(root, [...mediaDir(id), entry.name], { recursive: true })
  }
}
