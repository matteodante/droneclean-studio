// The motion-blur gather (design 7.2 sections 4.2 and 4.3, design 3.6 sections 0 item 2 and 2.1): the weighted mean of
// the source frames an output frame's shutter covers, computed on the GPU in linear light.
//
// It is not a pipeline stage but the step between the per-source-frame stages and the per-output-frame ones. A
// render pass takes up to `MAX_SAMPLES_PER_PASS` pictures at once: it decodes each one's code values to linear light,
// adds them times their weights in 32-bit arithmetic and writes the sum once. The pipeline calls it for each group of
// samples, with a step that says where the group is in the plan:
//
//   only     the plan fits one pass: the pass encodes the sum back to the transfer straight into the texture the next
//            stage reads (no accumulator at all: four 4K samples are four reads and one write, where a pass per sample
//            was four reads, four read-modify-writes of the sum and a resolve; the preview's 4x was bound by that
//            memory traffic, 30 frames a second);
//   first    writes the sum into the accumulator;
//   middle   adds its sum to the accumulator (an additive blend, which needs a blendable accumulator);
//   last     adds its sum to the accumulator it reads and encodes the result into the output.
//
// The accumulator is `rgba32float` on a device created with `float32-blendable` and `rgba16float` otherwise
// (`accumulatorFormatFor`); it exists only for plans of more than one pass and is made when first needed.
//
// The transfer is the sRGB curve (the Rec.709 picture the samples carry): averaging code values directly would darken
// every edge a moving box crosses (a 50 % mix of black and white is code 0.735, not 0.5), and the mix of a bright and a
// dark pixel is what a camera's shutter measures in light. A log clip's samples are converted to Rec.709 first: the
// input colour stage is a per-source-frame stage, so it runs on each sample before the gather, which never sees log
// code values.
//
// Samples whose weights sum to 1 give a picture of the same brightness; a plan with one sample never comes here
// (the pipeline passes that frame through, bit for bit).

import { perDevice } from '@/studio/render/device-cache'
import { hasFloat32Blendable } from '@/studio/render/device-features'

// The WebGPU usage flags, as the spec numbers them (spelled out so the module loads where there is no GPU).
const COPY_SRC = 0x01
const COPY_DST = 0x02
const TEXTURE_BINDING = 0x04
const RENDER_ATTACHMENT = 0x10
const SHADER_STAGE_FRAGMENT = 0x2

/** The accumulator's usage: drawn into, sampled by the resolve, copied by a test or a probe. */
const ACCUMULATOR_USAGE = TEXTURE_BINDING | RENDER_ATTACHMENT | COPY_SRC | COPY_DST

/**
 * The accumulator's format on `device`: `rgba32float` when the device was created with `float32-blendable` (the
 * additive draw blends into it), else `rgba16float`. Each add into a half-float accumulator rounds to 11 significant
 * bits (up to ~0.3 level of 1023 near the top of the range, four adds to a 4x blend: 1.29 levels measured); 32 bits
 * leave the mean to the sRGB curves and the blend arithmetic alone.
 */
export function accumulatorFormatFor(device: { readonly features?: { has(name: string): boolean } }): GPUTextureFormat {
  return hasFloat32Blendable(device) ? 'rgba32float' : 'rgba16float'
}

/** A picture's size in pixels. */
interface Size {
  readonly width: number
  readonly height: number
}

/** How many samples one pass adds (the shader's fixed number of picture bindings). */
export const MAX_SAMPLES_PER_PASS = 4

/** Where a pass is in its plan (see the file's header). */
export type GatherStep = 'only' | 'first' | 'middle' | 'last'

/** One picture of a pass: any `rgba16float` view of the stage's size, and its share of the blend. */
export interface GatherInput {
  readonly view: GPUTextureView
  readonly weight: number
}

/** Where a pass's weights go: the pipeline's frame arena, whose ranges keep their bytes until the frame is done. */
export interface GatherUploads {
  upload(data: ArrayBufferView): { readonly buffer: GPUBuffer; readonly offset: number; readonly size: number }
}

/** The gather the pipeline drives; see the file's header. */
export interface MotionBlurStage {
  readonly size: Size
  /** The format the sum is held in between passes: `rgba32float` or `rgba16float` (see `accumulatorFormatFor`). */
  readonly accumulatorFormat: GPUTextureFormat
  /**
   * Records one pass over 1 to `MAX_SAMPLES_PER_PASS` inputs. `output` (this size, the stage's format) is given for
   * the steps that encode, `only` and `last`.
   */
  pass(
    encoder: GPUCommandEncoder,
    uploads: GatherUploads,
    inputs: readonly GatherInput[],
    step: GatherStep,
    output?: GPUTextureView,
  ): void
  /** Destroys the accumulator. The pipelines belong to the device's cache. */
  destroy(): void
}

