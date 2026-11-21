// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import type { Transition } from '@/types/transition'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { buildTimelineFromStores } from '@/features/timeline/stores/timeline-persistence'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { createDefaultTextItem } from '@/features/timeline/utils/generated-layer-items'
import { seedMediaLibrary } from '@/headless/seed-media'
import { StudioError } from '../errors'
import { transaction } from '../transaction'
import type { ClipType, ClipsApi, StabilizationPatch } from '../types'
import { createClipsApi } from './clips'
import { useLooksStore } from '@/studio/looks/store'
import { NoLensProfileError, NoMotionDataError } from '@/studio/stabilization/client'
import { analyzeMediaBeats } from '@/studio/beats/analyze'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'

/** The engine the stabilization methods open clips on: a fake that answers as the real one does. */
const fakeEngine = vi.hoisted(() => ({
  probeError: null as Error | null,
  probe: vi.fn(),
  applySettings: vi.fn(async () => undefined),
  smoothingMethods: vi.fn(async () => [
    {
      name: 'Default',
      params: [
        { name: 'smoothness', description: '', default: 0.5, min: 0.001, max: 1, unit: null },
      ],
    },
  ]),
}))
vi.mock('@/studio/stabilization/ui/engine', () => ({ pageEngine: fakeEngine }))

/** The looks index of the workspace folder, as `looks/index.json` would answer it. */
const fakeLooksIndex = vi.hoisted(() => ({
  read: vi.fn<() => Promise<unknown[]>>(async () => []),
}))
vi.mock('@/studio/looks/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/studio/looks/workspace')>()),
  readLooksIndex: fakeLooksIndex.read,
}))

vi.mock('@/studio/beats/analyze', () => ({ analyzeMediaBeats: vi.fn() }))
const analyzeBeats = vi.mocked(analyzeMediaBeats)

/** Run an async call that must be rejected with a `StudioError`. */
async function rejectedAsync(run: () => Promise<unknown>): Promise<StudioError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to reject')
}

/** An audio clip, for the methods that are for video clips only. */
function addAudioClip(): string {
  useItemsStore
    .getState()
    .setItems([
      ...useItemsStore.getState().items,
      makeTimelineAudioItem({ id: 'ca', trackId: 'a1', from: 700, durationInFrames: 30 }),
    ])
  return 'ca'
}

/** A media library item with the editor's defaults; each test names what matters. */
function makeMedia(overrides: Partial<MediaMetadata> & Pick<MediaMetadata, 'id'>): MediaMetadata {
  return {
    storageType: 'workspace',
    fileName: 'drone.mp4',
    fileSize: 1_000_000,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 8_000_000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const VIDEO_MEDIA = makeMedia({ id: 'm-1' })
const IMAGE_MEDIA = makeMedia({
  id: 'm-2',
  fileName: 'map.png',
  mimeType: 'image/png',
  duration: 0,
  width: 800,
  height: 600,
})
const UNPLACEABLE_MEDIA = makeMedia({
  id: 'm-3',
  fileName: 'notes.bin',
  mimeType: 'application/octet-stream',
})
const AUDIO_MEDIA = makeMedia({
  id: 'm-4',
  fileName: 'music.mp3',
  mimeType: 'audio/mpeg',
  duration: 4,
  width: 0,
  height: 0,
})
const GIF_MEDIA = makeMedia({
  id: 'm-5',
  fileName: 'loop.gif',
  mimeType: 'image/gif',
  duration: 2,
  width: 480,
  height: 270,
})

/**
 * Two video tracks and one audio track, plus the clips the examples name:
 * `c1` spans frames 0..300 on `v1`, `c2` sits at 500..600 on `v2`.
 */
function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
    ])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'c1',
      trackId: 'v1',
      from: 0,
      durationInFrames: 300,
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 600,
      sourceFps: 30,
      volume: 0,
      transform: { x: 10, width: 1920 },
    }),
    makeTimelineVideoItem({
      id: 'c2',
      trackId: 'v2',
      from: 500,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 100,
      sourceDuration: 600,
      sourceFps: 30,
      volume: 0,
      speed: 2,
      isReversed: true,
      audioFadeIn: 0.5,
      fadeIn: 1,
      transform: { opacity: 0.5 },
    }),
  ])
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

function lastCommandType(): string | null {
  const { undoStack } = useTimelineCommandStore.getState()
  return undoStack[undoStack.length - 1]?.command.type ?? null
}

function undo(): void {
  useTimelineCommandStore.getState().undo()
}

/** The project as `saveTimeline` serialises it: the state an undo must restore. */
function snapshot(): ReturnType<typeof buildTimelineFromStores> {
  return buildTimelineFromStores()
}

function catchError(run: () => unknown): StudioError {
  try {
    run()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

/**
 * Run a call that must be rejected: it throws a `StudioError`, adds no undo
 * entry, and leaves the project exactly as it was.
 */
function rejected(run: () => unknown): StudioError {
  const before = snapshot()
  const depth = undoDepth()
  const error = catchError(run)
  expect(snapshot()).toEqual(before)
  expect(undoDepth()).toBe(depth)
  return error
}

/** A crossfade centred on the cut, as the transitions tests write one. */
function makeTransition(overrides: Partial<Transition> = {}): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'c1',
    rightClipId: 'c3',
    trackId: 'v1',
    durationInFrames: 30,
    alignment: 0.5,
    ...overrides,
  }
}

const LOOK = {
  id: 'look-1',
  name: 'Teal',
  fileName: 'teal.cube',
  filePath: 'teal.cube',
  size: 33,
  hasShaper: false,
  entryOrder: 'red-fastest' as const,
  hash: 'h',
  addedAt: 1,
}

let studio: { clips: ClipsApi }

