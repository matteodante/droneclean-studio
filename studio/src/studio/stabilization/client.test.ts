// @vitest-environment node

// The client's contract, on a worker that speaks the module's messages: the source frame is what every request is keyed
// by and the µs values are the module's own reference's, the 8-behind/24-ahead window slides and never asks twice, a
// gesture's changes share one recompute, closing the last clip frees the worker, and each failure a clip panel shows is
// its own type. The worker is `__fixtures__/fake-gyro-worker.ts`'s, which `worker-contract.test.ts` holds to the real one; the engine's
// own timings are measured by the stage probe, not here.

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  ClipUnreadableError,
  FRAMES_AHEAD,
  InvalidSettingsError,
  FRAMES_BEHIND,
  NoLensProfileError,
  NoMotionDataError,
  StabilizationError,
  createStabilizationClient,
  sourceFrameToMicroseconds,
  sourcePositionToMicroseconds,
  type StabilizationClip,
  type StabilizationProgress,
} from './client'
import { INFO, METHODS, RATE, fakeWorker, type FakeOptions, type FakeWorker } from './__fixtures__/fake-gyro-worker'
import { stabilizationDefaults, type EngineSettings, type StabilizationSettings } from './settings'

const SETTINGS = stabilizationDefaults(METHODS)

const CLIP: StabilizationClip = {
  id: 'clip-1',
  mediaId: 'media-1',
  file: new File([new Uint8Array(8)], 'DJI_20261115124704_0020_D.MP4'),
  rate: RATE,
}

interface Setup {
  client: ReturnType<typeof createStabilizationClient>
  workers: FakeWorker[]
  worker: () => FakeWorker
}

function setup(options: FakeOptions = {}, recomputeDelayMs = 5): Setup {
  const workers: FakeWorker[] = []
  const client = createStabilizationClient({
    createWorker: () => {
      const worker = fakeWorker(options)
      workers.push(worker)
      return worker as unknown as Worker
    },
    recomputeDelayMs,
  })
  return {
    client,
    workers,
    worker: () => {
      const worker = workers[0]
      if (!worker) throw new Error('no worker was started')
      return worker
    },
  }
}

/** The failures of a promise that must not resolve */
async function failure(call: Promise<unknown>): Promise<Error> {
  try {
    await call
  } catch (error) {
    return error as Error
  }
  throw new Error('the call resolved, but it should have failed')
}

describe('the source frame’s time', () => {
  it('is the module’s own reference µs for its frames', () => {
    const reference = JSON.parse(
      readFileSync(
        new URL('../../../../gyroflow/wasm/test/reference/clip-0020.json', import.meta.url),
        'utf8',
      ),
    ) as { frames: { frame: number; timestamp_us: number }[] }

    expect(
      reference.frames.map((frame) => sourceFrameToMicroseconds(RATE, frame.frame)),
    ).toEqual(reference.frames.map((frame) => frame.timestamp_us))
  })

  it('is one integer computation from the frame index, never added up', () => {
    // 60 fps is an exact rate: frame n is n/60 s, so every sixth frame is a whole number of µs
    const exact = [
      [0, 0],
      [1, 16_667],
      [2, 33_333],
      [3, 50_000],
      [6, 100_000],
      [599, 9_983_333],
    ] as const

    for (const [frame, microseconds] of exact) {
      expect(sourceFrameToMicroseconds({ num: 60, den: 1 }, frame)).toBe(microseconds)
    }
  })

  it('rejects a frame that is not an integer >= 0 and a rate that is not one', () => {
    expect(() => sourceFrameToMicroseconds(RATE, 1.5)).toThrowError(/frame/)
    expect(() => sourceFrameToMicroseconds(RATE, -1)).toThrowError(/frame/)
    expect(() => sourceFrameToMicroseconds({ num: 0, den: 1 }, 0)).toThrowError(/toRate/)
  })
})

