import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { PRECISE_RENDER_FORMAT } from '@/studio/render/precise/contract'
import { GPU_EFFECT_REGISTRY } from './registry'
import { EffectsPipeline } from './effects-pipeline'
import {
  EFFECT_BYTE_TEXTURE_FORMAT,
  EFFECT_CHAIN_STORAGE_FORMAT,
  EFFECT_TEXTURE_FORMAT,
  type EffectChainFormat,
  type GpuEffectInstance,
} from './types'

const originalShaderStage = globalThis.GPUShaderStage
const originalBufferUsage = globalThis.GPUBufferUsage
const originalTextureUsage = globalThis.GPUTextureUsage
const originalGpuDescriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu')

afterEach(() => {
  vi.restoreAllMocks()
  Object.assign(globalThis, {
    GPUShaderStage: originalShaderStage,
    GPUBufferUsage: originalBufferUsage,
    GPUTextureUsage: originalTextureUsage,
  })
  if (originalGpuDescriptor) {
    Object.defineProperty(navigator, 'gpu', originalGpuDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'gpu')
  }
})

describe('EffectsPipeline device ownership', () => {
  it('reuses immutable compiled pipelines across renderer sessions on one device', async () => {
    Object.assign(globalThis, {
      GPUShaderStage: { FRAGMENT: 1, COMPUTE: 2 },
      GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
    })
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { getPreferredCanvasFormat: () => 'rgba8unorm' },
    })
    const createRenderPipeline = vi.fn(() => ({}))
    const createComputePipeline = vi.fn(() => ({}))
    const device = {
      createSampler: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({})),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline,
      createComputePipeline,
      createBuffer: vi.fn(() => ({ destroy: vi.fn(), size: 16 })),
    } as unknown as GPUDevice
    const Pipeline = EffectsPipeline as unknown as new (device: GPUDevice) => EffectsPipeline
    const initialize = (pipeline: EffectsPipeline) =>
      (
        pipeline as unknown as {
          createPipelines(): Promise<void>
        }
      ).createPipelines()

    const first = new Pipeline(device)
    await initialize(first)
    const renderPipelineCount = createRenderPipeline.mock.calls.length
    const computePipelineCount = createComputePipeline.mock.calls.length
    expect(renderPipelineCount + computePipelineCount).toBeGreaterThanOrEqual(
      GPU_EFFECT_REGISTRY.size,
    )

    const second = new Pipeline(device)
    await initialize(second)
    expect(createRenderPipeline).toHaveBeenCalledTimes(renderPipelineCount)
    expect(createComputePipeline).toHaveBeenCalledTimes(computePipelineCount)

    first.destroy()
    const secondState = second as unknown as { pipelines: Map<string, GPURenderPipeline> }
    expect(secondState.pipelines.size).toBeGreaterThan(0)
  })
})

