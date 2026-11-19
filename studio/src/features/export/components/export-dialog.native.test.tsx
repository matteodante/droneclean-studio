import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ClientCodec } from '../deps/renderer'
import { ExportDialog } from './export-dialog'

/**
 * The masters in the dialog (task 3.4): "Master ProRes" and "Master HEVC 10-bit" appear only where the desktop's
 * native encoder is offered, choosing one runs the export through it, and its finished file shows its real size.
 */

/** What the mocked render hook reports; a test changes it and renders again. */
const hookState = {
  status: 'idle',
  error: null as string | null,
  result: null as object | null,
  savedTo: null as string | null,
}

const mockStartExport = vi.fn()
const mockCancelExport = vi.fn()
const mockDownloadVideo = vi.fn()
const mockResetState = vi.fn()
const mockGetSupportedCodecs = vi.fn<(...args: unknown[]) => Promise<ClientCodec[]>>()

vi.mock('../hooks/use-client-render', () => ({
  useClientRender: () => ({
    isExporting: false,
    progress: 0,
    renderedFrames: undefined,
    totalFrames: undefined,
    status: hookState.status,
    error: hookState.error,
    result: hookState.result,
    savedTo: hookState.savedTo,
    startExport: mockStartExport,
    cancelExport: mockCancelExport,
    downloadVideo: mockDownloadVideo,
    resetState: mockResetState,
    getSupportedCodecs: mockGetSupportedCodecs,
    estimateFileSize: vi.fn(),
  }),
}))

vi.mock('@/features/export/deps/projects', () => ({
  useProjectStore: (
    selector: (state: {
      currentProject: { metadata: { width: number; height: number } }
    }) => unknown,
  ) =>
    selector({
      currentProject: {
        metadata: {
          width: 1920,
          height: 1080,
        },
      },
    }),
}))

// An empty test timeline would fail the real preflight; the gate under test here is the save dialog's.
vi.mock('../utils/export-preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/export-preflight')>()),
  assessExportPreflight: async () => ({ checks: [] }),
}))

const native = vi.hoisted(() => ({
  bridge: false,
  formats: ['hevc-main10', 'prores-422-hq'] as string[],
}))
vi.mock('@/studio/export/native-capabilities', () => ({
  hasNativeExportBridge: () => native.bridge,
  readNativePresetCapabilities: async () =>
    native.bridge
      ? { nativeEncoder: true, nativeFormats: native.formats }
      : { nativeEncoder: false },
}))

vi.mock('./export-preview-player', () => ({
  ExportPreviewPlayer: () => <div data-testid="export-preview-player" />,
}))

