/**
 * `studio.transitions`: transitions at the cuts of the active context
 * (design §4.2, §4.5).
 *
 * A transition sits on the cut between two adjacent clips of one track and
 * consumes the clips' hidden source handles; adding, changing or removing one
 * never moves a clip. The namespace reads the transitions store, validates a
 * cut with `canAddTransition` — the function the transitions panel uses — so a
 * refused edit carries the store's own reason, and writes through the actions
 * the panel calls. `add` with a `timing` creates the transition and sets its
 * timing inside one transaction, because the store's `addTransition` action
 * takes no timing.
 */

import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { transitionRegistry } from '@/shared/timeline/transitions'
import {
  addTransition,
  removeTransition,
  updateTransition,
} from '@/features/timeline/stores/actions/transition-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { canAddTransition } from '@/features/timeline/utils/transition-utils'
import { requireClip, requireTransition } from '../context'
import { invalidArgumentError, studioError, type StudioError } from '../errors'
import { transaction } from '../transaction'
import type { TransitionAddInput, TransitionInfo, TransitionPatch, TransitionsApi } from '../types'

/** The fields the store's `updateTransition` action accepts. */
type TransitionUpdates = Parameters<typeof updateTransition>[1]

/** The project frame rate, which the handle arithmetic is measured against. */
function timelineFps(): number {
  return useTimelineSettingsStore.getState().fps
}

/**
 * The presentation's own default length, or `undefined` when the caller named
 * no presentation and the store's default applies.
 */
function presentationDefaultDuration(presentation: string | undefined): number | undefined {
  if (presentation === undefined) return undefined
  return transitionRegistry.getDefinition(presentation)?.defaultDuration
}

/** Reject a presentation id the registry does not know, listing the valid ones. */
function requirePresentation(presentation: string, method: string): void {
  if (transitionRegistry.has(presentation)) return
  throw invalidArgumentError({
    method,
    argument: 'presentation',
    expectation: 'a known transition presentation id',
    value: presentation,
    valid: transitionRegistry.getIds(),
    validSource: 'studio.transitions.presentations()',
  })
}

/**
 * The store's timing values, keyed so a timing added to `TransitionTiming`
 * without a line here fails `vp run check` instead of being rejected silently.
 */
const TIMINGS = Object.keys({
  linear: true,
  'ease-in': true,
  'ease-out': true,
  'ease-in-out': true,
  'cubic-bezier': true,
} satisfies Record<Transition['timing'], true>)

/**
 * The store's direction values, keyed so a direction added to the store's
 * union without a line here fails `vp run check`.
 */
const DIRECTIONS = Object.keys({
  'from-left': true,
  'from-right': true,
  'from-top': true,
  'from-bottom': true,
} satisfies Record<NonNullable<Transition['direction']>, true>)

/** Reject a timing the store does not have, listing the valid ones. */
function requireTiming(timing: string, method: string): void {
  if (TIMINGS.some((candidate) => candidate === timing)) return
  throw invalidArgumentError({
    method,
    argument: 'timing',
    expectation: 'a known transition timing',
    value: timing,
    valid: TIMINGS,
  })
}

/** Reject a direction the store does not have, listing the valid ones. */
function requireDirection(direction: string, method: string): void {
  if (DIRECTIONS.some((candidate) => candidate === direction)) return
  throw invalidArgumentError({
    method,
    argument: 'direction',
    expectation: 'a known transition direction',
    value: direction,
    valid: DIRECTIONS,
  })
}

/** Reject an alignment outside the cut-relative 0..1 the store clamps to. */
function requireAlignment(alignment: number, method: string): void {
  if (Number.isFinite(alignment) && alignment >= 0 && alignment <= 1) return
  throw invalidArgumentError({
    method,
    argument: 'alignment',
    expectation: 'a number between 0 and 1',
    value: alignment,
  })
}