describe('open', () => {
  it('reports progress by bytes and phase, never as a percentage', async () => {
    const { client } = setup()
    const progress: StabilizationProgress[] = []

    const info = await client.open(CLIP, SETTINGS, (report) => progress.push(report))

    expect(progress).toEqual([
      {
        bytesRead: 67_108_864,
        fileSize: 3_764_360_098,
        phase: 'reading',
        orientations: null,
      },
      {
        bytesRead: INFO.bytes_read,
        fileSize: 3_764_360_098,
        phase: 'smoothing',
        orientations: INFO.orientations,
      },
    ])
    // 1.9 GB of a 3.76 GB file: the last report is not the end of the work
    expect(progress[1]?.bytesRead).toBeLessThan(progress[1]?.fileSize ?? 0)
    expect(info.output).toEqual([3840, 2160])
  })

  it('puts the clip’s settings on the engine with one recompute', async () => {
    const { client, worker } = setup()

    await client.open(CLIP, SETTINGS)

    const sent = worker().sent.map((message) => message.type)
    expect(sent).toEqual([
      'open',
      'lensProfile',
      'setSmoothing',
      'setFov',
      'setAdaptiveZoom',
      'setHorizonLock',
      'recompute',
    ])
    expect(worker().requests('setSmoothing')[0]?.method).toBe('Default')
    expect(worker().requests('setSmoothing')[0]?.params).toEqual(SETTINGS.params)
    expect(worker().requests('setFov')[0]?.fov).toBe(1)
    expect(worker().requests('setAdaptiveZoom')[0]?.windowSeconds).toBe(4)
    expect(worker().requests('setHorizonLock')[0]).toMatchObject({
      lockPercent: 0,
      rollDegrees: 0,
    })
  })

  it('opens a file once for two clips of one source, and frees it with the last one', async () => {
    const { client, workers } = setup()
    const second: StabilizationClip = { ...CLIP, id: 'clip-2' }

    await client.open(CLIP, SETTINGS)
    await client.open(second, SETTINGS)

    expect(workers).toHaveLength(1)
    expect(workers[0]?.requests('open')).toHaveLength(1)
    expect(workers[0]?.requests('recompute')).toHaveLength(1)
    expect(client.isOpen('clip-1')).toBe(true)
    expect(client.isOpen('clip-2')).toBe(true)

    await client.close('clip-1')
    expect(workers[0]?.terminated).toBe(false)
    expect(client.isOpen('clip-1')).toBe(false)

    await client.close('clip-2')
    expect(workers[0]?.terminated).toBe(true)
    expect(workers[0]?.requests('close')).toHaveLength(0)
  })

  it('tells a file with no motion data apart and closes it', async () => {
    const { client, workers } = setup({ info: { orientations: 0 } })

    const error = await failure(client.open(CLIP, SETTINGS))

    expect(error).toBeInstanceOf(NoMotionDataError)
    expect((error as StabilizationError).code).toBe('no-motion-data')
    expect(error.message).toMatch(/no motion data/)
    expect(workers[0]?.terminated).toBe(true)
    expect(client.isOpen('clip-1')).toBe(false)
  })

  it('tells a file the engine cannot read apart, with the engine’s words', async () => {
    const { client, workers } = setup({
      fail: { open: 'UnsupportedFormat("DJI_20261115124704_0020_D.MP4")' },
    })

    const error = await failure(client.open(CLIP, SETTINGS))

    expect(error).toBeInstanceOf(ClipUnreadableError)
    expect((error as StabilizationError).code).toBe('clip-unreadable')
    expect(error.message).toContain('UnsupportedFormat("DJI_20261115124704_0020_D.MP4")')
    expect(workers[0]?.terminated).toBe(true)
  })

  it('rejects a second media for a clip that is already open, and another rate for one file', async () => {
    const { client } = setup()
    await client.open(CLIP, SETTINGS)

    expect(await failure(client.open({ ...CLIP, mediaId: 'media-2' }, SETTINGS))).toMatchObject({
      name: 'RangeError',
    })
    const other: StabilizationClip = { ...CLIP, id: 'clip-2', rate: { num: 30, den: 1 } }
    expect(await failure(client.open(other, SETTINGS))).toMatchObject({ name: 'RangeError' })
  })
})

describe('the lens profile', () => {
  it('is the name the panel shows and the model the shader needs', async () => {
    const { client } = setup({
      profile: { calib_dimension: { w: 3840, h: 2880 }, distortion_model: 'poly3' },
    })
    await client.open(CLIP, SETTINGS)

    expect(await client.lensProfile('clip-1')).toEqual({
      name: INFO.lens,
      model: 'poly3',
    })
  })

  it('is a typed error for a file that carries none, and the clip still stabilizes', async () => {
    const { client } = setup({ profile: { calib_dimension: { w: 0, h: 0 } } })
    await client.open(CLIP, SETTINGS)

    const error = await failure(client.lensProfile('clip-1'))
    expect(error).toBeInstanceOf(NoLensProfileError)
    expect((error as StabilizationError).code).toBe('no-lens-profile')

    // The engine's default pinhole: the clip's frames are served as they are
    expect(await client.getFrameData('clip-1', 0, { wait: true })).toMatchObject({ sourceFrame: 0 })
  })

  it('loads a profile as a settings change: the clip moves to an engine opened with it, the old one closes', async () => {
    const { client, workers } = setup({ profile: { calib_dimension: { w: 0, h: 0 } } })
    await client.open(CLIP, SETTINGS)

    const lens = await client.loadLensProfile(
      'clip-1',
      JSON.stringify({
        name: 'the pilot’s profile',
        calib_dimension: { w: 3840, h: 2880 },
        distortion_model: 'opencv_fisheye',
      }),
    )

    expect(lens.model).toBe('opencv_fisheye')
    expect(workers).toHaveLength(2)
    expect(workers[0]?.terminated).toBe(true)
    expect(workers[0]?.requests('setLensProfile')).toHaveLength(0)
    expect(workers[1]?.requests('setLensProfile')[0]?.json).toContain('the pilot’s profile')
    expect(workers[1]?.requests('recompute')).toHaveLength(1)
    expect(await client.lensProfile('clip-1')).toMatchObject({ model: 'opencv_fisheye' })
  })

  it('keeps the clip on its engine when the engine refuses the profile', async () => {
    const { client, workers } = setup({ fail: { setLensProfile: 'InvalidData' } })
    await client.open(CLIP, SETTINGS)

    const error = await failure(client.loadLensProfile('clip-1', '{"name":"broken"}'))

    expect(error.message).toContain('InvalidData')
    expect(workers[1]?.terminated).toBe(true)
    expect(workers[0]?.terminated).toBe(false)
    expect(await client.getFrameData('clip-1', 0, { wait: true })).toMatchObject({ sourceFrame: 0 })
    expect(workers[0]?.requests('frameData')).toHaveLength(1)
  })

  it('builds the stage’s assets from the profile’s model', async () => {
    const { client, worker } = setup({
      profile: { calib_dimension: { w: 3840, h: 2880 }, distortion_model: 'poly3', digital_lens: 'gopro_superview' },
    })
    await client.open(CLIP, SETTINGS)

    const assets = await client.stageAssets('clip-1')

    expect(worker().requests('shaderAssets')[0]).toMatchObject({
      model: 'poly3',
      digitalLens: 'gopro_superview',
    })
    expect(assets.coeffs).toHaveLength(496)
    expect(assets.interpolation).toBe(2)
    // Read once and kept: the panel's second question does not ask the engine again
    await client.stageAssets('clip-1')
    expect(worker().requests('shaderAssets')).toHaveLength(1)
  })
})

