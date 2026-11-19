// @vitest-environment node

/**
 * `studio.subclips` (design 1.6, D7): list, get, create, rename and remove over
 * the subclip store, and the hand-off to `clips.add` with the range.
 *
 * Subclips are library state like media, so no call here is an undo step; the
 * clip placed from one is, and undoing it leaves the subclip in the library.
 */

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import {
  makeTimelineTrack,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { seedMediaLibrary } from '@/headless/seed-media'
import { useSubclipsStore } from '@/studio/subclips'
import { StudioError } from '../errors'
import type { ClipsApi, SubclipsApi } from '../types'
import { createClipsApi } from './clips'
import { createSubclipsApi } from './subclips'

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

/** 10 s at 30 fps: 300 source frames. */
const VIDEO_MEDIA = makeMedia({ id: 'm-1' })
/** 4 s at 60 fps on a 30 fps project: 240 source frames. */
const FAST_MEDIA = makeMedia({ id: 'm-2', fileName: 'fast.mov', duration: 4, fps: 60 })
const IMAGE_MEDIA = makeMedia({
  id: 'm-3',
  fileName: 'map.png',
  mimeType: 'image/png',
  duration: 0,
  width: 800,
  height: 600,
})
const AUDIO_MEDIA = makeMedia({
  id: 'm-4',
  fileName: 'music.mp3',
  mimeType: 'audio/mpeg',
  duration: 4,
  width: 0,
  height: 0,
})

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
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

/** A rejected call changes no subclip and adds no undo entry. */
function rejected(run: () => unknown): StudioError {
  const before = structuredClone(useSubclipsStore.getState().subclips)
  const depth = undoDepth()
  const error = catchError(run)
  expect(useSubclipsStore.getState().subclips).toEqual(before)
  expect(undoDepth()).toBe(depth)
  return error
}

let studio: { subclips: SubclipsApi; clips: ClipsApi }

describe('studio.subclips', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.getState().setFps(30)
    useSubclipsStore.getState().reset()
    useMediaLibraryStore.setState({ mediaItems: [], mediaById: {} })
    seedMediaLibrary([
      { metadata: VIDEO_MEDIA },
      { metadata: FAST_MEDIA },
      { metadata: IMAGE_MEDIA },
      { metadata: AUDIO_MEDIA },
    ])
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore.getState().setItems([])
    studio = { subclips: createSubclipsApi(), clips: createClipsApi() }
  })

  describe('create', () => {
    it('makes a subclip, names it, marks the project changed and adds no undo step', () => {
      const depth = undoDepth()

      const created = studio.subclips.create({
        mediaId: 'm-1',
        startFrame: 90,
        endFrame: 210,
        name: '  Gap  ',
      })

      expect(created).toMatchObject({
        mediaId: 'm-1',
        name: 'Gap',
        startFrame: 90,
        endFrame: 210,
        sourceFps: 30,
        valid: true,
      })
      expect(created).not.toHaveProperty('invalidReason')
      expect(studio.subclips.get(created.id)).toEqual(created)
      expect(studio.subclips.list()).toEqual([created])
      expect(undoDepth()).toBe(depth)
      expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
    })

    it('names a subclip after the file and its number when no name is given', () => {
      const first = studio.subclips.create({ mediaId: 'm-1', startFrame: 0, endFrame: 30 })
      const second = studio.subclips.create({ mediaId: 'm-1', startFrame: 30, endFrame: 60 })

      expect([first.name, second.name]).toEqual(['drone 1', 'drone 2'])
    })

    it('accepts an audio file and the whole file as the range', () => {
      const created = studio.subclips.create({ mediaId: 'm-4', startFrame: 0, endFrame: 120 })

      expect(created).toMatchObject({ mediaId: 'm-4', startFrame: 0, endFrame: 120 })
    })

    it('counts the frames of the file at its own rate', () => {
      expect(
        studio.subclips.create({ mediaId: 'm-2', startFrame: 0, endFrame: 240 }).sourceFps,
      ).toBe(60)
      const error = rejected(() =>
        studio.subclips.create({ mediaId: 'm-2', startFrame: 0, endFrame: 241 }),
      )
      expect(error.code).toBe('INVALID_ARGUMENT')
    })

    it('rejects a bad range with INVALID_ARGUMENT and names the argument', () => {
      const cases: Array<[number, number]> = [
        [-1, 10],
        [10, 10],
        [20, 10],
        [1.5, 10],
        [0, 301],
      ]
      for (const [startFrame, endFrame] of cases) {
        const error = rejected(() =>
          studio.subclips.create({ mediaId: 'm-1', startFrame, endFrame }),
        )
        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.message).toContain('subclips.create: ')
        expect(error.argument).toMatch(/^(startFrame|endFrame)$/)
      }
    })

    it('rejects a range that is not numbers', () => {
      const error = rejected(() =>
        studio.subclips.create({
          mediaId: 'm-1',
          startFrame: '0' as unknown as number,
          endFrame: 10,
        }),
      )
      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.message).toBe(
        'subclips.create: "startFrame" must be an integer source frame (got "0")',
      )
    })

    it('rejects an empty name with INVALID_ARGUMENT', () => {
      for (const name of ['', '   ', 5 as unknown as string]) {
        const error = rejected(() =>
          studio.subclips.create({ mediaId: 'm-1', startFrame: 0, endFrame: 30, name }),
        )
        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('name')
        expect(error.message).toContain('subclips.create: "name" must be a non-empty string')
      }
    })

    it('rejects a media id that is not in the library with NOT_FOUND', () => {
      const error = rejected(() =>
        studio.subclips.create({ mediaId: 'gone', startFrame: 0, endFrame: 30 }),
      )

      expect(error.code).toBe('NOT_FOUND')
      expect(error.entity).toEqual({ kind: 'media', id: 'gone' })
      expect(error.message).toContain('subclips.create: "mediaId"')
    })

    it('rejects an image with UNSUPPORTED', () => {
      const error = rejected(() =>
        studio.subclips.create({ mediaId: 'm-3', startFrame: 0, endFrame: 1 }),
      )

      expect(error.code).toBe('UNSUPPORTED')
      expect(error.message).toContain('subclips.create: ')
    })
  })

  describe('list and get', () => {
    it('filters by media, keeps the order made and returns copies', () => {
      const a = studio.subclips.create({ mediaId: 'm-1', startFrame: 0, endFrame: 30 })
      const b = studio.subclips.create({ mediaId: 'm-2', startFrame: 0, endFrame: 30 })
      const c = studio.subclips.create({ mediaId: 'm-1', startFrame: 30, endFrame: 60 })

      expect(studio.subclips.list().map((s) => s.id)).toEqual([a.id, b.id, c.id])
      expect(studio.subclips.list({ mediaId: 'm-1' }).map((s) => s.id)).toEqual([a.id, c.id])
      expect(studio.subclips.list({ mediaId: 'nothing' })).toEqual([])
      expect(studio.subclips.get('nothing')).toBeNull()

      studio.subclips.get(a.id)!.name = 'mutated'
      expect(studio.subclips.get(a.id)!.name).toBe('drone 1')
    })

    it('reports a subclip whose file is gone or shorter as invalid, never clamped', () => {
      const created = studio.subclips.create({ mediaId: 'm-1', startFrame: 0, endFrame: 300 })

      useMediaLibraryStore.setState((state) => {
        const shorter = { ...VIDEO_MEDIA, duration: 5 }
        return {
          mediaItems: state.mediaItems.map((m) => (m.id === 'm-1' ? shorter : m)),
          mediaById: { ...state.mediaById, 'm-1': shorter },
        }
      })
      expect(studio.subclips.get(created.id)).toMatchObject({
        endFrame: 300,
        valid: false,
        invalidReason: 'range-past-end',
      })

      useMediaLibraryStore.setState({ mediaItems: [], mediaById: {} })
      expect(studio.subclips.get(created.id)).toMatchObject({
        valid: false,
        invalidReason: 'parent-missing',
      })
    })
  })

  describe('rename', () => {
    it('renames one subclip and adds no undo step', () => {
      const created = studio.subclips.create({ mediaId: 'm-1', startFrame: 0, endFrame: 30 })
      const depth = undoDepth()

      studio.subclips.rename(created.id, '  Landing ')

      expect(studio.subclips.get(created.id)?.name).toBe('Landing')
      expect(undoDepth()).toBe(depth)
    })

    it('rejects an unknown id with NOT_FOUND and lists the ids that exist', () => {
      const created = studio.subclips.create({ mediaId: 'm-1', startFrame: 0, endFrame: 30 })

      const error = rejected(() => studio.subclips.rename('nope', 'x'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.entity).toEqual({ kind: 'subclip', id: 'nope' })
      expect(error.valid).toEqual([created.id])
      expect(error.message).toContain('subclips.rename: "id"')
    })

    it('rejects an empty name with INVALID_ARGUMENT', () => {
      const created = studio.subclips.create({ mediaId: 'm-1', startFrame: 0, endFrame: 30 })

      const error = rejected(() => studio.subclips.rename(created.id, '  '))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.message).toBe('subclips.rename: "name" must be a non-empty string (got "  ")')
      expect(studio.subclips.get(created.id)?.name).toBe('drone 1')
    })
  })

  describe('remove', () => {
    it('removes the named subclips, leaves the others and adds no undo step', () => {
      const a = studio.subclips.create({ mediaId: 'm-1', startFrame: 0, endFrame: 30 })
      const b = studio.subclips.create({ mediaId: 'm-1', startFrame: 30, endFrame: 60 })
      const depth = undoDepth()

      studio.subclips.remove([a.id, a.id])

      expect(studio.subclips.list().map((s) => s.id)).toEqual([b.id])
      expect(undoDepth()).toBe(depth)
      studio.subclips.remove([])
      expect(studio.subclips.list()).toHaveLength(1)
    })

    it('deletes nothing when one id is unknown, with NOT_FOUND', () => {
      const a = studio.subclips.create({ mediaId: 'm-1', startFrame: 0, endFrame: 30 })

      const error = rejected(() => studio.subclips.remove([a.id, 'nope']))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.entity).toEqual({ kind: 'subclip', id: 'nope' })
      expect(error.message).toContain('subclips.remove: "ids"')
      expect(studio.subclips.list()).toHaveLength(1)
    })

    it('rejects ids that are not an array with INVALID_ARGUMENT', () => {
      const error = rejected(() => studio.subclips.remove('s-1' as unknown as string[]))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.message).toBe(
        'subclips.remove: "ids" must be an array of subclip ids (got "s-1")',
      )
    })
  })

  describe('placing a subclip with clips.add', () => {
    it('plays exactly the range and reads it back from clips.get, as one undo step', () => {
      const subclip = studio.subclips.create({ mediaId: 'm-1', startFrame: 90, endFrame: 210 })
      const depth = undoDepth()

      const id = studio.clips.add({
        mediaId: subclip.mediaId,
        trackId: 'v1',
        from: 0,
        label: subclip.name,
        sourceStart: subclip.startFrame,
        sourceEnd: subclip.endFrame,
      })

      expect(studio.clips.get(id)).toMatchObject({
        mediaId: 'm-1',
        from: 0,
        durationInFrames: 120,
        label: 'drone 1',
        sourceStart: 90,
        sourceEnd: 210,
        sourceDuration: 300,
        sourceFps: 30,
      })
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.clips.get(id)).toBeNull()
      // The subclip is library state: undoing the clip leaves it.
      expect(studio.subclips.get(subclip.id)).not.toBeNull()
    })

    it('sizes the clip on the project rate when the file has another one', () => {
      // 60 fps source frames 60..180 are two seconds: 60 frames at 30 fps.
      const id = studio.clips.add({
        mediaId: 'm-2',
        trackId: 'v1',
        from: 0,
        sourceStart: 60,
        sourceEnd: 180,
      })

      expect(studio.clips.get(id)).toMatchObject({
        durationInFrames: 60,
        sourceStart: 60,
        sourceEnd: 180,
        sourceFps: 60,
      })
    })

    it('places an audio range on an audio track', () => {
      const id = studio.clips.add({
        mediaId: 'm-4',
        trackId: 'a1',
        from: 0,
        sourceStart: 30,
        sourceEnd: 90,
      })

      expect(studio.clips.get(id)).toMatchObject({
        type: 'audio',
        durationInFrames: 60,
        sourceStart: 30,
        sourceEnd: 90,
      })
    })

    it('accepts a durationInFrames equal to the length of the range', () => {
      const id = studio.clips.add({
        mediaId: 'm-1',
        trackId: 'v1',
        from: 0,
        durationInFrames: 120,
        sourceStart: 90,
        sourceEnd: 210,
      })

      expect(studio.clips.get(id)?.durationInFrames).toBe(120)
    })

    it('places the same ranges in one undo step with addMany', () => {
      const depth = undoDepth()
      const ids = studio.clips.addMany([
        { mediaId: 'm-1', trackId: 'v1', from: 0, sourceStart: 0, sourceEnd: 30 },
        { mediaId: 'm-1', trackId: 'v1', from: 30, sourceStart: 30, sourceEnd: 90 },
      ])

      expect(ids.map((id) => studio.clips.get(id)?.sourceEnd)).toEqual([30, 90])
      expect(undoDepth()).toBe(depth + 1)
    })
  })
})
