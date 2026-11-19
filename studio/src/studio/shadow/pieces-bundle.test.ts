// @vitest-environment node

/**
 * A project bundle carries the cleaned pieces the user paid for: export puts each piece file the
 * clips use into the zip, import writes it under the new media's folder and points the clips at
 * it, so the cleaned range plays after the import and the bytes are the ones that were exported.
 */

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import { getObjectUrlBlob } from '@/infrastructure/browser/object-url-registry'
import { writeBlob } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { requireWorkspaceRoot, setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import {
  asHandle,
  createRoot,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'
import { hydrateShadowPieces } from './hydrate'
import { resolveShadowSource } from './source-map'
import type { ShadowRemoval } from './model'

const store = vi.hoisted(() => ({
  project: null as unknown,
  media: new Map<string, unknown>(),
  mediaFiles: new Map<string, Blob>(),
  created: null as unknown,
  createdMedia: [] as unknown[],
}))

// The in-memory workspace hands back a Blob-like; a browser's `File` is a real Blob.
vi.mock('@/infrastructure/storage/workspace-fs/cache-mirror', async () => {
  const { readBlob } = await import('@/infrastructure/storage/workspace-fs/fs-primitives')
  const { getWorkspaceRoot } = await import('@/infrastructure/storage/workspace-fs/root')
  return {
    readWorkspaceBlob: async (segments: string[]) => {
      const file = await readBlob(getWorkspaceRoot()!, segments)
      return file ? new Blob([await file.arrayBuffer()]) : null
    },
  }
})

vi.mock('@/infrastructure/storage', () => ({
  getProject: async () => store.project,
  getProjectMediaIds: async () => [...store.media.keys()],
  loadProjectThumbnail: async () => null,
  readAnimationPresets: async () => [],
  createProject: async (project: unknown) => {
    store.created = project
  },
  createMedia: async (media: unknown) => {
    store.createdMedia.push(media)
  },
  saveThumbnail: async () => undefined,
  saveProjectThumbnail: async () => undefined,
  associateMediaWithProject: async () => undefined,
  updateProject: async () => undefined,
  saveAnimationPresets: async () => undefined,
  sanitizeAnimationPresets: () => [],
}))

vi.mock('@/features/project-bundle/deps/media-library', () => ({
  importMediaLibraryService: async () => ({
    mediaLibraryService: {
      getMedia: async (id: string) => store.media.get(id),
      getMediaFile: async (id: string) => store.mediaFiles.get(id),
    },
  }),
  computeContentHashFromBuffer: async () => 'hash-of-source',
  generateThumbnail: async () => new Blob(['thumb']),
}))

import { exportProjectBundle } from '@/features/project-bundle/services/bundle-export-service'
import { importProjectBundle } from '@/features/project-bundle/services/bundle-import-service'

const PIECE_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3, 4, 5, 6, 7, 8])
const PIECE_PATH = 'media/media-1/shadow/30_30_attempt-1.mp4'

const MEDIA = {
  id: 'media-1',
  fileName: 'clip.mp4',
  fileSize: 4,
  mimeType: 'video/mp4',
  contentHash: 'hash-of-source',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  bitrate: 1000,
} as MediaMetadata

function record(src?: string): ShadowRemoval {
  return {
    mark: { x: 10, y: 10, sourceFrame: 30, radius: 5 },
    ranges: [{ startFrame: 30, endFrame: 60, credits: 10, jobId: 'job-1', passJobId: 'pass-1' }],
    pieces: [{ jobId: 'job-1', path: PIECE_PATH, src, startFrame: 30, frames: 30 }],
  }
}

function project(): Project {
  return {
    id: 'project-1',
    name: 'Cleaned',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 90,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline: {
      tracks: [],
      items: [
        {
          id: 'clip-1',
          type: 'video',
          trackId: 'track-1',
          mediaId: 'media-1',
          from: 0,
          durationInFrames: 90,
          label: 'clip',
          // A blob URL is runtime only: it must not travel in the bundle.
          shadowRemoval: record('blob:dead'),
        },
      ],
    },
  } as unknown as Project
}

