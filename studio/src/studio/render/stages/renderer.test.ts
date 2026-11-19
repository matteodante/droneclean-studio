import { describe, expect, it, vi } from 'vite-plus/test'
import type { FrameBackend } from '@/studio/render/frames/types'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { createDerivedSizeStore } from './derived-sizes'
import { createPreparer } from './preparer'
import { createStageRegistry } from './registry'
import { createRendererStages } from './renderer'
import { StageError, type SourceStage, type StageId } from './types'

const copies: unknown[] = []
const device = {
  lost: new Promise(() => undefined),
  createTexture: (descriptor: GPUTextureDescriptor) => ({
    ...(descriptor.size as object),
    format: descriptor.format,
    createView: () => ({}),
    destroy: () => undefined,
  }),
  createBuffer: () => ({ destroy: () => undefined }),
  createShaderModule: () => ({}),
  createBindGroupLayout: () => ({}),
  createPipelineLayout: () => ({}),
  createRenderPipeline: () => ({}),
  createBindGroup: () => ({}),
  createCommandEncoder: () => ({
    copyTextureToTexture: () => undefined,
    beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
    finish: () => ({}),
  }),
  queue: {
    writeBuffer: () => undefined,
    copyExternalImageToTexture: (source: unknown) => copies.push(source),
    submit: () => undefined,
    onSubmittedWorkDone: async () => undefined,
  },
} as unknown as GPUDevice

const backend: FrameBackend = {
  origin: 'raw-test',
  decode: async (_file, index) => ({
    texture: { width: 64, height: 32, destroy: () => undefined } as unknown as GPUTexture,
    index,
    width: 64,
    height: 32,
  }),
  destroy: () => undefined,
}

function stage(id: StageId, prepare: SourceStage['prepare']): SourceStage {
  return {
    id,
    scope: id === 'look' ? 'output-frame' : 'source-frame',
    active: (item) => (item as unknown as Record<string, unknown>)[id] === true,
    key: () => id,
    outputSize: (_item, input) => input,
    prepare,
    ready: () => true,
    encode: () => undefined,
  }
}

function clip(flags: Partial<Record<StageId, boolean>>): VideoItem {
  return { id: 'clip-1', type: 'video', label: 'Clip one', src: 'blob:clip', ...flags } as unknown as VideoItem
}

function rendererWith(mode: 'export' | 'preview', failing: StageId) {
  const failure = (id: StageId) => async (item: VideoItem) => {
    if (id === failing) {
      throw new StageError({ clip: item.label ?? item.id, stage: id, reason: 'the engine refused the file' })
    }
  }
  const registry = createStageRegistry([
    stage('stabilize', failure('stabilize')),
    stage('input-colour', failure('input-colour')),
    stage('look', failure('look')),
  ])
  const preparer = createPreparer({ registry, sizes: createDerivedSizeStore() })
  const prepareAll = vi.spyOn(preparer, 'prepareAll')
  const stages = createRendererStages({
    mode,
    projectFps: 30,
    getDevice: async () => device,
    registry,
    preparer,
    backend: () => backend,
  })
  return { stages, prepareAll }
}

describe('a renderer’s stages', () => {
  it('make an export stop with the StageError of a stage that cannot prepare, before frame 0', async () => {
    const { stages } = rendererWith('export', 'stabilize')
    const items: TimelineItem[] = [clip({ stabilize: true })]

    await expect(stages.prepare(items)).rejects.toThrow(
      "Clip 'Clip one', stabilization: the engine refused the file",
    )
    await expect(stages.render(clip({ stabilize: true }), 0)).rejects.toBeInstanceOf(StageError)
  })

  it('prepare only the staged clips, with the project’s rate for a clip that does not carry its own', async () => {
    const { stages, prepareAll } = rendererWith('export', 'look')
    await stages.prepare([
      clip({ 'input-colour': true }),
      { id: 'text', type: 'text' } as unknown as TimelineItem,
      clip({}),
    ])
    expect(prepareAll).toHaveBeenCalledTimes(1)
    const [items] = prepareAll.mock.calls[0]!
    expect(items).toEqual([expect.objectContaining({ id: 'clip-1', sourceFps: 30 })])
  })

  it('draw an export frame with every stage once prepared', async () => {
    const { stages } = rendererWith('export', 'look')
    const staged = await stages.render(clip({ 'input-colour': true }), 3)
    expect(staged).toMatchObject({ kind: 'fresh', width: 64, height: 32 })
  })

  it('stage a preview frame FreeCut decoded: copied to the GPU, widened, through the stages, not from the provider', async () => {
    const decode = vi.spyOn(backend, 'decode')
    const { stages } = rendererWith('preview', 'look')
    const image = { source: { tag: 'bitmap' } as unknown as ImageBitmap, width: 64, height: 32 }
    await stages.prepare([clip({ 'input-colour': true })])
    await vi.waitFor(async () => {
      const staged = await stages.stageImage(clip({ 'input-colour': true }), 4, image)
      expect(staged.kind).toBe('fresh')
    })
    expect(copies.at(-1)).toEqual({ source: image.source })
    expect(decode).not.toHaveBeenCalled()
    await expect(
      rendererWith('export', 'look').stages.stageImage(clip({ 'input-colour': true }), 4, image),
    ).rejects.toThrow(/exact source frame/)
    stages.destroy()
  })

  it('never throw a preview’s preparation failure: the clip is drawn from its source and its state says why', async () => {
    const { stages } = rendererWith('preview', 'input-colour')
    await stages.prepare([clip({ 'input-colour': true })])
    await Promise.resolve()
    const staged = await stages.render(clip({ 'input-colour': true }), 1)
    expect(staged.kind).toBe('partial')
    stages.destroy()
  })
})
