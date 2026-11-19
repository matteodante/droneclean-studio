import { describe, expect, it, vi } from 'vite-plus/test'
import { BLEND_MODE_INDEX, type BlendMode } from '@/types/blend-modes'
import {
  CompositorPipeline,
  DEFAULT_LAYER_PARAMS,
  type CompositeLayer,
} from './compositor-pipeline'

function createTexture(label: string, format: GPUTextureFormat = 'rgba8unorm') {
  return {
    createView: vi.fn(() => `${label}-view`),
    destroy: vi.fn(),
    format,
    height: 360,
    width: 640,
  } as unknown as GPUTexture
}

function createPipelineHarness() {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 })
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, UNIFORM: 64 })
  vi.stubGlobal('GPUTextureUsage', {
    COPY_DST: 8,
    COPY_SRC: 4,
    RENDER_ATTACHMENT: 16,
    TEXTURE_BINDING: 1,
  })
  vi.stubGlobal('navigator', {
    gpu: {
      getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
    },
  })

  const queue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
  }
  const pass = {
    draw: vi.fn(),
    end: vi.fn(),
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
  }
  const commandEncoder = {
    beginRenderPass: vi.fn(() => pass),
    finish: vi.fn(() => 'command-buffer'),
  }
  let textureIndex = 0
  let bufferIndex = 0
  const device = {
    createBindGroup: vi.fn((descriptor) => ({ descriptor })),
    createBindGroupLayout: vi.fn(() => 'bind-group-layout'),
    createCommandEncoder: vi.fn(() => commandEncoder),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => ({
      destroy: vi.fn(),
      id: `buffer-${bufferIndex++}`,
      label: descriptor.label,
      size: descriptor.size,
      usage: descriptor.usage,
    })),
    createPipelineLayout: vi.fn(() => 'pipeline-layout'),
    createRenderPipeline: vi.fn(() => 'render-pipeline'),
    createSampler: vi.fn(() => 'sampler'),
    createShaderModule: vi.fn(() => 'shader-module'),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) =>
      createTexture(`ping-pong-${textureIndex++}`, descriptor.format),
    ),
    queue,
  }
  const pipeline = new CompositorPipeline(device as unknown as GPUDevice)

  return { commandEncoder, device, pass, pipeline, queue }
}

function createCanvasOutput() {
  return {
    getCurrentTexture: vi.fn(() => createTexture('canvas')),
  } as unknown as GPUCanvasContext
}

function readHasMask(writeCall: unknown[]): number {
  const buffer = writeCall[2] as ArrayBuffer
  return new Uint32Array(buffer, 40, 1)[0] ?? 0
}

function readBlendMode(writeCall: unknown[]): number {
  const buffer = writeCall[2] as ArrayBuffer
  return new Uint32Array(buffer, 4, 1)[0] ?? 0
}

function oneLayer(): CompositeLayer[] {
  return [
    {
      params: { ...DEFAULT_LAYER_PARAMS, blendMode: 'normal' },
      textureView: 'layer-view' as unknown as GPUTextureView,
      maskView: 'fallback-mask-view' as unknown as GPUTextureView,
    },
  ]
}

