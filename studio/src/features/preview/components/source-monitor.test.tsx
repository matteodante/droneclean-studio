import { StrictMode, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, waitFor } from '@testing-library/react'

const editorStoreState = vi.hoisted(() => ({
  sourcePreviewMediaId: 'media-1' as string | null,
}))

const sourcePlayerStoreState = vi.hoisted(() => ({
  hoveredPanel: null as string | null,
  playerMethods: null as unknown,
  currentMediaId: null as string | null,
  currentSourceFrame: 0,
  previewSourceFrame: null as number | null,
  inPoint: null as number | null,
  outPoint: null as number | null,
  pendingSeekFrame: null as number | null,
  activeSubclipId: null as string | null,
  activeWindow: null as { start: number; end: number } | null,
  setHoveredPanel: vi.fn(),
  setPlayerMethods: vi.fn(),
  setCurrentMediaId: vi.fn(),
  releaseCurrentMediaId: vi.fn(),
  setCurrentSourceFrame: vi.fn(),
  setPreviewSourceFrame: vi.fn(),
  setInPoint: vi.fn(),
  setOutPoint: vi.fn(),
  clearInOutPoints: vi.fn(),
  setPendingSeekFrame: vi.fn(),
}))

const dragCacheState = vi.hoisted(() => ({ data: null as unknown }))

const mediaStoreState = vi.hoisted(() => {
  const media1 = {
    id: 'media-1',
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    duration: 5,
    width: 1920,
    height: 1080,
    fps: 30,
    audioCodec: 'aac',
  }
  return {
    mediaItems: [media1],
    mediaById: { 'media-1': media1 } as Record<string, typeof media1>,
  }
})

const timelineSettingsState = vi.hoisted(() => ({ markDirty: vi.fn() }))

const itemsStoreState = vi.hoisted(() => ({
  tracks: [],
}))

const playerMethodsState = vi.hoisted(() => ({
  seek: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  toggle: vi.fn(),
  frameBack: vi.fn(),
  frameForward: vi.fn(),
  getPlaybackRate: vi.fn(() => 1),
  setPlaybackRate: vi.fn(),
  isPlaying: vi.fn(() => false),
}))

const clockState = vi.hoisted(() => ({
  currentFrame: 0,
  isPlaying: false,
  playbackRate: 1,
  listeners: new Set<(frame: number) => void>(),
}))

vi.mock('@/features/preview/deps/player-context', () => ({
  PlayerEmitterProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ClockBridgeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  VideoConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useClock: () => ({
    currentFrame: clockState.currentFrame,
    isPlaying: clockState.isPlaying,
    onFrameChange: (callback: (frame: number) => void) => {
      clockState.listeners.add(callback)
      return () => {
        clockState.listeners.delete(callback)
      }
    },
  }),
  useClockIsPlaying: () => clockState.isPlaying,
  useClockPlaybackRate: () => clockState.playbackRate,
  usePlayer: () => playerMethodsState,
}))

vi.mock('./source-composition', () => ({
  SourceComposition: () => <div data-testid="source-composition" />,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
}))

vi.mock('../utils/media-resolver', () => ({
  resolveMediaUrl: vi.fn().mockResolvedValue('blob:media-1'),
}))

vi.mock('@/features/preview/deps/media-library', () => {
  const useMediaLibraryStore = Object.assign(
    (selector: (state: typeof mediaStoreState) => unknown) => selector(mediaStoreState),
    { getState: () => mediaStoreState },
  )

  return {
    useMediaLibraryStore,
    setMediaDragData: (data: unknown) => {
      dragCacheState.data = data
    },
    clearMediaDragData: () => {
      dragCacheState.data = null
    },
    getMediaType: (mimeType: string) => {
      if (mimeType.startsWith('video/')) return 'video'
      if (mimeType.startsWith('audio/')) return 'audio'
      if (mimeType.startsWith('image/')) return 'image'
      return 'unknown'
    },
  }
})

vi.mock('@/features/preview/deps/timeline-store', () => {
  const useItemsStore = Object.assign(
    (selector: (state: typeof itemsStoreState) => unknown) => selector(itemsStoreState),
    { getState: () => itemsStoreState },
  )

  const useTimelineSettingsStore = Object.assign(
    (selector: (state: { markDirty: () => void }) => unknown) => selector(timelineSettingsState),
    { getState: () => timelineSettingsState },
  )

  return { useItemsStore, useTimelineSettingsStore }
})

