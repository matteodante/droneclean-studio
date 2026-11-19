// The native decoder's backend (design 3.6 sections 2.4 and 2.16, plan task 8.4): on the desktop, the shell's FFmpeg
// decodes a file in order and sends each frame as `p010le` (`render/precise/native-source.ts`); the backend converts it
// on the GPU straight into a texture of the provider's own (`render/precise/p010-in.ts`), so a source frame crosses
// the pipe and the page at 3 bytes a pixel and never touches an 8-bit step. A source the shell cannot send as `p010le`
// arrives as `gbrp10le` and goes through P3's source pass and a blit instead.
//
// A decode is a stream, not a lookup: asking for the frame after the last one costs nothing, a short jump forwards
// reads and drops the frames in between (cheaper than a new FFmpeg), and anything else starts a new decode at the frame
// asked for. At most `NATIVE_MAX_STREAMS` decodes are open at once, any files (the shell allows a window two): a cut
// or a transition between two places of one file keeps both streams, and the least recently used one is closed when a
// third is needed.
//
// Memory: the decodes share one pool of frame slots (allocated once, `createFrameSlotPool`), each source size has one
// conversion pass, and the only allocation per frame is the texture the provider keeps and destroys.

import { frameToSeconds, ratesEqual, toRate, type Rate } from '@/studio/time'
import { nativeExportSession } from '@/studio/render/precise/native-session'
import { SourceError } from '@/studio/render/source-error'
import type { VideoItem } from '@/types/timeline'
import { createP010InPass, type P010InPass } from '@/studio/render/precise/p010-in'
import { createSourcePass, type SourcePass } from '@/studio/render/precise/source-pass'
import {
  createFrameSlotPool,
  startNativeSource,
  type FrameSlotPool,
  type NativeMediaBridge,
  type NativeRawFrame,
  type NativeSource,
  type NativeSourceOptions,
} from '@/studio/render/precise/native-source'
import { blitToSourceFrame, sourceFrameTextureDescriptor } from '../blit'
import { isFilePath } from '../provider'
import type { BackendFrame, FrameBackend, FrameFile } from '../types'

/**
 * Frames asked of the shell per decode: to the end of the file in practice. FFmpeg stops at the end of the file
 * either way, and a decode nobody reads waits on its full ring, costing nothing but its buffers until it is closed.
 */
export const NATIVE_RUN_FRAMES = 1 << 20

/** The most frames a forward jump reads and drops before the backend starts a new decode instead. */
export const NATIVE_SKIP_LIMIT = 16

/** Decodes open at once: the shell's limit per window (`MAX_JOBS_PER_WINDOW`). */
export const NATIVE_MAX_STREAMS = 2

/** What the backend needs to start a decode; the real one is `startNativeSource`. */
export type StartNativeSource = (options: NativeSourceOptions) => Promise<NativeSource>

/** Writes one frame's bytes into a texture of the provider's. */
type Converter = (bytes: Uint8Array, target: GPUTexture) => void

interface Stream {
  readonly key: string
  readonly source: NativeSource
  readonly frames: AsyncIterator<NativeRawFrame>
  readonly convert: Converter
  /** The index the next frame read yields. */
  next: number
  /** Whether the shell ran out of frames. */
  done: boolean
  /** When it was last read, for closing the least recently used. */
  used: number
}

/** What a native backend is built with; every field has the page's default. */
export interface NativeBackendOptions {
  /** Starts a decode; `startNativeSource`, or a test's fake. */
  readonly start?: StartNativeSource
  /** The decodes' frame slots; a pool of the backend's own when absent. */
  readonly slots?: FrameSlotPool
  /**
   * The shell's decode IPC: the preload's on the page. The export worker has no preload, so the page relays
   * `startDecode` and `cancel` to it (a worker fetches the frame scheme itself).
   */
  readonly bridge?: Pick<NativeMediaBridge, 'startDecode' | 'cancel'>
}

/** What a renderer's provider is given for a native export: the backend, and the file on disk of each clip. */
export interface NativeProviderOptions {
  readonly native?: FrameBackend
  readonly sourceFile?: (item: VideoItem, rate: Rate) => FrameFile
}

/**
 * The provider options of a renderer on `device` while a native 10-bit export runs in this realm
 * (`precise/native-session.ts`): every clip's frames come from its file on disk through the shell's FFmpeg. Nothing
 * otherwise: a preview, whose frames cannot show more than 8 bits and whose seeks a new FFmpeg per jump would only slow
 * down, and an 8-bit export, which reads every file through WebCodecs as before.
 */
export function nativeProviderOptions(device: GPUDevice, mode: 'export' | 'preview'): NativeProviderOptions {
  const session = mode === 'export' ? nativeExportSession() : null
  if (session === null) return {}
  return {
    native: createNativeBackend(device, { bridge: session.bridge }),
    sourceFile: (item, rate) => {
      const path = item.mediaId === undefined ? undefined : session.paths.get(item.mediaId)
      if (path === undefined) throw new SourceError({ clip: item.label || item.id, mediaId: item.mediaId, reason: NO_FILE_PATH })
      return { key: `source:${path}`, src: item.src, path, rate }
    },
  }
}

