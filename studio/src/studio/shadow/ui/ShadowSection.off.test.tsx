import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { isFeatureShown, setFeatureOverride } from '@/studio/feature-switches'
import type { MediaMetadata } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import { ShadowSection } from './ShadowSection'
import { SHADOW_SESSION_IDLE, useShadowSessionStore } from './use-shadow-session'

// The `shadowRemovalClean` switch off (on in the app since 19 Nov 2026, turned off here): the whole
// section is hidden and nothing in the UI can reach the cloud (review finding C6).

const MEDIA: MediaMetadata = {
  id: 'media-1',
  storageType: 'workspace',
  fileName: 'DJI_20261115124704_0020_D.MP4',
  fileSize: 3_764_360_098,
  mimeType: 'video/mp4',
  duration: 230.88065,
  width: 3840,
  height: 2880,
  fps: 59.94,
  codec: 'hevc',
  bitrate: 129_885_000,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
}

const ITEM: VideoItem = {
  id: 'clip-1',
  trackId: 'track-1',
  type: 'video',
  label: 'DJI_0020',
  mediaId: MEDIA.id,
  src: 'blob:clip-1',
  from: 0,
  durationInFrames: 13_839,
  sourceFps: 59.94,
  shadowRemoval: {
    mark: { x: 1860.25, y: 2410.5, sourceFrame: 3630, radius: 96.5 },
    ranges: [],
    pieces: [],
  },
}

describe('ShadowSection with the shadowRemovalClean switch off', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    setFeatureOverride('shadowRemovalClean', false)
    vi.stubGlobal('fetch', fetchSpy)
    fetchSpy.mockReset()
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE })
    useItemsStore.getState().setItems([ITEM])
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [MEDIA], brokenMediaIds: [] })
  })

  afterEach(() => {
    setFeatureOverride('shadowRemovalClean', undefined)
    vi.unstubAllGlobals()
  })

  it('renders nothing, opens no session and makes no network call', () => {
    expect(isFeatureShown('shadowRemovalClean')).toBe(false)

    const { container } = render(<ShadowSection items={[ITEM]} />)

    expect(container.querySelector('[data-testid="shadow-section"]')).toBeNull()
    expect(container.querySelector('[data-testid="shadow-follow-button"]')).toBeNull()
    expect(container.querySelector('[data-testid="shadow-mark-button"]')).toBeNull()
    expect(useShadowSessionStore.getState().isOpen).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
