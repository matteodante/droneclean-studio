import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MouseEvent, ReactNode } from 'react'
import type { MediaMetadata } from '@/types/storage'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { useSubclipsStore, type CreateSubclipInput } from '@/studio/subclips'

const mediaState = vi.hoisted(() => ({
  mediaById: {} as Record<string, MediaMetadata>,
  viewMode: 'grid' as 'grid' | 'list',
  mediaItemSize: 3,
}))
const dragCache = vi.hoisted(() => ({ setMediaDragData: vi.fn(), clearMediaDragData: vi.fn() }))
const markDirty = vi.hoisted(() => vi.fn())
const editorState = vi.hoisted(() => ({ setSourcePreviewMediaId: vi.fn() }))
const posters = vi.hoisted(() => ({ getPosterUrl: vi.fn(), release: vi.fn(), clear: vi.fn() }))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void
    disabled?: boolean
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))
vi.mock('@/features/media-library/stores/media-library-store', () => ({
  useMediaLibraryStore: (selector: (state: typeof mediaState) => unknown) => selector(mediaState),
}))
vi.mock('@/features/media-library/utils/drag-data-cache', () => dragCache)
vi.mock('@/features/media-library/deps/timeline-stores', () => ({
  useTimelineSettingsStore: { getState: () => ({ markDirty }) },
}))
vi.mock('@/shared/state/editor', () => ({
  useEditorStore: { getState: () => editorState },
}))
vi.mock('@/studio/subclips/poster', () => ({ subclipPosters: posters }))
vi.mock('@/features/media-library/services/media-library-service-loader', () => ({
  importMediaLibraryService: vi.fn(async () => ({
    mediaLibraryService: { getThumbnailBlobUrl: vi.fn(async () => 'blob:parent-thumb') },
  })),
}))

import { SubclipsSection } from './subclips-section'
import { SubclipDeletionNotice } from './subclip-deletion-notice'

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'm1',
    storageType: 'handle',
    fileName: 'DJI_0020.MP4',
    fileSize: 1,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'hevc',
    bitrate: 1,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function addSubclip(overrides: Partial<CreateSubclipInput> = {}) {
  return useSubclipsStore.getState().create({
    mediaId: 'm1',
    name: 'Gap run',
    startFrame: 30,
    endFrame: 150,
    sourceFps: 30,
    ...overrides,
  })
}

function dragEvent() {
  const data: Record<string, string> = {}
  const dataTransfer = {
    setData: (type: string, value: string) => {
      data[type] = value
    },
    effectAllowed: '',
  }
  return { data, dataTransfer }
}