/** The sRGB transfer, decoded: code values to linear light (a sign-preserving curve, so a value outside 0..1 survives). */
export function srgbToLinear(code: number): number {
  const a = Math.abs(code)
  const linear = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4
  return Math.sign(code) * linear
}

/** The sRGB transfer, encoded: linear light to code values. */
export function linearToSrgb(linear: number): number {
  const a = Math.abs(linear)
  const code = a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055
  return Math.sign(linear) * code
}

/** The weighted mean of `values` (code values of one channel), averaged in linear light: what the shaders compute. */
export function blendInLinearLight(
  samples: readonly { readonly value: number; readonly weight: number }[],
): number {
  let sum = 0
  for (const sample of samples) sum += srgbToLinear(sample.value) * sample.weight
  return linearToSrgb(sum)
}

const WGSL = /* wgsl */ `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

struct Weights {
  share: vec4f,
}

@group(0) @binding(0) var<uniform> weights: Weights;
@group(0) @binding(1) var picture0: texture_2d<f32>;
@group(0) @binding(2) var picture1: texture_2d<f32>;
@group(0) @binding(3) var picture2: texture_2d<f32>;
@group(0) @binding(4) var picture3: texture_2d<f32>;
@group(0) @binding(5) var sum: texture_2d<f32>;

fn to_linear(code: vec3f) -> vec3f {
  let a = abs(code);
  let low = a / 12.92;
  let high = pow((a + vec3f(0.055)) / 1.055, vec3f(2.4));
  return sign(code) * select(high, low, a <= vec3f(0.04045));
}

fn from_linear(linear: vec3f) -> vec3f {
  let a = abs(linear);
  let low = a * 12.92;
  let high = 1.055 * pow(a, vec3f(1.0 / 2.4)) - vec3f(0.055);
  return sign(linear) * select(high, low, a <= vec3f(0.0031308));
}

// The GPU truncates the value it stores in a half float (up to one step, ~0.5 level of 1023 near white): the encoded
// picture is rounded to the nearest half before it is written.
fn round_half(value: vec3f) -> vec3f {
  let a = abs(value);
  let step = exp2(floor(log2(max(a, vec3f(6.1035156e-5)))) - 10.0);
  return sign(value) * round(a / step) * step;
}

fn load(picture: texture_2d<f32>, position: vec4f) -> vec4f {
  let dimensions = vec2i(textureDimensions(picture));
  return textureLoad(picture, clamp(vec2i(position.xy), vec2i(0), dimensions - vec2i(1)), 0);
}

// An input with no share is not read (the shares are uniform: the branch is the same for every pixel).
fn weighted(picture: texture_2d<f32>, share: f32, position: vec4f) -> vec4f {
  if (share <= 0.0) {
    return vec4f(0.0);
  }
  let texel = load(picture, position);
  return vec4f(to_linear(texel.rgb), texel.a) * share;
}

fn passSum(position: vec4f) -> vec4f {
  return weighted(picture0, weights.share.x, position) + weighted(picture1, weights.share.y, position) +
    weighted(picture2, weights.share.z, position) + weighted(picture3, weights.share.w, position);
}

// first and middle: the linear sum (a middle pass is added to the accumulator by the blend)
@fragment
fn sumMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return passSum(position);
}

// only: the sum, encoded
@fragment
fn onlyMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let total = passSum(position);
  return vec4f(round_half(from_linear(total.rgb)), total.a);
}

// last: the accumulator and the sum, encoded
@fragment
fn lastMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let total = passSum(position) + load(sum, position);
  return vec4f(round_half(from_linear(total.rgb)), total.a);
}
`

interface Pipelines {
  readonly layout: GPUBindGroupLayout
  readonly only: GPURenderPipeline
  readonly first: GPURenderPipeline
  readonly middle: GPURenderPipeline
  readonly last: GPURenderPipeline
}

