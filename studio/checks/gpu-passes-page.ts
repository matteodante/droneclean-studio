// The page of `checks/gpu-passes.mjs`: the editor's own GPU passes that unit tests can only fake, run on the real
// WebGPU of a headless Chrome and held to a picture computed here. 21 Nov 2026: the preview's frame reduction named its
// sampler `smooth`, a word WGSL reserves; its shader never compiled, every reduced frame was black, and the unit
// tests (a fake device) and the timings (no pixels) both passed. A pass listed here fails the check when its shader
// does not compile, when the GPU reports any error, or when its pixels are not the expected ones.

import { blitExternalReducedToSourceFrame, blitExternalToSourceFrame } from '@/studio/render/frames/blit'
import { createFrameReducer } from '@/studio/render/stages/reduce-frame'

interface Outcome {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

/** A picture with detail at every scale: a smooth gradient and a fine checker, in 0..255 per channel */
function pattern(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const checker = (x + y) % 2 === 0 ? 40 : 0
      bytes[i] = Math.round((x / (width - 1)) * 200) + checker
      bytes[i + 1] = Math.round((y / (height - 1)) * 200) + checker
      bytes[i + 2] = 255 - Math.round(((x + y) / (width + height - 2)) * 200)
      bytes[i + 3] = 255
    }
  }
  return bytes
}

/** The mean of each `factor` x `factor` block, R G B, in 0..255 */
function blockMeans(bytes: Uint8Array, width: number, height: number, factor: number): Float32Array {
  const outWidth = width / factor
  const outHeight = height / factor
  const out = new Float32Array(outWidth * outHeight * 3)
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) sum += bytes[((y * factor + dy) * width + x * factor + dx) * 4 + c]!
        }
        out[(y * outWidth + x) * 3 + c] = sum / (factor * factor)
      }
    }
  }
  return out
}

function halfToNumber(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >> 10) & 0x1f
  const fraction = bits & 0x3ff
  if (exponent === 0) return sign * fraction * 2 ** -24
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15)
}

/** An `rgba16float` texture read back as R G B in 0..255 */
async function readRgb(device: GPUDevice, texture: GPUTexture): Promise<Float32Array> {
  const { width, height } = texture
  const bytesPerRow = Math.ceil((width * 8) / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height })
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(GPUMapMode.READ)
  const halves = new Uint16Array(buffer.getMappedRange().slice(0))
  buffer.unmap()
  buffer.destroy()
  const out = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) out[(y * width + x) * 3 + c] = halfToNumber(halves[y * (bytesPerRow / 2) + x * 4 + c]!) * 255
    }
  }
  return out
}

function differences(a: Float32Array, b: Float32Array): { mean: number; max: number } {
  let sum = 0
  let max = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!)
    sum += d
    max = Math.max(max, d)
  }
  return { mean: sum / a.length, max }
}

function rgba16Target(device: GPUDevice, width: number, height: number): GPUTexture {
  return device.createTexture({
    size: { width, height },
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
  })
}

/** Runs every pass; the GPU's own error messages fail the run whatever the pixels say */
async function run(): Promise<{ outcomes: Outcome[]; gpuErrors: string[] }> {
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter) throw new Error('this Chrome has no WebGPU adapter')
  const device = await adapter.requestDevice()
  const gpuErrors: string[] = []
  device.onuncapturederror = (event) => gpuErrors.push(event.error.message.slice(0, 400))
  const outcomes: Outcome[] = []
  const width = 96
  const height = 72
  const picture = pattern(width, height)

  // The preview's reduction of a texture (design 8.10), at an even scale (exactly the block mean) and an odd one
  const source = device.createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture({ texture: source }, picture, { bytesPerRow: width * 4 }, { width, height })
  const reducer = createFrameReducer(device)
  for (const [factor, tolerance] of [
    [4, 0.6],
    [2, 0.6],
    [3, 8],
  ] as const) {
    const reduced = reducer.reduce(source, { width: width / factor, height: height / factor })
    const { mean, max } = differences(await readRgb(device, reduced), blockMeans(picture, width, height, factor))
    outcomes.push({
      name: `frame reduction by ${factor}`,
      ok: factor === 3 ? mean <= 2 && max <= tolerance * 4 : max <= tolerance,
      detail: `mean ${mean.toFixed(3)}, max ${max.toFixed(3)} levels against the block means`,
    })
  }

  // The preview's upload of a decoder frame, at its size and straight to a reduced one (design 8.10)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no 2D canvas')
  context.putImageData(new ImageData(new Uint8ClampedArray(picture), width, height), 0, 0)
  const frame = new VideoFrame(canvas, { timestamp: 0 })
  try {
    const full = rgba16Target(device, width, height)
    blitExternalToSourceFrame(device, frame, full, 'plain')
    const fullDiff = differences(await readRgb(device, full), blockMeans(picture, width, height, 1))
    outcomes.push({
      name: 'external upload at the frame size',
      ok: fullDiff.max <= 1.5,
      detail: `mean ${fullDiff.mean.toFixed(3)}, max ${fullDiff.max.toFixed(3)} levels against the picture`,
    })
    const reduced = rgba16Target(device, width / 4, height / 4)
    blitExternalReducedToSourceFrame(device, frame, { width, height }, reduced, 'plain')
    const reducedDiff = differences(await readRgb(device, reduced), blockMeans(picture, width, height, 4))
    outcomes.push({
      name: 'external upload straight to a quarter',
      ok: reducedDiff.max <= 1.5,
      detail: `mean ${reducedDiff.mean.toFixed(3)}, max ${reducedDiff.max.toFixed(3)} levels against the block means`,
    })
  } finally {
    frame.close()
  }
  await device.queue.onSubmittedWorkDone()
  reducer.destroy()
  return { outcomes, gpuErrors }
}

;(window as unknown as { gpuPasses: typeof run }).gpuPasses = run
;(window as unknown as { gpuPassesReady: boolean }).gpuPassesReady = true
