// The source-frame provider's meeting points (design 3.6 section 2.4, slice 3): what a stage is handed, and what a
// backend must give back. The provider (`provider.ts`) owns the cache, the index check and the shadow-piece swap;
// a backend only decodes "frame `index` of this file" into a texture.

import type { Rate } from '@/studio/time'
import type { SourceColourReport } from './colour-check'
import type { VideoItem } from '@/types/timeline'

/** Which decoder answered: a backend's own name, or `piece` when the frame came out of a cleaned piece's file. */
export type SourceFrameOrigin = 'native' | 'webcodecs' | 'piece' | 'raw-test'

/** The origins a backend can report; `piece` is the provider's, decided by the shadow record. */
export type BackendOrigin = Exclude<SourceFrameOrigin, 'piece'>

/**
 * One source frame as a stage reads it: an `rgba16float` texture at the file's size, or, for a preview that asked for
 * it (`frameAt`'s `reduce`), at the reduced size, with the file's size as `natural`. `index` is the integer source
 * frame the stage asked for, also when the pixels came out of a piece's file (a piece has the source's size and frame
 * times, so stages see one index whichever file answered). The texture belongs to the provider: do not destroy it,
 * and hand the frame back with `release` once the output frame that needs it is recorded.
 */
export interface SourceFrame {
  readonly texture: GPUTexture
  readonly index: number
  readonly width: number
  readonly height: number
  readonly origin: SourceFrameOrigin
  /** The file's own size, when the texture is a reduced one (design 8.10); absent, the texture is at the file's size */
  readonly natural?: { readonly width: number; readonly height: number }
}

/**
 * How a preview wants a frame reduced (design 8.10): the reduced size of a frame of the file's size `natural`. The
 * provider asks it once it knows the file's size, and a backend that can upload straight to that size does.
 */
export type FrameReduction = (natural: { width: number; height: number }) => { width: number; height: number }

/** One owner per render: the preview engine and the export renderer each create their own and destroy it at the end. */
export interface SourceFrameProvider {
  /**
   * The `rgba16float` texture of source frame `sourceIndex` of the item's picture, index asserted. With `reduce`, a
   * preview's frame may come at the reduced size (with `natural`); it may also come at the file's size, from the first
   * frame of a file or from a backend that cannot reduce, and the caller reduces it then.
   */
  frameAt(item: VideoItem, sourceIndex: number, reduce?: FrameReduction): Promise<SourceFrame>
  /** The export's plan, for prefetch: source frames the next output frames will ask for. Never throws, never waits. */
  lookahead(item: VideoItem, indices: Iterable<number>): void
  /** Gives a frame back. The texture stays cached until it is the least recently used and a newer frame needs room. */
  release(frame: SourceFrame): void
  /** Destroys every texture and the backend. */
  destroy(): void
}

/** A file a backend reads: the source of the clip, or a cleaned piece. */
export interface FrameFile {
  /** Names the file in the cache and in the backend's open decoders. */
  readonly key: string
  /** The URL a browser decoder opens (a blob URL for a workspace file). */
  readonly src: string
  /** The path a native decoder opens. */
  readonly path: string
  /** The file's frame rate: frame `n` is at `n / rate` seconds. */
  readonly rate: Rate
}

/** A decoded frame a backend hands over. The caller owns `texture` from then on and destroys it when done. */
export interface BackendFrame {
  readonly texture: GPUTexture
  /** The frame the decoder says it decoded, counted from the file's first frame. The provider checks it. */
  readonly index: number
  readonly width: number
  readonly height: number
  /** The decoded frame's own size, when the texture is a reduced one (`DecodeOptions.size`) */
  readonly natural?: { readonly width: number; readonly height: number }
  /** The colour tags the file carries, when the decoder knows them; the provider refuses a source that is not BT.709. */
  readonly colour?: SourceColourReport
}

/** What a decode is for. */
export interface DecodeOptions {
  /**
   * The frame goes on a preview's screen, not into an export: a backend may take a faster upload whose picture is the
   * same within the preview's tolerance (the WebCodecs backend's external texture). Exports leave it unset.
   */
  readonly preview?: boolean
  /**
   * A preview's reduced size for the frame (design 8.10), when the provider knows the file's size: a backend that can
   * upload straight to it does, and says the frame's own size as `natural`; one that cannot gives the file's size.
   */
  readonly size?: { readonly width: number; readonly height: number }
}

/** The decoder behind the provider. */
export interface FrameBackend {
  readonly origin: BackendOrigin
  /** Decodes frame `index` of `file` into a fresh `rgba16float` texture. */
  decode(file: FrameFile, index: number, options?: DecodeOptions): Promise<BackendFrame>
  /** The frames of `file` the render will ask for next, ascending when it plays forwards. A hint. */
  prefetch?(file: FrameFile, indices: readonly number[]): void
  destroy(): void
}

/** The backend decoded another frame than the one asked for: stabilization or colour would act on the wrong picture. */
export class SourceFrameMismatch extends Error {
  readonly file: string
  readonly requested: number
  readonly got: number

  constructor(init: { file: string; requested: number; got: number }) {
    super(
      `source frame mismatch: asked '${init.file}' for frame ${init.requested}, the decoder returned frame ${init.got}`,
    )
    this.name = 'SourceFrameMismatch'
    this.file = init.file
    this.requested = init.requested
    this.got = init.got
  }
}

/** A cleaned piece the render must read is recorded but its file is not open: an export refuses rather than ship uncleaned frames. */
export class ShadowPieceUnavailable extends Error {
  readonly path: string

  constructor(init: { clip: string; path: string }) {
    super(
      `Clip "${init.clip}" is missing its cleaned piece "${init.path}": the export would show the source inside a ` +
        'range that was paid to be cleaned. Restore the file, or remove the shadow removal, and export again.',
    )
    this.name = 'ShadowPieceUnavailable'
    this.path = init.path
  }
}
