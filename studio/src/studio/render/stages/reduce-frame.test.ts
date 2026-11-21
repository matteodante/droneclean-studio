// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { createFrameReducer, reductionTaps } from './reduce-frame'

describe('reductionTaps', () => {
  it('covers each source pixel of the block with bilinear taps on pixel corners, two pixels a tap', () => {
    expect([1, 1.5, 2, 3, 4, 6, 8].map(reductionTaps)).toEqual([1, 1, 1, 2, 2, 3, 4])
    expect(reductionTaps(4.27)).toBe(3)
  })
})

/** A device that records the textures, uniforms and passes the reducer makes */
function fakeDevice() {
  const textures: Array<{ width: number; height: number; destroyed: boolean }> = []
  const uniforms: ArrayBuffer[] = []
  const passes: number[] = []
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createSampler: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const size = descriptor.size as { width: number; height: number }
      const texture = {
        ...size,
        format: descriptor.format,
        destroyed: false,
        createView: () => ({}),
        destroy() {
          this.destroyed = true
        },
      }
      textures.push(texture)
      return texture
    }),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw: (count: number) => passes.push(count), end() {} }),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: (_buffer: unknown, _offset: number, data: ArrayBuffer) => uniforms.push(data),
      submit: vi.fn(),
    },
  }
  return { device: device as unknown as GPUDevice, raw: device, textures, uniforms, passes }
}

const source = { width: 3840, height: 2880, createView: () => ({}) } as unknown as GPUTexture

describe('createFrameReducer', () => {
  it('builds nothing until a frame is reduced, then one pass a frame, submitted on its own', () => {
    const { device, raw, passes } = fakeDevice()
    const reducer = createFrameReducer(device)
    expect(raw.createRenderPipeline).not.toHaveBeenCalled()

    const reduced = reducer.reduce(source, { width: 960, height: 720 })

    expect(reduced).toMatchObject({ width: 960, height: 720, format: 'rgba16float' })
    expect(passes).toEqual([3])
    expect(raw.queue.submit).toHaveBeenCalledTimes(1)
  })

  it('tells the pass each axis’s scale and taps, once per pair of sizes', () => {
    const { device, uniforms } = fakeDevice()
    const reducer = createFrameReducer(device)
    reducer.release(reducer.reduce(source, { width: 960, height: 720 }))
    reducer.reduce(source, { width: 960, height: 720 })
    reducer.reduce(source, { width: 900, height: 720 })

    expect(uniforms).toHaveLength(2)
    expect([...new Float32Array(uniforms[0]!, 0, 2)]).toEqual([4, 4])
    expect([...new Uint32Array(uniforms[0]!, 8, 2)]).toEqual([2, 2])
    expect(new Float32Array(uniforms[1]!, 0, 1)[0]).toBeCloseTo(3840 / 900, 5)
    expect([...new Uint32Array(uniforms[1]!, 8, 2)]).toEqual([3, 2])
  })

  it('reuses a texture given back for the next frame of its size, and destroys every texture it made', () => {
    const { device, textures } = fakeDevice()
    const reducer = createFrameReducer(device)
    const first = reducer.reduce(source, { width: 960, height: 720 })
    const second = reducer.reduce(source, { width: 960, height: 720 })
    expect(second).not.toBe(first)
    reducer.release(first)
    expect(reducer.reduce(source, { width: 960, height: 720 })).toBe(first)
    reducer.release(source)

    reducer.destroy()

    expect(textures).toHaveLength(2)
    expect(textures.every((texture) => texture.destroyed)).toBe(true)
    expect((source as unknown as { destroyed?: boolean }).destroyed).toBeUndefined()
  })
})
