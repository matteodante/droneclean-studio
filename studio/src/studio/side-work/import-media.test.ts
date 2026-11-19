import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import { motionLaneWidth, SideWorkScheduler } from './scheduler'

const mocks = vi.hoisted(() => ({
  // One scheduler for the file: the module builds its queue on the first call and keeps it
  scheduler: null as unknown as SideWorkScheduler,
  getFilmstrip: vi.fn(async () => undefined),
  registerUrl: vi.fn((_id: string, url: string) => url),
  acquire: vi.fn((id: string) => `blob:${id}`),
  release: vi.fn(),
  open: vi.fn(async (_clip: unknown, _settings: unknown) => ({})),
  close: vi.fn(async () => undefined),
  smoothingMethods: vi.fn(async () => []),
  createClient: vi.fn(),
  settings: { showFilmstrips: true, enableFilmstripExtraction: true },
}))

vi.mock('./index', () => ({ getSideWork: () => mocks.scheduler }))
vi.mock('@/features/timeline/services/filmstrip-cache', () => ({
  filmstripCache: { getFilmstrip: mocks.getFilmstrip },
}))
vi.mock('@/features/settings/stores/settings-store', () => ({
  useSettingsStore: { getState: () => mocks.settings },
}))
vi.mock('@/shared/utils/keyframe-index-registry', () => ({ registerKeyframeIndex: vi.fn() }))
vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: {
    acquire: mocks.acquire,
    registerUrl: mocks.registerUrl,
    release: mocks.release,
  },
}))
vi.mock('@/studio/stabilization/client', () => ({
  createStabilizationClient: (options: unknown) => {
    mocks.createClient(options)
    return { open: mocks.open, close: mocks.close, smoothingMethods: mocks.smoothingMethods }
  },
}))
vi.mock('@/studio/stabilization/motion-cache', () => ({
  createMotionCache: (options: unknown) => ({ options }),
}))
vi.mock('@/studio/stabilization/settings', () => ({
  stabilizationDefaults: () => ({ enabled: false, method: 'default' }),
}))

import { canStabilizeAtImport, queueImportSideWork } from './import-media'

/** Waits until every lane has nothing running or queued: `queue` puts its jobs in the scheduler at once. */
const settle = async () => {
  await vi.waitFor(() => {
    for (const lane of Object.values(mocks.scheduler.stats())) {
      expect(lane.running + lane.queued).toBe(0)
    }
  })
}

function clip(id: string, droneModel?: string) {
  const media = {
    id,
    fileName: `${id}.MP4`,
    fileSize: 10,
    mimeType: 'video/mp4',
    duration: 30,
    width: 3840,
    height: 2160,
    fps: 59.94,
    droneModel,
  } as MediaMetadata
  return { media, file: new File(['x'], `${id}.MP4`, { type: 'video/mp4', lastModified: 5 }) }
}

describe('the media library side work of an import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scheduler ??= new SideWorkScheduler({ decode: 2, cpu: 5, motion: motionLaneWidth(16) })
    mocks.settings.showFilmstrips = true
    mocks.settings.enableFilmstripExtraction = true
  })

  it('decides from the drone model whether a clip has motion data to read', () => {
    expect(canStabilizeAtImport(clip('a', 'DJI Avata2').media)).toBe(true)
    expect(canStabilizeAtImport(clip('b').media)).toBe(false)
  })

  it('extracts the filmstrip and records the motion data of a DJI clip, and lets the engine go', async () => {
    const dji = clip('0020', 'DJI Avata2')
    queueImportSideWork(dji)
    await settle()

    expect(mocks.acquire).toHaveBeenCalledWith(
      '0020',
      dji.file,
      expect.objectContaining({ mediaId: '0020' }),
    )
    expect(mocks.getFilmstrip).toHaveBeenCalledWith('0020', 'blob:0020', 30)
    expect(mocks.release).toHaveBeenCalledWith('0020')
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(mocks.open.mock.calls[0]![0]).toMatchObject({ mediaId: '0020', file: dji.file })
    expect(mocks.close).toHaveBeenCalledTimes(1)
    // The import's client keeps no copy in memory: the trace is read back from OPFS
    expect(mocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ motionCache: { options: { maxMemoryBytes: 0 } } }),
    )
  })

  it('opens no engine for a clip without a drone model', async () => {
    queueImportSideWork(clip('phone'))
    await settle()
    expect(mocks.getFilmstrip).toHaveBeenCalledTimes(1)
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('treats a file with no gyro data as a clip without motion data, not as a failure', async () => {
    mocks.open.mockRejectedValueOnce(
      Object.assign(new Error('no gyro'), { code: 'no-motion-data' }),
    )
    queueImportSideWork(clip('dji-no-gyro', 'DJI Mini 2'))
    await settle()
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })

  it('skips the filmstrip when the user switched filmstrips off', async () => {
    mocks.settings.showFilmstrips = false
    queueImportSideWork(clip('a', 'DJI Avata2'))
    await settle()
    expect(mocks.getFilmstrip).not.toHaveBeenCalled()
    expect(mocks.open).toHaveBeenCalledTimes(1)
  })

  it('never has more than two motion opens in flight for six clips on a 16 GB machine', async () => {
    expect(motionLaneWidth(16)).toBe(2)
    let inFlight = 0
    let peak = 0
    const gates: Array<() => void> = []
    mocks.open.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise<void>((resolve) => gates.push(resolve))
      inFlight -= 1
      return {}
    })
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) queueImportSideWork(clip(id, 'DJI Avata2'))
    for (let done = 0; done < 6; done++) {
      await vi.waitFor(() => expect(gates.length).toBeGreaterThan(done))
      expect(inFlight).toBeLessThanOrEqual(2)
      gates[done]!()
    }
    await settle()
    expect(peak).toBe(2)
    expect(mocks.open).toHaveBeenCalledTimes(6)
    mocks.open.mockImplementation(async () => ({}))
  })

  it('reads a clip linked by path through the shell URL: the filmstrip from it, the motion data by range, never whole', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['bytes'])))
    vi.stubGlobal('fetch', fetchMock)
    const linked = clip('linked', 'DJI Avata2')
    queueImportSideWork({
      media: { ...linked.media, fileLastModified: 77 },
      url: 'droneclean://app/__media/x',
    })
    await settle()
    vi.unstubAllGlobals()

    expect(mocks.registerUrl).toHaveBeenCalledWith('linked', 'droneclean://app/__media/x')
    expect(mocks.getFilmstrip).toHaveBeenCalledWith('linked', 'droneclean://app/__media/x', 30)
    // The page fetches nothing: the worker reads the route itself, a chunk at a time
    expect(fetchMock).not.toHaveBeenCalled()
    const opened = mocks.open.mock.calls.at(-1)![0] as { file: unknown }
    expect(opened.file).toEqual({
      url: 'droneclean://app/__media/x',
      size: linked.media.fileSize,
      name: 'linked.MP4',
      lastModified: 77,
    })
  })
})
