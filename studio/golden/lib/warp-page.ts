// The page `golden/lib/stage-warp.mjs` drives: one frame of the synthetic stabilization case through the shipped WebGPU
// stage (`src/studio/stabilization/stage.ts`), read back as RGBA8. It is bundled with esbuild into one classic script
// and injected into the golden run's own page, which is the built app's harness page on the real GPU.
//
// It does what the stage's caller does and nothing else: one rgba8unorm source texture, one frame's data, one draw into
// an rgba8unorm texture at the stabilized size, one readback. A GPU error, a failed pipeline or a refused texture is
// reported and fails the case.
import { halfToUnorm16 } from '../../src/studio/render/half-float'
import { createStabilizationStage, type StabilizationAssets } from '../../src/studio/stabilization/stage'

interface StageWarpGiven {
  input: { width: number; height: number; rgba: string }
  output: { width: number; height: number }
  /**
   * The float variant (the float golden case): the stage reads and writes `rgba16float`, the 8-bit input is widened
   * into it as `value / 255`, and the picture comes back as unorm16 RGBA
   */
  float?: boolean
  assets: { kernelWgsl: string; lensWgsl: string; digitalLensWgsl: string; interpolation: number }
  /** `Gyroflow's` 496-float coefficient table */
  coeffs: string
  frame: {
    /** One `KernelParams`, 416 bytes */
    params: string
    /** 2880 row matrices, 16 floats each */
    matrices: string
  }
}

interface StageWarpResult {
  width: number
  height: number
  /** The picture as base64 RGBA8 (or, for the float variant, little-endian unorm16), one readback row after another */
  rgba: string
  warnings: string[]
}

function bytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** A typed array over decoded bytes: `bytes()` gives a buffer of its own at offset 0 */
function floats(base64: string): Float32Array {
  const decoded = bytes(base64)
  if (decoded.byteLength % 4 !== 0) throw new Error(`expected whole float32 values, not ${decoded.byteLength} bytes`)
  return new Float32Array(decoded.buffer, 0, decoded.byteLength / 4)
}

function toBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000)
    binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}

const scratch = new DataView(new ArrayBuffer(4))

/** A float in 0..1 as the bits of the nearest half float (round to nearest even; the case's values are never subnormal) */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function toHalf(value: number): number {
  if (value <= 0) return 0
  scratch.setFloat32(0, value)
  const bits = scratch.getUint32(0)
  const exponent = ((bits >> 23) & 0xff) - 127 + 15
  const mantissa = bits & 0x7fffff
  if (exponent <= 0) throw new Error(`${value} is too small for the case's half floats`)
  let half = (exponent << 10) | (mantissa >> 13)
  const rest = mantissa & 0x1fff
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1) === 1)) half += 1
  return half
}

/** The 8-bit RGBA input as `value / 255` in half floats (what a float source frame holds) */
function halfInput(rgba: Uint8Array): Uint16Array {
  const out = new Uint16Array(rgba.length)
  for (let i = 0; i < rgba.length; i++) out[i] = toHalf(rgba[i]! / 255)
  return out
}

// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
async function warp(given: StageWarpGiven): Promise<StageWarpResult> {
  if (!navigator.gpu) throw new Error('navigator.gpu is missing: this Chrome has no WebGPU')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('no WebGPU adapter')
  const device = await adapter.requestDevice()
  const warnings: string[] = []
  device.onuncapturederror = (event) => warnings.push(event.error.message)
  const float = given.float === true
  const format: GPUTextureFormat = float ? 'rgba16float' : 'rgba8unorm'
  const bytesPerPixel = float ? 8 : 4
  try {
    const assets: StabilizationAssets = {
      kernelWgsl: given.assets.kernelWgsl,
      lensWgsl: given.assets.lensWgsl,
      digitalLensWgsl: given.assets.digitalLensWgsl,
      coeffs: floats(given.coeffs),
      interpolation: given.assets.interpolation,
    }
    const stage = await createStabilizationStage(device, assets, { input: format, output: format })

    const { width, height } = given.input
    const source = device.createTexture({
      size: { width, height },
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    const input = bytes(given.input.rgba)
    device.queue.writeTexture(
      { texture: source },
      float ? halfInput(input) : input,
      { bytesPerRow: width * bytesPerPixel, rowsPerImage: height },
      { width, height },
    )

    const { width: outWidth, height: outHeight } = given.output
    const target = device.createTexture({
      size: { width: outWidth, height: outHeight },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const encoder = device.createCommandEncoder()
    stage.warp(encoder, source, target, {
      matrices: floats(given.frame.matrices),
      params: bytes(given.frame.params),
      mesh: new Float32Array(0),
    })
    device.queue.submit([encoder.finish()])
    await device.queue.onSubmittedWorkDone()

    // 320 * 4 and 320 * 8 are multiples of 256, `copyTextureToBuffer`'s row alignment
    const bytesPerRow = outWidth * bytesPerPixel
    if (bytesPerRow % 256 !== 0) throw new Error(`a row of ${bytesPerRow} bytes is not 256-aligned`)
    const readback = device.createBuffer({
      size: bytesPerRow * outHeight,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    const copy = device.createCommandEncoder()
    copy.copyTextureToBuffer(
      { texture: target },
      { buffer: readback, bytesPerRow, rowsPerImage: outHeight },
      { width: outWidth, height: outHeight },
    )
    device.queue.submit([copy.finish()])
    await readback.mapAsync(GPUMapMode.READ)
    const mapped = new Uint8Array(readback.getMappedRange().slice(0))
    readback.unmap()
    readback.destroy()
    source.destroy()
    target.destroy()
    let picture = mapped
    if (float) {
      const halves = new Uint16Array(mapped.buffer, 0, mapped.byteLength / 2)
      const unorm = new Uint16Array(halves.length)
      for (let i = 0; i < halves.length; i++) unorm[i] = halfToUnorm16(halves[i]!)
      picture = new Uint8Array(unorm.buffer)
    }
    return { width: outWidth, height: outHeight, rgba: toBase64(picture), warnings }
  } finally {
    device.destroy()
  }
}

;(window as unknown as { __stageWarp: { warp: typeof warp } }).__stageWarp = { warp }
