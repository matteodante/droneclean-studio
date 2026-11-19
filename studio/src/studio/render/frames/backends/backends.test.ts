// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { toRate } from '@/studio/time'
import type { FrameFile } from '../types'
import { createWebCodecsBackend, type WebCodecsSample } from './webcodecs'

const RATE = toRate(60000 / 1001)
const FILE: FrameFile = { key: 'source:a', src: 'blob:a', path: '/media/a.mp4', rate: RATE }

interface FakeTexture {
  readonly format: string
  readonly size: { width: number; height: number }
  destroyed: boolean
  createView(): { of: FakeTexture }
  destroy(): void
}

/** A device that records textures, external-image copies and draws; the shader is not run here. */
function fakeDevice() {
  const textures: FakeTexture[] = []
  const copies: Array<{ source: unknown; width: number; height: number }> = []
  const draws: Array<{ from: FakeTexture; to: FakeTexture }> = []
  const pipelines: unknown[] = []
  const device = {
    lost: new Promise<never>(() => {}),
    createTexture(descriptor: { format: string; size: { width: number; height: number } }) {
      const texture: FakeTexture = {
        format: descriptor.format,
        size: descriptor.size,
        destroyed: false,
        createView: () => ({ of: texture }),
        destroy() {
          texture.destroyed = true
        },
      }
      textures.push(texture)
      return texture
    },
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline() {
      const pipeline = {}
      pipelines.push(pipeline)
      return pipeline
    },
    createBindGroup: (descriptor: { entries: Array<{ resource: { of: FakeTexture } }> }) => ({
      from: descriptor.entries[0]!.resource.of,
    }),
    createCommandEncoder: () => {
      let target: FakeTexture | undefined
      let from: FakeTexture | undefined
      return {
        beginRenderPass: (descriptor: {
          colorAttachments: Array<{ view: { of: FakeTexture } }>
        }) => {
          target = descriptor.colorAttachments[0]!.view.of
          return {
            setPipeline() {},
            setBindGroup(_i: number, group: { from: FakeTexture }) {
              from = group.from
            },
            draw() {},
            end() {},
          }
        },
        finish: () => ({ target, from }),
      }
    },
    queue: {
      copyExternalImageToTexture(
        source: { source: unknown },
        _destination: unknown,
        size: { width: number; height: number },
      ) {
        copies.push({ source: source.source, ...size })
      },
      submit(buffers: Array<{ target: FakeTexture; from: FakeTexture }>) {
        for (const buffer of buffers) draws.push({ from: buffer.from, to: buffer.target })
      },
    },
  }
  return { device: device as unknown as GPUDevice, textures, copies, draws, pipelines }
}

describe('the WebCodecs backend', () => {
  function sampleOf(frame: number, size = { width: 1280, height: 720 }) {
    const closed = { value: false }
    const sample: WebCodecsSample = {
      timestamp: (frame * RATE.den) / RATE.num,
      ...size,
      image: { frame } as unknown as GPUCopyExternalImageSource,
      close() {
        closed.value = true
      },
    }
    return { sample, closed }
  }

  it('asks for the middle of the frame, widens it into a float texture at the file size and reports the frame it got', async () => {
    const { device, textures, copies, draws } = fakeDevice()
    const asked: number[] = []
    const { sample, closed } = sampleOf(100)
    const backend = createWebCodecsBackend(device, {
      async sampleAt(_file, seconds) {
        asked.push(seconds)
        return sample
      },
      destroy() {},
    })

    const frame = await backend.decode(FILE, 100)

    expect(asked).toEqual([(100.5 * RATE.den) / RATE.num])
    expect(frame).toMatchObject({ index: 100, width: 1280, height: 720 })
    expect(textures.map((t) => t.format)).toEqual(['rgba8unorm', 'rgba16float'])
    expect(copies).toEqual([{ source: sample.image, width: 1280, height: 720 }])
    expect(draws).toHaveLength(1)
    expect(draws[0]!.from).toBe(textures[0])
    expect(draws[0]!.to).toBe(frame.texture)
    expect(closed.value).toBe(true)
  })

  it('reports the frame the decoder returned, not the one asked for', async () => {
    const { device } = fakeDevice()
    const backend = createWebCodecsBackend(device, {
      sampleAt: async () => sampleOf(41).sample,
      destroy() {},
    })
    // The provider turns the difference into a SourceFrameMismatch.
    expect((await backend.decode(FILE, 42)).index).toBe(41)
  })

  it('reuses its staging texture and pipeline across frames of one size', async () => {
    const { device, textures, pipelines } = fakeDevice()
    const backend = createWebCodecsBackend(device, {
      sampleAt: async (_file, seconds) => sampleOf(Math.floor((seconds * RATE.num) / RATE.den)).sample,
      destroy() {},
    })
    await backend.decode(FILE, 1)
    await backend.decode(FILE, 2)
    await backend.decode(FILE, 3)
    expect(textures.filter((t) => t.format === 'rgba8unorm')).toHaveLength(1)
    expect(textures.filter((t) => t.format === 'rgba16float')).toHaveLength(3)
    expect(pipelines).toHaveLength(1)
  })

  it('closes the sample when the upload fails, and says so when there is no frame', async () => {
    const { device } = fakeDevice()
    const { sample, closed } = sampleOf(5)
    const failing = createWebCodecsBackend(
      {
        ...(device as object),
        queue: {
          copyExternalImageToTexture() {
            throw new Error('lost')
          },
        },
      } as unknown as GPUDevice,
      { sampleAt: async () => sample, destroy() {} },
    )
    await expect(failing.decode(FILE, 5)).rejects.toThrow('lost')
    expect(closed.value).toBe(true)

    const empty = createWebCodecsBackend(device, { sampleAt: async () => null, destroy() {} })
    await expect(empty.decode(FILE, 5)).rejects.toThrow(/has no frame 5/)
  })

  it('destroys its reader', () => {
    const destroy = vi.fn()
    createWebCodecsBackend(fakeDevice().device, { sampleAt: async () => null, destroy }).destroy()
    expect(destroy).toHaveBeenCalledOnce()
  })
})
