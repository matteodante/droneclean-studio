// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { clipSourcePosition } from '@/studio/speed'
import type { ShadowRemoval } from '@/studio/shadow/model'
import type { VideoItem } from '@/types/timeline'
import { createSourceFrameProvider, isFilePath } from './provider'
import {
  ShadowPieceUnavailable,
  SourceFrameMismatch,
  type BackendFrame,
  type DecodeOptions,
  type FrameBackend,
  type FrameFile,
} from './types'

const FPS = 30
const PIECE_SRC = 'blob:cleaned-30-59'
const PIECE_PATH = 'media/media-1/shadow/30_30.mp4'

interface FakeTexture {
  readonly id: number
  destroyed: boolean
  destroy(): void
}

/** A backend whose frames are numbered textures; `indexFor` lets a test make it decode the wrong frame. */
function fakeBackend(indexFor: (asked: number) => number = (asked) => asked) {
  const textures: FakeTexture[] = []
  const decodes: Array<{ file: string; index: number }> = []
  const prefetches: Array<{ file: string; indices: readonly number[] }> = []
  let destroyed = false
  const sizes: Array<{ width: number; height: number } | undefined> = []
  const backend: FrameBackend = {
    origin: 'webcodecs',
    async decode(file: FrameFile, index: number, options?: DecodeOptions): Promise<BackendFrame> {
      decodes.push({ file: file.key, index })
      sizes.push(options?.size)
      const texture: FakeTexture = {
        id: textures.length,
        destroyed: false,
        destroy() {
          texture.destroyed = true
        },
      }
      textures.push(texture)
      // A backend that uploads straight to an asked size, as the WebCodecs one does for a preview
      const size = options?.size
      return {
        texture: texture as unknown as GPUTexture,
        index: indexFor(index),
        width: size?.width ?? 64,
        height: size?.height ?? 36,
        ...(size === undefined ? {} : { natural: { width: 64, height: 36 } }),
      }
    },
    prefetch(file, indices) {
      prefetches.push({ file: file.key, indices })
    },
    destroy() {
      destroyed = true
    },
  }
  return {
    backend,
    textures,
    decodes,
    sizes,
    prefetches,
    live: () => textures.filter((texture) => !texture.destroyed).length,
    isDestroyed: () => destroyed,
  }
}

function cleanedItem(extra: Partial<VideoItem> = {}, pieceSrc: string | null = PIECE_SRC) {
  const shadowRemoval: ShadowRemoval = {
    mark: { x: 160, y: 90, sourceFrame: 30, radius: 20 },
    ranges: [{ startFrame: 30, endFrame: 60, credits: 45, jobId: 'job-1', passJobId: 'pass-1' }],
    pieces: [{ jobId: 'job-1', path: PIECE_PATH, src: pieceSrc ?? undefined, startFrame: 30, frames: 30 }],
  }
  return {
    id: 'clip-1',
    type: 'video',
    label: 'Cleaned clip',
    src: 'blob:source',
    from: 0,
    durationInFrames: 90,
    sourceStart: 0,
    sourceFps: FPS,
    speed: 1,
    shadowRemoval,
    ...extra,
  } as VideoItem
}

function plainItem(): VideoItem {
  return { ...cleanedItem(), shadowRemoval: undefined } as VideoItem
}

const options = (backend: FrameBackend, maxSamples = 1) => ({
  backend,
  maxSamples,
  mode: 'export' as const,
  projectRate: FPS,
})

describe('the index assertion', () => {
  it('throws SourceFrameMismatch when the decoder returns another frame, and frees that texture', async () => {
    const fake = fakeBackend((asked) => asked + 1)
    const provider = createSourceFrameProvider(options(fake.backend))
    const error = await provider.frameAt(plainItem(), 12).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SourceFrameMismatch)
    expect(error).toMatchObject({ requested: 12, got: 13 })
    expect((error as Error).message).toMatch(/asked 'source:blob:source' for frame 12, .* frame 13/)
    expect(fake.live()).toBe(0)
  })

  it('does not cache a wrong frame: the next ask decodes again', async () => {
    let wrong = true
    const fake = fakeBackend((asked) => (wrong ? asked - 1 : asked))
    const provider = createSourceFrameProvider(options(fake.backend))
    await expect(provider.frameAt(plainItem(), 7)).rejects.toBeInstanceOf(SourceFrameMismatch)
    wrong = false
    const frame = await provider.frameAt(plainItem(), 7)
    expect(frame.index).toBe(7)
    expect(fake.decodes).toHaveLength(2)
  })

  it('refuses an index that is not a non-negative integer', async () => {
    const provider = createSourceFrameProvider(options(fakeBackend().backend))
    await expect(provider.frameAt(plainItem(), 1.5)).rejects.toThrow(RangeError)
    await expect(provider.frameAt(plainItem(), -1)).rejects.toThrow(RangeError)
  })
})

