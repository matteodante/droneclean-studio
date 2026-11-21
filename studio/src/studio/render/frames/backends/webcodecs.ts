// The WebCodecs backend (design 3.6 section 2.4): a decoded sample enters the GPU as 8-bit
// (`copyExternalImageToTexture` into a staging texture, the one way a browser frame reaches a texture) and one blit
// widens it into the `rgba16float` source-frame texture at the file's size. The decoder itself sits behind
// `WebCodecsSampleReader`, so the index check and the upload are tested without a codec; the mediabunny reader that
// the running editor uses is `mediabunny-reader.ts`.
//
// A preview's frame skips the canvas and the staging copy: the decoder's `VideoFrame` is imported as an external texture
// and widened by one pass (`blitExternalToSourceFrame`). The browser does not hand every file's colour over the same
// way (a 10-bit frame comes with its transfer converted), so the first frame of each file is compared with the canvas
// picture and the file is read as it comes, corrected, or through the canvas. A preview that asks for a reduced size
// (design 8.10) gets its frames from such a file in one pass at that size (`blitExternalReducedToSourceFrame`): no
// full-size picture is made. Clip 0020 on the M4 (21 Nov 2026): the canvas upload of a 4K frame took 10.4 ms of GPU
// with the queue drained before it; straight to a quarter, the frame's GPU work before its stages was 4.6 ms, and its
// pictures were within 0.01 level on average (0.12 at most) of the canvas upload reduced.

import { perDevice } from '@/studio/render/device-cache'
import { timedStage, timedStageAsync } from '@/studio/render/timings'
import { frameToSeconds, secondsToFrame } from '@/studio/time'
import {
  blitExternalReducedToSourceFrame,
  blitExternalToSourceFrame,
  blitToSourceFrame,
  chooseUpload,
  probeUploads,
  sourceFrameTextureDescriptor,
  stagingTextureDescriptor,
  type ExternalConversion,
} from '../blit'
import type { SourceColourReport } from '../colour-check'
import type { BackendFrame, DecodeOptions, FrameBackend, FrameFile } from '../types'

/** A decoded frame the reader hands over; `close` frees the decoder's copy once it is on the GPU. */
export interface WebCodecsSample {
  /** The sample's presentation time in seconds, from which the frame it is derives: the check on the decoder. */
  readonly timestamp: number
  readonly width: number
  readonly height: number
  /** The picture the exports upload: a canvas the frame was drawn on (drawn when first read), what the golden frames are of. */
  readonly image: GPUCopyExternalImageSource
  /**
   * The decoder's frame itself, a new `VideoFrame` the caller closes: what the preview uploads without a canvas. Absent
   * where the reader has none; the picture is then `image`.
   */
  videoFrame?(): VideoFrame
  /** The tags of the file the sample came from, when the reader knows them. */
  readonly colour?: SourceColourReport
  close(): void
}

/** The decoder: the sample that is on screen at `seconds` of `file`, or null when there is none. */
export interface WebCodecsSampleReader {
  sampleAt(file: FrameFile, seconds: number): Promise<WebCodecsSample | null>
  destroy(): void
}

/** The staging textures of a device, one per size: a copy and its blit are one queue-ordered pair, so frames can share. */
function stagingTexture(device: GPUDevice, width: number, height: number): GPUTexture {
  return perDevice(device, `source-frame-staging:${width}x${height}`, () =>
    device.createTexture(stagingTextureDescriptor(width, height)),
  )
}

/** A frame's size as the backend reports it: the reduced one with the frame's own as `natural`, or the frame's own */
function uploadedSize(
  reducedTo: { width: number; height: number } | undefined,
  own: { width: number; height: number },
): Pick<BackendFrame, 'width' | 'height' | 'natural'> {
  return reducedTo === undefined ? own : { width: reducedTo.width, height: reducedTo.height, natural: own }
}

/** How many frames in a row may leave a file's reading undecided before it is read through the canvas */
const UNDECIDED_FRAMES = 30

/** How one file's frames are uploaded in a preview, found from its first frame. */
type FileUpload = ExternalConversion | 'canvas'

