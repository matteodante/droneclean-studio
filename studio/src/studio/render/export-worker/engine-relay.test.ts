// The page's stabilization host reached from the export worker through a real `MessageChannel`: the page side is the
// real host (`createStabilizationSeat`) over a fake Gyroflow client, the worker side the relayed host and the real
// stabilization stage reading it (design 3.6 section 2.15, finding S7).

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDerivedSizeStore, derivedSizeKey } from '@/studio/render/stages/derived-sizes'
import { createStabilizeStage } from '@/studio/render/stages/stabilize'
import { StageError, isNotReady } from '@/studio/render/stages/types'
import {
  NoMotionDataError,
  type StabilizationClient,
  type StabilizationInfo,
} from '@/studio/stabilization/client'
import { stabilizationEngineKey } from '@/studio/stabilization/engine-key'
import { createStabilizationSeat, type StabilizationSeat } from '@/studio/stabilization/seat'
import type { StabilizationAssets } from '@/studio/stabilization/stage'
import type { VideoItem } from '@/types/timeline'
import { createRelayedStabilizationHost, serveStabilizationHost } from './engine-relay'

const INFO: StabilizationInfo = {
  input: [3840, 2880],
  output: [3840, 2160],
  fps: 59.94,
  frames: 100,
  orientations: 461_674,
  smoothed_orientations: 100,
  lens: 'DJI_Avata2',
  frame_readout_time_ms: 0,
  min_fov: 1,
  fovs: 100,
  bytes_read: 1_896_500_750,
}

const ASSETS: StabilizationAssets = {
  kernelWgsl: 'kernel',
  lensWgsl: 'lens',
  digitalLensWgsl: 'digital',
  coeffs: new Float32Array(496).fill(0.25),
  interpolation: 2,
}

function clip(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    label: 'DJI_0020',
    mediaId: 'media-1',
    src: 'blob:clip',
    from: 0,
    durationInFrames: 120,
    sourceFps: 59.94,
    sourceStart: 0,
    sourceDuration: 100,
    stabilization: {
      enabled: true,
      method: 'Default',
      params: { smoothness: 0.5 },
      fov: 1,
      horizonLockPercent: 0,
      horizonLockRoll: 0,
      adaptiveZoomSeconds: 4,
    },
    ...overrides,
  } as VideoItem
}

function fakeClient(overrides: Partial<StabilizationClient> = {}) {
  const open = vi.fn(async () => INFO)
  const getFrameData = vi.fn(async (_id: string, sourceFrame: number) => ({
    matrices: new Float32Array(16).fill(sourceFrame),
    params: new Uint8Array(416),
    mesh: new Float32Array(0),
    sourceFrame,
  }))
  const client = {
    open,
    isOpen: vi.fn(() => true),
    lensProfile: vi.fn(async () => ({ name: 'DJI_Avata2', model: 'opencv_fisheye' })),
    loadLensProfile: vi.fn(),
    stageAssets: vi.fn(async () => ASSETS),
    smoothingMethods: vi.fn(async () => []),
    getFrameData,
    peekFrame: vi.fn(() => undefined),
    slideWindow: vi.fn(),
    fetchFrames: vi.fn(async () => []),
    setSettings: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    destroy: vi.fn(),
    ...overrides,
  } as unknown as StabilizationClient
  return { client, open, getFrameData }
}

const open: Array<() => void> = []

/** The page's host served on one end of a channel, the relayed host on the other */
function relay(client: StabilizationClient) {
  const page = createStabilizationSeat({
    createClient: () => client,
    loadFile: async () => ({ name: 'clip.mp4', size: 10 }) as File,
    projectFps: () => 60,
  })
  const channel = new MessageChannel()
  const stop = serveStabilizationHost(channel.port1, page)
  const worker = createRelayedStabilizationHost(channel.port2)
  open.push(() => {
    stop()
    worker.destroy()
    page.destroy()
  })
  return { page, worker, stop }
}

afterEach(() => {
  for (const close of open.splice(0)) close()
})

