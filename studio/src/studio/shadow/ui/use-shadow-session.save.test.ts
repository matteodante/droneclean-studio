import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { setProjectSaver } from '../project-saver'
import { frameToSeconds, toRate } from '@/studio/time'
import type { MediaMetadata } from '@/types/storage'
import { DEVICE_TOKEN, QUOTE, TRACK_JOB_ID, UPLOAD_ID } from '../api/__fixtures__/recorded'
import { createFakeCloud } from '../api/__fixtures__/fake-cloud'
import { createDroneCleanClient } from '../api/client'
import { createMemorySession } from '../api/session'
import {
  SHADOW_SESSION_IDLE,
  configureShadowSession,
  useShadowSessionStore,
} from './use-shadow-session'

// The app's save path is what `timeline-persistence` registers with `project-saver` (its own test checks
// that); here the registered saver is a stand-in that records what the press had written when it ran.
const saveTimeline = vi.fn(async (_projectId: string) => undefined)

const RATE = toRate(59.94)
const MARK = { x: 1860.25, y: 2410.5, sourceFrame: 3630, radius: 96.5 }
const WINDOW = {
  startFrame: 3330,
  endFrame: 3930,
  startSeconds: frameToSeconds(RATE, 3330),
  endSeconds: frameToSeconds(RATE, 3930),
}

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

const CLIP: VideoItem = {
  id: 'clip-1',
  trackId: 'track-1',
  type: 'video',
  label: 'DJI_0020',
  mediaId: MEDIA.id,
  src: 'blob:clip-1',
  from: 0,
  durationInFrames: 13_839,
  sourceFps: 59.94,
  sourceWidth: 3840,
  sourceHeight: 2880,
  shadowRemoval: { mark: { ...MARK }, ranges: [], pieces: [] },
}

/** The session over the fake cloud, with the shell's own project save (nothing injected for it). */
function connect(): ReturnType<typeof createFakeCloud> {
  const cloud = createFakeCloud()
  const session = createMemorySession(DEVICE_TOKEN.access_token)
  configureShadowSession({
    client: createDroneCleanClient({
      baseUrl: 'https://droneclean.test',
      fetch: cloud.server.fetch,
      session,
      openUrl: () => undefined,
    }),
    session,
    savePiece: async () => 'blob:cleaned-piece',
    sleep: async () => undefined,
    newAttemptId: () => '0b6f9c3e-7a52-4f0e-9d1c-00000000cccc',
    now: () => new Date('2026-11-18T10:00:00.000Z'),
  })
  useShadowSessionStore.setState({
    ...SHADOW_SESSION_IDLE,
    clipId: CLIP.id,
    isOpen: true,
    stage: 'ready',
    pass: {
      jobId: TRACK_JOB_ID,
      chargedCredits: 20,
      refundedCredits: 0,
      uploadId: UPLOAD_ID,
      mark: MARK,
      window: WINDOW,
      points: [{ frame: 3360, x: 1860.25, y: 2410.5, radius: 96.5 }],
      ranges: [{ startFrame: 3360, endFrame: 3390 }],
    },
    quote: QUOTE,
  })
  return cloud
}

describe('the press saves the project the way Cmd+S does', () => {
  beforeEach(() => {
    saveTimeline.mockClear()
    setProjectSaver(async () => {
      const id = useProjectStore.getState().currentProject?.id
      if (!id) throw new Error('No project is open.')
      await saveTimeline(id)
    })
    useItemsStore.getState().setItems([CLIP])
    useTimelineSettingsStore.setState({ fps: 59.94 })
    useMediaLibraryStore.setState({ mediaItems: [MEDIA] })
  })

  afterEach(() => {
    setProjectSaver(null)
    useProjectStore.setState({ currentProject: null })
    configureShadowSession(null)
  })

  it('saves the open project with saveTimeline, with the press already on the record', async () => {
    useProjectStore.setState({ currentProject: { id: 'project-1' } as never })
    const pendingAtSave: number[] = []
    saveTimeline.mockImplementation(async () => {
      const item = useItemsStore.getState().itemById[CLIP.id] as VideoItem
      pendingAtSave.push(item.shadowRemoval?.pending?.length ?? 0)
    })
    const cloud = connect()

    await useShadowSessionStore.getState().clean(CLIP)

    expect(saveTimeline).toHaveBeenCalledTimes(1)
    expect(saveTimeline).toHaveBeenCalledWith('project-1')
    expect(pendingAtSave).toEqual([1])
    expect(cloud.fullJobs()).toHaveLength(1)
    expect(useShadowSessionStore.getState().projectNotSaved).toBe(false)
  })

  it('says the project was not saved when no project is open, and still cleans', async () => {
    const cloud = connect()

    await useShadowSessionStore.getState().clean(CLIP)

    expect(saveTimeline).not.toHaveBeenCalled()
    expect(useShadowSessionStore.getState().projectNotSaved).toBe(true)
    expect(cloud.fullJobs()).toHaveLength(1)
    const item = useItemsStore.getState().itemById[CLIP.id] as VideoItem
    expect(item.shadowRemoval?.pieces).toHaveLength(1)
  })
})
