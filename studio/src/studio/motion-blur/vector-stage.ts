// The vector motion blur on the render device (design 9.2, section 5): one source frame of an output frame's plan,
// blurred along each pixel's motion over the shutter time it stands for, added into the output frame with its weight.
//
// Like the frame gather (`stage.ts`) it is not a pipeline stage but the step between the per-source-frame stages and the
// per-output-frame ones; the pipeline calls `pass` once per sample of the plan, in order, with the gather's steps:
//
//   only     the plan has one sample (1x, a held slow frame): the blurred frame encoded straight into the output, and a
//            pixel with no motion passed through bit for bit;
//   first    the weighted blurred frame into the accumulator;
//   middle   added to the accumulator (an additive blend);
//   last     added to the accumulator it reads, and encoded into the output.
//
// Each pass records, into the caller's encoder: the staged picture to linear light (once, so the taps interpolate light),
// the velocity from the gaps' flows (both ways, at the flow's size), the tile maxima, and the blur. The flows are the
// optical flow's (`@/studio/optical-flow`), measured by the pipeline on the staged frames and cached per gap.

import { perDevice } from '@/studio/render/device-cache'
import type { GapFlow } from '@/studio/optical-flow'
import { accumulatorFormatFor, type GatherStep, type GatherUploads } from './stage'
import {
  BLUR_UNIFORM_BYTES,
  BLUR_WGSL,
  LINEAR_WGSL,
  NEIGHBOR_WGSL,
  TILE_UNIFORM_BYTES,
  TILEMAX_WGSL,
  VELOCITY_UNIFORM_BYTES,
  VELOCITY_WGSL,
} from './vector-kernels'

// The WebGPU usage flags, as the spec numbers them (spelled out so the module loads where there is no GPU).
const COPY_SRC = 0x01
const COPY_DST = 0x02
const TEXTURE_BINDING = 0x04
const STORAGE_BINDING = 0x08
const RENDER_ATTACHMENT = 0x10
const SHADER_STAGE_FRAGMENT = 0x2
// The buffer usage flags (a buffer's COPY_DST is not a texture's)
const BUFFER_COPY_DST = 0x0008
const BUFFER_UNIFORM = 0x0040

/** A picture's size in pixels. */
interface Size {
  readonly width: number
  readonly height: number
}

/** The tiles of the reconstruction's foreground term are about this many frame pixels on a side (design 9.2, 5.2). */
const TILE_FRAME_PIXELS = 48

/** The longest half-length of a pixel's blur, in frame pixels (four times the 95th percentile at 15 s of clip 0020). */
export const MAX_BLUR_RADIUS = 96

/** The blur takes one tap per this many frame pixels of its length, between 2 and `MAX_TAPS` taps. */
export const TAP_SPACING = 1

/** The most taps one pixel's blur (and its foreground search, each side) takes. */
export const MAX_TAPS = 96

/** The round trip's tolerance in frame pixels: a side whose flow there and back misses by this much weighs e^-1. */
export const CONSISTENCY_SIGMA = 2

/** The flows of the gaps around a frame: the optical flow's `GapFlow` (its buffers, in pixels of the flow's size). */
export type FlowPair = Pick<GapFlow, 'forward' | 'backward'>

/** One sample of a plan, as `pass` takes it. */
export interface VectorSample {
  /** The staged picture: an `rgba16float` texture of the stage's size, code values of the Rec.709 transfer */
  readonly picture: GPUTexture
  /** The gap from the frame before to this one; absent at the file's first frame */
  readonly before?: FlowPair
  /** The gap from this frame to the next; absent at the file's last frame */
  readonly after?: FlowPair
  /** The shutter time it stands for, in source frames (> 0) */
  readonly extent: number
  /** Its share of the output frame, in (0, 1] */
  readonly weight: number
}

