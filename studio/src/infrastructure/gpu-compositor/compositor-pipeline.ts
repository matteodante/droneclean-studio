/**
 * GPU Compositor Pipeline
 *
 * Composites layers with blend modes, transforms, opacity, and masks.
 * Uses ping-pong textures — each layer reads from input and writes to output,
 * then they swap. Final result is the last input texture.
 *
 * Three render pipelines:
 * 1. Regular — for GPUTexture inputs (images, pre-rendered canvases)
 * 2. External — for GPUExternalTexture inputs (zero-copy video)
 * 3. Blit — copies the final composite to a canvas, converting straight → premultiplied alpha
 */

import type { BlendMode } from '@/types/blend-modes'
import { BLEND_MODE_INDEX } from '@/types/blend-modes'
import { createLogger } from '@/shared/logging/logger'
import { BLEND_MODES_WGSL } from '@/infrastructure/gpu-shared/blend-modes'
import { drawFullscreenCanvasPass } from '@/infrastructure/gpu-shared/fullscreen-canvas-pass'
import { FULLSCREEN_QUAD_WGSL } from '@/infrastructure/gpu-shared/fullscreen-quad'

const logger = createLogger('CompositorPipeline')

// ─── Shader ───

const BLIT_SHADER = /* wgsl */ `
${FULLSCREEN_QUAD_WGSL}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;

@fragment
fn blitFragment(input: VertexOutput) -> @location(0) vec4f {
  // Composite textures store straight alpha; canvas expects premultiplied
  let c = textureSample(inputTex, texSampler, input.uv);
  return vec4f(c.rgb * c.a, c.a);
}
`

const VERTEX_SHADER = FULLSCREEN_QUAD_WGSL

const COMPOSITE_UNIFORMS = /* wgsl */ `
struct CompositeUniforms {
  opacity: f32,            // 0
  blendMode: u32,          // 1
  posX: f32,               // 2
  posY: f32,               // 3
  scaleX: f32,             // 4
  scaleY: f32,             // 5
  rotationZ: f32,          // 6
  sourceAspect: f32,       // 7
  outputAspect: f32,       // 8
  time: f32,               // 9
  hasMask: u32,            // 10
  maskInvert: u32,         // 11
  rotationX: f32,          // 12
  rotationY: f32,          // 13
  perspective: f32,        // 14
  maskFeather: f32,        // 15
};
`

const COMPOSITE_FRAGMENT = /* wgsl */ `
${BLEND_MODES_WGSL}
${COMPOSITE_UNIFORMS}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var layerTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: CompositeUniforms;
@group(0) @binding(4) var maskTex: texture_2d<f32>;

fn transformUV(uv: vec2f) -> vec2f {
  // Center UV around origin
  var p = uv - vec2f(0.5);

  // Apply scale
  p /= vec2f(u.scaleX, u.scaleY);

  // Apply 2D rotation
  let cosR = cos(u.rotationZ);
  let sinR = sin(u.rotationZ);
  p = vec2f(p.x * cosR + p.y * sinR, -p.x * sinR + p.y * cosR);

  // Apply 3D perspective rotation (X and Y axis)
  if (u.perspective > 0.0) {
    let cosX = cos(u.rotationX);
    let sinX = sin(u.rotationX);
    let cosY = cos(u.rotationY);
    let sinY = sin(u.rotationY);

    // Y-axis rotation
    let pz = p.x * sinY;
    let px = p.x * cosY;
    // X-axis rotation
    let py = p.y * cosX - pz * sinX;
    let pzz = p.y * sinX + pz * cosX;

    // Perspective projection
    let w = 1.0 + pzz / u.perspective;
    if (w <= 0.001) { return vec2f(-1.0); } // behind camera
    p = vec2f(px, py) / w;
  }

  // Apply position offset
  p -= vec2f(u.posX, u.posY);

  // Correct aspect ratio
  p.x *= u.outputAspect / max(u.sourceAspect, 0.001);

  return p + vec2f(0.5);
}

@fragment
fn compositeFragment(input: VertexOutput) -> @location(0) vec4f {
  let baseColor = textureSampleLevel(baseTex, texSampler, input.uv, 0.0);

  // Transform UV to sample layer texture
  let layerUV = transformUV(input.uv);
  let inBounds = layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0;
  let sampleUV = clamp(layerUV, vec2f(0.0), vec2f(1.0));
  var layerColor = textureSampleLevel(layerTex, texSampler, sampleUV, 0.0);

  // Apply mask
  var maskValue = 1.0;
  if (u.hasMask != 0u) {
    maskValue = textureSampleLevel(maskTex, texSampler, input.uv, 0.0).a;
    if (u.maskInvert != 0u) {
      maskValue = 1.0 - maskValue;
    }
  }

  let sourceAlpha = layerColor.a * u.opacity;
  let postDissolveAlpha = maskValue * select(0.0, 1.0, inBounds);
  if (sourceAlpha * postDissolveAlpha <= 0.0) {
    return baseColor;
  }

  return compositeBlendSourceOver(
    baseColor,
    layerColor,
    sourceAlpha,
    postDissolveAlpha,
    u.blendMode,
    input.uv * 8192.0,
    u.opacity
  );
}
`

