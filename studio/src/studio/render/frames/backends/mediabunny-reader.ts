// The mediabunny decoder behind the WebCodecs backend: one `Input` per file, opened when first asked, and one forward
// stream of samples per file (`VideoSampleSink.samples(t)`), kept open while the frames are asked in order. Same
// opening as FreeCut's `VideoFrameExtractor.init` (the input source, the decodability check), and the same picture: the
// sample is drawn on a 2D canvas (`sample.draw`), as FreeCut's `captureFrame` does, and that canvas is what
// `copyExternalImageToTexture` takes. Handing it the `VideoFrame` instead lets the browser convert the frame's BT.709
// transfer to sRGB on the way in: the golden frame `color-input-dlog-m` came out 10 to 14 levels brighter, the log
// code values the input colour stage decodes were no longer the camera's, and a staged clip would not match the same
// clip unstaged.
//
// Why a stream (task 8.2's measurement): `getSample(t)` decodes from the key frame before `t` on every call, 47.65 ms a
// frame on clip 0020 (p95 74 ms), against the 22 ms an export frame may take. Frames asked in order are read off the
// stream, which mediabunny decodes a few frames ahead; a frame asked again (a 59.94 clip in a 60 project) is the
// sample already held; a step back, or a jump forward of more than `FORWARD_JUMP_SECONDS`, starts the stream again at
// the frame asked for (it begins at the key frame before it, as `getSample` does). The backend checks every sample's
// index, so a stream that answers the wrong frame is an error, never a neighbour.

import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import type { FrameFile } from '../types'
import type { SourceColourReport } from '../colour-check'
import type { WebCodecsSample, WebCodecsSampleReader } from './webcodecs'

type MediabunnyModule = typeof import('mediabunny')
type Sink = InstanceType<MediabunnyModule['VideoSampleSink']>
type VideoInput = InstanceType<MediabunnyModule['Input']>
type Sample = InstanceType<MediabunnyModule['VideoSample']>

/** How far forward a stream reads through before it starts again at the frame asked for (FreeCut's extractor: 3 s) */
export const FORWARD_JUMP_SECONDS = 3

/** Times closer than this are the same instant (FreeCut's extractor's epsilon) */
const EPSILON = 1e-4

/** One file's forward stream: the sample on screen at the last asked time, and the one after it once read */
interface Stream {
  readonly iterator: AsyncGenerator<Sample, void, unknown>
  current: Sample | null
  next: Sample | null
  done: boolean
  lastAsked: number
}

interface OpenFile {
  readonly input: VideoInput
  readonly sink: Sink
  /** What the track's colour space says; a field the file does not tag is absent. */
  readonly colour: SourceColourReport
  stream: Stream | null
}

/** The 2D canvas a sample of one size is drawn on; the backend copies it to the GPU before it asks for the next */
interface DrawCanvas {
  readonly canvas: OffscreenCanvas
  readonly context: OffscreenCanvasRenderingContext2D
}

/** Whether `sample` is the one on screen at `seconds`: it starts at or before it and has not ended */
function covers(sample: Sample | null, seconds: number): boolean {
  if (sample === null || sample.timestamp > seconds + EPSILON) return false
  const duration = sample.duration
  return !(Number.isFinite(duration) && duration > 0) || sample.timestamp + duration > seconds - EPSILON
}

function closeStream(stream: Stream | null): void {
  if (stream === null) return
  stream.current?.close()
  stream.next?.close()
  stream.current = null
  stream.next = null
  void stream.iterator.return(undefined).catch(() => undefined)
}

/** The stream's next sample, read once and held until it is used */
async function peek(stream: Stream): Promise<Sample | null> {
  if (stream.next !== null || stream.done) return stream.next
  const step = await stream.iterator.next()
  if (step.done) {
    stream.done = true
    return null
  }
  stream.next = step.value
  return stream.next
}

