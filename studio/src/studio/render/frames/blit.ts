// One full-screen pass that copies a picture into a source-frame texture (design 3.6 section 2.4). A browser decoder's
// frame can only enter the GPU as 8-bit (`copyExternalImageToTexture` into `rgba8unorm`), and the native path's
// source pass writes one texture it overwrites with the next frame; both go through this blit into a fresh
// `rgba16float` texture the provider can keep. `textureLoad` at the pixel: no sampler, no resampling, alpha 1.

import { perDevice } from '@/studio/render/device-cache'
import { PRECISE_RENDER_FORMAT } from '@/studio/render/precise/contract'
import { reductionTaps } from '@/studio/render/stages/reduce-frame'

const BLIT_WGSL = /* wgsl */ `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@group(0) @binding(0) var picture: texture_2d<f32>;

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(picture));
  let pixel = clamp(vec2i(position.xy), vec2i(0), dimensions - vec2i(1));
  return vec4f(textureLoad(picture, pixel, 0).rgb, 1.0);
}
`

// The WebGPU usage flags, as the spec numbers them (read at call time by `GPUTextureUsage` in a browser, spelled out
// here so the module loads where there is no GPU, as arena.ts does).
const COPY_SRC = 0x01
const COPY_DST = 0x02
const TEXTURE_BINDING = 0x04
const RENDER_ATTACHMENT = 0x10
const SHADER_STAGE_FRAGMENT = 0x2

/** The usage of every texture the provider hands out: a stage samples it, a stage or a test may copy it. */
const SOURCE_FRAME_USAGE = TEXTURE_BINDING | RENDER_ATTACHMENT | COPY_SRC

/** The descriptor of a source-frame texture at the file's size: `rgba16float`, one mip level. */
export function sourceFrameTextureDescriptor(width: number, height: number): GPUTextureDescriptor {
  return {
    label: 'source-frame',
    size: { width, height },
    format: PRECISE_RENDER_FORMAT,
    usage: SOURCE_FRAME_USAGE,
  }
}

/** The 8-bit texture a browser frame is copied into before the blit. */
export function stagingTextureDescriptor(width: number, height: number): GPUTextureDescriptor {
  return {
    label: 'source-frame-staging',
    size: { width, height },
    format: 'rgba8unorm',
    usage: TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT,
  }
}

interface BlitPipeline {
  readonly pipeline: GPURenderPipeline
  readonly layout: GPUBindGroupLayout
}

function blitPipeline(device: GPUDevice): BlitPipeline {
  return perDevice(device, 'source-frame-blit', () => {
    const module = device.createShaderModule({ label: 'source-frame-blit', code: BLIT_WGSL })
    const layout = device.createBindGroupLayout({
      label: 'source-frame-blit-layout',
      entries: [
        {
          binding: 0,
          visibility: SHADER_STAGE_FRAGMENT,
          texture: { sampleType: 'unfilterable-float' as const },
        },
      ],
    })
    const pipeline = device.createRenderPipeline({
      label: 'source-frame-blit',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: PRECISE_RENDER_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    })
    return { pipeline, layout }
  })
}

/**
 * Draws `source` into `target` (same size, `rgba16float`) and submits. Queue order does the synchronization: a
 * `copyExternalImageToTexture` into `source` before this call, and another write into it after, see the right data.
 */
export function blitToSourceFrame(device: GPUDevice, source: GPUTexture, target: GPUTexture): void {
  const { pipeline, layout } = blitPipeline(device)
  const encoder = device.createCommandEncoder({ label: 'source-frame-blit' })
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target.createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      label: 'source-frame-blit-bindings',
      layout,
      entries: [{ binding: 0, resource: source.createView() }],
    }),
  )
  pass.draw(3)
  pass.end()
  device.queue.submit([encoder.finish()])
}

