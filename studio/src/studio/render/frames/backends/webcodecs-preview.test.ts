// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toRate } from '@/studio/time'
import type { FrameFile } from '../types'
import type { UploadProbe } from '../blit'
import { createWebCodecsBackend, type WebCodecsSample } from './webcodecs'

const RATE = toRate(60000 / 1001)
const FILE: FrameFile = { key: 'source:a', src: 'blob:a', path: '/media/a.mp4', rate: RATE }

const state = vi.hoisted(() => ({
  external: [] as Array<{ frame: unknown; conversion: string }>,
  reduced: [] as Array<{ natural: unknown; size: string; conversion: string }>,
  canvasBlits: 0,
  probes: 0,
  probe: null as unknown,
}))

vi.mock('../blit', async (importActual) => ({
  ...(await importActual<typeof import('../blit')>()),
  blitExternalToSourceFrame: (_d: unknown, frame: unknown, _t: unknown, conversion: string) => {
    state.external.push({ frame, conversion })
  },
  blitExternalReducedToSourceFrame: (
    _d: unknown,
    _frame: unknown,
    natural: unknown,
    target: { width: number; height: number },
    conversion: string,
  ) => {
    state.reduced.push({ natural, size: `${target.width}x${target.height}`, conversion })
  },
  blitToSourceFrame: () => {
    state.canvasBlits++
  },
  probeUploads: async () => {
    state.probes++
    return state.probe
  },
}))

const grey = (n: number) => Float32Array.from([n, n, n])
const probeOf = (canvas: number, plain: number, corrected: number): UploadProbe => ({
  canvas: grey(canvas),
  plain: grey(plain),
  corrected: grey(corrected),
})

function fakeDevice() {
  const textures: Array<{ format: string; destroyed: boolean; destroy(): void }> = []
  const copies: unknown[] = []
  const device = {
    lost: new Promise<never>(() => {}),
    createTexture(d: { format: string; size: { width: number; height: number } }) {
      const texture = {
        format: d.format,
        width: d.size.width,
        height: d.size.height,
        destroyed: false,
        destroy() {
          texture.destroyed = true
        },
      }
      textures.push(texture)
      return texture
    },
    queue: {
      copyExternalImageToTexture(source: { source: unknown }) {
        copies.push(source.source)
      },
    },
  }
  return { device: device as unknown as GPUDevice, textures, copies }
}

function sampleOf(frame: number, withVideoFrame = true) {
  const frames: Array<{ closed: boolean; close(): void }> = []
  const sample: WebCodecsSample = {
    timestamp: (frame * RATE.den) / RATE.num,
    width: 3840,
    height: 2880,
    image: { canvas: frame } as unknown as GPUCopyExternalImageSource,
    close() {},
    ...(withVideoFrame
      ? {
          videoFrame() {
            const made = {
              closed: false,
              close() {
                made.closed = true
              },
            }
            frames.push(made)
            return made as unknown as VideoFrame
          },
        }
      : {}),
  }
  return { sample, frames }
}

beforeEach(() => {
  state.external = []
  state.reduced = []
  state.canvasBlits = 0
  state.probes = 0
  state.probe = probeOf(100, 100, 111)
})