describe('a position between two frames (optical-flow slow motion, task 11.12)', () => {
  it('is asked for at its own moment with the same phase of the next 8 gaps, answered as that position, and kept', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)

    const frame = await client.getFrameData('clip-1', 100.5, { wait: true })

    expect(frame?.sourceFrame).toBe(100.5)
    const requests = worker().requests('frameData')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.timestampsUs).toEqual(
      [100.5, 101.5, 102.5, 103.5, 104.5, 105.5, 106.5, 107.5, 108.5].map((at) => sourcePositionToMicroseconds(RATE, at)),
    )
    // 100.5 frames at 60000/1001 is 1,676,675 us: between frames 100 (1,668,333) and 101 (1,685,017)
    expect(sourcePositionToMicroseconds(RATE, 100.5)).toBe(1_676_675)
    // Played on, the next gaps' frame halfway is already there: nothing more is asked
    expect((await client.getFrameData('clip-1', 100.5))?.sourceFrame).toBe(100.5)
    expect((await client.getFrameData('clip-1', 103.5))?.sourceFrame).toBe(103.5)
    expect(worker().requests('frameData')).toHaveLength(1)
  })

  it('looks ahead only as far as the clip’s last frame', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)

    await client.getFrameData('clip-1', INFO.frames - 2.5, { wait: true })

    expect(worker().requests('frameData')[0]?.timestampsUs).toEqual(
      [INFO.frames - 2.5, INFO.frames - 1.5].map((at) => sourcePositionToMicroseconds(RATE, at)),
    )
  })

  it('answers undefined without waiting, and has the position for the next call', async () => {
    const { client } = setup()
    await client.open(CLIP, SETTINGS)

    expect(await client.getFrameData('clip-1', 20.25)).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect((await client.getFrameData('clip-1', 20.25))?.sourceFrame).toBe(20.25)
  })

  it('refuses a position before the second frame’s start or past the last frame', async () => {
    const { client } = setup()
    await client.open(CLIP, SETTINGS)

    expect(await failure(client.getFrameData('clip-1', INFO.frames - 0.5))).toMatchObject({ name: 'RangeError' })
    expect(await failure(client.getFrameData('clip-1', -0.5))).toMatchObject({ name: 'RangeError' })
    expect(() => sourcePositionToMicroseconds(RATE, -1)).toThrowError(RangeError)
  })

  it('rejects an answer for a frame that is not one of the two around the position', async () => {
    const { client } = setup({ frameOf: () => 7 })
    await client.open(CLIP, SETTINGS)

    const error = await failure(client.getFrameData('clip-1', 3.5, { wait: true }))
    expect(error).toBeInstanceOf(StabilizationError)
    expect(error.message).toContain('the engine answered source frame 7 for position 3.5')
  })
})

