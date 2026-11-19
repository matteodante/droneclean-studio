// The source-frame provider (design 3.6 section 2.4): the frames a render's stages read, one owner per render. It
// answers "source frame n of this clip" with an `rgba16float` texture at the file's size, from whichever file holds
// that frame (the source, or a cleaned piece, `shadow/frame-source.ts`), through a backend that decodes it. The
// index the backend decoded is checked against the one asked for, so a wrong frame is a thrown error and never a
// quietly stabilized neighbour; a small cache holds the frames one output frame needs and the overlap with its
// neighbours, so each is decoded once. On the desktop an export reads every file that has a path on disk through the
// native decoder (FFmpeg, 10 bits all the way, `backends/native.ts`) and anything else through `backend`.

import { shadowFrameRead } from '@/studio/shadow/frame-source'
import { toRate, type Rate } from '@/studio/time'
import type { VideoItem } from '@/types/timeline'
import { StageError } from '@/studio/render/stages/types'
import { sourceColourProblem } from './colour-check'
import { FrameLru } from './lru'
import {
  ShadowPieceUnavailable,
  SourceFrameMismatch,
  type BackendFrame,
  type FrameBackend,
  type FrameFile,
  type SourceFrame,
  type SourceFrameOrigin,
  type SourceFrameProvider,
} from './types'

/** What a provider is made of. */
export interface SourceFrameProviderOptions {
  readonly backend: FrameBackend
  /**
   * The desktop's native decoder (`nativeBackendFor`), when this render has one: a file whose `path` is on disk is read
   * through it, every other file (a blob URL, the web) through `backend`.
   */
  readonly native?: FrameBackend | null
  /** The most source frames one output frame is made of (N): 1 with motion blur off. */
  readonly maxSamples: number
  /**
   * How many frames the cache holds. Default `maxSamples + 1`: the frames of one output frame and one more, the
   * overlap with the next. A caller must `release` the frames of an output frame before asking for the next one's
   * beyond this.
   */
  readonly capacity?: number
  /** An export refuses a cleaned piece whose file is not open; a preview reads the source there instead. */
  readonly mode: 'export' | 'preview'
  /** The project's rate: the rate of a clip with no `sourceFps`. */
  readonly projectRate: Rate | number
  /** The file the item's own picture is read from; the item's `src`, both as URL and as path, by default. */
  readonly sourceFile?: (item: VideoItem, rate: Rate) => FrameFile
}

/** What the cache holds: the texture, its size and what answered. */
interface CachedFrame {
  readonly texture: GPUTexture
  readonly width: number
  readonly height: number
  readonly origin: SourceFrameOrigin
}

/** Whether `path` names a file on disk (the native decoder opens only those), not a URL. */
export function isFilePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function defaultSourceFile(item: VideoItem, rate: Rate): FrameFile {
  return { key: `source:${item.src}`, src: item.src, path: item.src, rate }
}

/** Which file frame `sourceIndex` of the item's picture is, and which frame of it. */
interface Located {
  readonly file: FrameFile
  readonly fileIndex: number
  /** The backend that decodes this file. */
  readonly backend: FrameBackend
  readonly origin: SourceFrameOrigin
  /** The clip's name as the pilot sees it, for a refusal. */
  readonly clip: string
}

