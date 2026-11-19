import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SideWorkScheduler } from '@/studio/side-work/scheduler'
import type { ExportSettings } from '@/types/export'

const mocks = vi.hoisted(() => ({
  scheduler: null as unknown as SideWorkScheduler,
  smartCopy: vi.fn(),
}))

vi.mock('@/studio/side-work', () => ({ getSideWork: () => mocks.scheduler }))
vi.mock('../utils/smart-copy', () => ({ trySmartCopyExport: mocks.smartCopy }))
vi.mock('../utils/timeline-to-composition', () => ({ convertTimelineToComposition: vi.fn() }))
vi.mock('../deps/renderer', () => ({
  mapToClientSettings: vi.fn(),
  getSupportedCodecs: vi.fn(),
  formatBytes: (n: number) => `${n} B`,
  estimateFileSize: vi.fn(),
  getVideoBitrateForQuality: vi.fn(),
  isExtendedSettings: vi.fn(() => false),
  mapRequestedClientSettings: vi.fn(() => ({
    clientSettings: {},
    exportMode: 'video',
    renderWholeProject: true,
  })),
  resolveClientSettings: vi.fn(),
  runRender: vi.fn(),
  buildTranscriptSubtitleCues: vi.fn(),
  releaseTemporaryExportOutput: vi.fn(async () => {}),
  // No way to ask where the file goes: the old scratch-file route, which these tests are about.
  chooseExportDestination: vi.fn(async () => ({ status: 'unsupported' })),
  writeBlobToDestination: vi.fn(),
  containerForMimeType: vi.fn(() => null),
}))
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
vi.mock('@/features/export/deps/media-library', () => ({ resolveMediaUrls: vi.fn() }))

import { useClientRender } from './use-client-render'

const settings = {} as ExportSettings

describe('useClientRender and the side-work scheduler', () => {
  beforeEach(() => {
    mocks.scheduler = new SideWorkScheduler()
    mocks.smartCopy.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('holds the scheduler while it exports and releases it when the export finishes', async () => {
    let finish: (value: unknown) => void = () => {}
    mocks.smartCopy.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const { result } = renderHook(() => useClientRender())
    expect(mocks.scheduler.isHeld()).toBe(false)

    let exporting: Promise<unknown> = Promise.resolve()
    act(() => {
      exporting = result.current.startExport(settings)
    })
    expect(result.current.isExporting).toBe(true)
    expect(mocks.scheduler.isHeld()).toBe(true)

    await act(async () => {
      finish({ result: { blob: new Blob(), fileSize: 1, duration: 1 } })
      await exporting
    })
    expect(result.current.status).toBe('completed')
    expect(mocks.scheduler.isHeld()).toBe(false)
  })

  it('releases the scheduler when the export fails', async () => {
    mocks.smartCopy.mockRejectedValue(new Error('encoder lost'))
    const { result } = renderHook(() => useClientRender())
    await act(async () => {
      await result.current.startExport(settings)
    })
    expect(result.current.status).toBe('failed')
    expect(result.current.isExporting).toBe(false)
    expect(mocks.scheduler.isHeld()).toBe(false)
  })

  it('releases the scheduler when the export is cancelled', async () => {
    mocks.smartCopy.mockImplementation(
      (_input: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('cancelled', 'AbortError')),
          )
        }),
    )
    const { result } = renderHook(() => useClientRender())
    let exporting: Promise<unknown> = Promise.resolve()
    act(() => {
      exporting = result.current.startExport(settings)
    })
    expect(mocks.scheduler.isHeld()).toBe(true)

    await act(async () => {
      result.current.cancelExport()
      await exporting
    })
    expect(result.current.status).toBe('cancelled')
    expect(mocks.scheduler.isHeld()).toBe(false)
  })

  it('releases the scheduler when the page goes away mid-export', () => {
    mocks.smartCopy.mockImplementation(() => new Promise(() => {}))
    const { result, unmount } = renderHook(() => useClientRender())
    act(() => {
      void result.current.startExport(settings)
    })
    expect(mocks.scheduler.isHeld()).toBe(true)
    unmount()
    expect(mocks.scheduler.isHeld()).toBe(false)
  })
})
