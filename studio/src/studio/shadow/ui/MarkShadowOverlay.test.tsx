import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import type { MediaMetadata } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import { MarkShadowOverlay } from './MarkShadowOverlay'
import { SHADOW_SESSION_IDLE, useShadowSessionStore } from './use-shadow-session'

const { screenToCanvasMock } = vi.hoisted(() => ({ screenToCanvasMock: vi.fn() }))
vi.mock('@/features/preview/utils/coordinate-transform', () => ({
  screenToCanvas: screenToCanvasMock,
}))

const MEDIA: MediaMetadata = {
  id: 'media-1',
  storageType: 'workspace',
  fileName: 'clip.mp4',
  fileSize: 1_000,
  mimeType: 'video/mp4',
  duration: 2,
  width: 1000,
  height: 1000,
  fps: 60,
  codec: 'hevc',
  bitrate: 1_000,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
}

/** A 1000×1000 clip in a 1000×1000 project shown at 800×600 CSS pixels. */
const CLIP: VideoItem = {
  id: 'clip-1',
  trackId: 'track-1',
  type: 'video',
  label: 'clip.mp4',
  mediaId: MEDIA.id,
  src: 'blob:clip-1',
  from: 0,
  durationInFrames: 120,
  sourceFps: 60,
  sourceWidth: 1000,
  sourceHeight: 1000,
}

const CONTAINER = new DOMRect(0, 0, 800, 800)
const PLAYER = { width: 800, height: 800 }
const PROJECT = { width: 1000, height: 1000 }

function renderOverlay() {
  return render(
    <MarkShadowOverlay
      containerRect={CONTAINER}
      playerSize={PLAYER}
      projectSize={PROJECT}
      zoom={-1}
    />,
  )
}

