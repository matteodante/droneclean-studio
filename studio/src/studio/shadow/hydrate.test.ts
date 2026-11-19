// @vitest-environment node

/**
 * On project open a cleaned piece's workspace path becomes the blob URL the renderer
 * reads, exactly as a reverse conform's path does; a piece whose file is gone stays
 * without a URL, which is how the preview, the clip panel and the export know it is
 * missing. The URL is handed out only once its file has given a byte through the same
 * object-url registry the renderer reads, so a file that reports a size but cannot be
 * read is missing too. Nothing else on the clip changes.
 */

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import type { ShadowRemoval } from './model'

const { readWorkspaceBlob } = vi.hoisted(() => ({ readWorkspaceBlob: vi.fn() }))

vi.mock('@/infrastructure/storage/workspace-fs/cache-mirror', () => ({ readWorkspaceBlob }))

const registry = vi.hoisted(() => {
  const files = new Map<string, Blob>()
  const unreadable = new Set<string>()
  return {
    files,
    unreadable,
    registerObjectUrl: vi.fn((url: string, blob: Blob) => {
      files.set(url, blob)
    }),
    unregisterObjectUrl: vi.fn((url: string) => {
      files.delete(url)
    }),
    getObjectUrlBlob: vi.fn((url: string) => {
      const file = files.get(url)
      if (!file) return null
      if (!unreadable.has(url)) return file
      // A file whose content is gone still reports the size it had.
      return {
        size: file.size,
        type: file.type,
        slice: () => ({
          arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotFoundError')),
        }),
      } as unknown as Blob
    }),
  }
})

vi.mock('@/infrastructure/browser/object-url-registry', () => ({
  registerObjectUrl: registry.registerObjectUrl,
  unregisterObjectUrl: registry.unregisterObjectUrl,
  getObjectUrlBlob: registry.getObjectUrlBlob,
}))

const PIECE_PATH = 'media/media-1/shadow/30_30.mp4'

function removal(src?: string): ShadowRemoval {
  return {
    mark: { x: 160, y: 90, sourceFrame: 30, radius: 20 },
    ranges: [{ startFrame: 30, endFrame: 60, credits: 45, jobId: 'job-1', passJobId: 'pass-1' }],
    pieces: [{ jobId: 'job-1', path: PIECE_PATH, src, startFrame: 30, frames: 30 }],
  }
}

function createItem(shadowRemoval?: ShadowRemoval): VideoItem {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'video',
    src: 'blob:source',
    label: 'cleaned',
    from: 0,
    durationInFrames: 64,
    shadowRemoval,
  } as VideoItem
}

let objectUrlCount = 0
let revokeObjectUrl: ReturnType<typeof vi.spyOn>
/**
 * The module keeps one URL per piece path for the life of the app, so each case starts
 * from a fresh module rather than inheriting the previous case's URLs.
 */
let hydrateShadowPieces: (typeof import('./hydrate'))['hydrateShadowPieces']
let unavailableShadowPieces: (typeof import('./hydrate'))['unavailableShadowPieces']

beforeEach(async () => {
  vi.resetModules()
  const hydrate = await import('./hydrate')
  hydrateShadowPieces = hydrate.hydrateShadowPieces
  unavailableShadowPieces = hydrate.unavailableShadowPieces
  readWorkspaceBlob.mockReset()
  registry.files.clear()
  registry.unreadable.clear()
  registry.registerObjectUrl.mockClear()
  registry.unregisterObjectUrl.mockClear()
  objectUrlCount = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    objectUrlCount += 1
    return `blob:hydrated-${objectUrlCount}`
  })
  revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