/** Why a clip with no file on disk cannot be in a 10-bit export, in the pilot's words. */
export const NO_FILE_PATH =
  'the 10-bit export reads each clip from its file on disk, and this clip has no file path (it was copied into the ' +
  'workspace or imported in a browser). Import the original file into the desktop app and export again.'

/** Builds the backend on the shell's decoder. */
export function createNativeBackend(
  device: GPUDevice,
  options: NativeBackendOptions = {},
): FrameBackend {
  const start = options.start ?? startNativeSource
  const streams: Stream[] = []
  const slots = options.slots ?? createFrameSlotPool()
  /** One conversion per source size and colour, shared by the streams (each frame is converted and submitted alone). */
  const passes = new Map<string, { convert: Converter; destroy(): void }>()
  let clock = 0
  let destroyed = false

  const close = (stream: Stream): void => {
    const at = streams.indexOf(stream)
    if (at >= 0) streams.splice(at, 1)
    void stream.frames.return?.()
    stream.source.destroy()
  }

  const converterFor = (source: NativeSource): Converter => {
    const { width, height, colour, format } = source
    const key = `${format}:${width}x${height}:${colour.matrix}:${colour.range}`
    let pass = passes.get(key)
    if (pass === undefined) {
      if (format === 'p010le') {
        const p010: P010InPass = createP010InPass(device, { width, height, colour })
        pass = {
          convert: (bytes, target) => p010.convert(bytes, target),
          destroy: () => p010.destroy(),
        }
      } else {
        const gbrp: SourcePass = createSourcePass(device, { width, height, colour })
        let index = 0
        pass = {
          convert(bytes, target) {
            const frame = gbrp.uploadFrame(bytes, {
              index,
              rate: source.reply.rate,
              durationFrames: 1,
            })
            index += 1
            blitToSourceFrame(device, frame.texture, target)
          },
          destroy: () => gbrp.destroy(),
        }
      }
      passes.set(key, pass)
    }
    return pass.convert
  }

  const open = async (file: FrameFile, index: number): Promise<Stream> => {
    // Half a frame early: FFmpeg keeps the frames from `-ss` on, and a start exactly on a frame's time could land a
    // rounding error after it and skip it.
    const startSeconds = index === 0 ? 0 : frameToSeconds(file.rate, index - 0.5)
    const source = await start({
      device,
      file: file.path,
      startSeconds,
      startIndex: index,
      frames: NATIVE_RUN_FRAMES,
      slots,
      bridge: options.bridge,
    })
    if (!ratesEqual(toRate(source.reply.rate), file.rate)) {
      source.destroy()
      throw new Error(
        `native decoder: '${file.key}' runs at ${source.reply.rate.num}/${source.reply.rate.den} fps, ` +
          `the clip counts its frames at ${file.rate.num}/${file.rate.den}`,
      )
    }
    return {
      key: file.key,
      source,
      frames: source.raw(),
      convert: converterFor(source),
      next: index,
      done: false,
      used: clock,
    }
  }

  /** Whether `index` is the stream's next frame or a short hop ahead of it. */
  const reaches = (stream: Stream, file: FrameFile, index: number): boolean =>
    stream.key === file.key &&
    !stream.done &&
    index >= stream.next &&
    index - stream.next <= NATIVE_SKIP_LIMIT

  /** The open decode that reaches `index`, or a new one at it (closing the least recently used one if need be). */
  const streamFor = async (file: FrameFile, index: number): Promise<Stream> => {
    const existing = streams.find((stream) => reaches(stream, file, index))
    if (existing !== undefined) return existing
    while (streams.length >= NATIVE_MAX_STREAMS) {
      const oldest = streams.reduce((a, b) => (b.used < a.used ? b : a))
      close(oldest)
    }
    const opened = await open(file, index)
    streams.push(opened)
    return opened
  }

  /** Reads the stream forward to frame `index`, dropping the frames before it. */
  const readUpTo = async (
    stream: Stream,
    file: FrameFile,
    index: number,
  ): Promise<NativeRawFrame> => {
    for (;;) {
      const step = await stream.frames.next()
      if (step.done === true) {
        stream.done = true
        throw new Error(`native decoder: '${file.key}' ended before frame ${index}`)
      }
      stream.next = step.value.frame.index + 1
      if (step.value.frame.index >= index) return step.value
    }
  }

  return {
    origin: 'native',

    async decode(file, index): Promise<BackendFrame> {
      if (destroyed) throw new Error('native decoder: the backend is destroyed')
      if (!isFilePath(file.path)) {
        throw new Error(
          `native decoder: '${file.key}' has no file path the shell can open (${file.path})`,
        )
      }
      const stream = await streamFor(file, index)
      clock += 1
      stream.used = clock
      const raw = await readUpTo(stream, file, index)
      const { width, height } = stream.source
      const texture = device.createTexture(sourceFrameTextureDescriptor(width, height))
      stream.convert(raw.bytes, texture)
      return { texture, index: raw.frame.index, width, height, colour: stream.source.colour }
    },

    destroy() {
      destroyed = true
      for (const stream of [...streams]) close(stream)
      for (const pass of passes.values()) pass.destroy()
      passes.clear()
    },
  }
}
