/**
 * The colour profile, look and stabilization methods of `studio.clips` (plan decision D7): the clip panel's
 * own sections, reached by an agent through the same store actions the sections call.
 */

import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { ColorProfileId } from '@/studio/color/types'
import { updateClipsTogether } from '@/studio/presets/batch-update'
import { useLooksStore } from '@/studio/looks/store'
import { DEFAULT_LOOK_INTENSITY } from '@/studio/looks/types'
import { NoLensProfileError, NoMotionDataError } from '@/studio/stabilization/client'
import { type SmoothingMethod, type StabilizationSettings } from '@/studio/stabilization/settings'
import {
  applyChange,
  FRAMING_SLIDER_RANGE,
  HORIZON_LOCK_PERCENT_RANGE,
  HORIZON_LOCK_ROLL_RANGE,
  smoothnessParameter,
  type StabilizationChange,
} from '@/studio/stabilization/ui/changes'
import { pageEngine } from '@/studio/stabilization/ui/engine'
import { openStabilization, storeStabilization } from '@/studio/stabilization/ui/switch'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { requireClip } from '../context'
import { invalidArgumentError, StudioError, studioError } from '../errors'
import { transaction } from '../transaction'
import type {
  ClipId,
  ClipLookInfo,
  ClipLookRequest,
  ClipStabilization,
  ColorProfile,
  StabilizationPatch,
} from '../types'

const PROFILES: readonly ColorProfile[] = ['dlog-m', 'dlog', 'none']

/**
 * The video clip a grade method works on.
 * @throws NOT_FOUND when no clip has that id
 * @throws UNSUPPORTED when the clip is not a video clip
 */
function requireVideoClip(id: ClipId, method: string): VideoItem {
  const item: TimelineItem = requireClip(id, method, 'id')
  if (item.type === 'video') return item
  throw studioError({
    code: 'UNSUPPORTED',
    method,
    message: `a clip of kind "${item.type}" has no such setting`,
    entity: { kind: 'clip', id },
    hint: 'Colour profile, look and stabilization are for video clips.',
  })
}

/** A clip's colour profile, or null when unset. */
export function getColorProfile(id: ClipId): ColorProfile | null {
  return requireVideoClip(id, 'clips.getColorProfile').inputColor ?? null
}

/** Write a colour profile, or clear it with null, as one undo step. */
export function setColorProfile(id: ClipId, profile: ColorProfile | null): void {
  requireVideoClip(id, 'clips.setColorProfile')
  if (profile !== null && !PROFILES.includes(profile)) {
    throw invalidArgumentError({
      method: 'clips.setColorProfile',
      argument: 'profile',
      expectation: 'null, "dlog-m", "dlog" or "none"',
      value: profile,
      valid: PROFILES,
    })
  }
  transaction('CLIPS_SET_COLOR_PROFILE', () =>
    updateClipsTogether('SET_COLOR_PROFILE', [
      { id, updates: { inputColor: (profile ?? undefined) as ColorProfileId | undefined } },
    ]),
  )
}

/** A clip's look, or null. */
export function getLook(id: ClipId): ClipLookInfo | null {
  const look = requireVideoClip(id, 'clips.getLook').look
  return look ? { id: look.id, intensity: look.intensity } : null
}

/** Apply a library look with a blend, or remove it with null, as one undo step. */
export async function setLook(id: ClipId, look: ClipLookRequest | null): Promise<void> {
  const method = 'clips.setLook'
  requireVideoClip(id, method)
  if (look === null) {
    transaction('CLIPS_SET_LOOK', () =>
      updateClipsTogether('SET_LOOK', [{ id, updates: { look: undefined } }]),
    )
    return
  }
  const shape = typeof look === 'object' && !Array.isArray(look) ? look : undefined
  const lookId = shape?.id
  if (typeof lookId !== 'string' || lookId.length === 0) {
    throw invalidArgumentError({
      method,
      argument: 'look',
      expectation: 'null, or an object with the id of a look of the library',
      value: look,
      validSource: 'studio.looks.list()',
    })
  }
  const intensity = shape?.intensity ?? DEFAULT_LOOK_INTENSITY
  if (
    typeof intensity !== 'number' ||
    !Number.isFinite(intensity) ||
    intensity < 0 ||
    intensity > 1
  ) {
    throw invalidArgumentError({
      method,
      argument: 'look.intensity',
      expectation: 'a number from 0 to 1',
      value: shape?.intensity,
    })
  }
  // The library is read here, not assumed: a reopened app has not listed it yet.
  await useLooksStore.getState().load()
  requireVideoClip(id, method) // the clip may have gone while the library was read
  const library = useLooksStore.getState()
  if (library.status !== 'ready') {
    throw studioError({
      code: 'INTERNAL',
      method,
      argument: 'look',
      message: 'the looks library could not be read from the workspace',
      hint: 'Open a workspace folder in the app; the library lives in it.',
    })
  }
  if (!library.looks.some((entry) => entry.id === lookId)) {
    throw invalidArgumentError({
      method,
      argument: 'look.id',
      expectation: 'the id of a look of the library',
      value: lookId,
      valid: library.looks.map((entry) => entry.id),
      validSource: 'studio.looks.list()',
    })
  }
  transaction('CLIPS_SET_LOOK', () =>
    updateClipsTogether('SET_LOOK', [{ id, updates: { look: { id: lookId, intensity } } }]),
  )
}