// The preview's upload (design 3.6 section 2.4, wave 18): a decoder's `VideoFrame` is imported as an external texture and
// widened into the source-frame texture by one pass, with no 2D canvas and no staging copy. What the browser hands the
// shader depends on the frame: an 8-bit frame arrives as the file's code values, but a 10-bit frame (the Avata 2's) has
// its BT.709 transfer converted to sRGB on the way in, which is 10 to 14 levels brighter than the code values the input
// colour stage decodes. `correct` undoes that conversion in float (sRGB decode, then a power of 0.51). Which of the two
// a file needs is not assumed: `probeUploads` compares the first frame against the canvas picture the exports use, and
// `chooseUpload` decides (`webcodecs.ts`).

const EXTERNAL_WGSL = /* wgsl */ `
override correct: bool = false;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@group(0) @binding(0) var picture: texture_external;

fn srgbToLinear(v: vec3f) -> vec3f {
  return select(pow((v + 0.055) / 1.055, vec3f(2.4)), v / 12.92, v <= vec3f(0.04045));
}

// The browser's conversion of a BT.709 frame to sRGB is sRGB-encode(code ^ 1.961): measured on a 10-bit grey ramp, the
// canvas picture against the external texture, within 0.6 level at every step. Undone here as a power of 0.51.
fn undoTransfer(l: vec3f) -> vec3f {
  return pow(l, vec3f(0.51));
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = vec2i(textureDimensions(picture));
  let pixel = clamp(vec2i(position.xy), vec2i(0), dimensions - vec2i(1));
  var rgb = clamp(textureLoad(picture, pixel).rgb, vec3f(0.0), vec3f(1.0));
  if (correct) {
    rgb = undoTransfer(srgbToLinear(rgb));
  }
  return vec4f(rgb, 1.0);
}
`

/** Whether the external upload undoes the browser's transfer conversion (`corrected`) or keeps what it hands over. */
export type ExternalConversion = 'plain' | 'corrected'

interface ExternalPipelines {
  readonly layout: GPUBindGroupLayout
  readonly plain: GPURenderPipeline
  readonly corrected: GPURenderPipeline
}