describe('studio.clips', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.getState().setFps(30)
    useMediaLibraryStore.setState({ mediaItems: [], mediaById: {} })
    seedMediaLibrary([
      { metadata: VIDEO_MEDIA },
      { metadata: IMAGE_MEDIA },
      { metadata: UNPLACEABLE_MEDIA },
      { metadata: AUDIO_MEDIA },
      { metadata: GIF_MEDIA },
    ])
    seedTimeline()
    studio = { clips: createClipsApi() }
  })

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  describe('list and get', () => {
    it('lists every clip as a plain copy', () => {
      const clips = studio.clips.list()

      expect(clips.map((clip) => clip.id)).toEqual(['c1', 'c2'])
      expect(clips[0]).toMatchObject({
        id: 'c1',
        trackId: 'v1',
        type: 'video',
        from: 0,
        durationInFrames: 300,
        label: 'clip.mp4',
        mediaId: 'media-1',
        sourceStart: 0,
        sourceEnd: 300,
        sourceDuration: 600,
        sourceFps: 30,
        volume: 0,
        transform: { x: 10, width: 1920 },
      })
      expect(clips[1]).toMatchObject({
        speed: 2,
        isReversed: true,
        audioFadeIn: 0.5,
        fadeIn: 1,
        transform: { opacity: 0.5 },
      })
    })

    it('returns fresh objects mutating them cannot reach the store', () => {
      const first = studio.clips.list()[0]!
      const again = studio.clips.list()[0]!

      expect(first).not.toBe(again)
      first.label = 'mutated'
      first.from = 999
      first.transform!.x = 999

      expect(studio.clips.get('c1')).toMatchObject({
        label: 'clip.mp4',
        from: 0,
        transform: { x: 10, width: 1920 },
      })
      expect(useItemsStore.getState().itemById['c1']?.transform?.x).toBe(10)
    })

    it('filters by track and by kind', () => {
      expect(studio.clips.list({ trackId: 'v1' }).map((clip) => clip.id)).toEqual(['c1'])
      expect(studio.clips.list({ type: 'video' }).map((clip) => clip.id)).toEqual(['c1', 'c2'])
      expect(studio.clips.list({ trackId: 'v2', type: 'video' }).map((clip) => clip.id)).toEqual([
        'c2',
      ])
      expect(studio.clips.list({ type: 'audio' })).toEqual([])
      expect(studio.clips.list({ trackId: 'nope' })).toEqual([])
    })

    it('throws nothing for a filter value that matches nothing', () => {
      // @throws Nothing: reads never fail on an unmatched filter.
      expect(studio.clips.list({ type: 'nope' as ClipType })).toEqual([])
      expect(studio.clips.list({ trackId: 'nope', type: 'audio' })).toEqual([])
    })

    it('gets one clip, or null when it does not exist', () => {
      expect(studio.clips.get('c1')).toMatchObject({ id: 'c1', trackId: 'v1' })
      expect(studio.clips.get('c9')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // add
  // -------------------------------------------------------------------------

  describe('add', () => {
    it('places a media clip like a drop, with mediaId and an empty src', () => {
      const before = snapshot()
      const depth = undoDepth()

      const id = studio.clips.add({ mediaId: 'm-1', trackId: 'v2', from: 0 })

      expect(id).not.toBe('')
      expect(studio.clips.get(id)).toMatchObject({
        trackId: 'v2',
        type: 'video',
        from: 0,
        durationInFrames: 300,
        label: 'drone.mp4',
        mediaId: 'm-1',
        sourceStart: 0,
        sourceEnd: 300,
        sourceDuration: 300,
        sourceFps: 30,
      })
      expect(useItemsStore.getState().itemById[id]?.transform).toBeDefined()
      // The drop path stores the media id and leaves `src` for preview/export
      // to refill, exactly as the headless harness does.
      const stored = useItemsStore.getState().itemById[id]
      expect(stored && 'src' in stored ? stored.src : null).toBe('')
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_ADD')

      undo()

      expect(studio.clips.get(id)).toBeNull()
      expect(snapshot()).toEqual(before)
    })

    it('throws CONFLICT for a clip that overlaps one, naming it and the first free frame', () => {
      // c1 occupies frames 0..299 of v1, so a drop at 0 would land at 300.
      const error = rejected(() => studio.clips.add({ mediaId: 'm-1', trackId: 'v1', from: 0 }))

      expect(error.code).toBe('CONFLICT')
      expect(error.message).toContain('clip "c1" (frames 0..300)')
      expect(error.message).toContain('the first free frame where it fits is 300')
      expect(error.entity).toEqual({ kind: 'clip', id: 'c1' })
      expect(error.hint).toContain('onOverlap')
    })

    it("throws CONFLICT for onOverlap 'fail' too, and places a clip that does not overlap", () => {
      const error = rejected(() =>
        studio.clips.add({ mediaId: 'm-1', trackId: 'v1', from: 100, onOverlap: 'fail' }),
      )
      expect(error.code).toBe('CONFLICT')
      expect(error.message).toContain('the first free frame where it fits is 300')

      const id = studio.clips.add({ mediaId: 'm-1', trackId: 'v1', from: 300, onOverlap: 'fail' })
      expect(studio.clips.get(id)?.from).toBe(300)
    })

    it("moves the clip with onOverlap 'move' and says the frame it chose", () => {
      const placed = studio.clips.add({
        mediaId: 'm-1',
        trackId: 'v1',
        from: 0,
        onOverlap: 'move',
      })

      expect(placed).toEqual({ id: expect.any(String), from: 300, requestedFrom: 0, moved: true })
      expect(studio.clips.get(placed.id)?.from).toBe(300)
    })

    it("answers moved false with onOverlap 'move' when the clip fits where it was asked", () => {
      const placed = studio.clips.add({
        mediaId: 'm-1',
        trackId: 'v2',
        from: 40,
        onOverlap: 'move',
      })

      expect(placed).toMatchObject({ from: 40, requestedFrom: 40, moved: false })
    })

    it('throws INVALID_ARGUMENT for an onOverlap that is not move or fail', () => {
      const error = rejected(() =>
        studio.clips.add({
          mediaId: 'm-1',
          trackId: 'v2',
          from: 0,
          onOverlap: 'push' as unknown as 'move',
        }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('onOverlap')
    })

    it('honours durationInFrames and label', () => {
      const id = studio.clips.add({
        mediaId: 'm-1',
        trackId: 'v2',
        from: 0,
        durationInFrames: 90,
        label: 'take off',
      })

      expect(studio.clips.get(id)).toMatchObject({
        from: 0,
        durationInFrames: 90,
        sourceEnd: 90,
        label: 'take off',
      })
    })

    it('derives the kind of an image and of an audio item from the media', () => {
      const image = studio.clips.add({ mediaId: 'm-2', trackId: 'v2', from: 0 })
      expect(studio.clips.get(image)).toMatchObject({
        type: 'image',
        durationInFrames: 90,
        label: 'map.png',
        mediaId: 'm-2',
      })

      const audio = studio.clips.add({ mediaId: 'm-4', trackId: 'a1', from: 0 })
      expect(studio.clips.get(audio)).toMatchObject({
        type: 'audio',
        trackId: 'a1',
        durationInFrames: 120,
        label: 'music.mp3',
      })
    })

    it('refuses a video track for an audio clip, and lists the audio tracks', () => {
      const error = rejected(() => studio.clips.add({ mediaId: 'm-4', trackId: 'v1', from: 0 }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('trackId')
      expect(error.valid).toEqual(['a1'])
      expect(error.message).toBe(
        'clips.add: "trackId" must be a track that fits a clip of type audio (got "v1"); ' +
          'valid: "a1"',
      )
      expect(error.hint).toContain('An audio clip needs an audio track')
    })

    it('refuses an audio track for a video clip, and lists the video tracks', () => {
      const error = rejected(() => studio.clips.add({ mediaId: 'm-1', trackId: 'a1', from: 0 }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('trackId')
      expect(error.valid).toEqual(['v1', 'v2'])
      expect(error.message).toBe(
        'clips.add: "trackId" must be a track that fits a clip of type video (got "a1"); ' +
          'valid: "v1", "v2"',
      )
    })

    it('throws NOT_FOUND for an unknown media id and changes nothing', () => {
      const error = rejected(() => studio.clips.add({ mediaId: 'm-9', trackId: 'v1', from: 0 }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('mediaId')
      expect(error.entity).toEqual({ kind: 'media', id: 'm-9' })
      expect(error.message).toContain(
        'clips.add: "mediaId" must be an existing media id in the media library (got "m-9")',
      )
      expect(error.message).toContain('valid: ')
    })

    it('throws NOT_FOUND for an unknown track id', () => {
      const error = rejected(() => studio.clips.add({ mediaId: 'm-1', trackId: 'nope', from: 0 }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('trackId')
      expect(error.entity).toEqual({ kind: 'track', id: 'nope' })
      expect(error.message).toBe(
        'clips.add: "trackId" must be an existing track id on the main timeline (got "nope"); ' +
          'valid: "v1", "v2", "a1"',
      )
    })

    it('throws INVALID_ARGUMENT when from is not an integer frame >= 0', () => {
      const cases: Array<[unknown, string]> = [
        [-1, '-1'],
        [1.5, '1.5'],
        ['12', '"12"'],
        [Number.NaN, 'null'],
      ]
      for (const [from, shown] of cases) {
        const error = rejected(() =>
          studio.clips.add({ mediaId: 'm-1', trackId: 'v1', from: from as number }),
        )

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('from')
        expect(error.message).toBe(`clips.add: "from" must be an integer frame >= 0 (got ${shown})`)
      }
    })

    it('throws INVALID_ARGUMENT when durationInFrames is not a frame count', () => {
      const error = rejected(() =>
        studio.clips.add({ mediaId: 'm-1', trackId: 'v1', from: 0, durationInFrames: 1.5 }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('durationInFrames')
      expect(error.message).toBe(
        'clips.add: "durationInFrames" must be an integer frame >= 0 (got 1.5)',
      )
    })

    it('throws UNSUPPORTED for media the timeline cannot place', () => {
      const error = rejected(() => studio.clips.add({ mediaId: 'm-3', trackId: 'v1', from: 0 }))

      expect(error.code).toBe('UNSUPPORTED')
      expect(error.argument).toBe('mediaId')
      expect(error.entity).toEqual({ kind: 'media', id: 'm-3' })
      expect(error.message).toBe(
        'clips.add: "mediaId" must name a video, audio, image or lottie item ' +
          '(got "m-3" of type "unknown")',
      )
      expect(error.hint).toContain('studio.media.list()')
    })
  })

  // -------------------------------------------------------------------------
  // addMany
  // -------------------------------------------------------------------------

  describe('add with a source range', () => {
    it('rejects a range with one end missing, outside the file or not whole frames', () => {
      const bad: Array<Record<string, unknown>> = [
        { sourceStart: 10 },
        { sourceEnd: 10 },
        { sourceStart: 10, sourceEnd: 10 },
        { sourceStart: -1, sourceEnd: 10 },
        { sourceStart: 0, sourceEnd: 301 },
        { sourceStart: 0.5, sourceEnd: 10 },
        { sourceStart: 0, sourceEnd: '10' },
      ]
      for (const range of bad) {
        const error = rejected(() =>
          studio.clips.add({ mediaId: 'm-1', trackId: 'v1', from: 0, ...range }),
        )
        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.message).toContain('clips.add: ')
        expect(error.argument).toMatch(/^source(Start|End)$/)
      }
    })

    it('rejects a range on an image and a durationInFrames that disagrees with it', () => {
      const image = rejected(() =>
        studio.clips.add({
          mediaId: 'm-2',
          trackId: 'v1',
          from: 0,
          sourceStart: 0,
          sourceEnd: 1,
        }),
      )
      expect(image.code).toBe('INVALID_ARGUMENT')
      expect(image.message).toContain('clips.add: "sourceStart"')

      const length = rejected(() =>
        studio.clips.add({
          mediaId: 'm-1',
          trackId: 'v1',
          from: 0,
          durationInFrames: 100,
          sourceStart: 90,
          sourceEnd: 210,
        }),
      )
      expect(length.code).toBe('INVALID_ARGUMENT')
      expect(length.argument).toBe('durationInFrames')
      expect(length.message).toContain('clips.add: "durationInFrames"')
    })
  })

  describe('addMany', () => {
    it('places every input in one undo step, each after the one before it', () => {
      useItemsStore
        .getState()
        .setTracks([
          ...useItemsStore.getState().tracks,
          makeTimelineTrack({ id: 'v3', name: 'V3', kind: 'video', order: 3 }),
        ])
      const before = snapshot()
      const depth = undoDepth()

      const [first, second] = studio.clips.addMany([
        { mediaId: 'm-1', trackId: 'v3', from: 0 },
        { mediaId: 'm-1', trackId: 'v3', from: 0, onOverlap: 'move' },
      ])
      const ids = [first as string, (second as { id: string }).id]

      expect(typeof first).toBe('string')
      expect(second).toEqual({ id: ids[1], from: 300, requestedFrom: 0, moved: true })
      expect(studio.clips.get(ids[0]!)?.from).toBe(0)
      expect(studio.clips.get(ids[1]!)?.from).toBe(300)
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_ADD_MANY')

      undo()

      expect(studio.clips.get(ids[0]!)).toBeNull()
      expect(studio.clips.get(ids[1]!)).toBeNull()
      expect(snapshot()).toEqual(before)
    })

    it('throws CONFLICT for an input that overlaps, naming its index, and adds nothing', () => {
      const before = snapshot()
      const depth = undoDepth()

      const error = rejected(() =>
        studio.clips.addMany([
          { mediaId: 'm-1', trackId: 'v2', from: 0 },
          { mediaId: 'm-1', trackId: 'v1', from: 100 },
        ]),
      )

      expect(error.code).toBe('CONFLICT')
      expect(error.argument).toBe('inputs[1].from')
      expect(error.message).toContain('inputs[1]:')
      expect(error.message).toContain('clip "c1" (frames 0..300)')
      expect(error.message).toContain('the first free frame where it fits is 300')
      expect(snapshot()).toEqual(before)
      expect(undoDepth()).toBe(depth)
    })

    it('throws CONFLICT for an input that overlaps an earlier input of the same call', () => {
      const error = rejected(() =>
        studio.clips.addMany([
          { mediaId: 'm-1', trackId: 'v2', from: 0 },
          { mediaId: 'm-1', trackId: 'v2', from: 10 },
        ]),
      )

      expect(error.code).toBe('CONFLICT')
      expect(error.argument).toBe('inputs[1].from')
      expect(error.message).not.toContain('"c1"')
      expect(error.message).toMatch(/the first free frame where it fits is \d+/)
    })

    it("reports each input's frame with onOverlap 'move', moved or not", () => {
      const [stays, moved] = studio.clips.addMany([
        { mediaId: 'm-1', trackId: 'v2', from: 40, onOverlap: 'move' },
        { mediaId: 'm-1', trackId: 'v1', from: 0, onOverlap: 'move' },
      ])

      expect(stays).toMatchObject({ from: 40, requestedFrom: 40, moved: false })
      expect(moved).toMatchObject({ from: 300, requestedFrom: 0, moved: true })
      expect(studio.clips.get(moved!.id)?.from).toBe(300)
    })

    it('throws INVALID_ARGUMENT for an onOverlap that is not move or fail', () => {
      const before = snapshot()

      const error = rejected(() =>
        studio.clips.addMany([
          { mediaId: 'm-1', trackId: 'v2', from: 0, onOverlap: 'push' as unknown as 'move' },
        ]),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('onOverlap')
      expect(snapshot()).toEqual(before)
    })

    it('adds nothing when a later input is rejected', () => {
      const before = snapshot()

      const error = rejected(() =>
        studio.clips.addMany([
          { mediaId: 'm-1', trackId: 'v2', from: 0 },
          { mediaId: 'm-9', trackId: 'v2', from: 0 },
        ]),
      )

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('mediaId')
      expect(error.message).toContain('clips.addMany: "mediaId"')
      expect(snapshot()).toEqual(before)
    })

    it('adds nothing when a later input asks for a track of the wrong kind', () => {
      const before = snapshot()

      const error = rejected(() =>
        studio.clips.addMany([
          { mediaId: 'm-1', trackId: 'v2', from: 0 },
          { mediaId: 'm-4', trackId: 'v1', from: 0 },
        ]),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('trackId')
      expect(error.valid).toEqual(['a1'])
      expect(error.message).toBe(
        'clips.addMany: "trackId" must be a track that fits a clip of type audio (got "v1"); ' +
          'valid: "a1"',
      )
      expect(snapshot()).toEqual(before)
    })

    it('adds nothing when a later input names media that cannot be placed', () => {
      const before = snapshot()

      const error = rejected(() =>
        studio.clips.addMany([
          { mediaId: 'm-1', trackId: 'v2', from: 0 },
          { mediaId: 'm-3', trackId: 'v2', from: 400 },
        ]),
      )

      expect(error.code).toBe('UNSUPPORTED')
      expect(error.argument).toBe('mediaId')
      expect(error.message).toContain('clips.addMany: "mediaId"')
      expect(snapshot()).toEqual(before)
    })

    it('throws INVALID_ARGUMENT when inputs is not an array', () => {
      const error = rejected(() => studio.clips.addMany(null as never))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('inputs')
      expect(error.message).toBe(
        'clips.addMany: "inputs" must be an array of clip inputs (got null)',
      )
    })
  })

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('changes the label, gain and fades in one undo step', () => {
      const before = snapshot()
      const depth = undoDepth()

      studio.clips.update('c1', {
        label: 'take off',
        volume: -6,
        audioFadeIn: 0.5,
        audioFadeOut: 1,
        fadeIn: 0.25,
        fadeOut: 2,
      })

      expect(studio.clips.get('c1')).toMatchObject({
        label: 'take off',
        volume: -6,
        audioFadeIn: 0.5,
        audioFadeOut: 1,
        fadeIn: 0.25,
        fadeOut: 2,
      })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_UPDATE')

      undo()

      expect(snapshot()).toEqual(before)
    })

    it('merges transform fields instead of replacing them', () => {
      const before = snapshot()

      studio.clips.update('c1', { transform: { rotation: 45, opacity: 0.5 } })

      expect(studio.clips.get('c1')?.transform).toEqual({
        x: 10,
        width: 1920,
        rotation: 45,
        opacity: 0.5,
      })

      undo()

      expect(snapshot()).toEqual(before)
    })

    it('mutes a video clip embedded audio and clears the flag again', () => {
      const embeddedAudioMuted = (): boolean | undefined => {
        const item = useItemsStore.getState().itemById['c1']
        return item?.type === 'video' ? item.embeddedAudioMuted : undefined
      }

      studio.clips.update('c1', { muted: true })
      expect(embeddedAudioMuted()).toBe(true)

      studio.clips.update('c1', { muted: false })
      expect(embeddedAudioMuted()).toBe(false)
    })

    it('adds no undo entry when the patch changes nothing', () => {
      const depth = undoDepth()

      studio.clips.update('c1', {})
      studio.clips.update('c1', { volume: 0, label: 'clip.mp4' })
      studio.clips.update('c1', { transform: { x: 10 } })

      expect(undoDepth()).toBe(depth)
    })

    it('throws NOT_FOUND for an unknown clip', () => {
      const error = rejected(() => studio.clips.update('c9', { volume: -6 }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.entity).toEqual({ kind: 'clip', id: 'c9' })
      expect(error.message).toContain(
        'clips.update: "id" must be an existing clip id on the main timeline (got "c9")',
      )
      expect(error.message).toContain('valid: "c1", "c2"')
    })

    it('throws INVALID_ARGUMENT when volume is outside -60..12', () => {
      for (const volume of [-61, 13]) {
        const error = rejected(() => studio.clips.update('c1', { volume }))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('volume')
        expect(error.message).toBe(
          `clips.update: "volume" must be a number of dB from -60 to 12 (got ${volume})`,
        )
      }
    })

    it('throws INVALID_ARGUMENT when muted is asked of a clip with no embedded audio', () => {
      useItemsStore
        .getState()
        .setItems([
          ...useItemsStore.getState().items,
          makeTimelineAudioItem({ id: 'c4', trackId: 'a1' }),
        ])

      const error = rejected(() => studio.clips.update('c4', { muted: true }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('muted')
      expect(error.message).toBe(
        'clips.update: "muted" must be used only on a video clip, whose embedded audio it mutes ' +
          '(got true)',
      )
      expect(error.hint).toContain('"volume": -60')
    })
  })

  // -------------------------------------------------------------------------
  // move
  // -------------------------------------------------------------------------

  describe('move', () => {
    it('moves a clip to a frame and onto another track in one undo step', () => {
      const before = snapshot()
      const depth = undoDepth()

      studio.clips.move('c1', 120, 'v2')

      expect(studio.clips.get('c1')).toMatchObject({ from: 120, trackId: 'v2' })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_MOVE')

      undo()

      expect(snapshot()).toEqual(before)
    })

    it('keeps the track when none is named', () => {
      studio.clips.move('c1', 40)

      expect(studio.clips.get('c1')).toMatchObject({ from: 40, trackId: 'v1' })
    })

    it('adds no undo entry for a move that changes nothing', () => {
      const depth = undoDepth()

      studio.clips.move('c1', 0)
      studio.clips.move('c1', 0, 'v1')

      expect(undoDepth()).toBe(depth)
    })

    it('throws NOT_FOUND for an unknown clip or track', () => {
      const missingClip = rejected(() => studio.clips.move('c9', 10))
      expect(missingClip.code).toBe('NOT_FOUND')
      expect(missingClip.argument).toBe('id')
      expect(missingClip.message).toContain('clips.move: "id"')

      const missingTrack = rejected(() => studio.clips.move('c1', 10, 'nope'))
      expect(missingTrack.code).toBe('NOT_FOUND')
      expect(missingTrack.argument).toBe('trackId')
      expect(missingTrack.entity).toEqual({ kind: 'track', id: 'nope' })
      expect(missingTrack.message).toBe(
        'clips.move: "trackId" must be an existing track id on the main timeline (got "nope"); ' +
          'valid: "v1", "v2", "a1"',
      )
    })

    it('refuses a track of the wrong kind for the clip being moved', () => {
      const videoToAudio = rejected(() => studio.clips.move('c1', 10, 'a1'))

      expect(videoToAudio.code).toBe('INVALID_ARGUMENT')
      expect(videoToAudio.argument).toBe('trackId')
      expect(videoToAudio.valid).toEqual(['v1', 'v2'])
      expect(videoToAudio.message).toBe(
        'clips.move: "trackId" must be a track that fits a clip of type video (got "a1"); ' +
          'valid: "v1", "v2"',
      )

      const audio = makeTimelineAudioItem({ id: 'c4', trackId: 'a1', from: 0 })
      useItemsStore.getState().setItems([...useItemsStore.getState().items, audio])

      const audioToVideo = rejected(() => studio.clips.move('c4', 10, 'v1'))
      expect(audioToVideo.code).toBe('INVALID_ARGUMENT')
      expect(audioToVideo.argument).toBe('trackId')
      expect(audioToVideo.valid).toEqual(['a1'])
      expect(audioToVideo.message).toContain(
        'clips.move: "trackId" must be a track that fits a clip of type audio (got "v1")',
      )
      expect(studio.clips.get('c4')).toMatchObject({ from: 0, trackId: 'a1' })
    })

    it('throws INVALID_ARGUMENT when to is not an integer frame >= 0', () => {
      for (const to of [-3, 2.5, '120']) {
        const error = rejected(() => studio.clips.move('c1', to as number))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('to')
        expect(error.message).toContain('clips.move: "to" must be an integer frame >= 0')
      }
    })
  })

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('deletes clips in one undo step', () => {
      const before = snapshot()
      const depth = undoDepth()

      studio.clips.remove(['c2'])

      expect(studio.clips.get('c2')).toBeNull()
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_REMOVE')

      undo()

      expect(snapshot()).toEqual(before)
    })

    it('closes the gap when ripple is set', () => {
      useItemsStore.getState().setItems([
        ...useItemsStore.getState().items,
        makeTimelineVideoItem({
          id: 'c3',
          trackId: 'v1',
          from: 350,
          durationInFrames: 100,
          sourceStart: 0,
          sourceEnd: 100,
        }),
      ])
      const before = snapshot()
      const depth = undoDepth()

      studio.clips.remove(['c1'], { ripple: true })

      expect(studio.clips.get('c1')).toBeNull()
      // c3 sat 350 frames in; deleting c1's 300 frames pulls it 300 frames left.
      expect(studio.clips.get('c3')?.from).toBe(50)
      expect(undoDepth()).toBe(depth + 1)

      undo()

      expect(studio.clips.get('c1')).not.toBeNull()
      expect(studio.clips.get('c3')?.from).toBe(350)
      expect(snapshot()).toEqual(before)
    })

    it('adds no undo entry for an empty list', () => {
      const depth = undoDepth()

      studio.clips.remove([])

      expect(undoDepth()).toBe(depth)
    })

    it('throws NOT_FOUND for an unknown clip id and changes nothing', () => {
      const error = rejected(() => studio.clips.remove(['c1', 'c9']))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('ids')
      expect(error.entity).toEqual({ kind: 'clip', id: 'c9' })
      expect(error.message).toContain('clips.remove: "ids" must be an existing clip id')
      expect(studio.clips.get('c1')).not.toBeNull()
    })

    it('throws INVALID_ARGUMENT when ids is not an array', () => {
      const error = rejected(() => studio.clips.remove('c1' as never))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('ids')
      expect(error.message).toBe('clips.remove: "ids" must be an array of clip ids (got "c1")')
    })
  })

  // -------------------------------------------------------------------------
  // duplicate
  // -------------------------------------------------------------------------

  describe('duplicate', () => {
    it('copies a clip after itself, one clip length per copy, in one undo step', () => {
      const before = snapshot()
      const depth = undoDepth()

      const copies = studio.clips.duplicate(['c1'], { count: 2 })

      expect(copies).toHaveLength(2)
      expect(studio.clips.get(copies[0]!)?.from).toBe(300)
      expect(studio.clips.get(copies[1]!)?.from).toBe(600)
      expect(studio.clips.get(copies[0]!)).toMatchObject({ trackId: 'v1', durationInFrames: 300 })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_DUPLICATE')

      undo()

      expect(studio.clips.get(copies[0]!)).toBeNull()
      expect(studio.clips.get(copies[1]!)).toBeNull()
      expect(snapshot()).toEqual(before)
    })

    it('offsets copies by offsetFrames when given', () => {
      const copies = studio.clips.duplicate(['c1'], { offsetFrames: 30 })

      expect(studio.clips.get(copies[0]!)?.from).toBe(30)
    })

    it('makes one copy by default and copies each clip of the list', () => {
      const copies = studio.clips.duplicate(['c1', 'c2'])

      expect(copies).toHaveLength(2)
      expect(studio.clips.get(copies[0]!)).toMatchObject({ from: 300, trackId: 'v1' })
      expect(studio.clips.get(copies[1]!)).toMatchObject({ from: 600, trackId: 'v2' })
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.duplicate(['c9']))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('ids')
      expect(error.message).toContain('clips.duplicate: "ids"')
    })

    it('throws INVALID_ARGUMENT when count is not a positive integer', () => {
      for (const count of [0, -1, 1.5]) {
        const error = rejected(() => studio.clips.duplicate(['c1'], { count }))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('count')
        expect(error.message).toBe(
          `clips.duplicate: "count" must be a positive integer (got ${count})`,
        )
      }
    })

    it('throws INVALID_ARGUMENT when offsetFrames is not an integer frame', () => {
      const error = rejected(() => studio.clips.duplicate(['c1'], { offsetFrames: 1.5 }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('offsetFrames')
      expect(error.message).toBe(
        'clips.duplicate: "offsetFrames" must be an integer frame >= 0 (got 1.5)',
      )
    })
  })

  // -------------------------------------------------------------------------
  // split
  // -------------------------------------------------------------------------

  describe('split', () => {
    it('splits a clip into the two halves and returns their ids, in one undo step', () => {
      const before = snapshot()
      const depth = undoDepth()

      const [left, right] = studio.clips.split('c1', 240)

      // The left half keeps the original id; the right half is new.
      expect(left).toBe('c1')
      expect(right).not.toBe('c1')
      expect(studio.clips.get(left)).toMatchObject({
        from: 0,
        durationInFrames: 240,
        sourceStart: 0,
        sourceEnd: 240,
      })
      expect(studio.clips.get(right)).toMatchObject({
        from: 240,
        durationInFrames: 60,
        sourceStart: 240,
        sourceEnd: 300,
      })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_SPLIT')

      undo()

      expect(studio.clips.get(right)).toBeNull()
      expect(studio.clips.get('c1')).toMatchObject({ durationInFrames: 300 })
      expect(snapshot()).toEqual(before)
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.split('c9', 10))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.message).toContain('clips.split: "id"')
    })

    it('throws INVALID_ARGUMENT when frame is not an integer frame >= 0', () => {
      for (const frame of [-1, 2.5, '240']) {
        const error = rejected(() => studio.clips.split('c1', frame as number))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('frame')
        expect(error.message).toContain('clips.split: "frame" must be an integer frame >= 0')
      }
    })

    it('throws CONFLICT when the frame is outside the clip', () => {
      for (const frame of [0, 300, 500]) {
        const error = rejected(() => studio.clips.split('c1', frame))

        expect(error.code).toBe('CONFLICT')
        expect(error.argument).toBe('frame')
        expect(error.entity).toEqual({ kind: 'clip', id: 'c1' })
        expect(error.message).toBe(
          `clips.split: "frame" must fall inside the clip, which spans frames 0..299 ` +
            `(got ${frame})`,
        )
      }
    })

    it('throws CONFLICT when the frame is inside a transition zone', () => {
      // c1 0..300 and c3 300..400 are adjacent; a 30-frame transition centred on
      // the cut consumes c1's last 15 frames (285..299).
      useItemsStore.getState().setItems([
        ...useItemsStore.getState().items,
        makeTimelineVideoItem({
          id: 'c3',
          trackId: 'v1',
          from: 300,
          durationInFrames: 100,
          sourceStart: 0,
          sourceEnd: 100,
        }),
      ])
      useTransitionsStore.getState().setTransitions([makeTransition()])

      const error = rejected(() => studio.clips.split('c1', 290))

      expect(error.code).toBe('CONFLICT')
      expect(error.argument).toBe('frame')
      expect(error.entity).toEqual({ kind: 'clip', id: 'c1' })
      expect(error.message).toContain('the frame is inside a transition zone of the clip')
      expect(error.message).toContain('(got 290)')
      expect(studio.clips.get('c1')?.durationInFrames).toBe(300)
    })

    it('leaves the project unchanged when the store cannot split', () => {
      // A linked companion too short to split at the same frame: the action
      // returns null inside the transaction, which must roll back.
      useItemsStore.getState().setItems([
        makeTimelineVideoItem({
          id: 'c1',
          trackId: 'v1',
          from: 0,
          durationInFrames: 300,
          sourceStart: 0,
          sourceEnd: 300,
          linkedGroupId: 'pair',
        }),
        makeTimelineVideoItem({
          id: 'c2',
          trackId: 'v2',
          from: 0,
          durationInFrames: 100,
          sourceStart: 0,
          sourceEnd: 100,
          linkedGroupId: 'pair',
        }),
      ])

      const before = snapshot()
      const depth = undoDepth()

      // c1 can be split at 240, c2 cannot: `splitItem` returns null.
      const error = catchError(() => studio.clips.split('c1', 240))

      expect(error.code).toBe('CONFLICT')
      expect(error.message).toContain('clips.split: the clip cannot be split at 240')
      expect(snapshot()).toEqual(before)
      expect(undoDepth()).toBe(depth)
    })
  })

  // -------------------------------------------------------------------------
  // trimStart and trimEnd
  // -------------------------------------------------------------------------

  describe('trimStart', () => {
    it('shortens the start by frames in one undo step', () => {
      const before = snapshot()
      const depth = undoDepth()

      studio.clips.trimStart('c1', 30)

      expect(studio.clips.get('c1')).toMatchObject({
        from: 30,
        durationInFrames: 270,
        sourceStart: 30,
        sourceEnd: 300,
      })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_TRIM_START')

      undo()

      expect(snapshot()).toEqual(before)
    })

    it('extends the start back with a negative count', () => {
      studio.clips.trimStart('c1', 30)

      studio.clips.trimStart('c1', -30)

      expect(studio.clips.get('c1')).toMatchObject({ from: 0, durationInFrames: 300 })
    })

    it('adds no undo entry for a zero trim', () => {
      const depth = undoDepth()

      studio.clips.trimStart('c1', 0)

      expect(undoDepth()).toBe(depth)
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.trimStart('c9', 30))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.message).toContain('clips.trimStart: "id"')
    })

    it('throws INVALID_ARGUMENT when frames is not an integer', () => {
      for (const frames of [1.5, 0.5, Number.NaN]) {
        const error = rejected(() => studio.clips.trimStart('c1', frames))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('frames')
        expect(error.message).toContain(
          'clips.trimStart: "frames" must be an integer number of frames',
        )
      }
    })
  })

  describe('trimEnd', () => {
    it('shortens the end by frames in one undo step', () => {
      const before = snapshot()
      const depth = undoDepth()

      studio.clips.trimEnd('c1', 30)

      expect(studio.clips.get('c1')).toMatchObject({
        from: 0,
        durationInFrames: 270,
        sourceStart: 0,
        sourceEnd: 270,
      })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_TRIM_END')

      undo()

      expect(snapshot()).toEqual(before)
    })

    it('reports the trim in the SDK sign: trimEnd(c1, 30) logs trimAmount 30, as trimStart does', () => {
      // The MCP tour: the store's end handle counts the other way, and the change log read -31 for trimEnd(id, 31).
      const end = transaction('agent: trim end', () => studio.clips.trimEnd('c1', 30))
      expect(end.changes.commands).toContainEqual({
        type: 'TRIM_ITEM_END',
        payload: expect.objectContaining({ id: 'c1', trimAmount: 30 }),
      })
      const start = transaction('agent: trim start', () => studio.clips.trimStart('c1', 30))
      expect(start.changes.commands).toContainEqual({
        type: 'TRIM_ITEM_START',
        payload: expect.objectContaining({ id: 'c1', trimAmount: 30 }),
      })
      const extend = transaction('agent: extend end', () => studio.clips.trimEnd('c1', -10))
      expect(extend.changes.commands).toContainEqual({
        type: 'TRIM_ITEM_END',
        payload: expect.objectContaining({ id: 'c1', trimAmount: -10 }),
      })
    })

    it('extends the end with a negative count', () => {
      studio.clips.trimEnd('c1', -30)

      expect(studio.clips.get('c1')).toMatchObject({ durationInFrames: 330, sourceEnd: 330 })
    })

    it('adds no undo entry for a zero trim', () => {
      const depth = undoDepth()

      studio.clips.trimEnd('c1', 0)

      expect(undoDepth()).toBe(depth)
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.trimEnd('c9', 30))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.message).toContain('clips.trimEnd: "id"')
    })

    it('throws INVALID_ARGUMENT when frames is not an integer', () => {
      const error = rejected(() => studio.clips.trimEnd('c1', 2.5))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('frames')
      expect(error.message).toContain('clips.trimEnd: "frames" must be an integer number of frames')
    })
  })

  // -------------------------------------------------------------------------
  // setSpeed
  // -------------------------------------------------------------------------

  describe('setSpeed', () => {
    it('slows a clip down, keeping its source range, in one undo step', () => {
      const before = snapshot()
      const depth = undoDepth()

      studio.clips.setSpeed('c1', 0.5)

      expect(studio.clips.get('c1')).toMatchObject({
        from: 0,
        durationInFrames: 600,
        speed: 0.5,
        sourceStart: 0,
        sourceEnd: 300,
      })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_SET_SPEED')

      undo()

      expect(snapshot()).toEqual(before)
    })

    it('speeds a clip up', () => {
      studio.clips.setSpeed('c1', 2)

      expect(studio.clips.get('c1')).toMatchObject({ durationInFrames: 150, speed: 2 })
    })

    describe('ripple', () => {
      // `c1` is 300 source frames over 0..300 on its own track; add clips after it.
      function addAfter(from: number): void {
        const c1 = useItemsStore.getState().itemById['c1']!
        useItemsStore.getState().setItems([
          ...useItemsStore.getState().items,
          makeTimelineVideoItem({
            id: 'after',
            trackId: c1.trackId,
            from,
            durationInFrames: 100,
            sourceStart: 0,
            sourceEnd: 100,
            sourceDuration: 600,
            sourceFps: 30,
          }),
        ])
      }

      it('moves nothing when the clip grows into a gap that fits it', () => {
        addAfter(900)
        studio.clips.setSpeed('c1', 0.5)

        expect(studio.clips.get('c1')).toMatchObject({ durationInFrames: 600 })
        expect(useItemsStore.getState().itemById['after']?.from).toBe(900)
      })

      it('pushes the next clip only by how far the clip passes it', () => {
        addAfter(400)
        studio.clips.setSpeed('c1', 0.5)

        expect(studio.clips.get('c1')).toMatchObject({ durationInFrames: 600 })
        expect(useItemsStore.getState().itemById['after']?.from).toBe(600)
      })
    })

    it('adds no undo entry when the clip already runs at that speed', () => {
      const depth = undoDepth()

      studio.clips.setSpeed('c2', 2)
      studio.clips.setSpeed('c1', 1)

      expect(undoDepth()).toBe(depth)
    })

    it('clears a curve even when the clip already runs at that average, in one undo step', () => {
      // A 1x -> 3x ramp over 300 frames averages exactly 2x, the speed the clip reports.
      const curve = {
        keys: [
          { frame: 0, speed: 1 },
          { frame: 300, speed: 3 },
        ],
      }
      useItemsStore.getState().setItems([
        ...useItemsStore.getState().items,
        makeTimelineVideoItem({
          id: 'curved',
          trackId: 'v2',
          from: 700,
          durationInFrames: 300,
          sourceStart: 0,
          sourceEnd: 600,
          sourceDuration: 600,
          sourceFps: 30,
          speed: 2,
          speedCurve: curve,
        }),
      ])
      expect(useItemsStore.getState().itemById['curved']?.speedCurve).toEqual(curve)
      const depth = undoDepth()

      studio.clips.setSpeed('curved', 2)

      expect(studio.clips.get('curved')).toMatchObject({
        durationInFrames: 300,
        speed: 2,
        sourceStart: 0,
        sourceEnd: 600,
      })
      expect(useItemsStore.getState().itemById['curved']?.speedCurve).toBeUndefined()
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_SET_SPEED')

      undo()

      expect(useItemsStore.getState().itemById['curved']?.speedCurve).toEqual(curve)
    })

    it('throws UNSUPPORTED for a clip kind that has no playback speed', () => {
      const text = createDefaultTextItem({
        trackId: 'v1',
        from: 0,
        durationInFrames: 90,
        canvasWidth: 1920,
        canvasHeight: 1080,
        text: 'Cinque Terre',
      })
      useItemsStore.getState().setItems([...useItemsStore.getState().items, text])

      // 1 is the speed the equal-speed guard would skip; the kind is refused first.
      for (const speed of [1, 2]) {
        const error = rejected(() => studio.clips.setSpeed(text.id, speed))

        expect(error.code).toBe('UNSUPPORTED')
        expect(error.entity).toEqual({ kind: 'clip', id: text.id })
        expect(error.message).toBe('clips.setSpeed: a clip of kind "text" has no playback speed')
        expect(error.hint).toContain('setSpeed changes video, audio, composition and GIF clips')
      }
      expect(studio.clips.get(text.id)?.durationInFrames).toBe(90)
    })

    it('throws UNSUPPORTED for an image that is not a GIF', () => {
      const image = studio.clips.add({ mediaId: 'm-2', trackId: 'v2', from: 0 })

      const error = rejected(() => studio.clips.setSpeed(image, 2))

      expect(error.code).toBe('UNSUPPORTED')
      expect(error.entity).toEqual({ kind: 'clip', id: image })
      expect(error.message).toBe('clips.setSpeed: a clip of kind "image" has no playback speed')
    })

    it('rate-stretches a GIF, which the editor counts as speedable', () => {
      const gif = studio.clips.add({ mediaId: 'm-5', trackId: 'v2', from: 0 })

      studio.clips.setSpeed(gif, 2)

      expect(studio.clips.get(gif)).toMatchObject({ durationInFrames: 30, speed: 2 })
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.setSpeed('c9', 0.5))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.message).toContain('clips.setSpeed: "id"')
    })

    it('throws INVALID_ARGUMENT when speed is outside 0.1..10', () => {
      for (const speed of [0.05, 10.5, 16, Number.NaN]) {
        const error = rejected(() => studio.clips.setSpeed('c1', speed))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('speed')
        expect(error.message).toContain('clips.setSpeed: "speed" must be a number from 0.1 to 10')
      }
    })
  })

  // -------------------------------------------------------------------------
  // Speed curves (design 7.1, sections 4.8-4.9)
  // -------------------------------------------------------------------------

  /** A video track and a clip that can carry a curve, beside the seeded `c1`. */
  function addCurvedClip(id = 'curved'): void {
    useItemsStore.getState().setItems([
      ...useItemsStore.getState().items,
      makeTimelineVideoItem({
        id,
        trackId: 'v2',
        from: 700,
        durationInFrames: 300,
        sourceStart: 0,
        sourceEnd: 300,
        sourceDuration: 600,
        sourceFps: 30,
        speed: 1,
      }),
    ])
  }

  /** A composition wrapper: a clip whose time is not source frames (design 7.1, section 4.6). */
  function addCompositionClip(): string {
    const composition = {
      id: 'comp',
      type: 'composition' as const,
      trackId: 'v2',
      from: 0,
      durationInFrames: 120,
      label: 'Compound',
      compositionId: 'nested-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
    }
    useItemsStore.getState().setItems([...useItemsStore.getState().items, composition])
    return composition.id
  }

  describe('getSpeedCurve', () => {
    it('answers null for a clip that plays at one speed', () => {
      expect(studio.clips.getSpeedCurve('c1')).toBeNull()
    })

    it('reads the keys and the average the curve holds', () => {
      addCurvedClip()
      studio.clips.setSpeedCurve('curved', [
        { frame: 0, speed: 1 },
        { frame: 300, speed: 3 },
      ])
      const curve = studio.clips.getSpeedCurve('curved')!

      // 1x to 3x over the clip's length: the average is 2x and the same source span takes 150 frames.
      expect(studio.clips.get('curved')?.durationInFrames).toBe(150)
      expect(curve.averageSpeed).toBe(2)
      expect(curve.keys).toEqual([
        { frame: 0, speed: 1 },
        { frame: 150, speed: 3 },
      ])
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.getSpeedCurve('c9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.message).toContain('clips.getSpeedCurve: "id"')
    })

    it('throws UNSUPPORTED for a reversed clip and a composition wrapper', () => {
      const reversed = rejected(() => studio.clips.getSpeedCurve('c2'))
      expect(reversed.code).toBe('UNSUPPORTED')
      expect(reversed.message).toBe(
        'clips.getSpeedCurve: a reversed clip cannot have a speed curve',
      )

      const composition = addCompositionClip()
      const wrapper = rejected(() => studio.clips.getSpeedCurve(composition))
      expect(wrapper.code).toBe('UNSUPPORTED')
      expect(wrapper.message).toBe(
        'clips.getSpeedCurve: a clip of kind "composition" cannot have a speed curve',
      )
    })
  })

  describe('setSpeedCurve', () => {
    it('sets a curve in one undo step, keeping the source range', () => {
      addCurvedClip()
      const before = snapshot()
      const depth = undoDepth()

      studio.clips.setSpeedCurve('curved', [
        { frame: 0, speed: 1 },
        { frame: 300, speed: 3 },
      ])

      expect(studio.clips.get('curved')).toMatchObject({
        durationInFrames: 150,
        speed: 2,
        sourceStart: 0,
        sourceEnd: 300,
      })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_SET_SPEED_CURVE')

      undo()

      expect(snapshot()).toEqual(before)
    })

    it('removes the curve with null in one undo step, at the curve average', () => {
      addCurvedClip()
      studio.clips.setSpeedCurve('curved', [
        { frame: 0, speed: 1 },
        { frame: 300, speed: 3 },
      ])
      const depth = undoDepth()

      studio.clips.setSpeedCurve('curved', null)

      expect(studio.clips.get('curved')).toMatchObject({ durationInFrames: 150, speed: 2 })
      expect(studio.clips.getSpeedCurve('curved')).toBeNull()
      expect(undoDepth()).toBe(depth + 1)

      undo()

      expect(studio.clips.getSpeedCurve('curved')?.keys).toEqual([
        { frame: 0, speed: 1 },
        { frame: 150, speed: 3 },
      ])
    })

    it('takes an ease on a key and reads it back only where the segment is not linear', () => {
      addCurvedClip()

      studio.clips.setSpeedCurve('curved', [
        { frame: 0, speed: 1, ease: 'smooth' },
        { frame: 100, speed: 3, ease: 'linear' },
        { frame: 300, speed: 1 },
      ])

      const read = studio.clips.getSpeedCurve('curved')!
      expect(read.keys.map((key) => key.ease)).toEqual(['smooth', undefined, undefined])
      expect(useItemsStore.getState().itemById['curved']?.speedCurve?.keys[0]?.ease).toBe('smooth')
      // The speed in the middle of the eased segment is not the line's.
      const length = read.keys[1]!.frame
      const x = Math.floor(length / 2) / length
      expect(studio.clips.speedAt('curved', 700 + Math.floor(length / 2))).toBeCloseTo(
        1 + 2 * (3 * x * x - 2 * x * x * x),
        6,
      )
    })

    it('throws INVALID_ARGUMENT for an ease that is not linear, smooth, ease-in or ease-out', () => {
      addCurvedClip()

      const error = rejected(() =>
        studio.clips.setSpeedCurve('curved', [
          { frame: 0, speed: 1, ease: 'bounce' as 'smooth' },
          { frame: 300, speed: 2 },
        ]),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.message).toContain('keys[0].ease')
    })

    it('throws INVALID_ARGUMENT for a curve that is not a sorted list of two or more keys', () => {
      addCurvedClip()
      const cases: Array<[unknown, string]> = [
        [[{ frame: 0, speed: 1 }], 'keys'],
        [
          [
            { frame: 0, speed: 1 },
            { frame: 120, speed: 1 },
            { frame: 60, speed: 1 },
            { frame: 300, speed: 1 },
          ],
          'keys[2].frame',
        ],
        [
          [
            { frame: 0, speed: 1 },
            { frame: 0, speed: 2 },
            { frame: 300, speed: 1 },
          ],
          'keys[1].frame',
        ],
        [
          [
            { frame: 10, speed: 1 },
            { frame: 300, speed: 2 },
          ],
          'keys[0].frame',
        ],
        [
          [
            { frame: 0, speed: 1 },
            { frame: 240, speed: 2 },
          ],
          'keys[1].frame',
        ],
        [
          [
            { frame: 0, speed: 1 },
            { frame: 300, speed: 11 },
          ],
          'keys[1].speed',
        ],
        [
          [
            { frame: 0, speed: 0.05 },
            { frame: 300, speed: 1 },
          ],
          'keys[0].speed',
        ],
        ['not keys', 'keys'],
      ]

      for (const [keys, argument] of cases) {
        const error = rejected(() => studio.clips.setSpeedCurve('curved', keys as never))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe(argument)
        expect(error.message).toContain('clips.setSpeedCurve:')
      }
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.setSpeedCurve('c9', null))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('clips.setSpeedCurve: "id"')
    })

    it('throws UNSUPPORTED for a reversed clip and a composition wrapper', () => {
      for (const id of ['c2', addCompositionClip()]) {
        const error = rejected(() =>
          studio.clips.setSpeedCurve(id, [
            { frame: 0, speed: 1 },
            { frame: 100, speed: 2 },
          ]),
        )
        expect(error.code).toBe('UNSUPPORTED')
        expect(error.entity).toEqual({ kind: 'clip', id })
      }
    })
  })

  describe('setSpeedPreset', () => {
    it('applies an in-out ramp in one undo step, its keys scaled to the length it needs', () => {
      addCurvedClip()
      const depth = undoDepth()

      studio.clips.setSpeedPreset('curved', 'ramp-in-out')

      const curve = studio.clips.getSpeedCurve('curved')!
      const duration = studio.clips.get('curved')!.durationInFrames
      expect(curve.keys.map((key) => key.speed)).toEqual([1, 4, 4, 1])
      expect(curve.keys[0]?.frame).toBe(0)
      expect(curve.keys[1]?.frame).toBe(Math.round((15 / 300) * duration))
      expect(curve.keys[curve.keys.length - 1]?.frame).toBe(duration)
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_SET_SPEED_PRESET')
    })

    it('takes the peak and the ramp length from the options', () => {
      addCurvedClip()

      studio.clips.setSpeedPreset('curved', 'ramp-in', { peak: 2, rampFrames: 30 })

      const curve = studio.clips.getSpeedCurve('curved')!
      const duration = studio.clips.get('curved')!.durationInFrames
      expect(curve.keys.map((key) => key.speed)).toEqual([1, 2, 2])
      expect(curve.keys[1]?.frame).toBe(Math.round((30 / 300) * duration))
    })

    it('throws INVALID_ARGUMENT for an unknown preset, a bad peak or a bad ramp length', () => {
      addCurvedClip()

      const preset = rejected(() => studio.clips.setSpeedPreset('curved', 'ramp' as never))
      expect(preset.code).toBe('INVALID_ARGUMENT')
      expect(preset.argument).toBe('preset')
      expect(preset.valid).toEqual(['ramp-in', 'ramp-out', 'ramp-in-out'])

      for (const peak of [0.05, 11, Number.NaN]) {
        const error = rejected(() => studio.clips.setSpeedPreset('curved', 'ramp-in', { peak }))
        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('options.peak')
      }

      for (const rampFrames of [0, 1.5, -3]) {
        const error = rejected(() =>
          studio.clips.setSpeedPreset('curved', 'ramp-in', { rampFrames }),
        )
        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('options.rampFrames')
      }
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.setSpeedPreset('c9', 'ramp-in'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('clips.setSpeedPreset: "id"')
    })

    it('throws UNSUPPORTED for a reversed clip and a composition wrapper', () => {
      for (const id of ['c2', addCompositionClip()]) {
        const error = rejected(() => studio.clips.setSpeedPreset(id, 'ramp-in'))

        expect(error.code).toBe('UNSUPPORTED')
        expect(error.entity).toEqual({ kind: 'clip', id })
      }
    })
  })

  describe('applySmoothEdit', () => {
    it('sets the curve, the blur and the zoom and answers what it set, in one undo step', () => {
      addCurvedClip()
      const depth = undoDepth()

      const result = studio.clips.applySmoothEdit('curved', { peak: 4, slow: 0.45, zoom: 0.2 })

      const duration = studio.clips.get('curved')!.durationInFrames
      expect(result.durationInFrames).toBe(duration)
      expect(result.speedCurve.map((key) => key.speed)).toEqual([4, 0.45, 0.45, 4])
      expect(result.speedCurve[result.speedCurve.length - 1]!.frame).toBe(duration)
      expect(studio.clips.getSpeedCurve('curved')!.keys).toEqual(result.speedCurve)
      expect(studio.clips.getMotionBlur('curved')).toEqual({
        shutterDegrees: 180,
        smoothSlowMotion: 'optical-flow',
      })
      expect(result.zoom).toEqual({ firstFrame: 0, lastFrame: duration - 1, scale: 1.2 })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_APPLY_SMOOTH_EDIT')

      undo()
      expect(studio.clips.getSpeedCurve('curved')).toBeNull()
      expect(studio.clips.getMotionBlur('curved')).toBeNull()
      expect(studio.clips.get('curved')!.durationInFrames).toBe(300)
      expect(useKeyframesStore.getState().keyframesByItemId['curved']).toBeUndefined()
    })

    it('takes peak 4, slow 0.45 and zoom 0.2 when it is given none', () => {
      addCurvedClip()

      const result = studio.clips.applySmoothEdit('curved')

      expect(result.speedCurve.map((key) => key.speed)).toEqual([4, 0.45, 0.45, 4])
      expect(result.zoom?.scale).toBe(1.2)
    })

    it('throws INVALID_ARGUMENT outside the ranges, naming the option', () => {
      addCurvedClip()
      const cases: Array<['peak' | 'slow' | 'zoom', unknown[]]> = [
        ['peak', [0.5, 11, Number.NaN, '4']],
        ['slow', [0.05, 1.5, Number.NaN]],
        ['zoom', [-0.1, 1.5, Number.NaN]],
      ]
      for (const [name, values] of cases) {
        for (const value of values) {
          const error = rejected(() => studio.clips.applySmoothEdit('curved', { [name]: value }))
          expect(error.code).toBe('INVALID_ARGUMENT')
          expect(error.argument).toBe(`options.${name}`)
        }
      }
      const options = rejected(() => studio.clips.applySmoothEdit('curved', 'fast' as never))
      expect(options.argument).toBe('options')
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.applySmoothEdit('c9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('clips.applySmoothEdit: "id"')
    })

    it('throws UNSUPPORTED for a reversed clip and an audio clip', () => {
      for (const id of ['c2', addAudioClip()]) {
        const error = rejected(() => studio.clips.applySmoothEdit(id))

        expect(error.code).toBe('UNSUPPORTED')
        expect(error.entity).toEqual({ kind: 'clip', id })
      }
    })

    it('throws CONFLICT for a clip shorter than four frames', () => {
      useItemsStore.getState().setItems([
        ...useItemsStore.getState().items,
        makeTimelineVideoItem({
          id: 'tiny',
          trackId: 'v2',
          from: 700,
          durationInFrames: 3,
          sourceStart: 0,
          sourceEnd: 3,
          sourceDuration: 600,
        }),
      ])

      const error = rejected(() => studio.clips.applySmoothEdit('tiny'))

      expect(error.code).toBe('CONFLICT')
      expect(error.entity).toEqual({ kind: 'clip', id: 'tiny' })
    })

    it('throws CONFLICT, changing nothing, when a transition sits on the first frame and a zoom is asked for', () => {
      useItemsStore.getState().setItems([
        ...useItemsStore.getState().items,
        makeTimelineVideoItem({
          id: 'c3',
          trackId: 'v1',
          from: 300,
          durationInFrames: 100,
          sourceStart: 0,
          sourceEnd: 100,
          sourceDuration: 600,
          sourceFps: 30,
        }),
      ])
      useTransitionsStore.getState().setTransitions([makeTransition()])

      const error = rejected(() => studio.clips.applySmoothEdit('c3'))

      expect(error.code).toBe('CONFLICT')
      expect(error.argument).toBe('options.zoom')
      // Without a zoom the same clip takes the curve and the blur.
      expect(studio.clips.applySmoothEdit('c3', { zoom: 0 }).zoom).toBeNull()
    })
  })

  describe('smoothEditTimeline', () => {
    /** A 20 s song at 30 fps with a beat every half second from 1 s, and three clips with room to spare. */
    function seedSongAndShots(): void {
      useItemsStore.getState().setTracks([
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 0 }),
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 1 }),
      ])
      useItemsStore.getState().setItems([
        makeTimelineAudioItem({
          id: 'song',
          from: 0,
          durationInFrames: 600,
          sourceStart: 0,
          sourceEnd: 600,
          sourceDuration: 600,
        }),
        ...['s1', 's2', 's3'].map((id, index) =>
          makeTimelineVideoItem({
            id,
            trackId: 'track-v1',
            from: index * 200,
            durationInFrames: 200,
            sourceStart: 100,
            sourceEnd: 300,
            sourceDuration: 800,
            sourceFps: 30,
            speed: 1,
            sourceWidth: 1920,
            sourceHeight: 1080,
          }),
        ),
      ])
    }

    beforeEach(() => {
      useTimelineSettingsStore.getState().setFps(30)
      useMarkersStore.getState().setMarkers([])
      useTransitionsStore.getState().setTransitions([])
      analyzeBeats.mockReset()
      analyzeBeats.mockResolvedValue(Array.from({ length: 38 }, (_, index) => 1 + index * 0.5))
      seedSongAndShots()
    })

    it('marks the beats, cuts the clips to the bars with the look and the crossfades, in one undo step', async () => {
      const depth = undoDepth()

      const result = await studio.clips.smoothEditTimeline({ bars: 1, crossfade: true })

      expect(result.songId).toBe('song')
      expect(result.firstDownbeat).toBe(30)
      expect(result.shots).toEqual([
        { clipId: 's1', from: 30, durationInFrames: 60 },
        { clipId: 's2', from: 90, durationInFrames: 60 },
        { clipId: 's3', from: 150, durationInFrames: 60 },
      ])
      expect(result.crossfades).toBe(2)
      expect(undoDepth()).toBe(depth + 1)
      expect(studio.clips.getMotionBlur('s2')?.smoothSlowMotion).toBe('optical-flow')
    })

    it('takes the longest song when none is named and answers NOT_FOUND for a clip that is not there', async () => {
      const error = await rejectedAsync(() => studio.clips.smoothEditTimeline({ songId: 'nope' }))

      expect(error.code).toBe('NOT_FOUND')
      expect(analyzeBeats).not.toHaveBeenCalled()
    })

    it('answers UNSUPPORTED when the clip named is not an audio clip', async () => {
      const error = await rejectedAsync(() => studio.clips.smoothEditTimeline({ songId: 's1' }))

      expect(error.code).toBe('UNSUPPORTED')
      expect(error.argument).toBe('songId')
    })

    it('answers INVALID_ARGUMENT for options out of range, leaving the project as it was', async () => {
      const depth = undoDepth()
      for (const options of [{ bars: 3 }, { crossfade: 'yes' }, { songId: 7 }, 'fast']) {
        const error = await rejectedAsync(() => studio.clips.smoothEditTimeline(options as never))
        expect(error.code).toBe('INVALID_ARGUMENT')
      }
      expect(undoDepth()).toBe(depth)
    })

    it('answers CONFLICT, with the hint to add a song, when the timeline has no audio clip', async () => {
      useItemsStore.getState().setItems(useItemsStore.getState().items.filter((item) => item.type === 'video'))

      const error = await rejectedAsync(() => studio.clips.smoothEditTimeline())

      expect(error.code).toBe('CONFLICT')
      expect(error.hint).toBe('Add a song to the timeline first.')
    })

    it('answers CONFLICT when the song has no beats', async () => {
      analyzeBeats.mockResolvedValue([])

      const error = await rejectedAsync(() => studio.clips.smoothEditTimeline())

      expect(error.code).toBe('CONFLICT')
      expect(useItemsStore.getState().itemById['s1']!.speedCurve).toBeUndefined()
    })

    it('answers MEDIA_UNAVAILABLE when the song cannot be decoded', async () => {
      analyzeBeats.mockRejectedValue(new Error('decode failed'))

      const error = await rejectedAsync(() => studio.clips.smoothEditTimeline())

      expect(error.code).toBe('MEDIA_UNAVAILABLE')
    })
  })

  describe('speedAt', () => {
    it('reads the curve at an absolute timeline frame', () => {
      addCurvedClip()
      studio.clips.setSpeedCurve('curved', [
        { frame: 0, speed: 1 },
        { frame: 300, speed: 3 },
      ])
      // The clip now spans 700..849 at an average of 2x; frame 775 is halfway through its 1x-3x ramp.
      expect(studio.clips.speedAt('curved', 775)).toBeCloseTo(2, 10)
    })

    it('answers the constant speed of a clip without a curve', () => {
      addCurvedClip('fast')
      useItemsStore.getState()._updateItem('fast', { speed: 2 })

      expect(studio.clips.speedAt('fast', 850)).toBe(2)
    })

    it('throws INVALID_ARGUMENT for a frame outside the clip or not an integer', () => {
      for (const frame of [699, 1_000, 12.5, -1]) {
        const error = rejected(() => studio.clips.speedAt('c1', frame))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('frame')
      }
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.speedAt('c9', 0))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('clips.speedAt: "id"')
    })

    it('throws UNSUPPORTED for a reversed clip and a composition wrapper', () => {
      for (const id of ['c2', addCompositionClip()]) {
        const error = rejected(() => studio.clips.speedAt(id, 0))

        expect(error.code).toBe('UNSUPPORTED')
      }
    })
  })

  describe('getColorProfile', () => {
    it('answers null for an unanswered clip and reads what setColorProfile wrote', () => {
      expect(studio.clips.getColorProfile('c1')).toBeNull()

      studio.clips.setColorProfile('c1', 'dlog-m')

      expect(studio.clips.getColorProfile('c1')).toBe('dlog-m')
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.getColorProfile('c9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('clips.getColorProfile: "id"')
    })

    it('throws UNSUPPORTED for a clip that is not a video', () => {
      const audioId = addAudioClip()
      const error = rejected(() => studio.clips.getColorProfile(audioId))

      expect(error.code).toBe('UNSUPPORTED')
    })
  })

  describe('setColorProfile', () => {
    it('writes the profile as one undo step, and clears it with null', () => {
      const depth = undoDepth()

      studio.clips.setColorProfile('c1', 'dlog-m')

      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_SET_COLOR_PROFILE')
      expect(useItemsStore.getState().itemById['c1']).toMatchObject({ inputColor: 'dlog-m' })

      studio.clips.setColorProfile('c1', null)
      expect(studio.clips.getColorProfile('c1')).toBeNull()

      undo()
      expect(studio.clips.getColorProfile('c1')).toBe('dlog-m')
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.setColorProfile('c9', 'dlog'))

      expect(error.code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video', () => {
      const audioId = addAudioClip()
      const error = rejected(() => studio.clips.setColorProfile(audioId, 'dlog'))

      expect(error.code).toBe('UNSUPPORTED')
    })

    it('throws INVALID_ARGUMENT for a profile that does not exist', () => {
      const error = rejected(() => studio.clips.setColorProfile('c1', 'slog' as unknown as 'dlog'))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('profile')
      expect(error.message).toContain('clips.setColorProfile: "profile"')
    })
  })

  describe('getLook', () => {
    it('answers null for a clip with no look and reads what setLook wrote', async () => {
      useLooksStore.setState({ status: 'ready', looks: [LOOK] })
      expect(studio.clips.getLook('c1')).toBeNull()

      await studio.clips.setLook('c1', { id: 'look-1', intensity: 0.8 })

      expect(studio.clips.getLook('c1')).toEqual({ id: 'look-1', intensity: 0.8 })
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.getLook('c9'))

      expect(error.code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video', () => {
      const audioId = addAudioClip()
      const error = rejected(() => studio.clips.getLook(audioId))

      expect(error.code).toBe('UNSUPPORTED')
    })
  })

  describe('setLook', () => {
    beforeEach(() => {
      useLooksStore.setState({ status: 'ready', looks: [LOOK] })
      fakeLooksIndex.read.mockReset()
      fakeLooksIndex.read.mockResolvedValue([LOOK])
    })

    it('applies a library look with full blend by default, one undo step, and removes it with null', async () => {
      const depth = undoDepth()

      await studio.clips.setLook('c1', { id: 'look-1' })

      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_SET_LOOK')
      expect(studio.clips.getLook('c1')).toEqual({ id: 'look-1', intensity: 1 })

      await studio.clips.setLook('c1', null)
      expect(studio.clips.getLook('c1')).toBeNull()
    })

    it('reads the looks library itself on a fresh session, without looks.list() first', async () => {
      useLooksStore.setState({ status: 'idle', looks: [], error: null })

      await studio.clips.setLook('c1', { id: 'look-1', intensity: 0.5 })

      expect(fakeLooksIndex.read).toHaveBeenCalledTimes(1)
      expect(studio.clips.getLook('c1')).toEqual({ id: 'look-1', intensity: 0.5 })
    })

    it('throws NOT_FOUND for an unknown clip id', async () => {
      const error = await rejectedAsync(() => studio.clips.setLook('c9', { id: 'look-1' }))

      expect(error.code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video', async () => {
      const audioId = addAudioClip()
      const error = await rejectedAsync(() => studio.clips.setLook(audioId, { id: 'look-1' }))

      expect(error.code).toBe('UNSUPPORTED')
    })

    it('throws INVALID_ARGUMENT for an id outside the library and a blend outside 0..1', async () => {
      const unknown = await rejectedAsync(() => studio.clips.setLook('c1', { id: 'nope' }))
      expect(unknown.code).toBe('INVALID_ARGUMENT')
      expect(unknown.valid).toEqual(['look-1'])

      const blend = await rejectedAsync(() =>
        studio.clips.setLook('c1', { id: 'look-1', intensity: 2 }),
      )
      expect(blend.code).toBe('INVALID_ARGUMENT')
      expect(blend.argument).toBe('look.intensity')
    })

    it('throws INTERNAL when the looks library cannot be read from the workspace', async () => {
      useLooksStore.setState({ status: 'idle', looks: [], error: null })
      fakeLooksIndex.read.mockRejectedValue(new Error('no workspace'))

      const error = await rejectedAsync(() => studio.clips.setLook('c1', { id: 'look-1' }))

      expect(error.code).toBe('INTERNAL')
      expect(studio.clips.getLook('c1')).toBeNull()
    })
  })

  describe('getStabilization', () => {
    it('answers null for a clip never stabilized', () => {
      expect(studio.clips.getStabilization('c1')).toBeNull()
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.getStabilization('c9'))

      expect(error.code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video', () => {
      const audioId = addAudioClip()
      const error = rejected(() => studio.clips.getStabilization(audioId))

      expect(error.code).toBe('UNSUPPORTED')
    })
  })

  describe('setStabilization', () => {
    beforeEach(() => {
      fakeEngine.probe.mockReset()
      fakeEngine.probe.mockImplementation(async () => {
        if (fakeEngine.probeError) throw fakeEngine.probeError
        return { name: 'Avata 2' }
      })
      fakeEngine.applySettings.mockClear()
      fakeEngine.probeError = null
    })

    it('probes the clip, switches it on with the patch and reads it back, one undo step', async () => {
      const depth = undoDepth()

      await studio.clips.setStabilization('c1', { smoothness: 0.8, horizonLockPercent: 100 })

      expect(fakeEngine.probe).toHaveBeenCalledOnce()
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_SET_STABILIZATION')
      expect(studio.clips.getStabilization('c1')).toMatchObject({
        enabled: true,
        method: 'Default',
        params: { smoothness: 0.8 },
        fov: 1,
        horizonLockPercent: 100,
      })
      expect(fakeEngine.applySettings).toHaveBeenCalledOnce()
    })

    it('stores a change on a clip already on without probing again, and switches off with null keeping the settings', async () => {
      await studio.clips.setStabilization('c1', {})
      fakeEngine.probe.mockClear()

      await studio.clips.setStabilization('c1', { fov: 1.2 })
      expect(fakeEngine.probe).not.toHaveBeenCalled()
      expect(studio.clips.getStabilization('c1')?.fov).toBe(1.2)

      const depth = undoDepth()
      await studio.clips.setStabilization('c1', { fov: 1.2 })
      expect(undoDepth()).toBe(depth)

      await studio.clips.setStabilization('c1', null)
      expect(studio.clips.getStabilization('c1')).toMatchObject({ enabled: false, fov: 1.2 })
    })

    it('stores a framing on a clip that is already on, as one undo step, with no new engine key', async () => {
      await studio.clips.setStabilization('c1', {})
      expect(studio.clips.getStabilization('c1')).toMatchObject({ framingX: 0, framingY: 0 })
      const depth = undoDepth()
      await studio.clips.setStabilization('c1', { framingX: -0.5 })
      expect(studio.clips.getStabilization('c1')).toMatchObject({ framingX: -0.5, framingY: 0 })
      expect(undoDepth()).toBe(depth + 1)
      await studio.clips.setStabilization('c1', { framingX: -0.5 })
      expect(undoDepth()).toBe(depth + 1)
    })

    it('throws NOT_FOUND for an unknown clip id', async () => {
      const error = await rejectedAsync(() => studio.clips.setStabilization('c9', {}))

      expect(error.code).toBe('NOT_FOUND')
    })

    it('throws UNSUPPORTED for a clip that is not a video, has no motion data or has no lens profile', async () => {
      const audio = await rejectedAsync(() => studio.clips.setStabilization(addAudioClip(), {}))
      expect(audio.code).toBe('UNSUPPORTED')

      fakeEngine.probeError = new NoMotionDataError()
      const noMotion = await rejectedAsync(() => studio.clips.setStabilization('c1', {}))
      expect(noMotion.code).toBe('UNSUPPORTED')
      expect(noMotion.message).toContain('no motion data')

      fakeEngine.probeError = new NoLensProfileError()
      const noLens = await rejectedAsync(() => studio.clips.setStabilization('c1', {}))
      expect(noLens.code).toBe('UNSUPPORTED')
      expect(noLens.message).toContain('no lens profile')
      expect(studio.clips.getStabilization('c1')).toBeNull()
    })

    it("throws INVALID_ARGUMENT for values outside the panel's limits and unknown fields", async () => {
      for (const [patch, argument] of [
        [{ smoothness: 5 }, 'patch.smoothness'],
        [{ fov: 0 }, 'patch.fov'],
        [{ horizonLockPercent: 101 }, 'patch.horizonLockPercent'],
        [{ horizonLockRoll: -181 }, 'patch.horizonLockRoll'],
        [{ adaptiveZoomSeconds: -1 }, 'patch.adaptiveZoomSeconds'],
        [{ framingX: 1.5 }, 'patch.framingX'],
        [{ framingY: -2 }, 'patch.framingY'],
        [{ wobble: 1 }, 'patch.wobble'],
      ] as const) {
        const error = await rejectedAsync(() =>
          studio.clips.setStabilization('c1', patch as StabilizationPatch),
        )

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe(argument)
      }
      expect(fakeEngine.probe).not.toHaveBeenCalled()
    })

    it("throws INTERNAL with the engine's words when the clip cannot be opened", async () => {
      fakeEngine.probeError = new Error('wasm trapped')

      const error = await rejectedAsync(() => studio.clips.setStabilization('c1', {}))

      expect(error.code).toBe('INTERNAL')
      expect(error.message).toContain('wasm trapped')
    })
  })

  // -------------------------------------------------------------------------
  // The JSDoc examples of ClipsApi, run as written
  // -------------------------------------------------------------------------

  describe('getMotionBlur', () => {
    it('sets each smooth slow motion mode with the blur and reads it back', () => {
      studio.clips.setMotionBlur('c1', { shutterDegrees: 180, smoothSlowMotion: 'blend' })
      expect(studio.clips.getMotionBlur('c1')).toEqual({
        shutterDegrees: 180,
        smoothSlowMotion: 'blend',
      })

      studio.clips.setMotionBlur('c1', { shutterDegrees: 180, smoothSlowMotion: 'optical-flow' })
      expect(studio.clips.getMotionBlur('c1')).toEqual({
        shutterDegrees: 180,
        smoothSlowMotion: 'optical-flow',
      })

      studio.clips.setMotionBlur('c1', { shutterDegrees: 180 })
      expect(studio.clips.getMotionBlur('c1')).toEqual({ shutterDegrees: 180 })
    })

    it('still takes the deprecated blendSlowMotion: true is the blend, false is off, and reads back the new field', () => {
      studio.clips.setMotionBlur('c1', { shutterDegrees: 180, blendSlowMotion: true })
      expect(studio.clips.getMotionBlur('c1')).toEqual({
        shutterDegrees: 180,
        smoothSlowMotion: 'blend',
      })

      studio.clips.setMotionBlur('c1', { shutterDegrees: 270, blendSlowMotion: false })
      expect(studio.clips.getMotionBlur('c1')).toEqual({ shutterDegrees: 270 })
    })

    it('refuses settings that give both smoothSlowMotion and blendSlowMotion, and changes nothing', () => {
      studio.clips.setMotionBlur('c1', { shutterDegrees: 90 })
      for (const blendSlowMotion of [true, false]) {
        const error = (() => {
          try {
            studio.clips.setMotionBlur('c1', {
              shutterDegrees: 180,
              smoothSlowMotion: 'blend',
              blendSlowMotion,
            })
          } catch (caught) {
            return caught
          }
        })()
        expect(error).toMatchObject({ code: 'INVALID_ARGUMENT' })
        expect((error as Error).message).toContain('clips.setMotionBlur: ')
        expect((error as Error).message).toContain('not both')
      }
      // Read from the store: this test is about setMotionBlur's refusals alone
      expect(
        (useItemsStore.getState().itemById['c1'] as { motionBlur?: unknown }).motionBlur,
      ).toEqual({
        shutterDegrees: 90,
      })
    })

    it('refuses a deprecated blendSlowMotion that is not a boolean', () => {
      const error = (() => {
        try {
          studio.clips.setMotionBlur('c1', {
            shutterDegrees: 180,
            blendSlowMotion: 'yes' as unknown as boolean,
          })
        } catch (caught) {
          return caught
        }
      })()
      expect(error).toMatchObject({ code: 'INVALID_ARGUMENT' })
      expect((error as Error).message).toContain('clips.setMotionBlur: ')
    })

    it('refuses a smooth slow motion mode that is not one of the two', () => {
      for (const smoothSlowMotion of ['rife', true, 1]) {
        const error = (() => {
          try {
            studio.clips.setMotionBlur('c1', {
              shutterDegrees: 180,
              smoothSlowMotion: smoothSlowMotion as unknown as 'blend',
            })
          } catch (caught) {
            return caught
          }
        })()
        expect(error).toMatchObject({ code: 'INVALID_ARGUMENT' })
        expect((error as Error).message).toContain('clips.setMotionBlur: ')
      }
    })

    it('answers null for a clip with no blur, and reads what setMotionBlur wrote', () => {
      expect(studio.clips.getMotionBlur('c1')).toBeNull()

      studio.clips.setMotionBlur('c1', { shutterDegrees: 270 })

      expect(studio.clips.getMotionBlur('c1')).toEqual({ shutterDegrees: 270 })
    })

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.getMotionBlur('c9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.message).toContain('clips.getMotionBlur: "id"')
    })

    it('throws UNSUPPORTED for a reversed clip and a composition wrapper', () => {
      const reversed = rejected(() => studio.clips.getMotionBlur('c2'))
      expect(reversed.code).toBe('UNSUPPORTED')
      expect(reversed.message).toBe('clips.getMotionBlur: a reversed clip cannot have motion blur')

      const composition = addCompositionClip()
      const wrapper = rejected(() => studio.clips.getMotionBlur(composition))
      expect(wrapper.code).toBe('UNSUPPORTED')
      expect(wrapper.message).toBe(
        'clips.getMotionBlur: a composition wrapper cannot have motion blur',
      )
    })
  })

  describe('setMotionBlur', () => {
    it('round-trips the settings and switches off with null, one undo step each', () => {
      const before = snapshot()
      const depth = undoDepth()

      studio.clips.setMotionBlur('c1', { shutterDegrees: 180 })

      expect(studio.clips.getMotionBlur('c1')).toEqual({ shutterDegrees: 180 })
      expect(undoDepth()).toBe(depth + 1)
      expect(lastCommandType()).toBe('CLIPS_SET_MOTION_BLUR')

      studio.clips.setMotionBlur('c1', { shutterDegrees: 90 })
      expect(studio.clips.getMotionBlur('c1')).toEqual({ shutterDegrees: 90 })
      expect(undoDepth()).toBe(depth + 2)

      studio.clips.setMotionBlur('c1', null)
      expect(studio.clips.getMotionBlur('c1')).toBeNull()
      expect(undoDepth()).toBe(depth + 3)

      undo()
      undo()
      undo()
      expect(snapshot()).toEqual(before)
    })

    it.each([
      [{ shutterDegrees: 400 }],
      [{ shutterDegrees: -1 }],
      [{ shutterDegrees: '180' }],
      [{}],
      [undefined],
      [180],
      [[]],
    ])('refuses %j with INVALID_ARGUMENT and leaves the clip as it was', (settings) => {
      const depth = undoDepth()
      const error = rejected(() =>
        studio.clips.setMotionBlur('c1', settings as unknown as { shutterDegrees: 180 }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('settings')
      expect(error.message).toContain('clips.setMotionBlur: "settings"')
      expect(error.message).toContain('from 0 to 360')
      expect(studio.clips.getMotionBlur('c1')).toBeNull()
      expect(undoDepth()).toBe(depth)
    })

    it("keeps optical flow's motion detail and hard edges, leaves the defaults out, one undo step (design 11.24)", () => {
      const depth = undoDepth()
      studio.clips.setMotionBlur('c1', {
        shutterDegrees: 0,
        smoothSlowMotion: 'optical-flow',
        flowDetail: 'high',
        flowEdges: 'nearest',
      })
      expect(studio.clips.getMotionBlur('c1')).toEqual({
        shutterDegrees: 0,
        smoothSlowMotion: 'optical-flow',
        flowDetail: 'high',
        flowEdges: 'nearest',
      })
      expect(undoDepth()).toBe(depth + 1)

      studio.clips.setMotionBlur('c1', {
        shutterDegrees: 180,
        smoothSlowMotion: 'optical-flow',
        flowDetail: 'normal',
        flowEdges: 'mix',
      })
      expect(studio.clips.getMotionBlur('c1')).toEqual({
        shutterDegrees: 180,
        smoothSlowMotion: 'optical-flow',
      })
    })

    it.each([
      [
        { shutterDegrees: 180, smoothSlowMotion: 'optical-flow', flowDetail: 'ultra' },
        '"flowDetail" "normal" or "high"',
      ],
      [
        { shutterDegrees: 180, smoothSlowMotion: 'optical-flow', flowEdges: true },
        '"flowEdges" "mix" or "nearest"',
      ],
      [
        { shutterDegrees: 180, smoothSlowMotion: 'blend', flowDetail: 'high' },
        'only with smoothSlowMotion: "optical-flow"',
      ],
      [{ shutterDegrees: 180, flowEdges: 'nearest' }, 'only with smoothSlowMotion: "optical-flow"'],
    ])(
      'refuses the optical-flow settings %j with INVALID_ARGUMENT, naming the rule',
      (settings, rule) => {
        const depth = undoDepth()
        const error = rejected(() =>
          studio.clips.setMotionBlur('c1', settings as unknown as { shutterDegrees: 180 }),
        )
        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('settings')
        expect(error.message).toContain(rule)
        expect(studio.clips.getMotionBlur('c1')).toBeNull()
        expect(undoDepth()).toBe(depth)
      },
    )

    it('throws NOT_FOUND for an unknown clip id', () => {
      const error = rejected(() => studio.clips.setMotionBlur('c9', null))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.message).toContain('clips.setMotionBlur: "id"')
    })

    it('throws UNSUPPORTED for a reversed clip and a composition wrapper', () => {
      const reversed = rejected(() => studio.clips.setMotionBlur('c2', { shutterDegrees: 360 }))
      expect(reversed.code).toBe('UNSUPPORTED')
      expect(reversed.message).toBe('clips.setMotionBlur: a reversed clip cannot have motion blur')

      const composition = addCompositionClip()
      const wrapper = rejected(() =>
        studio.clips.setMotionBlur(composition, { shutterDegrees: 360 }),
      )
      expect(wrapper.code).toBe('UNSUPPORTED')
      expect(wrapper.message).toBe(
        'clips.setMotionBlur: a composition wrapper cannot have motion blur',
      )
    })
  })

  describe('the ClipsApi examples', () => {
    it("studio.clips.list({ trackId: 'v1' })", () => {
      const clips = studio.clips.list({ trackId: 'v1' })

      expect(clips.map((clip) => clip.id)).toEqual(['c1'])
    })

    it("studio.clips.get('c1')", () => {
      const clip = studio.clips.get('c1')

      expect(clip?.id).toBe('c1')
    })

    it("const id = studio.clips.add({ mediaId: 'm-1', trackId: 'v2', from: 0 })", () => {
      const id = studio.clips.add({ mediaId: 'm-1', trackId: 'v2', from: 0 })

      expect(studio.clips.get(id)?.mediaId).toBe('m-1')
    })

    it("studio.clips.addMany([{ mediaId: 'm-1', trackId: 'v2', from: 0 }])", () => {
      const ids = studio.clips.addMany([{ mediaId: 'm-1', trackId: 'v2', from: 0 }])

      expect(ids).toHaveLength(1)
      expect(studio.clips.get(ids[0]!)?.mediaId).toBe('m-1')
    })

    it("studio.clips.update('c1', { volume: -6 })", () => {
      studio.clips.update('c1', { volume: -6 })

      expect(studio.clips.get('c1')?.volume).toBe(-6)
    })

    it("studio.clips.move('c1', 120, 'v2')", () => {
      studio.clips.move('c1', 120, 'v2')

      expect(studio.clips.get('c1')).toMatchObject({ from: 120, trackId: 'v2' })
    })

    it("studio.clips.remove(['c1'], { ripple: true })", () => {
      studio.clips.remove(['c1'], { ripple: true })

      expect(studio.clips.get('c1')).toBeNull()
    })

    it("studio.clips.duplicate(['c1'], { count: 2 })", () => {
      const copies = studio.clips.duplicate(['c1'], { count: 2 })

      expect(copies).toHaveLength(2)
    })

    it("const [left, right] = studio.clips.split('c1', 240)", () => {
      const [left, right] = studio.clips.split('c1', 240)

      expect(studio.clips.get(left)?.durationInFrames).toBe(240)
      expect(studio.clips.get(right)?.durationInFrames).toBe(60)
    })

    it("studio.clips.trimStart('c1', 30)", () => {
      studio.clips.trimStart('c1', 30)

      expect(studio.clips.get('c1')?.from).toBe(30)
    })

    it("studio.clips.trimEnd('c1', 30)", () => {
      studio.clips.trimEnd('c1', 30)

      expect(studio.clips.get('c1')?.durationInFrames).toBe(270)
    })

    it("studio.clips.setSpeed('c1', 0.5)", () => {
      studio.clips.setSpeed('c1', 0.5)

      expect(studio.clips.get('c1')?.speed).toBe(0.5)
    })

    it("studio.clips.getSpeedCurve('c1')?.keys", () => {
      const keys = studio.clips.getSpeedCurve('c1')?.keys

      expect(keys).toBeUndefined()
    })

    it("studio.clips.setSpeedCurve('c1', [{ frame: 0, speed: 1 }, { frame: 120, speed: 4 }, { frame: 300, speed: 1 }])", () => {
      studio.clips.setSpeedCurve('c1', [
        { frame: 0, speed: 1 },
        { frame: 120, speed: 4 },
        { frame: 300, speed: 1 },
      ])

      expect(studio.clips.getSpeedCurve('c1')?.keys).toHaveLength(3)
    })

    it("studio.clips.getMotionBlur('c1')?.shutterDegrees", () => {
      expect(studio.clips.getMotionBlur('c1')?.shutterDegrees).toBeUndefined()
    })

    it("studio.clips.setMotionBlur('c1', { shutterDegrees: 360 })", () => {
      studio.clips.setMotionBlur('c1', { shutterDegrees: 360 })

      expect(studio.clips.getMotionBlur('c1')?.shutterDegrees).toBe(360)
    })

    it("studio.clips.setSpeedPreset('c1', 'ramp-in-out', { peak: 4, rampFrames: 15 })", () => {
      studio.clips.setSpeedPreset('c1', 'ramp-in-out', { peak: 4, rampFrames: 15 })

      expect(studio.clips.getSpeedCurve('c1')?.keys.length).toBeGreaterThanOrEqual(2)
    })

    it("studio.clips.speedAt('c1', 90)", () => {
      expect(studio.clips.speedAt('c1', 90)).toBe(1)
    })
  })
})
