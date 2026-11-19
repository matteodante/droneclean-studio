import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useFillerRemovalDialogStore } from '../stores/filler-removal-dialog-store'
import { DEFAULT_FILLER_REMOVAL_SETTINGS } from '../utils/filler-word-removal-preview'
import { FillerRemovalDialog } from './filler-removal-dialog'

const { analyzeFillerWordsForItemsMock } = vi.hoisted(() => ({
  analyzeFillerWordsForItemsMock: vi.fn(),
}))

vi.mock('../utils/filler-word-removal-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/filler-word-removal-preview')>()
  return { ...actual, analyzeFillerWordsForItems: analyzeFillerWordsForItemsMock }
})

vi.mock('@/shared/utils/local-model-cache', () => ({
  hasCachedModelEntries: vi.fn(async () => true),
  TRANSFORMERS_CACHE_NAME: 'transformers-cache',
}))

vi.mock('@/components/ui/floating-panel', () => ({
  FloatingPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

describe('FillerRemovalDialog', () => {
  beforeEach(() => {
    analyzeFillerWordsForItemsMock.mockReset()
    analyzeFillerWordsForItemsMock.mockResolvedValue({
      'media-1': [{ start: 1, end: 1.4, text: 'um' }],
    })
  })

  it('names the model and its size, and downloads nothing until Update Preview', async () => {
    useFillerRemovalDialogStore.getState().open({
      itemIds: ['audio-1'],
      settings: DEFAULT_FILLER_REMOVAL_SETTINGS,
      pendingDownload: { modelLabel: 'Parakeet', sizeLabel: '1.24 GB' },
    })
    render(<FillerRemovalDialog />)

    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Parakeet')
    expect(note).toHaveTextContent('1.24 GB')
    expect(analyzeFillerWordsForItemsMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Update Preview' }))

    await waitFor(() => expect(analyzeFillerWordsForItemsMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument())
  })

  it('shows readable preset and confidence labels, never a raw translation key', async () => {
    useFillerRemovalDialogStore.getState().open({
      itemIds: ['audio-1'],
      settings: DEFAULT_FILLER_REMOVAL_SETTINGS,
      rangesByMediaId: {
        'media-1': [
          {
            start: 1,
            end: 1.4,
            text: 'um',
            audioConfidence: {
              level: 'high',
              score: 0.9,
              fillerScore: 0.9,
              nonFillerScore: 0.1,
              label: 'filler',
            },
          },
        ],
      },
      summary: { rangeCount: 1, totalSeconds: 0.4 },
    })
    const { container } = render(<FillerRemovalDialog />)

    expect(await screen.findByRole('button', { name: 'Conservative' })).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/timeline\.fillerRemoval\./)
  })

  it('scrolls its body so the action row stays reachable in a short window', async () => {
    useFillerRemovalDialogStore.getState().open({ itemIds: ['audio-1'] })
    render(<FillerRemovalDialog />)

    const scoreAudio = await screen.findByRole('button', { name: 'Score Audio' })
    const footer = scoreAudio.parentElement as HTMLElement
    const section = screen.getByRole('dialog')
    expect(section.className).toMatch(/max-h-\[calc\(100vh-/)
    expect(footer.className).toMatch(/shrink-0/)
    const body = footer.previousElementSibling as HTMLElement
    expect(body.className).toMatch(/overflow-y-auto/)
  })
})