describe('hydrateShadowPieces', () => {
  it('gives a piece the blob URL of its workspace file, once per path', async () => {
    readWorkspaceBlob.mockResolvedValue(new Blob(['cleaned'], { type: 'video/mp4' }))
    const item = createItem(removal())

    const [hydrated] = (await hydrateShadowPieces([item])) as VideoItem[]
    const [again] = (await hydrateShadowPieces([item])) as VideoItem[]

    expect(readWorkspaceBlob).toHaveBeenCalledWith(['media', 'media-1', 'shadow', '30_30.mp4'])
    expect(hydrated?.shadowRemoval?.pieces[0]?.src).toBe('blob:hydrated-1')
    // The same file reached twice keeps one URL, so the renderer opens one decoder.
    expect(again?.shadowRemoval?.pieces[0]?.src).toBe('blob:hydrated-1')
    // The URL is the one the registry the renderer reads knows, for this piece's file.
    expect(registry.registerObjectUrl).toHaveBeenCalledWith(
      'blob:hydrated-1',
      expect.objectContaining({ size: 7 }),
    )
    expect(registry.getObjectUrlBlob('blob:hydrated-1')).not.toBeNull()
    // Everything else is the clip it was: the record is copied, not rewritten.
    expect(hydrated?.shadowRemoval?.mark).toEqual(item.shadowRemoval?.mark)
    expect(hydrated?.shadowRemoval?.ranges).toEqual(item.shadowRemoval?.ranges)
    expect(hydrated?.src).toBe('blob:source')
  })

  it('leaves a piece without a URL when its file is not there', async () => {
    readWorkspaceBlob.mockResolvedValue(null)
    const item = createItem(removal())

    const [hydrated] = (await hydrateShadowPieces([item])) as VideoItem[]

    expect(hydrated?.shadowRemoval?.pieces[0]?.src).toBeUndefined()
    expect(hydrated?.shadowRemoval?.pieces[0]?.path).toBe(PIECE_PATH)
    expect(unavailableShadowPieces(hydrated!).map((piece) => piece.path)).toEqual([PIECE_PATH])
  })

  it('does not hand out a URL for a file that reports a size but cannot be read', async () => {
    readWorkspaceBlob.mockResolvedValue(new Blob(['cleaned'], { type: 'video/mp4' }))
    registry.unreadable.add('blob:hydrated-1')
    const item = createItem(removal())

    const [hydrated] = (await hydrateShadowPieces([item])) as VideoItem[]

    // The file says it is seven bytes long; it gives none of them.
    const registeredFile = registry.registerObjectUrl.mock.calls[0]?.[1] as Blob | undefined
    expect(registeredFile?.size).toBe(7)
    expect(hydrated?.shadowRemoval?.pieces[0]?.src).toBeUndefined()
    expect(unavailableShadowPieces(hydrated!).map((piece) => piece.path)).toEqual([PIECE_PATH])
    // Nothing keeps the URL that names a file which does not open.
    expect(registry.unregisterObjectUrl).toHaveBeenCalledWith('blob:hydrated-1')
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:hydrated-1')
  })

  it('drops a URL made earlier whose file no longer opens', async () => {
    readWorkspaceBlob.mockResolvedValue(new Blob(['cleaned'], { type: 'video/mp4' }))
    const item = createItem(removal())
    const [first] = (await hydrateShadowPieces([item])) as VideoItem[]
    expect(first?.shadowRemoval?.pieces[0]?.src).toBe('blob:hydrated-1')

    // The file behind the URL the project is already holding is gone, and the next open
    // must not carry its URL into an export that would then draw nothing for the range.
    registry.unreadable.add('blob:hydrated-1')
    const [again] = (await hydrateShadowPieces([first!])) as VideoItem[]

    expect(again?.shadowRemoval?.pieces[0]?.src).toBeUndefined()
    expect(again?.shadowRemoval?.pieces[0]?.path).toBe(PIECE_PATH)
    expect(unavailableShadowPieces(again!).map((piece) => piece.path)).toEqual([PIECE_PATH])
    expect(registry.unregisterObjectUrl).toHaveBeenCalledWith('blob:hydrated-1')
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:hydrated-1')
  })

  it('drops a stale URL instead of keeping one that names nothing', async () => {
    readWorkspaceBlob.mockResolvedValue(null)
    const item = createItem(removal('blob:from-the-last-page'))

    const [hydrated] = (await hydrateShadowPieces([item])) as VideoItem[]

    expect(hydrated?.shadowRemoval?.pieces[0]?.src).toBeUndefined()
  })

  it('touches nothing when no clip has a piece', async () => {
    const items = [createItem(), createItem()]

    const hydrated = await hydrateShadowPieces(items)

    expect(readWorkspaceBlob).not.toHaveBeenCalled()
    expect(hydrated).toBe(items)
  })
})

describe('unavailableShadowPieces on a clip that reads a reverse conform', () => {
  it('counts every piece as unavailable, so an export refuses the clip', () => {
    // The pieces are in the source's frames; a conform is another file in reversed order.
    const item = {
      ...createItem(removal('blob:piece')),
      src: 'blob:conform',
      reverseConformStatus: 'ready',
      reverseConformSrc: 'blob:conform',
    } as VideoItem

    expect(unavailableShadowPieces(item).map((piece) => piece.path)).toEqual([PIECE_PATH])
    expect(unavailableShadowPieces(createItem(removal('blob:piece')))).toEqual([])
  })
})