describe('MarkShadowOverlay', () => {
  beforeEach(() => {
    screenToCanvasMock.mockReset()
    screenToCanvasMock.mockReturnValue({ x: 500, y: 500 })
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE })
    useItemsStore.getState().setItems([{ ...CLIP }])
    useTimelineSettingsStore.setState({ fps: 60 })
    useMediaLibraryStore.setState({ mediaItems: [MEDIA] })
    usePlaybackStore.setState({ currentFrame: 12, isPlaying: false })
    useShadowSessionStore.getState().open(CLIP.id)
    useShadowSessionStore.getState().startMarking()
  })

  it('turns one click into source pixels and the playhead’s source frame, in one undo step', () => {
    renderOverlay()

    // The clip is selected while its shadow is marked, and the transform gizmo covers the picture
    // at z-40: the marking layer must sit above it, or the click moves the clip instead.
    const overlay = screen.getByTestId('shadow-mark-overlay')
    expect(overlay.className).toContain('z-50')
    expect(overlay.className).toContain('pointer-events-auto')
    fireEvent.click(overlay, { clientX: 10, clientY: 20 })

    expect(screenToCanvasMock).toHaveBeenCalledWith(10, 20, {
      containerRect: CONTAINER,
      playerSize: PLAYER,
      projectSize: PROJECT,
      zoom: -1,
    })
    // 500,500 on the 1000-square canvas is 500,500 of the 1000-square source, on source frame 12.
    expect(useItemsStore.getState().itemById[CLIP.id]?.shadowRemoval?.mark).toEqual({
      x: 500,
      y: 500,
      sourceFrame: 12,
      radius: 35,
    })
    expect(useShadowSessionStore.getState().marking).toBe(false)
  })

  it('marks the source frame the clip’s speed curve shows, not its average speed’s (C11)', () => {
    // 1x -> 3x over 120 frames: at frame 60 the curve has spent 60·1 + 2·60²/(2·120) = 90
    // source frames (the area under the speed), while the average speed (2x) would say 120.
    const curved: VideoItem = {
      ...CLIP,
      speed: 2,
      speedCurve: {
        keys: [
          { frame: 0, speed: 1 },
          { frame: 120, speed: 3 },
        ],
      },
    }
    useItemsStore.getState().setItems([curved])
    usePlaybackStore.setState({ currentFrame: 60, isPlaying: false })
    renderOverlay()

    fireEvent.click(screen.getByTestId('shadow-mark-overlay'), { clientX: 10, clientY: 20 })

    expect(useItemsStore.getState().itemById[CLIP.id]?.shadowRemoval?.mark?.sourceFrame).toBe(90)
  })

  it('ignores a click outside the picture and one while the section is not marking', () => {
    screenToCanvasMock.mockReturnValue({ x: -20, y: 0 })
    renderOverlay()
    fireEvent.click(screen.getByTestId('shadow-mark-overlay'), { clientX: 1, clientY: 1 })
    expect(useItemsStore.getState().itemById[CLIP.id]?.shadowRemoval).toBeUndefined()

    screenToCanvasMock.mockReturnValue({ x: 500, y: 500 })
    act(() => useShadowSessionStore.getState().cancelMarking())
    fireEvent.click(screen.getByTestId('shadow-mark-overlay'), { clientX: 1, clientY: 1 })
    expect(useItemsStore.getState().itemById[CLIP.id]?.shadowRemoval).toBeUndefined()
  })

  it('draws the mark’s circle on its own frame only', () => {
    renderOverlay()
    fireEvent.click(screen.getByTestId('shadow-mark-overlay'), { clientX: 10, clientY: 20 })

    // Source (500,500), radius 35: the clip fills the 1000-square project and the player shows it
    // at 800 px, so the radius is 35 × 0.8 = 28 px and the centre is (400, 400) px.
    const circle = screen.getByTestId('shadow-mark-circle')
    expect(Number.parseFloat(circle.style.left)).toBeCloseTo(400 - 28, 6)
    expect(Number.parseFloat(circle.style.top)).toBeCloseTo(400 - 28, 6)
    expect(Number.parseFloat(circle.style.width)).toBeCloseTo(56, 6)

    act(() => usePlaybackStore.setState({ currentFrame: 13 }))
    expect(screen.queryByTestId('shadow-mark-circle')).toBeNull()
  })

  it('draws the free pass’s circle on the frame being scrubbed, and only on a tracked one', () => {
    useShadowSessionStore.setState({
      pass: {
        jobId: 'pass-1',
        chargedCredits: 20,
        refundedCredits: 0,
        uploadId: 'upload-1',
        mark: { x: 500, y: 500, sourceFrame: 0, radius: 50 },
        window: { startFrame: 0, endFrame: 120, startSeconds: 0, endSeconds: 2 },
        points: [
          { frame: 12, x: 500, y: 500, radius: 50 },
          { frame: 30, x: 250, y: 500, radius: 50 },
        ],
        ranges: [],
      },
    })
    renderOverlay()

    const circle = screen.getByTestId('shadow-tracked-circle')
    expect(Number.parseFloat(circle.style.left)).toBeCloseTo(400 - 40, 6)
    expect(Number.parseFloat(circle.style.top)).toBeCloseTo(400 - 40, 6)
    expect(Number.parseFloat(circle.style.width)).toBeCloseTo(80, 6)

    act(() => usePlaybackStore.setState({ currentFrame: 30 }))
    const moved = screen.getByTestId('shadow-tracked-circle')
    // Source (250,500) is a quarter across the clip: 250 × 0.8 = 200 px, less the 40 px radius.
    expect(Number.parseFloat(moved.style.left)).toBeCloseTo(200 - 40, 6)

    act(() => usePlaybackStore.setState({ currentFrame: 20 }))
    expect(screen.queryByTestId('shadow-tracked-circle')).toBeNull()
  })

  it('renders nothing while no section is open', () => {
    useShadowSessionStore.getState().close()
    renderOverlay()
    expect(screen.queryByTestId('shadow-mark-overlay')).toBeNull()
  })
})