describe('CompositorPipeline', () => {
  it('keeps mask coverage separate from dissolve opacity coverage in shader code', () => {
    const { device } = createPipelineHarness()

    const shaderSources = (
      device.createShaderModule.mock.calls as unknown as Array<[GPUShaderModuleDescriptor]>
    ).map(([descriptor]) => descriptor.code)
    expect(
      shaderSources.some(
        (code) =>
          code.includes('let postDissolveAlpha = maskValue * select') &&
          code.includes('sourceAlpha,\n    postDissolveAlpha') &&
          code.includes('input.uv * 8192.0,\n    u.opacity'),
      ),
    ).toBe(true)
  })

  it('binds independent uniforms for masked and unmasked layers encoded in one command buffer', () => {
    const { commandEncoder, device, pipeline, queue } = createPipelineHarness()
    const maskedLayerUniform = {
      ...DEFAULT_LAYER_PARAMS,
      blendMode: 'multiply' as const,
      hasMask: true,
    }
    const unmaskedLayerUniform = {
      ...DEFAULT_LAYER_PARAMS,
      blendMode: 'normal' as const,
      hasMask: false,
    }
    const layers: CompositeLayer[] = [
      {
        params: maskedLayerUniform,
        textureView: 'masked-layer-view' as unknown as GPUTextureView,
        maskView: 'heart-mask-view' as unknown as GPUTextureView,
      },
      {
        params: unmaskedLayerUniform,
        textureView: 'top-layer-view' as unknown as GPUTextureView,
        maskView: 'fallback-mask-view' as unknown as GPUTextureView,
      },
    ]

    const result = pipeline.compositeToTexture(
      layers,
      640,
      360,
      commandEncoder as unknown as GPUCommandEncoder,
    )

    expect(result).not.toBeNull()
    expect(queue.writeBuffer).toHaveBeenCalledTimes(2)
    expect(readHasMask(queue.writeBuffer.mock.calls[0]!)).toBe(1)
    expect(readHasMask(queue.writeBuffer.mock.calls[1]!)).toBe(0)

    const layerBindGroups = device.createBindGroup.mock.calls.slice(-2)
    const firstUniformResource = layerBindGroups[0]?.[0].entries.find(
      (entry: GPUBindGroupEntry) => entry.binding === 3,
    )?.resource
    const secondUniformResource = layerBindGroups[1]?.[0].entries.find(
      (entry: GPUBindGroupEntry) => entry.binding === 3,
    )?.resource
    expect(firstUniformResource).not.toBe(secondUniformResource)
  })

  it.each(['normal', 'multiply', 'darken', 'lighten', 'screen', 'dissolve'] satisfies BlendMode[])(
    'preserves mask state when a masked underlay is composited with %s mode',
    (blendMode) => {
      const { commandEncoder, pipeline, queue } = createPipelineHarness()
      const layers: CompositeLayer[] = [
        {
          params: {
            ...DEFAULT_LAYER_PARAMS,
            blendMode,
            hasMask: true,
          },
          textureView: 'video-layer-view' as unknown as GPUTextureView,
          maskView: 'heart-mask-view' as unknown as GPUTextureView,
        },
        {
          params: {
            ...DEFAULT_LAYER_PARAMS,
            blendMode: 'normal',
            hasMask: false,
          },
          textureView: 'shape-layer-view' as unknown as GPUTextureView,
          maskView: 'fallback-mask-view' as unknown as GPUTextureView,
        },
      ]

      const result = pipeline.compositeToTexture(
        layers,
        640,
        360,
        commandEncoder as unknown as GPUCommandEncoder,
      )

      expect(result).not.toBeNull()
      expect(queue.writeBuffer).toHaveBeenCalledTimes(2)
      expect(readBlendMode(queue.writeBuffer.mock.calls[0]!)).toBe(BLEND_MODE_INDEX[blendMode])
      expect(readHasMask(queue.writeBuffer.mock.calls[0]!)).toBe(1)
      expect(readBlendMode(queue.writeBuffer.mock.calls[1]!)).toBe(BLEND_MODE_INDEX.normal)
      expect(readHasMask(queue.writeBuffer.mock.calls[1]!)).toBe(0)
    },
  )

  it('keeps the 8-bit accumulator by default and builds an rgba16float one when asked', () => {
    const { commandEncoder, device, pipeline } = createPipelineHarness()

    pipeline.compositeToTexture(
      oneLayer(),
      640,
      360,
      commandEncoder as unknown as GPUCommandEncoder,
    )
    pipeline.compositeToTexture(
      oneLayer(),
      640,
      360,
      commandEncoder as unknown as GPUCommandEncoder,
      { pixelFormat: 'rgba16float' },
    )

    const formats = (
      device.createTexture.mock.calls as unknown as Array<[GPUTextureDescriptor]>
    ).map(([descriptor]) => descriptor.format)
    expect(formats).toContain('rgba8unorm')
    expect(formats).toContain('rgba16float')
    const pipelineFormats = (
      device.createRenderPipeline.mock.calls as unknown as Array<[GPURenderPipelineDescriptor]>
    )
      .map(([descriptor]) =>
        (descriptor.fragment?.targets as Array<{ format: GPUTextureFormat }>)[0]?.format,
      )
      .filter((format) => format !== undefined)
    expect(pipelineFormats).toContain('rgba16float')
  })

  it('composites an empty frame to a transparent accumulator only when asked', () => {
    const { commandEncoder, pipeline } = createPipelineHarness()

    const normal = pipeline.compositeToTexture(
      [],
      640,
      360,
      commandEncoder as unknown as GPUCommandEncoder,
    )
    const allowed = pipeline.compositeToTexture(
      [],
      640,
      360,
      commandEncoder as unknown as GPUCommandEncoder,
      { pixelFormat: 'rgba16float', allowEmpty: true },
    )

    expect(normal).toBeNull()
    expect(allowed).not.toBeNull()
  })

  it('returns the float frame over the project background for a precise export', () => {
    const { device, pipeline, queue } = createPipelineHarness()
    const outputCtx = createCanvasOutput()

    const frame = pipeline.compositeToCanvasAndTexture(
      oneLayer(),
      640,
      360,
      outputCtx,
      {
        pixelFormat: 'rgba16float',
        background: { r: 0.1, g: 0.2, b: 0.3 },
      },
    )

    expect(frame).not.toBeNull()
    expect(frame?.texture.format).toBe('rgba16float')
    // The canvas still receives the one 8-bit conversion, in the same submit as the frame.
    expect(outputCtx.getCurrentTexture).toHaveBeenCalledTimes(1)
    expect(queue.submit).toHaveBeenCalledTimes(1)
    const flattenShaders = (
      device.createShaderModule.mock.calls as unknown as Array<[GPUShaderModuleDescriptor]>
    )
      .map(([descriptor]) => descriptor.code)
      .filter((code) => code.includes('fn flattenFragment'))
    expect(flattenShaders).toHaveLength(1)
    expect(flattenShaders[0]).toContain('c.rgb * alpha + background.rgb * (1.0 - alpha)')
    const backgroundWrite = (
      queue.writeBuffer.mock.calls as unknown as Array<[GPUBuffer, number, ArrayBuffer]>
    ).find(([buffer]) => (buffer as unknown as { label: string }).label === 'compositor-flatten-background')
    expect(backgroundWrite).toBeDefined()
    const backgroundValues = Array.from(new Float32Array(backgroundWrite![2]))
    expect(backgroundValues).toHaveLength(4)
    expect(backgroundValues[0]).toBeCloseTo(0.1)
    expect(backgroundValues[1]).toBeCloseTo(0.2)
    expect(backgroundValues[2]).toBeCloseTo(0.3)
    expect(backgroundValues[3]).toBe(1)
  })

  it('refuses to flatten an 8-bit accumulator: that path has no background', () => {
    const { pipeline } = createPipelineHarness()

    const frame = pipeline.compositeToCanvasAndTexture(
      oneLayer(),
      640,
      360,
      createCanvasOutput(),
      {
        pixelFormat: 'rgba8unorm',
        background: { r: 0, g: 0, b: 0 },
      },
    )

    expect(frame).toBeNull()
  })

  it('delivers the project background as a frame when a precise page has no layers', () => {
    const { pipeline } = createPipelineHarness()

    const frame = pipeline.compositeToCanvasAndTexture(
      [],
      640,
      360,
      createCanvasOutput(),
      {
        pixelFormat: 'rgba16float',
        background: { r: 0, g: 0, b: 0 },
      },
    )

    expect(frame).not.toBeNull()
    expect(frame?.texture.format).toBe('rgba16float')
  })
})
