// Playback from the pre-render cache (design `docs/designs/prerender-preview.md` §0.6). The preview's render pump asks,
// on every animation frame of rendered playback, for the frame the playhead is on; this module answers with a decoded
// picture, with "not yet" while a decoder is about to deliver it, or with "no" (the pump renders the frame live, as
// before). A frame is answered only while the cache holds it as valid, after the hashes are checked again when
// anything changed, so a stale picture is never shown.
//
// A WebCodecs decoder per run decodes from the key frame at or before the playhead to a few frames ahead of it, into
// a small pool of canvases at the cache's render size; frames behind the playhead are given back at once. Frames
// ahead of the playhead in the next valid run are decoded before the playhead reaches it, so entering a pre-rendered
// range while playing does not wait. Reverse playback is not served: it stays live.

import { useGizmoStore } from '@/features/preview/stores/gizmo-store'
import { prerenderCache, type CachedRun } from './cache'

/** Frames decoded ahead of the playhead */
const LOOKAHEAD_FRAMES = 8
/** Decoded pictures held at most (the playhead's, the look-ahead, and frames on their way) */
const POOL_LIMIT = 16
/** How long the player may keep the pump waiting for a picture before the pump renders the frame live */
const PENDING_LIMIT_MS = 150

type PrerenderFrameAnswer =
  | { readonly kind: 'ready'; readonly canvas: OffscreenCanvas }
  | { readonly kind: 'pending' }
  | { readonly kind: 'none' }

const NONE: PrerenderFrameAnswer = { kind: 'none' }
const PENDING: PrerenderFrameAnswer = { kind: 'pending' }

interface RunDecoder {
  readonly run: CachedRun
  readonly decoder: VideoDecoder
  /** The first frame fed since the last reset (a key frame) */
  fedFrom: number
  /** The next frame to feed */
  nextFeed: number
  /** The last frame the decoder was asked to reach: a request behind it restarts from a key frame */
  lastTarget: number
  inFlight: number
  broken: boolean
}

/** A decoded picture and the run it was decoded from (another run may hold the same frame later) */
interface DecodedPicture {
  readonly canvas: OffscreenCanvas
  readonly runId: number
}

/** Whether the preview shows the project as it is: no transient edit or grade comparison is on screen */
function previewShowsCommittedState(): boolean {
  const gizmo = useGizmoStore.getState()
  const hasLivePreview = gizmo.preview !== null && Object.keys(gizmo.preview).length > 0
  return !hasLivePreview && !gizmo.colorGradeBypassed && gizmo.colorGradeComparisonMode === 'off'
}

/** Whether the cache may serve playback at all: forward, with WebCodecs, on the committed project */
function canServe(direction: number): boolean {
  return direction >= 0 && typeof VideoDecoder !== 'undefined' && previewShowsCommittedState()
}

/** Whether any frame of `run` is still valid (its first frame may not be) */
function runStillHeld(run: CachedRun): boolean {
  return run.valid.subarray(0, run.end - run.start).includes(1)
}

class PrerenderPlayer {
  private readonly decoders = new Map<number, RunDecoder>()
  private readonly decoded = new Map<number, DecodedPicture>()
  private readonly pool: OffscreenCanvas[] = []
  private revision = -1
  private playhead = 0
  private waitingSinceMs: number | null = null

  /**
   * The picture of `frame` for rendered playback moving in `direction`. Also keeps the decoders ahead of the
   * playhead. Synchronous: it never waits on a decoder.
   */
  frameFor(frame: number, direction: number): PrerenderFrameAnswer {
    if (!canServe(direction)) {
      this.waitingSinceMs = null
      return NONE
    }
    this.sync(frame)
    const run = prerenderCache.validRunAt(frame)
    this.feedAhead(frame)
    const picture = run === null ? undefined : this.decoded.get(frame)
    if (run === null || picture?.runId === run.id) {
      this.waitingSinceMs = null
      return picture === undefined ? NONE : { kind: 'ready', canvas: picture.canvas }
    }
    return this.waitFor(run)
  }

  /** Decode the playhead's frame and the few after it while paused, so playback starts on a ready picture */
  prime(frame: number): void {
    if (typeof VideoDecoder === 'undefined') return
    this.sync(frame)
    this.feedAhead(frame)
  }

