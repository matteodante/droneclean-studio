// The raw 10-bit test backend (design 3.6 section 2.13): a provider backend that reads frames from a headerless
// `gbrp10le` file, the way FFmpeg's raw stream carries them, and widens each one through the precise path's own source
// pass (`createSourcePass`) into a fresh `rgba16float` texture. It exists so the float path has a caller in a check:
// the golden kit feeds it a synthetic 10-bit ramp, which no browser decoder can deliver above 8 bits.
//
// The backend is reached only while the golden kit's switch is on (`setRawTestKit`, called by `render/test-sink.ts`):
// the renderer's stages ask `rawTestBackendFor` before the WebCodecs backend, and `predicates.ts` counts every video
// clip as staged while it is on, so a plain clip goes through the provider and the float composite. With the switch off
// (always, in the app) nothing here runs.

import { blitToSourceFrame, sourceFrameTextureDescriptor } from '@/studio/render/frames/blit'
import { createSourcePass } from '@/studio/render/precise/source-pass'
import { OUTPUT_COLOUR_TAGS, preciseFrameBytes } from '@/studio/render/precise/contract'
import type { BackendFrame, FrameBackend, FrameFile } from '../types'

/**
 * What the kit says about the raw files: every frame of every file is `width` x `height` `gbrp10le`.
 *
 * A clip's own file stays a real (tiny) video: the renderer opens every video clip's file with its decoder before it
 * draws it, and a headerless raw file does not open. The raw frames sit beside it, at `rawUrl(src)`.
 */
export interface RawTestKit {
  readonly width: number
  readonly height: number
  /** Where the raw frames of the file at `src` are; `src` itself by default. */
  readonly rawUrl?: (src: string) => string
  /** The bytes of a URL; the browser's `fetch` by default. */
  readonly readFile?: (url: string) => Promise<Uint8Array>
}

let activeKit: RawTestKit | null = null

/** Switches the raw backend on for the renderers created from now on, or off with `null`. */
export function setRawTestKit(kit: RawTestKit | null): void {
  activeKit = kit
}

/** Whether the golden kit's raw backend is on: every video clip then reads its frames through the provider. */
export function rawTestKitActive(): boolean {
  return activeKit !== null
}

/** The raw backend for the renderer's device while the kit is on, otherwise `null`. */
export function rawTestBackendFor(device: GPUDevice): FrameBackend | null {
  return activeKit === null ? null : createRawTestBackend(device, activeKit)
}

async function fetchFile(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`raw-test: '${url}' answered HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** Builds the backend on `device`: one source pass at the kit's size, one cached copy of each file read. */
export function createRawTestBackend(device: GPUDevice, kit: RawTestKit): FrameBackend {
  const { width, height } = kit
  const readFile = kit.readFile ?? fetchFile
  const rawUrl = kit.rawUrl ?? ((src: string) => src)
  const frameBytes = preciseFrameBytes('gbrp10le', width, height)
  const pass = createSourcePass(device, { width, height, colour: OUTPUT_COLOUR_TAGS })
  const files = new Map<string, Promise<Uint8Array>>()

  const bytesOf = (file: FrameFile): Promise<Uint8Array> => {
    let bytes = files.get(file.key)
    if (bytes === undefined) {
      bytes = readFile(rawUrl(file.src))
      files.set(file.key, bytes)
    }
    return bytes
  }

  return {
    origin: 'raw-test',

    async decode(file, index): Promise<BackendFrame> {
      const bytes = await bytesOf(file)
      const start = index * frameBytes
      if (!Number.isInteger(index) || index < 0 || start + frameBytes > bytes.byteLength) {
        throw new Error(
          `raw-test: '${file.key}' has ${Math.floor(bytes.byteLength / frameBytes)} frames, none is ${index}`,
        )
      }
      const frame = pass.uploadFrame(bytes.subarray(start, start + frameBytes), {
        index,
        rate: file.rate,
        durationFrames: 1,
      })
      // The pass overwrites its texture with the next frame: the provider keeps a texture of its own.
      const texture = device.createTexture(sourceFrameTextureDescriptor(width, height))
      blitToSourceFrame(device, frame.texture, texture)
      return { texture, index, width, height }
    },

    destroy() {
      pass.destroy()
      files.clear()
    },
  }
}
