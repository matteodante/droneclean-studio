// The pre-render job (design `docs/designs/prerender-preview.md` §0.2, §0.7): the frames of a range the cache does not hold
// yet, drawn by the editor's composition renderer on the preview's own composition and at the preview's own size
// (the preview quality), encoded with WebCodecs into the cache. The renderer runs with the exact failure policy (an
// export's: every stage of a clip is awaited, an exact source frame is decoded) rather than the live preview's,
// which shows a clip's last good frame while a stage is still preparing: such a frame must never be stored.
//
// One job at a time. It stops early, keeping every frame it finished, when it is cancelled, when the project changes
// under it (the frames it would draw next are stale already), when the cache is full, or on an error; the outcome
// says which.

import { importCompositionRenderer } from '@/features/preview/deps/export'
import { usePlaybackStore } from '@/shared/state/playback'
import type { CompositionInputProps } from '@/types/export'
import type { TimelineItem } from '@/types/timeline'
import { prerenderCache, PRERENDER_MEMORY_LIMIT_BYTES, type CachedRun } from './cache'
import {
  browserCodecSupport,
  keyFrameInterval,
  pickPrerenderCodec,
  type PrerenderCodec,
} from './codec'
import { frameHashes } from './fingerprint'
import { getPrerenderHost } from './host'
import { subtractRanges, type FrameRange } from './ranges'
import {
  collectRenderInput,
  currentFrameHashes,
  fingerprintInputFor,
  watchPrerenderState,
} from './state'
import { usePrerenderStore, type PrerenderOutcome, type PrerenderStopReason } from './store'

/** Why a job could not start at all */
export class PrerenderStartError extends Error {
  constructor(
    readonly reason: 'busy' | 'no-preview',
    message: string,
  ) {
    super(message)
    this.name = 'PrerenderStartError'
  }
}

/** The encoder's queue the job lets build up before it waits: one frame in flight beside the one being drawn */
const MAX_ENCODE_QUEUE = 2

let running = false
let cancelRequested = false

/** Stop the running job after the frame it is drawing; the frames it finished stay in the cache */
export function cancelPrerender(): void {
  if (running) cancelRequested = true
}