function externalPipelines(device: GPUDevice): ExternalPipelines {
  return perDevice(device, 'source-frame-external-blit', () => {
    const module = device.createShaderModule({ label: 'source-frame-external-blit', code: EXTERNAL_WGSL })
    const layout = device.createBindGroupLayout({
      label: 'source-frame-external-blit-layout',
      entries: [{ binding: 0, visibility: SHADER_STAGE_FRAGMENT, externalTexture: {} }],
    })
    const make = (correct: boolean): GPURenderPipeline =>
      device.createRenderPipeline({
        label: `source-frame-external-blit-${correct ? 'corrected' : 'plain'}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: {
          module,
          entryPoint: 'fragmentMain',
          constants: { correct: correct ? 1 : 0 },
          targets: [{ format: PRECISE_RENDER_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      })
    return { layout, plain: make(false), corrected: make(true) }
  })
}

/**
 * Draws a decoder's frame into `target` (the frame's size, `rgba16float`) and submits. The frame may be closed as soon
 * as this returns: the browser keeps what the submitted pass reads.
 */
export function blitExternalToSourceFrame(
  device: GPUDevice,
  frame: VideoFrame,
  target: GPUTexture,
  conversion: ExternalConversion,
): void {
  const pipelines = externalPipelines(device)
  const encoder = device.createCommandEncoder({ label: 'source-frame-external-blit' })
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target.createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(pipelines[conversion])
  pass.setBindGroup(
    0,
    device.createBindGroup({
      label: 'source-frame-external-blit-bindings',
      layout: pipelines.layout,
      entries: [{ binding: 0, resource: device.importExternalTexture({ source: frame, colorSpace: 'srgb' }) }],
    }),
  )
  pass.draw(3)
  pass.end()
  device.queue.submit([encoder.finish()])
}

// The same upload straight to a preview's reduced size (design 8.10): each output pixel the mean of the source block it
// covers, taken with bilinear taps of the external texture (as `render/stages/reduce-frame.ts` does for a texture), and
// the transfer conversion undone on each tap before the mean, so a corrected file is averaged in the code values the
// canvas picture would have had. One pass at the small size instead of a full-size widening and a reduction.

const EXTERNAL_REDUCE_WGSL = /* wgsl */ `
override correct: bool = false;

struct Reduction {
  scale: vec2f,
  taps: vec2u,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@group(0) @binding(0) var picture: texture_external;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> reduction: Reduction;

fn srgbToLinear(v: vec3f) -> vec3f {
  return select(pow((v + 0.055) / 1.055, vec3f(2.4)), v / 12.92, v <= vec3f(0.04045));
}

fn undoTransfer(l: vec3f) -> vec3f {
  return pow(l, vec3f(0.51));
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(picture));
  let start = floor(position.xy) * reduction.scale;
  let taps = vec2f(reduction.taps);
  let step = reduction.scale / taps;
  var sum = vec3f(0.0);
  for (var y = 0u; y < reduction.taps.y; y += 1u) {
    for (var x = 0u; x < reduction.taps.x; x += 1u) {
      let at = start + (vec2f(f32(x), f32(y)) + 0.5) * step;
      var rgb = clamp(textureSampleBaseClampToEdge(picture, linearSampler, at / size).rgb, vec3f(0.0), vec3f(1.0));
      if (correct) {
        rgb = undoTransfer(srgbToLinear(rgb));
      }
      sum += rgb;
    }
  }
  return vec4f(sum / (taps.x * taps.y), 1.0);
}
`

const BUFFER_UNIFORM = 0x0040

interface ExternalReducePipelines {
  readonly layout: GPUBindGroupLayout
  readonly sampler: GPUSampler
  readonly plain: GPURenderPipeline
  readonly corrected: GPURenderPipeline
}

function externalReducePipelines(device: GPUDevice): ExternalReducePipelines {
  return perDevice(device, 'source-frame-external-reduce', () => {
    const module = device.createShaderModule({ label: 'source-frame-external-reduce', code: EXTERNAL_REDUCE_WGSL })
    const layout = device.createBindGroupLayout({
      label: 'source-frame-external-reduce-layout',
      entries: [
        { binding: 0, visibility: SHADER_STAGE_FRAGMENT, externalTexture: {} },
        { binding: 1, visibility: SHADER_STAGE_FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: SHADER_STAGE_FRAGMENT, buffer: { type: 'uniform' } },
      ],
    })
    const make = (correct: boolean): GPURenderPipeline =>
      device.createRenderPipeline({
        label: `source-frame-external-reduce-${correct ? 'corrected' : 'plain'}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: {
          module,
          entryPoint: 'fragmentMain',
          constants: { correct: correct ? 1 : 0 },
          targets: [{ format: PRECISE_RENDER_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      })
    const sampler = device.createSampler({ label: 'source-frame-external-reduce', magFilter: 'linear', minFilter: 'linear' })
    return { layout, sampler, plain: make(false), corrected: make(true) }
  })
}

/** The pass's scale and taps for a frame of `natural` size into `target`, one uniform per pair of sizes and device */
function reductionUniform(device: GPUDevice, natural: { width: number; height: number }, target: GPUTexture): GPUBuffer {
  return perDevice(device, `source-frame-external-reduce:${natural.width}x${natural.height}>${target.width}x${target.height}`, () => {
    const scaleX = natural.width / target.width
    const scaleY = natural.height / target.height
    const bytes = new ArrayBuffer(16)
    new Float32Array(bytes, 0, 2).set([scaleX, scaleY])
    new Uint32Array(bytes, 8, 2).set([reductionTaps(scaleX), reductionTaps(scaleY)])
    const buffer = device.createBuffer({
      label: 'source-frame-external-reduce',
      size: 16,
      usage: BUFFER_UNIFORM | COPY_DST_BUFFER,
    })
    device.queue.writeBuffer(buffer, 0, bytes)
    return buffer
  })
}

/**
 * Draws a decoder's frame of `natural` size into `target`, a smaller `rgba16float` texture, each pixel the mean of the
 * block it covers, and submits. The frame may be closed as soon as this returns.
 */
export function blitExternalReducedToSourceFrame(
  device: GPUDevice,
  frame: VideoFrame,
  natural: { width: number; height: number },
  target: GPUTexture,
  conversion: ExternalConversion,
): void {
  const pipelines = externalReducePipelines(device)
  const encoder = device.createCommandEncoder({ label: 'source-frame-external-reduce' })
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: target.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' },
    ],
  })
  pass.setPipeline(pipelines[conversion])
  pass.setBindGroup(
    0,
    device.createBindGroup({
      label: 'source-frame-external-reduce-bindings',
      layout: pipelines.layout,
      entries: [
        { binding: 0, resource: device.importExternalTexture({ source: frame, colorSpace: 'srgb' }) },
        { binding: 1, resource: pipelines.sampler },
        { binding: 2, resource: { buffer: reductionUniform(device, natural, target) } },
      ],
    }),
  )
  pass.draw(3)
  pass.end()
  device.queue.submit([encoder.finish()])
}

