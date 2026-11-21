// FreeCut's `runRender` (render-pipeline.ts) with the export worker's page half hooked in: the start message carries
// what the page prepared, a StageError raised in the worker rejects the export as the same named error (no main-thread
// retry), cancel reaches the worker, and every way out terminates the worker (design 3.6 section 2.15). The worker is
// a fake: these are the page's messages.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { StageError } from '@/studio/render/stages/types'
import type { ClientExportSettings, ClientRenderResult } from '@/runtime/renderer/client-renderer'
import type { CompositionInputProps } from '@/types/export'
import { serializeFailure, type StudioWorkerRequest, type StudioWorkerResponse } from './protocol'

const { renderComposition } = vi.hoisted(() => ({ renderComposition: vi.fn() }))
vi.mock('@/runtime/renderer/canvas-render-orchestrator', () => ({
  renderComposition,
  renderAudioOnly: vi.fn(),
}))

// The page mixes the project's sound for a native export; the real mixer needs real media (`native-audio.test.ts`).
const { sendProjectMix } = vi.hoisted(() => ({ sendProjectMix: vi.fn(async () => null) }))
vi.mock('@/studio/export/native-audio', () => ({ sendProjectMix }))

const { runRender } = await import('@/runtime/renderer/render-pipeline')

class FakeWorker {
  static made: FakeWorker[] = []
  readonly sent: Array<{ message: StudioWorkerRequest; transfer: Transferable[] | undefined }> = []
  onmessage: ((event: MessageEvent<StudioWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  constructor() {
    FakeWorker.made.push(this)
  }

  postMessage(message: StudioWorkerRequest, transfer?: Transferable[]): void {
    this.sent.push({ message, transfer })
  }

  terminate(): void {
    this.terminated = true
  }

  reply(response: StudioWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<StudioWorkerResponse>)
  }

  /** The request id of the start message, once it was sent */
  get requestId(): string {
    const start = this.sent.find((entry) => entry.message.type === 'start')
    if (!start) throw new Error('no start message yet')
    return start.message.requestId
  }
}

const SETTINGS = { mode: 'video', codec: 'h265', container: 'mp4' } as unknown as ClientExportSettings
const RESULT = { blob: new Blob(['x']), mimeType: 'video/mp4', duration: 1, fileSize: 1 } as ClientRenderResult

function composition(): CompositionInputProps {
  return {
    fps: 30,
    width: 640,
    height: 360,
    durationInFrames: 30,
    tracks: [
      {
        id: 't1',
        items: [{ id: 'clip', type: 'video', mediaId: 'm1', src: 'blob:x', from: 0, durationInFrames: 30 }],
      },
    ],
  } as unknown as CompositionInputProps
}

async function started(): Promise<FakeWorker> {
  // Ten seconds, not the default one: under a loaded unit run the worker starts later (22 tests flaked, 21 Nov 2026)
  await vi.waitFor(
    () => {
      expect(FakeWorker.made[0]?.sent.some((entry) => entry.message.type === 'start')).toBe(true)
    },
    { timeout: 10_000 },
  )
  return FakeWorker.made[0]!
}

beforeEach(() => {
  FakeWorker.made = []
  renderComposition.mockReset()
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runRender with the export worker', () => {
  it('sends what the page prepared with the start message, and resolves with the worker’s result', async () => {
    const outcome = runRender({
      clientSettings: SETTINGS,
      exportMode: 'video',
      composition: composition(),
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })
    const worker = await started()
    const start = worker.sent[0]!
    expect(start.message.type).toBe('start')
    if (start.message.type !== 'start') throw new Error('unreachable')
    expect(start.message.studio).toEqual({
      projectFps: 30,
      projectFrame: null,
      derivedSizes: [],
      media: [],
      objectUrls: [],
      engines: null,
      timings: false,
    })
    expect(start.transfer).toEqual([])
    worker.reply({ type: 'complete', requestId: worker.requestId, result: RESULT })
    await expect(outcome).resolves.toEqual({ result: RESULT, renderPath: 'worker' })
    expect(worker.terminated).toBe(true)
    expect(renderComposition).not.toHaveBeenCalled()
  })

  it('rejects with the StageError the worker raised, the same message, and does not retry on the page', async () => {
    const raised = new StageError({
      clip: 'DJI_0020',
      stage: 'stabilize',
      sourceIndex: 1234,
      reason: 'the engine stopped',
    })
    const outcome = runRender({
      clientSettings: SETTINGS,
      exportMode: 'video',
      composition: composition(),
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })
    const worker = await started()
    worker.reply({
      type: 'error',
      requestId: worker.requestId,
      error: raised.message,
      failure: structuredClone(serializeFailure(raised)),
    })
    const error = await outcome.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(StageError)
    expect((error as StageError).message).toBe(raised.message)
    expect((error as StageError).sourceIndex).toBe(1234)
    expect(renderComposition).not.toHaveBeenCalled()
    expect(worker.terminated).toBe(true)
  })

  it('passes cancel to the worker and rejects with AbortError when the worker says it stopped', async () => {
    const controller = new AbortController()
    const outcome = runRender({
      clientSettings: SETTINGS,
      exportMode: 'video',
      composition: composition(),
      signal: controller.signal,
      onProgress: vi.fn(),
    })
    const worker = await started()
    worker.reply({
      type: 'progress',
      requestId: worker.requestId,
      progress: { phase: 'rendering', progress: 10 },
    } as StudioWorkerResponse)
    controller.abort()
    expect(worker.sent.at(-1)?.message).toEqual({ type: 'cancel', requestId: worker.requestId })
    worker.reply({ type: 'cancelled', requestId: worker.requestId })
    const error = await outcome.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
    expect(worker.terminated).toBe(true)
    expect(renderComposition).not.toHaveBeenCalled()
  })

  it('never starts a worker for an export cancelled before it began', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await runRender({
      clientSettings: SETTINGS,
      exportMode: 'video',
      composition: composition(),
      signal: controller.signal,
      onProgress: vi.fn(),
    }).catch((caught: unknown) => caught)
    expect((error as DOMException).name).toBe('AbortError')
    expect(FakeWorker.made).toHaveLength(0)
  })

  it('still renders on the page what the worker refuses (FreeCut’s fallback, by message)', async () => {
    renderComposition.mockResolvedValue(RESULT)
    const outcome = runRender({
      clientSettings: SETTINGS,
      exportMode: 'video',
      composition: composition(),
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })
    const worker = await started()
    worker.reply({
      type: 'error',
      requestId: worker.requestId,
      error: 'WORKER_REQUIRES_MAIN_THREAD:audio-context',
      failure: { name: 'Error', message: 'WORKER_REQUIRES_MAIN_THREAD:audio-context' },
    })
    await expect(outcome).resolves.toEqual({
      result: RESULT,
      renderPath: 'main-thread',
      fallbackReason: 'WORKER_REQUIRES_MAIN_THREAD:audio-context',
    })
    expect(worker.terminated).toBe(true)
  })
})