function waitForEncodeQueue(encoder: VideoEncoder): Promise<void> {
  if (encoder.encodeQueueSize <= MAX_ENCODE_QUEUE) return Promise.resolve()
  return new Promise((resolve) => {
    const onDequeue = () => {
      if (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) return
      encoder.removeEventListener('dequeue', onDequeue)
      resolve()
    }
    encoder.addEventListener('dequeue', onDequeue)
  })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Why a stretch stopped before its end */
interface StretchStop {
  readonly stop: PrerenderStopReason | 'cancelled'
  readonly detail?: string
}

/** One missing stretch to render, and what it renders with */
interface StretchJob {
  readonly stretch: FrameRange
  readonly hashes: Float64Array
  readonly codec: PrerenderCodec
  readonly fps: number
  readonly renderFrame: (frame: number) => Promise<OffscreenCanvas>
  /** Whether the editor's state changed in a way that redraws a frame of the job (checked between frames) */
  readonly isStale: () => boolean
  readonly onFrame: () => void
}

interface RunSink {
  readonly encoder: VideoEncoder
  error: unknown
}

/** An encoder whose chunks go, in display order, into `run` */
function encoderInto(run: CachedRun, codec: PrerenderCodec): RunSink {
  const sink: RunSink = {
    error: null,
    encoder: new VideoEncoder({
      output: (chunk, metadata) => {
        if (metadata?.decoderConfig) run.decoder = { ...codec.decoder, ...metadata.decoderConfig }
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        prerenderCache.appendChunk(run, { data, key: chunk.type === 'key' })
      },
      error: (error) => {
        sink.error = error
      },
    }),
  }
  sink.encoder.configure(codec.encoder)
  return sink
}

/** Why the next frame must not be rendered, or `null` */
function stopBeforeFrame(job: StretchJob, sink: RunSink): StretchStop | null {
  if (cancelRequested) return { stop: 'cancelled' }
  if (sink.error !== null) return { stop: 'error', detail: errorText(sink.error) }
  if (job.isStale()) return { stop: 'changed' }
  if (prerenderCache.totalBytes >= PRERENDER_MEMORY_LIMIT_BYTES) return { stop: 'full' }
  return null
}

/** Render and encode the stretch's frames in order; why it stopped early, or `null` */
async function encodeFrames(
  job: StretchJob,
  sink: RunSink,
  keyInterval: number,
): Promise<StretchStop | null> {
  const frameDurationUs = 1_000_000 / job.fps
  for (let frame = job.stretch.start; frame < job.stretch.end; frame += 1) {
    const stop = stopBeforeFrame(job, sink)
    if (stop !== null) return stop
    const canvas = await job.renderFrame(frame)
    const videoFrame = new VideoFrame(canvas, {
      timestamp: Math.round(frame * frameDurationUs),
      duration: Math.round(frameDurationUs),
    })
    try {
      sink.encoder.encode(videoFrame, { keyFrame: (frame - job.stretch.start) % keyInterval === 0 })
    } finally {
      videoFrame.close()
    }
    job.onFrame()
    await waitForEncodeQueue(sink.encoder)
  }
  return null
}

/** Render one missing stretch into a new run; why it stopped early, or `null` when it reached its end */
async function renderStretch(job: StretchJob): Promise<StretchStop | null> {
  const keyInterval = keyFrameInterval(job.fps)
  const run = prerenderCache.beginRun(job.stretch.start, job.hashes, job.codec.decoder, keyInterval)
  let sink: RunSink | null = null
  try {
    sink = encoderInto(run, job.codec)
    const stopped = await encodeFrames(job, sink, keyInterval)
    await sink.encoder.flush()
    if (stopped !== null) return stopped
    return sink.error === null ? null : { stop: 'error', detail: errorText(sink.error) }
  } catch (error) {
    return { stop: 'error', detail: errorText(sink?.error ?? error) }
  } finally {
    if (sink !== null && sink.encoder.state !== 'closed') sink.encoder.close()
    if (run.end === run.start) prerenderCache.removeRun(run)
    prerenderCache.flush()
  }
}

/** Whether a media clip draws in `range` (audio draws nothing) */
function drawsMediaIn(item: TimelineItem, range: FrameRange): boolean {
  const end = item.from + item.durationInFrames
  return (
    item.type !== 'audio' &&
    item.mediaId !== undefined &&
    item.from < range.end &&
    end > range.start
  )
}

/** The clips drawing in `range` whose media the preview has not resolved yet: they would render as nothing */
function clipsWithoutMedia(input: CompositionInputProps, range: FrameRange): string[] {
  return input.tracks
    .filter((track) => track.visible !== false)
    .flatMap((track) => track.items)
    .filter((item) => drawsMediaIn(item, range) && !('src' in item && item.src))
    .map((item) => item.label ?? item.id)
}

/**
 * Pre-render `range`: the frames the cache does not hold as valid are drawn and stored, in one run per missing
 * stretch. Resolves with the outcome (also published to the interface's store); rejects only when the job cannot
 * start (`PrerenderStartError`).
 */
export async function runPrerender(range: FrameRange): Promise<PrerenderOutcome> {
  if (running) throw new PrerenderStartError('busy', 'a pre-render is already running')
  const host = getPrerenderHost()
  if (host === null) throw new PrerenderStartError('no-preview', 'the preview is not open')

  running = true
  cancelRequested = false
  const startedAt = performance.now()
  usePlaybackStore.getState().pause()
  watchPrerenderState()

  const input = collectRenderInput(host)
  const fps = input.fps > 0 ? input.fps : 30
  const hashes = frameHashes(fingerprintInputFor(input, host), range)
  const missing = subtractRanges(range, prerenderCache.validRanges())
  const total = missing.reduce((sum, stretch) => sum + stretch.end - stretch.start, 0)
  let done = 0
  const publishProgress = () =>
    usePrerenderStore.setState({
      job: { startFrame: range.start, endFrame: range.end, done, total },
    })
  publishProgress()

  const finish = (
    status: PrerenderOutcome['status'],
    reason?: PrerenderStopReason,
    detail?: string,
  ): PrerenderOutcome => {
    const outcome: PrerenderOutcome = {
      status,
      ...(reason !== undefined && { reason }),
      ...(detail !== undefined && { detail }),
      startFrame: range.start,
      endFrame: range.end,
      renderedFrames: done,
      seconds: Math.round((performance.now() - startedAt) / 100) / 10,
    }
    running = false
    cancelRequested = false
    usePrerenderStore.setState({ job: null, lastOutcome: outcome })
    return outcome
  }

  if (total === 0) return finish('done')
  const unloaded = clipsWithoutMedia(input, range)
  if (unloaded.length > 0) {
    return finish('stopped', 'error', `media not loaded yet: ${unloaded.slice(0, 3).join(', ')}`)
  }

  const support = browserCodecSupport()
  const codec = support === null ? null : await pickPrerenderCodec(support, host.renderSize, fps)
  if (codec === null || typeof OffscreenCanvas === 'undefined')
    return finish('stopped', 'unsupported')

  // The size the codec was configured at (even); the renderer draws at it
  const width = codec.encoder.width
  const height = codec.encoder.height
  let renderer: Awaited<
    ReturnType<Awaited<ReturnType<typeof importCompositionRenderer>>['createCompositionRenderer']>
  > | null = null
  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (context === null) return finish('stopped', 'unsupported')
    const { createCompositionRenderer } = await importCompositionRenderer()
    renderer = await createCompositionRenderer(input, canvas, context, {
      mode: 'export',
      useProxyMedia: usePlaybackStore.getState().useProxy,
      renderText: host.renderText,
    })
    await renderer.preload()
    const activeRenderer = renderer

    // A change marks the cache dirty; whether it redraws a frame of the job is the hashes' question
    let checkedRevision = prerenderCache.changeCount
    const isStale = (): boolean => {
      if (prerenderCache.changeCount === checkedRevision) return false
      checkedRevision = prerenderCache.changeCount
      const now = currentFrameHashes(range)
      return now.some((hash, index) => hash !== hashes[index])
    }

    for (const stretch of missing) {
      const stopped = await renderStretch({
        stretch,
        hashes: hashes.slice(stretch.start - range.start, stretch.end - range.start),
        codec,
        fps,
        renderFrame: async (frame) => {
          await activeRenderer.renderFrame(frame)
          return canvas
        },
        isStale,
        onFrame: () => {
          done += 1
          publishProgress()
        },
      })
      if (stopped?.stop === 'cancelled') return finish('cancelled')
      if (stopped !== null) return finish('stopped', stopped.stop, stopped.detail)
    }
    return finish('done')
  } catch (error) {
    return finish('stopped', 'error', errorText(error))
  } finally {
    renderer?.dispose()
  }
}
