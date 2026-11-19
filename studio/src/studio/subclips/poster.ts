// Poster frames for subclips (design 1.6, D2): the frame at the start of the range, cut from the
// parent file with the library's own thumbnail generator and kept as a blob URL for the session.
//
// Nothing is written to the workspace: a poster is cheap to make again (the cost is measured in
// the S4 report), and a file on disk would be one more thing to delete with the parent. A file
// without readable bytes here (a desktop path file) or a frame that cannot be decoded gives
// `null`, and the caller shows the parent's own thumbnail instead.

import { frameToSeconds, toRate } from '@/studio/time'
import type { Subclip } from './model'

export interface PosterDeps {
  /** The parent's bytes, or null when this process cannot read them. */
  getFile: (mediaId: string) => Promise<Blob | null>
  /** One frame of the file at `timestamp` seconds, as an image. */
  generate: (file: Blob, options: { timestamp: number }) => Promise<Blob>
  createUrl: (blob: Blob) => string
  revokeUrl: (url: string) => void
}

interface PosterEntry {
  signature: string
  promise: Promise<string | null>
  url: string | null
}

function signatureOf(subclip: Subclip): string {
  return `${subclip.mediaId}:${subclip.startFrame}:${subclip.sourceFps}`
}

export function createPosterService(deps: PosterDeps) {
  const entries = new Map<string, PosterEntry>()
  // One decode at a time: a library of many subclips must not open many decoders at once.
  let queue: Promise<unknown> = Promise.resolve()

  function free(entry: PosterEntry | undefined): void {
    if (entry?.url) deps.revokeUrl(entry.url)
  }

  async function make(subclip: Subclip): Promise<string | null> {
    try {
      const file = await deps.getFile(subclip.mediaId)
      if (!file) return null
      const timestamp = frameToSeconds(toRate(subclip.sourceFps), subclip.startFrame)
      return deps.createUrl(await deps.generate(file, { timestamp }))
    } catch {
      return null
    }
  }

  return {
    /** The poster's URL, made once per range; null when there is none (use the parent's thumbnail). */
    getPosterUrl(subclip: Subclip): Promise<string | null> {
      const signature = signatureOf(subclip)
      const known = entries.get(subclip.id)
      if (known?.signature === signature) return known.promise
      free(known)
      const entry: PosterEntry = { signature, url: null, promise: Promise.resolve(null) }
      const turn = queue.then(() => make(subclip))
      queue = turn
      entry.promise = turn.then((url) => {
        if (url === null) {
          // A failure is not remembered: the next ask tries again.
          if (entries.get(subclip.id) === entry) entries.delete(subclip.id)
        } else if (entries.get(subclip.id) === entry) {
          entry.url = url
        } else {
          deps.revokeUrl(url)
          return null
        }
        return url
      })
      entries.set(subclip.id, entry)
      return entry.promise
    },
    release(subclipId: string): void {
      free(entries.get(subclipId))
      entries.delete(subclipId)
    },
    clear(): void {
      for (const entry of entries.values()) free(entry)
      entries.clear()
    },
  }
}

/** The editor's poster service: the library's file access and thumbnail generator. */
export const subclipPosters = createPosterService({
  getFile: async (mediaId) => {
    const { mediaLibraryService } = await import(
      '@/features/media-library/services/media-library-service'
    )
    return mediaLibraryService.getMediaFile(mediaId)
  },
  generate: async (file, { timestamp }) => {
    const { generateThumbnail } = await import(
      '@/features/media-library/utils/thumbnail-generator'
    )
    return generateThumbnail(file as File, { timestamp, maxSize: 320, quality: 0.7 })
  },
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
})