describe('ExportDialog masters', () => {
  beforeEach(() => {
    mockStartExport.mockReset()
    mockResetState.mockReset()
    mockGetSupportedCodecs.mockReset()
    // The browser can encode nothing of what a master is (10-bit, ProRes): the desktop's FFmpeg does.
    mockGetSupportedCodecs.mockResolvedValue(['avc'])
    hookState.status = 'idle'
    hookState.error = null
    hookState.result = null
    hookState.savedTo = null
    native.bridge = false
    native.formats = ['hevc-main10', 'prores-422-hq']
    if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {}
  })

  it('offers neither master in the browser build, and says why in plain words', async () => {
    render(<ExportDialog open onClose={() => {}} />)
    await screen.findByText('Preset')
    expect(screen.queryByRole('button', { name: 'Master ProRes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Master HEVC 10-bit' })).toBeNull()
    expect(screen.getByText(/no ProRes and no 10-bit/)).toBeInTheDocument()
  })

  it('offers both in the desktop app, with no web limit note', async () => {
    native.bridge = true
    render(<ExportDialog open onClose={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Master ProRes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Master HEVC 10-bit' })).toBeInTheDocument()
    expect(screen.queryByText(/no ProRes and no 10-bit/)).toBeNull()
  })

  it('offers only the master the shell’s FFmpeg can write', async () => {
    native.bridge = true
    native.formats = ['hevc-main10']
    render(<ExportDialog open onClose={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Master HEVC 10-bit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Master ProRes' })).toBeNull()
  })

  it('exports a chosen master through the native encoder, with the project size and the shown bitrate', async () => {
    native.bridge = true
    mockStartExport.mockResolvedValue('finished')
    render(<ExportDialog open onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Master HEVC 10-bit' }))

    expect(screen.getByTestId('export-preset-numbers')).toHaveTextContent(/H\.265 · .* Mbps · 10-bit/)
    // WebCodecs can encode neither 10-bit nor this bitrate: the export stays available, it is not WebCodecs' to judge.
    const exportButton = screen.getByRole('button', { name: 'Export Video' })
    await waitFor(() => expect(exportButton).toBeEnabled())
    fireEvent.click(exportButton)

    await waitFor(() => expect(mockStartExport).toHaveBeenCalledTimes(1))
    const [settings, options] = mockStartExport.mock.calls[0] as [
      { codec: string; videoContainer: string; resolution: { width: number; height: number }; smartCopy: boolean },
      unknown,
    ]
    expect(options).toEqual({ nativeFormat: 'hevc-main10' })
    expect(settings).toMatchObject({
      codec: 'h265',
      videoContainer: 'mp4',
      resolution: { width: 1920, height: 1080 },
      smartCopy: false,
    })
  })

  it('writes ProRes 422 HQ to a .mov, shown as ProRes at 10 bits', async () => {
    native.bridge = true
    mockStartExport.mockResolvedValue('finished')
    render(<ExportDialog open onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Master ProRes' }))
    expect(screen.getByTestId('export-preset-numbers')).toHaveTextContent(/ProRes · .* Mbps · 10-bit/)
    fireEvent.click(screen.getByRole('button', { name: 'Export Video' }))

    await waitFor(() => expect(mockStartExport).toHaveBeenCalledTimes(1))
    const [settings, options] = mockStartExport.mock.calls[0] as [{ codec: string; videoContainer: string; proResProfile: string }, unknown]
    expect(options).toEqual({ nativeFormat: 'prores-422-hq' })
    expect(settings).toMatchObject({ codec: 'prores', videoContainer: 'mov', proResProfile: 'hq' })
  })

  it('keeps the settings from drifting back to a WebCodecs codec while a master is chosen', async () => {
    native.bridge = true
    mockStartExport.mockResolvedValue('finished')
    render(<ExportDialog open onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Master ProRes' }))
    // let the codec probe answer: it rules ProRes out for WebCodecs, which must not rewrite a master's codec
    await waitFor(() => expect(mockGetSupportedCodecs).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('button', { name: 'Master ProRes' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not offer the render queue for a master, and a plain preset gets it back', async () => {
    native.bridge = true
    render(<ExportDialog open onClose={() => {}} />)
    expect(await screen.findByRole('button', { name: /Add to queue/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Master HEVC 10-bit' }))
    expect(screen.queryByRole('button', { name: /Add to queue/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'YouTube 4K' }))
    expect(await screen.findByRole('button', { name: /Add to queue/ })).toBeInTheDocument()
  })

  it('shows the real size and the path of a finished master, and no download', async () => {
    native.bridge = true
    mockStartExport.mockResolvedValue('finished')
    const view = render(<ExportDialog open onClose={() => {}} />)
    await waitFor(() => expect(mockGetSupportedCodecs).toHaveBeenCalled())

    hookState.status = 'completed'
    hookState.savedTo = '/Users/pilot/Movies/master.mov'
    hookState.result = {
      blob: new Blob([]),
      mimeType: 'video/quicktime',
      duration: 3,
      fileSize: 48_113_920,
      directOutput: true,
    }
    view.rerender(<ExportDialog open onClose={() => {}} />)

    expect(await screen.findByText('Saved to /Users/pilot/Movies/master.mov')).toBeInTheDocument()
    expect(screen.getByText('45.89 MB')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
  })
})