/** The vector blur of one frame size; see the file's header. */
export interface VectorBlurStage {
  readonly size: Size
  /** The flow's size the gaps are measured at */
  readonly flowSize: Size
  /** The format the sum is held in between passes: `rgba32float` or `rgba16float` (`accumulatorFormatFor`) */
  readonly accumulatorFormat: GPUTextureFormat
  /**
   * Records one sample. `output` (this size, the pipeline's format) is given for the steps that encode, `only` and
   * `last`. A sample with neither gap (a one-frame file) is drawn unblurred.
   *
   * @throws RangeError when the extent or the weight is out of range, or an encoding step has no output.
   */
  pass(
    encoder: GPUCommandEncoder,
    uploads: GatherUploads,
    sample: VectorSample,
    step: GatherStep,
    output?: GPUTextureView,
  ): void
  /** Destroys the textures it made (the pipelines belong to the device's cache) */
  destroy(): void
}

interface Pipelines {
  readonly linearLayout: GPUBindGroupLayout
  readonly linear: GPURenderPipeline
  readonly velocity: GPUComputePipeline
  readonly tilemax: GPUComputePipeline
  readonly neighbor: GPUComputePipeline
  readonly blurLayout: GPUBindGroupLayout
  readonly only: GPURenderPipeline
  readonly first: GPURenderPipeline
  readonly middle: GPURenderPipeline
  readonly last: GPURenderPipeline
}

/** The pipelines of a device and its formats, built once and shared by every size */
function pipelinesFor(device: GPUDevice, format: GPUTextureFormat, accumulatorFormat: GPUTextureFormat): Promise<Pipelines> {
  return perDevice(device, `vector-blur|${format}|${accumulatorFormat}`, async () => {
    const texture = (binding: number, sampleType: GPUTextureSampleType): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: SHADER_STAGE_FRAGMENT,
      texture: { sampleType },
    })
    const linearLayout = device.createBindGroupLayout({
      label: 'vector-blur-linear-layout',
      entries: [texture(0, 'unfilterable-float')],
    })
    const linearModule = device.createShaderModule({ label: 'vector-blur-linear', code: LINEAR_WGSL })
    const blurLayout = device.createBindGroupLayout({
      label: 'vector-blur-layout',
      entries: [
        {
          binding: 0,
          visibility: SHADER_STAGE_FRAGMENT,
          buffer: { type: 'uniform' as const, hasDynamicOffset: true, minBindingSize: BLUR_UNIFORM_BYTES },
        },
        texture(1, 'unfilterable-float'),
        texture(2, 'float'),
        texture(3, 'float'),
        texture(4, 'unfilterable-float'),
        { binding: 5, visibility: SHADER_STAGE_FRAGMENT, sampler: { type: 'filtering' as const } },
        texture(6, 'unfilterable-float'),
      ],
    })
    const blurModule = device.createShaderModule({ label: 'vector-blur', code: BLUR_WGSL })
    const blurPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [blurLayout] })
    const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
    const blur = (label: string, entryPoint: string, target: GPUTextureFormat, blend?: GPUBlendState) =>
      device.createRenderPipelineAsync({
        label: `vector-blur-${label}`,
        layout: blurPipelineLayout,
        vertex: { module: blurModule, entryPoint: 'vertexMain' },
        fragment: { module: blurModule, entryPoint, targets: [{ format: target, ...(blend ? { blend } : {}) }] },
        primitive: { topology: 'triangle-list' },
      })
    const compute = (label: string, code: string) =>
      device.createComputePipelineAsync({
        label: `vector-blur-${label}`,
        layout: 'auto',
        compute: { module: device.createShaderModule({ label: `vector-blur-${label}`, code }), entryPoint: 'main' },
      })
    const [linear, velocity, tilemax, neighbor, only, first, middle, last] = await Promise.all([
      device.createRenderPipelineAsync({
        label: 'vector-blur-linear',
        layout: device.createPipelineLayout({ bindGroupLayouts: [linearLayout] }),
        vertex: { module: linearModule, entryPoint: 'vertexMain' },
        fragment: { module: linearModule, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
      }),
      compute('velocity', VELOCITY_WGSL),
      compute('tilemax', TILEMAX_WGSL),
      compute('neighbor', NEIGHBOR_WGSL),
      blur('only', 'onlyMain', format),
      blur('first', 'sumMain', accumulatorFormat),
      blur('middle', 'sumMain', accumulatorFormat, { color: add, alpha: add }),
      blur('last', 'lastMain', format),
    ])
    return { linearLayout, linear, velocity, tilemax, neighbor, blurLayout, only, first, middle, last }
  })
}