describe('the cache', () => {
  it('N = 4 indices make 4 textures, and the overlap with the next output frame is decoded once', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider(options(fake.backend, 4))
    const item = plainItem()

    const first = await Promise.all([10, 11, 12, 13].map((i) => provider.frameAt(item, i)))
    expect(fake.textures).toHaveLength(4)
    first.forEach((frame) => provider.release(frame))

    const second = await Promise.all([12, 13, 14, 15].map((i) => provider.frameAt(item, i)))
    // 12 and 13 came from the cache: only 14 and 15 were decoded.
    expect(fake.decodes.map((d) => d.index)).toEqual([10, 11, 12, 13, 14, 15])
    expect(second[0]!.texture).toBe(first[2]!.texture)
    expect(second[1]!.texture).toBe(first[3]!.texture)
    // N + 1 = 5 at most: the oldest, frame 10, was destroyed to make room.
    expect(fake.live()).toBe(5)
    expect(fake.textures[0]!.destroyed).toBe(true)
    expect(fake.textures[1]!.destroyed).toBe(false)
  })

  it('evicts in order and never holds more than N + 1 frames over a long run', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider(options(fake.backend, 2))
    const item = plainItem()
    for (let output = 0; output < 40; output += 1) {
      const frames = await Promise.all([output, output + 1].map((i) => provider.frameAt(item, i)))
      expect(fake.live()).toBeLessThanOrEqual(3)
      frames.forEach((frame) => provider.release(frame))
    }
    expect(fake.live()).toBe(3)
    // Frame n is decoded once: 41 decodes for frames 0..40, not 80.
    expect(fake.decodes).toHaveLength(41)
  })

  it('fails loudly when a caller holds more frames than the cache can keep', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider(options(fake.backend, 1))
    const item = plainItem()
    await provider.frameAt(item, 0)
    await provider.frameAt(item, 1)
    await expect(provider.frameAt(item, 2)).rejects.toThrow(/all 2 cached frames are held/)
    expect(fake.decodes).toHaveLength(2)
  })

  it('serves one frame to two callers at once with one decode', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider(options(fake.backend, 2))
    const [a, b] = await Promise.all([
      provider.frameAt(plainItem(), 5),
      provider.frameAt(plainItem(), 5),
    ])
    expect(fake.decodes).toHaveLength(1)
    expect(a.texture).toBe(b.texture)
    provider.release(a)
    provider.release(b)
    provider.release(b) // a second release of the same frame changes nothing
  })

  it('hands the frame out with its own index, size and the backend as origin', async () => {
    const provider = createSourceFrameProvider(options(fakeBackend().backend))
    const frame = await provider.frameAt(plainItem(), 3)
    expect(frame).toMatchObject({ index: 3, width: 64, height: 36, origin: 'webcodecs' })
  })

  it('destroys every texture and the backend', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider(options(fake.backend, 3))
    await provider.frameAt(plainItem(), 1)
    await provider.frameAt(plainItem(), 2)
    provider.destroy()
    expect(fake.live()).toBe(0)
    expect(fake.isDestroyed()).toBe(true)
    await expect(provider.frameAt(plainItem(), 3)).rejects.toThrow(/destroyed/)
  })
})

