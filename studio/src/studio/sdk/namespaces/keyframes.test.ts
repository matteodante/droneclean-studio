// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes, Keyframe, PropertyKeyframes } from '@/types/keyframe'
import type { Transition } from '@/types/transition'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { StudioError } from '../errors'
import { createKeyframesApi } from './keyframes'

/** The namespace, named the way the public object exposes it. */
const studio = { keyframes: createKeyframesApi() }

/** Every video property `getAnimatablePropertiesForItem` lists, in order. */
const VIDEO_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
  'volume',
]

function seedTimeline(): void {
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'c1',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 120,
      sourceEnd: 120,
      sourceDuration: 240,
      volume: 0,
    }),
    makeTimelineVideoItem({
      id: 'c2',
      trackId: 'track-v1',
      from: 120,
      durationInFrames: 120,
      sourceEnd: 120,
      sourceDuration: 240,
      volume: 0,
    }),
  ])
}

/** Two adjacent clips with a 12-frame crossfade centred on their cut. */
function seedTransition(): void {
  const transition: Transition = {
    id: 'transition-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'c1',
    rightClipId: 'c2',
    trackId: 'track-v1',
    durationInFrames: 12,
  }
  useTransitionsStore.getState().setTransitions([transition])
}

/** Keyframes of `c1`, written straight into the store the actions read. */
function seedLanes(lanes: PropertyKeyframes[]): void {
  const itemKeyframes: ItemKeyframes = { itemId: 'c1', properties: lanes }
  useKeyframesStore.getState().setKeyframes([itemKeyframes])
}

function makeKeyframe(overrides: Partial<Keyframe> = {}): Keyframe {
  return { id: 'k1', frame: 0, value: 1, easing: 'linear', ...overrides }
}

function lane(property: string): Keyframe[] {
  return (
    useKeyframesStore
      .getState()
      .keyframesByItemId['c1']?.properties.find((candidate) => candidate.property === property)
      ?.keyframes ?? []
  )
}

function undoDepth(): number {
  return useTimelineCommandStore.getState().undoStack.length
}

