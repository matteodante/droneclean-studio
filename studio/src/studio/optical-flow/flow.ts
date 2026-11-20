// The optical flow on the render device (task 11.12): the probe's compute passes (`bench/flow-probe/probe-page.mjs`)
// on the pipeline's textures. For one frame size it holds the pyramids and the scratch buffers, built once, and two
// steps the stage pipeline records into its own encoder:
//
//   measure       the flows of one source gap, both ways, at the flow's size (`flowSizeFor`): two luma pyramids, then
//                 per direction a coarse-to-fine Lucas-Kanade (warp, solve, median, per round). The finest level's two
//                 flows are copied into a `GapFlow` the caller keeps for every output frame inside that gap;
//   interpolate   the frame at a phase between the gap's two frames, from them and the gap's flows, drawn into the
//                 caller's `rgba16float` texture.
//
// Every uniform but the phase is fixed by the size, so the scratch buffers' bind groups are made once; the frames'
// bind groups and the phase's uniform (in the caller's frame arena) are made per call.

import { perDevice } from '@/studio/render/device-cache'
import { FLOW_KERNELS, INTERPOLATE_WGSL, type FlowKernel } from './kernels'
import {
  CONSISTENCY_SIGMA,
  flowLevels,
  flowScaleFor,
  flowSizeFor,
  levelWork,
  LK_MAX_STEP,
  type FlowFrameSize,
} from './scale'

// The WebGPU usage flags, as the spec numbers them (spelled out so the module loads where there is no GPU).
const BUFFER_COPY_SRC = 0x0004
const BUFFER_COPY_DST = 0x0008
const BUFFER_UNIFORM = 0x0040
const BUFFER_STORAGE = 0x0080
const SHADER_STAGE_FRAGMENT = 0x2

const SCRATCH_USAGE = BUFFER_STORAGE | BUFFER_COPY_SRC | BUFFER_COPY_DST
/** A gap's flows: read by the interpolation, written by a copy, copied out by a test */
const GAP_USAGE = BUFFER_STORAGE | BUFFER_COPY_SRC | BUFFER_COPY_DST

/** Every compute kernel's workgroup side (16 x 16), and the 1-D `zero` kernel's width */
const WORKGROUP = 16
const WORKGROUP_1D = 256
/** Each fixed uniform sits at its own multiple of the largest uniform offset alignment WebGPU allows */
const UNIFORM_STRIDE = 256
/** The interpolation's uniform: eight 32-bit words */
const INTERPOLATE_UNIFORM_BYTES = 32

/** The flows of one source gap, both ways, at the flow's size: what the cache keeps and the interpolation reads */
export interface GapFlow {
  /** From the gap's first frame to its second, in the first frame's coordinates (pixels of the flow's size) */
  readonly forward: GPUBuffer
  /** From the second frame to the first, in the second frame's coordinates */
  readonly backward: GPUBuffer
  destroy(): void
}

/** Where the interpolation's phase goes: the pipeline's frame arena, whose ranges keep their bytes until the frame is done */
export interface FlowUploads {
  upload(data: ArrayBufferView): { readonly buffer: GPUBuffer; readonly offset: number; readonly size: number }
}

/** The optical flow of one frame size; see the file's header */
export interface OpticalFlow {
  /** The frames' size */
  readonly frameSize: FlowFrameSize
  /** The flow's size: `flowSizeFor(frameSize)` */
  readonly flowSize: FlowFrameSize
  /**
   * Records the flows of the gap from `first` to `second` (two `rgba16float` textures of `frameSize`) into `encoder`
   * and returns them. The caller owns the result and destroys it when the gap is passed.
   */
  measure(encoder: GPUCommandEncoder, first: GPUTexture, second: GPUTexture): GapFlow
  /**
   * Records the frame at `phase` (in (0, 1)) between `first` and `second` into `output`, a render attachment of
   * `frameSize` in the pipeline's format, from the gap's flows.
   *
   * @throws RangeError when `phase` is not inside (0, 1).
   */
  interpolate(
    encoder: GPUCommandEncoder,
    uploads: FlowUploads,
    first: GPUTexture,
    second: GPUTexture,
    gap: GapFlow,
    phase: number,
    output: GPUTextureView,
  ): void
  /** Destroys the pyramids and scratch buffers (the pipelines belong to the device's cache) */
  destroy(): void
}

interface Pipelines {
  readonly compute: Readonly<Record<FlowKernel, GPUComputePipeline>>
  readonly interpolateLayout: GPUBindGroupLayout
  readonly interpolate: GPURenderPipeline
}