describe('the shadow piece as a source of frames', () => {
  it('reads the piece exactly inside the cleaned range and the source outside it, at both edges', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider(options(fake.backend, 4))
    const item = cleanedItem()
    const frames = []
    for (const index of [29, 30, 59, 60]) frames.push(await provider.frameAt(item, index))

    expect(fake.decodes).toEqual([
      { file: 'source:blob:source', index: 29 },
      { file: `piece:${PIECE_PATH}`, index: 0 },
      { file: `piece:${PIECE_PATH}`, index: 29 },
      { file: 'source:blob:source', index: 60 },
    ])
    expect(frames.map((frame) => frame.origin)).toEqual(['webcodecs', 'piece', 'piece', 'webcodecs'])
    // Stages see the source's index whichever file answered.
    expect(frames.map((frame) => frame.index)).toEqual([29, 30, 59, 60])
  })

  it('does the same through the clip mapping, on a trimmed clip and on a reversed one', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider(options(fake.backend, 4))
    const read = async (item: VideoItem, clipFrames: number[]) => {
      const out: string[] = []
      for (const clipFrame of clipFrames) {
        const { frame: sourceIndex } = clipSourcePosition(item, clipFrame, FPS)
        const frame = await provider.frameAt(item, sourceIndex)
        out.push(`${sourceIndex}:${frame.origin}`)
        provider.release(frame)
      }
      return out
    }
    // Trimmed at source frame 20: clip frame 9 is source 29, 10 is 30, 39 is 59, 40 is 60.
    expect(await read(cleanedItem({ sourceStart: 20 }), [9, 10, 39, 40])).toEqual([
      '29:webcodecs',
      '30:piece',
      '59:piece',
      '60:webcodecs',
    ])
    // Reversed from source frame 89: clip frame 29 is source 60, 30 is 59, 59 is 30, 60 is 29.
    expect(
      await read(cleanedItem({ isReversed: true, sourceStart: 0, sourceEnd: 90 }), [29, 30, 59, 60]),
    ).toEqual(['60:webcodecs', '59:piece', '30:piece', '29:webcodecs'])
  })

  it('keeps a piece frame and the source frame of the same index apart in the cache', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider(options(fake.backend, 4))
    const cleaned = await provider.frameAt(cleanedItem(), 30)
    const other = { ...plainItem(), id: 'clip-2' } as VideoItem
    const original = await provider.frameAt(other, 30)
    expect(cleaned.texture).not.toBe(original.texture)
    expect(cleaned.origin).toBe('piece')
    expect(original.origin).toBe('webcodecs')
  })

  it('checks the index of a piece against the piece frame, not the source frame', async () => {
    // The piece's decoder answers frame 31 for the piece frame 1 it was asked for.
    const fake = fakeBackend((asked) => asked + 30)
    const provider = createSourceFrameProvider(options(fake.backend, 4))
    const error = await provider.frameAt(cleanedItem(), 31).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SourceFrameMismatch)
    expect(error).toMatchObject({ requested: 1, got: 31 })
  })

  it('refuses a piece without a file in an export and reads the source in a preview', async () => {
    const missing = cleanedItem({}, null)
    const exportProvider = createSourceFrameProvider(options(fakeBackend().backend, 2))
    const error = await exportProvider.frameAt(missing, 45).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ShadowPieceUnavailable)
    expect((error as Error).message).toMatch(/Cleaned clip.*30_30\.mp4/)

    const fake = fakeBackend()
    const preview = createSourceFrameProvider({ ...options(fake.backend, 2), mode: 'preview' })
    const frame = await preview.frameAt(missing, 45)
    expect(frame.origin).toBe('webcodecs')
    expect(fake.decodes).toEqual([{ file: 'source:blob:source', index: 45 }])
  })

  it('counts a piece at the source rate: a clip without sourceFps uses the project rate', async () => {
    const rates: number[] = []
    const fake = fakeBackend()
    const backend: FrameBackend = {
      ...fake.backend,
      decode(file, index) {
        rates.push(file.rate.num / file.rate.den)
        return fake.backend.decode(file, index)
      },
    }
    const provider = createSourceFrameProvider({ ...options(backend, 2), projectRate: 60 })
    await provider.frameAt(cleanedItem({ sourceFps: undefined }), 10)
    await provider.frameAt(cleanedItem({ sourceFps: 24 }), 40)
    expect(rates).toEqual([60, 24])
  })
})

