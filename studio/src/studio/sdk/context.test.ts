// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { SubComposition } from '@/features/timeline/stores/compositions-store'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import {
  describeContext,
  getTimelineContext,
  requireClip,
  requireFrame,
  requireMarker,
  requireMedia,
  requireTrack,
  requireTransition,
} from './context'
import { StudioError } from './errors'

const composition: SubComposition = {
  id: 'comp-1',
  name: 'Intro',
  items: [],
  tracks: [],
  transitions: [],
  keyframes: [],
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 0,
}

function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
    ])
  useItemsStore.getState().setItems([makeTimelineVideoItem({ id: 'clip-1', trackId: 'track-v1' })])
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

describe('the active editing context', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
  })

  it('is the main timeline when no composition is open', () => {
    expect(getTimelineContext()).toEqual({ kind: 'main' })
    expect(describeContext(getTimelineContext())).toBe('the main timeline')
  })

  it('is the open composition, with its name', () => {
    useCompositionsStore.getState().setCompositions([composition])
    useCompositionNavigationStore.setState({ activeCompositionId: 'comp-1' })

    expect(getTimelineContext()).toEqual({ kind: 'composition', id: 'comp-1', name: 'Intro' })
    expect(describeContext(getTimelineContext())).toBe('composition "Intro"')
  })
})

describe('entity lookups', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    seedTimeline()
  })

  it('returns the store entity', () => {
    expect(requireClip('clip-1')).toMatchObject({ id: 'clip-1', trackId: 'track-v1' })
    expect(requireTrack('track-a1')).toMatchObject({ id: 'track-a1', name: 'A1' })
  })

  it('throws NOT_FOUND with the valid ids and the context hint', () => {
    const error = catchError(() => requireClip('nope', 'clips.update'))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('clipId')
    expect(error.entity).toEqual({ kind: 'clip', id: 'nope' })
    expect(error.valid).toEqual(['clip-1'])
    expect(error.message).toBe(
      'clips.update: "clipId" must be an existing clip id on the main timeline (got "nope"); ' +
        'valid: "clip-1"',
    )
    expect(error.hint).toContain('studio.project.context()')
  })

  it('names the argument and the context of a rejected track id', () => {
    const error = catchError(() => requireTrack('v9', 'clips.move', 'trackId'))

    expect(error.message).toBe(
      'clips.move: "trackId" must be an existing track id on the main timeline (got "v9"); ' +
        'valid: "track-v1", "track-a1"',
    )
  })

  it('names the open composition when one is open', () => {
    useCompositionsStore.getState().setCompositions([composition])
    useCompositionNavigationStore.setState({ activeCompositionId: 'comp-1' })
    // A composition is its own timeline: the store holds its clips, not Main's.
    useItemsStore.getState().setItems([])

    const error = catchError(() => requireClip('clip-1'))

    expect(error.message).toContain('in composition "Intro"')
    expect(error.valid).toEqual([])
  })

  it('looks transitions and markers up in their stores', () => {
    expect(catchError(() => requireTransition('x1')).entity).toEqual({
      kind: 'transition',
      id: 'x1',
    })
    expect(catchError(() => requireMarker('k1')).entity).toEqual({ kind: 'marker', id: 'k1' })
  })

  it('looks media up in the library and says ids are workspace-wide', () => {
    const error = catchError(() => requireMedia('m-9', 'clips.add'))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.message).toContain('an existing media id in the media library')
    expect(error.hint).toContain('studio.media.list()')
  })
})

describe('requireFrame', () => {
  it('accepts an integer frame >= 0', () => {
    expect(requireFrame(0, 'from')).toBe(0)
    expect(requireFrame(120, 'from')).toBe(120)
  })

  it('rejects anything else', () => {
    for (const value of [-1, 1.5, Number.NaN, '12', null, undefined]) {
      const error = catchError(() => requireFrame(value, 'from', 'clips.add'))
      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('from')
      expect(error.message).toContain('an integer frame >= 0')
    }
  })
})
