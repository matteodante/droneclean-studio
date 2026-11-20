// The engine host's unit tests, at the client's mock boundary: one engine per (media, settings), the open's result as
// data, the move of a clip's engine to new settings in place, failure as state with a retry, frames served by integer
// source frame, and the engine let go when no clip uses it (design 3.6 sections 2.2 and 2.9; findings S3, S4, S5, S7).

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import {
  ClipUnreadableError,
  InvalidSettingsError,
  NoLensProfileError,
  NoMotionDataError,
  type StabilizationClient,
  type StabilizationInfo,
} from './client'
import type { StabilizationAssets, StabilizationFrame, StabilizationStage } from './stage'
import { setStabilizationProjectFrame, stabilizationEngineKey } from './engine-key'
import { createStabilizationSeat, watchTimelineItems } from './seat'

const { createStageMock, getMediaMock, getMediaFileMock } = vi.hoisted(() => ({
  createStageMock: vi.fn(),
  getMediaMock: vi.fn(async () => null),
  getMediaFileMock: vi.fn(async () => null),
}))
vi.mock('./stage', () => ({ createStabilizationStage: createStageMock }))
vi.mock('@/features/media-library/services/media-library-service', () => ({
  mediaLibraryService: { getMedia: getMediaMock, getMediaFile: getMediaFileMock },
}))

const INFO: StabilizationInfo = {
  input: [3840, 2880],
  output: [3840, 2160],
  fps: 59.94,
  frames: 13_839,
  orientations: 461_674,
  smoothed_orientations: 13_839,
  lens: 'DJI_Avata2___4k_4by3_3840x2880-0.00fps',
  frame_readout_time_ms: 0,
  min_fov: 1,
  fovs: 13_839,
  bytes_read: 1_896_500_750,
}

const ASSETS: StabilizationAssets = {
  kernelWgsl: 'kernel',
  lensWgsl: 'lens',
  digitalLensWgsl: 'digital',
  coeffs: new Float32Array(496),
  interpolation: 2,
}

const FRAME: StabilizationFrame = {
  matrices: new Float32Array(16),
  params: new Uint8Array(416),
  mesh: new Float32Array(0),
}

