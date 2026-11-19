// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Transition } from '@/types/transition'
import { transitionRegistry } from '@/shared/timeline/transitions'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { buildTimelineFromStores } from '@/features/timeline/stores/timeline-persistence'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { StudioError } from '../errors'
import type { TransitionDirection, TransitionTiming } from '../types'
import { createTransitionsApi } from './transitions'

const TRACK_V1 = 'track-v1'
const TRACK_V2 = 'track-v2'

const api = createTransitionsApi()

/**
 * Two adjacent clips on V1 with source handle on both sides of the cut: c1
 * ends at frame 120 and leaves 120 tail frames, c2 starts there and leaves 60
 * head frames. c3 sits far from them and c4 sits on another track.
 */
function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: TRACK_V1, name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: TRACK_V2, name: 'V2', kind: 'video', order: 1 }),
    ])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'c1',
      trackId: TRACK_V1,
      from: 0,
      durationInFrames: 120,
      sourceStart: 0,
      sourceEnd: 120,
      sourceDuration: 240,
    }),
    makeTimelineVideoItem({
      id: 'c2',
      trackId: TRACK_V1,
      from: 120,
      durationInFrames: 120,
      sourceStart: 60,
      sourceEnd: 180,
      sourceDuration: 240,
      mediaId: 'media-2',
      label: 'c2.mp4',
    }),
    makeTimelineVideoItem({
      id: 'c3',
      trackId: TRACK_V1,
      from: 400,
      durationInFrames: 120,
      sourceStart: 0,
      sourceEnd: 120,
      sourceDuration: 240,
      mediaId: 'media-3',
      label: 'c3.mp4',
    }),
    makeTimelineVideoItem({
      id: 'c4',
      trackId: TRACK_V2,
      from: 120,
      durationInFrames: 120,
      sourceStart: 0,
      sourceEnd: 120,
      sourceDuration: 240,
      mediaId: 'media-4',
      label: 'c4.mp4',
    }),
  ])
}

/** Replace the clips with a pair that has no source handle at its cut. */
function seedNoHandlePair(): void {
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'd1',
      trackId: TRACK_V1,
      from: 0,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 60,
    }),
    makeTimelineVideoItem({
      id: 'd2',
      trackId: TRACK_V1,
      from: 60,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 60,
      mediaId: 'media-2',
      label: 'd2.mp4',
    }),
  ])
}