describe('the window', () => {
  /** Every timestamp the worker was asked for, in the order it was asked */
  function asked(worker: FakeWorker): number[] {
    return worker
      .requests('frameData')
      .flatMap((message) => message.timestampsUs as number[])
  }

  it('is 8 frames behind and 24 ahead, keyed by the source frame’s own time', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)

    const frame = await client.getFrameData('clip-1', 100, { wait: true })

    expect(frame?.sourceFrame).toBe(100)
    expect(frame?.matrices[0]).toBe(100)
    const requests = worker().requests('frameData')
    expect(requests).toHaveLength(1)
    const timestampsUs = requests[0]?.timestampsUs as number[]
    expect(timestampsUs).toHaveLength(FRAMES_BEHIND + FRAMES_AHEAD + 1)
    expect(timestampsUs[0]).toBe(sourceFrameToMicroseconds(RATE, 92))
    expect(timestampsUs[FRAMES_BEHIND + FRAMES_AHEAD]).toBe(
      sourceFrameToMicroseconds(RATE, 124),
    )
    expect(asked(worker())).toEqual(timestampsUs)
  })

  it('peekFrame answers a frame the window has at once, and asks for the window when it has not', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)

    expect(client.peekFrame('clip-1', 100)).toBeUndefined()
    expect(worker().requests('frameData')).toHaveLength(1)
    await client.getFrameData('clip-1', 100, { wait: true })
    expect(worker().requests('frameData')).toHaveLength(1)

    // The frames ahead are there for the next draws, without a wait and without another request
    const ahead = client.peekFrame('clip-1', 100 + FRAMES_AHEAD)
    expect(ahead?.sourceFrame).toBe(100 + FRAMES_AHEAD)
    expect(ahead?.matrices[0]).toBe(100 + FRAMES_AHEAD)
    // Sliding to it asks for the frames now ahead of it
    expect(worker().requests('frameData')).toHaveLength(2)
    expect(client.peekFrame('clip-1', 100.5)).toBeUndefined()
    expect(client.peekFrame('nobody', 3)).toBeUndefined()
  })

  it('slideWindow moves the window and asks for the frames ahead, handing nothing out', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)
    await client.getFrameData('clip-1', 100, { wait: true })
    expect(worker().requests('frameData')).toHaveLength(1)

    client.slideWindow('clip-1', 100 + FRAMES_AHEAD)
    const requests = worker().requests('frameData')
    expect(requests).toHaveLength(2)
    // Only the frames the window did not hold yet: the ones past its old end
    expect((requests.at(-1)?.timestampsUs as number[] | undefined)?.[0]).toBe(
      sourceFrameToMicroseconds(RATE, 100 + FRAMES_AHEAD + 1),
    )
    client.slideWindow('clip-1', 100 + FRAMES_AHEAD)
    expect(worker().requests('frameData')).toHaveLength(2)
    client.slideWindow('clip-1', 100.5)
    client.slideWindow('nobody', 3)
    expect(worker().requests('frameData')).toHaveLength(2)
  })

  it('fetchFrames asks for exactly those frames in one request and leaves the window where it was', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)
    await client.getFrameData('clip-1', 100, { wait: true })
    const before = worker().requests('frameData').length

    const frames = await client.fetchFrames('clip-1', [500, 501, 502])
    expect(frames.map((frame) => frame.sourceFrame)).toEqual([500, 501, 502])
    expect(frames[1]?.matrices[0]).toBe(501)
    const requests = worker().requests('frameData')
    expect(requests).toHaveLength(before + 1)
    expect(requests.at(-1)?.timestampsUs).toEqual([500, 501, 502].map((frame) => sourceFrameToMicroseconds(RATE, frame)))
    // The window still holds the frames around 100: reading 100 again asks for nothing
    expect(client.peekFrame('clip-1', 100)?.sourceFrame).toBe(100)
    expect(worker().requests('frameData')).toHaveLength(before + 1)
  })

  it('starts at the file’s first frame and stops at its last', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)

    await client.getFrameData('clip-1', 0, { wait: true })
    expect(worker().requests('frameData')[0]?.timestampsUs as number[]).toHaveLength(
      FRAMES_AHEAD + 1,
    )

    await client.getFrameData('clip-1', INFO.frames - 1, { wait: true })
    const last = worker().requests('frameData')[1]?.timestampsUs as number[]
    expect(last).toHaveLength(FRAMES_BEHIND + 1)
    expect(last[last.length - 1]).toBe(sourceFrameToMicroseconds(RATE, INFO.frames - 1))
  })

  it('slides by one frame and asks only for the frame that left the window', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)
    await client.getFrameData('clip-1', 100, { wait: true })

    await client.getFrameData('clip-1', 101, { wait: true })

    const requests = worker().requests('frameData')
    expect(requests).toHaveLength(2)
    expect(requests[1]?.timestampsUs).toEqual([sourceFrameToMicroseconds(RATE, 125)])
  })

  it('asks nothing at all for a frame that is already there', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)
    await client.getFrameData('clip-1', 100, { wait: true })
    const before = worker().requests('frameData').length

    await client.getFrameData('clip-1', 101, { wait: true })
    expect(worker().requests('frameData')).toHaveLength(before + 1)
    await client.getFrameData('clip-1', 102, { wait: true })
    await client.getFrameData('clip-1', 103, { wait: true })
    expect(worker().requests('frameData')).toHaveLength(before + 3)
  })

  it('asks again from the new window after a jump, and never for the same frame twice at once', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)
    await client.getFrameData('clip-1', 100, { wait: true })

    // Two asks for the same frame before the worker has answered: one request
    const first = client.getFrameData('clip-1', 900, { wait: true })
    const second = client.getFrameData('clip-1', 900, { wait: true })
    expect((await first)?.sourceFrame).toBe(900)
    expect((await second)?.sourceFrame).toBe(900)
    const requests = worker().requests('frameData')
    expect(requests).toHaveLength(2)
    const jumped = requests[1]?.timestampsUs as number[] | undefined
    expect(jumped).toHaveLength(FRAMES_BEHIND + FRAMES_AHEAD + 1)
    expect(jumped?.[0]).toBe(sourceFrameToMicroseconds(RATE, 892))
    expect(new Set(asked(worker())).size).toBe(asked(worker()).length)
  })

  it('answers a miss with undefined and fills it for the next call', async () => {
    const { client } = setup()
    await client.open(CLIP, SETTINGS)

    expect(await client.getFrameData('clip-1', 100)).toBeUndefined()
    // The request is on its way; the next call, after the worker answered, has the frame
    await new Promise((resolve) => setTimeout(resolve, 5))
    const frame = await client.getFrameData('clip-1', 100)
    expect(frame?.sourceFrame).toBe(100)
  })

  it('hands out copies of its own, never the cache’s arrays', async () => {
    const { client } = setup()
    await client.open(CLIP, SETTINGS)

    const first = await client.getFrameData('clip-1', 2, { wait: true })
    const second = await client.getFrameData('clip-1', 2)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(second?.matrices).not.toBe(first?.matrices)
    expect(second?.params).not.toBe(first?.params)
    expect(second?.mesh).not.toBe(first?.mesh)
    expect(second?.matrices).toEqual(first?.matrices)

    first!.matrices[0] = -1
    first!.params[0] = 0
    const third = await client.getFrameData('clip-1', 2)
    expect(third?.matrices[0]).toBe(2)
    expect(third?.params[0]).toBe(2)
  })

  it('rejects a frame that is not the engine’s answer for the one asked for', async () => {
    const { client } = setup({ frameOf: () => 7 })
    await client.open(CLIP, SETTINGS)

    // The window starts at the first frame of it, so that is the one the engine's disagreement is named on
    const error = await failure(client.getFrameData('clip-1', 3, { wait: true }))
    expect(error).toBeInstanceOf(StabilizationError)
    expect(error.message).toContain('the engine answered source frame 7 for 0')
  })

  it('rejects a source frame the file does not have, and a clip that is not open', async () => {
    const { client } = setup()
    await client.open(CLIP, SETTINGS)

    expect(await failure(client.getFrameData('clip-1', INFO.frames))).toMatchObject({
      name: 'RangeError',
    })
    expect(await failure(client.getFrameData('clip-1', -1))).toMatchObject({ name: 'RangeError' })
    expect(await failure(client.getFrameData('clip-1', Number.NaN))).toMatchObject({ name: 'RangeError' })
    expect(await failure(client.getFrameData('clip-2', 0))).toMatchObject({ name: 'Error' })
  })

  it('is not open until the engine has answered, and reopens a file whose clip was closed', async () => {
    const { client, workers } = setup()
    const opening = client.open(CLIP, SETTINGS)
    expect(client.isOpen('clip-1')).toBe(false)
    await opening
    expect(client.isOpen('clip-1')).toBe(true)

    await client.close('clip-1')
    await client.open(CLIP, SETTINGS)
    expect(workers).toHaveLength(2)
    expect(workers[1]?.terminated).toBe(false)
  })
})