function clip(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    label: 'clip',
    mediaId: 'media-1',
    src: 'blob:clip',
    from: 0,
    durationInFrames: 120,
    sourceFps: 59.94,
    sourceStart: 0,
    sourceDuration: 13_839,
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

function withFov(item: VideoItem, fov: number): VideoItem {
  return { ...item, stabilization: { ...item.stabilization!, fov } } as VideoItem
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

const FILE = { name: 'clip.mp4', size: 10 } as File

function fakeClient(overrides: Partial<StabilizationClient> = {}) {
  const open = vi.fn(async () => INFO)
  const getFrameData = vi.fn(async (_id: string, sourceFrame: number) => ({
    ...FRAME,
    sourceFrame,
  }))
  const lensProfile = vi.fn(async () => ({ name: 'lens', model: 'opencv_fisheye' }))
  const setSettings = vi.fn(async () => undefined)
  const close = vi.fn(async () => undefined)
  const client = {
    open,
    isOpen: vi.fn(() => false),
    infoOf: vi.fn(() => null),
    lensProfile,
    loadLensProfile: vi.fn(),
    stageAssets: vi.fn(async () => ASSETS),
    smoothingMethods: vi.fn(async () => []),
    getFrameData,
    setSettings,
    close,
    destroy: vi.fn(),
    ...overrides,
  } as unknown as StabilizationClient
  return { client, open, getFrameData, lensProfile, setSettings, close }
}

function host(client: StabilizationClient) {
  return createStabilizationSeat({
    createClient: () => client,
    loadFile: async () => FILE,
    projectFps: () => 60,
  })
}

beforeEach(() => {
  setStabilizationProjectFrame(undefined)
  vi.clearAllMocks()
  getMediaMock.mockResolvedValue(null)
  getMediaFileMock.mockResolvedValue(null)
  createStageMock.mockResolvedValue({ warp: vi.fn() } as unknown as StabilizationStage)
})

describe('the engine key', () => {
  it('keys an engine by media and settings, not by clip, and not by the switch', () => {
    const a = stabilizationEngineKey(clip({ id: 'a' }))
    expect(stabilizationEngineKey(clip({ id: 'b' }))).toBe(a)
    expect(stabilizationEngineKey(withFov(clip(), 1.2))).not.toBe(a)
    expect(stabilizationEngineKey(clip({ mediaId: 'media-2' }))).not.toBe(a)
    const off = clip({ stabilization: { ...clip().stabilization!, enabled: false } })
    expect(stabilizationEngineKey(off)).toBe(a)
    expect(stabilizationEngineKey(clip({ mediaId: undefined }))).toBeNull()
  })
})

describe('the open', () => {
  it('opens a key once for two clips, and reports the size without writing anything to an item', async () => {
    const { client, open } = fakeClient()
    const seat = host(client)
    const [a, b] = await Promise.all([
      seat.open(clip({ id: 'a' })),
      seat.open(clip({ id: 'b' })),
    ])
    expect(open).toHaveBeenCalledTimes(1)
    expect(a).toMatchObject({ kind: 'ready', info: INFO })
    expect(b).toBe(a)
    const key = stabilizationEngineKey(clip())!
    expect(seat.outputSizeOf(key)).toEqual({ width: 3840, height: 2160 })
    expect(seat.engineState(key)).toMatchObject({ status: 'ready' })
  })

  it('tells ready, no lens profile, no motion data and failure apart, with the typed error', async () => {
    const noLens = fakeClient({
      lensProfile: vi.fn(async () => {
        throw new NoLensProfileError()
      }),
    })
    expect(await host(noLens.client).open(clip())).toMatchObject({
      kind: 'no-lens-profile',
      info: INFO,
      error: expect.any(NoLensProfileError),
    })

    const noMotion = fakeClient({ open: vi.fn(async () => ({ ...INFO, orientations: 0 })) })
    expect(await host(noMotion.client).open(clip())).toMatchObject({
      kind: 'no-motion-data',
      error: expect.any(NoMotionDataError),
    })
    expect(noMotion.close).toHaveBeenCalled()

    const throwsNoMotion = fakeClient({
      open: vi.fn(async () => {
        throw new NoMotionDataError()
      }),
    })
    expect((await host(throwsNoMotion.client).open(clip())).kind).toBe('no-motion-data')

    const unreadable = fakeClient({
      open: vi.fn(async () => {
        throw new ClipUnreadableError('broken')
      }),
    })
    const failed = await host(unreadable.client).open(clip())
    expect(failed).toMatchObject({ kind: 'failed', error: expect.any(ClipUnreadableError) })
  })

  it('reports the open’s progress, and tells a late caller the last report', async () => {
    const gate = deferred<StabilizationInfo>()
    const progress = { bytesRead: 5, fileSize: 10, phase: 'reading' as const, orientations: null }
    const open = vi.fn(async (_clip: unknown, _settings: unknown, onProgress?: (p: typeof progress) => void) => {
      onProgress?.(progress)
      return gate.promise
    })
    const seat = host(fakeClient({ open } as never).client)
    const first: unknown[] = []
    const late: unknown[] = []
    const opening = seat.open(clip(), { onProgress: (p) => first.push(p) })
    await vi.waitFor(() => expect(first).toHaveLength(1))
    void seat.open(clip(), { onProgress: (p) => late.push(p) })
    expect(late).toEqual([progress])
    gate.resolve(INFO)
    await opening
  })

  it('does not make a clip without a file or settings wait: it fails with a typed error', async () => {
    const seat = host(fakeClient().client)
    expect(await seat.open(clip({ mediaId: undefined }))).toMatchObject({
      kind: 'failed',
      error: expect.any(ClipUnreadableError),
    })
  })

  it('reads a worker’s clip from its blob URL when the media library has no file', async () => {
    const blob = new Blob(['x'], { type: 'video/mp4' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blob })))
    const { client, open } = fakeClient()
    const seat = createStabilizationSeat({ createClient: () => client, projectFps: () => 60 })
    await seat.open(clip())
    vi.unstubAllGlobals()
    const file = (open.mock.calls[0] as unknown as [{ file: File }])[0].file
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('clip')
  })
})

