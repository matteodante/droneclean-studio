// @vitest-environment node
// A stabilized clip replaced by another of the same file and settings (task 11.1): the real client on the fake Gyroflow
// worker, the real engine host, stabilization stage, preparer and pipeline, over a fake device and a fake warp. The
// timeline is a list the host and the preparer both follow, as the page's items store feeds them. What happened through
// the SDK on 19 Nov 2026: the host closed the engine with the last clip that opened it, the preparer kept the key ready
// because the new clip wants it, and the new clip's export frame waited for an engine nobody opened (or, opened by the
// clip panel, threw "the warp was not prepared on this device").

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { SourceFrame, SourceFrameProvider } from '@/studio/render/frames/types'
import { createStabilizationClient } from '@/studio/stabilization/client'
import { createMotionCache } from '@/studio/stabilization/motion-cache'
import { createStabilizationSeat } from '@/studio/stabilization/seat'
import { METHODS, fakeWorker, type FakeWorker } from '@/studio/stabilization/__fixtures__/fake-gyro-worker'
import { stabilizationDefaults } from '@/studio/stabilization/settings'
import type { StabilizationStage } from '@/studio/stabilization/stage'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import { createDerivedSizeStore } from './derived-sizes'
import { createStagePipeline } from './pipeline'
import { createPreparer } from './preparer'
import { createStageRegistry } from './registry'
import { createStabilizeStage } from './stabilize'
import type { SourceStage, StageId } from './types'

const { createStageMock } = vi.hoisted(() => ({ createStageMock: vi.fn() }))
vi.mock('@/studio/stabilization/stage', () => ({ createStabilizationStage: createStageMock }))

const FILE = new File([new Uint8Array(8)], 'DJI_20261115124704_0020_D.MP4')

/** A clip of clip 0020's file, stabilized with the defaults */
function clip(id: string): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    label: id,
    mediaId: 'media-0020',
    src: 'blob:0020',
    from: 0,
    durationInFrames: 120,
    sourceFps: 60000 / 1001,
    sourceStart: 0,
    sourceDuration: 13_839,
    stabilization: { ...stabilizationDefaults(METHODS), enabled: true },
  } as VideoItem
}

function fakeDevice(): GPUDevice {
  return {
    lost: new Promise(() => undefined),
    createTexture: (descriptor: GPUTextureDescriptor) => {
      const size = descriptor.size as { width: number; height: number }
      return {
        width: size.width,
        height: size.height,
        format: descriptor.format,
        destroy: () => undefined,
        createView: () => ({}),
      }
    },
    createBuffer: () => ({ destroy: () => undefined }),
    createCommandEncoder: () => ({ copyTextureToTexture: () => undefined, finish: () => ({}) }),
    queue: { writeBuffer: () => undefined, submit: () => undefined, onSubmittedWorkDone: async () => undefined },
  } as unknown as GPUDevice
}

function fakeProvider(): SourceFrameProvider {
  const texture = { width: 3840, height: 2880, format: 'rgba16float', createView: () => ({}) } as unknown as GPUTexture
  return {
    frameAt: async (_item: VideoItem, index: number): Promise<SourceFrame> => ({
      texture,
      index,
      width: 3840,
      height: 2880,
      origin: 'webcodecs',
    }),
    lookahead: () => undefined,
    release: () => undefined,
    destroy: () => undefined,
  } as unknown as SourceFrameProvider
}

/** A stage the registry needs in its place that no clip here uses */
function idle(id: StageId, scope: SourceStage['scope']): SourceStage {
  return {
    id,
    scope,
    active: () => false,
    key: () => id,
    outputSize: (_item, input) => input,
    prepare: async () => undefined,
    ready: () => true,
    encode: () => undefined,
  }
}