/** The kernels of a device and output format, compiled once and shared by every size */
function pipelinesFor(device: GPUDevice, format: GPUTextureFormat): Promise<Pipelines> {
  return perDevice(device, `optical-flow|${format}`, async () => {
    const names = Object.keys(FLOW_KERNELS) as FlowKernel[]
    const built = await Promise.all(
      names.map((name) =>
        device.createComputePipelineAsync({
          label: `optical-flow-${name}`,
          layout: 'auto',
          compute: {
            module: device.createShaderModule({ label: `optical-flow-${name}`, code: FLOW_KERNELS[name] }),
            entryPoint: 'main',
          },
        }),
      ),
    )
    const compute = Object.fromEntries(names.map((name, index) => [name, built[index]!])) as Record<
      FlowKernel,
      GPUComputePipeline
    >
    const texture = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: SHADER_STAGE_FRAGMENT,
      texture: { sampleType: 'unfilterable-float' as const },
    })
    const storage = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: SHADER_STAGE_FRAGMENT,
      buffer: { type: 'read-only-storage' as const },
    })
    const interpolateLayout = device.createBindGroupLayout({
      label: 'optical-flow-interpolate-layout',
      entries: [
        {
          binding: 0,
          visibility: SHADER_STAGE_FRAGMENT,
          buffer: { type: 'uniform' as const, hasDynamicOffset: true, minBindingSize: INTERPOLATE_UNIFORM_BYTES },
        },
        texture(1),
        texture(2),
        storage(3),
        storage(4),
      ],
    })
    const module = device.createShaderModule({ label: 'optical-flow-interpolate', code: INTERPOLATE_WGSL })
    const interpolate = await device.createRenderPipelineAsync({
      label: 'optical-flow-interpolate',
      layout: device.createPipelineLayout({ bindGroupLayouts: [interpolateLayout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
    return { compute, interpolateLayout, interpolate }
  })
}

/** One uniform's words: a plain number is a u32; `{ i }` an i32, `{ f }` an f32 */
type Word = number | { readonly i: number } | { readonly f: number }

function writeWords(view: DataView, offset: number, words: readonly Word[]): void {
  words.forEach((word, index) => {
    const at = offset + index * 4
    if (typeof word === 'number') view.setUint32(at, word, true)
    else if ('i' in word) view.setInt32(at, word.i, true)
    else view.setFloat32(at, word.f, true)
  })
}

/** One dispatch: its kernel, its uniform's words, its storage buffers (bindings 1..), and its grid in pixels */
interface Dispatch {
  readonly kernel: FlowKernel
  readonly words: readonly Word[]
  readonly buffers: readonly GPUBuffer[]
  readonly width: number
  readonly height: number
  readonly oneD?: boolean
}

/** A dispatch ready to record */
interface Recorded {
  readonly pipeline: GPUComputePipeline
  readonly group: GPUBindGroup
  readonly x: number
  readonly y: number
}

/** A level's pyramid of luma and the per-direction buffers the solve needs */
interface Plan {
  readonly levels: readonly FlowFrameSize[]
  readonly pyramids: readonly [GPUBuffer[], GPUBuffer[]]
  /** Each direction's flow at every level; level 0 is what a gap keeps (copied out) */
  readonly flows: readonly [GPUBuffer[], GPUBuffer[]]
  readonly scratch: readonly GPUBuffer[]
}

function assertFrame(texture: GPUTexture, size: FlowFrameSize, which: string): void {
  if (texture.width !== size.width || texture.height !== size.height) {
    throw new RangeError(
      `optical flow: the ${which} frame is ${texture.width}x${texture.height}, the flow was made for ${size.width}x${size.height}`,
    )
  }
}

/**
 * Creates the optical flow for frames of `frameSize`, drawing interpolated frames in `format` (the pipeline's
 * `rgba16float`).
 *
 * @throws RangeError when the size is not a positive whole number of pixels.
 */
export async function createOpticalFlow(
  device: GPUDevice,
  format: GPUTextureFormat,
  frameSize: FlowFrameSize,
): Promise<OpticalFlow> {
  const flowSize = flowSizeFor(frameSize)
  const pipelines = await pipelinesFor(device, format)
  const levels = flowLevels(flowSize)
  const owned: GPUBuffer[] = []
  const buffer = (bytes: number, label: string, usage = SCRATCH_USAGE): GPUBuffer => {
    const made = device.createBuffer({ label, size: Math.max(16, bytes), usage })
    owned.push(made)
    return made
  }
  const perLevel = (bytesPerPixel: number, label: string) =>
    levels.map(({ width, height }, level) => buffer(width * height * bytesPerPixel, `${label}-${level}`))
  const plan: Plan = {
    levels,
    pyramids: [perLevel(4, 'optical-flow-luma-0'), perLevel(4, 'optical-flow-luma-1')],
    flows: [perLevel(8, 'optical-flow-forward'), perLevel(8, 'optical-flow-backward')],
    // gradient, temporal difference and the solve's output: one set serves both directions, which run one after the other
    scratch: [perLevel(8, 'optical-flow-gradient'), perLevel(4, 'optical-flow-difference'), perLevel(8, 'optical-flow-step')].flat(),
  }
  const count = levels.length
  const gradient = (level: number) => plan.scratch[level]!
  const difference = (level: number) => plan.scratch[count + level]!
  const step = (level: number) => plan.scratch[2 * count + level]!

  // The fixed dispatches: the pyramids above level 0, and each direction's solve
  const fixed: Dispatch[] = []
  const pyramidDispatches: Dispatch[] = []
  for (const frame of [0, 1] as const) {
    for (let level = 0; level + 1 < count; level += 1) {
      const from = levels[level]!
      const to = levels[level + 1]!
      pyramidDispatches.push({
        kernel: 'down',
        words: [from.width, from.height, to.width, to.height],
        buffers: [plan.pyramids[frame][level]!, plan.pyramids[frame][level + 1]!],
        width: to.width,
        height: to.height,
      })
    }
  }
  const directionDispatches = ([0, 1] as const).map((direction) => {
    const a = plan.pyramids[direction]
    const b = plan.pyramids[1 - direction]!
    const flow = plan.flows[direction]
    const list: Dispatch[] = []
    for (let level = count - 1; level >= 0; level -= 1) {
      const { width, height } = levels[level]!
      if (level === count - 1) {
        list.push({ kernel: 'zero', words: [width * height, 0, 0, 0], buffers: [flow[level]!], width: width * height, height: 1, oneD: true })
      } else {
        const coarse = levels[level + 1]!
        list.push({
          kernel: 'up',
          words: [width, height, coarse.width, coarse.height],
          buffers: [flow[level + 1]!, flow[level]!],
          width,
          height,
        })
      }
      list.push({ kernel: 'grad', words: [width, height, 0, 0], buffers: [a[level]!, gradient(level)], width, height })
      const { rounds, radius } = levelWork(level, count)
      for (let round = 0; round < rounds; round += 1) {
        list.push({
          kernel: 'warpdiff',
          words: [width, height, 0, 0],
          buffers: [a[level]!, b[level]!, flow[level]!, difference(level)],
          width,
          height,
        })
        list.push({
          kernel: 'lk',
          words: [width, height, { i: radius }, { f: LK_MAX_STEP }],
          buffers: [gradient(level), difference(level), flow[level]!, step(level)],
          width,
          height,
        })
        list.push({ kernel: 'median', words: [width, height, 0, 0], buffers: [step(level), flow[level]!], width, height })
      }
    }
    return list
  })
  fixed.push(...pyramidDispatches, ...directionDispatches.flat())

  // One buffer holds every fixed uniform, each at its own 256-byte offset; the two luma passes' uniforms come last
  const lumaWords: Word[] = [frameSize.width, frameSize.height, flowSize.width, flowSize.height, flowScaleFor(frameSize), 0, 0, 0]
  const uniformBytes = new ArrayBuffer((fixed.length + 1) * UNIFORM_STRIDE)
  const uniformView = new DataView(uniformBytes)
  fixed.forEach((dispatch, index) => writeWords(uniformView, index * UNIFORM_STRIDE, dispatch.words))
  const lumaOffset = fixed.length * UNIFORM_STRIDE
  writeWords(uniformView, lumaOffset, lumaWords)
  const uniforms = buffer(uniformBytes.byteLength, 'optical-flow-uniforms', BUFFER_UNIFORM | BUFFER_COPY_DST)
  device.queue.writeBuffer(uniforms, 0, uniformBytes)

  const recordedOf = (dispatch: Dispatch, index: number): Recorded => {
    const pipeline = pipelines.compute[dispatch.kernel]
    return {
      pipeline,
      group: device.createBindGroup({
        label: `optical-flow-${dispatch.kernel}`,
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniforms, offset: index * UNIFORM_STRIDE, size: 16 * Math.ceil((dispatch.words.length * 4) / 16) } },
          ...dispatch.buffers.map((resource, slot) => ({ binding: slot + 1, resource: { buffer: resource } })),
        ],
      }),
      x: dispatch.oneD ? Math.ceil(dispatch.width / WORKGROUP_1D) : Math.ceil(dispatch.width / WORKGROUP),
      y: dispatch.oneD ? 1 : Math.ceil(dispatch.height / WORKGROUP),
    }
  }
  const recorded = fixed.map(recordedOf)
  const pyramidRecorded = recorded.slice(0, pyramidDispatches.length)
  const backwardStart = pyramidDispatches.length + directionDispatches[0]!.length
  const directionRecorded = [
    recorded.slice(pyramidDispatches.length, backwardStart),
    recorded.slice(backwardStart),
  ] as const
  const finestBytes = flowSize.width * flowSize.height * 8

  const lumaGroup = (frame: GPUTexture, into: GPUBuffer): Recorded => ({
    pipeline: pipelines.compute.luma,
    group: device.createBindGroup({
      label: 'optical-flow-luma',
      layout: pipelines.compute.luma.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms, offset: lumaOffset, size: 32 } },
        { binding: 1, resource: frame.createView() },
        { binding: 2, resource: { buffer: into } },
      ],
    }),
    x: Math.ceil(flowSize.width / WORKGROUP),
    y: Math.ceil(flowSize.height / WORKGROUP),
  })

  const run = (encoder: GPUCommandEncoder, label: string, list: readonly Recorded[]): void => {
    const pass = encoder.beginComputePass({ label })
    for (const item of list) {
      pass.setPipeline(item.pipeline)
      pass.setBindGroup(0, item.group)
      pass.dispatchWorkgroups(item.x, item.y)
    }
    pass.end()
  }

  let destroyed = false
  return {
    frameSize: { width: frameSize.width, height: frameSize.height },
    flowSize,
    measure(encoder, first, second) {
      if (destroyed) throw new Error('optical flow: used after destroy')
      assertFrame(first, frameSize, 'first')
      assertFrame(second, frameSize, 'second')
      run(encoder, 'optical-flow-pyramids', [
        lumaGroup(first, plan.pyramids[0][0]!),
        lumaGroup(second, plan.pyramids[1][0]!),
        ...pyramidRecorded,
      ])
      const forward = device.createBuffer({ label: 'optical-flow-gap-forward', size: Math.max(16, finestBytes), usage: GAP_USAGE })
      const backward = device.createBuffer({ label: 'optical-flow-gap-backward', size: Math.max(16, finestBytes), usage: GAP_USAGE })
      run(encoder, 'optical-flow-forward', directionRecorded[0])
      encoder.copyBufferToBuffer(plan.flows[0][0]!, 0, forward, 0, finestBytes)
      run(encoder, 'optical-flow-backward', directionRecorded[1])
      encoder.copyBufferToBuffer(plan.flows[1][0]!, 0, backward, 0, finestBytes)
      return {
        forward,
        backward,
        destroy() {
          forward.destroy()
          backward.destroy()
        },
      }
    },
    interpolate(encoder, uploads, first, second, gap, phase, output) {
      if (destroyed) throw new Error('optical flow: used after destroy')
      if (!(phase > 0 && phase < 1)) {
        throw new RangeError(`optical flow: a phase must be inside (0, 1), got ${phase}`)
      }
      assertFrame(first, frameSize, 'first')
      assertFrame(second, frameSize, 'second')
      const bytes = new ArrayBuffer(INTERPOLATE_UNIFORM_BYTES)
      writeWords(new DataView(bytes), 0, [
        frameSize.width,
        frameSize.height,
        flowSize.width,
        flowSize.height,
        { f: phase },
        { f: CONSISTENCY_SIGMA },
        { f: frameSize.width / flowSize.width },
        { f: frameSize.height / flowSize.height },
      ])
      const range = uploads.upload(new Uint8Array(bytes))
      const pass = encoder.beginRenderPass({
        label: 'optical-flow-interpolate',
        colorAttachments: [{ view: output, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
      })
      pass.setPipeline(pipelines.interpolate)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          label: 'optical-flow-interpolate',
          layout: pipelines.interpolateLayout,
          entries: [
            { binding: 0, resource: { buffer: range.buffer, offset: 0, size: INTERPOLATE_UNIFORM_BYTES } },
            { binding: 1, resource: first.createView() },
            { binding: 2, resource: second.createView() },
            { binding: 3, resource: { buffer: gap.forward } },
            { binding: 4, resource: { buffer: gap.backward } },
          ],
        }),
        [range.offset],
      )
      pass.draw(3)
      pass.end()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      for (const made of owned) made.destroy()
    },
  }
}
