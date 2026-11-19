/**
 * `studio.keyframes`: scalar animation lanes of a clip (design §4.2).
 *
 * Every writing method is one undo step: it validates its arguments before it
 * touches a store, runs the same store actions the dopesheet and the
 * properties panel run, and lets `transaction` commit the single entry. The
 * store's silent failures (a keyframe inside a transition region is skipped
 * without a word) become the typed errors the public interface documents.
 *
 * Frames are clip-relative (`@/types/keyframe`, `Keyframe.frame`): frame 0 is
 * the clip's first frame, and a keyframe must sit inside the clip's current
 * length, like the dopesheet's own clamp
 * (`motion-dopesheet-content.tsx:1504-1507`).
 */

import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import {
  addKeyframe,
  removeKeyframe,
  removeKeyframesForItem,
  removeKeyframesForProperty,
  updateKeyframe,
} from '@/features/timeline/stores/actions/keyframe-actions'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { getAnimatablePropertiesForItem } from '@/features/keyframes/utils/animatable-properties'
import { isFrameInTransitionRegion } from '@/features/keyframes/utils/transition-region'
import { PROPERTY_VALUE_RANGES } from '@/features/keyframes/property-value-ranges'
import { requireClip, requireFrame } from '../context'
import { invalidArgumentError, notFoundError, studioError } from '../errors'
import { transaction } from '../transaction'
import type {
  ClipId,
  Easing,
  Frame,
  KeyframeId,
  KeyframeInfo,
  KeyframePatch,
  KeyframeProperty,
  KeyframesApi,
} from '../types'

/** Every easing the keyframe store understands (`EasingType`). */
const EASINGS: readonly Easing[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
  'cubic-bezier',
  'spring',
]

/** The value bounds the editor uses for a property (`PropertyValueRange`). */
interface ValueRange {
  min: number
  max: number
}

/** One keyframe as the keyframe store holds it, with the lane that owns it. */
interface FoundKeyframe {
  property: AnimatableProperty
  keyframe: Keyframe
}

/** The method names, exactly as the public interface spells them. */
const METHODS = {
  properties: 'keyframes.properties',
  list: 'keyframes.list',
  add: 'keyframes.add',
  update: 'keyframes.update',
  remove: 'keyframes.remove',
  removeAll: 'keyframes.removeAll',
} as const

/** The clip with this id, or the context's `NOT_FOUND`. */
function requireKeyframesClip(clip: ClipId, method: string): TimelineItem {
  return requireClip(clip, method, 'clip')
}

/** The scalar keyframes of a clip, in store order. */
function keyframesOf(clip: TimelineItem): KeyframeInfo[] {
  const itemKeyframes = useKeyframesStore.getState().keyframesByItemId[clip.id]
  const keyframes: KeyframeInfo[] = []
  for (const lane of itemKeyframes?.properties ?? []) {
    for (const keyframe of lane.keyframes) {
      keyframes.push({
        id: keyframe.id,
        property: lane.property,
        frame: keyframe.frame,
        value: keyframe.value,
        easing: keyframe.easing,
      })
    }
  }
  return keyframes
}

/** Whether the clip has any keyframe, in a scalar or a vector lane. */
function hasAnyKeyframe(clip: TimelineItem): boolean {
  const itemKeyframes = useKeyframesStore.getState().keyframesByItemId[clip.id]
  if (itemKeyframes?.properties.some((lane) => lane.keyframes.length > 0)) return true
  return itemKeyframes?.vectorProperties?.some((lane) => lane.keyframes.length > 0) ?? false
}

/** The lane and keyframe with this id on the clip, if it has one. */
function findKeyframe(clip: TimelineItem, keyframeId: KeyframeId): FoundKeyframe | undefined {
  const itemKeyframes = useKeyframesStore.getState().keyframesByItemId[clip.id]
  for (const lane of itemKeyframes?.properties ?? []) {
    const keyframe = lane.keyframes.find((candidate) => candidate.id === keyframeId)
    if (keyframe) return { property: lane.property, keyframe }
  }
  return undefined
}

/** The clip's keyframe with this id, or `NOT_FOUND` naming the ids it has. */
function requireKeyframe(
  clip: TimelineItem,
  keyframeId: KeyframeId,
  method: string,
): FoundKeyframe {
  const found = findKeyframe(clip, keyframeId)
  if (found) return found
  throw notFoundError({
    method,
    argument: 'keyframe',
    kind: 'keyframe',
    id: keyframeId,
    expectation: `an existing keyframe id on clip ${JSON.stringify(clip.id)}`,
    valid: keyframesOf(clip).map((keyframe) => keyframe.id),
    hint: `studio.keyframes.list(${JSON.stringify(clip.id)}) lists the keyframes of a clip.`,
  })
}

