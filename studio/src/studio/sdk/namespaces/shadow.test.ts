// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { seedMediaLibrary } from '@/headless/seed-media'
import { usePlaybackStore } from '@/shared/state/playback'
import { SHADOW_SESSION_IDLE, useShadowSessionStore } from '@/studio/shadow/ui/use-shadow-session'
import { StudioError } from '../errors'
import type { ShadowApi } from '../types'
import { createShadowApi } from './shadow'

const MEDIA: MediaMetadata = {
  id: 'm-1',
  storageType: 'workspace',
  fileName: 'DJI_0020.mp4',
  fileSize: 1_000_000,
  mimeType: 'video/mp4',
  duration: 10,
  width: 2880,
  height: 2160,
  fps: 30,
  codec: 'h264',
  bitrate: 8_000_000,
  tags: [],
  createdAt: 1,
  updatedAt: 1,
}

const INITIAL = useShadowSessionStore.getState()
const PASS = {
  jobId: 'j1',
  uploadId: 'u1',
  mark: { x: 1, y: 1, sourceFrame: 0, radius: 5 },
  window: { startFrame: 0, endFrame: 100 },
  points: [],
  ranges: [{ startFrame: 10, endFrame: 40 }],
}
const QUOTE = {
  seconds: 1,
  creditsPerSecond: 12,
  costCredits: 12,
  minimumCredits: 1,
  availableCredits: 100,
  enough: true,
}

let shadow: ShadowApi

/** The session as a finished free pass leaves it. */
function followed(patch: Record<string, unknown> = {}): void {
  useShadowSessionStore.setState({
    clipId: 'c1',
    pass: PASS,
    quote: QUOTE,
    stage: 'ready',
    ...patch,
  } as never)
}

async function rejectedAsync(run: () => Promise<unknown>): Promise<StudioError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to reject')
}

