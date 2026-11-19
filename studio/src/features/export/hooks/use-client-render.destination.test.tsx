import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SideWorkScheduler } from '@/studio/side-work/scheduler'
import { SourceError } from '@/studio/render/source-error'
import { StageError } from '@/studio/render/stages/types'
import type { ExportSettings } from '@/types/export'

/**
 * Where the export goes (task 3.5): the file is asked for before the work starts, the muxer streams
 * into it, and it is completed at the end or thrown away on a failure or a cancel.
 */

const mocks = vi.hoisted(() => ({
  smartCopy: vi.fn(),
  runRender: vi.fn(),
  choose: vi.fn(),
  writeBlob: vi.fn(),
  commit: vi.fn(),
  discard: vi.fn(),
  order: [] as string[],
}))

vi.mock('@/studio/side-work', () => ({ getSideWork: () => new SideWorkScheduler() }))
vi.mock('../utils/smart-copy', () => ({ trySmartCopyExport: mocks.smartCopy }))
vi.mock('../utils/timeline-to-composition', () => ({
  convertTimelineToComposition: vi.fn(() => ({ tracks: [], durationInFrames: 30 })),
}))
vi.mock('../deps/renderer', () => ({
  mapToClientSettings: vi.fn(),
  getSupportedCodecs: vi.fn(),
  formatBytes: (n: number) => `${n} B`,
  estimateFileSize: vi.fn(),
  getVideoBitrateForQuality: vi.fn(),
  isExtendedSettings: vi.fn(() => false),
  mapRequestedClientSettings: vi.fn(() => ({
    clientSettings: { container: 'mp4' },
    exportMode: 'video',
    renderWholeProject: true,
  })),
  resolveClientSettings: vi.fn(async () => ({
    clientSettings: {
      container: 'mp4',
      codec: 'avc',
      subtitleMode: mocks.order.includes('sidecar') ? 'sidecar' : 'burn',
      resolution: { width: 1920, height: 1080 },
    },
  })),
  runRender: mocks.runRender,
  buildTranscriptSubtitleCues: vi.fn(() => [{ startMs: 0, endMs: 1000, text: 'hi' }]),
  releaseTemporaryExportOutput: vi.fn(async () => {}),
  chooseExportDestination: mocks.choose,
  writeBlobToDestination: mocks.writeBlob,
  containerForMimeType: (mime: string) => (mime.includes('mp4') ? 'mp4' : null),
}))
vi.mock('@/shared/utils/subtitles', () => ({ serializeSrt: () => 'SRT TEXT' }))
vi.mock('@/features/export/deps/timeline', () => {
  const store = (state: object) => ({ getState: () => state })
  return {
    useItemsStore: store({ tracks: [], items: [] }),
    useTransitionsStore: store({ transitions: [] }),
    useKeyframesStore: store({ keyframes: [] }),
    useMarkersStore: store({ inPoint: null, outPoint: null }),
    useTimelineSettingsStore: store({ fps: 30 }),
  }
})
vi.mock('@/features/export/deps/projects', () => ({
  useProjectStore: { getState: () => ({ currentProject: null }) },
}))
vi.mock('@/features/export/deps/media-library', () => ({
  resolveMediaUrls: vi.fn(async (tracks: unknown) => tracks),
}))

import { useClientRender } from './use-client-render'

const settings = {} as ExportSettings
const DESTINATION = { kind: 'desktop-file', id: 'exp-1' } as const

function chosenDestination() {
  return {
    status: 'chosen',
    destination: {
      output: DESTINATION,
      label: '/Users/pilot/Movies/flight.mp4',
      commit: mocks.commit,
      discard: mocks.discard,
    },
  }
}