async function directory() {
  const root = createRoot('destination')
  const handle = asHandle(root)
  return { root, handle }
}

beforeEach(() => {
  setWorkspaceRoot(asHandle(createRoot()))
  store.project = project()
  store.media = new Map([['media-1', MEDIA]])
  store.mediaFiles = new Map([['media-1', new Blob([new Uint8Array([1, 2, 3, 4])])]])
  store.created = null
  store.createdMedia = []
})

async function exportBundle(): Promise<File> {
  const result = await exportProjectBundle('project-1')
  return new File([result.blob!], result.filename)
}

describe('shadow pieces in a project bundle', () => {
  it('exports the piece and imports it so the cleaned range plays with identical bytes', async () => {
    await writeBlob(requireWorkspaceRoot(), PIECE_PATH.split('/'), PIECE_BYTES)
    const bundle = await exportBundle()

    // A new workspace: nothing of the exported project is there.
    setWorkspaceRoot(asHandle(createRoot()))
    const { handle } = await directory()
    await importProjectBundle(bundle, handle)

    const imported = store.created as Project
    const newMediaId = (store.createdMedia[0] as { id: string }).id
    expect(newMediaId).not.toBe('media-1')
    const [clip] = imported.timeline!.items as unknown as { shadowRemoval: ShadowRemoval }[]
    const piece = clip!.shadowRemoval.pieces[0]!
    expect(piece.path).toBe(`media/${newMediaId}/shadow/30_30_attempt-1.mp4`)
    expect(piece.src).toBeUndefined()

    // The project opens: the path becomes a URL, and the resolver gives the piece for its frames.
    const [hydrated] = await hydrateShadowPieces(
      imported.timeline!.items as unknown as TimelineItem[],
    )
    const resolved = resolveShadowSource(
      (hydrated as { shadowRemoval: ShadowRemoval }).shadowRemoval,
      40,
    )
    expect(resolved?.src).toBeDefined()
    expect(resolved?.pieceFrame).toBe(10)
    const blob = getObjectUrlBlob(resolved!.src!)!
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PIECE_BYTES)
  })

  it('writes no manifest entry for a project with no pieces', async () => {
    const plain = project()
    ;(plain.timeline!.items[0] as { shadowRemoval?: ShadowRemoval }).shadowRemoval = undefined
    store.project = plain
    const bundle = await exportBundle()
    const { unzipSync } = await import('fflate')
    const files = unzipSync(new Uint8Array(await bundle.arrayBuffer()))
    expect(Object.keys(files).some((name) => name.startsWith('shadow-pieces/'))).toBe(false)
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    expect(manifest.shadowPieces).toBeUndefined()
  })

  it('does not bundle a blob URL and leaves a missing piece file out with the clip kept', async () => {
    // The piece's file is not in the workspace: nothing to carry, the record stays.
    const bundle = await exportBundle()
    const { unzipSync } = await import('fflate')
    const files = unzipSync(new Uint8Array(await bundle.arrayBuffer()))
    expect(Object.keys(files).some((name) => name.startsWith('shadow-pieces/'))).toBe(false)
    const exported = JSON.parse(new TextDecoder().decode(files['project.json']))
    const exportedPiece = exported.timeline.items[0].shadowRemoval.pieces[0]
    expect(exportedPiece.path).toBe(PIECE_PATH)
    expect(exportedPiece.src).toBeUndefined()
  })

  it('refuses a bundle whose manifest lists a piece the zip does not hold', async () => {
    await writeBlob(requireWorkspaceRoot(), PIECE_PATH.split('/'), PIECE_BYTES)
    const bundle = await exportBundle()
    const { unzipSync, zipSync } = await import('fflate')
    const files = unzipSync(new Uint8Array(await bundle.arrayBuffer()))
    for (const name of Object.keys(files)) {
      if (name.startsWith('shadow-pieces/')) delete files[name]
    }
    const broken = new File([zipSync(files) as Uint8Array<ArrayBuffer>], 'broken.freecut.zip')
    const { handle } = await directory()
    await expect(importProjectBundle(broken, handle)).rejects.toThrow(/Missing shadow piece file/)
  })
})