describe('the relayed stabilization host', () => {
  it('opens through the page’s host, which opens the file once for the page and the worker', async () => {
    const { client, open: openSpy } = fakeClient()
    const { page, worker } = relay(client)
    const item = clip()
    const key = stabilizationEngineKey(item)!
    await page.open(item)
    expect(worker.engineState(key)).toEqual({ status: 'absent' })

    const opening = worker.open(item, { retry: true })
    expect(worker.engineState(key).status).toBe('opening')
    const result = await opening
    expect(result.kind).toBe('ready')
    expect(worker.engineState(key)).toEqual({ status: 'ready', info: INFO })
    expect(worker.outputSizeOf(key)).toEqual({ width: 3840, height: 2160 })
    // The engine the page had open answered: the file was read once
    expect(openSpy).toHaveBeenCalledTimes(1)
    // A second ask joins the first
    expect(await worker.open(item, { retry: true })).toBe(result)
  })

  it('serves a frame’s data by integer source frame, and the frames after it ahead of the ask', async () => {
    const { client, getFrameData } = fakeClient()
    const { worker } = relay(client)
    const item = clip()
    const key = stabilizationEngineKey(item)!
    await worker.open(item)
    expect(worker.frame(key, 10)).toBeUndefined()
    await worker.requestFrame(key, 10)
    const frame = worker.frame(key, 10)
    expect(frame?.sourceFrame).toBe(10)
    expect(Array.from(frame!.matrices.slice(0, 2))).toEqual([10, 10])
    await vi.waitFor(() => expect(worker.frame(key, 18)?.sourceFrame).toBe(18))
    expect(worker.frame(key, 19)).toBeUndefined()
    const asked = getFrameData.mock.calls.map((call) => call[1])
    expect(asked).toEqual(expect.arrayContaining([10, 11, 12, 13, 14, 15, 16, 17, 18]))
  })

  it('stops the lookahead at the source’s last frame', async () => {
    const { client, getFrameData } = fakeClient()
    const { worker } = relay(client)
    const item = clip()
    const key = stabilizationEngineKey(item)!
    await worker.open(item)
    await worker.requestFrame(key, 97)
    await vi.waitFor(() => expect(worker.frame(key, 99)).toBeDefined())
    expect(getFrameData.mock.calls.map((call) => call[1]).sort()).toEqual([97, 98, 99])
  })

  it('reads the assets once and hands the same object back synchronously, as the warp cache needs', async () => {
    const { client } = fakeClient()
    const { worker } = relay(client)
    const item = clip()
    const key = stabilizationEngineKey(item)!
    await worker.open(item)
    expect(worker.loadedAssets(key)).toBeUndefined()
    const assets = await worker.stageAssets(key)
    expect(assets.kernelWgsl).toBe('kernel')
    // Node's channel clones into Node's own realm, not the test environment's: the type is checked by name
    expect(assets.coeffs.constructor.name).toBe('Float32Array')
    expect(assets.coeffs[0]).toBe(0.25)
    expect(worker.loadedAssets(key)).toBe(assets)
    expect(await worker.stageAssets(key)).toBe(assets)
  })

  it('keeps the assets until the worker lets the key go: what its warp was prepared on lasts that long', async () => {
    const { client } = fakeClient()
    const { worker } = relay(client)
    const item = clip()
    const key = stabilizationEngineKey(item)!
    await worker.open(item)
    let gone = false
    await worker.whenAssetsGone(key)
    await worker.stageAssets(key)
    void worker.whenAssetsGone(key).then(() => (gone = true))
    await Promise.resolve()
    expect(gone).toBe(false)
    await worker.release(key)
    await vi.waitFor(() => expect(gone).toBe(true))
  })

  it('reports an open that failed on the page as the worker’s failed state, with the page’s message', async () => {
    const { client } = fakeClient({
      open: vi.fn(async () => {
        throw new NoMotionDataError()
      }),
    })
    const { worker } = relay(client)
    const item = clip()
    const key = stabilizationEngineKey(item)!
    const result = await worker.open(item, { retry: true })
    expect(result.kind).toBe('no-motion-data')
    expect(result.kind !== 'ready' && 'error' in result && result.error).toBeInstanceOf(
      NoMotionDataError,
    )
    expect(worker.outputSizeOf(key)).toBeNull()
  })

  it('reports a frame the engine could not answer as that frame’s failure', async () => {
    const { client } = fakeClient({
      getFrameData: vi.fn(async (_id: string, sourceFrame: number) => {
        if (sourceFrame === 42) throw new Error('frame 42 is past the motion data')
        return { matrices: new Float32Array(16), params: new Uint8Array(416), mesh: new Float32Array(0), sourceFrame }
      }) as unknown as StabilizationClient['getFrameData'],
    })
    const { worker } = relay(client)
    const item = clip()
    const key = stabilizationEngineKey(item)!
    await worker.open(item)
    await worker.requestFrame(key, 42)
    expect(worker.frame(key, 42)).toBeUndefined()
    expect(worker.takeFrameFailure(key, 42)?.message).toBe('frame 42 is past the motion data')
    expect(worker.takeFrameFailure(key, 42)).toBeUndefined()
  })

  it('fails a frame whose engine the page closed during the export, instead of asking for it forever', async () => {
    const { client } = fakeClient()
    const { page, worker } = relay(client)
    const item = clip()
    const key = stabilizationEngineKey(item)!
    await worker.open(item)
    await page.release(key)
    await worker.requestFrame(key, 5)
    expect(worker.takeFrameFailure(key, 5)?.message).toMatch(/closed while the export read it/)
  })

  it('leaves the page’s engine open when the worker lets go, and refuses to change settings', async () => {
    const { client } = fakeClient()
    const { page, worker } = relay(client)
    const item = clip()
    const key = stabilizationEngineKey(item)!
    await worker.open(item)
    await worker.release(key)
    await worker.close(item.id)
    worker.sync([])
    expect(worker.engineState(key)).toEqual({ status: 'absent' })
    expect(page.engineState(key).status).toBe('ready')
    expect(client.close).not.toHaveBeenCalled()
    await expect(worker.setSettings(item, item.stabilization!)).rejects.toThrow(/changes no settings/)
  })

  it('rejects what is in flight when the worker’s host is destroyed, and asks nothing after', async () => {
    let answer!: () => void
    const { client } = fakeClient({
      open: vi.fn(
        () =>
          new Promise<StabilizationInfo>((resolve) => {
            answer = () => resolve(INFO)
          }),
      ),
    })
    const { worker } = relay(client)
    const item = clip()
    const opening = worker.open(item)
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    worker.destroy()
    const result = await opening
    expect(result.kind).toBe('failed')
    expect(result.kind === 'failed' && result.error.message).toMatch(/host is closed/)
    answer()
    const again = await worker.open(clip({ mediaId: 'media-2' }))
    expect(again.kind).toBe('failed')
  })
})