describe('the WebCodecs backend in a preview', () => {
  it('uploads the decoder frame as an external texture and probes the first frame of a file once', async () => {
    const { device, textures, copies } = fakeDevice()
    const made = [sampleOf(10), sampleOf(11), sampleOf(12)]
    let next = 0
    const backend = createWebCodecsBackend(device, {
      sampleAt: async () => made[next++]!.sample,
      destroy() {},
    })
    for (const index of [10, 11, 12]) await backend.decode(FILE, index, { preview: true })

    expect(state.probes).toBe(1)
    expect(state.external.map((e) => e.conversion)).toEqual(['plain', 'plain', 'plain'])
    expect(state.canvasBlits).toBe(0)
    // one staging copy, for the probe, none after it; the floats are three textures, the staging one
    expect(copies).toHaveLength(1)
    expect(textures.filter((t) => t.format === 'rgba16float')).toHaveLength(3)
    // every frame made for the upload is closed
    expect(made.flatMap((m) => m.frames).every((f) => f.closed)).toBe(true)
  })

  it('redraws a file with the corrected conversion when its first frame was converted by the browser', async () => {
    state.probe = probeOf(100, 111, 100.3)
    const { device, textures } = fakeDevice()
    const samples = [sampleOf(1), sampleOf(2)]
    let next = 0
    const backend = createWebCodecsBackend(device, {
      sampleAt: async () => samples[next++]!.sample,
      destroy() {},
    })
    await backend.decode(FILE, 1, { preview: true })
    await backend.decode(FILE, 2, { preview: true })

    expect(state.external.map((e) => e.conversion)).toEqual(['plain', 'corrected', 'corrected'])
    // the first, uncorrected texture is destroyed, not handed out
    expect(textures.filter((t) => t.format === 'rgba16float').map((t) => t.destroyed)).toEqual([true, false, false])
  })

  it('goes through the canvas for a file whose upload matches neither reading', async () => {
    state.probe = probeOf(100, 140, 150)
    const { device } = fakeDevice()
    const backend = createWebCodecsBackend(device, {
      sampleAt: async () => sampleOf(3).sample,
      destroy() {},
    })
    await backend.decode(FILE, 3, { preview: true })
    await backend.decode(FILE, 3, { preview: true })
    expect(state.probes).toBe(1)
    expect(state.canvasBlits).toBe(2)
    expect(state.external.map((e) => e.conversion)).toEqual(['plain'])
  })

  it('keeps the exports on the canvas, with no probe and no external texture', async () => {
    const { device, copies } = fakeDevice()
    const { sample } = sampleOf(4)
    const backend = createWebCodecsBackend(device, { sampleAt: async () => sample, destroy() {} })
    await backend.decode(FILE, 4)
    await backend.decode(FILE, 4, { preview: false })
    expect(state.external).toEqual([])
    expect(state.probes).toBe(0)
    expect(state.canvasBlits).toBe(2)
    expect(copies).toEqual([sample.image, sample.image])
  })

  it('uses the canvas when the reader has no video frame', async () => {
    const { device } = fakeDevice()
    const { sample } = sampleOf(5, false)
    const backend = createWebCodecsBackend(device, { sampleAt: async () => sample, destroy() {} })
    await backend.decode(FILE, 5, { preview: true })
    expect(state.external).toEqual([])
    expect(state.canvasBlits).toBe(1)
  })

  it('uploads straight to a preview’s reduced size once the file’s reading is known (design 8.10)', async () => {
    state.probe = probeOf(100, 111, 100.3)
    const { device } = fakeDevice()
    const made = [sampleOf(1), sampleOf(2), sampleOf(3)]
    let next = 0
    const backend = createWebCodecsBackend(device, { sampleAt: async () => made[next++]!.sample, destroy() {} })
    const size = { width: 960, height: 720 }

    // The first frame of the file is probed at its own size, whatever size is asked
    const first = await backend.decode(FILE, 1, { preview: true, size })
    const second = await backend.decode(FILE, 2, { preview: true, size })
    const third = await backend.decode(FILE, 3, { preview: true })

    expect(first).toMatchObject({ width: 3840, height: 2880 })
    expect(first.natural).toBeUndefined()
    expect(second).toMatchObject({ width: 960, height: 720, natural: { width: 3840, height: 2880 } })
    expect(state.reduced).toEqual([{ natural: { width: 3840, height: 2880 }, size: '960x720', conversion: 'corrected' }])
    // No size asked: the frame's own size, as before
    expect(third).toMatchObject({ width: 3840, height: 2880 })
    expect(state.external.map((e) => e.conversion)).toEqual(['plain', 'corrected', 'corrected'])
    expect(made.flatMap((m) => m.frames).every((f) => f.closed)).toBe(true)
  })

  it('gives a file read through the canvas at its own size, which the pipeline then reduces', async () => {
    state.probe = probeOf(100, 140, 150)
    const { device } = fakeDevice()
    const backend = createWebCodecsBackend(device, { sampleAt: async () => sampleOf(3).sample, destroy() {} })
    await backend.decode(FILE, 3, { preview: true })
    const frame = await backend.decode(FILE, 4, { preview: true, size: { width: 960, height: 720 } })

    expect(frame).toMatchObject({ width: 3840, height: 2880 })
    expect(frame.natural).toBeUndefined()
    expect(state.reduced).toEqual([])
  })

  it('asks the next frame when the first cannot tell the readings apart, and settles on the canvas after 30', async () => {
    state.probe = probeOf(0, 0, 0)
    const { device } = fakeDevice()
    const backend = createWebCodecsBackend(device, { sampleAt: async () => sampleOf(1).sample, destroy() {} })
    await backend.decode(FILE, 1, { preview: true })
    await backend.decode(FILE, 2, { preview: true })
    expect(state.probes).toBe(2)
    state.probe = probeOf(100, 111, 100.3)
    await backend.decode(FILE, 3, { preview: true })
    await backend.decode(FILE, 4, { preview: true })
    // The third frame decided: corrected from then on, no more probes
    expect(state.probes).toBe(3)
    expect(state.external.at(-1)?.conversion).toBe('corrected')

    state.probe = probeOf(0, 0, 0)
    const other: FrameFile = { ...FILE, key: 'source:black' }
    for (let index = 0; index < 31; index++) await backend.decode(other, index, { preview: true })
    expect(state.probes).toBe(3 + 30)
    expect(state.canvasBlits).toBe(1)
  })

  it('decides per file', async () => {
    const { device } = fakeDevice()
    const other: FrameFile = { ...FILE, key: 'source:b' }
    const backend = createWebCodecsBackend(device, { sampleAt: async () => sampleOf(6).sample, destroy() {} })
    await backend.decode(FILE, 6, { preview: true })
    await backend.decode(other, 6, { preview: true })
    expect(state.probes).toBe(2)
  })
})