describe('EffectsPipeline pass planning', () => {
  it('fuses adjacent color operations while preserving spatial-effect boundaries', async () => {
    Object.assign(globalThis, {
      GPUShaderStage: { FRAGMENT: 1, COMPUTE: 2 },
      GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
    })
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { getPreferredCanvasFormat: () => 'rgba8unorm' },
    })

    const writeBuffer = vi.fn()
    const device = {
      queue: { writeBuffer },
      createSampler: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({})),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createComputePipeline: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => ({
        destroy: vi.fn(),
        size: descriptor.size,
      })),
    } as unknown as GPUDevice
    const Pipeline = EffectsPipeline as unknown as new (device: GPUDevice) => EffectsPipeline
    const pipeline = new Pipeline(device)
    await (
      pipeline as unknown as {
        createPipelines(): Promise<void>
      }
    ).createPipelines()

    const ping = {} as GPUTexture
    const pong = {} as GPUTexture
    const pingView = {} as GPUTextureView
    const pongView = {} as GPUTextureView
    Object.assign(pipeline, {
      pingTexture: ping,
      pongTexture: pong,
      pingView,
      pongView,
    })

    const beginRenderPass = vi.fn(() => ({
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    }))
    const encoder = { beginRenderPass } as unknown as GPUCommandEncoder
    const run = (effects: GpuEffectInstance[]): GPUTexture =>
      (
        pipeline as unknown as {
          runEffectChain(
            encoder: GPUCommandEncoder,
            effects: GpuEffectInstance[],
            input: GPUTexture,
            output: GPUTexture,
            width: number,
            height: number,
            format: EffectChainFormat,
          ): GPUTexture
        }
      ).runEffectChain(encoder, effects, ping, pong, 1920, 1080, EFFECT_TEXTURE_FORMAT)
    const effect = (
      type: string,
      params: Record<string, number | boolean | string> = {},
    ): GpuEffectInstance => ({ id: type, type, name: type, enabled: true, params })

    const fusedOutput = run([
      effect('gpu-brightness', { amount: 0.1 }),
      effect('gpu-contrast', { amount: 1.2 }),
      effect('gpu-saturation', { amount: 0.8 }),
      effect('gpu-invert'),
    ])
    expect(beginRenderPass).toHaveBeenCalledTimes(1)
    expect(fusedOutput).toBe(pong)
    const packedBatch = writeBuffer.mock.calls[0]![2] as ArrayBuffer
    expect(new Uint32Array(packedBatch, 0, 1)[0]).toBe(4)

    beginRenderPass.mockClear()
    run([
      effect('gpu-brightness', { amount: 0.1 }),
      effect('gpu-gaussian-blur', { radius: 10, samples: 5 }),
      effect('gpu-contrast', { amount: 1.2 }),
    ])
    expect(beginRenderPass).toHaveBeenCalledTimes(3)

    // Both fused and standalone passes must receive the requested frame time.
    const hue = GPU_EFFECT_REGISTRY.get('gpu-hue-shift')!
    const glitch = GPU_EFFECT_REGISTRY.get('gpu-color-glitch')!
    const huePack = vi.spyOn(hue, 'packUniforms')
    const glitchPack = vi.spyOn(glitch, 'packUniforms')
    run([
      { ...effect('gpu-hue-shift'), timelineTimeSeconds: 5.125 },
      { ...effect('gpu-color-glitch'), timelineTimeSeconds: 5.125 },
    ])
    expect(huePack).toHaveBeenLastCalledWith({}, 1920, 1080, 5.125)
    expect(glitchPack).toHaveBeenLastCalledWith({}, 1920, 1080, 5.125)

    beginRenderPass.mockClear()
    Object.assign(pipeline, {
      colorBatchPipelines: new Map(),
      colorBatchBindGroupLayout: null,
    })
    run([effect('gpu-brightness', { amount: 0.1 }), effect('gpu-contrast', { amount: 1.2 })])
    expect(beginRenderPass).toHaveBeenCalledTimes(2)
  })
})

/**
 * jsdom has no WebGPU, so these tests read the descriptors the pipeline hands
 * to the device. What they cannot prove is that the GPU accepts them: the
 * golden run is the proof of the pixels.
 */
function installFakeGpu() {
  Object.assign(globalThis, {
    GPUShaderStage: { FRAGMENT: 1, COMPUTE: 2 },
    GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
    GPUTextureUsage: {
      COPY_SRC: 1,
      COPY_DST: 2,
      TEXTURE_BINDING: 4,
      STORAGE_BINDING: 8,
      RENDER_ATTACHMENT: 16,
    },
  })
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { getPreferredCanvasFormat: () => 'bgra8unorm' },
  })

  const copyTextureToTexture = vi.fn()
  const beginRenderPass = vi.fn((descriptor: GPURenderPassDescriptor) => ({
    descriptor,
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  }))
  const createCommandEncoder = vi.fn(() => ({
    copyTextureToTexture,
    beginRenderPass,
    finish: vi.fn(() => ({})),
  }))
  const createShaderModule = vi.fn((_descriptor: GPUShaderModuleDescriptor) => ({}))
  const createRenderPipeline = vi.fn((descriptor: GPURenderPipelineDescriptor) => ({
    label: descriptor.label,
  }))
  const createComputePipeline = vi.fn((_descriptor: GPUComputePipelineDescriptor) => ({}))
  const createBindGroupLayout = vi.fn((_descriptor: GPUBindGroupLayoutDescriptor) => ({}))
  const createTexture = vi.fn((_descriptor: GPUTextureDescriptor) => ({
    createView: () => ({}),
    destroy: vi.fn(),
  }))
  const device = {
    queue: {
      writeBuffer: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
      submit: vi.fn(),
    },
    createSampler: vi.fn(() => ({})),
    createShaderModule,
    createBindGroupLayout,
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline,
    createComputePipeline,
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn(), size: 16 })),
    createTexture,
    createCommandEncoder,
    importExternalTexture: vi.fn(() => ({})),
  } as unknown as GPUDevice

  return {
    device,
    createShaderModule,
    createRenderPipeline,
    createComputePipeline,
    createBindGroupLayout,
    createTexture,
    createCommandEncoder,
    beginRenderPass,
  }
}