/** The page's pieces over the fake worker; `order` is which of the two the items store tells first */
async function session(order: 'host-first' | 'preparer-first') {
  const workers: FakeWorker[] = []
  const warps: string[] = []
  createStageMock.mockReset()
  createStageMock.mockImplementation(async () => ({
    warp: (_encoder: unknown, _input: unknown, _output: unknown, frame: { sourceFrame: number }) =>
      warps.push(`warp ${frame.sourceFrame}`),
  }) as unknown as StabilizationStage)
  const seat = createStabilizationSeat({
    createClient: () =>
      createStabilizationClient({
        createWorker: () => {
          const worker = fakeWorker()
          workers.push(worker)
          return worker as unknown as Worker
        },
        recomputeDelayMs: 1,
        motionCache: createMotionCache({ store: null }),
      }),
    loadFile: async () => FILE,
    projectFps: () => 60,
  })
  const device = fakeDevice()
  const sizes = createDerivedSizeStore()
  const registry = createStageRegistry([
    createStabilizeStage({ sizes, host: () => seat }),
    idle('input-colour', 'source-frame'),
    idle('look', 'output-frame'),
  ])
  const followers = new Set<(items: readonly TimelineItem[]) => void>()
  const preparer = createPreparer({
    registry,
    sizes,
    getDevice: async () => device,
    watchItems: async (listener) => {
      followers.add(listener)
      return () => followers.delete(listener)
    },
  })
  await preparer.start()
  const pipeline = createStagePipeline({ device, mode: 'export', registry, preparer, provider: fakeProvider() })
  /** One change of the timeline's items, as one store update reaches both followers */
  const setItems = (items: readonly TimelineItem[]): void => {
    if (order === 'host-first') seat.sync(items)
    for (const follow of followers) follow(items)
    if (order === 'preparer-first') seat.sync(items)
  }
  /** Settles the background work a change starts: the preparer's device, the engine's replies */
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 50; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { seat, preparer, pipeline, setItems, settle, workers, warps, destroy: () => seat.destroy() }
}

/** The export's frame of a clip, or the reason it did not come within a second */
async function exportFrame(
  pipeline: ReturnType<typeof createStagePipeline>,
  item: VideoItem,
  sourceIndex: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stuck = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('stuck: the frame never came'), 1000)
  })
  try {
    return await Promise.race([
      pipeline.render(item, sourceIndex).then(
        (staged) => staged.kind,
        (error: unknown) => `failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
      stuck,
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('a stabilized clip replaced by one of the same file and settings', () => {
  let destroy: (() => void) | undefined
  afterEach(() => destroy?.())

  for (const order of ['host-first', 'preparer-first'] as const) {
    describe(`(the store tells the ${order === 'host-first' ? 'host' : 'preparer'} first)`, () => {
      it('renders the new clip when the old one leaves and it comes in one transaction', async () => {
        const page = await session(order)
        destroy = page.destroy
        page.setItems([clip('clip-a')])
        await page.settle()
        expect(await exportFrame(page.pipeline, clip('clip-a'), 10)).toBe('fresh')

        page.setItems([clip('clip-b')])
        await page.settle()
        expect(await exportFrame(page.pipeline, clip('clip-b'), 11)).toBe('fresh')
        expect(page.warps).toEqual(['warp 10', 'warp 11'])
        // The new clip took the engine over: the file was not opened a second time
        expect(page.workers).toHaveLength(1)
      })

      it('renders the new clip when the old one leaves in one transaction and it comes in the next', async () => {
        const page = await session(order)
        destroy = page.destroy
        page.setItems([clip('clip-a')])
        await page.settle()
        expect(await exportFrame(page.pipeline, clip('clip-a'), 10)).toBe('fresh')

        // Two store updates in one go, as a script that awaits nothing between them makes them
        page.setItems([])
        page.setItems([clip('clip-b')])
        await page.settle()
        expect(await exportFrame(page.pipeline, clip('clip-b'), 11)).toBe('fresh')
        expect(page.warps).toEqual(['warp 10', 'warp 11'])
        // No clip used the engine between the two: it was closed, and opened again for the new clip
        expect(page.workers).toHaveLength(2)
        expect(page.workers[0]!.terminated).toBe(true)
      })

      it('renders the new clip when the clip panel opens its engine after the replacement', async () => {
        const page = await session(order)
        destroy = page.destroy
        page.setItems([clip('clip-a')])
        await page.settle()
        expect(await exportFrame(page.pipeline, clip('clip-a'), 10)).toBe('fresh')

        // The clip panel (or the SDK's setStabilization) shows the new clip: it probes it, which opens its engine
        page.setItems([clip('clip-b')])
        expect((await page.seat.open(clip('clip-b'), { retry: true })).kind).toBe('ready')
        await page.settle()
        expect(await exportFrame(page.pipeline, clip('clip-b'), 11)).toBe('fresh')
        expect(page.warps).toEqual(['warp 10', 'warp 11'])
        expect(page.workers).toHaveLength(1)
      })
    })
  }
})