function rejected(run: () => unknown): StudioError {
  try {
    run()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

describe('studio.shadow', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useShadowSessionStore.setState(INITIAL, true)
    useShadowSessionStore.setState({ ...SHADOW_SESSION_IDLE })
    useTimelineSettingsStore.getState().setFps(30)
    usePlaybackStore.getState().setCurrentFrame(5)
    useMediaLibraryStore.setState({ mediaItems: [], mediaById: {}, brokenMediaIds: [] })
    seedMediaLibrary([{ metadata: MEDIA }])
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'c1',
        trackId: 'v1',
        from: 0,
        durationInFrames: 300,
        mediaId: 'm-1',
        sourceStart: 0,
        sourceEnd: 300,
        sourceDuration: 300,
        sourceFps: 30,
      }),
      makeTimelineVideoItem({ id: 'c2', trackId: 'v1', from: 400, durationInFrames: 30 }),
      makeTimelineAudioItem({ id: 'ca', trackId: 'a1', from: 500, durationInFrames: 30 }),
    ])
    shadow = createShadowApi()
  })

  describe('get', () => {
    it('reads the mark, the pass and the price of the clip', () => {
      expect(shadow.get('c1')).toMatchObject({ mark: null, stage: 'idle', ranges: [], quote: null })

      followed()

      expect(shadow.get('c1')).toMatchObject({
        ranges: [{ startFrame: 10, endFrame: 40 }],
        quote: { costCredits: 12, enough: true },
      })
      expect(shadow.get('c2').quote).toBeNull()
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      expect(rejected(() => shadow.get('c9')).code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video', () => {
      expect(rejected(() => shadow.get('ca')).code).toBe('UNSUPPORTED')
    })
  })

  describe('mark', () => {
    it("writes the mark with the playhead frame and the preview's default radius, one undo step", () => {
      const depth = useTimelineCommandStore.getState().undoStack.length

      shadow.mark('c1', { x: 1440, y: 1200 })

      expect(shadow.get('c1').mark).toEqual({ x: 1440, y: 1200, sourceFrame: 5, radius: 76 })
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(depth + 1)
    })

    it('takes the frame and radius it is given', () => {
      shadow.mark('c1', { x: 10, y: 20, sourceFrame: 42, radius: 30 })

      expect(shadow.get('c1').mark).toEqual({ x: 10, y: 20, sourceFrame: 42, radius: 30 })
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      expect(rejected(() => shadow.mark('c9', { x: 1, y: 1 })).code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video', () => {
      expect(rejected(() => shadow.mark('ca', { x: 1, y: 1 })).code).toBe('UNSUPPORTED')
    })

    it('throws INVALID_ARGUMENT for a point outside the picture, a bad radius and a playhead outside the clip', () => {
      const outside = rejected(() => shadow.mark('c1', { x: 5000, y: 1 }))
      expect(outside.code).toBe('INVALID_ARGUMENT')
      expect(outside.argument).toBe('mark')

      const radius = rejected(() => shadow.mark('c1', { x: 1, y: 1, radius: 0 }))
      expect(radius.code).toBe('INVALID_ARGUMENT')

      usePlaybackStore.getState().setCurrentFrame(1000)
      const playhead = rejected(() => shadow.mark('c1', { x: 1, y: 1 }))
      expect(playhead.code).toBe('INVALID_ARGUMENT')
      expect(playhead.argument).toBe('mark.sourceFrame')
    })
  })

  describe('follow', () => {
    it('runs the free pass and returns the ranges and the price', async () => {
      shadow.mark('c1', { x: 100, y: 100 })
      useShadowSessionStore.setState({
        track: vi.fn(async () => followed()),
      })

      const result = await shadow.follow('c1')

      expect(result.ranges).toEqual([{ startFrame: 10, endFrame: 40 }])
      expect(result.quote?.costCredits).toBe(12)
    })

    it('throws NOT_FOUND for an unknown clip id', async () => {
      expect((await rejectedAsync(() => shadow.follow('c9'))).code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video', async () => {
      expect((await rejectedAsync(() => shadow.follow('ca'))).code).toBe('UNSUPPORTED')
    })

    it('throws MEDIA_UNAVAILABLE for a clip whose file is not in the library', async () => {
      expect((await rejectedAsync(() => shadow.follow('c2'))).code).toBe('MEDIA_UNAVAILABLE')
    })

    it('throws CONFLICT before the shadow is marked, and when the user must approve a sign-in', async () => {
      const unmarked = await rejectedAsync(() => shadow.follow('c1'))
      expect(unmarked.code).toBe('CONFLICT')
      expect(unmarked.hint).toContain('studio.shadow.mark')

      shadow.mark('c1', { x: 100, y: 100 })
      useShadowSessionStore.setState({
        track: vi.fn(async () => {
          useShadowSessionStore.setState({ clipId: 'c1', needsSignIn: true, error: 'Sign in' })
        }),
      })
      const signIn = await rejectedAsync(() => shadow.follow('c1'))
      expect(signIn.code).toBe('CONFLICT')
      expect(signIn.message).toContain('approve the DroneClean sign-in in the app')
    })

    it("throws INTERNAL with the service's words when the pass fails", async () => {
      shadow.mark('c1', { x: 100, y: 100 })
      useShadowSessionStore.setState({
        track: vi.fn(async () => {
          useShadowSessionStore.setState({ clipId: 'c1', error: 'The upload failed.' })
        }),
      })

      const error = await rejectedAsync(() => shadow.follow('c1'))

      expect(error.code).toBe('INTERNAL')
      expect(error.message).toContain('The upload failed.')
    })
  })

  describe('quote', () => {
    it('asks the price again and returns it', async () => {
      followed()
      const refreshQuote = vi.fn(async () => {
        useShadowSessionStore.setState({ quote: { ...QUOTE, costCredits: 15 } })
      })
      useShadowSessionStore.setState({ refreshQuote })

      expect((await shadow.quote('c1')).costCredits).toBe(15)
    })

    it('throws NOT_FOUND for an unknown clip id', async () => {
      expect((await rejectedAsync(() => shadow.quote('c9'))).code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video', async () => {
      expect((await rejectedAsync(() => shadow.quote('ca'))).code).toBe('UNSUPPORTED')
    })

    it('throws CONFLICT before the shadow is followed', async () => {
      expect((await rejectedAsync(() => shadow.quote('c1'))).code).toBe('CONFLICT')
    })

    it('throws INTERNAL when the price cannot be read', async () => {
      followed()
      useShadowSessionStore.setState({
        refreshQuote: vi.fn(async () => {
          useShadowSessionStore.setState({ error: 'offline' })
        }),
      })

      expect((await rejectedAsync(() => shadow.quote('c1'))).code).toBe('INTERNAL')
    })
  })

  describe('clean', () => {
    /** The session with a followed pass and a clean that records the press. */
    function armed(price = QUOTE) {
      const clean = vi.fn(async () => undefined)
      followed({ quote: price })
      useShadowSessionStore.setState({ refreshQuote: vi.fn(async () => undefined), clean })
      return clean
    }

    it('cleans at exactly the confirmed price', async () => {
      const clean = armed()

      const result = await shadow.clean('c1', 12)

      expect(clean).toHaveBeenCalledOnce()
      expect(result).toMatchObject({
        creditsSpent: 12,
        ranges: [{ startFrame: 10, endFrame: 40 }],
      })
    })

    it('throws NOT_FOUND for an unknown clip id', async () => {
      expect((await rejectedAsync(() => shadow.clean('c9', 12))).code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video', async () => {
      expect((await rejectedAsync(() => shadow.clean('ca', 12))).code).toBe('UNSUPPORTED')
    })

    it('throws INVALID_ARGUMENT unless the expected credits are a whole number', async () => {
      const clean = armed()

      for (const credits of [-1, 1.5, Number.NaN, '12' as unknown as number]) {
        const error = await rejectedAsync(() => shadow.clean('c1', credits))
        expect(error.code).toBe('INVALID_ARGUMENT')
      }
      expect(clean).not.toHaveBeenCalled()
    })

    it('throws CONFLICT, and spends nothing, when the price differs from the credits expected', async () => {
      const clean = armed()

      const error = await rejectedAsync(() => shadow.clean('c1', 11))

      expect(error.code).toBe('CONFLICT')
      expect(error.message).toContain('the price is 12 credits, not the 11 expected')
      expect(clean).not.toHaveBeenCalled()
    })

    it('throws CONFLICT, and spends nothing, when the balance does not cover the price or nothing was followed', async () => {
      const clean = armed({ ...QUOTE, enough: false, availableCredits: 3 })
      const short = await rejectedAsync(() => shadow.clean('c1', 12))
      expect(short.code).toBe('CONFLICT')
      expect(short.message).toContain('does not cover')

      useShadowSessionStore.setState({ pass: null, quote: null })
      const none = await rejectedAsync(() => shadow.clean('c1', 12))
      expect(none.code).toBe('CONFLICT')
      expect(clean).not.toHaveBeenCalled()
    })

    it('throws CONFLICT when the user must approve a sign-in in the app', async () => {
      armed()
      useShadowSessionStore.setState({
        clean: vi.fn(async () => {
          useShadowSessionStore.setState({ needsSignIn: true, error: 'Sign in' })
        }),
      })

      const error = await rejectedAsync(() => shadow.clean('c1', 12))

      expect(error.code).toBe('CONFLICT')
      expect(error.hint).toContain('approve the sign-in in the app')
    })

    it("throws INTERNAL with the service's words when the clean fails", async () => {
      armed()
      useShadowSessionStore.setState({
        clean: vi.fn(async () => {
          useShadowSessionStore.setState({ error: 'The job failed.' })
        }),
      })

      const error = await rejectedAsync(() => shadow.clean('c1', 12))

      expect(error.code).toBe('INTERNAL')
      expect(error.message).toContain('The job failed.')
    })

    it("studio.shadow.clean('c1', 12)", async () => {
      armed()

      await expect(shadow.clean('c1', 12)).resolves.toMatchObject({ creditsSpent: 12 })
    })
  })
})