/** Builds the backend on `reader`. The reader's samples are asked for the middle of the frame, never its edge. */
export function createWebCodecsBackend(
  device: GPUDevice,
  reader: WebCodecsSampleReader,
): FrameBackend {
  /** How many of each file's frames could not tell the two readings apart (`chooseUpload`'s `undecided`) */
  const undecided = new Map<string, number>()
  /** What each file's preview frames take, decided on its first (the verdict of `chooseUpload`). */
  const uploads = new Map<string, FileUpload>()

  /** The canvas picture widened: staging copy and one blit, the exports' upload. */
  const uploadThroughCanvas = (sample: WebCodecsSample): GPUTexture => {
    const { width, height } = sample
    const staging = stagingTexture(device, width, height)
    device.queue.copyExternalImageToTexture({ source: sample.image }, { texture: staging }, { width, height })
    const widened = device.createTexture(sourceFrameTextureDescriptor(width, height))
    blitToSourceFrame(device, staging, widened)
    return widened
  }

  /** The decoder's frame widened by one external-texture pass. */
  const uploadExternal = (
    frame: VideoFrame,
    width: number,
    height: number,
    conversion: ExternalConversion,
  ): GPUTexture => {
    const widened = device.createTexture(sourceFrameTextureDescriptor(width, height))
    blitExternalToSourceFrame(device, frame, widened, conversion)
    return widened
  }

  /** The decoder's frame straight to a preview's reduced size (design 8.10), by one external-texture pass. */
  const uploadExternalReduced = (
    frame: VideoFrame,
    natural: { width: number; height: number },
    size: { width: number; height: number },
    conversion: ExternalConversion,
  ): GPUTexture => {
    const reduced = device.createTexture(sourceFrameTextureDescriptor(size.width, size.height))
    blitExternalReducedToSourceFrame(device, frame, natural, reduced, conversion)
    return reduced
  }

  /**
   * A file's first frames: the external upload as handed, compared with the canvas picture, decides the file's reading
   * (`chooseUpload`); the frame comes as that reading draws it.
   */
  const probeFile = async (
    file: FrameFile,
    sample: WebCodecsSample,
    frame: VideoFrame,
  ): Promise<{ texture: GPUTexture; reduced: boolean }> => {
    const { width, height } = sample
    const asHanded = uploadExternal(frame, width, height, 'plain')
    const staging = stagingTexture(device, width, height)
    device.queue.copyExternalImageToTexture({ source: sample.image }, { texture: staging }, { width, height })
    const chosen = chooseUpload(await probeUploads(device, staging, asHanded))
    if (chosen === 'undecided') {
      // Both readings match this frame: show it as handed, and ask the next frame; a file that never tells
      // (black from start to end) settles on the canvas, the exports' own reading
      const tries = (undecided.get(file.key) ?? 0) + 1
      undecided.set(file.key, tries)
      if (tries >= UNDECIDED_FRAMES) uploads.set(file.key, 'canvas')
      return { texture: asHanded, reduced: false }
    }
    uploads.set(file.key, chosen)
    if (chosen === 'plain') return { texture: asHanded, reduced: false }
    asHanded.destroy()
    return {
      texture: chosen === 'canvas' ? uploadThroughCanvas(sample) : uploadExternal(frame, width, height, chosen),
      reduced: false,
    }
  }

  /**
   * A preview's upload: the file's verdict when it has one, the first frames' probe against the canvas when not. A
   * frame whose file was found to upload as an external texture comes at `size` when one is asked for (`reduced`).
   */
  const uploadForPreview = async (
    file: FrameFile,
    sample: WebCodecsSample,
    makeFrame: () => VideoFrame,
    size: { width: number; height: number } | undefined,
  ): Promise<{ texture: GPUTexture; reduced: boolean }> => {
    const { width, height } = sample
    const verdict = uploads.get(file.key)
    if (verdict === 'canvas') return { texture: uploadThroughCanvas(sample), reduced: false }
    const frame = makeFrame()
    try {
      if (verdict === undefined) return await probeFile(file, sample, frame)
      const reduces = size !== undefined && (size.width !== width || size.height !== height)
      return reduces
        ? { texture: uploadExternalReduced(frame, { width, height }, size, verdict), reduced: true }
        : { texture: uploadExternal(frame, width, height, verdict), reduced: false }
    } finally {
      frame.close()
    }
  }

  return {
    origin: 'webcodecs',

    async decode(file, index, options?: DecodeOptions): Promise<BackendFrame> {
      // Half a frame in: a sample's timestamp is its first instant, and a request for exactly that instant may land
      // a rounding error before it, on the frame before.
      const sample = await timedStageAsync('decode', () =>
        reader.sampleAt(file, frameToSeconds(file.rate, index + 0.5)),
      )
      if (sample === null) {
        throw new Error(`webcodecs: '${file.key}' has no frame ${index}`)
      }
      try {
        const { width, height } = sample
        const makeFrame = options?.preview === true ? sample.videoFrame?.bind(sample) : undefined
        const upload =
          makeFrame === undefined
            ? timedStage('upload', () => ({ texture: uploadThroughCanvas(sample), reduced: false }))
            : await timedStageAsync('upload', () => uploadForPreview(file, sample, makeFrame, options?.size))
        return {
          ...uploadedSize(upload.reduced ? options?.size : undefined, { width, height }),
          texture: upload.texture,
          index: secondsToFrame(file.rate, sample.timestamp),
          colour: sample.colour,
        }
      } finally {
        sample.close()
      }
    },

    destroy() {
      reader.destroy()
    },
  }
}
