import { createLogger } from '@/shared/logging/logger'
import { drawFullscreenCanvasPass } from '@/infrastructure/gpu-shared/fullscreen-canvas-pass'
import { FULLSCREEN_QUAD_WGSL } from '@/infrastructure/gpu-shared/fullscreen-quad'
import { COMMON_WGSL } from './common'
import { tableToHalf } from '@/studio/render/data-texture-half'
import { optionalDeviceFeatures } from '@/studio/render/device-features'
import {
  EFFECT_CHAIN_STORAGE_FORMAT,
  EFFECT_TEXTURE_FORMAT,
  type EffectChainFormat,
  type EffectDataTexturePayload,
  type EffectDataTextureSpec,
  type GpuEffectDefinition,
  type GpuEffectInstance,
} from './types'

interface DataTextureCacheEntry {
  key: string
  texture: GPUTexture
  view: GPUTextureView
  width: number
  height: number
  depth: number
}

interface SharedEffectPipelineState {
  // Effect and compute pipelines are keyed `${format}|${id}`: the chain is compiled once per format.
  pipelines: Map<string, GPURenderPipeline>
  bindGroupLayouts: Map<string, GPUBindGroupLayout>
  computePipelines: Map<string, GPUComputePipeline>
  computeBindGroupLayouts: Map<string, GPUBindGroupLayout>
  blitPipeline: GPURenderPipeline | null
  blitBindGroupLayout: GPUBindGroupLayout | null
  importPipelines: Map<string, GPURenderPipeline>
  importBindGroupLayout: GPUBindGroupLayout | null
  colorBatchPipelines: Map<string, GPURenderPipeline>
  colorBatchBindGroupLayout: GPUBindGroupLayout | null
}
import { GPU_EFFECT_REGISTRY, getGpuEffect } from './registry'

function getLogger() {
  return createLogger('EffectsPipeline')
}

const FULLSCREEN_VERTEX = FULLSCREEN_QUAD_WGSL

const BLIT_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@fragment
fn blitFragment(input: VertexOutput) -> @location(0) vec4f {
  // Effect textures carry straight (non-premultiplied) alpha, but the output
  // canvas is configured alphaMode:'premultiplied'. Premultiply here so that a
  // pixel an effect left with colour at alpha 0 (e.g. a gradient map over a
  // transparent Lottie) reads as fully transparent instead of leaking that
  // colour over the layers below. Opaque pixels (a = 1) are unchanged.
  let c = textureSample(inputTex, texSampler, input.uv);
  return vec4f(c.rgb * c.a, c.a);
}
`

/**
 * Copies a same-size texture into another, converting its format if they differ.
 * `textureLoad` at the fragment's own pixel is an exact read, so a same-format
 * copy is bit-identical and an 8-bit target rounds exactly once; effect textures
 * carry straight alpha, so unlike the canvas blit this does not premultiply.
 */
const TEXTURE_CONVERT_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@fragment
fn convertFragment(input: VertexOutput) -> @location(0) vec4f {
  // The fragment's built-in position is its pixel centre (x.5, y.5); truncating
  // gives this pixel's texel, so no sampler interpolation can shift the copy.
  return textureLoad(inputTex, vec2i(i32(input.position.x), i32(input.position.y)), 0);
}
`

/**
 * The two formats the chain runs in: the 8-bit one of a caller still on
 * today's path, and the precise path's `rgba16float`. The caller's output
 * texture picks one, so an 8-bit caller keeps today's pixels exactly (a half
 * float cannot hold an 8-bit code value exactly) while the precise path gets
 * the float chain.
 */
const BYTE_CHAIN_FORMAT: EffectChainFormat = 'rgba8unorm'
const CHAIN_FORMATS: readonly EffectChainFormat[] = [BYTE_CHAIN_FORMAT, EFFECT_TEXTURE_FORMAT]

/** The chain format for a boundary texture's format, or null when it is neither. */
function chainFormatFor(format: GPUTextureFormat): EffectChainFormat | null {
  return (CHAIN_FORMATS as readonly GPUTextureFormat[]).includes(format)
    ? (format as EffectChainFormat)
    : null
}

const MAX_INLINE_COLOR_EFFECTS = 12
const COLOR_BATCH_UNIFORM_SIZE = 16 + MAX_INLINE_COLOR_EFFECTS * 48
const INLINE_COLOR_EFFECT_KINDS = new Map<string, number>([
  ['gpu-brightness', 1],
  ['gpu-contrast', 2],
  ['gpu-exposure', 3],
  ['gpu-hue-shift', 4],
  ['gpu-invert', 5],
  ['gpu-levels', 6],
  ['gpu-saturation', 7],
  ['gpu-temperature', 8],
  ['gpu-grayscale', 9],
  ['gpu-sepia', 10],
  ['gpu-vibrance', 11],
  ['gpu-posterize', 12],
  ['gpu-threshold', 13],
])

const COLOR_BATCH_SHADER = /* wgsl */ `
struct ColorOp {
  header: vec4u,
  values0: vec4f,
  values1: vec4f,
};
struct ColorBatchParams {
  header: vec4u,
  ops: array<ColorOp, ${MAX_INLINE_COLOR_EFFECTS}>,
};
@group(0) @binding(0) var colorBatchSampler: sampler;
@group(0) @binding(1) var colorBatchInput: texture_2d<f32>;
@group(0) @binding(2) var<uniform> colorBatch: ColorBatchParams;

@fragment
fn colorBatchFragment(input: VertexOutput) -> @location(0) vec4f {
  let sampled = textureSample(colorBatchInput, colorBatchSampler, input.uv);
  var color = sampled.rgb;
  for (var index = 0u; index < ${MAX_INLINE_COLOR_EFFECTS}u; index += 1u) {
    if (index < colorBatch.header.x) {
      let op = colorBatch.ops[index];
      if (op.header.x == 1u) {
        color = color + vec3f(op.values0.x);
      } else if (op.header.x == 2u) {
        color = (color - vec3f(0.5)) * op.values0.x + vec3f(0.5);
      } else if (op.header.x == 3u) {
        color = color * pow(2.0, op.values0.x) + vec3f(op.values0.y);
        color = pow(max(color, vec3f(0.0)), vec3f(1.0 / op.values0.z));
      } else if (op.header.x == 4u) {
        var hsv = rgb2hsv(color);
        hsv.x = fract(op.values0.x + op.values0.z * op.values0.w + hsv.x * op.values0.y);
        color = hsv2rgb(hsv);
      } else if (op.header.x == 5u) {
        color = vec3f(1.0) - color;
      } else if (op.header.x == 6u) {
        color = (color - vec3f(op.values0.x)) / (op.values0.y - op.values0.x);
        color = clamp(color, vec3f(0.0), vec3f(1.0));
        color = pow(color, vec3f(1.0 / op.values0.z));
        color = mix(vec3f(op.values0.w), vec3f(op.values1.x), color);
      } else if (op.header.x == 7u) {
        let gray = luminance601(color);
        color = mix(vec3f(gray), color, op.values0.x);
      } else if (op.header.x == 8u) {
        color.r += op.values0.x * 0.1;
        color.b -= op.values0.x * 0.1;
        color.g -= op.values0.y * 0.1;
        color.r += op.values0.y * 0.05;
        color.b += op.values0.y * 0.05;
      } else if (op.header.x == 9u) {
        color = mix(color, vec3f(luminance601(color)), op.values0.x);
      } else if (op.header.x == 10u) {
        let sepia = vec3f(
          dot(color, vec3f(0.393, 0.769, 0.189)),
          dot(color, vec3f(0.349, 0.686, 0.168)),
          dot(color, vec3f(0.272, 0.534, 0.131))
        );
        color = mix(color, sepia, op.values0.x);
      } else if (op.header.x == 11u) {
        let maxChannel = max(max(color.r, color.g), color.b);
        let minChannel = min(min(color.r, color.g), color.b);
        let saturation = (maxChannel - minChannel) / (maxChannel + 0.001);
        let amount = op.values0.x * (1.0 - saturation);
        color = mix(vec3f(luminance601(color)), color, 1.0 + amount);
      } else if (op.header.x == 12u) {
        let levels = max(op.values0.x, 2.0);
        color = floor(color * levels) / (levels - 1.0);
      } else if (op.header.x == 13u) {
        let value = select(0.0, 1.0, luminance(color) > op.values0.x);
        color = vec3f(value);
      }
      // Separate 8-bit passes clamp at their store target after every
      // operation. Keep the clamp so each effect keeps its behaviour, and drop
      // only the quantisation: the chain runs in float and rounds once, when it
      // reaches the 8-bit surface.
      color = clamp(color, vec3f(0.0), vec3f(1.0));
    }
  }
  return vec4f(color, sampled.a);
}`