async function createInitializedPipeline() {
  const gpu = installFakeGpu()
  const Pipeline = EffectsPipeline as unknown as new (device: GPUDevice) => EffectsPipeline
  const pipeline = new Pipeline(gpu.device)
  await (
    pipeline as unknown as {
      createPipelines(): Promise<void>
    }
  ).createPipelines()
  return { ...gpu, pipeline }
}

type InitializedPipeline = Awaited<ReturnType<typeof createInitializedPipeline>>
type FakeRenderPass = InitializedPipeline['beginRenderPass']['mock']['results'][number]['value']

/** A caller-owned texture at the chain's boundary, with a stable view to identify it by. */
function boundaryTexture(format: GPUTextureFormat) {
  const view = { format }
  const texture = {
    width: 8,
    height: 8,
    format,
    createView: () => view,
  } as unknown as GPUTexture
  return { texture, view }
}

function brightnessEffect(): GpuEffectInstance {
  return {
    id: 'brightness',
    type: 'gpu-brightness',
    name: 'Brightness',
    enabled: true,
    params: { amount: 0.1 },
  }
}

function convertPipelineLabel(format: GPUTextureFormat): string {
  return `effect-texture-convert-${format}`
}

function renderPasses(beginRenderPass: InitializedPipeline['beginRenderPass']): FakeRenderPass[] {
  return beginRenderPass.mock.results.map((result) => result.value)
}

function colorTarget(pass: FakeRenderPass): unknown {
  const attachments = pass.descriptor.colorAttachments as (GPURenderPassColorAttachment | null)[]
  return attachments[0]!.view
}