/**
 * Composites an accumulator over the project's background, in float, and writes the frame with
 * alpha 1.
 *
 * The accumulator stores straight alpha and is cleared transparent, exactly as the preview's is, so
 * a blend mode's first layer meets a transparent base rather than the background (which would make
 * a multiply against the background colour). This pass is what turns it into the frame the export
 * delivers: the same image the 8-bit path reaches by drawing the composite canvas over the
 * background canvas, computed in float so the precise path never rounds it.
 */
const FLATTEN_SHADER = /* wgsl */ `
${FULLSCREEN_QUAD_WGSL}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var compositeTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> background: vec4f;

@fragment
fn flattenFragment(input: VertexOutput) -> @location(0) vec4f {
  let c = textureSampleLevel(compositeTex, texSampler, input.uv, 0.0);
  let alpha = clamp(c.a, 0.0, 1.0);
  return vec4f(c.rgb * alpha + background.rgb * (1.0 - alpha), 1.0);
}
`

const COMPOSITE_EXTERNAL_FRAGMENT = /* wgsl */ `
${BLEND_MODES_WGSL}
${COMPOSITE_UNIFORMS}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var layerTex: texture_external;
@group(0) @binding(3) var<uniform> u: CompositeUniforms;
@group(0) @binding(4) var maskTex: texture_2d<f32>;

fn transformUV_ext(uv: vec2f) -> vec2f {
  var p = uv - vec2f(0.5);
  p /= vec2f(u.scaleX, u.scaleY);
  let cosR = cos(u.rotationZ);
  let sinR = sin(u.rotationZ);
  p = vec2f(p.x * cosR + p.y * sinR, -p.x * sinR + p.y * cosR);
  if (u.perspective > 0.0) {
    let cosX = cos(u.rotationX);
    let sinX = sin(u.rotationX);
    let cosY = cos(u.rotationY);
    let sinY = sin(u.rotationY);
    let pz = p.x * sinY;
    let px = p.x * cosY;
    let py = p.y * cosX - pz * sinX;
    let pzz = p.y * sinX + pz * cosX;
    let w = 1.0 + pzz / u.perspective;
    if (w <= 0.001) { return vec2f(-1.0); }
    p = vec2f(px, py) / w;
  }
  p -= vec2f(u.posX, u.posY);
  p.x *= u.outputAspect / max(u.sourceAspect, 0.001);
  return p + vec2f(0.5);
}

@fragment
fn compositeExternalFragment(input: VertexOutput) -> @location(0) vec4f {
  let baseColor = textureSampleLevel(baseTex, texSampler, input.uv, 0.0);
  let layerUV = transformUV_ext(input.uv);
  let inBounds = layerUV.x >= 0.0 && layerUV.x <= 1.0 && layerUV.y >= 0.0 && layerUV.y <= 1.0;
  let sampleUV = clamp(layerUV, vec2f(0.0), vec2f(1.0));
  var layerColor = textureSampleBaseClampToEdge(layerTex, texSampler, sampleUV);
  var maskValue = 1.0;
  if (u.hasMask != 0u) {
    maskValue = textureSampleLevel(maskTex, texSampler, input.uv, 0.0).a;
    if (u.maskInvert != 0u) { maskValue = 1.0 - maskValue; }
  }
  let sourceAlpha = layerColor.a * u.opacity;
  let postDissolveAlpha = maskValue * select(0.0, 1.0, inBounds);
  if (sourceAlpha * postDissolveAlpha <= 0.0) { return baseColor; }
  return compositeBlendSourceOver(
    baseColor,
    layerColor,
    sourceAlpha,
    postDissolveAlpha,
    u.blendMode,
    input.uv * 8192.0,
    u.opacity
  );
}
`

