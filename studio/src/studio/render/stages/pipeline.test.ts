import { describe, expect, it, vi } from 'vite-plus/test'
import type { SourceFrame, SourceFrameProvider } from '@/studio/render/frames/types'
import type { VideoItem } from '@/types/timeline'
import type { ClipStageState } from './failure'
import type { MotionBlurStage } from '@/studio/motion-blur/stage'
import { createStagePipeline, type StagePipelineOptions } from './pipeline'
import type { PrepareStatus } from './preparer'
import { createStageRegistry } from './registry'
import { StageError, type SourceStage, type StageId, type StageNotReady } from './types'

interface FakeTexture {
  createView(): unknown
  label?: string
  width: number
  height: number
  format: string
  destroyed: boolean
  destroy(): void
}

/** A device that records what the pipeline asks of it */
function fakeDevice() {
  const log: string[] = []
  const textures: FakeTexture[] = []
  const device = {
    lost: new Promise(() => undefined),
    createTexture: (descriptor: GPUTextureDescriptor) => {
      const size = descriptor.size as { width: number; height: number }
      const texture: FakeTexture = {
        label: descriptor.label,
        width: size.width,
        height: size.height,
        format: descriptor.format,
        destroyed: false,
        destroy() {
          this.destroyed = true
        },
        createView: () => ({ of: descriptor.label }),
      }
      textures.push(texture)
      return texture
    },
    createBuffer: () => ({ destroy: () => undefined }),
    createCommandEncoder: () => ({
      copyTextureToTexture: () => log.push('copy'),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: () => undefined,
      submit: () => log.push('submit'),
      onSubmittedWorkDone: async () => undefined,
    },
  }
  return { device: device as unknown as GPUDevice, log, textures }
}

function fakeProvider(log: string[]) {
  const source = { width: 320, height: 240, format: 'rgba16float', createView: () => ({ of: 'source' }) } as unknown as GPUTexture
  const provider = {
    frameAt: vi.fn(async (_item: VideoItem, index: number): Promise<SourceFrame> => {
      log.push(`frame ${index}`)
      return { texture: source, index, width: 320, height: 240, origin: 'webcodecs' }
    }),
    lookahead: () => undefined,
    release: vi.fn(() => log.push('release')),
    destroy: () => undefined,
  }
  return { provider: provider as SourceFrameProvider & typeof provider, source }
}

/** A stage the test drives: active when the item has its flag, size changes only for the stabilizer */
function fakeStage(id: StageId, log: string[]) {
  let readyAnswer: () => true | StageNotReady = () => true
  let failure: Error | undefined
  const stage: SourceStage = {
    id,
    scope: id === 'look' ? 'output-frame' : 'source-frame',
    active: (item) => (item as unknown as Record<string, unknown>)[id] === true,
    key: () => id,
    outputSize: (_item, input) => (id === 'stabilize' ? { width: 300, height: 170 } : input),
    prepare: async () => undefined,
    ready: () => {
      if (failure) throw failure
      return readyAnswer()
    },
    encode: (_env, _encoder, _item, index, input, output) => {
      log.push(`${id} ${index} ${input.width}x${input.height}>${output.width}x${output.height} ${output.format}`)
    },
  }
  return {
    stage,
    notReady() {
      let resolve!: () => void
      const ready = new Promise<void>((done) => {
        resolve = done
      })
      readyAnswer = () => ({ kind: 'not-ready', stage: id, ready })
      return () => {
        readyAnswer = () => true
        resolve()
      }
    },
    fail(error: Error) {
      failure = error
    },
  }
}

function item(flags: Partial<Record<StageId, boolean>>): VideoItem {
  return { id: 'clip-1', type: 'video', label: 'Clip one', ...flags } as unknown as VideoItem
}

function setup(mode: 'export' | 'preview', status: () => PrepareStatus | undefined = () => ({ status: 'ready' })) {
  const { device, log, textures } = fakeDevice()
  const stabilize = fakeStage('stabilize', log)
  const colour = fakeStage('input-colour', log)
  const look = fakeStage('look', log)
  const registry = createStageRegistry([stabilize.stage, colour.stage, look.stage])
  const { provider } = fakeProvider(log)
  const preparer = {
    statusOf: vi.fn(status),
    ensure: vi.fn(),
    prepareAll: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
  }
  const states: Array<ClipStageState | null> = []
  const onReady = vi.fn()
  const gatherCalls: string[] = []
  const gatherDestroyed = vi.fn()
  const gather = vi.fn(
    async (_device: GPUDevice, format: GPUTextureFormat, size: { width: number; height: number }): Promise<MotionBlurStage> => {
      gatherCalls.push(`gather ${format} ${size.width}x${size.height}`)
      return {
        size,
        accumulatorFormat: 'rgba16float',
        pass: (_encoder, _uploads, inputs, step) =>
          log.push(`pass ${step} ${inputs.map((input) => input.weight).join(',')}`),
        destroy: gatherDestroyed,
      }
    },
  )
  const options: StagePipelineOptions = {
    gather,
    device,
    mode,
    registry,
    preparer,
    provider,
    onState: (_item, state) => states.push(state),
    onReady,
  }
  return { pipeline: createStagePipeline(options), gather, gatherCalls, gatherDestroyed, log, textures, stabilize, colour, look, provider, preparer, states, onReady }
}

describe('the stage pipeline', () => {
  it('runs the active stages in order on one encoder, in rgba16float, then submits and gives the frame back', async () => {
    const { pipeline, log, provider } = setup('export')
    const staged = await pipeline.render(item({ stabilize: true, 'input-colour': true }), 12)

    expect(log).toEqual([
      'frame 12',
      'stabilize 12 320x240>300x170 rgba16float',
      'input-colour 12 300x170>300x170 rgba16float',
      'submit',
      'release',
    ])
    expect(staged).toMatchObject({ width: 300, height: 170, kind: 'fresh' })
    expect((staged.texture as unknown as FakeTexture).format).toBe('rgba16float')
    expect(provider.release).toHaveBeenCalledTimes(1)
  })

  it('reuses the clip’s texture from frame to frame while its size stays', async () => {
    const { pipeline } = setup('export')
    const clip = item({ 'input-colour': true })
    const first = await pipeline.render(clip, 1)
    const second = await pipeline.render(clip, 2)
    expect(second.texture).toBe(first.texture)
  })
})

describe('an export', () => {
  it('throws the StageError of a stage that cannot draw, and submits nothing', async () => {
    const { pipeline, colour, log } = setup('export')
    const error = new StageError({ clip: 'Clip one', stage: 'input-colour', sourceIndex: 3, reason: 'broken' })
    colour.fail(error)

    await expect(pipeline.render(item({ 'input-colour': true }), 3)).rejects.toBe(error)
    expect(log).not.toContain('submit')
  })

  it('names the clip, the stage and the frame when a stage throws while recording', async () => {
    const { pipeline, look, log } = setup('export')
    look.stage.encode = () => {
      throw new Error('the pass is gone')
    }

    await expect(pipeline.render(item({ look: true }), 9)).rejects.toThrow(
      "Clip 'Clip one', look, source frame 9: the pass is gone",
    )
    expect(log).toEqual(['frame 9', 'release'])
  })

  it('prepares a clip that is not prepared before its frame, and stops with the preparation’s error', async () => {
    const { pipeline, preparer } = setup('export', () => undefined)
    const error = new StageError({ clip: 'Clip one', stage: 'stabilize', reason: 'no motion data' })
    preparer.prepareAll.mockRejectedValueOnce(error)

    await expect(pipeline.render(item({ stabilize: true }), 0)).rejects.toBe(error)
  })

  it('awaits a stage whose data is arriving, then draws: no frame without its stages', async () => {
    const { pipeline, stabilize, log } = setup('export')
    const arrive = stabilize.notReady()
    const rendering = pipeline.render(item({ stabilize: true }), 4)
    await Promise.resolve()
    expect(log).toEqual([])
    arrive()
    const staged = await rendering
    expect(staged.kind).toBe('fresh')
    expect(log).toContain('stabilize 4 320x240>300x170 rgba16float')
  })
})

describe('a staged clip whose decoder cannot give the frame (design 3.6 section 2.10)', () => {
  it('stops an export with a StageError naming the clip, its stage and the frame, never another picture', async () => {
    const { pipeline, provider, log } = setup('export')
    provider.frameAt.mockRejectedValueOnce(
      new Error("mediabunny: the video track of 'source:a' cannot be decoded by this browser"),
    )

    const rendering = pipeline.render(item({ 'input-colour': true }), 8)
    await expect(rendering).rejects.toBeInstanceOf(StageError)
    await expect(rendering).rejects.toThrow(
      "Clip 'Clip one', input colour, source frame 8: its source frame could not be decoded: mediabunny: the video track of 'source:a' cannot be decoded by this browser",
    )
    expect(log).not.toContain('submit')
  })

  it('shows the failure in a preview and holds the last good frame; with none it draws nothing', async () => {
    const { pipeline, provider, states } = setup('preview')
    const clip = item({ 'input-colour': true })
    provider.frameAt.mockRejectedValueOnce(new Error('the file is gone'))
    await expect(pipeline.render(clip, 1)).rejects.toBeInstanceOf(StageError)
    expect(states.at(-1)).toMatchObject({ kind: 'failed', stage: 'input-colour' })

    const good = await pipeline.render(clip, 2)
    provider.frameAt.mockRejectedValueOnce(new Error('the file is gone'))
    const held = await pipeline.render(clip, 3)
    expect(held).toMatchObject({ kind: 'held', texture: good.texture })
    expect(states.at(-1)).toMatchObject({
      kind: 'failed',
      message: "Clip 'Clip one', input colour, source frame 3: its source frame could not be decoded: the file is gone",
    })
  })
})

describe('a preview frame the caller decoded (renderFrame)', () => {
  it('goes through the clip’s stages without the provider, and stays the caller’s', async () => {
    const { pipeline, provider, log } = setup('preview')
    const texture = { width: 320, height: 240, format: 'rgba16float' } as unknown as GPUTexture
    const staged = await pipeline.renderFrame(item({ 'input-colour': true }), {
      texture,
      index: 6,
      width: 320,
      height: 240,
      origin: 'webcodecs',
    })
    expect(staged).toMatchObject({ kind: 'fresh', width: 320, height: 240 })
    expect(provider.frameAt).not.toHaveBeenCalled()
    expect(provider.release).not.toHaveBeenCalled()
    expect(log).toEqual(['input-colour 6 320x240>320x240 rgba16float', 'submit'])
  })
})

describe('a preview', () => {
  it('reuses the clip’s last good frame while a stage is not ready, says so, and asks for the frame again once', async () => {
    const { pipeline, stabilize, states, onReady, log } = setup('preview')
    const clip = item({ stabilize: true })
    const good = await pipeline.render(clip, 1)
    expect(states.at(-1)).toBeNull()

    const arrive = stabilize.notReady()
    log.length = 0
    const held = await pipeline.render(clip, 2)
    expect(held).toMatchObject({ kind: 'held', texture: good.texture, width: 300, height: 170 })
    expect(log).toEqual([])
    expect(states.at(-1)).toEqual({ kind: 'opening', stage: 'stabilize' })
    await pipeline.render(clip, 3)
    expect(onReady).not.toHaveBeenCalled()

    arrive()
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    const again = await pipeline.render(clip, 3)
    expect(again.kind).toBe('fresh')
    expect(states.at(-1)).toBeNull()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('holds the last good frame of a clip whose stage failed and shows the failure; it is not asked again by itself', async () => {
    const { pipeline, colour, states, onReady } = setup('preview')
    const clip = item({ 'input-colour': true })
    const good = await pipeline.render(clip, 1)
    colour.fail(new StageError({ clip: 'Clip one', stage: 'input-colour', reason: 'pass failed' }))

    const held = await pipeline.render(clip, 2)
    expect(held).toMatchObject({ kind: 'held', texture: good.texture })
    expect(states.at(-1)).toEqual({
      kind: 'failed',
      stage: 'input-colour',
      message: "Clip 'Clip one', input colour: pass failed",
    })
    await Promise.resolve()
    expect(onReady).not.toHaveBeenCalled()
  })

  it('draws a clip with no good frame yet from its source with the stages that can draw, and says what is missing', async () => {
    const { pipeline, stabilize, states, log } = setup('preview')
    stabilize.notReady()
    const staged = await pipeline.render(item({ stabilize: true, 'input-colour': true }), 5)

    expect(staged).toMatchObject({ kind: 'partial', width: 320, height: 240 })
    expect(log).toEqual(['frame 5', 'input-colour 5 320x240>320x240 rgba16float', 'submit', 'release'])
    expect(states.at(-1)).toEqual({ kind: 'opening', stage: 'stabilize' })
  })

  it('starts the preparation of a clip it was never asked to prepare, and waits for it', async () => {
    let status: PrepareStatus | undefined
    const { pipeline, preparer, states } = setup('preview', () => status)
    preparer.ensure.mockImplementation(() => {
      status = { status: 'preparing' }
    })
    const staged = await pipeline.render(item({ 'input-colour': true }), 0)

    expect(preparer.ensure).toHaveBeenCalledTimes(1)
    expect(staged.kind).toBe('partial')
    expect(states.at(-1)).toEqual({ kind: 'opening', stage: 'input-colour' })
  })
})

/** A plan as `sourceFramePlan` returns it */
const plan = (...samples: Array<[number, number]>) => ({
  samples: samples.map(([index, weight]) => ({ index, weight })),
})

describe('the motion-blur gather (design 7.2 B)', () => {
  it('decodes each sample of the plan once, in order, and gathers them with the plan’s weights, summing to 1', async () => {
    const { pipeline, log, provider, gatherCalls } = setup('export')
    const staged = await pipeline.render(item({}), plan([8, 0.25], [9, 0.25], [10, 0.25], [11, 0.25]))

    expect(provider.frameAt.mock.calls.map((call) => call[1])).toEqual([8, 9, 10, 11])
    // four samples are one pass, straight into the output: one submit
    expect(log).toEqual([
      'frame 8', 'frame 9', 'frame 10', 'frame 11',
      'pass only 0.25,0.25,0.25,0.25', 'submit',
      'release', 'release', 'release', 'release',
    ])
    const weights = log[4]!.split(' ')[2]!.split(',').map(Number)
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12)
    expect(gatherCalls).toEqual(['gather rgba16float 320x240'])
    expect(staged).toMatchObject({ kind: 'fresh', width: 320, height: 240 })
    expect(provider.release).toHaveBeenCalledTimes(4)
  })

  it('with one sample, or a bare index, makes no gather: the same single pass as blur off', async () => {
    const { pipeline, log, gather } = setup('export')
    await pipeline.render(item({ 'input-colour': true }), plan([5, 1]))
    const withPlan = [...log]
    log.length = 0
    await pipeline.render(item({ 'input-colour': true }), 5)

    expect(log).toEqual(withPlan)
    expect(log).toEqual(['frame 5', 'input-colour 5 320x240>320x240 rgba16float', 'submit', 'release'])
    expect(gather).not.toHaveBeenCalled()
  })

  it('honours a ramp’s sample list: uneven weights and a changing count, frame after frame', async () => {
    const { pipeline, log, provider } = setup('export')
    await pipeline.render(item({}), plan([20, 0.5], [21, 0.5]))
    await pipeline.render(item({}), plan([22, 0.1], [23, 0.2], [24, 0.3], [25, 0.3], [26, 0.1]))

    expect(provider.frameAt.mock.calls.map((call) => call[1])).toEqual([20, 21, 22, 23, 24, 25, 26])
    // two samples: one pass; five: a first pass of four and a last pass of one
    expect(log.filter((line) => line.startsWith('pass '))).toEqual([
      'pass only 0.5,0.5',
      'pass first 0.1,0.2,0.3,0.3',
      'pass last 0.1',
    ])
  })

  it('runs the source-frame stage on every sample before the gather, and the output-frame stages after it', async () => {
    const { pipeline, log, gatherCalls } = setup('export')
    await pipeline.render(item({ stabilize: true, look: true }), plan([4, 0.5], [5, 0.5]))

    expect(log).toEqual([
      'frame 4', 'frame 5',
      'stabilize 4 320x240>300x170 rgba16float', 'stabilize 5 320x240>300x170 rgba16float',
      'pass only 0.5,0.5', 'submit',
      'look 4 300x170>300x170 rgba16float', 'submit',
      'release', 'release',
    ])
    expect(gatherCalls).toEqual(['gather rgba16float 300x170'])
  })

  it('runs input colour once per sample, before the gather: the gather never sees log code values', async () => {
    const { pipeline, log } = setup('export')
    await pipeline.render(item({ 'input-colour': true, look: true }), plan([4, 0.25], [5, 0.25], [6, 0.25], [7, 0.25]))

    const steps = log.filter((line) => /^(input-colour|pass|look)/.test(line)).map((line) => line.split(' ')[0])
    expect(steps).toEqual(['input-colour', 'input-colour', 'input-colour', 'input-colour', 'pass', 'look'])
    expect(log.filter((line) => line.startsWith('input-colour')).map((line) => line.split(' ')[1])).toEqual(['4', '5', '6', '7'])
  })

  it('raises a StageError naming the clip, the motion blur and the sample when a frame cannot be decoded', async () => {
    const { pipeline, provider, log } = setup('export')
    provider.frameAt.mockImplementationOnce(async (_item, index) => ({
      texture: { createView: () => ({}) } as unknown as GPUTexture, index, width: 320, height: 240, origin: 'webcodecs' as const,
    }))
    provider.frameAt.mockRejectedValueOnce(new Error('the decoder lost frame 9'))

    const rendering = pipeline.render(item({}), plan([8, 0.5], [9, 0.5]))
    await expect(rendering).rejects.toBeInstanceOf(StageError)
    await expect(rendering).rejects.toThrow(
      "Clip 'Clip one', motion blur, source frame 9: its source frame could not be decoded: the decoder lost frame 9",
    )
    expect(log.some((line) => line.startsWith('pass'))).toBe(false)
  })

  it('refuses a plan with no sample, or weights that are not a mean', async () => {
    const { pipeline } = setup('export')
    await expect(pipeline.render(item({}), plan())).rejects.toBeInstanceOf(RangeError)
    await expect(pipeline.render(item({}), plan([1, 0.5], [2, 0.25]))).rejects.toThrow('sum to 1')
    await expect(pipeline.render(item({}), plan([1, 1.5], [2, -0.5]))).rejects.toThrow('weight')
  })

  it('serialises two gathered renders, so one accumulator never mixes two clips', async () => {
    const { pipeline, log } = setup('export')
    await Promise.all([
      pipeline.render(item({}), plan([1, 0.5], [2, 0.5])),
      pipeline.render({ ...item({}), id: 'clip-2' }, plan([7, 0.5], [8, 0.5])),
    ])
    expect(log.filter((line) => line.startsWith('frame '))).toEqual(['frame 1', 'frame 2', 'frame 7', 'frame 8'])
  })

  it('draws the blend in a preview too, and destroys the accumulator with the pipeline', async () => {
    const { pipeline, log, gatherDestroyed } = setup('preview')
    const staged = await pipeline.render(item({}), plan([8, 0.5], [9, 0.5]))

    expect(staged).toMatchObject({ kind: 'fresh' })
    expect(log.filter((line) => line.startsWith('pass '))).toEqual(['pass only 0.5,0.5'])
    pipeline.destroy()
    expect(gatherDestroyed).toHaveBeenCalledTimes(1)
  })

  it('holds the last good frame of a blurred clip whose decoder fails in a preview', async () => {
    const { pipeline, provider, states } = setup('preview')
    const clip = item({})
    const good = await pipeline.render(clip, plan([8, 0.5], [9, 0.5]))
    provider.frameAt.mockRejectedValueOnce(new Error('gone'))
    const held = await pipeline.render(clip, plan([10, 0.5], [11, 0.5]))
    expect(held).toMatchObject({ kind: 'held', texture: good.texture })
    expect(states.at(-1)).toMatchObject({ kind: 'failed', stage: 'motion-blur' })
  })

  it('splits a long plan into passes of four: first, middle, last', async () => {
    const { pipeline, log } = setup('export')
    const nine = Array.from({ length: 9 }, (_, i): [number, number] => [30 + i, 1 / 9])
    await pipeline.render(item({}), plan(...nine))
    expect(log.filter((line) => line.startsWith('pass ')).map((line) => line.split(' ').slice(0, 2).join(' '))).toEqual([
      'pass first',
      'pass middle',
      'pass last',
    ])
    expect(log.filter((line) => line.startsWith('release'))).toHaveLength(9)
  })
})