/** Creates the provider of one renderer instance. */
export function createSourceFrameProvider(options: SourceFrameProviderOptions): SourceFrameProvider {
  const { backend, mode } = options
  const native = options.native ?? null
  /** The backend a file is read through: the native decoder for a file on disk, when there is one. */
  const backendFor = (file: FrameFile): FrameBackend =>
    native !== null && isFilePath(file.path) ? native : backend
  if (!Number.isInteger(options.maxSamples) || options.maxSamples < 1) {
    throw new RangeError(`source frames: maxSamples must be a positive integer, got ${options.maxSamples}`)
  }
  const projectRate = toRate(options.projectRate)
  const sourceFileOf = options.sourceFile ?? defaultSourceFile
  const lru = new FrameLru<CachedFrame>(
    options.capacity ?? options.maxSamples + 1,
    (frame) => frame.texture.destroy(),
  )
  /** The key each handed-out frame holds, so `release` lets go of the right entry, once. */
  const held = new WeakMap<SourceFrame, string>()
  /** Decodes run one after another: a stream backend is a cursor, and two asks at once would fight over it. */
  let tail: Promise<unknown> = Promise.resolve()
  let destroyed = false
  /** Each source file's colour verdict, asked of the first frame decoded from it: a message, or null when it is fine. */
  const colourVerdicts = new Map<string, string | null>()

  const locate = (item: VideoItem, sourceIndex: number): Located => {
    const rate = item.sourceFps === undefined ? projectRate : toRate(item.sourceFps)
    const read = shadowFrameRead(item, sourceIndex)
    if (read.kind === 'piece') {
      const file = { key: `piece:${read.path}`, src: read.src, path: read.path, rate }
      return {
        file,
        fileIndex: read.pieceFrame,
        backend: backendFor(file),
        origin: 'piece',
        clip: item.label || item.id,
      }
    }
    if (read.kind === 'missing' && mode === 'export') {
      throw new ShadowPieceUnavailable({ clip: item.label || item.id, path: read.path })
    }
    const file = sourceFileOf(item, rate)
    const chosen = backendFor(file)
    return {
      file,
      fileIndex: sourceIndex,
      backend: chosen,
      origin: chosen.origin,
      clip: item.label || item.id,
    }
  }

  /** Throws a `StageError` when the pilot's own file is not BT.709; a cleaned piece is our own encode, already checked. */
  const refuseNonBt709 = (located: Located, decoded: BackendFrame, sourceIndex: number): void => {
    if (located.origin === 'piece') return
    if (!colourVerdicts.has(located.file.key)) {
      colourVerdicts.set(located.file.key, sourceColourProblem(decoded.colour))
    }
    const problem = colourVerdicts.get(located.file.key)
    if (problem === null || problem === undefined) return
    decoded.texture.destroy()
    throw new StageError({ clip: located.clip, stage: 'input-colour', sourceIndex, reason: problem })
  }

  const handOut = (key: string, sourceIndex: number, cached: CachedFrame): SourceFrame => {
    const frame: SourceFrame = {
      texture: cached.texture,
      index: sourceIndex,
      width: cached.width,
      height: cached.height,
      origin: cached.origin,
    }
    held.set(frame, key)
    return frame
  }

  const decodeInto = async (
    key: string,
    located: Located,
    sourceIndex: number,
  ): Promise<SourceFrame> => {
    if (destroyed) throw new Error('source frames: the provider is destroyed')
    const hit = lru.acquire(key)
    if (hit !== undefined) return handOut(key, sourceIndex, hit)
    // Fail before decoding when nothing can be evicted: a decoded frame has nowhere to go.
    if (!lru.hasRoom()) {
      throw new Error(
        `source frames: all ${lru.capacity} cached frames are held; release the frames of the last output frame first`,
      )
    }
    const decoded: BackendFrame = await located.backend.decode(located.file, located.fileIndex)
    if (decoded.index !== located.fileIndex) {
      decoded.texture.destroy()
      throw new SourceFrameMismatch({
        file: located.file.key,
        requested: located.fileIndex,
        got: decoded.index,
      })
    }
    if (destroyed) {
      decoded.texture.destroy()
      throw new Error('source frames: the provider was destroyed while a frame was decoding')
    }
    refuseNonBt709(located, decoded, sourceIndex)
    const cached: CachedFrame = {
      texture: decoded.texture,
      width: decoded.width,
      height: decoded.height,
      origin: located.origin,
    }
    try {
      lru.insert(key, cached)
    } catch (error) {
      decoded.texture.destroy()
      throw error
    }
    return handOut(key, sourceIndex, cached)
  }

  return {
    frameAt(item, sourceIndex) {
      if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0) {
        return Promise.reject(
          new RangeError(`source frames: the index must be a non-negative integer, got ${sourceIndex}`),
        )
      }
      let located: Located
      try {
        located = locate(item, sourceIndex)
      } catch (error) {
        return Promise.reject(error)
      }
      const key = `${located.file.key}#${located.fileIndex}`
      // A cached frame needs no turn in the queue.
      const hit = destroyed ? undefined : lru.acquire(key)
      if (hit !== undefined) return Promise.resolve(handOut(key, sourceIndex, hit))
      const run = tail.then(() => decodeInto(key, located, sourceIndex))
      tail = run.catch(() => {})
      return run
    },

    lookahead(item, indices) {
      if (destroyed) return
      const byFile = new Map<string, { file: FrameFile; backend: FrameBackend; indices: number[] }>()
      for (const sourceIndex of indices) {
        if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0) continue
        let located: Located
        try {
          located = locate(item, sourceIndex)
        } catch {
          // A frame that cannot be read fails when it is asked for, with its own error.
          continue
        }
        const group = byFile.get(located.file.key) ?? {
          file: located.file,
          backend: located.backend,
          indices: [],
        }
        group.indices.push(located.fileIndex)
        byFile.set(located.file.key, group)
      }
      for (const { file, backend: chosen, indices: fileIndices } of byFile.values()) {
        chosen.prefetch?.(file, fileIndices)
      }
    },

    release(frame) {
      const key = held.get(frame)
      if (key === undefined) return
      held.delete(frame)
      lru.release(key)
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      lru.clear()
      backend.destroy()
      native?.destroy()
    },
  }
}