// ─── Uniform packing ───

const UNIFORM_SIZE = 64 // 16 floats × 4 bytes

export interface CompositeLayerParams {
  opacity: number
  blendMode: BlendMode
  posX: number
  posY: number
  scaleX: number
  scaleY: number
  rotationZ: number
  sourceAspect: number
  outputAspect: number
  time: number
  hasMask: boolean
  maskInvert: boolean
  rotationX: number
  rotationY: number
  perspective: number
  maskFeather: number
}

export const DEFAULT_LAYER_PARAMS: CompositeLayerParams = {
  opacity: 1,
  blendMode: 'normal',
  posX: 0,
  posY: 0,
  scaleX: 1,
  scaleY: 1,
  rotationZ: 0,
  sourceAspect: 16 / 9,
  outputAspect: 16 / 9,
  time: 0,
  hasMask: false,
  maskInvert: false,
  rotationX: 0,
  rotationY: 0,
  perspective: 0,
  maskFeather: 0,
}

function packUniforms(p: CompositeLayerParams): Float32Array {
  const buf = new Float32Array(16)
  buf[0] = p.opacity
  // Store blend mode as u32 in float bits
  new Uint32Array(buf.buffer, 4, 1)[0] = BLEND_MODE_INDEX[p.blendMode] ?? 0
  buf[2] = p.posX
  buf[3] = p.posY
  buf[4] = p.scaleX
  buf[5] = p.scaleY
  buf[6] = p.rotationZ
  buf[7] = p.sourceAspect
  buf[8] = p.outputAspect
  buf[9] = p.time
  new Uint32Array(buf.buffer, 40, 1)[0] = p.hasMask ? 1 : 0
  new Uint32Array(buf.buffer, 44, 1)[0] = p.maskInvert ? 1 : 0
  buf[12] = p.rotationX
  buf[13] = p.rotationY
  buf[14] = p.perspective
  buf[15] = p.maskFeather
  return buf
}

// ─── Pipeline class ───

/** One target format's composite pipelines and the layouts their bind groups use. */
interface FormatPipelines {
  regular: GPURenderPipeline | null
  regularLayout: GPUBindGroupLayout | null
  external: GPURenderPipeline | null
  externalLayout: GPUBindGroupLayout | null
}

export class CompositorPipeline {
  private device: GPUDevice
  private canvasFormat: GPUTextureFormat
  private sampler: GPUSampler
  private layerUniformBuffers: GPUBuffer[] = []

  private readonly pipelines = new Map<GPUTextureFormat, FormatPipelines>()
  private blitPipeline: GPURenderPipeline | null = null
  private blitLayout: GPUBindGroupLayout | null = null

  private pingTexture: GPUTexture | null = null
  private pongTexture: GPUTexture | null = null
  private pingView: GPUTextureView | null = null
  private pongView: GPUTextureView | null = null
  private texW = 0
  private texH = 0
  private texFormat: GPUTextureFormat = 'rgba8unorm'
  private blitBindGroupPing: GPUBindGroup | null = null
  private blitBindGroupPong: GPUBindGroup | null = null

  private flattenPipeline: GPURenderPipeline | null = null
  private flattenLayout: GPUBindGroupLayout | null = null
  private flattenUniformBuffer: GPUBuffer | null = null

  constructor(device: GPUDevice) {
    this.device = device
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat()
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    // The 8-bit pipelines are built up front, as they always were; a float target's pipelines are
    // built the first time a frame asks for that format.
    this.ensurePipelines('rgba8unorm')
    this.createBlitPipeline()
    this.createFlattenPipeline()
  }

  private ensurePipelines(format: GPUTextureFormat): FormatPipelines {
    const existing = this.pipelines.get(format)
    if (existing) return existing
    const created = this.createPipelines(format)
    this.pipelines.set(format, created)
    return created
  }