/** A clip's stored stabilization, or null. */
export function getStabilization(id: ClipId): ClipStabilization | null {
  const stored = requireVideoClip(id, 'clips.getStabilization').stabilization
  if (!stored) return null
  return {
    enabled: stored.enabled,
    method: stored.method,
    params: { ...stored.params },
    fov: stored.fov,
    horizonLockPercent: stored.horizonLockPercent,
    horizonLockRoll: stored.horizonLockRoll,
    adaptiveZoomSeconds: stored.adaptiveZoomSeconds,
    framingX: stored.framingX ?? 0,
    framingY: stored.framingY ?? 0,
  }
}

/** The patch fields, the change each makes and what each must be (the panel's own limits, `changes.ts`). */
const PATCH_FIELDS: Record<
  keyof StabilizationPatch,
  (settings: StabilizationSettings, methods: readonly SmoothingMethod[]) => string
> = {
  smoothness: (settings, methods) => {
    const range = smoothnessParameter(settings, methods)
    return `a number from ${range?.min ?? '-'} to ${range?.max ?? '-'}, the range the engine reports for the method`
  },
  fov: () => 'a number greater than 0',
  horizonLockPercent: () =>
    `a number from ${HORIZON_LOCK_PERCENT_RANGE.min} to ${HORIZON_LOCK_PERCENT_RANGE.max}`,
  horizonLockRoll: () =>
    `a number from ${HORIZON_LOCK_ROLL_RANGE.min} to ${HORIZON_LOCK_ROLL_RANGE.max}`,
  adaptiveZoomSeconds: () => 'a number of seconds, 0 or more',
  framingX: () => `a number from ${FRAMING_SLIDER_RANGE.min} to ${FRAMING_SLIDER_RANGE.max}`,
  framingY: () => `a number from ${FRAMING_SLIDER_RANGE.min} to ${FRAMING_SLIDER_RANGE.max}`,
}

/** The settings with every field of the patch applied, or the error naming the first one the panel would refuse. */
function applyPatch(
  settings: StabilizationSettings,
  patch: StabilizationPatch,
  methods: readonly SmoothingMethod[],
): StabilizationSettings {
  let next = settings
  for (const [key, value] of Object.entries(patch)) {
    const describe = Object.hasOwn(PATCH_FIELDS, key)
      ? PATCH_FIELDS[key as keyof StabilizationPatch]
      : undefined
    if (value === undefined) continue
    const changed = describe
      ? applyChange(next, { kind: key, value } as StabilizationChange, methods)
      : null
    if (!changed) {
      throw invalidArgumentError({
        method: 'clips.setStabilization',
        argument: `patch.${key}`,
        expectation: describe
          ? describe(settings, methods)
          : 'one of the fields of StabilizationPatch',
        value,
        valid: describe ? undefined : Object.keys(PATCH_FIELDS),
      })
    }
    next = changed
  }
  return next
}

/** What a failure of the engine is in the SDK's words. */
function engineFailure(error: unknown): never {
  if (error instanceof NoMotionDataError || error instanceof NoLensProfileError) {
    throw studioError({
      code: 'UNSUPPORTED',
      method: 'clips.setStabilization',
      message:
        error instanceof NoMotionDataError
          ? "the clip's file carries no motion data, so it cannot be stabilized"
          : 'the clip has no lens profile, so it cannot be stabilized',
      hint:
        error instanceof NoLensProfileError
          ? 'Load a Gyroflow lens profile for it in the clip panel.'
          : 'Stabilization needs a file recorded with gyro data.',
    })
  }
  if (error instanceof StudioError) throw error
  throw studioError({
    code: 'INTERNAL',
    method: 'clips.setStabilization',
    message: error instanceof Error ? error.message : String(error),
  })
}

/** Switch stabilization on with a patch (opening the clip first), off with null, or store a patch on a clip already on. */
export async function setStabilization(
  id: ClipId,
  patch: StabilizationPatch | null,
): Promise<void> {
  const method = 'clips.setStabilization'
  const item = requireVideoClip(id, method)
  if (patch !== null && (typeof patch !== 'object' || Array.isArray(patch))) {
    throw invalidArgumentError({
      method,
      argument: 'patch',
      expectation: 'null, or an object with fields of StabilizationPatch',
      value: patch,
    })
  }
  try {
    const current = item.stabilization
    if (patch === null) {
      if (!current?.enabled) return
      const applied = transaction('CLIPS_SET_STABILIZATION', () =>
        storeStabilization(pageEngine, item, { ...current, enabled: false }, true),
      )
      await applied.value
      return
    }
    if (current?.enabled) {
      const methods = await pageEngine.smoothingMethods()
      const next = applyPatch(current, patch, methods)
      // The same values again are not a change: no undo step and no recompute (as in the panel)
      // (the framing is not in the engine's key, so the whole settings are compared)
      if (JSON.stringify(next) === JSON.stringify(current)) return
      const applied = transaction('CLIPS_SET_STABILIZATION', () =>
        storeStabilization(pageEngine, requireVideoClip(id, method), next, false),
      )
      await applied.value
      return
    }
    const opened = await openStabilization(
      pageEngine,
      item,
      useTimelineSettingsStore.getState().fps,
      () => undefined,
      (settings, methods) => applyPatch(settings, patch, methods),
    )
    const applied = transaction('CLIPS_SET_STABILIZATION', () =>
      storeStabilization(pageEngine, requireVideoClip(id, method), opened.next, true),
    )
    await applied.value
  } catch (error) {
    engineFailure(error)
  }
}
