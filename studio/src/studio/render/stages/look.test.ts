import { describe, expect, it, vi } from 'vite-plus/test'
import type { ParsedCube } from '@/studio/color/cube'
import * as features from '@/studio/feature-switches'
import type { VideoItem } from '@/types/timeline'
import { createLookStage } from './look'
import { StageError, type StageEnv } from './types'

const { createPassMock } = vi.hoisted(() => ({ createPassMock: vi.fn() }))
vi.mock('@/studio/color/gpu/look-pass', () => ({ createLookPass: createPassMock }))
vi.mock('@/studio/feature-switches', () => ({ isFeatureShown: vi.fn(() => true) }))

const device = () => ({ lost: new Promise(() => {}) }) as unknown as GPUDevice
const item = (look?: { id: string; intensity: number }): VideoItem =>
  ({ id: 'c', type: 'video', label: 'Dusk', look }) as unknown as VideoItem
const tex = (width: number, height: number, format = 'rgba16float') =>
  ({ width, height, format, createView: () => ({ width }) }) as unknown as GPUTexture
const TABLE = { lut3d: {} } as unknown as ParsedCube

function pass() {
  return { setLook: vi.fn(), removeLook: vi.fn(), destroy: vi.fn(), encode: vi.fn() }
}

describe('the look stage', () => {
  it('is active while the looks switch is on and the intensity is above 0, keyed by the look id', () => {
    const stage = createLookStage({ lookTable: async () => TABLE })
    expect(stage.id).toBe('look')
    expect(stage.scope).toBe('output-frame')
    expect(stage.active(item({ id: 'warm', intensity: 0.5 }))).toBe(true)
    expect(stage.active(item({ id: 'warm', intensity: 0 }))).toBe(false)
    expect(stage.active(item())).toBe(false)
    vi.mocked(features.isFeatureShown).mockReturnValueOnce(false)
    expect(stage.active(item({ id: 'warm', intensity: 1 }))).toBe(false)
    expect(stage.key(item({ id: 'warm', intensity: 0.2 }))).toBe(stage.key(item({ id: 'warm', intensity: 0.9 })))
    expect(stage.outputSize(item(), { width: 4, height: 3 })).toEqual({ width: 4, height: 3 })
  })

  it('uploads the look’s table once per pass and records it with the arena and its intensity', async () => {
    const p = pass()
    createPassMock.mockResolvedValue(p)
    const lookTable = vi.fn(async () => TABLE)
    const stage = createLookStage({ lookTable })
    const d = device()
    const clip = item({ id: 'warm', intensity: 0.4 })
    await stage.prepare(clip, d)
    await stage.prepare(clip, d)
    expect(createPassMock).toHaveBeenCalledWith(d, { input: 'rgba16float', output: 'rgba16float' })
    expect(p.setLook).toHaveBeenCalledTimes(1)
    const arena = { upload: vi.fn() }
    const env = { device: d, mode: 'export', arena } as unknown as StageEnv
    stage.encode(env, {} as GPUCommandEncoder, clip, 6, tex(8, 4), tex(8, 4))
    expect(p.encode).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'warm', 0.4, { width: 8, height: 4 }, arena)
  })

  it('prepare names the look when its file is missing, and encode when it was not prepared', async () => {
    createPassMock.mockResolvedValue(pass())
    const stage = createLookStage({ lookTable: async () => null })
    const d = device()
    const clip = item({ id: 'gone', intensity: 1 })
    await expect(stage.prepare(clip, d)).rejects.toThrow(StageError)
    await expect(stage.prepare(clip, d)).rejects.toThrow(/Clip 'Dusk', look: the look 'gone' is not in the looks library/)
    const env = { device: d, mode: 'preview', arena: {} } as unknown as StageEnv
    expect(() => stage.encode(env, {} as GPUCommandEncoder, clip, 1, tex(2, 2), tex(2, 2))).toThrow(/not prepared/)
  })

  it('refuses an 8-bit or mismatched texture, and a look the pass will not load', async () => {
    const p = pass()
    createPassMock.mockResolvedValue(p)
    const stage = createLookStage({ lookTable: async () => TABLE })
    const d = device()
    const clip = item({ id: 'warm', intensity: 1 })
    await stage.prepare(clip, d)
    const env = { device: d, mode: 'export', arena: {} } as unknown as StageEnv
    expect(() => stage.encode(env, {} as GPUCommandEncoder, clip, 1, tex(2, 2, 'rgba8unorm'), tex(2, 2))).toThrow(/rgba16float/)
    expect(() => stage.encode(env, {} as GPUCommandEncoder, clip, 1, tex(2, 2), tex(3, 2))).toThrow(/3x2/)
    const d2 = device()
    p.setLook.mockImplementationOnce(() => {
      throw new Error('1D only')
    })
    await expect(stage.prepare(item({ id: 'shaper', intensity: 1 }), d2)).rejects.toThrow(/could not be loaded: 1D only/)
  })
})