describe('EffectsPipeline float chain', () => {
  it('compiles every effect pass for both chain formats, the float from the contract', async () => {
    // Pinned: the precise chain takes its format from the contract, and the byte
    // chain is the format of a caller still on today's path.
    expect(PRECISE_RENDER_FORMAT).toBe('rgba16float')
    expect(EFFECT_TEXTURE_FORMAT).toBe(PRECISE_RENDER_FORMAT)
    expect(EFFECT_BYTE_TEXTURE_FORMAT).toBe('rgba8unorm')
    const {
      createRenderPipeline,
      createComputePipeline,
      createBindGroupLayout,
      createShaderModule,
    } = await createInitializedPipeline()

    const descriptors = createRenderPipeline.mock.calls.map(([descriptor]) => descriptor)
    const blit = descriptors.find((descriptor) => descriptor.label === 'blit-pipeline')
    expect(blit?.fragment?.targets).toEqual([{ format: 'bgra8unorm' }])

    const computeEffectCount = [...GPU_EFFECT_REGISTRY.values()].filter(
      (effect) => effect.compute,
    ).length
    for (const format of [EFFECT_TEXTURE_FORMAT, EFFECT_BYTE_TEXTURE_FORMAT]) {
      const chainPipelines = descriptors.filter(
        (descriptor) =>
          descriptor.label !== 'blit-pipeline' &&
          (descriptor.label?.endsWith(`-${format}-pipeline`) ?? false),
      )
      // import-external + inline colour batch + one pass per fragment effect
      expect(chainPipelines).toHaveLength(GPU_EFFECT_REGISTRY.size - computeEffectCount + 2)
      for (const descriptor of chainPipelines) {
        expect(descriptor.fragment?.targets).toEqual([{ format }])
      }
    }
    expect(createComputePipeline).toHaveBeenCalledTimes(computeEffectCount * 2)

    const computeLayouts = createBindGroupLayout.mock.calls
      .map(([descriptor]) => descriptor)
      .filter((descriptor) => descriptor.label?.endsWith('-compute-layout'))
    expect(computeLayouts).toHaveLength(computeEffectCount * 2)
    expect(
      computeLayouts.map(
        (descriptor) =>
          descriptor.entries.find((entry) => entry.binding === 1)?.storageTexture?.format,
      ),
    ).toEqual(expect.arrayContaining([EFFECT_TEXTURE_FORMAT, EFFECT_BYTE_TEXTURE_FORMAT]))

    // The one compute effect declares the storage format as a token, and each
    // compiled module carries the chain format it was built for.
    const computeShaders = createShaderModule.mock.calls
      .map(([descriptor]) => descriptor)
      .filter((descriptor) => descriptor.label?.endsWith('-compute'))
    for (const effect of GPU_EFFECT_REGISTRY.values()) {
      if (effect.compute) expect(effect.shader).toContain(EFFECT_CHAIN_STORAGE_FORMAT)
    }
    for (const format of [EFFECT_TEXTURE_FORMAT, EFFECT_BYTE_TEXTURE_FORMAT]) {
      expect(
        computeShaders.some((descriptor) =>
          descriptor.code.includes(`texture_storage_2d<${format}, write>`),
        ),
      ).toBe(true)
    }
  })

  it('batches colour operations in float, without the 8-bit quantisation', async () => {
    const { createShaderModule } = await createInitializedPipeline()

    const colorBatch = createShaderModule.mock.calls
      .map(([descriptor]) => descriptor)
      .find((descriptor) => descriptor.label === 'effect-inline-color-batch')
    expect(colorBatch).toBeDefined()
    // The batched shader used to round every operation to 8 bits so it matched
    // separate passes. The float chain must not put that rounding back.
    expect(colorBatch!.code).not.toMatch(/\bround\s*\(/)
    expect(colorBatch!.code).not.toContain('/ 255.0')
  })

  it('creates its ping/pong textures in the requested format', async () => {
    const { pipeline, createTexture } = await createInitializedPipeline()
    const ensure = (
      pipeline as unknown as {
        ensurePingPong(w: number, h: number, format: GPUTextureFormat): void
      }
    ).ensurePingPong.bind(pipeline)

    ensure(8, 8, EFFECT_TEXTURE_FORMAT)
    expect(createTexture).toHaveBeenCalledTimes(2)
    const descriptor = createTexture.mock.calls[0]![0]
    expect(descriptor.format).toBe('rgba16float')
    expect(descriptor.usage & GPUTextureUsage.STORAGE_BINDING).toBeTruthy()
    expect(descriptor.usage & GPUTextureUsage.RENDER_ATTACHMENT).toBeTruthy()

    ensure(8, 8, EFFECT_TEXTURE_FORMAT)
    expect(createTexture).toHaveBeenCalledTimes(2)

    // The format is part of the cache key: a different one is a different pair.
    ensure(8, 8, 'rgba8unorm')
    expect(createTexture).toHaveBeenCalledTimes(4)
    expect(createTexture.mock.calls[2]![0].format).toBe('rgba8unorm')
  })

  it('only chains GPU textures at its boundary formats', async () => {
    const { pipeline, createCommandEncoder } = await createInitializedPipeline()
    const bad = boundaryTexture('rgba32float')
    const floatTexture = boundaryTexture(EFFECT_TEXTURE_FORMAT)
    const byteTexture = boundaryTexture('rgba8unorm')

    expect(pipeline.applyTextureEffectsToTexture(bad.texture, [], floatTexture.texture, 8, 8)).toBe(
      false,
    )
    expect(pipeline.applyTextureEffectsToTexture(floatTexture.texture, [], bad.texture, 8, 8)).toBe(
      false,
    )
    expect(createCommandEncoder).not.toHaveBeenCalled()

    // A frame with no effects still crosses formats, through one exact copy.
    expect(
      pipeline.applyTextureEffectsToTexture(floatTexture.texture, [], byteTexture.texture, 8, 8),
    ).toBe(true)
    expect(createCommandEncoder).toHaveBeenCalledTimes(1)
  })

  it('runs the chain in the output texture format and keeps the boundary copy exact', async () => {
    const { pipeline, beginRenderPass, createTexture } = await createInitializedPipeline()
    const effect = brightnessEffect()

    for (const format of [EFFECT_TEXTURE_FORMAT, EFFECT_BYTE_TEXTURE_FORMAT] as const) {
      const source = boundaryTexture(format)
      const output = boundaryTexture(format)
      beginRenderPass.mockClear()
      createTexture.mockClear()

      expect(
        pipeline.applyTextureEffectsToTexture(source.texture, [effect], output.texture, 8, 8),
      ).toBe(true)

      // read into the ping, one effect pass, write into the caller's texture
      expect(beginRenderPass).toHaveBeenCalledTimes(3)
      const passes = renderPasses(beginRenderPass)
      expect(passes[0]!.setPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ label: convertPipelineLabel(format) }),
      )
      expect(passes[1]!.setPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ label: `effect-gpu-brightness-${format}-pipeline` }),
      )
      expect(passes[2]!.setPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ label: convertPipelineLabel(format) }),
      )
      expect(colorTarget(passes[2]!)).toBe(output.view)
      // The chain's own pair is the caller's format: an 8-bit caller never
      // touches a float texture, so its pixels stay exactly as today.
      expect(createTexture.mock.calls[0]![0].format).toBe(format)
      expect(createTexture.mock.calls[1]![0].format).toBe(format)
    }
  })

  it('keeps the 8-bit chain for an 8-bit canvas effect output', async () => {
    const { pipeline, beginRenderPass, createTexture } = await createInitializedPipeline()
    const source = { width: 8, height: 8 } as unknown as OffscreenCanvas
    const effect = brightnessEffect()

    for (const format of [EFFECT_TEXTURE_FORMAT, EFFECT_BYTE_TEXTURE_FORMAT] as const) {
      const output = boundaryTexture(format)
      beginRenderPass.mockClear()
      createTexture.mockClear()

      expect(pipeline.applyEffectsToTexture(source, [effect], output.texture)).toBe(true)

      // the effect pass, then the conversion into the caller's texture
      expect(beginRenderPass).toHaveBeenCalledTimes(2)
      const passes = renderPasses(beginRenderPass)
      expect(passes[0]!.setPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ label: `effect-gpu-brightness-${format}-pipeline` }),
      )
      expect(passes[1]!.setPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ label: convertPipelineLabel(format) }),
      )
      expect(colorTarget(passes[1]!)).toBe(output.view)
      expect(createTexture.mock.calls[0]![0].format).toBe(format)
    }
  })

  it('runs video effects in the output texture format', async () => {
    const { pipeline, beginRenderPass, createTexture } = await createInitializedPipeline()
    const video = { readyState: 2, videoWidth: 8, videoHeight: 8 } as unknown as HTMLVideoElement
    const effect = brightnessEffect()

    for (const format of [EFFECT_TEXTURE_FORMAT, EFFECT_BYTE_TEXTURE_FORMAT] as const) {
      const output = boundaryTexture(format)
      beginRenderPass.mockClear()
      createTexture.mockClear()

      expect(
        pipeline.applyEffectsToVideoTexture(
          video,
          [effect],
          { x: 0, y: 0, width: 8, height: 8 },
          8,
          8,
          output.texture,
        ),
      ).toBe(true)

      // the zero-copy import, the effect pass, the conversion into the output
      expect(beginRenderPass).toHaveBeenCalledTimes(3)
      const passes = renderPasses(beginRenderPass)
      expect(passes[0]!.setPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ label: `import-external-${format}-pipeline` }),
      )
      expect(passes[1]!.setPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ label: `effect-gpu-brightness-${format}-pipeline` }),
      )
      expect(passes[2]!.setPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ label: convertPipelineLabel(format) }),
      )
      expect(colorTarget(passes[2]!)).toBe(output.view)
      expect(createTexture.mock.calls[0]![0].format).toBe(format)
    }
  })

  it('rejects a video output texture of another format', async () => {
    const { pipeline } = await createInitializedPipeline()
    const video = { readyState: 2, videoWidth: 8, videoHeight: 8 } as unknown as HTMLVideoElement
    const bad = boundaryTexture('rgba32float')

    expect(
      pipeline.applyEffectsToVideoTexture(
        video,
        [],
        { x: 0, y: 0, width: 8, height: 8 },
        8,
        8,
        bad.texture,
      ),
    ).toBe(false)
  })
})