/** Reject a length that is not a whole positive frame count. */
function requireDurationInFrames(durationInFrames: number, method: string): void {
  if (Number.isInteger(durationInFrames) && durationInFrames >= 1) return
  throw invalidArgumentError({
    method,
    argument: 'durationInFrames',
    expectation: 'an integer frame >= 1',
    value: durationInFrames,
  })
}

/** One transition as plain JSON, copied field by field. */
function toTransitionInfo(transition: Transition): TransitionInfo {
  return {
    id: transition.id,
    type: transition.type,
    presentation: transition.presentation,
    timing: transition.timing,
    leftClipId: transition.leftClipId,
    rightClipId: transition.rightClipId,
    trackId: transition.trackId,
    durationInFrames: transition.durationInFrames,
    ...(transition.direction !== undefined && { direction: transition.direction }),
    ...(transition.alignment !== undefined && { alignment: transition.alignment }),
    ...(transition.bezierPoints !== undefined && {
      bezierPoints: { ...transition.bezierPoints },
    }),
    ...(transition.presetId !== undefined && { presetId: transition.presetId }),
    ...(transition.properties !== undefined && {
      properties: structuredClone(transition.properties),
    }),
  }
}

/** The CONFLICT for a cut that cannot take a transition, with its reason. */
function conflictAtCut(left: string, right: string, reason: string | undefined): StudioError {
  const detail = reason === undefined ? '' : `: ${reason}`
  return studioError({
    code: 'CONFLICT',
    method: 'transitions.add',
    message:
      `the cut between clips ${JSON.stringify(left)} and ${JSON.stringify(right)} ` +
      `cannot take a transition${detail}`,
    hint: 'Trim or move the clips to give the cut one shared track, adjacency and source handle.',
  })
}

/** The CONFLICT for a cut that already carries a transition. */
function conflictWithExisting(left: string, right: string, id: string): StudioError {
  return studioError({
    code: 'CONFLICT',
    method: 'transitions.add',
    message:
      `a transition already exists between clips ${JSON.stringify(left)} and ` +
      `${JSON.stringify(right)}`,
    entity: { kind: 'transition', id },
    hint:
      'Change it with studio.transitions.update(...) or remove it with ' +
      'studio.transitions.remove(...).',
  })
}

/**
 * Create the transition and return its id, after the checks the store only
 * logs: a cut that already has a transition, or that cannot take one, is a
 * `CONFLICT` with the validator's reason.
 */
function addAtCut(left: TimelineItem, right: TimelineItem, input: TransitionAddInput): string {
  const existing = useTransitionsStore
    .getState()
    .transitions.find(
      (candidate) => candidate.leftClipId === left.id && candidate.rightClipId === right.id,
    )
  if (existing) throw conflictWithExisting(left.id, right.id, existing.id)

  // The action clamps the requested length to the handles, so one frame is
  // exactly "can this cut hold any transition at all"; probing the requested
  // length would refuse a cut the action would have shortened to fit.
  const validation = canAddTransition(left, right, 1, input.alignment, timelineFps())
  if (!validation.canAdd) throw conflictAtCut(left.id, right.id, validation.reason)

  const known = new Set(useTransitionsStore.getState().transitions.map(({ id }) => id))
  const added = addTransition(
    left.id,
    right.id,
    'crossfade',
    input.durationInFrames ?? presentationDefaultDuration(input.presentation),
    input.presentation,
    input.direction,
    input.alignment,
  )
  if (!added) throw conflictAtCut(left.id, right.id, undefined)

  const created = useTransitionsStore.getState().transitions.find(({ id }) => !known.has(id))
  if (!created) {
    throw studioError({
      code: 'INTERNAL',
      method: 'transitions.add',
      message: 'the store accepted the transition but it is not in the transitions list',
    })
  }
  return created.id
}