type PlannedEffectPass =
  | { kind: 'color-batch'; effects: GpuEffectInstance[] }
  | { kind: 'single'; effect: GpuEffectInstance }

function planEffectPasses(
  effects: GpuEffectInstance[],
  enableColorBatch: boolean,
): PlannedEffectPass[] {
  if (!enableColorBatch) {
    return effects.map((effect) => ({ kind: 'single', effect }))
  }
  const passes: PlannedEffectPass[] = []
  for (let index = 0; index < effects.length;) {
    if (!INLINE_COLOR_EFFECT_KINDS.has(effects[index]!.type)) {
      passes.push({ kind: 'single', effect: effects[index]! })
      index++
      continue
    }
    const start = index
    while (
      index < effects.length &&
      index - start < MAX_INLINE_COLOR_EFFECTS &&
      INLINE_COLOR_EFFECT_KINDS.has(effects[index]!.type)
    ) {
      index++
    }
    const batch = effects.slice(start, index)
    if (batch.length > 1) {
      passes.push({ kind: 'color-batch', effects: batch })
    } else {
      passes.push({ kind: 'single', effect: batch[0]! })
    }
  }
  return passes
}

/**
 * Shader for importing an external video texture (texture_external) into the
 * ping texture with positioning. Uses importExternalTexture for zero-copy
 * GPU access to the video decoder's output buffer.
 *
 * destRect uniform: (left, top, right, bottom) in UV space [0..1].
 * Pixels outside the rect are transparent; pixels inside sample the video.
 */