describe('a failed open is state with a retry', () => {
  it('stays failed for the same key, is opened again on retry, and is a fresh try for new settings', async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new ClipUnreadableError('disk'))
      .mockResolvedValue(INFO)
    const seat = host(fakeClient({ open } as never).client)
    const key = stabilizationEngineKey(clip())!
    expect((await seat.open(clip())).kind).toBe('failed')
    expect(seat.engineState(key).status).toBe('failed')
    // no automatic retry from a second ask
    expect((await seat.open(clip())).kind).toBe('failed')
    expect(open).toHaveBeenCalledTimes(1)
    expect((await seat.open(clip(), { retry: true })).kind).toBe('ready')
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('a refused setting is a failure of that key only; the engine stays and a later setting moves it', async () => {
    const setSettings = vi
      .fn()
      .mockRejectedValueOnce(new InvalidSettingsError('fov'))
      .mockResolvedValue(undefined)
    const { client } = fakeClient({ setSettings } as never)
    const seat = host(client)
    const base = clip()
    await seat.open(base)
    const refused = seat.open(withFov(base, 9))
    expect((await refused).kind).toBe('failed')
    expect((await seat.open(withFov(base, 1.1))).kind).toBe('ready')
    expect(setSettings).toHaveBeenCalledTimes(2)
  })
})