vi.mock('@/features/preview/deps/settings', () => {
  const settingsState = { editorDensity: 'compact' as const }
  const useSettingsStore = Object.assign(
    (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
    { getState: () => settingsState },
  )

  return { useSettingsStore }
})

vi.mock('@/shared/state/editor', () => {
  const useEditorStore = Object.assign(
    (selector: (state: typeof editorStoreState) => unknown) => selector(editorStoreState),
    { getState: () => editorStoreState },
  )

  return { useEditorStore }
})

vi.mock('@/shared/state/source-player', () => {
  const useSourcePlayerStore = Object.assign(
    (selector: (state: typeof sourcePlayerStoreState) => unknown) =>
      selector(sourcePlayerStoreState),
    { getState: () => sourcePlayerStoreState },
  )

  return { useSourcePlayerStore }
})

vi.mock('@/shared/state/selection', () => {
  const selectionState = { activeTrackId: null as string | null }
  const useSelectionStore = Object.assign(
    (selector: (state: typeof selectionState) => unknown) => selector(selectionState),
    { getState: () => selectionState },
  )

  return { useSelectionStore }
})

vi.mock('@/features/preview/deps/timeline-source-edit', () => ({
  getTrackKind: (track: { kind?: string | null }) => track.kind ?? null,
  performInsertEdit: vi.fn(),
  performOverwriteEdit: vi.fn(),
  resolveSourceEditTrackTargets: vi.fn(() => null),
}))

import { SourceMonitor } from './source-monitor'
import { useSubclipsStore } from '@/studio/subclips'

describe('SourceMonitor current media ownership', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    )
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      window.clearTimeout(handle)
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    editorStoreState.sourcePreviewMediaId = 'media-1'
    clockState.currentFrame = 0
    clockState.isPlaying = false
    clockState.listeners.clear()
    sourcePlayerStoreState.inPoint = null
    sourcePlayerStoreState.outPoint = null
    sourcePlayerStoreState.activeSubclipId = null
    sourcePlayerStoreState.activeWindow = null
    useSubclipsStore.getState().reset()
    dragCacheState.data = null
  })

  it('does not release the current media during the initial Strict Mode remount', async () => {
    render(
      <StrictMode>
        <SourceMonitor mediaId="media-1" />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1')
    })

    expect(sourcePlayerStoreState.releaseCurrentMediaId).not.toHaveBeenCalled()
  })

  it('releases the current media once the source monitor closes', async () => {
    const rendered = render(<SourceMonitor mediaId="media-1" />)

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1')
    })

    editorStoreState.sourcePreviewMediaId = null
    rendered.unmount()

    expect(sourcePlayerStoreState.releaseCurrentMediaId).toHaveBeenCalledWith('media-1')
  })

  it('batches seek bar drags and commits the final frame on mouseup', async () => {
    const rendered = render(<SourceMonitor mediaId="media-1" />)

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1')
    })

    const seekBar = rendered.getByTestId('source-monitor-seek-bar')
    vi.spyOn(seekBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(seekBar, { clientX: 25 })
    fireEvent.mouseMove(document, { clientX: 75 })

    expect(playerMethodsState.seek).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentSourceFrame).toHaveBeenLastCalledWith(112)
    })

    fireEvent.mouseUp(document)

    expect(playerMethodsState.seek).toHaveBeenCalledTimes(1)
    expect(playerMethodsState.seek).toHaveBeenCalledWith(112)
  })

  it('pauses playback when seek-bar scrubbing starts', async () => {
    clockState.isPlaying = true
    const rendered = render(<SourceMonitor mediaId="media-1" />)

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1')
    })

    const seekBar = rendered.getByTestId('source-monitor-seek-bar')
    vi.spyOn(seekBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(seekBar, { clientX: 25 })

    expect(playerMethodsState.pause).toHaveBeenCalledTimes(1)
  })

  function mockBarRect(element: HTMLElement) {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON: () => ({}),
    })
  }

  describe('subclip window', () => {
    // clip.mp4 is 150 frames at 30 fps; the open subclip is frames [40, 100).
    function openWindow() {
      const subclip = useSubclipsStore.getState().create({
        mediaId: 'media-1',
        name: 'Gap',
        startFrame: 40,
        endFrame: 100,
        sourceFps: 30,
      })
      sourcePlayerStoreState.activeSubclipId = subclip.id
      sourcePlayerStoreState.activeWindow = { start: 40, end: 100 }
      return subclip
    }

    it('moves the playhead to the first frame of the window when it opens', async () => {
      openWindow()
      render(<SourceMonitor mediaId="media-1" />)
      await waitFor(() => expect(playerMethodsState.seek).toHaveBeenCalledWith(40))
    })

    it('scrubs only inside the window, with the parent frame numbers', async () => {
      openWindow()
      const rendered = render(<SourceMonitor mediaId="media-1" />)
      const seekBar = rendered.getByTestId('source-monitor-seek-bar')
      mockBarRect(seekBar)
      playerMethodsState.seek.mockClear()

      fireEvent.mouseDown(seekBar, { clientX: 0 })
      fireEvent.mouseUp(document)
      expect(playerMethodsState.seek).toHaveBeenLastCalledWith(40)

      fireEvent.mouseDown(seekBar, { clientX: 100 })
      fireEvent.mouseUp(document)
      expect(playerMethodsState.seek).toHaveBeenLastCalledWith(99)
    })

    it('stops playback on the last frame of the window', async () => {
      openWindow()
      clockState.isPlaying = true
      render(<SourceMonitor mediaId="media-1" />)
      await waitFor(() => expect(clockState.listeners.size).toBeGreaterThan(0))
      playerMethodsState.pause.mockClear()
      playerMethodsState.seek.mockClear()

      for (const listener of clockState.listeners) listener(98)
      expect(playerMethodsState.pause).not.toHaveBeenCalled()

      for (const listener of clockState.listeners) listener(99)
      expect(playerMethodsState.pause).toHaveBeenCalled()
      expect(playerMethodsState.seek).not.toHaveBeenCalled()

      // A frame that overshoots is pulled back inside.
      for (const listener of clockState.listeners) listener(101)
      expect(playerMethodsState.seek).toHaveBeenLastCalledWith(99)
    })

    it('does not stop a whole-file playback', async () => {
      clockState.isPlaying = true
      render(<SourceMonitor mediaId="media-1" />)
      await waitFor(() => expect(clockState.listeners.size).toBeGreaterThan(0))
      playerMethodsState.pause.mockClear()
      for (const listener of clockState.listeners) listener(120)
      expect(playerMethodsState.pause).not.toHaveBeenCalled()
    })

    it('marks the current frame inside the window', async () => {
      openWindow()
      clockState.currentFrame = 20
      const rendered = render(<SourceMonitor mediaId="media-1" />)
      await waitFor(() => expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalled())
      sourcePlayerStoreState.setInPoint.mockClear()
      fireEvent.click(rendered.getByLabelText('Mark In (I)'))
      expect(sourcePlayerStoreState.setInPoint).toHaveBeenLastCalledWith(40)
    })
  })

  describe('create subclip', () => {
    it('is disabled with no mark', () => {
      const rendered = render(<SourceMonitor mediaId="media-1" />)
      expect(
        (rendered.getByLabelText('Create Subclip (Alt+S)') as HTMLButtonElement).disabled,
      ).toBe(true)
    })

    it('adds a record from the marks with a default name, by the button and by Alt+S', () => {
      sourcePlayerStoreState.inPoint = 30
      sourcePlayerStoreState.outPoint = 90
      const rendered = render(<SourceMonitor mediaId="media-1" />)

      fireEvent.click(rendered.getByLabelText('Create Subclip (Alt+S)'))
      const first = useSubclipsStore.getState().subclips
      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({
        mediaId: 'media-1',
        name: 'clip 00:01:00',
        startFrame: 30,
        endFrame: 90,
        sourceFps: 30,
      })
      // The marks are left as they were.
      expect(sourcePlayerStoreState.setInPoint).not.toHaveBeenCalled()

      fireEvent.keyDown(rendered.getByTestId('source-monitor-picture'), {
        key: 'ß',
        code: 'KeyS',
        altKey: true,
      })
      expect(useSubclipsStore.getState().subclips).toHaveLength(2)
    })

    it('marks the project dirty so autosave keeps the new subclip', () => {
      sourcePlayerStoreState.inPoint = 30
      sourcePlayerStoreState.outPoint = 90
      const rendered = render(<SourceMonitor mediaId="media-1" />)
      expect(timelineSettingsState.markDirty).not.toHaveBeenCalled()

      fireEvent.click(rendered.getByLabelText('Create Subclip (Alt+S)'))
      expect(timelineSettingsState.markDirty).toHaveBeenCalledTimes(1)
    })

    it('does not mark the project dirty when nothing was created', () => {
      const rendered = render(<SourceMonitor mediaId="media-1" />)
      fireEvent.keyDown(rendered.getByTestId('source-monitor-picture'), {
        key: 'ß',
        code: 'KeyS',
        altKey: true,
      })
      expect(useSubclipsStore.getState().subclips).toHaveLength(0)
      expect(timelineSettingsState.markDirty).not.toHaveBeenCalled()
    })
  })

  describe('dragging the picture', () => {
    it('is not draggable without a mark, so a click keeps its meaning', () => {
      const rendered = render(<SourceMonitor mediaId="media-1" />)
      expect(rendered.getByTestId('source-monitor-picture').getAttribute('draggable')).toBe('false')
    })

    it('starts the media drag with the marked range', () => {
      sourcePlayerStoreState.inPoint = 30
      sourcePlayerStoreState.outPoint = 90
      const rendered = render(<SourceMonitor mediaId="media-1" />)
      const picture = rendered.getByTestId('source-monitor-picture')
      expect(picture.getAttribute('draggable')).toBe('true')

      const data: Record<string, string> = {}
      fireEvent.dragStart(picture, {
        dataTransfer: {
          effectAllowed: '',
          setData: (type: string, value: string) => {
            data[type] = value
          },
        },
      })

      const expected = {
        type: 'media-item',
        mediaId: 'media-1',
        mediaType: 'video',
        fileName: 'clip.mp4',
        duration: 2,
        sourceStart: 30,
        sourceEnd: 90,
      }
      expect(JSON.parse(data['application/json'] ?? 'null')).toEqual(expected)
      expect(dragCacheState.data).toEqual(expected)

      fireEvent.dragEnd(picture)
      expect(dragCacheState.data).toBeNull()
    })
  })
})