const IMPORT_EXTERNAL_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var videoTex: texture_external;
@group(0) @binding(2) var<uniform> destRect: vec4f;
@fragment
fn importFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let r = destRect;
  if (uv.x < r.x || uv.x > r.z || uv.y < r.y || uv.y > r.w) {
    return vec4f(0.0);
  }
  let videoUv = (uv - r.xy) / (r.zw - r.xy);
  return textureSampleBaseClampToEdge(videoTex, texSampler, videoUv);
}
`

type GpuExternalImageSource =
  | OffscreenCanvas
  | HTMLCanvasElement
  | HTMLVideoElement
  | HTMLImageElement
  | ImageBitmap
  | VideoFrame

function getExternalImageSourceDimensions(source: GpuExternalImageSource): {
  width: number
  height: number
} {
  // The export worker has no DOM element classes (DroneClean: an unguarded check threw there).
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    return { width: source.displayWidth, height: source.displayHeight }
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  const sizedSource = source as HTMLCanvasElement | OffscreenCanvas | ImageBitmap
  return { width: sizedSource.width, height: sizedSource.height }
}

/** Whether a texture is exactly the frame's size — a chain never crops or pads. */
function isFrameSized(texture: GPUTexture, width: number, height: number): boolean {
  return texture.width === width && texture.height === height
}

export class EffectsPipeline {
  /** Immutable shader pipelines are device-owned and safe to share across render sessions. */
  private static sharedPipelineState = new WeakMap<GPUDevice, SharedEffectPipelineState>()

  private device: GPUDevice
  private format: GPUTextureFormat
  private pipelines = new Map<string, GPURenderPipeline>()
  private bindGroupLayouts = new Map<string, GPUBindGroupLayout>()
  // Compute-variant effects (definition.compute set) get their own pipeline +
  // layout maps; the fragment maps above stay untouched. Both are keyed
  // `${format}|${id}` because the storage format is part of the layout.
  private computePipelines = new Map<string, GPUComputePipeline>()
  private computeBindGroupLayouts = new Map<string, GPUBindGroupLayout>()
  private sampler: GPUSampler
  private blitPipeline: GPURenderPipeline | null = null
  private blitBindGroupLayout: GPUBindGroupLayout | null = null
  // Format-converting copy at the chain's boundary: one pipeline per target format.
  private convertBindGroupLayout: GPUBindGroupLayout | null = null
  private convertPipelines = new Map<GPUTextureFormat, GPURenderPipeline | null>()
  // importExternalTexture pipeline for zero-copy video → GPU, one per chain format
  private importPipelines = new Map<string, GPURenderPipeline>()
  private importBindGroupLayout: GPUBindGroupLayout | null = null
  private importUniformBuffer: GPUBuffer | null = null
  private colorBatchPipelines = new Map<string, GPURenderPipeline>()
  private colorBatchBindGroupLayout: GPUBindGroupLayout | null = null
  private pingTexture: GPUTexture | null = null
  private pongTexture: GPUTexture | null = null
  private texW = 0
  private texH = 0
  private texFormat: GPUTextureFormat | null = null
  private initialized = false

  // Reusable uniform buffers per effect-chain pass. A pass must own its buffer
  // because multiple passes are encoded before the command buffer is submitted.
  private uniformBuffers: GPUBuffer[] = []
  // Cached texture views for ping/pong (recreated when textures change)
  private pingView: GPUTextureView | null = null
  private pongView: GPUTextureView | null = null
  // Cached bind groups keyed by "effectId:ping|pong" — invalidated when textures change
  private effectBindGroupCache = new Map<string, GPUBindGroup>()
  // Auxiliary data textures (curve/color LUTs) keyed by "passIndex:effectType".
  // Contents are rewritten in place when the build key changes; the texture is
  // recreated (and bind groups invalidated) only when dimensions change.
  private dataTextureCache = new Map<string, DataTextureCacheEntry>()
  // Cached blit bind groups for ping/pong input views
  private blitBindGroupPing: GPUBindGroup | null = null
  private blitBindGroupPong: GPUBindGroup | null = null
  // Reusable offscreen canvas for applyEffectsToCanvas output (non-batch)
  private outputCanvas: OffscreenCanvas | null = null
  private outputCtx: GPUCanvasContext | null = null
  private outputW = 0
  private outputH = 0
  // Pooled output mode: per-item output canvases for deferred compositing
  private poolMode = false
  private outputPool: { canvas: OffscreenCanvas; ctx: GPUCanvasContext; w: number; h: number }[] =
    []
  private batchIndex = 0

  private constructor(device: GPUDevice) {
    this.device = device
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  }

  // Cached GPU device — requesting a WebGPU adapter + device is the most
  // expensive single operation (~50-100ms). Cache it so subsequent
  // EffectsPipeline instances skip the device request entirely.
  private static _cachedDevice: GPUDevice | null = null
  private static _devicePromise: Promise<GPUDevice | null> | null = null

  static async requestCachedDevice(): Promise<GPUDevice | null> {
    if (EffectsPipeline._cachedDevice) return EffectsPipeline._cachedDevice
    if (EffectsPipeline._devicePromise) return EffectsPipeline._devicePromise
    EffectsPipeline._devicePromise = (async () => {
      if (typeof navigator === 'undefined' || !navigator.gpu) return null
      try {
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) return null
        const device = await adapter.requestDevice({
          requiredFeatures: optionalDeviceFeatures(adapter),
        })
        EffectsPipeline._cachedDevice = device
        device.lost.then(() => {
          if (EffectsPipeline._cachedDevice === device) {
            EffectsPipeline._cachedDevice = null
          }
        })
        return device
      } catch {
        return null
      } finally {
        EffectsPipeline._devicePromise = null
      }
    })()
    return EffectsPipeline._devicePromise
  }

  static async create(): Promise<EffectsPipeline | null> {
    const device = await EffectsPipeline.requestCachedDevice()
    if (!device) return null
    try {
      const pipeline = new EffectsPipeline(device)
      await pipeline.createPipelines()
      return pipeline
    } catch {
      return null
    }
  }

  private async createPipelines(): Promise<void> {
    if (this.initialized) return

    const shared = EffectsPipeline.sharedPipelineState.get(this.device)
    if (shared) {
      // Keep per-instance maps so destroy() cannot invalidate another renderer.
      this.pipelines = new Map(shared.pipelines)
      this.bindGroupLayouts = new Map(shared.bindGroupLayouts)
      this.computePipelines = new Map(shared.computePipelines)
      this.computeBindGroupLayouts = new Map(shared.computeBindGroupLayouts)
      this.blitPipeline = shared.blitPipeline
      this.blitBindGroupLayout = shared.blitBindGroupLayout
      this.importPipelines = new Map(shared.importPipelines)
      this.importBindGroupLayout = shared.importBindGroupLayout
      this.colorBatchPipelines = new Map(shared.colorBatchPipelines)
      this.colorBatchBindGroupLayout = shared.colorBatchBindGroupLayout
      this.createImportResources()
      this.initialized = true
      return
    }

    // Create blit (passthrough) pipeline for final canvas output
    this.createBlitPipeline()
    this.createImportResources()
    this.createColorBatchResources()

    for (const format of CHAIN_FORMATS) {
      this.createImportExternalPipeline(format)
      this.createColorBatchPipeline(format)
      for (const [id, effect] of GPU_EFFECT_REGISTRY) {
        if (effect.compute) {
          this.createComputeEffectPipeline(format, id, effect)
        } else {
          this.createEffectPipeline(format, id, effect)
        }
      }
    }
    EffectsPipeline.sharedPipelineState.set(this.device, {
      pipelines: new Map(this.pipelines),
      bindGroupLayouts: new Map(this.bindGroupLayouts),
      computePipelines: new Map(this.computePipelines),
      computeBindGroupLayouts: new Map(this.computeBindGroupLayouts),
      blitPipeline: this.blitPipeline,
      blitBindGroupLayout: this.blitBindGroupLayout,
      importPipelines: new Map(this.importPipelines),
      importBindGroupLayout: this.importBindGroupLayout,
      colorBatchPipelines: new Map(this.colorBatchPipelines),
      colorBatchBindGroupLayout: this.colorBatchBindGroupLayout,
    })
    this.initialized = true
  }

  private createBlitPipeline(): void {
    const module = this.device.createShaderModule({ label: 'blit', code: BLIT_SHADER })
    this.blitBindGroupLayout = this.device.createBindGroupLayout({
      label: 'blit-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    })
    this.blitPipeline = this.device.createRenderPipeline({
      label: 'blit-pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.blitBindGroupLayout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'blitFragment', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    })
  }

  private getConvertBindGroupLayout(): GPUBindGroupLayout | null {
    if (this.convertBindGroupLayout) return this.convertBindGroupLayout
    try {
      this.convertBindGroupLayout = this.device.createBindGroupLayout({
        label: 'effect-texture-convert-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ],
      })
    } catch (error) {
      getLogger().warn('Failed to create the texture conversion layout', error)
      this.convertBindGroupLayout = null
    }
    return this.convertBindGroupLayout
  }

  /** The copy pipeline for a boundary target format, compiled once per format. */
  private getConvertPipeline(format: GPUTextureFormat): GPURenderPipeline | null {
    const cached = this.convertPipelines.get(format)
    if (cached !== undefined) return cached
    let pipeline: GPURenderPipeline | null = null
    const layout = this.getConvertBindGroupLayout()
    if (layout) {
      try {
        const module = this.device.createShaderModule({
          label: 'effect-texture-convert',
          code: TEXTURE_CONVERT_SHADER,
        })
        pipeline = this.device.createRenderPipeline({
          label: `effect-texture-convert-${format}`,
          layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module, entryPoint: 'vertexMain' },
          fragment: { module, entryPoint: 'convertFragment', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        })
      } catch (error) {
        getLogger().warn(`Failed to create the ${format} texture conversion pipeline`, error)
      }
    }
    this.convertPipelines.set(format, pipeline)
    return pipeline
  }

  /**
   * Copy one same-size texture into another in the encoder, converting formats
   * when they differ. The source is read with `textureLoad` at each pixel, so no
   * sampling filter can touch it; the target is where an 8-bit format rounds.
   *
   * The source must be sampled (`TEXTURE_BINDING`), the target rendered into
   * (`RENDER_ATTACHMENT`); neither needs `COPY_SRC`/`COPY_DST`.
   */
  private encodeTextureConvert(
    commandEncoder: GPUCommandEncoder,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    targetFormat: GPUTextureFormat,
  ): boolean {
    const layout = this.getConvertBindGroupLayout()
    const pipeline = layout ? this.getConvertPipeline(targetFormat) : null
    if (!layout || !pipeline) return false
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: sourceView }],
      }),
    )
    pass.draw(6)
    pass.end()
    return true
  }

  private createImportResources(): void {
    try {
      if (!this.importBindGroupLayout) {
        this.importBindGroupLayout = this.device.createBindGroupLayout({
          label: 'import-external-layout',
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          ],
        })
      }
      // Per instance: it carries one call's destination rect.
      this.importUniformBuffer?.destroy()
      this.importUniformBuffer = this.device.createBuffer({
        size: 16, // vec4f = 4 floats × 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    } catch {
      // importExternalTexture may not be supported — fall back to copyExternalImageToTexture path
      this.importBindGroupLayout = null
      this.importUniformBuffer?.destroy()
      this.importUniformBuffer = null
    }
  }

  private createImportExternalPipeline(format: EffectChainFormat): void {
    if (!this.importBindGroupLayout) return
    try {
      const module = this.device.createShaderModule({
        label: 'import-external',
        code: IMPORT_EXTERNAL_SHADER,
      })
      this.importPipelines.set(
        format,
        this.device.createRenderPipeline({
          label: `import-external-${format}-pipeline`,
          layout: this.device.createPipelineLayout({
            bindGroupLayouts: [this.importBindGroupLayout],
          }),
          vertex: { module, entryPoint: 'vertexMain' },
          fragment: {
            module,
            entryPoint: 'importFragment',
            targets: [{ format }],
          },
          primitive: { topology: 'triangle-list' },
        }),
      )
    } catch (error) {
      getLogger().warn(`Failed to create the ${format} import pipeline`, error)
    }
  }

  private createColorBatchResources(): void {
    try {
      this.colorBatchBindGroupLayout = this.device.createBindGroupLayout({
        label: 'effect-inline-color-batch-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      })
    } catch (error) {
      this.colorBatchBindGroupLayout = null
      getLogger().warn('Failed to create the inline color batch layout', error)
    }
  }

  private createColorBatchPipeline(format: EffectChainFormat): void {
    if (!this.colorBatchBindGroupLayout) return
    try {
      const module = this.device.createShaderModule({
        label: 'effect-inline-color-batch',
        code: `${COMMON_WGSL}\n${COLOR_BATCH_SHADER}`,
      })
      this.colorBatchPipelines.set(
        format,
        this.device.createRenderPipeline({
          label: `effect-inline-color-batch-${format}-pipeline`,
          layout: this.device.createPipelineLayout({
            bindGroupLayouts: [this.colorBatchBindGroupLayout],
          }),
          vertex: { module, entryPoint: 'vertexMain' },
          fragment: {
            module,
            entryPoint: 'colorBatchFragment',
            targets: [{ format }],
          },
          primitive: { topology: 'triangle-list' },
        }),
      )
    } catch (error) {
      // Keep the established one-pass-per-effect path as a capability fallback.
      getLogger().warn(`Failed to create the ${format} inline color batch pipeline`, error)
    }
  }

  private createEffectPipeline(
    format: EffectChainFormat,
    id: string,
    effect: GpuEffectDefinition,
  ): void {
    try {
      const shaderCode = `${COMMON_WGSL}\n${effect.shader}`
      const shaderModule = this.device.createShaderModule({
        label: `effect-${id}`,
        code: shaderCode,
      })

      let bindGroupLayout = this.bindGroupLayouts.get(id)
      if (!bindGroupLayout) {
        const entries: GPUBindGroupLayoutEntry[] = [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ]
        if (effect.uniformSize > 0) {
          entries.push({
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          })
        }
        if (effect.dataTexture) {
          entries.push({
            binding: 3,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { viewDimension: effect.dataTexture.dimension },
          })
        }
        bindGroupLayout = this.device.createBindGroupLayout({
          label: `effect-${id}-layout`,
          entries,
        })
        this.bindGroupLayouts.set(id, bindGroupLayout)
      }

      const pipeline = this.device.createRenderPipeline({
        label: `effect-${id}-${format}-pipeline`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module: shaderModule, entryPoint: 'vertexMain' },
        fragment: {
          module: shaderModule,
          entryPoint: effect.entryPoint,
          targets: [{ format }],
        },
        primitive: { topology: 'triangle-list' },
      })
      this.pipelines.set(`${format}|${id}`, pipeline)
    } catch (e) {
      getLogger().warn(`Failed to create the ${format} pipeline for ${id}`, e)
    }
  }

  private createComputeEffectPipeline(
    format: EffectChainFormat,
    id: string,
    effect: GpuEffectDefinition,
  ): void {
    try {
      // WGSL has no generic storage format: the effect declares the token and
      // the pipeline substitutes the chain format it is compiled for.
      const shaderCode = `${COMMON_WGSL}\n${effect.shader.replaceAll(
        EFFECT_CHAIN_STORAGE_FORMAT,
        format,
      )}`
      const shaderModule = this.device.createShaderModule({
        label: `effect-${id}-compute`,
        code: shaderCode,
      })

      // Compute layout: input as a loadable texture (no sampler — textureLoad),
      // output as a write-only storage texture, uniforms at binding 2.
      const entries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format,
            viewDimension: '2d',
          },
        },
      ]
      if (effect.uniformSize > 0) {
        entries.push({
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        })
      }

      const key = `${format}|${id}`
      const bindGroupLayout = this.device.createBindGroupLayout({
        label: `effect-${id}-compute-layout`,
        entries,
      })
      this.computeBindGroupLayouts.set(key, bindGroupLayout)

      const pipeline = this.device.createComputePipeline({
        label: `effect-${id}-compute-pipeline`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: { module: shaderModule, entryPoint: effect.entryPoint },
      })
      this.computePipelines.set(key, pipeline)
    } catch (e) {
      getLogger().warn(`Failed to create compute pipeline for ${id}`, e)
    }
  }

  private ensurePingPong(w: number, h: number, format: GPUTextureFormat): void {
    if (this.pingTexture && this.texW === w && this.texH === h && this.texFormat === format) return
    this.pingTexture?.destroy()
    this.pongTexture?.destroy()
    const desc: GPUTextureDescriptor = {
      size: { width: w, height: h },
      format,
      // STORAGE_BINDING lets compute-variant effects write these textures via
      // textureStore. rgba16float is a core writable-storage format, so this
      // needs no extra device feature. Fragment effects ignore the extra usage.
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    }
    this.pingTexture = this.device.createTexture(desc)
    this.pongTexture = this.device.createTexture(desc)
    this.pingView = this.pingTexture.createView()
    this.pongView = this.pongTexture.createView()
    // Invalidate bind group caches — they reference old texture views
    this.effectBindGroupCache.clear()
    this.blitBindGroupPing = null
    this.blitBindGroupPong = null
    this.texW = w
    this.texH = h
    this.texFormat = format
  }

  /**
   * Ensure the auxiliary data texture for this pass is up to date.
   * Rewrites contents in place when only the data changed; recreates the
   * texture (invalidating cached bind groups) when dimensions changed.
   */
  private getOrUpdateDataTexture(
    passIndex: number,
    effect: GpuEffectInstance,
    definition: GpuEffectDefinition,
  ): GPUTextureView | null {
    const spec = definition.dataTexture
    if (!spec) return null

    const cacheId = `${passIndex}:${effect.type}`
    const key = spec.key(effect.params)
    const cached = this.dataTextureCache.get(cacheId)
    if (cached && cached.key === key) {
      return cached.view
    }

    let payload: EffectDataTexturePayload
    try {
      payload = spec.build(effect.params)
    } catch (e) {
      getLogger().warn(`Failed to build data texture for ${effect.type}`, e)
      return cached?.view ?? null
    }

    const entry = this.acquireDataTextureEntry(cacheId, effect.type, spec, payload, key, cached)
    this.device.queue.writeTexture(
      { texture: entry.texture },
      tableToHalf(payload.data) as BufferSource,
      { bytesPerRow: payload.width * 8, rowsPerImage: payload.height },
      { width: payload.width, height: payload.height, depthOrArrayLayers: payload.depth },
    )

    return entry.view
  }

  /** Reuse the cached texture when dimensions match; otherwise recreate it. */
  private acquireDataTextureEntry(
    cacheId: string,
    effectType: string,
    spec: EffectDataTextureSpec,
    payload: EffectDataTexturePayload,
    key: string,
    cached: DataTextureCacheEntry | undefined,
  ): DataTextureCacheEntry {
    const sameDims =
      cached !== undefined &&
      cached.width === payload.width &&
      cached.height === payload.height &&
      cached.depth === payload.depth

    if (cached && sameDims) {
      cached.key = key
      return cached
    }

    cached?.texture.destroy()
    const texture = this.device.createTexture({
      label: `effect-${effectType}-data`,
      size: { width: payload.width, height: payload.height, depthOrArrayLayers: payload.depth },
      dimension: spec.dimension === '3d' ? '3d' : '2d',
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    const entry: DataTextureCacheEntry = {
      key,
      texture,
      view: texture.createView({ dimension: spec.dimension }),
      width: payload.width,
      height: payload.height,
      depth: payload.depth,
    }
    this.dataTextureCache.set(cacheId, entry)
    // Bind groups reference the old texture view — rebuild them lazily.
    this.effectBindGroupCache.clear()
    return entry
  }

  private getOrCreateUniformBuffer(passIndex: number, size: number): GPUBuffer {
    let buf = this.uniformBuffers[passIndex]
    if (buf && buf.size >= size) return buf
    buf?.destroy()
    buf = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.uniformBuffers[passIndex] = buf
    this.effectBindGroupCache.clear()
    return buf
  }

  private runEffectChain(
    commandEncoder: GPUCommandEncoder,
    effects: GpuEffectInstance[],
    startInput: GPUTexture,
    startOutput: GPUTexture,
    w: number,
    h: number,
    format: EffectChainFormat,
  ): GPUTexture {
    let inputTex = startInput
    let outputTex = startOutput
    let inputView = inputTex === this.pingTexture ? this.pingView! : this.pongView!
    let outputView = outputTex === this.pingTexture ? this.pingView! : this.pongView!
    const colorBatchPipeline = this.colorBatchPipelines.get(format) ?? null

    const passes = planEffectPasses(
      effects,
      colorBatchPipeline !== null && this.colorBatchBindGroupLayout !== null,
    )
    for (let passIndex = 0; passIndex < passes.length; passIndex++) {
      const plannedPass = passes[passIndex]!
      if (plannedPass.kind === 'color-batch') {
        if (!colorBatchPipeline || !this.colorBatchBindGroupLayout) continue
        const packed = new ArrayBuffer(COLOR_BATCH_UNIFORM_SIZE)
        new Uint32Array(packed, 0, 4)[0] = plannedPass.effects.length
        for (let opIndex = 0; opIndex < plannedPass.effects.length; opIndex++) {
          const effect = plannedPass.effects[opIndex]!
          const kind = INLINE_COLOR_EFFECT_KINDS.get(effect.type)!
          const definition = getGpuEffect(effect.type)!
          const byteOffset = 16 + opIndex * 48
          new Uint32Array(packed, byteOffset, 4)[0] = kind
          const values = definition.packUniforms(
            effect.params,
            w,
            h,
            effect.timelineTimeSeconds ?? 0,
          )
          if (values) {
            new Float32Array(packed, byteOffset + 16, 8).set(values.subarray(0, 8))
          }
        }
        const uniformBuffer = this.getOrCreateUniformBuffer(passIndex, COLOR_BATCH_UNIFORM_SIZE)
        this.device.queue.writeBuffer(uniformBuffer, 0, packed)
        const viewKey = inputView === this.pingView ? 'ping' : 'pong'
        const cacheKey = `${passIndex}:inline-color-batch:${viewKey}`
        let bindGroup = this.effectBindGroupCache.get(cacheKey)
        if (!bindGroup) {
          bindGroup = this.device.createBindGroup({
            layout: this.colorBatchBindGroupLayout,
            entries: [
              { binding: 0, resource: this.sampler },
              { binding: 1, resource: inputView },
              { binding: 2, resource: { buffer: uniformBuffer } },
            ],
          })
          this.effectBindGroupCache.set(cacheKey, bindGroup)
        }
        const pass = commandEncoder.beginRenderPass({
          colorAttachments: [{ view: outputView, loadOp: 'clear', storeOp: 'store' }],
        })
        pass.setPipeline(colorBatchPipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(6)
        pass.end()

        ;[inputTex, outputTex] = [outputTex, inputTex]
        ;[inputView, outputView] = [outputView, inputView]
        continue
      }

      const effect = plannedPass.effect
      const definition = getGpuEffect(effect.type)
      if (!definition) continue

      const uniformData = definition.packUniforms(
        effect.params,
        w,
        h,
        effect.timelineTimeSeconds ?? 0,
      )
      let uniformBuffer: GPUBuffer | undefined
      if (uniformData) {
        uniformBuffer = this.getOrCreateUniformBuffer(passIndex, uniformData.byteLength)
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer)
      }

      // Bind groups are cached by pass, effect type, and input view identity.
      // Uniform contents change via writeBuffer, but each encoded pass gets a
      // stable buffer object of its own, so the cached group stays valid.
      const viewKey = inputView === this.pingView ? 'ping' : 'pong'

      // Compute-variant effects: read input via textureLoad, scatter to the
      // output storage texture. Output is the opposite ping/pong texture, so no
      // read-after-write hazard within the pass.
      if (definition.compute) {
        const computePipeline = this.computePipelines.get(`${format}|${effect.type}`)
        const computeLayout = this.computeBindGroupLayouts.get(`${format}|${effect.type}`)
        if (!computePipeline || !computeLayout) continue

        const cacheKey = `${passIndex}:${effect.type}:compute:${viewKey}`
        let bindGroup = this.effectBindGroupCache.get(cacheKey)
        if (!bindGroup) {
          const bindEntries: GPUBindGroupEntry[] = [
            { binding: 0, resource: inputView },
            { binding: 1, resource: outputView },
          ]
          if (uniformBuffer) {
            bindEntries.push({ binding: 2, resource: { buffer: uniformBuffer } })
          }
          bindGroup = this.device.createBindGroup({ layout: computeLayout, entries: bindEntries })
          this.effectBindGroupCache.set(cacheKey, bindGroup)
        }

        const [gx, gy, gz] = definition.compute.dispatch(w, h)
        const pass = commandEncoder.beginComputePass()
        pass.setPipeline(computePipeline)
        pass.setBindGroup(0, bindGroup)
        pass.dispatchWorkgroups(gx, gy, gz)
        pass.end()

        const tempTexC = inputTex
        inputTex = outputTex
        outputTex = tempTexC
        const tempViewC = inputView
        inputView = outputView
        outputView = tempViewC
        continue
      }

      const pipeline = this.pipelines.get(`${format}|${effect.type}`)
      const layout = this.bindGroupLayouts.get(effect.type)
      if (!pipeline || !layout) continue

      // Auxiliary data texture (curve/color LUT) — kept current before binding.
      let dataTextureView: GPUTextureView | null = null
      if (definition.dataTexture) {
        dataTextureView = this.getOrUpdateDataTexture(passIndex, effect, definition)
        if (!dataTextureView) continue
      }

      const cacheKey = `${passIndex}:${effect.type}:${viewKey}`
      let bindGroup = this.effectBindGroupCache.get(cacheKey)
      if (!bindGroup) {
        const bindEntries: GPUBindGroupEntry[] = [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: inputView },
        ]
        if (uniformBuffer) {
          bindEntries.push({ binding: 2, resource: { buffer: uniformBuffer } })
        }
        if (dataTextureView) {
          bindEntries.push({ binding: 3, resource: dataTextureView })
        }
        bindGroup = this.device.createBindGroup({ layout, entries: bindEntries })
        this.effectBindGroupCache.set(cacheKey, bindGroup)
      }

      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: outputView,
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(6)
      pass.end()

      const tempTex = inputTex
      inputTex = outputTex
      outputTex = tempTex
      const tempView = inputView
      inputView = outputView
      outputView = tempView
    }

    return inputTex
  }

  /**
   * Finish a chain whose source already sits in the ping texture: run the
   * effects and write the result into the caller's texture through the
   * conversion pass. The caller has checked the ping/pong pair.
   */
  private finishChainIntoTexture(
    commandEncoder: GPUCommandEncoder,
    effects: GpuEffectInstance[],
    width: number,
    height: number,
    format: EffectChainFormat,
    outputTexture: GPUTexture,
  ): boolean {
    const finalTex = this.runEffectChain(
      commandEncoder,
      effects,
      this.pingTexture!,
      this.pongTexture!,
      width,
      height,
      format,
    )
    const finalView = finalTex === this.pingTexture ? this.pingView! : this.pongView!
    return this.encodeTextureConvert(
      commandEncoder,
      finalView,
      outputTexture.createView(),
      outputTexture.format,
    )
  }

  configureCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): GPUCanvasContext | null {
    try {
      const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null
      if (!ctx) return null
      ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' })
      return ctx
    } catch {
      return null
    }
  }

  /**
   * Begin pooled output mode. Each applyEffectsToCanvas call gets its own
   * output canvas from a pool and submits immediately. This allows the GPU
   * to pipeline work across items. Callers should defer compositing
   * (drawImage) until all items are processed — the first drawImage stalls
   * for all preceding GPU work, subsequent ones are free.
   */
  beginBatch(): void {
    this.poolMode = true
    this.batchIndex = 0
  }

  /**
   * End pooled output mode. Reset pool index for next frame.
   */
  endBatch(): void {
    this.poolMode = false
    this.batchIndex = 0
  }

  isBatching(): boolean {
    return this.poolMode
  }

  async waitForSubmittedWork(): Promise<void> {
    await this.device.queue.onSubmittedWorkDone()
  }

  private acquirePooledOutput(
    w: number,
    h: number,
  ): { canvas: OffscreenCanvas; ctx: GPUCanvasContext } | null {
    let entry = this.outputPool[this.batchIndex]
    if (entry) {
      if (entry.w !== w || entry.h !== h) {
        entry.canvas.width = w
        entry.canvas.height = h
        const ctx = this.configureCanvas(entry.canvas)
        if (!ctx) return null
        entry.ctx = ctx
        entry.w = w
        entry.h = h
      }
    } else {
      const canvas = new OffscreenCanvas(w, h)
      const ctx = this.configureCanvas(canvas)
      if (!ctx) return null
      entry = { canvas, ctx, w, h }
      this.outputPool.push(entry)
    }
    this.batchIndex++
    return entry
  }

  /**
   * Apply effects to a canvas source and return a canvas with the result.
   * Zero-copy input via copyExternalImageToTexture, GPU-rendered output.
   *
   * The chain runs in `rgba8unorm`: the source and the canvas are both 8-bit, so
   * this is today's path and keeps its exact pixels (the precise path's float
   * chain reaches the canvas through a texture output instead).
   *
   * In pool mode (beginBatch/endBatch): each call gets its own output canvas
   * from a pool and submits immediately. The GPU pipelines work across items.
   * Callers should defer compositing (drawImage) until all items are processed.
   *
   * Outside pool mode: uses a single reusable output canvas.
   */
  applyEffectsToCanvas(
    source: OffscreenCanvas | HTMLCanvasElement | HTMLVideoElement,
    effects: GpuEffectInstance[],
  ): OffscreenCanvas | null {
    const enabled = effects.filter((e) => e.enabled)
    if (enabled.length === 0) return null
    if (!this.blitPipeline || !this.blitBindGroupLayout) return null

    const { width: w, height: h } = getExternalImageSourceDimensions(source)
    if (w < 2 || h < 2) return null

    // Get output canvas — from pool in pool mode, reusable single otherwise
    let outCanvas: OffscreenCanvas
    let outCtx: GPUCanvasContext

    if (this.poolMode) {
      const entry = this.acquirePooledOutput(w, h)
      if (!entry) return null
      outCanvas = entry.canvas
      outCtx = entry.ctx
    } else {
      if (!this.outputCanvas || this.outputW !== w || this.outputH !== h) {
        this.outputCanvas = new OffscreenCanvas(w, h)
        this.outputCtx = this.configureCanvas(this.outputCanvas)
        this.outputW = w
        this.outputH = h
      }
      if (!this.outputCtx) return null
      outCanvas = this.outputCanvas
      outCtx = this.outputCtx
    }

    this.ensurePingPong(w, h, BYTE_CHAIN_FORMAT)
    if (!this.pingTexture || !this.pongTexture) return null

    // Upload source → GPU texture (zero-copy path, no ImageData)
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.pingTexture },
      { width: w, height: h },
    )

    const commandEncoder = this.device.createCommandEncoder()

    const finalTex = this.runEffectChain(
      commandEncoder,
      enabled,
      this.pingTexture,
      this.pongTexture,
      w,
      h,
      BYTE_CHAIN_FORMAT,
    )

    // Blit to output canvas (cached bind group for ping/pong input)
    const isPingFinal = finalTex === this.pingTexture
    const blitBindGroup = isPingFinal
      ? (this.blitBindGroupPing ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pingView! },
          ],
        }))
      : (this.blitBindGroupPong ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pongView! },
          ],
        }))

    drawFullscreenCanvasPass({
      device: this.device,
      context: outCtx,
      pipeline: this.blitPipeline!,
      bindGroup: blitBindGroup,
      encoder: commandEncoder,
    })

    return outCanvas
  }

  /**
   * Apply effects into a caller-owned GPU texture.
   *
   * This keeps the effect output GPU-native for downstream passes such as
   * transitions or compositing. The source is still uploaded when it is a canvas,
   * but the effect result no longer bounces through a WebGPU canvas just to be
   * uploaded again by the next GPU stage.
   *
   * The chain runs in the output texture's format: `EFFECT_TEXTURE_FORMAT` for
   * the precise path, `rgba8unorm` for the 8-bit path, which keeps today's
   * pixels exactly. A conversion pass writes the result, so the output must be
   * renderable; with no effects the source is uploaded straight into it.
   */
  applyEffectsToTexture(
    source: GpuExternalImageSource,
    effects: GpuEffectInstance[],
    outputTexture: GPUTexture,
  ): boolean {
    const enabled = effects.filter((e) => e.enabled)

    const { width: w, height: h } = getExternalImageSourceDimensions(source)
    if (w < 2 || h < 2) return false
    if (!isFrameSized(outputTexture, w, h)) return false

    if (enabled.length === 0) {
      this.device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        { texture: outputTexture },
        { width: w, height: h },
      )
      return true
    }
    const chainFormat = chainFormatFor(outputTexture.format)
    if (!chainFormat) return false
    this.ensurePingPong(w, h, chainFormat)
    if (!this.pingTexture || !this.pongTexture) return false

    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.pingTexture },
      { width: w, height: h },
    )

    const commandEncoder = this.device.createCommandEncoder()
    if (!this.finishChainIntoTexture(commandEncoder, enabled, w, h, chainFormat, outputTexture)) {
      return false
    }
    this.device.queue.submit([commandEncoder.finish()])
    return true
  }

  /**
   * Apply effects from one GPU texture into another: the source texture in, the
   * texture the composite reads out.
   *
   * Both textures may be `EFFECT_TEXTURE_FORMAT` (the precise path) or
   * `rgba8unorm` (the preview's 8-bit path), and the two may differ. The chain
   * runs in the output texture's format, so an 8-bit output keeps today's
   * pixels exactly; the source is read by a conversion pass into the ping
   * texture and the result is written by another into the output. The source
   * must be sampled and the output renderable, but neither needs
   * `COPY_SRC`/`COPY_DST`.
   */
  applyTextureEffectsToTexture(
    sourceTexture: GPUTexture,
    effects: GpuEffectInstance[],
    outputTexture: GPUTexture,
    width: number,
    height: number,
  ): boolean {
    const enabled = effects.filter((e) => e.enabled)
    if (width < 2 || height < 2) return false
    if (!isFrameSized(sourceTexture, width, height)) return false
    if (!isFrameSized(outputTexture, width, height)) return false
    const chainFormat = chainFormatFor(outputTexture.format)
    if (!chainFormat || !chainFormatFor(sourceTexture.format)) return false

    const outputView = outputTexture.createView()
    const commandEncoder = this.device.createCommandEncoder()
    if (enabled.length === 0) {
      const converted = this.encodeTextureConvert(
        commandEncoder,
        sourceTexture.createView(),
        outputView,
        outputTexture.format,
      )
      if (!converted) return false
      this.device.queue.submit([commandEncoder.finish()])
      return true
    }

    this.ensurePingPong(width, height, chainFormat)
    if (!this.pingTexture || !this.pongTexture) return false
    const readIntoPing = this.encodeTextureConvert(
      commandEncoder,
      sourceTexture.createView(),
      this.pingView!,
      chainFormat,
    )
    if (!readIntoPing) return false
    if (
      !this.finishChainIntoTexture(
        commandEncoder,
        enabled,
        width,
        height,
        chainFormat,
        outputTexture,
      )
    ) {
      return false
    }
    this.device.queue.submit([commandEncoder.finish()])
    return true
  }

  /**
   * Apply effects directly from an HTMLVideoElement via importExternalTexture.
   * Zero-copy: the GPU reads directly from the video decoder's output buffer.
   * Positions the video at `destRect` on a canvas of `canvasWidth × canvasHeight`.
   *
   * Falls back to null if importExternalTexture is not supported or fails.
   */
  applyEffectsToVideo(
    video: HTMLVideoElement,
    effects: GpuEffectInstance[],
    destRect: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
  ): OffscreenCanvas | null {
    const enabled = effects.filter((e) => e.enabled)
    if (enabled.length === 0) return null
    const importPipeline = this.importPipelines.get(BYTE_CHAIN_FORMAT)
    if (!importPipeline || !this.importBindGroupLayout || !this.importUniformBuffer) return null
    if (!this.blitPipeline || !this.blitBindGroupLayout) return null
    if (video.readyState < 2 || video.videoWidth < 2) return null

    const w = canvasWidth
    const h = canvasHeight
    if (w < 2 || h < 2) return null

    // Get output canvas
    let outCanvas: OffscreenCanvas
    let outCtx: GPUCanvasContext
    if (this.poolMode) {
      const entry = this.acquirePooledOutput(w, h)
      if (!entry) return null
      outCanvas = entry.canvas
      outCtx = entry.ctx
    } else {
      if (!this.outputCanvas || this.outputW !== w || this.outputH !== h) {
        this.outputCanvas = new OffscreenCanvas(w, h)
        this.outputCtx = this.configureCanvas(this.outputCanvas)
        this.outputW = w
        this.outputH = h
      }
      if (!this.outputCtx) return null
      outCanvas = this.outputCanvas
      outCtx = this.outputCtx
    }

    this.ensurePingPong(w, h, BYTE_CHAIN_FORMAT)
    if (!this.pingTexture || !this.pongTexture) return null

    // Import video as external texture (truly zero-copy — no pixel transfer)
    let externalTexture: GPUExternalTexture
    try {
      externalTexture = this.device.importExternalTexture({ source: video })
    } catch {
      return null // importExternalTexture failed — caller should fall back
    }

    // Compute destination rect in UV space [0..1]
    const uvRect = new Float32Array([
      destRect.x / w,
      destRect.y / h,
      (destRect.x + destRect.width) / w,
      (destRect.y + destRect.height) / h,
    ])
    this.device.queue.writeBuffer(this.importUniformBuffer, 0, uvRect.buffer)

    const commandEncoder = this.device.createCommandEncoder()

    // Pass 1: Import external texture → ping texture (with positioning)
    const importBindGroup = this.device.createBindGroup({
      layout: this.importBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: externalTexture },
        { binding: 2, resource: { buffer: this.importUniformBuffer } },
      ],
    })

    const importPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.pingView!,
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        },
      ],
    })
    importPass.setPipeline(importPipeline)
    importPass.setBindGroup(0, importBindGroup)
    importPass.draw(6)
    importPass.end()

    // Pass 2+: Effect chain (ping/pong as usual)
    const finalTex = this.runEffectChain(
      commandEncoder,
      enabled,
      this.pingTexture,
      this.pongTexture,
      w,
      h,
      BYTE_CHAIN_FORMAT,
    )

    // Final blit to output canvas (cached bind group for ping/pong input)
    const isPingFinal = finalTex === this.pingTexture
    const blitBindGroup = isPingFinal
      ? (this.blitBindGroupPing ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pingView! },
          ],
        }))
      : (this.blitBindGroupPong ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pongView! },
          ],
        }))

    drawFullscreenCanvasPass({
      device: this.device,
      context: outCtx,
      pipeline: this.blitPipeline!,
      bindGroup: blitBindGroup,
      encoder: commandEncoder,
    })

    return outCanvas
  }

  /**
   * Like applyEffectsToVideo, but writes the result into a caller-owned
   * GPUTexture instead of blitting to a WebGPU canvas. Keeps the effected video
   * frame GPU-native so it can be fed straight into the GPU compositor as a
   * layer — avoiding the per-item `drawImage(gpuCanvas -> 2D canvas)` readback
   * the canvas-output path forces during preview compositing.
   *
   * Zero-copy source (importExternalTexture). Returns false if
   * importExternalTexture is unsupported, the video isn't ready, the output
   * texture's dimensions don't match canvasWidth/canvasHeight, or its format is
   * neither boundary format. The chain runs in that format, so an 8-bit output
   * keeps today's pixels exactly; the result reaches it through a conversion
   * pass, so it must be renderable.
   */
  applyEffectsToVideoTexture(
    video: HTMLVideoElement,
    effects: GpuEffectInstance[],
    destRect: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
    outputTexture: GPUTexture,
  ): boolean {
    const enabled = effects.filter((e) => e.enabled)
    if (video.readyState < 2 || video.videoWidth < 2) return false

    const w = canvasWidth
    const h = canvasHeight
    if (w < 2 || h < 2) return false
    if (!isFrameSized(outputTexture, w, h)) return false
    const chainFormat = chainFormatFor(outputTexture.format)
    if (!chainFormat) return false
    const importPipeline = this.importPipelines.get(chainFormat)
    if (!importPipeline || !this.importBindGroupLayout || !this.importUniformBuffer) return false

    this.ensurePingPong(w, h, chainFormat)
    if (!this.pingTexture || !this.pongTexture) return false

    let externalTexture: GPUExternalTexture
    try {
      externalTexture = this.device.importExternalTexture({ source: video })
    } catch {
      return false
    }

    const uvRect = new Float32Array([
      destRect.x / w,
      destRect.y / h,
      (destRect.x + destRect.width) / w,
      (destRect.y + destRect.height) / h,
    ])
    this.device.queue.writeBuffer(this.importUniformBuffer, 0, uvRect.buffer)

    const commandEncoder = this.device.createCommandEncoder()

    // Pass 1: import external video texture → ping (with positioning).
    const importBindGroup = this.device.createBindGroup({
      layout: this.importBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: externalTexture },
        { binding: 2, resource: { buffer: this.importUniformBuffer } },
      ],
    })
    const importPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.pingView!,
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        },
      ],
    })
    importPass.setPipeline(importPipeline)
    importPass.setBindGroup(0, importBindGroup)
    importPass.draw(6)
    importPass.end()

    // Pass 2+: effect chain (a no-op when empty — ping already holds the frame).
    if (!this.finishChainIntoTexture(commandEncoder, enabled, w, h, chainFormat, outputTexture)) {
      return false
    }
    this.device.queue.submit([commandEncoder.finish()])
    return true
  }

  getDevice(): GPUDevice {
    return this.device
  }

  destroy(): void {
    this.pingTexture?.destroy()
    this.pongTexture?.destroy()
    this.pingTexture = null
    this.pongTexture = null
    this.pingView = null
    this.pongView = null
    this.texFormat = null
    this.outputCanvas = null
    this.outputCtx = null
    this.outputW = 0
    this.outputH = 0
    this.poolMode = false
    this.outputPool = []
    this.batchIndex = 0
    // `uniformBuffers` is indexed by effect position, so a skipped or
    // uniform-less effect leaves a hole. `for...of` yields `undefined` for
    // sparse holes (unlike `.forEach`), so guard before destroying.
    for (const buf of this.uniformBuffers) {
      buf?.destroy()
    }
    this.uniformBuffers = []
    for (const entry of this.dataTextureCache.values()) {
      entry.texture.destroy()
    }
    this.dataTextureCache.clear()
    this.effectBindGroupCache.clear()
    this.blitBindGroupPing = null
    this.blitBindGroupPong = null
    this.pipelines.clear()
    this.bindGroupLayouts.clear()
    this.computePipelines.clear()
    this.computeBindGroupLayouts.clear()
    this.blitPipeline = null
    this.blitBindGroupLayout = null
    this.convertBindGroupLayout = null
    this.convertPipelines.clear()
    this.importPipelines.clear()
    this.importBindGroupLayout = null
    this.importUniformBuffer?.destroy()
    this.importUniformBuffer = null
    this.colorBatchPipelines.clear()
    this.colorBatchBindGroupLayout = null
    this.initialized = false
  }
}