describe('SubclipsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSubclipsStore.getState().reset()
    useSourcePlayerStore.setState({
      marksByKey: {},
      currentMediaId: null,
      activeSubclipId: null,
      activeWindow: null,
      pendingSeekFrame: null,
    })
    mediaState.mediaById = { m1: makeMedia() }
    mediaState.viewMode = 'grid'
    posters.getPosterUrl.mockResolvedValue('blob:poster')
  })

  it('renders nothing when there are no subclips', () => {
    const { container } = render(<SubclipsSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each subclip with poster, name and duration at the parent rate', async () => {
    addSubclip()
    render(<SubclipsSection />)
    expect(screen.getByText('Subclips')).toBeInTheDocument()
    expect(screen.getByText('Gap run')).toBeInTheDocument()
    // 120 frames at 30 fps
    expect(screen.getByText('00:00:04:00')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Gap run' })).toHaveAttribute('src', 'blob:poster'),
    )
  })

  it('shows the parent thumbnail when no poster can be made', async () => {
    posters.getPosterUrl.mockResolvedValue(null)
    addSubclip()
    render(<SubclipsSection />)
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Gap run' })).toHaveAttribute(
        'src',
        'blob:parent-thumb',
      ),
    )
  })

  it('renames through the menu: the record changes and the project is marked changed', () => {
    const subclip = addSubclip()
    render(<SubclipsSection />)
    fireEvent.click(screen.getByText('Rename'))
    const input = screen.getByLabelText('Subclip name')
    fireEvent.change(input, { target: { value: '  Hoop dive ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useSubclipsStore.getState().subclips[0]).toMatchObject({
      id: subclip.id,
      name: 'Hoop dive',
    })
    expect(markDirty).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Hoop dive')).toBeInTheDocument()
  })

  it('keeps the name when the rename is cancelled or left empty', () => {
    addSubclip()
    render(<SubclipsSection />)
    fireEvent.click(screen.getByText('Rename'))
    fireEvent.change(screen.getByLabelText('Subclip name'), { target: { value: 'Other' } })
    fireEvent.keyDown(screen.getByLabelText('Subclip name'), { key: 'Escape' })
    expect(useSubclipsStore.getState().subclips[0]?.name).toBe('Gap run')
    fireEvent.click(screen.getByText('Rename'))
    fireEvent.change(screen.getByLabelText('Subclip name'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByLabelText('Subclip name'), { key: 'Enter' })
    expect(useSubclipsStore.getState().subclips[0]?.name).toBe('Gap run')
    expect(markDirty).not.toHaveBeenCalled()
  })

  it('deletes after confirming: only the record goes, with its poster and marks', async () => {
    const subclip = addSubclip()
    useSourcePlayerStore.getState().setMarksByKey({ [subclip.id]: { in: 40, out: null } })
    render(<SubclipsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByText(/The original file and the clips already on the timeline/),
    ).toBeInTheDocument()
    expect(useSubclipsStore.getState().subclips).toHaveLength(1)
    const confirm = screen.getAllByRole('button', { name: 'Delete' }).at(-1)!
    fireEvent.click(confirm)
    await waitFor(() => expect(useSubclipsStore.getState().subclips).toEqual([]))
    expect(posters.release).toHaveBeenCalledWith(subclip.id)
    expect(useSourcePlayerStore.getState().marksByKey).toEqual({})
    expect(markDirty).toHaveBeenCalledTimes(1)
  })

  it('starts the media drag with the subclip range as the payload', () => {
    const subclip = addSubclip({ startFrame: 60, endFrame: 180 })
    const { container } = render(<SubclipsSection />)
    const row = container.querySelector(`[data-subclip-id="${subclip.id}"]`)!
    expect(row).toHaveAttribute('draggable', 'true')
    const { data, dataTransfer } = dragEvent()
    fireEvent.dragStart(row, { dataTransfer })
    const expected = {
      type: 'media-item',
      mediaId: 'm1',
      mediaType: 'video',
      fileName: 'Gap run',
      duration: 4,
      sourceStart: 60,
      sourceEnd: 180,
      subclipId: subclip.id,
    }
    expect(JSON.parse(data['application/json']!)).toEqual(expected)
    expect(dragCache.setMediaDragData).toHaveBeenCalledWith(expected)
    fireEvent.dragEnd(row)
    expect(dragCache.clearMediaDragData).toHaveBeenCalled()
  })

  it('computes the payload duration at the exact rate (59.94: 120 frames = 2.002 s)', () => {
    mediaState.mediaById = { m1: makeMedia({ fps: 59.94 }) }
    const subclip = addSubclip({ startFrame: 0, endFrame: 120, sourceFps: 59.94 })
    const { container } = render(<SubclipsSection />)
    const { data, dataTransfer } = dragEvent()
    fireEvent.dragStart(container.querySelector(`[data-subclip-id="${subclip.id}"]`)!, {
      dataTransfer,
    })
    expect(JSON.parse(data['application/json']!).duration).toBeCloseTo(2.002, 6)
  })

  describe.each([
    [
      'range-past-end',
      { duration: 2 } as Partial<MediaMetadata>,
      'The original file is now shorter',
    ],
    ['rate-changed', { fps: 25 } as Partial<MediaMetadata>, 'a different frame rate'],
  ])('a subclip whose parent changed: %s', (reason, change, label) => {
    it('is badged and cannot be dragged, and is never clamped', () => {
      mediaState.mediaById = { m1: makeMedia(change) }
      const subclip = addSubclip()
      const { container } = render(<SubclipsSection />)
      const row = container.querySelector(`[data-subclip-id="${subclip.id}"]`)!
      expect(container.querySelector(`[data-subclip-invalid="${reason}"]`)).not.toBeNull()
      expect(screen.getByRole('img', { name: new RegExp(label) })).toBeInTheDocument()
      expect(row).toHaveAttribute('draggable', 'false')
      const { data, dataTransfer } = dragEvent()
      const notPrevented = fireEvent.dragStart(row, { dataTransfer })
      expect(notPrevented).toBe(false)
      expect(data['application/json']).toBeUndefined()
      expect(dragCache.setMediaDragData).not.toHaveBeenCalled()
      expect(useSubclipsStore.getState().subclips[0]).toMatchObject({
        startFrame: 30,
        endFrame: 150,
      })
    })
  })

  it('badges a subclip whose parent is not in the library', () => {
    mediaState.mediaById = {}
    addSubclip()
    const { container } = render(<SubclipsSection />)
    expect(container.querySelector('[data-subclip-invalid="parent-missing"]')).not.toBeNull()
    expect(posters.getPosterUrl).not.toHaveBeenCalled()
  })

  describe('opening in the source monitor', () => {
    const rowOf = (container: HTMLElement, id: string) =>
      container.querySelector(`[data-subclip-id="${id}"]`)!

    it('opens the window on double-click: the parent mounts, the range is the window', () => {
      const subclip = addSubclip({ startFrame: 30, endFrame: 150 })
      const { container } = render(<SubclipsSection />)
      fireEvent.doubleClick(rowOf(container, subclip.id))
      expect(editorState.setSourcePreviewMediaId).toHaveBeenCalledWith('m1')
      expect(useSourcePlayerStore.getState()).toMatchObject({
        currentMediaId: 'm1',
        activeSubclipId: subclip.id,
        activeWindow: { start: 30, end: 150 },
        pendingSeekFrame: 30,
      })
    })

    it('"Open in source monitor" does the same as the double-click', () => {
      const subclip = addSubclip()
      render(<SubclipsSection />)
      fireEvent.click(screen.getByText('Open in source monitor'))
      expect(editorState.setSourcePreviewMediaId).toHaveBeenCalledWith('m1')
      expect(useSourcePlayerStore.getState().activeSubclipId).toBe(subclip.id)
    })

    it('"Show original" opens the parent without a window, also when the subclip was open', () => {
      const subclip = addSubclip()
      const { container } = render(<SubclipsSection />)
      fireEvent.doubleClick(rowOf(container, subclip.id))
      expect(useSourcePlayerStore.getState().activeWindow).not.toBeNull()
      fireEvent.click(screen.getByText('Show original'))
      expect(editorState.setSourcePreviewMediaId).toHaveBeenLastCalledWith('m1')
      expect(useSourcePlayerStore.getState()).toMatchObject({
        currentMediaId: 'm1',
        activeSubclipId: null,
        activeWindow: null,
      })
    })

    it('does nothing for an invalid subclip, and its menu item is disabled', () => {
      mediaState.mediaById = { m1: makeMedia({ duration: 2 }) }
      const subclip = addSubclip()
      const { container } = render(<SubclipsSection />)
      fireEvent.doubleClick(rowOf(container, subclip.id))
      expect(editorState.setSourcePreviewMediaId).not.toHaveBeenCalled()
      expect(useSourcePlayerStore.getState()).toMatchObject({
        currentMediaId: null,
        activeSubclipId: null,
        activeWindow: null,
      })
      expect(screen.getByText('Open in source monitor')).toBeDisabled()
    })

    it('does not open while the name is being edited', () => {
      const subclip = addSubclip()
      const { container } = render(<SubclipsSection />)
      fireEvent.click(screen.getByText('Rename'))
      fireEvent.doubleClick(rowOf(container, subclip.id))
      expect(editorState.setSourcePreviewMediaId).not.toHaveBeenCalled()
    })
  })

  it('lists rows with the file name in the list view', () => {
    mediaState.viewMode = 'list'
    addSubclip()
    render(<SubclipsSection />)
    expect(screen.getByText('DJI_0020.MP4')).toBeInTheDocument()
  })

  it('follows the store: a new subclip appears', () => {
    render(<SubclipsSection />)
    act(() => {
      addSubclip({ name: 'Late' })
    })
    expect(screen.getByText('Late')).toBeInTheDocument()
  })
})

describe('SubclipDeletionNotice', () => {
  beforeEach(() => {
    useSubclipsStore.getState().reset()
  })

  it('names how many subclips deleting these files also deletes', () => {
    addSubclip({ name: 'a' })
    addSubclip({ name: 'b' })
    addSubclip({ mediaId: 'm2', name: 'c' })
    render(<SubclipDeletionNotice mediaIds={['m1']} />)
    expect(screen.getByTestId('subclip-deletion-notice')).toHaveTextContent(
      '2 subclips of this media will also be deleted.',
    )
  })

  it('is singular for one, and absent for none', () => {
    addSubclip({ mediaId: 'm2' })
    const { rerender, container } = render(<SubclipDeletionNotice mediaIds={['m2']} />)
    expect(screen.getByTestId('subclip-deletion-notice')).toHaveTextContent(
      '1 subclip of this media will also be deleted.',
    )
    rerender(<SubclipDeletionNotice mediaIds={['m3']} />)
    expect(container).toBeEmptyDOMElement()
  })
})