/** Whether a size is a positive whole number of pixels */
function isSize(size: Size): boolean {
  return Number.isInteger(size.width) && Number.isInteger(size.height) && size.width >= 1 && size.height >= 1
}

/** The tile side in flow pixels: about `TILE_FRAME_PIXELS` frame pixels, at least one flow pixel */
export function tileSideFor(frame: Size, flow: Size): number {
  return Math.max(1, Math.round(TILE_FRAME_PIXELS / (frame.width / flow.width)))
}

/** The arguments of a pass, or a `RangeError` naming what is wrong */
function checkPass(sample: VectorSample, step: GatherStep, output: GPUTextureView | undefined): void {
  if (!Number.isFinite(sample.extent) || sample.extent <= 0) {
    throw new RangeError(`vector blur: a sample's extent must be a number > 0, got ${sample.extent}`)
  }
  if (!Number.isFinite(sample.weight) || sample.weight <= 0 || sample.weight > 1) {
    throw new RangeError(`vector blur: a sample's weight must be in (0, 1], got ${sample.weight}`)
  }
  if ((step === 'only' || step === 'last') && output === undefined) {
    throw new RangeError(`vector blur: a ${step} pass needs an output`)
  }
}

/** A picture the blur was made for: its size, or a `RangeError` */
function checkPicture(picture: GPUTexture, size: Size): void {
  if (picture.width !== size.width || picture.height !== size.height) {
    throw new RangeError(
      `vector blur: the picture is ${picture.width}x${picture.height}, the blur was made for ${size.width}x${size.height}`,
    )
  }
}

/** Which gaps a sample has: 0 both, 1 the gap after only (the file's first frame), 2 the gap before only (its last) */
function velocityMode(sample: VectorSample): 0 | 1 | 2 {
  if (sample.before !== undefined && sample.after !== undefined) return 0
  return sample.after !== undefined ? 1 : 2
}

/**
 * Creates the vector blur for staged frames of `size` in `format` (the pipeline's `rgba16float`), whose gaps are
 * measured at `flowSize` (`OpticalFlow.flowSize`).
 *
 * @throws RangeError when a size is not a positive whole number of pixels.
 */