/** The fields a patch names; an absent field is left as it is. */
function pickUpdates(patch: TransitionPatch): TransitionUpdates {
  return {
    ...(patch.presentation !== undefined && { presentation: patch.presentation }),
    ...(patch.durationInFrames !== undefined && {
      durationInFrames: patch.durationInFrames,
    }),
    ...(patch.timing !== undefined && { timing: patch.timing }),
    ...(patch.direction !== undefined && { direction: patch.direction }),
    ...(patch.alignment !== undefined && { alignment: patch.alignment }),
  }
}

/**
 * Throw the CONFLICT the store would only log: the patched transition must
 * still fit the handles around its cut, as `_validateAndUpdateTransition`
 * checks before it writes.
 */
function requireFittingHandles(transition: Transition, updates: TransitionUpdates): void {
  const items = useItemsStore.getState().items
  const left = items.find((item) => item.id === transition.leftClipId)
  const right = items.find((item) => item.id === transition.rightClipId)
  if (!left || !right) return

  const next = { ...transition, ...updates }
  const validation = canAddTransition(
    left,
    right,
    next.durationInFrames,
    next.alignment,
    timelineFps(),
  )
  if (validation.canAdd) return

  const reason = validation.reason ?? 'the cut cannot hold the transition'
  throw studioError({
    code: 'CONFLICT',
    method: 'transitions.update',
    message: `transition ${JSON.stringify(transition.id)} cannot take those values: ${reason}`,
    entity: { kind: 'transition', id: transition.id },
    hint: 'Shorten the transition, change its alignment, or give the clips more source handle.',
  })
}

/**
 * The `studio.transitions` namespace: transitions at the cuts of the active
 * context (design §4.2, §4.5). Writes go through the transitions panel's own
 * actions, so every call is one undo step the panel could have made.
 * @example const transitions = createTransitionsApi()
 */
export function createTransitionsApi(): TransitionsApi {
  return {
    presentations: () => transitionRegistry.getIds(),

    list: () => useTransitionsStore.getState().transitions.map(toTransitionInfo),

    add(input) {
      return transaction('TRANSITIONS_ADD', () => {
        const left = requireClip(input.left, 'transitions.add', 'left')
        const right = requireClip(input.right, 'transitions.add', 'right')
        if (input.presentation !== undefined) {
          requirePresentation(input.presentation, 'transitions.add')
        }
        if (input.durationInFrames !== undefined) {
          requireDurationInFrames(input.durationInFrames, 'transitions.add')
        }
        if (input.timing !== undefined) requireTiming(input.timing, 'transitions.add')
        if (input.direction !== undefined) requireDirection(input.direction, 'transitions.add')
        if (input.alignment !== undefined) requireAlignment(input.alignment, 'transitions.add')
        const id = addAtCut(left, right, input)
        if (input.timing !== undefined) {
          updateTransition(id, { timing: input.timing })
        }
        return id
      }).value
    },

    update(id, patch) {
      transaction('TRANSITIONS_UPDATE', () => {
        const transition = requireTransition(id, 'transitions.update', 'id')
        if (patch.presentation !== undefined) {
          requirePresentation(patch.presentation, 'transitions.update')
        }
        if (patch.durationInFrames !== undefined) {
          requireDurationInFrames(patch.durationInFrames, 'transitions.update')
        }
        if (patch.timing !== undefined) requireTiming(patch.timing, 'transitions.update')
        if (patch.direction !== undefined) {
          requireDirection(patch.direction, 'transitions.update')
        }
        if (patch.alignment !== undefined) requireAlignment(patch.alignment, 'transitions.update')
        const updates = pickUpdates(patch)
        // `_updateTransition` replaces the transition object even for an empty
        // patch, so calling it would record an undo step that changed nothing.
        if (Object.keys(updates).length === 0) return
        requireFittingHandles(transition, updates)
        updateTransition(id, updates)
      })
    },

    remove(id) {
      transaction('TRANSITIONS_REMOVE', () => {
        requireTransition(id, 'transitions.remove', 'id')
        removeTransition(id)
      })
    },
  }
}
