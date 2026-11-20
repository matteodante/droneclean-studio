// What the keyframe system (FreeCut's `features/keyframes`) asks about a clip's framing properties (task 11.23). The
// fork's hooks there call these two, so the clip's `stabilization` field is read here, in `src/studio/`, and nowhere in
// FreeCut's files (`predicates.guard.test.ts`).

import type { TimelineItem } from '@/types/timeline'

/** The properties, as the keyframe store names them: the clip's stored `framingX` and `framingY` are their values */
export type FramingPropertyName = 'framingX' | 'framingY'

/** Whether the clip offers the framing for animation: a video clip whose stabilization is on */
export function offersFramingKeyframes(item: TimelineItem): boolean {
  return item.type === 'video' && item.stabilization?.enabled === true
}

/** Whether a keyframe property is one of the two framing lanes */
export function isFramingProperty(property: string): property is FramingPropertyName {
  return property === 'framingX' || property === 'framingY'
}

/** The stored setting a property has where it has no keyframe (0 for a clip that has none stored) */
export function framingBaseValue(item: TimelineItem, property: FramingPropertyName): number {
  return item.type === 'video' ? (item.stabilization?.[property] ?? 0) : 0
}
