// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { ProjectMarker } from '@/types/timeline'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { buildTimelineFromStores } from '@/features/timeline/stores/timeline-persistence'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { StudioError } from '../errors'
import { createMarkersApi } from './markers'

/** The namespace as the examples write it; the entry installs it on `studio`. */
const studio = { markers: createMarkersApi() }

/** `addMarker`'s default colour (`markers-store.ts:46`). */
const DEFAULT_COLOR = '#3B82F6'

/**
 * A video track and one 400-frame clip, past the 10 s floor, so the range is
 * bounded by the content: `getActiveInOutMaxFrame()` returns 400 at 30 fps.
 */
function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'clip-1',
      trackId: 'track-v1',
      durationInFrames: 400,
      sourceEnd: 400,
      sourceDuration: 600,
    }),
  ])
}

/** Seed a marker directly, the way a loaded project has them: no undo entry. */
function seedMarker(overrides: Partial<ProjectMarker> & { id: string }): void {
  useMarkersStore
    .getState()
    .setMarkers([
      ...useMarkersStore.getState().markers,
      { frame: 0, color: DEFAULT_COLOR, ...overrides },
    ])
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

function catchError(fn: () => unknown): StudioError {
  try {
    fn()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

describe('studio.markers', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    seedTimeline()
  })

  describe('list', () => {
    it('is empty on a timeline without markers', () => {
      expect(studio.markers.list()).toEqual([])
    })

    it('returns the markers in frame order, not in insertion order', () => {
      seedMarker({ id: 'late', frame: 240 })
      seedMarker({ id: 'early', frame: 60 })

      expect(studio.markers.list().map((marker) => marker.id)).toEqual(['early', 'late'])
    })

    it('breaks ties on frame by id, as the marker surfaces do', () => {
      seedMarker({ id: 'b', frame: 60 })
      seedMarker({ id: 'a', frame: 60 })

      expect(studio.markers.list().map((marker) => marker.id)).toEqual(['a', 'b'])
    })

    it('returns plain copies built field by field', () => {
      seedMarker({ id: 'k1', frame: 60, label: 'take off', color: '#ff0000' })

      const listed = studio.markers.list()

      expect(listed).toStrictEqual([{ id: 'k1', frame: 60, label: 'take off', color: '#ff0000' }])
      expect(listed[0]).not.toBe(useMarkersStore.getState().markers[0])
      expect(studio.markers.list()).not.toBe(listed)

      listed[0]!.frame = 999
      listed[0]!.label = 'changed'
      expect(studio.markers.list()).toStrictEqual([
        { id: 'k1', frame: 60, label: 'take off', color: '#ff0000' },
      ])
    })

    it('leaves the label out when the marker has none', () => {
      seedMarker({ id: 'k1', frame: 60 })

      expect(studio.markers.list()).toStrictEqual([{ id: 'k1', frame: 60, color: DEFAULT_COLOR }])
    })
  })

  describe('add', () => {
    it('adds a marker, returns its id and is one undo step', () => {
      const depth = undoDepth()

      const id = studio.markers.add({ frame: 120, label: 'take off' })

      expect(studio.markers.list()).toStrictEqual([
        { id, frame: 120, label: 'take off', color: DEFAULT_COLOR },
      ])
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.markers.list()).toEqual([])
      expect(undoDepth()).toBe(depth)
    })

    it('keeps the colour it is given and leaves the label empty', () => {
      const id = studio.markers.add({ frame: 0, color: '#ff0000' })

      expect(studio.markers.list()).toStrictEqual([{ id, frame: 0, label: '', color: '#ff0000' }])
    })

    it('accepts every colour form the editor stores', () => {
      for (const color of ['#ff0000', '#f00', 'oklch(0.65 0.20 250)', 'oklch(0.70 0.20 140)']) {
        const id = studio.markers.add({ frame: 0, color })

        expect(studio.markers.list().find((marker) => marker.id === id)?.color).toBe(color)
      }
    })

    it('writes back a colour read from list(), including a panel preset', () => {
      // The marker panel's green preset (`marker-panel/index.tsx:25`).
      const preset = 'oklch(0.70 0.20 140)'
      seedMarker({ id: 'k1', frame: 30, color: preset })
      seedMarker({ id: 'k2', frame: 60 })

      const [listed] = studio.markers.list()

      studio.markers.update('k2', { color: listed!.color })

      expect(studio.markers.list().map((marker) => marker.color)).toEqual([preset, preset])
    })

    it('rejects a frame that is not an integer frame >= 0', () => {
      for (const frame of [-1, 1.5, Number.NaN]) {
        const error = catchError(() => studio.markers.add({ frame }))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('frame')
      }

      expect(catchError(() => studio.markers.add({ frame: -1 })).message).toBe(
        'markers.add: "frame" must be an integer frame >= 0 (got -1)',
      )
    })

    it('rejects a colour in a form the editor does not store', () => {
      for (const color of ['red', 'rgb(255 0 0)', 'oklch(0.65 0.2 250)', '#ff000080']) {
        const error = catchError(() => studio.markers.add({ frame: 0, color }))

        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('color')
      }

      expect(catchError(() => studio.markers.add({ frame: 0, color: 'red' })).message).toBe(
        'markers.add: "color" must be a colour like "#3B82F6" or "oklch(0.65 0.20 250)" ' +
          '(got "red")',
      )
    })

    it('rejects a label that is not a string', () => {
      const error = catchError(() =>
        studio.markers.add({ frame: 0, label: 7 as unknown as string }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('label')
      expect(error.message).toBe('markers.add: "label" must be a string (got 7)')
    })
  })

  describe('update', () => {
    it('changes the fields of the patch and is one undo step', () => {
      seedMarker({ id: 'k1', frame: 30, label: 'old', color: '#3B82F6' })
      const depth = undoDepth()

      studio.markers.update('k1', { frame: 45, label: 'new', color: '#ff0000' })

      expect(studio.markers.list()).toStrictEqual([
        { id: 'k1', frame: 45, label: 'new', color: '#ff0000' },
      ])
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.markers.list()).toStrictEqual([
        { id: 'k1', frame: 30, label: 'old', color: '#3B82F6' },
      ])
      expect(undoDepth()).toBe(depth)
    })

    it('leaves the fields the patch does not name', () => {
      seedMarker({ id: 'k1', frame: 30, label: 'old', color: '#ff0000' })

      studio.markers.update('k1', { label: 'renamed' })

      expect(studio.markers.list()).toStrictEqual([
        { id: 'k1', frame: 30, label: 'renamed', color: '#ff0000' },
      ])
    })

    it('is NOT_FOUND for a marker that does not exist', () => {
      seedMarker({ id: 'k1', frame: 30 })

      const error = catchError(() => studio.markers.update('k9', { frame: 10 }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.entity).toStrictEqual({ kind: 'marker', id: 'k9' })
      expect(error.valid).toEqual(['k1'])
      expect(error.message).toBe(
        'markers.update: "id" must be an existing marker id on the main timeline ' +
          '(got "k9"); valid: "k1"',
      )
      expect(error.hint).toContain('studio.project.context()')
    })

    it('rejects a frame that is not an integer frame >= 0', () => {
      seedMarker({ id: 'k1', frame: 30 })

      const error = catchError(() => studio.markers.update('k1', { frame: -1 }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('frame')
      expect(error.message).toBe('markers.update: "frame" must be an integer frame >= 0 (got -1)')
    })

    it('rejects a colour in a form the editor does not store, before looking the marker up', () => {
      const error = catchError(() => studio.markers.update('k9', { color: 'red' }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('color')
    })
  })

  describe('remove', () => {
    it('removes one marker and is one undo step', () => {
      seedMarker({ id: 'k1', frame: 30 })
      seedMarker({ id: 'k2', frame: 60 })
      const depth = undoDepth()

      studio.markers.remove('k1')

      expect(studio.markers.list().map((marker) => marker.id)).toEqual(['k2'])
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.markers.list().map((marker) => marker.id)).toEqual(['k1', 'k2'])
      expect(undoDepth()).toBe(depth)
    })

    it('is NOT_FOUND for a marker that does not exist', () => {
      const error = catchError(() => studio.markers.remove('k9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('id')
      expect(error.entity).toStrictEqual({ kind: 'marker', id: 'k9' })
      expect(error.message).toBe(
        'markers.remove: "id" must be an existing marker id on the main timeline ' + '(got "k9")',
      )
    })
  })

  describe('clear', () => {
    it('removes every marker and is one undo step', () => {
      seedMarker({ id: 'k1', frame: 30 })
      seedMarker({ id: 'k2', frame: 60 })
      const depth = undoDepth()

      studio.markers.clear()

      expect(studio.markers.list()).toEqual([])
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.markers.list().map((marker) => marker.id)).toEqual(['k1', 'k2'])
      expect(undoDepth()).toBe(depth)
    })
  })

  describe('range', () => {
    it('is empty on a fresh timeline', () => {
      expect(studio.markers.range()).toStrictEqual({ in: null, out: null })
    })

    it('returns a plain copy of the two points', () => {
      useMarkersStore.getState().setInOutPoints(30, 200)

      const first = studio.markers.range()

      expect(first).toStrictEqual({ in: 30, out: 200 })
      expect(first).not.toBe(studio.markers.range())

      first.in = 999
      expect(studio.markers.range()).toStrictEqual({ in: 30, out: 200 })
    })
  })

  describe('setIn', () => {
    it('sets the in point and, on a fresh timeline, the out point to the end', () => {
      const depth = undoDepth()

      studio.markers.setIn(30)

      // `SET_IN_POINT` defaults a missing out point to `getActiveInOutMaxFrame()`
      // (`marker-actions.ts:66-69`), so the range is closed, not open-ended.
      expect(studio.markers.range()).toStrictEqual({ in: 30, out: 400 })
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.markers.range()).toStrictEqual({ in: null, out: null })
      expect(undoDepth()).toBe(depth)
    })

    it('clamps a point past the end to the end', () => {
      studio.markers.setIn(30)

      studio.markers.setIn(500)

      expect(studio.markers.range().in).toBe(400)
    })

    it('resets the out point to the end when the in point moves past it', () => {
      useMarkersStore.getState().setInOutPoints(0, 50)

      studio.markers.setIn(100)

      expect(studio.markers.range()).toStrictEqual({ in: 100, out: 400 })
    })

    it('clears the in point with null, keeps the out point and is one undo step', () => {
      useMarkersStore.getState().setInOutPoints(30, 200)
      const depth = undoDepth()

      studio.markers.setIn(null)

      expect(studio.markers.range()).toStrictEqual({ in: null, out: 200 })
      expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.markers.range()).toStrictEqual({ in: 30, out: 200 })
      expect(undoDepth()).toBe(depth)
    })

    it('rejects a frame that is not an integer frame >= 0', () => {
      const depth = undoDepth()

      const error = catchError(() => studio.markers.setIn(-5))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('frame')
      expect(error.message).toBe('markers.setIn: "frame" must be an integer frame >= 0 (got -5)')
      expect(studio.markers.range()).toStrictEqual({ in: null, out: null })
      expect(undoDepth()).toBe(depth)
    })
  })

  describe('setOut', () => {
    it('sets the out point and, on a fresh timeline, the in point to 0', () => {
      const depth = undoDepth()

      studio.markers.setOut(45)

      expect(studio.markers.range()).toStrictEqual({ in: 0, out: 45 })
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.markers.range()).toStrictEqual({ in: null, out: null })
      expect(undoDepth()).toBe(depth)
    })

    it('clamps a point past the end to the end', () => {
      studio.markers.setOut(600)

      expect(studio.markers.range()).toStrictEqual({ in: 0, out: 400 })
    })

    it('resets the in point to 0 when the out point moves before it', () => {
      useMarkersStore.getState().setInOutPoints(200, 400)

      studio.markers.setOut(100)

      expect(studio.markers.range()).toStrictEqual({ in: 0, out: 100 })
    })

    it('clears the out point with null, keeps the in point and is one undo step', () => {
      useMarkersStore.getState().setInOutPoints(30, 200)
      const depth = undoDepth()

      studio.markers.setOut(null)

      expect(studio.markers.range()).toStrictEqual({ in: 30, out: null })
      expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.markers.range()).toStrictEqual({ in: 30, out: 200 })
      expect(undoDepth()).toBe(depth)
    })

    it('rejects a frame that is not an integer frame >= 0', () => {
      const depth = undoDepth()

      const error = catchError(() => studio.markers.setOut(-5))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('frame')
      expect(error.message).toBe('markers.setOut: "frame" must be an integer frame >= 0 (got -5)')
      expect(studio.markers.range()).toStrictEqual({ in: null, out: null })
      expect(undoDepth()).toBe(depth)
    })
  })

  describe('clearRange', () => {
    it('clears both points and is one undo step', () => {
      useMarkersStore.getState().setInOutPoints(30, 200)
      const depth = undoDepth()

      studio.markers.clearRange()

      expect(studio.markers.range()).toStrictEqual({ in: null, out: null })
      expect(undoDepth()).toBe(depth + 1)

      useTimelineCommandStore.getState().undo()

      expect(studio.markers.range()).toStrictEqual({ in: 30, out: 200 })
      expect(undoDepth()).toBe(depth)
    })
  })

  it('leaves the project and the history untouched when it rejects a call', () => {
    seedMarker({ id: 'k1', frame: 30 })
    const before = buildTimelineFromStores()
    const depth = undoDepth()

    catchError(() => studio.markers.add({ frame: -1 }))
    catchError(() => studio.markers.update('k9', { frame: 10 }))
    catchError(() => studio.markers.remove('k9'))
    catchError(() => studio.markers.setIn(-1))
    catchError(() => studio.markers.setOut(-1))

    expect(buildTimelineFromStores()).toEqual(before)
    expect(undoDepth()).toBe(depth)
  })
})

describe('the @example of every method', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    seedTimeline()
  })

  it('runs studio.markers.list()', () => {
    expect(studio.markers.list()).toEqual([])
  })

  it("runs const id = studio.markers.add({ frame: 120, label: 'take off' })", () => {
    const id = studio.markers.add({ frame: 120, label: 'take off' })

    expect(studio.markers.list()).toStrictEqual([
      { id, frame: 120, label: 'take off', color: DEFAULT_COLOR },
    ])
  })

  it("runs studio.markers.update('k1', { frame: 150 })", () => {
    seedMarker({ id: 'k1', frame: 30 })

    studio.markers.update('k1', { frame: 150 })

    expect(studio.markers.list()[0]?.frame).toBe(150)
  })

  it("runs studio.markers.remove('k1')", () => {
    seedMarker({ id: 'k1', frame: 30 })

    studio.markers.remove('k1')

    expect(studio.markers.list()).toEqual([])
  })

  it('runs studio.markers.clear()', () => {
    seedMarker({ id: 'k1', frame: 30 })

    studio.markers.clear()

    expect(studio.markers.list()).toEqual([])
  })

  it('runs studio.markers.range()', () => {
    expect(studio.markers.range()).toStrictEqual({ in: null, out: null })
  })

  it('runs studio.markers.setIn(0)', () => {
    studio.markers.setIn(0)

    expect(studio.markers.range()).toStrictEqual({ in: 0, out: 400 })
  })

  it('runs studio.markers.setOut(600)', () => {
    studio.markers.setOut(600)

    // 600 is past the end of the seeded 400-frame timeline, so it is clamped.
    expect(studio.markers.range()).toStrictEqual({ in: 0, out: 400 })
  })

  it('runs studio.markers.clearRange()', () => {
    studio.markers.setIn(30)

    studio.markers.clearRange()

    expect(studio.markers.range()).toStrictEqual({ in: null, out: null })
  })
})