  private createPipelines(format: GPUTextureFormat): FormatPipelines {
    const created: FormatPipelines = {
      regular: null,
      regularLayout: null,
      external: null,
      externalLayout: null,
    }
    // Regular composite pipeline (texture_2d layer)
    try {
      const module = this.device.createShaderModule({
        label: 'compositor-regular',
        code: VERTEX_SHADER + COMPOSITE_FRAGMENT,
      })
      created.regularLayout = this.device.createBindGroupLayout({
        label: 'compositor-regular-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
      })
      created.regular = this.device.createRenderPipeline({
        label: 'compositor-regular-pipeline',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [created.regularLayout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'compositeFragment', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      })
    } catch (e) {
      logger.warn('Failed to create regular compositor pipeline', e)
    }

    // External composite pipeline (texture_external layer — zero-copy video)
    try {
      const module = this.device.createShaderModule({
        label: 'compositor-external',
        code: VERTEX_SHADER + COMPOSITE_EXTERNAL_FRAGMENT,
      })
      created.externalLayout = this.device.createBindGroupLayout({
        label: 'compositor-external-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
      })
      created.external = this.device.createRenderPipeline({
        label: 'compositor-external-pipeline',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [created.externalLayout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: {
          module,
          entryPoint: 'compositeExternalFragment',
          targets: [{ format }],
        },
        primitive: { topology: 'triangle-list' },
      })
    } catch {
      // importExternalTexture may not be supported
    }
    return created
  }

  private createBlitPipeline(): void {
    try {
      const module = this.device.createShaderModule({
        label: 'compositor-blit',
        code: BLIT_SHADER,
      })
      this.blitLayout = this.device.createBindGroupLayout({
        label: 'compositor-blit-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
      })
      this.blitPipeline = this.device.createRenderPipeline({
        label: 'compositor-blit-pipeline',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.blitLayout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'blitFragment', targets: [{ format: this.canvasFormat }] },
        primitive: { topology: 'triangle-list' },
      })
    } catch (e) {
      logger.warn('Failed to create compositor blit pipeline', e)
    }
  }

  private createFlattenPipeline(): void {
    try {
      const module = this.device.createShaderModule({
        label: 'compositor-flatten',
        code: FLATTEN_SHADER,
      })
      this.flattenLayout = this.device.createBindGroupLayout({
        label: 'compositor-flatten-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      })
      this.flattenUniformBuffer ??= this.device.createBuffer({
        label: 'compositor-flatten-background',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      this.flattenPipeline = this.device.createRenderPipeline({
        label: 'compositor-flatten-pipeline',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.flattenLayout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: {
          module,
          entryPoint: 'flattenFragment',
          targets: [{ format: 'rgba16float' }],
        },
        primitive: { topology: 'triangle-list' },
      })
    } catch (e) {
      logger.warn('Failed to create the compositor flatten pipeline', e)
      this.flattenPipeline = null
      this.flattenLayout = null
    }
  }

  private ensurePingPong(w: number, h: number, format: GPUTextureFormat): void {
    if (this.pingTexture && this.texW === w && this.texH === h && this.texFormat === format) return
    this.pingTexture?.destroy()
    this.pongTexture?.destroy()
    const desc: GPUTextureDescriptor = {
      size: { width: w, height: h },
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    }
    this.pingTexture = this.device.createTexture(desc)
    this.pongTexture = this.device.createTexture(desc)
    this.pingView = this.pingTexture.createView()
    this.pongView = this.pongTexture.createView()
    this.texW = w
    this.texH = h
    this.texFormat = format
    this.blitBindGroupPing = null
    this.blitBindGroupPong = null
  }

  private getLayerUniformBuffer(index: number): GPUBuffer {
    let buffer = this.layerUniformBuffers[index]
    if (!buffer) {
      buffer = this.device.createBuffer({
        size: UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      this.layerUniformBuffers[index] = buffer
    }
    return buffer
  }

  private writeUniforms(buffer: GPUBuffer, params: CompositeLayerParams): void {
    const data = packUniforms(params)
    this.device.queue.writeBuffer(buffer, 0, data.buffer)
  }

  /**
   * Composite a sequence of layers into the accumulator.
   * Returns the result texture (ping or pong) containing the final composite.
   *
   * Layers are composited bottom-to-top. Each layer provides either a GPUTextureView
   * (for images/pre-rendered) or a GPUExternalTexture (for zero-copy video).
   *
   * `pixelFormat` is the accumulator's format: `rgba8unorm` (the preview's and the golden kit's
   * path, the only one they have ever taken) or `rgba16float` (a precise export's float composite).
   * `allowEmpty` lets a frame with no layers composite to a cleared accumulator, which the precise
   * path needs to deliver the project's background rather than nothing.
   */
  compositeToTexture(
    layers: CompositeLayer[],
    width: number,
    height: number,
    commandEncoder: GPUCommandEncoder,
    options: { pixelFormat?: GPUTextureFormat; allowEmpty?: boolean } = {},
  ): { texture: GPUTexture; view: GPUTextureView } | null {
    const pixelFormat = options.pixelFormat ?? 'rgba8unorm'
    if (layers.length === 0 && !options.allowEmpty) return null
    const pipelines = this.pipelines.get(pixelFormat) ?? this.ensurePipelines(pixelFormat)
    if (!pipelines.regular || !pipelines.regularLayout) return null

    this.ensurePingPong(width, height, pixelFormat)
    if (!this.pingTexture || !this.pongTexture || !this.pingView || !this.pongView) return null

    this.trimLayerUniforms(layers.length)
    this.clearAccumulator(commandEncoder)
    return this.encodeLayers(commandEncoder, layers, pipelines)
  }

  private trimLayerUniforms(layerCount: number): void {
    for (let i = layerCount; i < this.layerUniformBuffers.length; i++) {
      this.layerUniformBuffers[i]?.destroy()
    }
    if (this.layerUniformBuffers.length > layerCount) {
      this.layerUniformBuffers.length = layerCount
    }
  }

  private clearAccumulator(commandEncoder: GPUCommandEncoder): void {
    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.pingView!,
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        },
      ],
    })
    clearPass.end()
  }

  /** Encodes one pass per layer over the ping/pong pair; the last input is the frame. */
  private encodeLayers(
    commandEncoder: GPUCommandEncoder,
    layers: CompositeLayer[],
    pipelines: FormatPipelines,
  ): { texture: GPUTexture; view: GPUTextureView } {
    let inputTex = this.pingTexture!
    let outputTex = this.pongTexture!
    let inputView = this.pingView!
    let outputView = this.pongView!

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex]!
      const bindGroup = this.createLayerBindGroup(layer, layerIndex, pipelines, inputView)
      if (!bindGroup) continue
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: outputView,
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      pass.setPipeline(bindGroup.pipeline)
      pass.setBindGroup(0, bindGroup.bindGroup)
      pass.draw(6)
      pass.end()

      // Swap ping/pong
      const tmpTex = inputTex
      inputTex = outputTex
      outputTex = tmpTex
      const tmpView = inputView
      inputView = outputView
      outputView = tmpView
    }

    return { texture: inputTex, view: inputView }
  }

  private createLayerBindGroup(
    layer: CompositeLayer,
    layerIndex: number,
    pipelines: FormatPipelines,
    inputView: GPUTextureView,
  ): { pipeline: GPURenderPipeline; bindGroup: GPUBindGroup } | null {
    const layerUniformBuffer = this.getLayerUniformBuffer(layerIndex)
    this.writeUniforms(layerUniformBuffer, layer.params)
    if (layer.externalTexture && pipelines.external && pipelines.externalLayout) {
      return {
        pipeline: pipelines.external,
        bindGroup: this.device.createBindGroup({
          layout: pipelines.externalLayout,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: inputView },
            { binding: 2, resource: layer.externalTexture },
            { binding: 3, resource: { buffer: layerUniformBuffer } },
            { binding: 4, resource: layer.maskView },
          ],
        }),
      }
    }
    if (!layer.textureView || !pipelines.regularLayout) return null
    return {
      pipeline: pipelines.regular!,
      bindGroup: this.device.createBindGroup({
        layout: pipelines.regularLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: inputView },
          { binding: 2, resource: layer.textureView },
          { binding: 3, resource: { buffer: layerUniformBuffer } },
          { binding: 4, resource: layer.maskView },
        ],
      }),
    }
  }

  compositeToCanvas(
    layers: CompositeLayer[],
    width: number,
    height: number,
    outputCtx: GPUCanvasContext,
  ): boolean {
    return this.compositeToCanvasAndTexture(layers, width, height, outputCtx) !== null
  }

  /**
   * Composite to the canvas and return the accumulator's texture as well.
   *
   * Without `background` this is the preview's and the golden kit's path: the accumulator is blitted
   * to the canvas (premultiplied, one rounding to 8 bits) and returned as it is. With `background`
   * — a precise export — the frame is first composited over the project colour into the spare
   * accumulator, in float, with alpha 1, and that frame is what both the canvas and the caller's
   * sink receive: the design's single 8-bit conversion is the canvas blit, and the float frame before
   * it is what P5 packs. Returns null when the frame cannot be produced; a precise caller must treat
   * that as a failed frame, not skip it.
   */
  compositeToCanvasAndTexture(
    layers: CompositeLayer[],
    width: number,
    height: number,
    outputCtx: GPUCanvasContext,
    options: {
      pixelFormat?: GPUTextureFormat
      background?: { r: number; g: number; b: number }
    } = {},
  ): { texture: GPUTexture; view: GPUTextureView } | null {
    if (!this.blitPipeline || !this.blitLayout) return null

    const commandEncoder = this.device.createCommandEncoder()
    const composited = this.compositeToTexture(layers, width, height, commandEncoder, {
      pixelFormat: options.pixelFormat,
      allowEmpty: options.background !== undefined,
    })
    if (!composited) return null

    const frame = options.background
      ? this.flattenOverBackground(composited, options.background, commandEncoder)
      : composited
    if (!frame) return null
    const blitBindGroup = this.resolveBlitBindGroup(frame.texture)
    if (!blitBindGroup) return null

    drawFullscreenCanvasPass({
      device: this.device,
      context: outputCtx,
      pipeline: this.blitPipeline,
      bindGroup: blitBindGroup,
      encoder: commandEncoder,
    })
    return frame
  }

  /**
   * Composites `composite` over `background` into the spare ping/pong texture and returns it,
   * alpha 1. Both accumulators are free once the layers are done: the result lives in the one the
   * composite did not end in, and every frame clears its target before use.
   */
  private flattenOverBackground(
    composite: { texture: GPUTexture; view: GPUTextureView },
    background: { r: number; g: number; b: number },
    commandEncoder: GPUCommandEncoder,
  ): { texture: GPUTexture; view: GPUTextureView } | null {
    // The flatten pipeline's attachment is rgba16float; an 8-bit accumulator is the preview's path
    // and never gets a background.
    if (composite.texture.format !== 'rgba16float') return null
    const target = this.resolveFlattenTarget(composite.texture)
    if (!target || !this.flattenPipeline || !this.flattenLayout) return null

    const data = new Float32Array([background.r, background.g, background.b, 1])
    this.device.queue.writeBuffer(this.flattenUniformBuffer!, 0, data)
    const bindGroup = this.device.createBindGroup({
      layout: this.flattenLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: composite.view },
        { binding: 2, resource: { buffer: this.flattenUniformBuffer! } },
      ],
    })
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.view,
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.flattenPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(6)
    pass.end()
    return target
  }

  /** The spare accumulator: the one the composite did not end in. */
  private resolveFlattenTarget(
    compositeTexture: GPUTexture,
  ): { texture: GPUTexture; view: GPUTextureView } | null {
    if (compositeTexture === this.pingTexture) {
      return this.pongTexture && this.pongView
        ? { texture: this.pongTexture, view: this.pongView }
        : null
    }
    return this.pingTexture && this.pingView
      ? { texture: this.pingTexture, view: this.pingView }
      : null
  }

  private resolveBlitBindGroup(texture: GPUTexture): GPUBindGroup | null {
    if (!this.blitLayout) return null
    if (texture === this.pingTexture) {
      return (this.blitBindGroupPing ??= this.device.createBindGroup({
        layout: this.blitLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: this.pingView! },
        ],
      }))
    }
    return (this.blitBindGroupPong ??= this.device.createBindGroup({
      layout: this.blitLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.pongView! },
      ],
    }))
  }

  getDevice(): GPUDevice {
    return this.device
  }

  destroy(): void {
    this.pingTexture?.destroy()
    this.pongTexture?.destroy()
    for (const buffer of this.layerUniformBuffers) buffer.destroy()
    this.pingTexture = null
    this.pongTexture = null
    this.pingView = null
    this.pongView = null
    this.blitPipeline = null
    this.blitLayout = null
    this.blitBindGroupPing = null
    this.blitBindGroupPong = null
    this.layerUniformBuffers = []
    this.flattenPipeline = null
    this.flattenLayout = null
    this.flattenUniformBuffer?.destroy()
    this.flattenUniformBuffer = null
    this.pipelines.clear()
  }
}

/** A layer to be composited */
export interface CompositeLayer {
  params: CompositeLayerParams
  /** Regular texture view (for images, pre-rendered canvases) */
  textureView?: GPUTextureView
  /** External texture (for zero-copy video) */
  externalTexture?: GPUExternalTexture
  /** Mask texture view (use MaskTextureManager.getFallbackView() if no mask) */
  maskView: GPUTextureView
}