describe('settings follow the clip', () => {
  it('move the clip’s engine in place when it is the key’s only user: one open, one recompute', async () => {
    const { client, open, setSettings, close } = fakeClient()
    const seat = host(client)
    const base = clip()
    await seat.open(base)
    const oldKey = stabilizationEngineKey(base)!
    const moved = withFov(base, 1.3)
    const newKey = stabilizationEngineKey(moved)!
    const pending = seat.open(moved)
    // the size is known at once, before the recompute is over (the layout does not jump)
    expect(seat.outputSizeOf(newKey)).toEqual({ width: 3840, height: 2160 })
    expect(seat.engineState(oldKey).status).toBe('absent')
    expect(seat.engineState(newKey).status).toBe('opening')
    expect((await pending).kind).toBe('ready')
    expect(open).toHaveBeenCalledTimes(1)
    expect(setSettings).toHaveBeenCalledWith(expect.any(String), moved.stabilization)
    expect(close).not.toHaveBeenCalled()
  })

  it('move the clip’s engine to the new frame when the project’s aspect changes, and take the size the engine then reports', async () => {
    setStabilizationProjectFrame({ width: 1920, height: 1080 })
    const infoOf = vi.fn(() => ({ ...INFO, output: [3840, 2880] as [number, number] }))
    const { client, open, setSettings } = fakeClient({ infoOf })
    const seat = host(client)
    const base = clip()
    await seat.open(base)
    const wideKey = stabilizationEngineKey(base)!
    expect(seat.outputSizeOf(wideKey)).toEqual({ width: 3840, height: 2160 })

    // The project becomes 4:3: the clip's key is another one, and the timeline's next change (or the session) syncs
    setStabilizationProjectFrame({ width: 1440, height: 1080 })
    const tallKey = stabilizationEngineKey(base)!
    expect(tallKey).not.toBe(wideKey)
    seat.sync([base])
    await seat.whenSettled(tallKey)

    expect(open).toHaveBeenCalledTimes(1)
    expect(setSettings).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outputAspect: { width: 4, height: 3 } }),
    )
    expect(seat.engineState(wideKey).status).toBe('absent')
    expect(seat.outputSizeOf(tallKey)).toEqual({ width: 3840, height: 2880 })
  })

  it('give a second clip of the same file its own engine when one of two sharing changes', async () => {
    const { client, open } = fakeClient()
    const seat = host(client)
    await seat.open(clip({ id: 'a' }))
    await seat.open(clip({ id: 'b' }))
    await seat.open(withFov(clip({ id: 'b' }), 1.2))
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('setSettings resolves when the frames are the new settings’, rejects with the engine’s error, and lets a switched-off clip go', async () => {
    const setSettings = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new InvalidSettingsError('bad'))
    const { client, close } = fakeClient({ setSettings } as never)
    const seat = host(client)
    const base = clip()
    await seat.open(base)
    await seat.setSettings(base, withFov(base, 1.4).stabilization!)
    await expect(seat.setSettings(base, withFov(base, 1.5).stabilization!)).rejects.toBeInstanceOf(
      InvalidSettingsError,
    )
    await seat.setSettings(base, { ...base.stabilization!, enabled: false })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('drop the old settings’ frames: a frame fetched before a move is not served after it', async () => {
    const gate = deferred<{ sourceFrame: number }>()
    const getFrameData = vi.fn(async () => ({ ...FRAME, ...(await gate.promise) }))
    const { client } = fakeClient({ getFrameData } as never)
    const seat = host(client)
    const base = clip()
    await seat.open(base)
    const oldKey = stabilizationEngineKey(base)!
    const fetching = seat.requestFrame(oldKey, 7)
    const moved = withFov(base, 1.3)
    await seat.open(moved)
    gate.resolve({ sourceFrame: 7 })
    await fetching
    expect(seat.frame(stabilizationEngineKey(moved)!, 7)).toBeUndefined()
  })
})

describe('frames', () => {
  it('are asked by integer source frame, held, and a failure is read once', async () => {
    const getFrameData = vi
      .fn()
      .mockResolvedValueOnce({ ...FRAME, sourceFrame: 1000 })
      .mockRejectedValueOnce(new Error('no answer'))
    const { client } = fakeClient({ getFrameData } as never)
    const seat = host(client)
    await seat.open(clip())
    const key = stabilizationEngineKey(clip())!
    await Promise.all([seat.requestFrame(key, 1000), seat.requestFrame(key, 1000)])
    expect(getFrameData).toHaveBeenCalledTimes(1)
    expect(getFrameData).toHaveBeenCalledWith(expect.any(String), 1000, { wait: true })
    expect(seat.frame(key, 1000)?.sourceFrame).toBe(1000)
    await seat.requestFrame(key, 1001)
    expect(seat.frame(key, 1001)).toBeUndefined()
    expect(seat.takeFrameFailure(key, 1001)?.message).toBe('no answer')
    expect(seat.takeFrameFailure(key, 1001)).toBeUndefined()
  })

  it('are not asked of an engine that is not open', async () => {
    const { client, getFrameData } = fakeClient()
    const seat = host(client)
    await seat.requestFrame('unknown', 3)
    expect(getFrameData).not.toHaveBeenCalled()
  })

  it('whenSettled waits for an engine that has not been opened yet', async () => {
    const seat = host(fakeClient().client)
    let settled = false
    const waiting = seat.whenSettled(stabilizationEngineKey(clip())!).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await seat.open(clip())
    await waiting
    expect(settled).toBe(true)
  })

  it('give the warp assets of the key’s lens model, and remember them synchronously', async () => {
    const seat = host(fakeClient().client)
    await seat.open(clip())
    const key = stabilizationEngineKey(clip())!
    expect(seat.loadedAssets(key)).toBeUndefined()
    expect(await seat.stageAssets(key)).toBe(ASSETS)
    expect(seat.loadedAssets(key)).toBe(ASSETS)
  })
})

describe('the assets a warp was prepared on', () => {
  /** Whether the promise has resolved, after the microtasks queued so far */
  async function resolved(promise: Promise<void>): Promise<boolean> {
    let done = false
    void promise.then(() => (done = true))
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
    return done
  }

  it('are gone at once for a key with no engine, or an engine whose assets were not read', async () => {
    const seat = host(fakeClient().client)
    const key = stabilizationEngineKey(clip())!
    expect(await resolved(seat.whenAssetsGone(key))).toBe(true)
    await seat.open(clip())
    expect(await resolved(seat.whenAssetsGone(key))).toBe(true)
    await seat.stageAssets(key)
    expect(await resolved(seat.whenAssetsGone(key))).toBe(false)
  })

  it('go when the timeline lets the engine go, not before', async () => {
    const seat = host(fakeClient().client)
    const key = stabilizationEngineKey(clip())!
    await seat.open(clip())
    await seat.stageAssets(key)
    const gone = seat.whenAssetsGone(key)
    seat.sync([clip()])
    expect(await resolved(gone)).toBe(false)
    seat.sync([])
    expect(await resolved(gone)).toBe(true)
  })

  it('go when the engine moves to other settings; the new key has none until they are read', async () => {
    const seat = host(fakeClient().client)
    const key = stabilizationEngineKey(clip())!
    await seat.open(clip())
    await seat.stageAssets(key)
    const gone = seat.whenAssetsGone(key)
    const moved = withFov(clip(), 1.3)
    await seat.open(moved)
    expect(await resolved(gone)).toBe(true)
    const newKey = stabilizationEngineKey(moved)!
    expect(await resolved(seat.whenAssetsGone(newKey))).toBe(true)
    await seat.stageAssets(newKey)
    expect(await resolved(seat.whenAssetsGone(newKey))).toBe(false)
  })

  it('go when the key is released or the host destroyed', async () => {
    const seat = host(fakeClient().client)
    const first = clip()
    const second = clip({ id: 'clip-2', mediaId: 'media-2' })
    await seat.open(first)
    await seat.open(second)
    await seat.stageAssets(stabilizationEngineKey(first)!)
    await seat.stageAssets(stabilizationEngineKey(second)!)
    const released = seat.whenAssetsGone(stabilizationEngineKey(first)!)
    const destroyed = seat.whenAssetsGone(stabilizationEngineKey(second)!)
    await seat.release(stabilizationEngineKey(first)!)
    expect(await resolved(released)).toBe(true)
    expect(await resolved(destroyed)).toBe(false)
    seat.destroy()
    expect(await resolved(destroyed)).toBe(true)
  })
})

describe('an engine no clip uses', () => {
  it('is closed when its clip is deleted from the timeline', async () => {
    const { client, close } = fakeClient()
    const seat = host(client)
    await seat.open(clip())
    seat.sync([])
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('is closed when the clip’s stabilization is switched off', async () => {
    const { client, close } = fakeClient()
    const seat = host(client)
    await seat.open(clip())
    seat.sync([clip({ stabilization: { ...clip().stabilization!, enabled: false } })])
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('stays open while another clip still uses it, and goes with the last one', async () => {
    const { client, close } = fakeClient()
    const seat = host(client)
    await seat.open(clip({ id: 'a' }))
    await seat.open(clip({ id: 'b' }))
    seat.sync([clip({ id: 'b' })])
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()
    seat.sync([])
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('stays open for a clip of the same key the timeline brings when the clip that opened it goes', async () => {
    const { client, close, open } = fakeClient()
    const seat = host(client)
    await seat.open(clip({ id: 'a' }))
    seat.sync([clip({ id: 'b' })])
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()
    expect(seat.engineState(stabilizationEngineKey(clip())!).status).toBe('ready')
    expect((await seat.open(clip({ id: 'b' }))).kind).toBe('ready')
    expect(open).toHaveBeenCalledTimes(1)
    seat.sync([])
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('is not moved to one clip’s new settings while another clip of its key is on the timeline (a split clip)', async () => {
    const { client, open, setSettings } = fakeClient()
    const seat = host(client)
    await seat.open(clip({ id: 'a' }))
    seat.sync([clip({ id: 'a' }), clip({ id: 'b' })])
    expect((await seat.open(withFov(clip({ id: 'a' }), 1.3))).kind).toBe('ready')
    expect(open).toHaveBeenCalledTimes(2)
    expect(setSettings).not.toHaveBeenCalled()
    expect(seat.engineState(stabilizationEngineKey(clip())!).status).toBe('ready')
  })

  it('is left alone while it is still opening (a probe before the clip is switched on)', async () => {
    const gate = deferred<StabilizationInfo>()
    const { client, close } = fakeClient({ open: vi.fn(() => gate.promise) } as never)
    const seat = host(client)
    const opening = seat.open(clip())
    seat.sync([])
    expect(close).not.toHaveBeenCalled()
    gate.resolve(INFO)
    await opening
  })

  it('follows the item: sync moves a clip whose settings changed in the store', async () => {
    const { client, setSettings } = fakeClient()
    const seat = host(client)
    await seat.open(clip())
    seat.sync([withFov(clip(), 1.25)])
    await vi.waitFor(() => expect(setSettings).toHaveBeenCalledTimes(1))
  })

  it('release closes a key whoever uses it', async () => {
    const { client, close } = fakeClient()
    const seat = host(client)
    await seat.open(clip())
    const key = stabilizationEngineKey(clip())!
    await seat.release(key)
    expect(close).toHaveBeenCalledTimes(1)
    expect(seat.engineState(key).status).toBe('absent')
  })
})

describe('the page’s timeline', () => {
  it('is what the page’s host follows: each change of the items reaches it', async () => {
    const { useItemsStore } = await import('@/features/timeline/stores/items-store')
    const seen: Array<readonly TimelineItem[]> = []
    const stop = await watchTimelineItems((items) => seen.push(items))

    useItemsStore.getState().setItems([clip()])
    useItemsStore.getState().setItems([])
    stop()
    useItemsStore.getState().setItems([clip({ id: 'after' })])

    expect(seen.map((items) => items.map((item) => item.id))).toEqual([['clip-1'], []])
  })
})