describe('runRender of a native 10-bit export', () => {
  const NATIVE = { format: 'hevc-main10' as const, path: '/exports/flight.mp4', bitrate: 120_000_000 }

  function installShell() {
    const calls = { encodes: [] as unknown[], cancelled: [] as string[], described: [] as string[][] }
    vi.stubGlobal('window', {
      ...globalThis,
      dronecleanDesktop: {
        version: 1,
        platform: 'darwin',
        getPathForFile: () => '',
        nativeMedia: {
          startDecode: vi.fn(),
          cancel: (request: { jobId: string }) => calls.cancelled.push(request.jobId),
          async encodeStart(request: { width: number; height: number }) {
            calls.encodes.push(request)
            return { ok: true, value: { readback: 'p010le', frameBytes: request.width * request.height * 3 } }
          },
        },
        mediaPaths: {
          async describe(paths: string[]) {
            calls.described.push(paths)
            return paths.map((path) => ({ path }))
          },
        },
      },
    })
    return calls
  }

  async function withMedia(filePath: string | undefined) {
    const { useMediaLibraryStore } = await import('@/features/media-library/stores/media-library-store')
    const record = { id: 'm1', fileName: 'a.mp4', storageType: 'path', ...(filePath ? { filePath } : {}) }
    useMediaLibraryStore.setState({ mediaById: { m1: record } } as never)
  }

  it('hands the worker the plan (files on disk, the started encode, the decode port) and leaves a finished encode alone', async () => {
    const calls = installShell()
    await withMedia('/clips/a.mp4')
    const outcome = runRender({
      clientSettings: SETTINGS,
      exportMode: 'video',
      composition: composition(),
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      native: NATIVE,
    })
    const worker = await started()
    const start = worker.sent[0]!
    if (start.message.type !== 'start') throw new Error('unreachable')
    const plan = start.message.studio?.native
    expect(plan?.target).toEqual(NATIVE)
    expect(plan?.paths).toEqual([['m1', '/clips/a.mp4']])
    expect(plan?.encode).toMatchObject({ width: 640, height: 360, frameBytes: 640 * 360 * 3 })
    expect(start.transfer).toEqual([plan?.media])
    expect(calls.described).toEqual([['/clips/a.mp4']])
    // The sound is mixed for the same job the encode was started for, before the worker's first frame.
    expect(sendProjectMix).toHaveBeenCalledWith(expect.anything(), { jobId: plan?.encode.jobId })
    worker.reply({ type: 'complete', requestId: worker.requestId, result: RESULT })
    await expect(outcome).resolves.toEqual({ result: RESULT, renderPath: 'worker' })
    expect(calls.cancelled).toEqual([])
  })

  it('never falls back to the page: what the worker refuses fails the export and cancels the encode', async () => {
    const calls = installShell()
    await withMedia('/clips/a.mp4')
    const outcome = runRender({
      clientSettings: SETTINGS,
      exportMode: 'video',
      composition: composition(),
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      native: NATIVE,
    })
    const worker = await started()
    worker.reply({
      type: 'error',
      requestId: worker.requestId,
      error: 'WORKER_REQUIRES_MAIN_THREAD:animated-image',
      failure: { name: 'Error', message: 'WORKER_REQUIRES_MAIN_THREAD:animated-image' },
    })
    await expect(outcome).rejects.toThrow('WORKER_REQUIRES_MAIN_THREAD:animated-image')
    expect(renderComposition).not.toHaveBeenCalled()
    expect(calls.cancelled).toHaveLength(1)
  })

  it('stops with a SourceError for a clip with no file on disk, before any worker or encode', async () => {
    const calls = installShell()
    await withMedia(undefined)
    const error = await runRender({
      clientSettings: SETTINGS,
      exportMode: 'video',
      composition: composition(),
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      native: NATIVE,
    }).catch((caught: unknown) => caught)
    expect((error as Error).name).toBe('SourceError')
    expect(calls.encodes).toEqual([])
    expect(FakeWorker.made[0]?.sent ?? []).toEqual([])
  })
})
