/**
 * `studio.clips.applySmoothEdit` (plan task 11.10): the reference look of the drone reels in one call.
 * It validates the options, then runs the same action as the speed panel's "Smooth ramp + zoom" button.
 */

import { canHoldSmoothEdit, smoothEditClip } from '@/studio/smooth-edit/action'
import {
  SMOOTH_EDIT_DEFAULTS,
  SMOOTH_EDIT_MIN_FRAMES,
  SMOOTH_EDIT_PEAK_RANGE,
  SMOOTH_EDIT_SLOW_RANGE,
  SMOOTH_EDIT_ZOOM_RANGE,
} from '@/studio/smooth-edit/curve'
import { requireClip } from '../context'
import { invalidArgumentError, studioError } from '../errors'
import { transaction } from '../transaction'
import type { ClipId, SmoothEditOptions, SmoothEditResult } from '../types'

const METHOD = 'clips.applySmoothEdit'

/** One option, when named: a finite number inside its range. */
function requireOption(
  options: Record<string, unknown>,
  name: 'peak' | 'slow' | 'zoom',
  range: { readonly min: number; readonly max: number },
): number {
  const value = options[name]
  if (value === undefined) return SMOOTH_EDIT_DEFAULTS[name]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) {
    throw invalidArgumentError({
      method: METHOD,
      argument: `options.${name}`,
      expectation: `a number from ${range.min} to ${range.max}`,
      value,
    })
  }
  return value
}

/**
 * Give a clip the smooth edit as one undo step.
 * @throws NOT_FOUND when no clip has that id
 * @throws UNSUPPORTED when the clip is not a video clip that holds a speed curve and motion blur
 * @throws INVALID_ARGUMENT when `options` is not an object or an option is outside its range
 * @throws CONFLICT when the clip is shorter than four frames, or a zoom was asked for and the clip's
 *   first or last frame is inside a transition
 */
export function applySmoothEdit(id: ClipId, options?: SmoothEditOptions): SmoothEditResult {
  const item = requireClip(id, METHOD, 'id')
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) {
    throw invalidArgumentError({
      method: METHOD,
      argument: 'options',
      expectation: 'an object with peak, slow and zoom, all optional',
      value: options,
    })
  }
  const given = (options ?? {}) as Record<string, unknown>
  const peak = requireOption(given, 'peak', SMOOTH_EDIT_PEAK_RANGE)
  const slow = requireOption(given, 'slow', SMOOTH_EDIT_SLOW_RANGE)
  const zoom = requireOption(given, 'zoom', SMOOTH_EDIT_ZOOM_RANGE)

  if (item.durationInFrames < SMOOTH_EDIT_MIN_FRAMES && item.type === 'video') {
    throw studioError({
      code: 'CONFLICT',
      method: METHOD,
      argument: 'id',
      message: `clip ${JSON.stringify(id)} is ${item.durationInFrames} frames long; the smooth edit needs at least ${SMOOTH_EDIT_MIN_FRAMES}`,
      entity: { kind: 'clip', id },
    })
  }
  if (!canHoldSmoothEdit(item)) {
    throw studioError({
      code: 'UNSUPPORTED',
      method: METHOD,
      message:
        item.isReversed === true
          ? 'a reversed clip cannot have a speed curve'
          : `a clip of kind "${item.type}" cannot take the smooth edit`,
      entity: { kind: 'clip', id },
      hint: 'The smooth edit is for video clips that are not reversed or a composition wrapper.',
    })
  }

  const { value: result } = transaction('CLIPS_APPLY_SMOOTH_EDIT', () => {
    const applied = smoothEditClip(id, { peak, slow, zoom })
    if (applied === undefined) {
      throw studioError({
        code: 'CONFLICT',
        method: METHOD,
        message: `the speed curve of clip ${JSON.stringify(id)} could not be fitted`,
        entity: { kind: 'clip', id },
      })
    }
    if (applied.zoomBlocked) {
      throw studioError({
        code: 'CONFLICT',
        method: METHOD,
        argument: 'options.zoom',
        message: `the zoom keyframes of clip ${JSON.stringify(id)} cannot sit in a transition region at its first or last frame`,
        entity: { kind: 'clip', id },
        hint: 'Pass zoom: 0 to apply the speed curve and the blur without a zoom.',
      })
    }
    return applied
  })
  const { keys, averageSpeed, durationInFrames, motionBlur, zoom: zoomed } = result
  return { speedCurve: keys, averageSpeed, durationInFrames, motionBlur, zoom: zoomed }
}
