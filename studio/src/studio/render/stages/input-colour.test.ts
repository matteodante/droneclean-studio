import { describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { createInputColourStage, inputColorPassFor } from './input-colour'
import { StageError, type StageEnv } from './types'

const { createPassMock } = vi.hoisted(() => ({ createPassMock: vi.fn() }))
vi.mock('@/studio/color/gpu/input-color-pass', () => ({ createInputColorPass: createPassMock }))

const device = () => ({ lost: new Promise(() => {}) }) as unknown as GPUDevice
const item = (inputColor?: string): VideoItem =>
  ({ id: 'c', type: 'video', label: 'Orbit', inputColor }) as unknown as VideoItem
const tex = (width: number, height: number, format = 'rgba16float') =>
  ({ width, height, format, createView: () => ({ width, height }) }) as unknown as GPUTexture

describe('the input colour stage', () => {
  it('is a source-frame stage, active for a profile other than none, keyed by the profile', () => {
    const stage = createInputColourStage()
    expect(stage.id).toBe('input-colour')
    expect(stage.scope).toBe('source-frame')
    expect(stage.active(item('dlog-m'))).toBe(true)
    expect(stage.active(item('none'))).toBe(false)
    expect(stage.active(item())).toBe(false)
    expect(stage.key(item('dlog'))).toBe('dlog')
    expect(stage.outputSize(item('dlog'), { width: 7, height: 5 })).toEqual({ width: 7, height: 5 })
    expect(stage.ready(item('dlog'), 0)).toBe(true)
  })

  it('builds one pass per device in rgba16float, and records the profile at the input’s size', async () => {
    const encode = vi.fn()
    createPassMock.mockResolvedValue({ encode })
    const stage = createInputColourStage()
    const d = device()
    await stage.prepare(item('dlog-m'), d)
    await stage.prepare(item('dlog'), d)
    expect(createPassMock).toHaveBeenCalledTimes(1)
    expect(createPassMock).toHaveBeenCalledWith(d, { input: 'rgba16float', output: 'rgba16float' })
    const env = { device: d, mode: 'preview', arena: {} } as unknown as StageEnv
    const input = tex(64, 36)
    const output = tex(64, 36)
    stage.encode(env, {} as GPUCommandEncoder, item('dlog-m'), 4, input, output)
    expect(encode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ width: 64 }),
      expect.objectContaining({ width: 64 }),
      'dlog-m',
      { width: 64, height: 36 },
    )
  })

  it('keeps passes apart per device', async () => {
    createPassMock.mockClear()
    createPassMock.mockResolvedValue({ encode: vi.fn() })
    const formats = { input: 'rgba16float', output: 'rgba16float' } as const
    const a = await inputColorPassFor(device(), formats)
    const b = await inputColorPassFor(device(), formats)
    expect(a).toBe(b)
    expect(createPassMock).toHaveBeenCalledTimes(2)
  })

  it('names the clip and frame when the pass was not prepared, the format is 8-bit or the sizes differ', async () => {
    createPassMock.mockResolvedValue({ encode: vi.fn() })
    const stage = createInputColourStage()
    const d = device()
    const env = { device: d, mode: 'export', arena: {} } as unknown as StageEnv
    const enc = {} as GPUCommandEncoder
    expect(() => stage.encode(env, enc, item('dlog'), 2, tex(2, 2), tex(2, 2))).toThrow(StageError)
    await stage.prepare(item('dlog'), d)
    expect(() => stage.encode(env, enc, item('dlog'), 2, tex(2, 2, 'rgba8unorm'), tex(2, 2))).toThrow(/rgba16float/)
    expect(() => stage.encode(env, enc, item('dlog'), 2, tex(2, 2), tex(4, 2))).toThrow(
      /Clip 'Orbit', input colour, source frame 2: its output is 4x2/,
    )
  })

  it('prepare throws a StageError when the pass cannot be built, and the next prepare tries again', async () => {
    createPassMock.mockRejectedValueOnce(new Error('no shader')).mockResolvedValueOnce({ encode: vi.fn() })
    const stage = createInputColourStage()
    const d = device()
    await expect(stage.prepare(item('dlog'), d)).rejects.toThrow(/Clip 'Orbit', input colour: .*no shader/)
    await expect(stage.prepare(item('dlog'), d)).resolves.toBeUndefined()
  })
})