/** Points per side of the probe's grid. */
const PROBE_GRID = 32
/** The probe's three panels side by side: the canvas picture, the external upload as it is, and that upload corrected. */
const PROBE_WIDTH = PROBE_GRID * 3
const PROBE_BYTES_PER_ROW = PROBE_WIDTH * 8
const MAP_READ = 0x0001
const COPY_DST_BUFFER = 0x0008

const PROBE_WGSL = /* wgsl */ `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@group(0) @binding(0) var canvasPicture: texture_2d<f32>;
@group(0) @binding(1) var uploaded: texture_2d<f32>;

fn srgbToLinear(v: vec3f) -> vec3f {
  return select(pow((v + 0.055) / 1.055, vec3f(2.4)), v / 12.92, v <= vec3f(0.04045));
}

// The browser's conversion of a BT.709 frame to sRGB is sRGB-encode(code ^ 1.961): measured on a 10-bit grey ramp, the
// canvas picture against the external texture, within 0.6 level at every step. Undone here as a power of 0.51.
fn undoTransfer(l: vec3f) -> vec3f {
  return pow(l, vec3f(0.51));
}

// A point of the grid, inside the picture's middle 80 %
fn gridPixel(cell: vec2f, dimensions: vec2i) -> vec2i {
  let unit = (cell + 0.5) / ${PROBE_GRID}.0;
  return clamp(vec2i((0.1 + 0.8 * unit) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let panel = i32(position.x) / ${PROBE_GRID};
  let cell = vec2f(f32(i32(position.x) % ${PROBE_GRID}), position.y - 0.5);
  if (panel == 0) {
    return vec4f(textureLoad(canvasPicture, gridPixel(cell, vec2i(textureDimensions(canvasPicture))), 0).rgb, 1.0);
  }
  let rgb = clamp(textureLoad(uploaded, gridPixel(cell, vec2i(textureDimensions(uploaded))), 0).rgb, vec3f(0.0), vec3f(1.0));
  if (panel == 1) {
    return vec4f(rgb, 1.0);
  }
  return vec4f(undoTransfer(srgbToLinear(rgb)), 1.0);
}
`

interface ProbePipeline {
  readonly pipeline: GPURenderPipeline
  readonly layout: GPUBindGroupLayout
}

function probePipeline(device: GPUDevice): ProbePipeline {
  return perDevice(device, 'source-frame-upload-probe', () => {
    const module = device.createShaderModule({ label: 'source-frame-upload-probe', code: PROBE_WGSL })
    const layout = device.createBindGroupLayout({
      label: 'source-frame-upload-probe-layout',
      entries: [0, 1].map((binding) => ({
        binding,
        visibility: SHADER_STAGE_FRAGMENT,
        texture: { sampleType: 'unfilterable-float' as const },
      })),
    })
    const pipeline = device.createRenderPipeline({
      label: 'source-frame-upload-probe',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: PRECISE_RENDER_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    })
    return { pipeline, layout }
  })
}

/** The same grid of points of a frame as three pictures, in 0 to 255 levels, three values per point (R, G, B). */
export interface UploadProbe {
  /** The canvas picture, the one exports are made from. */
  readonly canvas: Float32Array
  /** The external upload as the browser handed it over. */
  readonly plain: Float32Array
  /** The same upload with the transfer conversion undone. */
  readonly corrected: Float32Array
}

/** Half-precision bits to a number. */
function halfToNumber(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >> 10) & 0x1f
  const fraction = bits & 0x3ff
  if (exponent === 0) return sign * fraction * 2 ** -24
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15)
}