function lastUndoLabel(): string | undefined {
  const stack = useTimelineCommandStore.getState().undoStack
  return stack[stack.length - 1]?.command.type
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

describe('keyframes namespace', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useProjectStore.setState({ currentProject: null })
    useTimelineSettingsStore.getState().setFps(30)
    seedTimeline()
  })

  describe('properties', () => {
    it('lists the clip properties that can be animated', () => {
      expect(studio.keyframes.properties('c1')).toEqual(VIDEO_PROPERTIES)
    })

    it('returns a fresh array each call', () => {
      const first = studio.keyframes.properties('c1')
      first.length = 0

      expect(studio.keyframes.properties('c1')).toEqual(VIDEO_PROPERTIES)
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => studio.keyframes.properties('c9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('clip')
      expect(error.entity).toEqual({ kind: 'clip', id: 'c9' })
      expect(error.valid).toEqual(['c1', 'c2'])
      expect(error.message).toBe(
        'keyframes.properties: "clip" must be an existing clip id on the main timeline ' +
          '(got "c9"); valid: "c1", "c2"',
      )
    })
  })

  describe('list', () => {
    it('returns every keyframe of the clip in frame order', () => {
      seedLanes([
        {
          property: 'opacity',
          keyframes: [
            makeKeyframe({ id: 'k2', frame: 60, value: 0.5 }),
            makeKeyframe({ id: 'k1', frame: 0, value: 1, easing: 'ease-in-out' }),
          ],
        },
        { property: 'rotation', keyframes: [makeKeyframe({ id: 'k3', frame: 30, value: 45 })] },
      ])

      expect(studio.keyframes.list('c1')).toEqual([
        { id: 'k1', property: 'opacity', frame: 0, value: 1, easing: 'ease-in-out' },
        { id: 'k3', property: 'rotation', frame: 30, value: 45, easing: 'linear' },
        { id: 'k2', property: 'opacity', frame: 60, value: 0.5, easing: 'linear' },
      ])
    })

    it('filters by property and returns [] when the clip has none', () => {
      seedLanes([
        { property: 'opacity', keyframes: [makeKeyframe({ id: 'k1' })] },
        { property: 'rotation', keyframes: [makeKeyframe({ id: 'k2', frame: 30 })] },
      ])

      expect(studio.keyframes.list('c1', 'opacity').map((keyframe) => keyframe.id)).toEqual(['k1'])
      expect(studio.keyframes.list('c1', 'volume')).toEqual([])
    })

    it('returns copies, not store objects', () => {
      seedLanes([{ property: 'opacity', keyframes: [makeKeyframe({ id: 'k1' })] }])

      const keyframe = studio.keyframes.list('c1')[0]!
      keyframe.value = 0
      keyframe.frame = 99
      const array = studio.keyframes.list('c1')
      array.push({ id: 'fake', property: 'x', frame: 0, value: 0, easing: 'linear' })

      expect(studio.keyframes.list('c1')).toEqual([
        { id: 'k1', property: 'opacity', frame: 0, value: 1, easing: 'linear' },
      ])
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => studio.keyframes.list('c9', 'opacity'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('keyframes.list: "clip"')
    })
  })

  describe('add', () => {
    it('adds a keyframe and one undo step restores the state before', () => {
      const before = useKeyframesStore.getState().keyframes
      const depthBefore = undoDepth()

      const id = studio.keyframes.add('c1', 'opacity', 10, 0.5, 'ease-in-out')

      expect(typeof id).toBe('string')
      expect(lane('opacity')).toEqual([{ id, frame: 10, value: 0.5, easing: 'ease-in-out' }])
      expect(undoDepth()).toBe(depthBefore + 1)
      expect(lastUndoLabel()).toBe('KEYFRAMES_ADD')

      useTimelineCommandStore.getState().undo()

      expect(useKeyframesStore.getState().keyframes).toEqual(before)
      expect(undoDepth()).toBe(depthBefore)
    })

    it('defaults the easing to linear', () => {
      studio.keyframes.add('c1', 'opacity', 0, 1)

      expect(lane('opacity')[0]?.easing).toBe('linear')
    })

    it('replaces the value at an occupied frame and returns its id', () => {
      seedLanes([
        { property: 'opacity', keyframes: [makeKeyframe({ id: 'k1', frame: 10, value: 0.2 })] },
      ])

      const id = studio.keyframes.add('c1', 'opacity', 10, 0.8)

      expect(id).toBe('k1')
      expect(lane('opacity')).toEqual([{ id: 'k1', frame: 10, value: 0.8, easing: 'linear' }])
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => studio.keyframes.add('c9', 'opacity', 0, 1))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toBe(
        'keyframes.add: "clip" must be an existing clip id on the main timeline ' +
          '(got "c9"); valid: "c1", "c2"',
      )
    })

    it('throws INVALID_ARGUMENT when the frame is not an integer >= 0', () => {
      for (const frame of [-1, 1.5, Number.NaN]) {
        const error = catchError(() => studio.keyframes.add('c1', 'opacity', frame, 1))
        expect(error.code).toBe('INVALID_ARGUMENT')
        expect(error.argument).toBe('frame')
        expect(error.message).toContain('"frame" must be an integer frame >= 0')
      }
    })

    it('throws INVALID_ARGUMENT when the property is not animatable on the clip', () => {
      const error = catchError(() => studio.keyframes.add('c1', 'fontSize' as never, 0, 12))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('property')
      expect(error.message).toBe(
        'keyframes.add: "property" must be an animatable property of clip "c1" ' +
          '(got "fontSize"); valid: "x", "y", "width", "height", "anchorX", "anchorY", ' +
          '"rotation", "opacity", "cornerRadius", "cropLeft", … and 5 more ' +
          '(studio.keyframes.properties("c1"))',
      )
    })

    it('throws INVALID_ARGUMENT when the value is not a number', () => {
      const error = catchError(() =>
        studio.keyframes.add('c1', 'opacity', 0, '1' as unknown as number),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('value')
      expect(error.message).toBe('keyframes.add: "value" must be a number (got "1")')
    })

    it('throws INVALID_ARGUMENT when the value is outside the property range', () => {
      const error = catchError(() => studio.keyframes.add('c1', 'opacity', 0, 2))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('value')
      expect(error.message).toBe(
        'keyframes.add: "value" must be a number from 0 to 1 for property "opacity" (got 2)',
      )
    })

    it('lets a size keyframe reach past the graph bound of 2000 px in a 2K project, and still bounds it', () => {
      useProjectStore.setState({
        currentProject: {
          id: 'p', name: 'p', description: '', createdAt: 1, updatedAt: 1, duration: 0,
          metadata: { width: 1440, height: 2560, fps: 60 },
        },
      })

      const id = studio.keyframes.add('c1', 'height', 0, 2900)
      expect(lane('height')).toEqual([{ id, frame: 0, value: 2900, easing: 'linear' }])

      const error = catchError(() => studio.keyframes.add('c1', 'height', 5, 20_000))
      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.message).toContain('from 0 to 10240')
    })

    it('throws INVALID_ARGUMENT when the easing is not an easing type', () => {
      const error = catchError(() => studio.keyframes.add('c1', 'opacity', 0, 1, 'bounce' as never))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('easing')
      expect(error.message).toBe(
        'keyframes.add: "easing" must be one of the easing types (got "bounce"); valid: ' +
          '"linear", "ease-in", "ease-out", "ease-in-out", "hold", "cubic-bezier", "spring"',
      )
    })

    it('throws CONFLICT when the frame is outside the clip', () => {
      const error = catchError(() => studio.keyframes.add('c1', 'opacity', 120, 1))

      expect(error.code).toBe('CONFLICT')
      expect(error.argument).toBe('frame')
      expect(error.entity).toEqual({ kind: 'clip', id: 'c1' })
      expect(error.message).toBe(
        'keyframes.add: frame 120 is outside clip "c1" (frames 0..119 are inside it)',
      )
    })

    it('throws CONFLICT when the frame is inside a transition region', () => {
      seedTransition()

      const error = catchError(() => studio.keyframes.add('c1', 'opacity', 115, 1))

      expect(error.code).toBe('CONFLICT')
      expect(error.argument).toBe('frame')
      expect(error.entity).toEqual({ kind: 'clip', id: 'c1' })
      expect(error.message).toBe(
        'keyframes.add: frame 115 is inside the transition region 114..119 at the end of ' +
          'clip "c1" (transition "transition-1")',
      )
      expect(lane('opacity')).toEqual([])
      expect(undoDepth()).toBe(0)
    })

    it('accepts the frame just before the transition region', () => {
      seedTransition()

      expect(studio.keyframes.add('c1', 'opacity', 113, 1)).not.toBe('')
      expect(lane('opacity')).toHaveLength(1)
    })
  })

  describe('update', () => {
    beforeEach(() => {
      seedLanes([
        { property: 'opacity', keyframes: [makeKeyframe({ id: 'k1', frame: 10, value: 0.5 })] },
      ])
    })

    it('changes value, easing and frame in one undo step', () => {
      const before = useKeyframesStore.getState().keyframes
      const depthBefore = undoDepth()

      studio.keyframes.update('c1', 'k1', { value: 0.8, easing: 'hold', frame: 20 })

      expect(lane('opacity')).toEqual([{ id: 'k1', frame: 20, value: 0.8, easing: 'hold' }])
      expect(undoDepth()).toBe(depthBefore + 1)
      expect(lastUndoLabel()).toBe('KEYFRAMES_UPDATE')

      useTimelineCommandStore.getState().undo()

      expect(useKeyframesStore.getState().keyframes).toEqual(before)
      expect(undoDepth()).toBe(depthBefore)
    })

    it('gives a keyframe a custom bezier curve, which list reads back', () => {
      studio.keyframes.update('c1', 'k1', { bezier: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 } })

      expect(lane('opacity')[0]).toMatchObject({
        easing: 'cubic-bezier',
        easingConfig: { type: 'cubic-bezier', bezier: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 } },
      })
      expect(studio.keyframes.list('c1')[0]).toMatchObject({
        easing: 'cubic-bezier',
        bezier: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
      })
    })

    it('gives a keyframe spring physics, and a plain easing afterwards drops them', () => {
      studio.keyframes.update('c1', 'k1', { spring: { tension: 220, friction: 18, mass: 1 } })
      expect(studio.keyframes.list('c1')[0]).toMatchObject({ easing: 'spring', spring: { tension: 220, friction: 18, mass: 1 } })

      studio.keyframes.update('c1', 'k1', { easing: 'ease-out' })
      expect(studio.keyframes.list('c1')[0]).toEqual({ id: 'k1', property: 'opacity', frame: 10, value: 0.5, easing: 'ease-out' })
    })

    it('refuses a bezier x outside 0..1, and a patch with both a bezier and a spring', () => {
      const outside = catchError(() =>
        studio.keyframes.update('c1', 'k1', { bezier: { x1: 1.4, y1: 0, x2: 0.5, y2: 1 } }),
      )
      const both = catchError(() =>
        studio.keyframes.update('c1', 'k1', {
          bezier: { x1: 0.2, y1: 0, x2: 0.5, y2: 1 },
          spring: { tension: 170, friction: 26, mass: 1 },
        }),
      )

      expect(outside).toMatchObject({ code: 'INVALID_ARGUMENT', argument: 'patch.bezier.x1' })
      expect(both).toMatchObject({ code: 'INVALID_ARGUMENT' })
    })

    it('does nothing and adds no undo step for an empty patch', () => {
      const before = useKeyframesStore.getState().keyframes
      const depthBefore = undoDepth()

      studio.keyframes.update('c1', 'k1', {})

      expect(useKeyframesStore.getState().keyframes).toBe(before)
      expect(undoDepth()).toBe(depthBefore)
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => studio.keyframes.update('c9', 'k1', { value: 0.5 }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('keyframes.update: "clip"')
    })

    it('throws NOT_FOUND for a keyframe the clip does not have', () => {
      const error = catchError(() => studio.keyframes.update('c1', 'k9', { value: 0.5 }))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('keyframe')
      expect(error.entity).toEqual({ kind: 'keyframe', id: 'k9' })
      expect(error.valid).toEqual(['k1'])
      expect(error.message).toBe(
        'keyframes.update: "keyframe" must be an existing keyframe id on clip "c1" ' +
          '(got "k9"); valid: "k1"',
      )
    })

    it('throws INVALID_ARGUMENT for a value outside the property range', () => {
      const error = catchError(() => studio.keyframes.update('c1', 'k1', { value: 2 }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('value')
      expect(error.message).toBe(
        'keyframes.update: "value" must be a number from 0 to 1 for property "opacity" (got 2)',
      )
    })

    it('throws INVALID_ARGUMENT when the new frame is not an integer >= 0', () => {
      const error = catchError(() => studio.keyframes.update('c1', 'k1', { frame: -2 }))

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('patch.frame')
      expect(error.message).toContain('"patch.frame" must be an integer frame >= 0')
    })

    it('throws INVALID_ARGUMENT when the new easing is not an easing type', () => {
      const error = catchError(() =>
        studio.keyframes.update('c1', 'k1', { easing: 'bounce' as never }),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('easing')
      expect(error.message).toContain('"easing" must be one of the easing types')
    })

    it('throws INVALID_ARGUMENT when the patch is not an object', () => {
      const error = catchError(() =>
        studio.keyframes.update('c1', 'k1', null as unknown as Record<string, never>),
      )

      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.argument).toBe('patch')
      expect(error.message).toContain('"patch" must be an object with value, easing, bezier, spring or frame')
    })

    it('throws CONFLICT when the new frame is outside the clip', () => {
      const error = catchError(() => studio.keyframes.update('c1', 'k1', { frame: 120 }))

      expect(error.code).toBe('CONFLICT')
      expect(error.argument).toBe('patch.frame')
      expect(error.message).toBe(
        'keyframes.update: frame 120 is outside clip "c1" (frames 0..119 are inside it)',
      )
    })

    it('throws CONFLICT when the new frame is inside a transition region', () => {
      seedTransition()

      const error = catchError(() => studio.keyframes.update('c1', 'k1', { frame: 115 }))

      expect(error.code).toBe('CONFLICT')
      expect(error.argument).toBe('patch.frame')
      expect(error.message).toBe(
        'keyframes.update: frame 115 is inside the transition region 114..119 at the end of ' +
          'clip "c1" (transition "transition-1")',
      )
      expect(lane('opacity')[0]).toMatchObject({ id: 'k1', frame: 10 })
    })
  })

  describe('remove', () => {
    beforeEach(() => {
      seedLanes([
        { property: 'opacity', keyframes: [makeKeyframe({ id: 'k1', frame: 10, value: 0.5 })] },
      ])
    })

    it('removes one keyframe and one undo step restores it', () => {
      const before = useKeyframesStore.getState().keyframes
      const depthBefore = undoDepth()

      studio.keyframes.remove('c1', 'k1')

      expect(lane('opacity')).toEqual([])
      expect(undoDepth()).toBe(depthBefore + 1)
      expect(lastUndoLabel()).toBe('KEYFRAMES_REMOVE')

      useTimelineCommandStore.getState().undo()

      expect(useKeyframesStore.getState().keyframes).toEqual(before)
      expect(undoDepth()).toBe(depthBefore)
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => studio.keyframes.remove('c9', 'k1'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('keyframes.remove: "clip"')
    })

    it('throws NOT_FOUND for a keyframe the clip does not have', () => {
      const error = catchError(() => studio.keyframes.remove('c1', 'k9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.argument).toBe('keyframe')
      expect(error.message).toBe(
        'keyframes.remove: "keyframe" must be an existing keyframe id on clip "c1" ' +
          '(got "k9"); valid: "k1"',
      )
    })
  })

  describe('removeAll', () => {
    beforeEach(() => {
      seedLanes([
        {
          property: 'opacity',
          keyframes: [
            makeKeyframe({ id: 'k1', frame: 0, value: 1 }),
            makeKeyframe({ id: 'k2', frame: 30, value: 0.5 }),
          ],
        },
        { property: 'rotation', keyframes: [makeKeyframe({ id: 'k3', frame: 10, value: 45 })] },
      ])
    })

    it('removes every keyframe of one property and one undo step restores them', () => {
      const before = useKeyframesStore.getState().keyframes
      const depthBefore = undoDepth()

      studio.keyframes.removeAll('c1', 'opacity')

      expect(lane('opacity')).toEqual([])
      expect(lane('rotation')).toHaveLength(1)
      expect(undoDepth()).toBe(depthBefore + 1)
      expect(lastUndoLabel()).toBe('KEYFRAMES_REMOVE_ALL')

      useTimelineCommandStore.getState().undo()

      expect(useKeyframesStore.getState().keyframes).toEqual(before)
      expect(undoDepth()).toBe(depthBefore)
    })

    it('removes every keyframe of the clip and one undo step restores them', () => {
      const before = useKeyframesStore.getState().keyframes
      const depthBefore = undoDepth()

      studio.keyframes.removeAll('c1')

      expect(useKeyframesStore.getState().keyframesByItemId['c1']).toBeUndefined()
      expect(undoDepth()).toBe(depthBefore + 1)
      expect(lastUndoLabel()).toBe('KEYFRAMES_REMOVE_ALL')

      useTimelineCommandStore.getState().undo()

      expect(useKeyframesStore.getState().keyframes).toEqual(before)
      expect(undoDepth()).toBe(depthBefore)
    })

    it('removes vector lanes too when no property is given', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'c1',
          properties: [],
          vectorProperties: [
            {
              property: 'position',
              keyframes: [{ id: 'v1', frame: 0, value: { x: 0, y: 0 }, easing: 'linear' }],
            },
          ],
        },
      ])

      studio.keyframes.removeAll('c1')

      expect(useKeyframesStore.getState().keyframesByItemId['c1']).toBeUndefined()
    })

    it('does nothing and adds no undo step when the property has no keyframes', () => {
      const before = useKeyframesStore.getState().keyframes
      const depthBefore = undoDepth()

      studio.keyframes.removeAll('c1', 'volume')

      expect(useKeyframesStore.getState().keyframes).toBe(before)
      expect(undoDepth()).toBe(depthBefore)
    })

    it('throws NOT_FOUND for a clip of another context', () => {
      const error = catchError(() => studio.keyframes.removeAll('c9'))

      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('keyframes.removeAll: "clip"')
    })
  })

  describe('the @example calls of the interface', () => {
    it("runs studio.keyframes.properties('c1')", () => {
      expect(studio.keyframes.properties('c1')).toEqual(VIDEO_PROPERTIES)
    })

    it("runs studio.keyframes.list('c1', 'opacity')", () => {
      seedLanes([{ property: 'opacity', keyframes: [makeKeyframe({ id: 'k1' })] }])

      expect(studio.keyframes.list('c1', 'opacity')).toHaveLength(1)
    })

    it("runs const id = studio.keyframes.add('c1', 'opacity', 0, 1, 'ease-in-out')", () => {
      const id = studio.keyframes.add('c1', 'opacity', 0, 1, 'ease-in-out')

      expect(typeof id).toBe('string')
      expect(lane('opacity')[0]).toMatchObject({ id, frame: 0, value: 1, easing: 'ease-in-out' })
    })

    it("runs studio.keyframes.update('c1', 'k1', { value: 0.5 })", () => {
      seedLanes([
        { property: 'opacity', keyframes: [makeKeyframe({ id: 'k1', frame: 0, value: 1 })] },
      ])

      studio.keyframes.update('c1', 'k1', { value: 0.5 })

      expect(lane('opacity')[0]).toMatchObject({ id: 'k1', value: 0.5 })
    })

    it("runs studio.keyframes.remove('c1', 'k1')", () => {
      seedLanes([{ property: 'opacity', keyframes: [makeKeyframe({ id: 'k1' })] }])

      studio.keyframes.remove('c1', 'k1')

      expect(lane('opacity')).toEqual([])
    })

    it("runs studio.keyframes.removeAll('c1', 'opacity')", () => {
      seedLanes([{ property: 'opacity', keyframes: [makeKeyframe({ id: 'k1' })] }])

      studio.keyframes.removeAll('c1', 'opacity')

      expect(lane('opacity')).toEqual([])
    })
  })
})