describe('a settings change', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const changed: StabilizationSettings = {
    ...SETTINGS,
    method: 'Optimal path',
    params: { smoothness: 0.6 },
    fov: 1.2,
    horizonLockPercent: 50,
    horizonLockRoll: 10,
    adaptiveZoomSeconds: 6,
  }

  it('applies the gesture’s last settings once, when its changes stop', async () => {
    vi.useFakeTimers()
    const { client, worker } = setup({}, 250)
    await client.open(CLIP, SETTINGS)
    const recomputes = worker().requests('recompute').length
    const sentByOpen = worker().requests('setFov').length

    void client.setSettings('clip-1', { ...changed, fov: 1.1 })
    await vi.advanceTimersByTimeAsync(200)
    void client.setSettings('clip-1', { ...changed, fov: 1.15 })
    await vi.advanceTimersByTimeAsync(200)
    const gesture = client.setSettings('clip-1', changed)

    // A drag's changes 200 ms apart are one gesture: nothing has reached the engine yet
    expect(worker().requests('setFov')).toHaveLength(sentByOpen)
    expect(worker().requests('recompute')).toHaveLength(recomputes)

    await vi.advanceTimersByTimeAsync(300)
    await gesture
    expect(worker().requests('setFov').slice(sentByOpen).map((message) => message.fov)).toEqual([1.2])
    expect(worker().requests('setSmoothing').at(-1)?.method).toBe('Optimal path')
    expect(worker().requests('setAdaptiveZoom').at(-1)?.windowSeconds).toBe(6)
    expect(worker().requests('setHorizonLock').at(-1)).toMatchObject({
      lockPercent: 50,
      rollDegrees: 10,
    })
    expect(worker().requests('recompute')).toHaveLength(recomputes + 1)
  })

  it('does not restart a gesture for the settings it already waits to apply', async () => {
    vi.useFakeTimers()
    const { client, worker } = setup({}, 250)
    await client.open(CLIP, SETTINGS)
    const recomputes = worker().requests('recompute').length

    // The renderer asks for the item's settings on every frame it draws while the gesture waits
    const gesture = client.setSettings('clip-1', changed)
    for (let frame = 0; frame < 30; frame += 1) {
      void client.setSettings('clip-1', changed)
      await vi.advanceTimersByTimeAsync(16)
    }
    await gesture

    expect(worker().requests('recompute')).toHaveLength(recomputes + 1)
  })

  it('does nothing at all when the engine already holds the settings', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)
    const before = worker().sent.length

    await client.setSettings('clip-1', { ...SETTINGS, enabled: true })

    expect(worker().sent).toHaveLength(before)
  })

  it('drops the frames of the previous settings when the recompute is done', async () => {
    const { client, worker } = setup({}, 5)
    await client.open(CLIP, SETTINGS)
    await client.getFrameData('clip-1', 100, { wait: true })
    const requests = worker().requests('frameData').length

    await client.setSettings('clip-1', changed)
    // The next ask is answered by the engine again: the cached frame belonged to the old smoothing
    const fresh = await client.getFrameData('clip-1', 100, { wait: true })

    expect(fresh?.matrices[0]).toBe(100)
    expect(worker().requests('frameData').length).toBeGreaterThan(requests)
  })

  it('refuses a method the engine does not list before anything is sent, and the clip keeps its engine', async () => {
    const { client, worker } = setup()
    await client.open(CLIP, SETTINGS)
    const before = worker().sent.length

    const error = await failure(client.setSettings('clip-1', { ...SETTINGS, method: 'Nope' }))

    expect(error).toBeInstanceOf(InvalidSettingsError)
    expect(error.message).toContain('"Nope"')
    expect(worker().sent.slice(before).map((message) => message.type)).toEqual(['smoothingMethods'])
    expect(await client.getFrameData('clip-1', 0, { wait: true })).toMatchObject({ sourceFrame: 0 })
  })

  it('keeps serving the clip the frames it has when its engine fails a setting, and shares that engine no more', async () => {
    const { client, workers } = setup()
    await client.open(CLIP, SETTINGS)
    workers[0]!.fail.setFov = 'the engine failed'

    const error = await failure(client.setSettings('clip-1', { ...SETTINGS, fov: 1.5 }))

    expect(error).toBeInstanceOf(StabilizationError)
    expect(error.message).toContain('the engine failed')
    expect(client.isOpen('clip-1')).toBe(true)
    expect(await client.getFrameData('clip-1', 0, { wait: true })).toMatchObject({ sourceFrame: 0 })
    // The engine can no longer say what it holds: a clip opened with either settings gets an engine of its own
    await client.open({ ...CLIP, id: 'clip-2' }, SETTINGS)
    expect(workers).toHaveLength(2)
  })
})