/**
 * Samples the canvas picture (`rgba8unorm`) and the external upload (`rgba16float`) of one frame at the same grid of
 * points, and reads the three panels back: a few kilobytes, one wait on the GPU.
 */
export async function probeUploads(
  device: GPUDevice,
  canvasPicture: GPUTexture,
  uploaded: GPUTexture,
): Promise<UploadProbe> {
  const { pipeline, layout } = probePipeline(device)
  const panels = device.createTexture({
    label: 'source-frame-upload-probe-panels',
    size: { width: PROBE_WIDTH, height: PROBE_GRID },
    format: PRECISE_RENDER_FORMAT,
    usage: RENDER_ATTACHMENT | COPY_SRC,
  })
  const readback = device.createBuffer({
    label: 'source-frame-upload-probe-readback',
    size: PROBE_BYTES_PER_ROW * PROBE_GRID,
    usage: MAP_READ | COPY_DST_BUFFER,
  })
  try {
    const encoder = device.createCommandEncoder({ label: 'source-frame-upload-probe' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: panels.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        label: 'source-frame-upload-probe-bindings',
        layout,
        entries: [
          { binding: 0, resource: canvasPicture.createView() },
          { binding: 1, resource: uploaded.createView() },
        ],
      }),
    )
    pass.draw(3)
    pass.end()
    encoder.copyTextureToBuffer(
      { texture: panels },
      { buffer: readback, bytesPerRow: PROBE_BYTES_PER_ROW },
      { width: PROBE_WIDTH, height: PROBE_GRID },
    )
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(1 /* GPUMapMode.READ */)
    const halves = new Uint16Array(readback.getMappedRange().slice(0))
    readback.unmap()
    const values = [0, 1, 2].map(() => new Float32Array(PROBE_GRID * PROBE_GRID * 3))
    for (let y = 0; y < PROBE_GRID; y++) {
      for (let x = 0; x < PROBE_WIDTH; x++) {
        const panel = Math.floor(x / PROBE_GRID)
        const point = y * PROBE_GRID + (x % PROBE_GRID)
        for (let channel = 0; channel < 3; channel++) {
          values[panel]![point * 3 + channel] = halfToNumber(halves[(y * PROBE_WIDTH + x) * 4 + channel]!) * 255
        }
      }
    }
    return { canvas: values[0]!, plain: values[1]!, corrected: values[2]! }
  } finally {
    panels.destroy()
    readback.destroy()
  }
}

/** The mean difference, in levels of 255, under which an upload is the canvas picture for the preview's purpose. */
export const UPLOAD_TOLERANCE_LEVELS = 2.5

function meanAbsoluteDifference(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!)
  return sum / a.length
}

/**
 * Under this many levels apart, the two readings draw the probed frame alike (a black or a very dark frame): the
 * frame cannot tell which one the file needs, and a tie once picked `plain` for a 10-bit file for the whole session.
 */
const UNDECIDED_LEVELS = 1

/**
 * How a file's frames are to be uploaded: as the external texture comes (`plain`), with its transfer conversion undone
 * (`corrected`), or through the canvas the exports use (`canvas`) when neither matches the canvas picture within
 * `UPLOAD_TOLERANCE_LEVELS`: a browser that converts in some other way is never trusted. `undecided` when both match
 * and are within `UNDECIDED_LEVELS` of each other: ask the next frame.
 */
export function chooseUpload(probe: UploadProbe): ExternalConversion | 'canvas' | 'undecided' {
  const plain = meanAbsoluteDifference(probe.plain, probe.canvas)
  const corrected = meanAbsoluteDifference(probe.corrected, probe.canvas)
  if (Math.abs(plain - corrected) < UNDECIDED_LEVELS && Math.max(plain, corrected) <= UPLOAD_TOLERANCE_LEVELS) {
    return 'undecided'
  }
  if (plain <= UPLOAD_TOLERANCE_LEVELS && plain <= corrected) return 'plain'
  if (corrected <= UPLOAD_TOLERANCE_LEVELS) return 'corrected'
  return 'canvas'
}
