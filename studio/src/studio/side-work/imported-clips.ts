/**
 * Who hears of a freshly imported clip. `import-media.ts` is imported by the media library, so a
 * listener that reads the library's stores cannot be imported from it without a cycle: it
 * registers here instead, from the app's startup (`installStudio`).
 */
import type { MediaMetadata } from '@/types/storage'

type ImportedClipListener = (media: MediaMetadata) => void

const listeners = new Set<ImportedClipListener>()

/** Calls `listener` for every fresh import from now on; returns the way to stop. */
export function onImportedClip(listener: ImportedClipListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Tells every listener about a fresh import. */
export function emitImportedClip(media: MediaMetadata): void {
  for (const listener of listeners) listener(media)
}