describe('a preview’s reduced frames (design 8.10)', () => {
  const quarter = (natural: { width: number; height: number }) => ({ width: natural.width / 4, height: natural.height / 4 })

  it('asks the backend for the reduced size once it knows the file’s size, and says the file’s size', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider({ ...options(fake.backend, 2), mode: 'preview' })
    const item = plainItem()

    const first = await provider.frameAt(item, 0, quarter)
    provider.release(first)
    const second = await provider.frameAt(item, 1, quarter)

    // The first frame teaches the file's size; the next ones come reduced
    expect(fake.sizes).toEqual([undefined, { width: 16, height: 9 }])
    expect(first).toMatchObject({ width: 64, height: 36 })
    expect(first.natural).toBeUndefined()
    expect(second).toMatchObject({ width: 16, height: 9, natural: { width: 64, height: 36 } })
  })

  it('keeps a reduced frame apart from the same frame at another size', async () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider({ ...options(fake.backend, 3), mode: 'preview' })
    const item = plainItem()
    provider.release(await provider.frameAt(item, 0))
    const reduced = await provider.frameAt(item, 0, quarter)
    const full = await provider.frameAt(item, 0)

    expect(fake.decodes.map((decode) => decode.index)).toEqual([0, 0])
    expect(reduced).toMatchObject({ width: 16, height: 9 })
    expect(full).toMatchObject({ width: 64, height: 36 })
    // ... and finds each again in the cache
    provider.release(reduced)
    expect(await provider.frameAt(item, 0, quarter)).toMatchObject({ width: 16, height: 9 })
    expect(fake.decodes).toHaveLength(2)
  })

  it('asks for no reduced size in an export, nor for a reduction that reduces nothing', async () => {
    const fake = fakeBackend()
    const exporting = createSourceFrameProvider(options(fake.backend, 2))
    exporting.release(await exporting.frameAt(plainItem(), 0, quarter))
    exporting.release(await exporting.frameAt(plainItem(), 1, quarter))
    const preview = createSourceFrameProvider({ ...options(fake.backend, 2), mode: 'preview' })
    preview.release(await preview.frameAt(plainItem(), 0, (natural) => natural))
    preview.release(await preview.frameAt(plainItem(), 1, (natural) => natural))

    expect(fake.sizes).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('lookahead', () => {
  it('tells the backend which frames of each file are coming, a piece apart from the source', () => {
    const fake = fakeBackend()
    const provider = createSourceFrameProvider(options(fake.backend, 2))
    provider.lookahead(cleanedItem(), [28, 29, 30, 31])
    expect(fake.prefetches).toEqual([
      { file: 'source:blob:source', indices: [28, 29] },
      { file: `piece:${PIECE_PATH}`, indices: [0, 1] },
    ])
  })

  it('never throws, also for a piece that cannot be read in an export', () => {
    const provider = createSourceFrameProvider(options(fakeBackend().backend, 2))
    expect(() => provider.lookahead(cleanedItem({}, null), [40, 41])).not.toThrow()
  })
})

describe('the native decoder (the backend choice)', () => {
  /** A backend like `fakeBackend` that says it is the native one. */
  function nativeFake() {
    const fake = fakeBackend()
    return { ...fake, backend: { ...fake.backend, origin: 'native' as const } }
  }

  it('reads a clip whose file is on disk through the native backend, and says so', async () => {
    const webcodecs = fakeBackend()
    const native = nativeFake()
    const provider = createSourceFrameProvider({ ...options(webcodecs.backend), native: native.backend })
    const item = { ...plainItem(), src: '/Volumes/Media/DJI_0020.MP4' } as VideoItem
    const frame = await provider.frameAt(item, 5)
    expect(frame.origin).toBe('native')
    expect(native.decodes).toEqual([{ file: 'source:/Volumes/Media/DJI_0020.MP4', index: 5 }])
    expect(webcodecs.decodes).toEqual([])
  })

  it('reads a clip whose source is a URL through the other backend', async () => {
    const webcodecs = fakeBackend()
    const native = nativeFake()
    const provider = createSourceFrameProvider({ ...options(webcodecs.backend), native: native.backend })
    const frame = await provider.frameAt(plainItem(), 5)
    expect(frame.origin).toBe('webcodecs')
    expect(webcodecs.decodes).toEqual([{ file: 'source:blob:source', index: 5 }])
    expect(native.decodes).toEqual([])
  })

  it('without a native backend reads every file through the one it was given', async () => {
    const webcodecs = fakeBackend()
    const provider = createSourceFrameProvider({ ...options(webcodecs.backend), native: null })
    const item = { ...plainItem(), src: '/Volumes/Media/DJI_0020.MP4' } as VideoItem
    expect((await provider.frameAt(item, 1)).origin).toBe('webcodecs')
  })

  it('checks the native frame’s index too, and destroys both backends', async () => {
    const webcodecs = fakeBackend()
    const native = fakeBackend((asked) => asked + 1)
    const provider = createSourceFrameProvider({
      ...options(webcodecs.backend),
      native: { ...native.backend, origin: 'native' },
    })
    const item = { ...plainItem(), src: 'C:\\Media\\DJI_0020.MP4' } as VideoItem
    await expect(provider.frameAt(item, 3)).rejects.toBeInstanceOf(SourceFrameMismatch)
    provider.destroy()
    expect(webcodecs.isDestroyed()).toBe(true)
    expect(native.isDestroyed()).toBe(true)
  })

  it('tells a path on disk from a URL', () => {
    expect(isFilePath('/Volumes/Media/a.mp4')).toBe(true)
    expect(isFilePath('C:\\Media\\a.mp4')).toBe(true)
    expect(isFilePath('D:/Media/a.mp4')).toBe(true)
    expect(isFilePath('blob:droneclean://app/1234')).toBe(false)
    expect(isFilePath('droneclean://app/__media/abc')).toBe(false)
    expect(isFilePath('media/media-1/shadow/30_30.mp4')).toBe(false)
  })
})
