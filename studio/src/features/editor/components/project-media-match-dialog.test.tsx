import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { MediaMetadata } from '@/types/storage'
import { useProjectMediaMatchDialogStore } from '@/shared/state/project-media-match-dialog'

const mocks = vi.hoisted(() => ({
  updateProject: vi.fn(),
  markDirty: vi.fn(),
  setFps: vi.fn(),
  addUndoEntry: vi.fn(),
  captureSnapshot: vi.fn(() => ({
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
    markers: [],
    compositions: [],
    inPoint: null,
    outPoint: null,
    fps: 30,
    scrollPosition: 0,
    snapEnabled: true,
    currentFrame: 0,
    projectId: 'project-1',
    projectMetadata: {
      width: 1280,
      height: 720,
      fps: 30,
      backgroundColor: '#000000',
    },
  })),
  toastError: vi.fn(),
}))

let mediaState: {
  mediaItems: MediaMetadata[]
  isLoading: boolean
}

let projectState: {
  currentProject: {
    id: string
    metadata: {
      width: number
      height: number
      fps: number
    }
  } | null
}

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))

vi.mock('@/features/editor/deps/media-library', () => ({
  useMediaLibraryStore: (selector: (state: typeof mediaState) => unknown) => selector(mediaState),
}))

vi.mock('@/features/editor/deps/projects', () => {
  const rates = [
    { num: 24000, den: 1001 },
    { num: 24, den: 1 },
    { num: 25, den: 1 },
    { num: 30000, den: 1001 },
    { num: 30, den: 1 },
    { num: 50, den: 1 },
    { num: 60000, den: 1001 },
    { num: 60, den: 1 },
  ]

  return {
    useProjectStore: Object.assign(
      (
        selector: (
          state: typeof projectState & { updateProject: typeof mocks.updateProject },
        ) => unknown,
      ) =>
        selector({
          ...projectState,
          updateProject: mocks.updateProject,
        }),
      {
        getState: () => ({
          ...projectState,
          updateProject: mocks.updateProject,
        }),
      },
    ),
    formatFpsValue: (fps: number) =>
      Number.isInteger(fps) ? `${fps}` : fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''),
    resolveAutoMatchProjectFps: (sourceFps: number) => {
      let closest = rates[0]!
      for (const rate of rates) {
        if (
          Math.abs(sourceFps - rate.num / rate.den) <
          Math.abs(sourceFps - closest.num / closest.den)
        ) {
          closest = rate
        }
      }

      return {
        rate: closest,
        fps: closest.num / closest.den,
        exact: Math.abs(sourceFps - closest.num / closest.den) < 0.001,
      }
    },
  }
})

vi.mock('@/features/editor/deps/timeline-store', () => ({
  markDirty: mocks.markDirty,
  useTimelineSettingsStore: (selector: (state: { setFps: typeof mocks.setFps }) => unknown) =>
    selector({
      setFps: mocks.setFps,
    }),
  useTimelineCommandStore: Object.assign(
    (selector: (state: { addUndoEntry: typeof mocks.addUndoEntry }) => unknown) =>
      selector({
        addUndoEntry: mocks.addUndoEntry,
      }),
    {
      getState: () => ({
        addUndoEntry: mocks.addUndoEntry,
      }),
    },
  ),
  captureSnapshot: mocks.captureSnapshot,
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
  },
}))

import { ProjectMediaMatchDialog } from './project-media-match-dialog'