/** One stored transition on the c1/c2 cut, with the editor's defaults. */
function seedTransition(overrides: Partial<Transition> = {}): Transition {
  const transition: Transition = {
    id: 'x1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'c1',
    rightClipId: 'c2',
    trackId: TRACK_V1,
    durationInFrames: 30,
    alignment: 0.5,
    ...overrides,
  }
  useTransitionsStore.getState().setTransitions([transition])
  return transition
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

function lastCommandType(): string | null {
  return useTimelineCommandStore.getState().getLastCommandType()
}

/** Run `fn`, require a `StudioError`, and return it. */
function catchError(fn: () => unknown): StudioError {
  try {
    fn()
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

beforeEach(() => {
  resetTimelineCompositionTestState()
  useProjectStore.setState({ currentProject: null })
  useTimelineSettingsStore.getState().setFps(30)
  seedTimeline()
})

describe('transitions.presentations', () => {
  it('lists the presentation ids the registry knows', () => {
    const ids = api.presentations()

    expect(ids).toContain('fade')
    expect(ids).toContain('wipe')
    expect(ids).toContain('dissolve')
    expect(ids.length).toBeGreaterThan(10)
  })

  it('returns a fresh array, not the registry list', () => {
    const ids = api.presentations()
    const before = [...ids]

    ids.length = 0
    ids.push('noise')

    expect(api.presentations()).toEqual(before)
  })
})

describe('transitions.list', () => {
  it('is empty when the context has no transition', () => {
    expect(api.list()).toEqual([])
  })

  it('copies every field of the stored transition, by value', () => {
    seedTransition({
      timing: 'cubic-bezier',
      bezierPoints: { x1: 0.2, y1: 0, x2: 0.8, y2: 1 },
      direction: 'from-left',
      presetId: 'preset-1',
      properties: { theme: 'warm', rgb: [1, 0.5, 0] },
    })

    const [info] = api.list()
    const stored = useTransitionsStore.getState().transitions[0]!

    expect(info).toEqual({
      id: 'x1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'cubic-bezier',
      leftClipId: 'c1',
      rightClipId: 'c2',
      trackId: TRACK_V1,
      durationInFrames: 30,
      direction: 'from-left',
      alignment: 0.5,
      bezierPoints: { x1: 0.2, y1: 0, x2: 0.8, y2: 1 },
      presetId: 'preset-1',
      properties: { theme: 'warm', rgb: [1, 0.5, 0] },
    })
    expect(info).not.toBe(stored)
    expect(info?.bezierPoints).not.toBe(stored.bezierPoints)
    expect(info?.properties).not.toBe(stored.properties)

    info!.durationInFrames = 1
    info!.bezierPoints!.x1 = 9
    ;(info!.properties!.rgb as number[])[0] = 0

    expect(stored.durationInFrames).toBe(30)
    expect(stored.bezierPoints).toEqual({ x1: 0.2, y1: 0, x2: 0.8, y2: 1 })
    expect(stored.properties).toEqual({ theme: 'warm', rgb: [1, 0.5, 0] })
  })

  it('returns a fresh array each call', () => {
    seedTransition()
    const list = api.list()

    list.length = 0

    expect(api.list()).toHaveLength(1)
  })
})

describe('transitions.add', () => {
  it('creates the transition and commits one undo entry', () => {
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    const id = api.add({ left: 'c1', right: 'c2', presentation: 'fade', durationInFrames: 30 })

    expect(api.list()).toEqual([
      {
        id,
        type: 'crossfade',
        presentation: 'fade',
        timing: 'linear',
        leftClipId: 'c1',
        rightClipId: 'c2',
        trackId: TRACK_V1,
        durationInFrames: 30,
        alignment: 0.5,
      },
    ])
    expect(lastCommandType()).toBe('TRANSITIONS_ADD')
    expect(undoDepth()).toBe(depthBefore + 1)

    useTimelineCommandStore.getState().undo()

    expect(undoDepth()).toBe(depthBefore)
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('applies a timing in the same undo entry as the creation', () => {
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    const id = api.add({
      left: 'c1',
      right: 'c2',
      presentation: 'fade',
      durationInFrames: 30,
      timing: 'ease-in',
    })

    expect(api.list()[0]).toMatchObject({ id, timing: 'ease-in' })
    expect(lastCommandType()).toBe('TRANSITIONS_ADD')
    expect(undoDepth()).toBe(depthBefore + 1)

    useTimelineCommandStore.getState().undo()

    expect(useTransitionsStore.getState().transitions).toEqual([])
    expect(undoDepth()).toBe(depthBefore)
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('passes direction and alignment through to the store', () => {
    api.add({
      left: 'c1',
      right: 'c2',
      presentation: 'wipe',
      durationInFrames: 30,
      direction: 'from-left',
      alignment: 1,
    })

    expect(useTransitionsStore.getState().transitions[0]).toMatchObject({
      presentation: 'wipe',
      direction: 'from-left',
      alignment: 1,
      durationInFrames: 30,
    })
  })

  it("uses the presentation's own default length when the input has none", () => {
    const expected = transitionRegistry.getDefinition('blurDissolve')?.defaultDuration

    api.add({ left: 'c1', right: 'c2', presentation: 'blurDissolve' })

    expect(expected).toBeGreaterThan(0)
    expect(api.list()[0]?.durationInFrames).toBe(expected)
  })

  it('throws NOT_FOUND naming the left clip and the valid ids', () => {
    const error = catchError(() => api.add({ left: 'nope', right: 'c2' }))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('left')
    expect(error.entity).toEqual({ kind: 'clip', id: 'nope' })
    expect(error.valid).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(error.message).toBe(
      'transitions.add: "left" must be an existing clip id on the main timeline (got "nope"); ' +
        'valid: "c1", "c2", "c3", "c4"',
    )
  })

  it('throws NOT_FOUND naming the right clip', () => {
    const error = catchError(() => api.add({ left: 'c1', right: 'nope' }))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('right')
    expect(error.entity).toEqual({ kind: 'clip', id: 'nope' })
    expect(error.message).toContain('"right" must be an existing clip id on the main timeline')
  })

  it('throws INVALID_ARGUMENT for an unknown presentation, listing the valid ids', () => {
    const depthBefore = undoDepth()

    const error = catchError(() => api.add({ left: 'c1', right: 'c2', presentation: 'noise' }))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('presentation')
    expect(error.valid).toEqual(api.presentations())
    expect(error.valid).toContain('fade')
    expect(error.message).toContain(
      'transitions.add: "presentation" must be a known transition presentation id (got "noise"); ' +
        'valid: "fade"',
    )
    expect(error.message).toContain('(studio.transitions.presentations())')
    expect(useTransitionsStore.getState().transitions).toEqual([])
    expect(undoDepth()).toBe(depthBefore)
  })

  it('throws INVALID_ARGUMENT for a timing the store does not have', () => {
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    const error = catchError(() =>
      api.add({ left: 'c1', right: 'c2', timing: 'spring' as TransitionTiming }),
    )

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('timing')
    expect(error.valid).toEqual(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'])
    expect(error.message).toBe(
      'transitions.add: "timing" must be a known transition timing (got "spring"); ' +
        'valid: "linear", "ease-in", "ease-out", "ease-in-out", "cubic-bezier"',
    )
    expect(api.list()).toEqual([])
    expect(undoDepth()).toBe(depthBefore)
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('throws INVALID_ARGUMENT for a direction the store does not have', () => {
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    const error = catchError(() =>
      api.add({ left: 'c1', right: 'c2', direction: 'sideways' as TransitionDirection }),
    )

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('direction')
    expect(error.valid).toEqual(['from-left', 'from-right', 'from-top', 'from-bottom'])
    expect(error.message).toBe(
      'transitions.add: "direction" must be a known transition direction (got "sideways"); ' +
        'valid: "from-left", "from-right", "from-top", "from-bottom"',
    )
    expect(api.list()).toEqual([])
    expect(undoDepth()).toBe(depthBefore)
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('throws INVALID_ARGUMENT for an alignment outside 0..1', () => {
    for (const alignment of [1.5, -0.5]) {
      const before = buildTimelineFromStores()
      const depthBefore = undoDepth()

      const error = catchError(() => api.add({ left: 'c1', right: 'c2', alignment }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('alignment')
      expect(error.valid).toBeUndefined()
      expect(error.message).toBe(
        `transitions.add: "alignment" must be a number between 0 and 1 (got ${alignment})`,
      )
      expect(api.list()).toEqual([])
      expect(undoDepth()).toBe(depthBefore)
      expect(buildTimelineFromStores()).toEqual(before)
    }
  })

  it('throws INVALID_ARGUMENT for a duration that is not an integer frame >= 1', () => {
    for (const durationInFrames of [0, 1.5, -10]) {
      const before = buildTimelineFromStores()
      const depthBefore = undoDepth()

      const error = catchError(() => api.add({ left: 'c1', right: 'c2', durationInFrames }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('durationInFrames')
      expect(error.message).toBe(
        'transitions.add: "durationInFrames" must be an integer frame >= 1 ' +
          `(got ${durationInFrames})`,
      )
      expect(api.list()).toEqual([])
      expect(undoDepth()).toBe(depthBefore)
      expect(buildTimelineFromStores()).toEqual(before)
    }
  })

  it('throws CONFLICT with the reason when the clips do not meet at the cut', () => {
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    const error = catchError(() => api.add({ left: 'c1', right: 'c3' }))

    expect(error.code).toBe('CONFLICT')
    expect(error.message).toBe(
      'transitions.add: the cut between clips "c1" and "c3" cannot take a transition: ' +
        'Clips must meet at the cut',
    )
    expect(buildTimelineFromStores()).toEqual(before)
    expect(undoDepth()).toBe(depthBefore)
  })

  it('throws CONFLICT when the clips are on different tracks', () => {
    const error = catchError(() => api.add({ left: 'c1', right: 'c4' }))

    expect(error.code).toBe('CONFLICT')
    expect(error.message).toBe(
      'transitions.add: the cut between clips "c1" and "c4" cannot take a transition: ' +
        'Clips must be on the same track',
    )
  })

  it('throws CONFLICT when the cut has no handle left', () => {
    seedNoHandlePair()

    const error = catchError(() => api.add({ left: 'd1', right: 'd2' }))

    expect(error.code).toBe('CONFLICT')
    expect(error.message).toBe(
      'transitions.add: the cut between clips "d1" and "d2" cannot take a transition: ' +
        'Insufficient handle for transition: left clip needs 1 tail-handle frames but only has 0',
    )
    expect(useTransitionsStore.getState().transitions).toEqual([])
  })

  it('throws CONFLICT when the cut already carries a transition', () => {
    const id = api.add({ left: 'c1', right: 'c2' })
    const depthBefore = undoDepth()

    const error = catchError(() => api.add({ left: 'c1', right: 'c2' }))

    expect(error.code).toBe('CONFLICT')
    expect(error.entity).toEqual({ kind: 'transition', id })
    expect(error.message).toBe(
      'transitions.add: a transition already exists between clips "c1" and "c2"',
    )
    expect(undoDepth()).toBe(depthBefore)
  })
})

describe('transitions.update', () => {
  it('changes presentation, timing, direction and alignment in one undo entry', () => {
    seedTransition()
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    api.update('x1', {
      presentation: 'wipe',
      timing: 'ease-in-out',
      direction: 'from-right',
      alignment: 0.6,
    })

    expect(api.list()[0]).toMatchObject({
      presentation: 'wipe',
      timing: 'ease-in-out',
      direction: 'from-right',
      alignment: 0.6,
    })
    expect(lastCommandType()).toBe('TRANSITIONS_UPDATE')
    expect(undoDepth()).toBe(depthBefore + 1)

    useTimelineCommandStore.getState().undo()

    expect(api.list()[0]).toMatchObject({
      presentation: 'fade',
      timing: 'linear',
      alignment: 0.5,
    })
    expect(api.list()[0]?.direction).toBeUndefined()
    expect(undoDepth()).toBe(depthBefore)
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('changes the length when the handles fit', () => {
    seedTransition()

    api.update('x1', { durationInFrames: 45 })

    expect(api.list()[0]?.durationInFrames).toBe(45)
  })

  it('is not an undo step when the patch changes nothing', () => {
    seedTransition()
    const depthBefore = undoDepth()

    api.update('x1', {})

    expect(undoDepth()).toBe(depthBefore)
    expect(api.list()[0]?.durationInFrames).toBe(30)
  })

  it('throws NOT_FOUND naming the transition and the valid ids', () => {
    seedTransition()

    const error = catchError(() => api.update('x9', { durationInFrames: 45 }))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('id')
    expect(error.entity).toEqual({ kind: 'transition', id: 'x9' })
    expect(error.message).toBe(
      'transitions.update: "id" must be an existing transition id on the main timeline ' +
        '(got "x9"); valid: "x1"',
    )
  })

  it('throws INVALID_ARGUMENT for an unknown presentation', () => {
    seedTransition()

    const error = catchError(() => api.update('x1', { presentation: 'noise' }))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('presentation')
    expect(error.valid).toEqual(api.presentations())
    expect(error.message).toContain(
      'transitions.update: "presentation" must be a known transition presentation id ' +
        '(got "noise")',
    )
    expect(api.list()[0]?.presentation).toBe('fade')
  })

  it('throws INVALID_ARGUMENT for a timing the store does not have', () => {
    seedTransition()
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    const error = catchError(() => api.update('x1', { timing: 'spring' as TransitionTiming }))

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('timing')
    expect(error.valid).toEqual(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'])
    expect(error.message).toBe(
      'transitions.update: "timing" must be a known transition timing (got "spring"); ' +
        'valid: "linear", "ease-in", "ease-out", "ease-in-out", "cubic-bezier"',
    )
    expect(api.list()[0]?.timing).toBe('linear')
    expect(undoDepth()).toBe(depthBefore)
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('throws INVALID_ARGUMENT for a direction the store does not have', () => {
    seedTransition()
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    const error = catchError(() =>
      api.update('x1', { direction: 'sideways' as TransitionDirection }),
    )

    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.argument).toBe('direction')
    expect(error.valid).toEqual(['from-left', 'from-right', 'from-top', 'from-bottom'])
    expect(error.message).toBe(
      'transitions.update: "direction" must be a known transition direction (got "sideways"); ' +
        'valid: "from-left", "from-right", "from-top", "from-bottom"',
    )
    expect(api.list()[0]?.direction).toBeUndefined()
    expect(undoDepth()).toBe(depthBefore)
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('throws INVALID_ARGUMENT for an alignment outside 0..1', () => {
    seedTransition()

    for (const alignment of [1.5, -0.5]) {
      const before = buildTimelineFromStores()
      const depthBefore = undoDepth()

      const error = catchError(() => api.update('x1', { alignment }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('alignment')
      expect(error.valid).toBeUndefined()
      expect(error.message).toBe(
        `transitions.update: "alignment" must be a number between 0 and 1 (got ${alignment})`,
      )
      expect(api.list()[0]?.alignment).toBe(0.5)
      expect(undoDepth()).toBe(depthBefore)
      expect(buildTimelineFromStores()).toEqual(before)
    }
  })

  it('throws INVALID_ARGUMENT for a duration that is not an integer frame >= 1', () => {
    seedTransition()

    for (const durationInFrames of [0, 1.5, -10]) {
      const before = buildTimelineFromStores()
      const depthBefore = undoDepth()

      const error = catchError(() => api.update('x1', { durationInFrames }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('durationInFrames')
      expect(error.message).toBe(
        'transitions.update: "durationInFrames" must be an integer frame >= 1 ' +
          `(got ${durationInFrames})`,
      )
      expect(api.list()[0]?.durationInFrames).toBe(30)
      expect(undoDepth()).toBe(depthBefore)
      expect(buildTimelineFromStores()).toEqual(before)
    }
  })

  it('throws CONFLICT with the reason when the length no longer fits the handles', () => {
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'c1',
        trackId: TRACK_V1,
        from: 0,
        durationInFrames: 120,
        sourceStart: 0,
        sourceEnd: 120,
        sourceDuration: 140,
      }),
      makeTimelineVideoItem({
        id: 'c2',
        trackId: TRACK_V1,
        from: 120,
        durationInFrames: 120,
        sourceStart: 20,
        sourceEnd: 140,
        sourceDuration: 160,
        mediaId: 'media-2',
        label: 'c2.mp4',
      }),
    ])
    seedTransition()
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    const error = catchError(() => api.update('x1', { durationInFrames: 45 }))

    expect(error.code).toBe('CONFLICT')
    expect(error.entity).toEqual({ kind: 'transition', id: 'x1' })
    expect(error.message).toBe(
      'transitions.update: transition "x1" cannot take those values: ' +
        'Insufficient handle for transition: left clip needs 23 tail-handle frames but ' +
        'only has 20; right clip needs 22 head-handle frames but only has 20',
    )
    expect(api.list()[0]?.durationInFrames).toBe(30)
    expect(undoDepth()).toBe(depthBefore)
    expect(buildTimelineFromStores()).toEqual(before)
  })
})

describe('transitions.remove', () => {
  it('removes the transition and commits one undo entry', () => {
    seedTransition()
    const before = buildTimelineFromStores()
    const depthBefore = undoDepth()

    api.remove('x1')

    expect(api.list()).toEqual([])
    expect(lastCommandType()).toBe('TRANSITIONS_REMOVE')
    expect(undoDepth()).toBe(depthBefore + 1)

    useTimelineCommandStore.getState().undo()

    expect(api.list()).toEqual([expect.objectContaining({ id: 'x1' })])
    expect(undoDepth()).toBe(depthBefore)
    expect(buildTimelineFromStores()).toEqual(before)
  })

  it('throws NOT_FOUND naming the transition and the valid ids', () => {
    seedTransition()

    const error = catchError(() => api.remove('x9'))

    expect(error.code).toBe('NOT_FOUND')
    expect(error.argument).toBe('id')
    expect(error.entity).toEqual({ kind: 'transition', id: 'x9' })
    expect(error.message).toBe(
      'transitions.remove: "id" must be an existing transition id on the main timeline ' +
        '(got "x9"); valid: "x1"',
    )
  })

  it('leaves the history untouched when the id is unknown', () => {
    seedTransition()
    const depthBefore = undoDepth()

    catchError(() => api.remove('x9'))

    expect(undoDepth()).toBe(depthBefore)
    expect(api.list()).toHaveLength(1)
  })
})

describe('the examples in types.ts', () => {
  // The JSDoc examples name `studio`; this is the namespace they reach.
  const studio = { transitions: api }

  it('runs studio.transitions.presentations()', () => {
    const ids = studio.transitions.presentations()

    expect(ids).toContain('fade')
  })

  it('runs studio.transitions.list()', () => {
    seedTransition()

    expect(studio.transitions.list()).toHaveLength(1)
  })

  it('runs studio.transitions.add({ left, right, presentation, durationInFrames })', () => {
    const id = studio.transitions.add({
      left: 'c1',
      right: 'c2',
      presentation: 'fade',
      durationInFrames: 30,
    })

    expect(api.list()[0]).toMatchObject({ id, leftClipId: 'c1', rightClipId: 'c2' })
  })

  it("runs studio.transitions.update('x1', { durationInFrames: 45 })", () => {
    seedTransition()

    studio.transitions.update('x1', { durationInFrames: 45 })

    expect(api.list()[0]?.durationInFrames).toBe(45)
  })

  it("runs studio.transitions.remove('x1')", () => {
    seedTransition()

    studio.transitions.remove('x1')

    expect(api.list()).toEqual([])
  })
})