/**
 * The property as one the clip can animate, or `INVALID_ARGUMENT` naming the
 * properties that `studio.keyframes.properties` offers for it.
 */
function requireAnimatableProperty(
  clip: TimelineItem,
  property: unknown,
  method: string,
): KeyframeProperty {
  const available = getAnimatablePropertiesForItem(clip)
  if (typeof property === 'string' && (available as readonly string[]).includes(property)) {
    return property as KeyframeProperty
  }
  throw invalidArgumentError({
    method,
    argument: 'property',
    expectation: `an animatable property of clip ${JSON.stringify(clip.id)}`,
    value: property,
    valid: available,
    validSource: `studio.keyframes.properties(${JSON.stringify(clip.id)})`,
  })
}

/** The easing, or `INVALID_ARGUMENT` naming the easing types. */
function requireEasing(value: unknown, method: string): Easing {
  if (typeof value === 'string' && (EASINGS as readonly string[]).includes(value)) {
    return value as Easing
  }
  throw invalidArgumentError({
    method,
    argument: 'easing',
    expectation: 'one of the easing types',
    value,
    valid: EASINGS,
  })
}

/**
 * The value, or `INVALID_ARGUMENT`: it must be a finite number inside the
 * property's range (`PROPERTY_VALUE_RANGES`, the bounds the value graph and the
 * dopesheet clamp to).
 */
function requireValue(value: unknown, property: KeyframeProperty, method: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidArgumentError({
      method,
      argument: 'value',
      expectation: 'a number',
      value,
    })
  }
  const range = PROPERTY_VALUE_RANGES[property as AnimatableProperty] as ValueRange | undefined
  if (range && (value < range.min || value > range.max)) {
    throw invalidArgumentError({
      method,
      argument: 'value',
      expectation: `a number from ${range.min} to ${range.max} for property ${JSON.stringify(property)}`,
      value,
    })
  }
  return value
}

/**
 * The clip-relative frame, or the documented error: `INVALID_ARGUMENT` when it
 * is not an integer >= 0 and `CONFLICT` when it lies outside the clip.
 */
function requireClipFrame(
  value: unknown,
  clip: TimelineItem,
  method: string,
  argument = 'frame',
): Frame {
  const frame = requireFrame(value, argument, method)
  if (frame >= clip.durationInFrames) {
    throw studioError({
      code: 'CONFLICT',
      method,
      argument,
      message:
        `frame ${frame} is outside clip ${JSON.stringify(clip.id)} ` +
        `(frames 0..${clip.durationInFrames - 1} are inside it)`,
      entity: { kind: 'clip', id: clip.id },
      hint: 'A keyframe frame is relative to the start of its clip.',
    })
  }
  return frame
}

/**
 * `CONFLICT` when the frame falls in a transition region: the keyframe store
 * silently refuses such a keyframe (`keyframe-actions.ts:43-46`), so the SDK
 * says why instead.
 */
function requireOutsideTransitions(
  frame: Frame,
  clip: TimelineItem,
  method: string,
  argument = 'frame',
): void {
  const blocked = isFrameInTransitionRegion(
    frame,
    clip.id,
    clip,
    useTransitionsStore.getState().transitions,
  )
  if (!blocked) return
  const position = blocked.role === 'outgoing' ? 'end' : 'start'
  throw studioError({
    code: 'CONFLICT',
    method,
    argument,
    message:
      `frame ${frame} is inside the transition region ${blocked.start}..${blocked.end - 1} ` +
      `at the ${position} of clip ${JSON.stringify(clip.id)} ` +
      `(transition ${JSON.stringify(blocked.transition.id)})`,
    entity: { kind: 'clip', id: clip.id },
    hint: 'Keyframes cannot sit in a transition region; pick a frame outside it.',
  })
}