function makeVideo(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'video-1',
    storageType: 'handle',
    fileName: 'clip.mp4',
    fileSize: 1_000,
    fileLastModified: 1,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 59.94,
    codec: 'h264',
    bitrate: 10_000_000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('ProjectMediaMatchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectMediaMatchDialogStore.getState().resetProjectMediaMatchDialog()

    mediaState = {
      mediaItems: [],
      isLoading: true,
    }

    projectState = {
      currentProject: {
        id: 'project-1',
        metadata: {
          width: 1280,
          height: 720,
          fps: 30,
        },
      },
    }

    mocks.updateProject.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...projectState.currentProject!,
      metadata: {
        ...projectState.currentProject!.metadata,
        ...data,
      },
    }))
  })

  it('prompts on the first imported video and can match both size and fps', async () => {
    const { rerender } = render(<ProjectMediaMatchDialog projectId="project-1" />)

    mediaState = {
      mediaItems: [],
      isLoading: false,
    }
    rerender(<ProjectMediaMatchDialog projectId="project-1" />)

    mediaState = {
      mediaItems: [makeVideo()],
      isLoading: false,
    }
    rerender(<ProjectMediaMatchDialog projectId="project-1" />)

    await waitFor(() =>
      expect(screen.getByText('Match Project To First Video?')).toBeInTheDocument(),
    )

    // A 59.94 probe is exactly the 59.94 project rate: no "this clip would use…" hint.
    expect(screen.queryByText(/closest supported project frame rate/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Match Both' }))

    await waitFor(() =>
      expect(mocks.updateProject).toHaveBeenCalledWith('project-1', {
        width: 1920,
        height: 1080,
        fps: 59.94005994005994,
      }),
    )
    expect(mocks.setFps).toHaveBeenCalledWith(59.94005994005994)
    expect(mocks.markDirty).toHaveBeenCalledTimes(1)
  })

  it('shows the current project rate formatted, not its stored double', async () => {
    projectState = {
      currentProject: {
        id: 'project-1',
        metadata: { width: 1280, height: 720, fps: 59.94005994005994 },
      },
    }

    const { rerender } = render(<ProjectMediaMatchDialog projectId="project-1" />)

    mediaState = {
      mediaItems: [],
      isLoading: false,
    }
    rerender(<ProjectMediaMatchDialog projectId="project-1" />)

    mediaState = {
      mediaItems: [makeVideo({ fps: 60 })],
      isLoading: false,
    }
    rerender(<ProjectMediaMatchDialog projectId="project-1" />)

    await waitFor(() => expect(screen.getByText('59.94 fps')).toBeInTheDocument())
    expect(screen.queryByText('59.94005994005994 fps')).not.toBeInTheDocument()
  })

  it('does not prompt again once the project already had a video', async () => {
    mediaState = {
      mediaItems: [makeVideo({ id: 'existing-video' })],
      isLoading: false,
    }

    const { rerender } = render(<ProjectMediaMatchDialog projectId="project-1" />)

    mediaState = {
      mediaItems: [
        makeVideo({ id: 'new-video', createdAt: 2 }),
        makeVideo({ id: 'existing-video', createdAt: 1 }),
      ],
      isLoading: false,
    }
    rerender(<ProjectMediaMatchDialog projectId="project-1" />)

    await waitFor(() =>
      expect(screen.queryByText('Match Project To First Video?')).not.toBeInTheDocument(),
    )
    expect(mocks.updateProject).not.toHaveBeenCalled()
  })

  it('can be requested imperatively before import flows continue', async () => {
    render(<ProjectMediaMatchDialog projectId="project-1" />)

    let pendingChoice: Promise<'match-both' | 'fps-only' | 'size-only' | 'keep-current'>
    await act(async () => {
      pendingChoice = useProjectMediaMatchDialogStore
        .getState()
        .requestProjectMediaMatch('project-1', {
          fileName: 'drop.mp4',
          width: 1920,
          height: 1080,
          fps: 59.94,
        })
    })

    await waitFor(() =>
      expect(screen.getByText('Match Project To First Video?')).toBeInTheDocument(),
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'FPS Only' }))
    })

    await expect(pendingChoice!).resolves.toBe('fps-only')
    expect(mocks.updateProject).toHaveBeenCalledWith('project-1', { fps: 59.94005994005994 })
    expect(mocks.setFps).toHaveBeenCalledWith(59.94005994005994)
  })
})