describe('useClientRender with a destination file', () => {
  beforeEach(() => {
    for (const mock of [mocks.smartCopy, mocks.runRender, mocks.choose, mocks.writeBlob, mocks.commit, mocks.discard]) {
      mock.mockReset()
    }
    mocks.order.length = 0
    mocks.smartCopy.mockResolvedValue({ assessment: {} })
    mocks.choose.mockResolvedValue(chosenDestination())
    mocks.commit.mockResolvedValue(undefined)
    mocks.discard.mockResolvedValue(undefined)
    mocks.runRender.mockResolvedValue({
      result: { blob: new Blob([]), mimeType: 'video/mp4', duration: 1, fileSize: 765, directOutput: true },
      renderPath: 'worker',
    })
  })

  it('asks for the file first, hands the renderer its destination, and completes the file at the end', async () => {
    const { result } = renderHook(() => useClientRender())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.startExport(settings)
    })

    expect(outcome).toBe('finished')
    expect(mocks.choose).toHaveBeenCalledWith(expect.objectContaining({ container: 'mp4' }))
    const renderArgs = mocks.runRender.mock.calls[0]?.[0] as { clientSettings: { destination: unknown } }
    expect(renderArgs.clientSettings.destination).toEqual(DESTINATION)
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    expect(mocks.commit).toHaveBeenCalledWith(undefined)
    expect(mocks.discard).not.toHaveBeenCalled()
    expect(result.current.status).toBe('completed')
    expect(result.current.savedTo).toBe('/Users/pilot/Movies/flight.mp4')
    expect(result.current.result?.directOutput).toBe(true)
    expect(result.current.result?.fileSize).toBe(765)
  })

  it('commits only after the render has ended', async () => {
    const order: string[] = []
    mocks.runRender.mockImplementation(async () => {
      order.push('render')
      return {
        result: { blob: new Blob([]), mimeType: 'video/mp4', duration: 1, fileSize: 1, directOutput: true },
        renderPath: 'worker',
      }
    })
    mocks.commit.mockImplementation(async () => {
      order.push('commit')
    })
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings)
    })
    expect(order).toEqual(['render', 'commit'])
  })

  it('hands the subtitle sidecar to the commit, beside the video, instead of offering a download', async () => {
    mocks.order.push('sidecar')
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings)
    })
    expect(mocks.commit).toHaveBeenCalledWith({ content: 'SRT TEXT' })
    expect(result.current.result?.subtitleSidecar).toBeUndefined()
  })

  it.each([
    ['a SourceError', new SourceError({ clip: 'DJI_0020', mediaId: 'm1', reason: 'the file is gone', frame: 12 })],
    ['a StageError', new StageError({ clip: 'DJI_0020', stage: 'stabilize', sourceIndex: 4, reason: 'no gyro data' })],
    ['any other error', new Error('encoder lost')],
  ])('throws the file away and shows the message verbatim when %s stops the export', async (_name, failure) => {
    mocks.runRender.mockRejectedValue(failure)
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings)
    })
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toBe(failure.message)
    expect(mocks.discard).toHaveBeenCalledTimes(1)
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(result.current.savedTo).toBeNull()
  })

  it('throws the file away when the export is cancelled', async () => {
    mocks.runRender.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Render cancelled', 'AbortError')))
        }),
    )
    const { result } = renderHook(() => useClientRender())
    let exporting: Promise<unknown> = Promise.resolve()
    act(() => {
      exporting = result.current.startExport(settings)
    })
    await vi.waitFor(() => expect(mocks.runRender).toHaveBeenCalled())
    await act(async () => {
      result.current.cancelExport()
      await exporting
    })
    expect(result.current.status).toBe('cancelled')
    expect(mocks.discard).toHaveBeenCalledTimes(1)
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('throws the file away when completing it fails, and says why', async () => {
    mocks.commit.mockRejectedValue(new Error('could not move the finished export to "/x.mp4": EACCES'))
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings)
    })
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toContain('EACCES')
    expect(mocks.discard).toHaveBeenCalledTimes(1)
  })

  it('starts nothing when the user closes the save dialog', async () => {
    mocks.choose.mockResolvedValue({ status: 'declined' })
    const { result } = renderHook(() => useClientRender())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.startExport(settings)
    })
    expect(outcome).toBe('declined')
    expect(result.current.status).toBe('idle')
    expect(result.current.isExporting).toBe(false)
    expect(mocks.runRender).not.toHaveBeenCalled()
  })

  it('keeps the old scratch-file route where nothing can ask for a file', async () => {
    mocks.choose.mockResolvedValue({ status: 'unsupported' })
    mocks.runRender.mockResolvedValue({
      result: { blob: new Blob(['x']), mimeType: 'video/mp4', duration: 1, fileSize: 1 },
      renderPath: 'worker',
    })
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings)
    })
    const renderArgs = mocks.runRender.mock.calls[0]?.[0] as { clientSettings: { destination?: unknown } }
    expect(renderArgs.clientSettings.destination).toBeUndefined()
    expect(result.current.status).toBe('completed')
    expect(result.current.savedTo).toBeNull()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('writes a smart copy into the chosen file too', async () => {
    mocks.smartCopy.mockResolvedValue({
      assessment: {},
      result: { blob: new Blob(['source']), mimeType: 'video/mp4', duration: 3, fileSize: 6 },
    })
    mocks.writeBlob.mockResolvedValue(6)
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings)
    })
    expect(mocks.runRender).not.toHaveBeenCalled()
    expect(mocks.writeBlob).toHaveBeenCalledTimes(1)
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    expect(result.current.result?.directOutput).toBe(true)
    expect(result.current.savedTo).toBe('/Users/pilot/Movies/flight.mp4')
  })
})