describe('the engine’s methods', () => {
  it('are read from a worker of their own when no clip is open, once', async () => {
    const { client, workers } = setup()

    const methods = await client.smoothingMethods()
    const again = await client.smoothingMethods()

    expect(methods.map((method) => method.name)).toEqual(['No smoothing', 'Default', 'Optimal path'])
    expect(again).toBe(methods)
    expect(workers).toHaveLength(1)
    expect(workers[0]?.requests('smoothingMethods')).toHaveLength(1)
    // The worker that existed only to answer went away with its memory
    expect(workers[0]?.terminated).toBe(true)
  })

  it('are answered by an open clip’s worker, without a second one', async () => {
    const { client, workers } = setup()
    await client.open(CLIP, SETTINGS)

    await client.smoothingMethods()

    expect(workers).toHaveLength(1)
    expect(workers[0]?.requests('smoothingMethods')).toHaveLength(1)
    expect(workers[0]?.terminated).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Review findings S10, S4 and S7: the settings a clip is opened with, the engine they key, and the engines no clip uses

describe('the settings a clip is opened with', () => {
  it('are validated first, and refused with a typed error before any worker starts', async () => {
    const { client, workers } = setup()

    const error = await failure(client.open(CLIP, { ...SETTINGS, fov: 0 }))

    expect((error as StabilizationError).code).toBe('invalid-settings')
    expect(error).toBeInstanceOf(StabilizationError)
    expect(error.message).toContain('stabilization.fov')
    expect(workers).toHaveLength(0)
    expect(client.isOpen('clip-1')).toBe(false)
  })

  it('refuses a stored field that is not what the engine takes, never sending a default instead', async () => {
    const { client, workers } = setup()

    for (const settings of [
      { ...SETTINGS, method: '' },
      { ...SETTINGS, params: { smoothness: Number.NaN } },
      { ...SETTINGS, horizonLockPercent: 101 },
      { ...SETTINGS, lensProfile: 'not a profile' },
      { ...SETTINGS, enabled: 'yes' },
    ]) {
      const error = await failure(client.open(CLIP, settings as unknown as StabilizationSettings))
      expect((error as StabilizationError).code).toBe('invalid-settings')
    }
    expect(workers).toHaveLength(0)
  })
})

describe('an engine per file and settings', () => {
  const smoother: StabilizationSettings = { ...SETTINGS, params: { ...SETTINGS.params, smoothness: 0.9 } }
  const changed: StabilizationSettings = {
    ...SETTINGS,
    method: 'Optimal path',
    params: {},
    fov: 1.2,
    horizonLockPercent: 50,
    horizonLockRoll: 10,
    adaptiveZoomSeconds: 6,
  }
  const second: StabilizationClip = { ...CLIP, id: 'clip-2' }

  it('gives two clips of one file with different settings an engine each', async () => {
    const { client, workers } = setup()

    await client.open(CLIP, SETTINGS)
    await client.open(second, smoother)

    expect(workers).toHaveLength(2)
    expect(workers[0]?.requests('setSmoothing').map((message) => message.params)).toEqual([SETTINGS.params])
    expect(workers[1]?.requests('setSmoothing').map((message) => message.params)).toEqual([smoother.params])
    // Each clip's frames come from its own engine
    await client.getFrameData('clip-1', 100, { wait: true })
    await client.getFrameData('clip-2', 100, { wait: true })
    expect(workers[0]?.requests('frameData')).toHaveLength(1)
    expect(workers[1]?.requests('frameData')).toHaveLength(1)
  })

  it('moves a clip whose settings change off the engine it shares, and leaves the other clip’s alone', async () => {
    const { client, workers } = setup()
    await client.open(CLIP, SETTINGS)
    await client.open(second, SETTINGS)
    expect(workers).toHaveLength(1)

    await client.setSettings('clip-1', changed)

    expect(workers).toHaveLength(2)
    // The shared engine was not touched: one setter each and one recompute, from the first open
    expect(workers[0]?.requests('setFov').map((message) => message.fov)).toEqual([1])
    expect(workers[0]?.requests('recompute')).toHaveLength(1)
    expect(workers[0]?.terminated).toBe(false)
    expect(workers[1]?.requests('setFov').map((message) => message.fov)).toEqual([1.2])
    await client.getFrameData('clip-1', 100, { wait: true })
    await client.getFrameData('clip-2', 100, { wait: true })
    expect(workers[1]?.requests('frameData')).toHaveLength(1)
    expect(workers[0]?.requests('frameData')).toHaveLength(1)
  })

  it('recomputes an engine a clip has to itself, without reading the file again', async () => {
    const { client, workers } = setup()
    await client.open(CLIP, SETTINGS)

    await client.setSettings('clip-1', changed)

    expect(workers).toHaveLength(1)
    expect(workers[0]?.requests('open')).toHaveLength(1)
    expect(workers[0]?.requests('recompute')).toHaveLength(2)
    expect(workers[0]?.requests('setFov').at(-1)?.fov).toBe(1.2)
  })

  it('moves a clip onto the engine that has its new settings, and closes the one it leaves', async () => {
    const { client, workers } = setup()
    await client.open(CLIP, SETTINGS)
    await client.open(second, changed)
    expect(workers).toHaveLength(2)

    await client.setSettings('clip-1', changed)

    expect(workers).toHaveLength(2)
    expect(workers[0]?.terminated).toBe(true)
    expect(workers[1]?.requests('recompute')).toHaveLength(1)
    await client.getFrameData('clip-1', 100, { wait: true })
    expect(workers[1]?.requests('frameData')).toHaveLength(1)
  })

  it('restores a loaded lens profile on open, before the recompute', async () => {
    const { client, worker } = setup({ profile: { calib_dimension: { w: 0, h: 0 } } })
    const json = JSON.stringify({
      name: 'the pilot’s profile',
      calib_dimension: { w: 3840, h: 2880 },
      distortion_model: 'opencv_fisheye',
    })

    await client.open(CLIP, { ...SETTINGS, lensProfile: json })

    const sent = worker().sent.map((message) => message.type)
    expect(worker().requests('setLensProfile').map((message) => message.json)).toEqual([json])
    expect(sent.indexOf('setLensProfile')).toBeLessThan(sent.indexOf('recompute'))
    expect(await client.lensProfile('clip-1')).toMatchObject({ model: 'opencv_fisheye' })
  })

  it('keys the engine by the lens profile too: a clip with one and a clip without do not share', async () => {
    const { client, workers } = setup()

    await client.open(CLIP, { ...SETTINGS, lensProfile: '{"name":"loaded"}' })
    await client.open(second, SETTINGS)

    expect(workers).toHaveLength(2)
  })
})

describe('an engine no clip uses', () => {
  it('is closed when its clip is closed while the file is still opening', async () => {
    const { client, workers } = setup()

    const opening = client.open(CLIP, SETTINGS)
    await client.close('clip-1')

    const error = await failure(opening)
    expect((error as StabilizationError).code).toBe('closed')
    expect(workers[0]?.terminated).toBe(true)
    expect(client.isOpen('clip-1')).toBe(false)
  })
})

describe('a clip opened again while a gesture waits', () => {
  it('gets the settings it is opened with, and the gesture ends with them', async () => {
    const { client, worker } = setup({}, 250)
    await client.open(CLIP, SETTINGS)

    const gesture = client.setSettings('clip-1', { ...SETTINGS, fov: 1.3 })
    await client.open(CLIP, { ...SETTINGS, fov: 1.6 })
    await gesture
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(worker().requests('setFov').map((message) => message.fov)).toEqual([1, 1.6])
  })
})

describe('an engine opened for a move', () => {
  it('is closed when its clip is closed before the engine has opened', async () => {
    const workers: FakeWorker[] = []
    let heldOpen: (() => void) | null = null
    const client = createStabilizationClient({
      createWorker: () => {
        const worker = fakeWorker()
        if (workers.length === 1) {
          // The second engine's file takes its time to open: the clip is closed meanwhile
          const post = worker.postMessage.bind(worker)
          worker.postMessage = (message) => {
            if (message.type === 'open') heldOpen = () => post(message)
            else post(message)
          }
        }
        workers.push(worker)
        return worker as unknown as Worker
      },
      recomputeDelayMs: 1,
    })
    await client.open(CLIP, SETTINGS)
    await client.open({ ...CLIP, id: 'clip-2' }, SETTINGS)

    // clip-1 shares its engine, so its new settings need an engine of their own, which opens the file again
    const moving = client.setSettings('clip-1', { ...SETTINGS, fov: 1.4 })
    await vi.waitFor(() => expect(heldOpen).not.toBeNull())
    await client.close('clip-1')

    expect(((await failure(moving)) as StabilizationError).code).toBe('closed')
    expect(workers[1]?.terminated).toBe(true)
    expect(workers[0]?.terminated).toBe(false)
    expect(client.isOpen('clip-2')).toBe(true)
  })
})

describe('the output aspect', () => {
  const aspect = (width: number, height: number): EngineSettings => ({
    ...SETTINGS,
    outputAspect: { width, height },
  })

  it('is put on the engine after the lens profile and the other settings, before the one recompute, and the size is read again', async () => {
    const { client, worker } = setup()

    const info = await client.open(CLIP, aspect(4, 3))

    expect(worker().sent.map((message) => message.type)).toEqual([
      'open',
      'lensProfile',
      'setSmoothing',
      'setFov',
      'setAdaptiveZoom',
      'setHorizonLock',
      'setOutputSize',
      'recompute',
      'info',
    ])
    expect(worker().requests('setOutputSize')[0]).toMatchObject({ width: 4, height: 3 })
    // A 4:3 project: the stabilized clip is 4:3 (the whole 3840x2880), not the profile's 16:9
    expect(info.output).toEqual([3840, 2880])
    expect(client.infoOf('clip-1')?.output).toEqual([3840, 2880])
  })

  it('makes 16:9 for a 16:9 project, which is the frame the engine had, and 9:16 for a vertical one', async () => {
    const wide = setup()
    expect((await wide.client.open(CLIP, aspect(16, 9))).output).toEqual([3840, 2160])
    const vertical = setup()
    expect((await vertical.client.open(CLIP, aspect(9, 16))).output).toEqual([1620, 2880])
  })

  it('asks the engine for nothing, and reads nothing again, when the project’s frame is not known', async () => {
    const { client, worker } = setup()

    const info = await client.open(CLIP, SETTINGS)

    expect(worker().requests('setOutputSize')).toHaveLength(0)
    expect(worker().requests('info')).toHaveLength(0)
    expect(info.output).toEqual([3840, 2160])
  })

  it('moves an engine only this clip uses to the new frame in place: one setOutputSize, one recompute, no file read, the new size', async () => {
    const { client, workers } = setup()
    await client.open(CLIP, aspect(16, 9))

    await client.setSettings('clip-1', aspect(4, 3))

    expect(workers).toHaveLength(1)
    expect(workers[0]?.requests('open')).toHaveLength(1)
    expect(workers[0]?.requests('setOutputSize').map((message) => [message.width, message.height])).toEqual([
      [16, 9],
      [4, 3],
    ])
    expect(workers[0]?.requests('recompute')).toHaveLength(2)
    expect(client.infoOf('clip-1')?.output).toEqual([3840, 2880])
  })

  it('gives clips of one file in projects of two shapes an engine each', async () => {
    const { client, workers } = setup()
    await client.open(CLIP, aspect(16, 9))
    await client.open({ ...CLIP, id: 'clip-2' }, aspect(4, 3))

    expect(workers).toHaveLength(2)
    expect(client.infoOf('clip-1')?.output).toEqual([3840, 2160])
    expect(client.infoOf('clip-2')?.output).toEqual([3840, 2880])
  })

  it('refuses an aspect that is not two whole numbers above 0, before any worker starts', async () => {
    const { client, workers } = setup()

    const error = await failure(client.open(CLIP, aspect(0, 3)))

    expect(error).toBeInstanceOf(InvalidSettingsError)
    expect(error.message).toMatch(/outputAspect/)
    expect(workers).toHaveLength(0)
  })

  it('has no info for a clip that is not open', () => {
    expect(setup().client.infoOf('nobody')).toBeNull()
  })
})
