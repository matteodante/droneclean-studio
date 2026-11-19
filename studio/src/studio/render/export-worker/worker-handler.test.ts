// FreeCut's export worker (`workers/export-render.worker.ts`) with the export worker's worker half hooked in: what it
// posts back for a StageError, a cancel and a finished export, and when it refuses sound (design 3.6 section 2.15).
// The renderers are fakes; the test environment, like a worker, has no `OfflineAudioContext`.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SourceError } from '@/studio/render/source-error'
import { StageError } from '@/studio/render/stages/types'
import { timedStage } from '@/studio/render/timings'
import type { CompositionInputProps } from '@/types/export'
import type { MediaMetadata } from '@/types/storage'
import type { StudioWorkerRequest, StudioWorkerResponse, WorkerExportStart } from './protocol'

const { renderComposition } = vi.hoisted(() => ({ renderComposition: vi.fn() }))
vi.mock('@/runtime/renderer/canvas-render-orchestrator', () => ({
  renderComposition,
  renderAudioOnly: vi.fn(),
}))

const posted: StudioWorkerResponse[] = []
const postSpy = vi
  .spyOn(self, 'postMessage')
  .mockImplementation((message: unknown) => posted.push(message as StudioWorkerResponse))
await import('@/runtime/renderer/workers/export-render.worker')
const handle = self.onmessage as (event: MessageEvent<StudioWorkerRequest>) => Promise<void>

const RESULT = { blob: new Blob(['x']), mimeType: 'video/mp4', duration: 1, fileSize: 1 }

function media(id: string, audioCodec?: string): MediaMetadata {
  return { id, mimeType: 'video/mp4', ...(audioCodec ? { audioCodec } : {}) } as MediaMetadata
}

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

function startWith(studio: Partial<WorkerExportStart> | undefined, requestId = 'r1') {
  const message: StudioWorkerRequest = {
    type: 'start',
    requestId,
    settings: { mode: 'video' } as never,
    composition: composition(),
    ...(studio === undefined
      ? {}
      : {
          studio: {
            projectFps: 30,
            derivedSizes: [],
            media: [],
            objectUrls: [],
            engines: null,
            timings: false,
            ...studio,
          },
        }),
  }
  return handle({ data: message } as MessageEvent<StudioWorkerRequest>)
}

beforeEach(() => {
  posted.length = 0
  renderComposition.mockReset()
})

afterAll(() => {
  postSpy.mockRestore()
})

describe('the export worker’s answers', () => {
  it('posts a StageError with its fields, so the page rejects with the same named error', async () => {
    const raised = new StageError({ clip: 'DJI_0020', stage: 'stabilize', sourceIndex: 5, reason: 'no data' })
    renderComposition.mockRejectedValue(raised)
    await startWith({ media: [media('m1')] })
    expect(posted.at(-1)).toEqual({
      type: 'error',
      requestId: 'r1',
      error: raised.message,
      failure: {
        name: 'StageError',
        message: raised.message,
        stage: { clip: 'DJI_0020', stage: 'stabilize', sourceIndex: 5 },
      },
    })
  })

  it('posts a SourceError with its fields: a clip the worker could not open stops the export, named', async () => {
    const raised = new SourceError({
      clip: 'DJI_0020',
      mediaId: 'm1',
      frame: 0,
      reason: 'the file was never opened',
    })
    renderComposition.mockRejectedValue(raised)
    await startWith({ media: [media('m1')] })
    expect(posted.at(-1)).toEqual({
      type: 'error',
      requestId: 'r1',
      error: raised.message,
      failure: {
        name: 'SourceError',
        message: raised.message,
        source: { clip: 'DJI_0020', mediaId: 'm1', reason: 'the file was never opened', frame: 0 },
      },
    })
  })

  it('renders a clip whose media has no sound, though the worker has no Web Audio', async () => {
    renderComposition.mockResolvedValue(RESULT)
    await startWith({ media: [media('m1')] })
    expect(renderComposition).toHaveBeenCalledTimes(1)
    expect(posted.at(-1)).toMatchObject({ type: 'complete', requestId: 'r1', result: RESULT })
  })

  it('refuses sound it cannot mix here, as FreeCut did: the page then renders it', async () => {
    await startWith({ media: [media('m1', 'aac')] })
    expect(renderComposition).not.toHaveBeenCalled()
    expect(posted.at(-1)).toMatchObject({
      type: 'error',
      error: 'WORKER_REQUIRES_MAIN_THREAD:audio-context',
    })
    // A page that sent nothing about the media: the clip may carry sound
    posted.length = 0
    await startWith(undefined)
    expect(posted.at(-1)).toMatchObject({ error: 'WORKER_REQUIRES_MAIN_THREAD:audio-context' })
  })

  it('sends the stage marks back with the result when the page asked for them', async () => {
    renderComposition.mockImplementation(async () => {
      timedStage('encode', () => undefined, 2)
      return RESULT
    })
    await startWith({ media: [media('m1')], timings: true })
    const complete = posted.at(-1)
    expect(complete?.type).toBe('complete')
    if (complete?.type !== 'complete') throw new Error('unreachable')
    expect(complete.timings?.marks.map((mark) => mark.name)).toEqual(['dc.encode'])
  })

  it('stops on cancel and says so', async () => {
    renderComposition.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Render cancelled', 'AbortError')),
          )
        }),
    )
    const running = startWith({ media: [media('m1')] }, 'r2')
    await vi.waitFor(() => expect(renderComposition).toHaveBeenCalled())
    await handle({ data: { type: 'cancel', requestId: 'r2' } } as MessageEvent<StudioWorkerRequest>)
    await running
    expect(posted.at(-1)).toEqual({ type: 'cancelled', requestId: 'r2' })
  })
})