/** Opens files with mediabunny as the clips' frames are asked for; `destroy` disposes every input. */
export function createMediabunnySampleReader(): WebCodecsSampleReader {
  const open = new Map<string, Promise<OpenFile>>()
  const canvases = new Map<string, DrawCanvas>()
  let moduleLoad: Promise<MediabunnyModule> | undefined

  const canvasFor = (width: number, height: number): DrawCanvas => {
    const key = `${width}x${height}`
    let entry = canvases.get(key)
    if (entry === undefined) {
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('mediabunny: no 2D canvas to draw the decoded frame on')
      entry = { canvas, context }
      canvases.set(key, entry)
    }
    return entry
  }

  const openFile = async (file: FrameFile): Promise<OpenFile> => {
    moduleLoad ??= import('mediabunny')
    const mb = await moduleLoad
    const input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: createMediabunnyInputSource(mb, file.src),
    })
    const track = await input.getPrimaryVideoTrack()
    if (track === null) {
      input.dispose()
      throw new Error(`mediabunny: '${file.key}' has no video track`)
    }
    if (!(await track.canDecode())) {
      input.dispose()
      throw new Error(`mediabunny: the video track of '${file.key}' cannot be decoded by this browser`)
    }
    const space = await track.getColorSpace()
    const colour: SourceColourReport = {
      primaries: space.primaries,
      transfer: space.transfer,
      matrix: space.matrix,
    }
    return { input, sink: new mb.VideoSampleSink(track), colour, stream: null }
  }

  /** The file's stream, kept when `seconds` is the held sample or a short way ahead of it, started again otherwise */
  const streamFor = (opened: OpenFile, seconds: number): Stream => {
    const stream = opened.stream
    const keeps =
      stream !== null &&
      (covers(stream.current, seconds) ||
        (seconds + EPSILON >= stream.lastAsked && seconds - stream.lastAsked <= FORWARD_JUMP_SECONDS))
    if (keeps) return stream
    closeStream(stream)
    const started: Stream = {
      iterator: opened.sink.samples(seconds),
      current: null,
      next: null,
      done: false,
      lastAsked: seconds,
    }
    opened.stream = started
    return started
  }

  /** Reads the stream up to the sample on screen at `seconds` */
  const sampleOnScreen = async (stream: Stream, seconds: number): Promise<Sample | null> => {
    stream.lastAsked = seconds
    for (;;) {
      if (covers(stream.current, seconds)) return stream.current
      const candidate = await peek(stream)
      if (candidate === null) return covers(stream.current, seconds) ? stream.current : null
      if (candidate.timestamp > seconds + EPSILON) {
        // The stream starts at the sample on screen at the asked time, so a first sample after it is the file's first
        if (stream.current === null) {
          stream.current = candidate
          stream.next = null
        }
        return stream.current
      }
      stream.current?.close()
      stream.current = candidate
      stream.next = null
    }
  }

  return {
    async sampleAt(file, seconds): Promise<WebCodecsSample | null> {
      let opening = open.get(file.key)
      if (opening === undefined) {
        opening = openFile(file)
        open.set(file.key, opening)
        // A failed open is not remembered: the next frame asks again.
        opening.catch(() => open.delete(file.key))
      }
      const opened = await opening
      const sample = await sampleOnScreen(streamFor(opened, seconds), seconds)
      if (sample === null) return null
      if (sample.rotation !== 0) {
        throw new Error(
          `mediabunny: '${file.key}' is rotated ${sample.rotation} degrees, which the staged path does not turn upright`,
        )
      }
      const width = sample.displayWidth
      const height = sample.displayHeight
      const drawn = canvasFor(width, height)
      drawn.context.clearRect(0, 0, width, height)
      sample.draw(drawn.context, 0, 0, width, height)
      return {
        timestamp: sample.timestamp,
        width,
        height,
        image: drawn.canvas,
        colour: opened.colour,
        // The stream owns its samples: it closes one when it moves past it
        close() {},
      }
    },

    destroy() {
      for (const opening of open.values()) {
        void opening.then(
          (opened) => {
            closeStream(opened.stream)
            opened.stream = null
            opened.input.dispose()
          },
          () => {},
        )
      }
      open.clear()
      canvases.clear()
    },
  }
}