  /** Give back every decoder and picture */
  reset(): void {
    for (const entry of this.decoders.values()) this.closeDecoder(entry)
    this.decoders.clear()
    for (const picture of this.decoded.values()) this.pool.push(picture.canvas)
    this.decoded.clear()
    this.pool.length = Math.min(this.pool.length, POOL_LIMIT)
    this.waitingSinceMs = null
  }

  /** "Not yet" while the run's decoder is healthy and has not kept the pump waiting too long; "no" otherwise */
  private waitFor(run: CachedRun): PrerenderFrameAnswer {
    const decoder = this.decoders.get(run.id)
    if (decoder === undefined || decoder.broken) return NONE
    const now = performance.now()
    this.waitingSinceMs ??= now
    return now - this.waitingSinceMs <= PENDING_LIMIT_MS ? PENDING : NONE
  }

  /** Follow the cache's revision and the playhead: drop what no longer belongs */
  private sync(frame: number): void {
    const revision = prerenderCache.currentRevision
    if (revision !== this.revision) {
      this.revision = revision
      this.dropStale()
    }
    this.playhead = frame
    for (const held of [...this.decoded.keys()]) {
      if (held < frame || held > frame + LOOKAHEAD_FRAMES * 2) this.release(held)
    }
  }

  /** Close the decoders of runs the cache dropped, and give back pictures no valid run holds any more */
  private dropStale(): void {
    prerenderCache.ensureFresh()
    for (const [runId, entry] of this.decoders) {
      if (prerenderCache.holds(entry.run) && runStillHeld(entry.run)) continue
      this.closeDecoder(entry)
      this.decoders.delete(runId)
    }
    for (const [held, picture] of [...this.decoded]) {
      if (prerenderCache.validRunAt(held)?.id !== picture.runId) this.release(held)
    }
  }

  private release(frame: number): void {
    const picture = this.decoded.get(frame)
    if (picture === undefined) return
    this.decoded.delete(frame)
    if (this.pool.length < POOL_LIMIT) this.pool.push(picture.canvas)
  }

  /** Feed every valid run that holds a frame of the look-ahead window */
  private feedAhead(frame: number): void {
    const fedRuns = new Set<number>()
    for (let target = frame; target <= frame + LOOKAHEAD_FRAMES; target += 1) {
      const run = prerenderCache.validRunAt(target)
      if (run === null || fedRuns.has(run.id)) continue
      fedRuns.add(run.id)
      const entry = this.decoderFor(run)
      if (entry === null) continue
      this.align(entry, target)
      this.pump(entry, Math.min(run.end, frame + LOOKAHEAD_FRAMES + 1))
    }
  }

  /** The run's decoder, created on first use; `null` when it cannot be made or has failed */
  private decoderFor(run: CachedRun): RunDecoder | null {
    let entry = this.decoders.get(run.id)
    if (entry === undefined) {
      const created = this.createDecoder(run)
      if (created === null) return null
      entry = created
      this.decoders.set(run.id, entry)
    }
    return entry.broken ? null : entry
  }

  /**
   * Restart the decoder at the key frame before `target` when what it was fed cannot reach `target`: the playhead
   * went back, jumped a group of pictures ahead, or the next chunk was freed.
   */
  private align(entry: RunDecoder, target: number): void {
    const { run } = entry
    const keyFrame =
      run.start + Math.floor((target - run.start) / run.keyInterval) * run.keyInterval
    const fresh = entry.nextFeed === entry.fedFrom
    const unreachable =
      target < entry.lastTarget ||
      target - entry.nextFeed >= run.keyInterval ||
      (entry.nextFeed < run.end && run.chunks[entry.nextFeed - run.start] === null)
    if (fresh ? entry.fedFrom !== keyFrame : unreachable) this.restart(entry, keyFrame)
    entry.lastTarget = target
  }

