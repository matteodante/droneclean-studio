import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SourceError } from '@/studio/render/source-error'
import { StageError } from '@/studio/render/stages/types'
import type { ClientCodec } from '../deps/renderer'
import { ExportDialog } from './export-dialog'

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

vi.mock('./export-preview-player', () => ({
  ExportPreviewPlayer: () => <div data-testid="export-preview-player" />,
}))

describe('ExportDialog', () => {
  beforeEach(() => {
    mockStartExport.mockReset()
    mockCancelExport.mockReset()
    mockDownloadVideo.mockReset()
    mockResetState.mockReset()
    mockGetSupportedCodecs.mockReset()
    hookState.status = 'idle'
    hookState.error = null
    hookState.result = null
    hookState.savedTo = null

    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {}
    }
  })

  it('defaults to mp4 with H.264 codec', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])

    render(<ExportDialog open onClose={() => {}} />)

    await waitFor(() => {
      expect(mockGetSupportedCodecs).toHaveBeenCalledWith({
        resolution: { width: 1920, height: 1080 },
        bitrate: 3_000_000,
      })
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Format')).toHaveTextContent('MP4')
      expect(screen.getByLabelText('Codec')).toHaveTextContent('H.264')
    })
  })

  it('disables unsupported format and codec choices in the browser capability matrix', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])

    render(<ExportDialog open onClose={() => {}} />)

    await waitFor(() => {
      expect(mockGetSupportedCodecs).toHaveBeenCalled()
    })

    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'ArrowDown' })

    const webmOption = await screen.findByRole('option', { name: /WebM/i })
    expect(webmOption).toHaveAttribute('data-disabled')

    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByLabelText('Codec'), { key: 'ArrowDown' })

    const h265Option = await screen.findByRole('option', { name: /H\.265/i })
    expect(h265Option).toHaveAttribute('data-disabled')
  })

  it.each([
    [
      'SourceError',
      new SourceError({ clip: 'DJI_0020', mediaId: 'm1', reason: 'the file is gone', frame: 12 }),
    ],
    [
      'StageError',
      new StageError({ clip: 'DJI_0020', stage: 'stabilize', sourceIndex: 4, reason: 'no gyro data' }),
    ],
  ])('shows the message of a %s word for word', async (_name, failure) => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])
    mockStartExport.mockResolvedValue('finished')
    const view = render(<ExportDialog open onClose={() => {}} />)
    await waitFor(() => expect(mockGetSupportedCodecs).toHaveBeenCalled())

    hookState.status = 'failed'
    hookState.error = failure.message
    view.rerender(<ExportDialog open onClose={() => {}} />)

    expect(await screen.findByText(failure.message)).toBeInTheDocument()
  })

  it('goes back to the settings when the user closes the save dialog', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])
    mockStartExport.mockResolvedValue('declined')
    render(<ExportDialog open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Format')).toHaveTextContent('MP4'))

    const exportButton = await screen.findByRole('button', { name: 'Export Video' })
    await waitFor(() => expect(exportButton).toBeEnabled())
    fireEvent.click(exportButton)

    await waitFor(() => expect(mockStartExport).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: 'Export Video' })).toBeInTheDocument()
    expect(screen.getByLabelText('Format')).toBeInTheDocument()
  })

  it('says where the file was saved and offers no download for it', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])
    mockStartExport.mockResolvedValue('finished')
    const view = render(<ExportDialog open onClose={() => {}} />)
    await waitFor(() => expect(mockGetSupportedCodecs).toHaveBeenCalled())

    hookState.status = 'completed'
    hookState.savedTo = '/Users/pilot/Movies/flight.mp4'
    hookState.result = {
      blob: new Blob([]),
      mimeType: 'video/mp4',
      duration: 1,
      fileSize: 765_000_000,
      directOutput: true,
    }
    view.rerender(<ExportDialog open onClose={() => {}} />)

    expect(await screen.findByText(/\/Users\/pilot\/Movies\/flight\.mp4/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    expect(screen.queryByTestId('export-preview-player')).toBeNull()
  })
})
