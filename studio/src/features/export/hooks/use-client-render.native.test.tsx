import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SideWorkScheduler } from '@/studio/side-work/scheduler'
import { SourceError } from '@/studio/render/source-error'
import type { ExportSettings } from '@/types/export'

/**
 * A master preset's export (task 3.4): through the desktop's native encoder. The save dialog is asked first and its
 * path is handed to `runRender` as the `native` target (the shell granted it to the encoder); WebCodecs is not
 * asked about anything; the file is the encoder's, so the result has no bytes, and the dialog gets its real size.
 */

const mocks = vi.hoisted(() => ({
  smartCopy: vi.fn(),
  resolve: vi.fn(),
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
    clientSettings: {
      container: 'mp4',
      codec: 'hevc',
      subtitleMode: mocks.order.includes('sidecar') ? 'sidecar' : 'burn',
      resolution: { width: 1920, height: 1080 },
    },
    exportMode: 'video',
    renderWholeProject: true,
  })),
  resolveClientSettings: mocks.resolve,
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

const settings = { codec: 'h265', videoBitrate: 80_000_000 } as ExportSettings
const MASTER_PATH = '/Users/pilot/Movies/master.mp4'

function chosenNative(nativePath: string | null = MASTER_PATH) {
  return {
    status: 'chosen',
    destination: {
      output: { kind: 'desktop-file', id: 'exp-n' },
      label: MASTER_PATH,
      nativePath,
      commit: mocks.commit,
      discard: mocks.discard,
    },
  }
}

describe('useClientRender for a master preset (the native encoder)', () => {
  beforeEach(() => {
    for (const mock of [mocks.smartCopy, mocks.runRender, mocks.choose, mocks.commit, mocks.discard, mocks.resolve]) {
      mock.mockReset()
    }
    mocks.order.length = 0
    mocks.choose.mockResolvedValue(chosenNative())
    mocks.commit.mockResolvedValue(48_113_920)
    mocks.discard.mockResolvedValue(undefined)
    mocks.runRender.mockResolvedValue({
      // What the native render answers: no bytes, the file is where the encoder wrote it
      result: { blob: new Blob([]), mimeType: 'video/mp4', duration: 3, fileSize: 0 },
      renderPath: 'worker',
    })
  })

  it('asks for a native save, passes the chosen path to runRender as `native`, and touches neither smart copy nor WebCodecs', async () => {
    const { result } = renderHook(() => useClientRender())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.startExport(settings, { nativeFormat: 'hevc-main10' })
    })

    expect(outcome).toBe('finished')
    expect(mocks.choose).toHaveBeenCalledWith(expect.objectContaining({ container: 'mp4', native: true }))
    const args = mocks.runRender.mock.calls[0]?.[0] as {
      native: unknown
      clientSettings: { destination?: unknown }
    }
    expect(args.native).toEqual({ format: 'hevc-main10', path: MASTER_PATH, bitrate: 80_000_000 })
    expect(args.clientSettings.destination).toBeUndefined()
    expect(mocks.smartCopy).not.toHaveBeenCalled()
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('writes ProRes to a .mov: the container the master stands for', async () => {
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport({ codec: 'prores', videoBitrate: 500_000_000 } as ExportSettings, {
        nativeFormat: 'prores-422-hq',
      })
    })
    expect(mocks.choose).toHaveBeenCalledWith(expect.objectContaining({ container: 'mov', native: true }))
    const args = mocks.runRender.mock.calls[0]?.[0] as { native: { format: string } }
    expect(args.native.format).toBe('prores-422-hq')
  })

  it('completes with the real file size and the path, and no download (the blob is empty)', async () => {
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings, { nativeFormat: 'hevc-main10' })
    })
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    expect(mocks.discard).not.toHaveBeenCalled()
    expect(result.current.status).toBe('completed')
    expect(result.current.savedTo).toBe(MASTER_PATH)
    expect(result.current.result?.fileSize).toBe(48_113_920)
    expect(result.current.result?.directOutput).toBe(true)
  })

  it('commits only after the render has ended', async () => {
    const order: string[] = []
    mocks.runRender.mockImplementation(async () => {
      order.push('render')
      return { result: { blob: new Blob([]), mimeType: 'video/mp4', duration: 3, fileSize: 0 }, renderPath: 'worker' }
    })
    mocks.commit.mockImplementation(async () => {
      order.push('commit')
      return 1
    })
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings, { nativeFormat: 'hevc-main10' })
    })
    expect(order).toEqual(['render', 'commit'])
  })

  it('shows a SourceError (a clip with no file path) as it is, and discards the grant', async () => {
    const failure = new SourceError({ clip: 'DJI_0020', mediaId: 'm1', reason: 'it has no file path on disk', frame: 0 })
    mocks.runRender.mockRejectedValue(failure)
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings, { nativeFormat: 'hevc-main10' })
    })
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toBe(failure.message)
    expect(mocks.discard).toHaveBeenCalledTimes(1)
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(result.current.savedTo).toBeNull()
  })

  it('discards on a cancel and completes nothing', async () => {
    mocks.runRender.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Render cancelled', 'AbortError')))
        }),
    )
    const { result } = renderHook(() => useClientRender())
    let exporting: Promise<unknown> = Promise.resolve()
    act(() => {
      exporting = result.current.startExport(settings, { nativeFormat: 'prores-422-hq' })
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

  it('discards when completing fails (the encoder left no file) and says why', async () => {
    mocks.commit.mockRejectedValue(new Error('export: the encoder left no file at "/x.mp4"'))
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings, { nativeFormat: 'hevc-main10' })
    })
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toContain('left no file')
    expect(mocks.discard).toHaveBeenCalledTimes(1)
  })

  it('starts nothing when the user closes the save dialog', async () => {
    mocks.choose.mockResolvedValue({ status: 'declined' })
    const { result } = renderHook(() => useClientRender())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.startExport(settings, { nativeFormat: 'hevc-main10' })
    })
    expect(outcome).toBe('declined')
    expect(result.current.status).toBe('idle')
    expect(mocks.runRender).not.toHaveBeenCalled()
  })

  it('stops with a plain sentence where there is no desktop app, and renders nothing', async () => {
    mocks.choose.mockResolvedValue({ status: 'unsupported' })
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings, { nativeFormat: 'hevc-main10' })
    })
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toContain('desktop app')
    expect(mocks.runRender).not.toHaveBeenCalled()
  })

  it('leaves a destination that is not native alone: no render, the grant is given back', async () => {
    mocks.choose.mockResolvedValue(chosenNative(null))
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings, { nativeFormat: 'hevc-main10' })
    })
    expect(result.current.status).toBe('failed')
    expect(mocks.discard).toHaveBeenCalledTimes(1)
    expect(mocks.runRender).not.toHaveBeenCalled()
  })
})