  /** Feed chunks up to (not including) `until`, while the pool and the decoder's queue have room */
  private pump(entry: RunDecoder, until: number): void {
    const { run, decoder } = entry
    while (
      entry.nextFeed < until &&
      entry.inFlight + this.decoded.size < POOL_LIMIT &&
      decoder.decodeQueueSize < LOOKAHEAD_FRAMES
    ) {
      const chunk = run.chunks[entry.nextFeed - run.start]
      if (chunk === null || chunk === undefined) return
      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: chunk.key ? 'key' : 'delta',
            timestamp: entry.nextFeed,
            data: chunk.data,
          }),
        )
      } catch {
        this.fail(entry)
        return
      }
      entry.nextFeed += 1
      entry.inFlight += 1
    }
  }

  private restart(entry: RunDecoder, keyFrame: number): void {
    try {
      entry.decoder.reset()
      entry.decoder.configure(entry.run.decoder)
    } catch {
      this.fail(entry)
      return
    }
    entry.fedFrom = keyFrame
    entry.nextFeed = keyFrame
    entry.inFlight = 0
  }

  private createDecoder(run: CachedRun): RunDecoder | null {
    const entry: RunDecoder = {
      run,
      decoder: new VideoDecoder({
        output: (videoFrame) => this.accept(entry, videoFrame),
        error: () => this.fail(entry),
      }),
      fedFrom: run.start,
      nextFeed: run.start,
      lastTarget: run.start,
      inFlight: 0,
      broken: false,
    }
    try {
      entry.decoder.configure(run.decoder)
    } catch {
      return null
    }
    return entry
  }

  private accept(entry: RunDecoder, videoFrame: VideoFrame): void {
    const frame = videoFrame.timestamp
    entry.inFlight = Math.max(0, entry.inFlight - 1)
    try {
      // Frames between the key frame and the playhead are decoded only to reach it
      if (frame < this.playhead || this.decoded.has(frame)) return
      const width = videoFrame.displayWidth
      const height = videoFrame.displayHeight
      let canvas = this.pool.pop()
      while (canvas !== undefined && (canvas.width !== width || canvas.height !== height)) {
        canvas = this.pool.pop()
      }
      canvas ??= new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (context === null) return
      context.drawImage(videoFrame, 0, 0, width, height)
      this.decoded.set(frame, { canvas, runId: entry.run.id })
    } finally {
      videoFrame.close()
    }
  }

  private fail(entry: RunDecoder): void {
    if (entry.broken) return
    entry.broken = true
    this.closeDecoder(entry)
    // A run its own codec cannot read back is of no use: the frames play live
    prerenderCache.removeRun(entry.run)
  }

  private closeDecoder(entry: RunDecoder): void {
    try {
      if (entry.decoder.state !== 'closed') entry.decoder.close()
    } catch {
      // Already closed by an error
    }
  }
}

/** The page's one player */
export const prerenderPlayer = new PrerenderPlayer()

/**
 * Whether the cache holds `frame` for playback moving in `direction`: the pump then asks no live render of it (a live
 * render in flight keeps taking the latest requested frame, and would compete with the cache for the whole range).
 */
export function prerenderServesFrame(frame: number, direction: number): boolean {
  return canServe(direction) && prerenderCache.validRunAt(frame) !== null
}

/** The last frame rendered playback took from the cache, while the cache keeps answering */
let lastPresentedFrame: number | null = null

/**
 * The render pump's question on each animation frame of rendered playback (the one hook in
 * `use-preview-render-pump-controller.ts`): `presented` when the cache drew `frame` through `present`, `pending` when
 * its picture is a few milliseconds away (the pump keeps the previous picture and asks again on the next animation
 * frame), `live` when the pump renders the frame itself, as it always did.
 */
export function presentPrerenderedFrame(
  frame: number,
  direction: number,
  present: (canvas: OffscreenCanvas) => void,
): 'presented' | 'pending' | 'live' {
  const answer = prerenderPlayer.frameFor(frame, direction)
  if (answer.kind === 'pending') return 'pending'
  if (answer.kind === 'none') {
    lastPresentedFrame = null
    return 'live'
  }
  present(answer.canvas)
  lastPresentedFrame = frame
  return 'presented'
}

/**
 * Whether a live render of `frame` that finished during playback must not reach the screen: the cache has already
 * shown that frame or a later one, and drawing it would step the picture back.
 */
export function prerenderShowedLaterFrame(
  frame: number,
  isPlaying: boolean,
  direction: number,
): boolean {
  if (!isPlaying) {
    lastPresentedFrame = null
    return false
  }
  return lastPresentedFrame !== null && (frame - lastPresentedFrame) * (direction < 0 ? -1 : 1) <= 0
}