describe('EffectsPipeline data tables are float (design 3.6 section 2.18 c)', () => {
  it('stores a table as rgba16float and writes half-float words, 8 bytes a texel', () => {
    Object.assign(globalThis, { GPUTextureUsage: { TEXTURE_BINDING: 4, COPY_DST: 8 } })
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { getPreferredCanvasFormat: () => 'rgba8unorm' },
    })
    const created: GPUTextureDescriptor[] = []
    const writes: Array<{ data: Uint16Array; layout: GPUTexelCopyBufferLayout }> = []
    const device = {
      queue: {
        writeTexture: (_dest: unknown, data: Uint16Array, layout: GPUTexelCopyBufferLayout) =>
          writes.push({ data, layout }),
      },
      createSampler: vi.fn(() => ({})),
      createTexture: (descriptor: GPUTextureDescriptor) => {
        created.push(descriptor)
        return { destroy: vi.fn(), createView: vi.fn(() => ({})) }
      },
    } as unknown as GPUDevice
    const Pipeline = EffectsPipeline as unknown as new (device: GPUDevice) => EffectsPipeline
    const pipeline = new Pipeline(device)
    const curves = GPU_EFFECT_REGISTRY.get('gpu-curves')!
    const instance = { type: 'gpu-curves', params: { masterShadowX: 0.25, masterShadowY: 0.32 } }
    const view = (
      pipeline as unknown as {
        getOrUpdateDataTexture(i: number, e: unknown, d: unknown): GPUTextureView | null
      }
    ).getOrUpdateDataTexture(0, instance, curves)

    expect(view).not.toBeNull()
    expect(created[0]?.format).toBe('rgba16float')
    expect(writes[0]?.data).toBeInstanceOf(Uint16Array)
    expect(writes[0]?.layout.bytesPerRow).toBe(256 * 8)
    // The master curve's values are not all multiples of 1/255: the table keeps what the curve says
    const values = Array.from(writes[0]!.data.filter((_, i) => i % 4 === 0))
    expect(new Set(values).size).toBeGreaterThan(200)
  })
})

// DroneClean: the export worker has no DOM element classes. An unguarded `instanceof HTMLVideoElement` threw there
// for a clip with a GPU effect, the worker export failed, and the main-thread fallback took the page down
// (19 Nov 2026, the MCP tour).
describe('EffectsPipeline in an export worker', () => {
  it('sizes a canvas source without HTMLVideoElement or HTMLImageElement', async () => {
    const { pipeline } = await createInitializedPipeline()
    vi.stubGlobal('HTMLVideoElement', undefined)
    vi.stubGlobal('HTMLImageElement', undefined)
    try {
      const output = boundaryTexture(EFFECT_BYTE_TEXTURE_FORMAT)
      const source = { width: 8, height: 8 } as unknown as OffscreenCanvas
      expect(pipeline.applyEffectsToTexture(source, [brightnessEffect()], output.texture)).toBe(true)
      // A canvas too small to filter is skipped after it is sized, not thrown on.
      const tiny = { width: 1, height: 1 } as unknown as OffscreenCanvas
      expect(pipeline.applyEffectsToCanvas(tiny, [brightnessEffect()])).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