export async function createVectorBlurStage(
  device: GPUDevice,
  format: GPUTextureFormat,
  size: Size,
  flowSize: Size,
): Promise<VectorBlurStage> {
  if (!isSize(size) || !isSize(flowSize)) {
    throw new RangeError(
      `vector blur: the sizes must be whole pixels, got ${size.width}x${size.height} and flow ${flowSize.width}x${flowSize.height}`,
    )
  }
  const accumulatorFormat = accumulatorFormatFor(device)
  const pipelines = await pipelinesFor(device, format, accumulatorFormat)
  const T = tileSideFor(size, flowSize)
  const tw = Math.ceil(flowSize.width / T)
  const th = Math.ceil(flowSize.height / T)
  const rx = size.width / flowSize.width
  const ry = size.height / flowSize.height
  const owned: GPUTexture[] = []
  const texture = (label: string, s: Size, textureFormat: GPUTextureFormat, usage: number): GPUTexture => {
    const made = device.createTexture({ label, size: { width: s.width, height: s.height }, format: textureFormat, usage })
    owned.push(made)
    return made
  }
  const light = texture('vector-blur-light', size, 'rgba16float', TEXTURE_BINDING | RENDER_ATTACHMENT | COPY_SRC)
  const velocity = texture('vector-blur-velocity', flowSize, 'rgba16float', TEXTURE_BINDING | STORAGE_BINDING | COPY_SRC)
  const tiles = texture('vector-blur-tiles', { width: tw, height: th }, 'rgba16float', TEXTURE_BINDING | STORAGE_BINDING)
  const neighbors = texture('vector-blur-neighbors', { width: tw, height: th }, 'rgba16float', TEXTURE_BINDING | STORAGE_BINDING | COPY_SRC)
  const lightView = light.createView()
  const velocityView = velocity.createView()
  const neighborsView = neighbors.createView()
  let accumulatorView: GPUTextureView | undefined
  const accumulatorOf = (): GPUTextureView => {
    accumulatorView ??= texture(
      'vector-blur-accumulator',
      size,
      accumulatorFormat,
      TEXTURE_BINDING | RENDER_ATTACHMENT | COPY_SRC | COPY_DST,
    ).createView()
    return accumulatorView
  }
  const sampler = device.createSampler({
    label: 'vector-blur-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  // The fixed uniforms (the tiles' and both velocity modes' share one buffer at 256-byte offsets)
  const fixedBytes = new ArrayBuffer(4 * 256)
  const fixed = new DataView(fixedBytes)
  const writeWords = (offset: number, words: readonly (number | { f: number })[]) =>
    words.forEach((word, index) => {
      if (typeof word === 'number') fixed.setUint32(offset + index * 4, word, true)
      else fixed.setFloat32(offset + index * 4, word.f, true)
    })
  for (const mode of [0, 1, 2]) {
    writeWords(mode * 256, [flowSize.width, flowSize.height, mode, 0, { f: rx }, { f: ry }, { f: CONSISTENCY_SIGMA }, { f: 0 }])
  }
  writeWords(3 * 256, [flowSize.width, flowSize.height, T, tw, th, 0, 0, 0])
  const uniforms = device.createBuffer({ label: 'vector-blur-uniforms', size: fixedBytes.byteLength, usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
  device.queue.writeBuffer(uniforms, 0, fixedBytes)
  const tileGroup = (pipeline: GPUComputePipeline, input: GPUTextureView, out: GPUTextureView) =>
    device.createBindGroup({
      label: 'vector-blur-tiles',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms, offset: 3 * 256, size: TILE_UNIFORM_BYTES } },
        { binding: 1, resource: input },
        { binding: 2, resource: out },
      ],
    })
  const tilemaxGroup = tileGroup(pipelines.tilemax, velocityView, tiles.createView())
  const neighborGroup = tileGroup(pipelines.neighbor, tiles.createView(), neighborsView)

  let destroyed = false

  /** The staged picture to linear light, once, into `light` */
  const recordLinear = (encoder: GPUCommandEncoder, pictureView: GPUTextureView): void => {
    const pass = encoder.beginRenderPass({
      label: 'vector-blur-linear',
      colorAttachments: [{ view: lightView, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
    })
    pass.setPipeline(pipelines.linear)
    pass.setBindGroup(
      0,
      device.createBindGroup({ label: 'vector-blur-linear', layout: pipelines.linearLayout, entries: [{ binding: 0, resource: pictureView }] }),
    )
    pass.draw(3)
    pass.end()
  }

  /** The velocity from the gaps (mode 0 both, 1 the gap after only, 2 the gap before only), then the tiles */
  const recordVelocity = (encoder: GPUCommandEncoder, before: FlowPair, after: FlowPair, mode: 0 | 1 | 2): void => {
    const compute = encoder.beginComputePass({ label: 'vector-blur-velocity' })
    compute.setPipeline(pipelines.velocity)
    compute.setBindGroup(
      0,
      device.createBindGroup({
        label: 'vector-blur-velocity',
        layout: pipelines.velocity.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniforms, offset: mode * 256, size: VELOCITY_UNIFORM_BYTES } },
          { binding: 1, resource: { buffer: before.forward } },
          { binding: 2, resource: { buffer: before.backward } },
          { binding: 3, resource: { buffer: after.forward } },
          { binding: 4, resource: { buffer: after.backward } },
          { binding: 5, resource: velocityView },
        ],
      }),
    )
    compute.dispatchWorkgroups(Math.ceil(flowSize.width / 16), Math.ceil(flowSize.height / 16))
    compute.setPipeline(pipelines.tilemax)
    compute.setBindGroup(0, tilemaxGroup)
    compute.dispatchWorkgroups(Math.ceil(tw / 8), Math.ceil(th / 8))
    compute.setPipeline(pipelines.neighbor)
    compute.setBindGroup(0, neighborGroup)
    compute.dispatchWorkgroups(Math.ceil(tw / 8), Math.ceil(th / 8))
    compute.end()
  }

  /** The blur's uniform: the sizes and tiles, then the half extent (0: no motion), the limits and the weight */
  const blurWords = (halfExtent: number, weight: number): Uint8Array => {
    const words = new ArrayBuffer(BLUR_UNIFORM_BYTES)
    const view = new DataView(words)
    ;[size.width, size.height, flowSize.width, flowSize.height, tw, th, T, 0].forEach((word, index) =>
      view.setUint32(index * 4, word, true),
    )
    ;[rx, ry, halfExtent, MAX_BLUR_RADIUS, TAP_SPACING, MAX_TAPS, weight, 0].forEach((word, index) =>
      view.setFloat32(32 + index * 4, word, true),
    )
    return new Uint8Array(words)
  }

  /** The blur pass of the gather's `step` into `target` */
  const recordBlur = (
    encoder: GPUCommandEncoder,
    uploads: GatherUploads,
    pictureView: GPUTextureView,
    words: Uint8Array,
    step: GatherStep,
    target: GPUTextureView,
  ): void => {
    const range = uploads.upload(words)
    const pass = encoder.beginRenderPass({
      label: `vector-blur-${step}`,
      colorAttachments: [
        { view: target, loadOp: step === 'middle' ? 'load' : 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' },
      ],
    })
    pass.setPipeline(pipelines[step])
    pass.setBindGroup(
      0,
      device.createBindGroup({
        label: 'vector-blur',
        layout: pipelines.blurLayout,
        entries: [
          { binding: 0, resource: { buffer: range.buffer, offset: 0, size: BLUR_UNIFORM_BYTES } },
          { binding: 1, resource: pictureView },
          { binding: 2, resource: lightView },
          { binding: 3, resource: velocityView },
          { binding: 4, resource: neighborsView },
          { binding: 5, resource: sampler },
          // the accumulator is read only by the last pass; it cannot be bound while it is the pass's target
          { binding: 6, resource: step === 'last' ? accumulatorOf() : pictureView },
        ],
      }),
      [range.offset],
    )
    pass.draw(3)
    pass.end()
  }

  return {
    size: { width: size.width, height: size.height },
    flowSize: { width: flowSize.width, height: flowSize.height },
    accumulatorFormat,
    pass(encoder, uploads, sample, step, output) {
      if (destroyed) throw new Error('vector blur: used after destroy')
      checkPass(sample, step, output)
      checkPicture(sample.picture, size)
      const pictureView = sample.picture.createView()
      recordLinear(encoder, pictureView)
      const before = sample.before ?? sample.after
      const after = sample.after ?? sample.before
      // no gap at all (a one-frame file): no motion, the half extent 0
      const moving = before !== undefined && after !== undefined
      if (moving) recordVelocity(encoder, before, after, velocityMode(sample))
      const target = step === 'only' || step === 'last' ? output! : accumulatorOf()
      recordBlur(encoder, uploads, pictureView, blurWords(moving ? sample.extent / 2 : 0, sample.weight), step, target)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      for (const made of owned) made.destroy()
      uniforms.destroy()
    },
  }
}