describe('the stabilization stage over the relay', () => {
  function stageOver(worker: StabilizationSeat) {
    const sizes = createDerivedSizeStore()
    return { sizes, stage: createStabilizeStage({ sizes, host: () => worker }) }
  }

  it('waits for a frame’s data from the page, then draws it', async () => {
    const { client } = fakeClient()
    const { worker } = relay(client)
    const { stage } = stageOver(worker)
    const item = clip()
    await worker.open(item)
    const first = stage.ready(item, 7)
    expect(isNotReady(first)).toBe(true)
    if (isNotReady(first)) await first.ready
    expect(stage.ready(item, 7)).toBe(true)
  })

  it('reads the size the page passed before the stage prepared anything', () => {
    const { client } = fakeClient()
    const { worker } = relay(client)
    const { sizes, stage } = stageOver(worker)
    const item = clip()
    sizes.set(derivedSizeKey('stabilize', stabilizationEngineKey(item)!), {
      width: 3840,
      height: 2160,
    })
    expect(stage.outputSize(item, { width: 3840, height: 2880 })).toEqual({
      width: 3840,
      height: 2160,
    })
  })

  it('throws the page’s failure as a StageError naming the clip, the stage and the frame', async () => {
    const { client } = fakeClient({
      getFrameData: vi.fn(async () => {
        throw new Error('the engine stopped')
      }) as unknown as StabilizationClient['getFrameData'],
    })
    const { worker } = relay(client)
    const { stage } = stageOver(worker)
    const item = clip()
    await worker.open(item)
    const first = stage.ready(item, 3)
    if (isNotReady(first)) await first.ready
    let thrown: unknown
    try {
      stage.ready(item, 3)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(StageError)
    expect((thrown as StageError).message).toBe(
      "Clip 'DJI_0020', stabilization, source frame 3: the engine stopped",
    )
  })
})