/** The pipelines of a device and formats (the output's and the accumulator's), built once and shared by every size */
function pipelinesFor(
  device: GPUDevice,
  format: GPUTextureFormat,
  accumulatorFormat: GPUTextureFormat,
): Promise<Pipelines> {
  return perDevice(device, `motion-blur-gather|${format}|${accumulatorFormat}`, async () => {
    const module = device.createShaderModule({ label: 'motion-blur-gather', code: WGSL })
    const texture = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: SHADER_STAGE_FRAGMENT,
      texture: { sampleType: 'unfilterable-float' as const },
    })
    const layout = device.createBindGroupLayout({
      label: 'motion-blur-gather-layout',
      entries: [
        {
          binding: 0,
          visibility: SHADER_STAGE_FRAGMENT,
          buffer: { type: 'uniform' as const, hasDynamicOffset: true, minBindingSize: WEIGHTS_BYTES },
        },
        texture(1),
        texture(2),
        texture(3),
        texture(4),
        texture(5),
      ],
    })
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
    const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
    const build = (
      label: string,
      entryPoint: string,
      target: GPUTextureFormat,
      blend?: GPUBlendState,
    ): Promise<GPURenderPipeline> =>
      device.createRenderPipelineAsync({
        label: `motion-blur-${label}`,
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint, targets: [{ format: target, ...(blend ? { blend } : {}) }] },
        primitive: { topology: 'triangle-list' },
      })
    const [only, first, middle, last] = await Promise.all([
      build('only', 'onlyMain', format),
      build('first', 'sumMain', accumulatorFormat),
      build('middle', 'sumMain', accumulatorFormat, { color: add, alpha: add }),
      build('last', 'lastMain', format),
    ])
    return { layout, only, first, middle, last }
  })
}

/** A sample's weight is a share of the blend: in (0, 1]. */
function assertShare(weight: number): void {
  if (!Number.isFinite(weight) || weight <= 0 || weight > 1) {
    throw new RangeError(`motion blur: a sample's weight must be in (0, 1], got ${weight}`)
  }
}

/** The arguments of a pass, or a `RangeError` naming what is wrong. */
function checkPass(inputs: readonly GatherInput[], step: GatherStep, output: GPUTextureView | undefined): void {
  if (inputs.length < 1 || inputs.length > MAX_SAMPLES_PER_PASS) {
    throw new RangeError(`motion blur: a pass takes 1 to ${MAX_SAMPLES_PER_PASS} pictures, got ${inputs.length}`)
  }
  inputs.forEach((input) => assertShare(input.weight))
  if ((step === 'only' || step === 'last') && output === undefined) {
    throw new RangeError(`motion blur: a ${step} pass needs an output`)
  }
}

/** The weights' uniform: four floats. */
const WEIGHTS_BYTES = 16

/**
 * Creates the gather for pictures of `size` in `format` (the pipeline's `rgba16float`: the samples' and the output's
 * format); a plan of more than one pass holds its sum in `accumulatorFormatFor(device)`.
 *
 * @throws RangeError when the size is not a positive whole number of pixels.
 */
export async function createMotionBlurStage(
  device: GPUDevice,
  format: GPUTextureFormat,
  size: Size,
): Promise<MotionBlurStage> {
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) {
    throw new RangeError(`motion blur: the size must be whole pixels, got ${size.width}x${size.height}`)
  }
  const accumulatorFormat = accumulatorFormatFor(device)
  const { layout, only, first, middle, last } = await pipelinesFor(device, format, accumulatorFormat)
  let accumulator: GPUTexture | undefined
  let accumulatorView: GPUTextureView | undefined
  const accumulatorOf = (): GPUTextureView => {
    if (accumulatorView === undefined) {
      accumulator = device.createTexture({
        label: 'motion-blur-accumulator',
        size: { width: size.width, height: size.height },
        format: accumulatorFormat,
        usage: ACCUMULATOR_USAGE,
      })
      accumulatorView = accumulator.createView()
    }
    return accumulatorView
  }

  return {
    size: { width: size.width, height: size.height },
    accumulatorFormat,
    pass(encoder, uploads, inputs, step, output) {
      checkPass(inputs, step, output)
      const encodes = step === 'only' || step === 'last'
      const target = encodes ? output! : accumulatorOf()
      const pipeline = { only, first, middle, last }[step]
      // An unused slot is bound to the first picture and has no share; the accumulator's slot is the first picture
      // too unless this pass reads it (it cannot be bound while it is the pass's target).
      const view = (index: number): GPUTextureView => inputs[index]?.view ?? inputs[0]!.view
      const shares = new Float32Array(MAX_SAMPLES_PER_PASS)
      inputs.forEach((input, index) => {
        shares[index] = input.weight
      })
      const range = uploads.upload(shares)
      const pass = encoder.beginRenderPass({
        label: `motion-blur-${step}`,
        colorAttachments: [
          {
            view: target,
            loadOp: step === 'middle' ? 'load' : 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: 'store',
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          label: 'motion-blur-bindings',
          layout,
          entries: [
            { binding: 0, resource: { buffer: range.buffer, offset: 0, size: WEIGHTS_BYTES } },
            { binding: 1, resource: view(0) },
            { binding: 2, resource: view(1) },
            { binding: 3, resource: view(2) },
            { binding: 4, resource: view(3) },
            { binding: 5, resource: step === 'last' ? accumulatorOf() : view(0) },
          ],
        }),
        [range.offset],
      )
      pass.draw(3)
      pass.end()
    },
    destroy() {
      accumulator?.destroy()
    },
  }
}
