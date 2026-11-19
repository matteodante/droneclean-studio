import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ParsedCube } from '@/studio/color/cube'
import { setFeatureOverride } from '@/studio/feature-switches'
import type { SourceFrame, SourceFrameProvider } from '@/studio/render/frames/types'
import type { MotionBlurStage } from '@/studio/motion-blur/stage'
import type { VideoItem } from '@/types/timeline'
import type { ClipStageState } from './failure'
import { createDerivedSizeStore } from './derived-sizes'
import { createLookStage } from './look'
import { createStagePipeline } from './pipeline'
import { createPreparer } from './preparer'
import { createStageRegistry } from './registry'
import { StageError, type SourceStage, type StageId } from './types'

// The look stage as the pipeline runs it: the real stage, preparer and pipeline over a fake device and a fake pass,
// with the looks switch on the way the golden run turns it on (design 3.6 section 3, row 5.2 look-hook).

const { createPassMock } = vi.hoisted(() => ({ createPassMock: vi.fn() }))
vi.mock('@/studio/color/gpu/look-pass', () => ({ createLookPass: createPassMock }))

const TABLE = { lut3d: {} } as unknown as ParsedCube

function build(options: { table: ParsedCube | null; mode: 'export' | 'preview' }) {
  const log: string[] = []
  const pass = {
    setLook: vi.fn((id: string) => log.push(`upload ${id}`)),
    removeLook: vi.fn(),
    destroy: vi.fn(),
    encode: vi.fn((_e: unknown, _i: unknown, _o: unknown, id: string, intensity: number) =>
      log.push(`look ${id} ${intensity}`),
    ),
  }
  createPassMock.mockReset()
  createPassMock.mockResolvedValue(pass)
  const device = {
    lost: new Promise(() => undefined),
    createTexture: (descriptor: GPUTextureDescriptor) => {
      const size = descriptor.size as { width: number; height: number }
      return { width: size.width, height: size.height, format: descriptor.format, destroy: () => undefined, createView: () => ({}) }
    },
    createBuffer: () => ({ destroy: () => undefined }),
    createCommandEncoder: () => ({ copyTextureToTexture: () => undefined, finish: () => ({}) }),
    queue: { writeBuffer: () => undefined, submit: () => log.push('submit'), onSubmittedWorkDone: async () => undefined },
  } as unknown as GPUDevice

  const colour: SourceStage = {
    id: 'input-colour' satisfies StageId,
    scope: 'source-frame',
    active: (item) => (item as unknown as { inputColor?: string }).inputColor !== undefined,
    key: () => 'colour',
    outputSize: (_item, input) => input,
    prepare: async () => undefined,
    ready: () => true,
    encode: (_env, _encoder, _item, index) => {
      log.push(`input-colour ${index}`)
    },
  }
  const idle = (id: StageId): SourceStage => ({ ...colour, id, scope: 'source-frame', active: () => false })
  const registry = createStageRegistry([
    idle('stabilize'),
    colour,
    createLookStage({ lookTable: async (id) => (id === 'gone' ? null : options.table) }),
  ])
  const preparer = createPreparer({ registry, sizes: createDerivedSizeStore() })
  const texture = { width: 8, height: 4, format: 'rgba16float', createView: () => ({}) } as unknown as GPUTexture
  const provider = {
    frameAt: vi.fn(async (_item: VideoItem, index: number): Promise<SourceFrame> => {
      log.push(`frame ${index}`)
      return { texture, index, width: 8, height: 4, origin: 'webcodecs' }
    }),
    lookahead: () => undefined,
    release: () => undefined,
    destroy: () => undefined,
  } as unknown as SourceFrameProvider
  const states: Array<ClipStageState | null> = []
  const pipeline = createStagePipeline({
    device,
    mode: options.mode,
    registry,
    preparer,
    provider,
    onState: (_item, state) => states.push(state),
    onReady: () => undefined,
    gather: async (_device, _format, size): Promise<MotionBlurStage> => ({
      size,
      accumulatorFormat: 'rgba16float',
      pass: (_encoder, _uploads, inputs, step) =>
        log.push(`pass ${step} ${inputs.map((input) => input.weight).join(',')}`),
      destroy: () => undefined,
    }),
  })
  return { pipeline, preparer, pass, log, states, device }
}

const clip = (look?: { id: string; intensity: number }, inputColor?: string): VideoItem =>
  ({ id: 'c', type: 'video', label: 'Dusk', mediaId: 'm', look, inputColor }) as unknown as VideoItem

afterEach(() => setFeatureOverride('looks', undefined))

describe('the look stage in the pipeline', () => {
  it('runs after the input transform of every sample and after the gather, once per output frame', async () => {
    setFeatureOverride('looks', true)
    const { pipeline, preparer, pass, log, device } = build({ table: TABLE, mode: 'export' })
    const item = clip({ id: 'warm', intensity: 0.6 }, 'dlog-m')
    await preparer.prepareAll([item], device)
    await pipeline.render(item, { samples: [{ index: 4, weight: 0.5 }, { index: 5, weight: 0.5 }] })

    const steps = log.filter((line) => /^(input-colour|pass|look)/.test(line))
    expect(steps).toEqual(['input-colour 4', 'input-colour 5', 'pass only 0.5,0.5', 'look warm 0.6'])
    expect(pass.setLook).toHaveBeenCalledTimes(1)
    expect(pass.encode).toHaveBeenCalledTimes(1)
  })

  it('builds no pass for a clip with no look, or with the looks switch off', async () => {
    setFeatureOverride('looks', false)
    const { pipeline, preparer, log, device } = build({ table: TABLE, mode: 'export' })
    await preparer.prepareAll([clip()], device)
    await pipeline.render(clip(), 3)
    const switchedOff = clip({ id: 'warm', intensity: 1 })
    await preparer.prepareAll([switchedOff], device)
    await pipeline.render(switchedOff, 3)
    expect(createPassMock).not.toHaveBeenCalled()
    expect(log.some((line) => line.startsWith('look'))).toBe(false)
  })

  it('stops an export with a StageError naming the clip and the look when the look’s file is missing', async () => {
    setFeatureOverride('looks', true)
    const { preparer, log, device } = build({ table: TABLE, mode: 'export' })
    const item = clip({ id: 'gone', intensity: 1 })
    const failed = preparer.prepareAll([item], device)
    await expect(failed).rejects.toBeInstanceOf(StageError)
    await expect(failed).rejects.toThrow(/Clip 'Dusk', look: the look 'gone' is not in the looks library/)
    expect(log).not.toContain('submit')
  })

  it('shows the failure in a preview and draws the clip from its source', async () => {
    setFeatureOverride('looks', true)
    const { pipeline, preparer, states, log, device } = build({ table: TABLE, mode: 'preview' })
    const item = clip({ id: 'gone', intensity: 1 })
    await preparer.prepareAll([item], device).catch(() => undefined)
    const staged = await pipeline.render(item, 0)
    expect(staged.kind).not.toBe('fresh')
    expect(states.at(-1)).toMatchObject({ kind: 'failed', stage: 'look' })
    expect(log.some((line) => line.startsWith('look'))).toBe(false)
  })
})
