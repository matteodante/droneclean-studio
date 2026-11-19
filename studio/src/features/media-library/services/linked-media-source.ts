/**
 * Helpers for media whose source file is linked, never copied into the
 * workspace folder.
 *
 * A linked media is reached through its `FileSystemFileHandle` and, on the
 * desktop shell, additionally through the absolute path the preload bridge
 * reports. The workspace only gains `media/{id}/source.link.json`, a small
 * descriptor of the external file (see `workspace-fs/media-source.ts`).
 */

import type { MediaSourceLink } from '../deps/storage'
import { writeMediaSourceLink } from '../deps/storage'
import { getDesktopBridge } from '@/studio/desktop/bridge'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('LinkedMediaSource')

/** Absolute path of a local file on the desktop shell, undefined in the browser. */
export function getLinkedFilePath(file: File): string | undefined {
  const path = getDesktopBridge()?.getPathForFile(file)
  return path && path.length > 0 ? path : undefined
}

export function buildMediaSourceLink(file: File, filePath?: string): MediaSourceLink {
  const descriptor: MediaSourceLink = {
    version: 1,
    fileName: file.name,
    fileSize: file.size,
    fileLastModified: file.lastModified,
  }
  if (filePath) {
    descriptor.filePath = filePath
  }
  return descriptor
}

/**
 * Record the external file a linked media points at. Best-effort: a linked
 * media stays usable through its handle even if this sidecar cannot be
 * written (for example while the workspace permission is being re-granted).
 */
export async function persistMediaSourceLink(
  mediaId: string,
  file: File,
  filePath?: string,
): Promise<void> {
  try {
    await writeMediaSourceLink(mediaId, buildMediaSourceLink(file, filePath))
  } catch (error) {
    logger.warn(`Failed to write the link descriptor for ${mediaId}:`, error)
  }
}