/** The patch's fields as keyframe updates, validating each one that is present. */
function patchUpdates(
  clip: TimelineItem,
  property: AnimatableProperty,
  patch: KeyframePatch,
  method: string,
): Partial<Omit<Keyframe, 'id'>> {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw invalidArgumentError({
      method,
      argument: 'patch',
      expectation: 'an object with value, easing or frame',
      value: patch,
    })
  }
  const updates: Partial<Omit<Keyframe, 'id'>> = {}
  if (patch.value !== undefined) {
    updates.value = requireValue(patch.value, property as KeyframeProperty, method)
  }
  if (patch.easing !== undefined) {
    updates.easing = requireEasing(patch.easing, method)
  }
  if (patch.frame !== undefined) {
    const frame = requireClipFrame(patch.frame, clip, method, 'patch.frame')
    requireOutsideTransitions(frame, clip, method, 'patch.frame')
    updates.frame = frame
  }
  return updates
}

/** Properties of a clip that can be animated, in the editor's order. */
function properties(clip: ClipId): KeyframeProperty[] {
  const item = requireKeyframesClip(clip, METHODS.properties)
  return getAnimatablePropertiesForItem(item)
}

/** Keyframes of a clip, optionally of one property, in frame order. */
function list(clip: ClipId, property?: KeyframeProperty): KeyframeInfo[] {
  const item = requireKeyframesClip(clip, METHODS.list)
  const keyframes = keyframesOf(item)
  return keyframes
    .filter((keyframe) => property === undefined || keyframe.property === property)
    .sort((left, right) => left.frame - right.frame)
}

/** Add a keyframe at a clip-relative frame. One undo step. */
function add(
  clip: ClipId,
  property: KeyframeProperty,
  frame: Frame,
  value: number,
  easing?: Easing,
): KeyframeId {
  const item = requireKeyframesClip(clip, METHODS.add)
  const animatable = requireAnimatableProperty(item, property, METHODS.add)
  const at = requireClipFrame(frame, item, METHODS.add)
  requireOutsideTransitions(at, item, METHODS.add)
  const keyframeValue = requireValue(value, animatable, METHODS.add)
  const easingType = easing === undefined ? undefined : requireEasing(easing, METHODS.add)

  const { value: id } = transaction('KEYFRAMES_ADD', () => {
    const created = addKeyframe(item.id, animatable, at, keyframeValue, easingType)
    if (!created) {
      throw studioError({
        code: 'CONFLICT',
        method: METHODS.add,
        argument: 'frame',
        message: `frame ${at} cannot receive a keyframe on clip ${JSON.stringify(item.id)}`,
        entity: { kind: 'clip', id: item.id },
        hint: 'A keyframe cannot sit in a transition region.',
      })
    }
    return created
  })
  return id
}

/** Change a keyframe's value, easing or frame. One undo step. */
function update(clip: ClipId, keyframe: KeyframeId, patch: KeyframePatch): void {
  const item = requireKeyframesClip(clip, METHODS.update)
  const found = requireKeyframe(item, keyframe, METHODS.update)
  const updates = patchUpdates(item, found.property, patch, METHODS.update)

  transaction('KEYFRAMES_UPDATE', () => {
    // An empty update would still replace the keyframe arrays, so it would
    // commit an undo entry that changes nothing: leave the store alone.
    if (Object.keys(updates).length === 0) return
    updateKeyframe(item.id, found.property, found.keyframe.id, updates)
  })
}

/** Remove one keyframe. One undo step. */
function remove(clip: ClipId, keyframe: KeyframeId): void {
  const item = requireKeyframesClip(clip, METHODS.remove)
  const found = requireKeyframe(item, keyframe, METHODS.remove)

  transaction('KEYFRAMES_REMOVE', () => {
    removeKeyframe(item.id, found.property, found.keyframe.id)
  })
}

/** Remove every keyframe of a clip, or of one property. One undo step. */
function removeAll(clip: ClipId, property?: KeyframeProperty): void {
  const item = requireKeyframesClip(clip, METHODS.removeAll)

  transaction('KEYFRAMES_REMOVE_ALL', () => {
    if (property === undefined) {
      if (hasAnyKeyframe(item)) removeKeyframesForItem(item.id)
      return
    }
    // No lane for this property: the action would still replace the keyframe
    // arrays and so commit an undo entry that changes nothing.
    const keyframes = keyframesOf(item)
    if (!keyframes.some((keyframe) => keyframe.property === property)) return
    removeKeyframesForProperty(item.id, property as AnimatableProperty)
  })
}

/**
 * `studio.keyframes`, over `useKeyframesStore` and the keyframe actions.
 * @example createKeyframesApi().list('c1', 'opacity')
 */
export function createKeyframesApi(): KeyframesApi {
  return { properties, list, add, update, remove, removeAll }
}
