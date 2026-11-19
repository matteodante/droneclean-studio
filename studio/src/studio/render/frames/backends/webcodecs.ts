// The WebCodecs backend (design 3.6 section 2.4): a decoded sample enters the GPU as 8-bit
// (`copyExternalImageToTexture` into a staging texture, the one way a browser frame reaches a texture) and one blit
// widens it into the `rgba16float` source-frame texture at the file's size. The decoder itself sits behind
// `WebCodecsSampleReader`, so the index check and the upload are tested without a codec; the mediabunny reader that
// the running editor uses is `mediabunny-reader.ts`.

import { perDevice } from '@/studio/render/device-cache'
import { timedStage, timedStageAsync } from '@/studio/render/timings'
import { frameToSeconds, secondsToFrame } from '@/studio/time'
import { blitToSourceFrame, sourceFrameTextureDescriptor, stagingTextureDescriptor } from '../blit'
import type { SourceColourReport } from '../colour-check'
import type { BackendFrame, FrameBackend, FrameFile } from '../types'

/** A decoded frame the reader hands over; `close` frees the decoder's copy once it is on the GPU. */
export interface WebCodecsSample {
  /** The sample's presentation time in seconds, from which the frame it is derives: the check on the decoder. */
  readonly timestamp: number
  readonly width: number
  readonly height: number
  readonly image: GPUCopyExternalImageSource
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

/** Builds the backend on `reader`. The reader's samples are asked for the middle of the frame, never its edge. */
export function createWebCodecsBackend(
  device: GPUDevice,
  reader: WebCodecsSampleReader,
): FrameBackend {
  return {
    origin: 'webcodecs',

    async decode(file, index): Promise<BackendFrame> {
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
        const texture = timedStage('upload', () => {
          const staging = stagingTexture(device, width, height)
          device.queue.copyExternalImageToTexture(
            { source: sample.image },
            { texture: staging },
            { width, height },
          )
          const widened = device.createTexture(sourceFrameTextureDescriptor(width, height))
          blitToSourceFrame(device, staging, widened)
          return widened
        })
        return {
          texture,
          index: secondsToFrame(file.rate, sample.timestamp),
          width,
          height,
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
