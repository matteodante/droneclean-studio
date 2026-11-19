// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { toRate } from '@/studio/time'
import type { VideoItem } from '@/types/timeline'
import { needsSourceStages } from '../../stages/predicates'
import type { FrameFile } from '../types'

const mocks = vi.hoisted(() => ({
  uploads: [] as Array<{ data: Uint8Array; index: number }>,
  blits: [] as Array<{ from: unknown; to: unknown }>,
}))
vi.mock('@/studio/render/precise/source-pass', () => ({
  createSourcePass: () => ({
    uploadFrame: (data: Uint8Array, frame: { index: number }) => {
      mocks.uploads.push({ data, index: frame.index })
      return { texture: { pass: true } }
    },
    destroy() {},
  }),
}))
vi.mock('@/studio/render/frames/blit', () => ({
  blitToSourceFrame: (_device: unknown, from: unknown, to: unknown) => mocks.blits.push({ from, to }),
  sourceFrameTextureDescriptor: (width: number, height: number) => ({ width, height }),
}))

import {
  createRawTestBackend,
  rawTestBackendFor,
  rawTestKitActive,
  setRawTestKit,
} from './raw-test'

const FILE: FrameFile = { key: 'source:a', src: 'http://x/media/a', path: 'a', rate: toRate(24) }
const device = { createTexture: (descriptor: object) => ({ descriptor }) } as unknown as GPUDevice

/** 2x1 frames: 3 planes of 2 samples, 12 bytes; frame n is filled with n + 1 */
const frameBytes = 12
const file = new Uint8Array(frameBytes * 3).map((_, i) => Math.floor(i / frameBytes) + 1)

afterEach(() => {
  setRawTestKit(null)
  mocks.uploads.length = 0
  mocks.blits.length = 0
})

describe('the raw 10-bit test backend', () => {
  it('reads frame n from byte n * frame size, through the source pass, into a texture of its own', async () => {
    const urls: string[] = []
    const backend = createRawTestBackend(device, {
      width: 2,
      height: 1,
      rawUrl: (src) => `${src}-raw`,
      readFile: async (url) => {
        urls.push(url)
        return file
      },
    })

    const frame = await backend.decode(FILE, 1)
    await backend.decode(FILE, 2)

    expect(backend.origin).toBe('raw-test')
    expect(frame).toMatchObject({ index: 1, width: 2, height: 1 })
    expect(urls).toEqual(['http://x/media/a-raw']) // the file is read once
    expect(mocks.uploads.map((upload) => [...new Set(upload.data)])).toEqual([[2], [3]])
    expect(mocks.uploads.map((upload) => upload.index)).toEqual([1, 2])
    expect(mocks.blits[0]!.from).toEqual({ pass: true })
    expect(mocks.blits[0]!.to).toBe(frame.texture)
  })

  it('says how many frames the file has when the index is past the end', async () => {
    const backend = createRawTestBackend(device, { width: 2, height: 1, readFile: async () => file })
    await expect(backend.decode(FILE, 3)).rejects.toThrow(/has 3 frames, none is 3/)
    await expect(backend.decode(FILE, -1)).rejects.toThrow(/none is -1/)
  })
})

describe('the kit switch', () => {
  const clip = { id: 'c', type: 'video', mediaId: 'm', src: 'blob:c' } as unknown as VideoItem

  it('is off by default: no backend, and a plain clip needs no stage', () => {
    expect(rawTestKitActive()).toBe(false)
    expect(rawTestBackendFor(device)).toBeNull()
    expect(needsSourceStages(clip)).toBe(false)
  })

  it('makes every video clip staged, and nothing else, while it is on', () => {
    setRawTestKit({ width: 2, height: 1, readFile: async () => file })
    expect(rawTestKitActive()).toBe(true)
    expect(rawTestBackendFor(device)?.origin).toBe('raw-test')
    expect(needsSourceStages(clip)).toBe(true)
    expect(needsSourceStages({ ...clip, type: 'image' } as never)).toBe(false)
    setRawTestKit(null)
    expect(needsSourceStages(clip)).toBe(false)
  })
})
