// Deleting a media and the cleaned pieces the user paid for.
//
// The delete dialogs ask first when the media has pieces (`ui/ShadowPiecesDeletionNotice.tsx`
// says how many, that they were paid for and that the service keeps a copy for 30 days after the
// cleaning), and a "Delete" is the explicit yes. Only then are the pieces removed with the media:
// `withShadowPieceDeletionApproved` wraps the deletion, and the workspace's media removal keeps
// `media/{id}/shadow/` for every media that was not approved (an agent's SDK call, a project
// removal), so a paid file is never lost without the question.

import { getWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { listMediaShadowPieceFiles } from './media-shadow-pieces'

export { withShadowPieceDeletionApproved } from './media-shadow-pieces'

/** How many cleaned piece files these media keep in the workspace (0 with no workspace open). */
export async function countShadowPieceFiles(mediaIds: readonly string[]): Promise<number> {
  const root = getWorkspaceRoot()
  if (!root) return 0
  let count = 0
  for (const id of new Set(mediaIds)) {
    try {
      count += (await listMediaShadowPieceFiles(root, id)).length
    } catch {
      // A folder that cannot be listed is not announced; the pieces in it are still kept.
    }
  }
  return count
}
