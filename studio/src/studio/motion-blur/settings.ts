/**
 * What a clip's `motionBlur` field may hold, and which clips may carry it (design 7.2, sections 4.7 and 4.8; design
 * 9.2, section 7).
 *
 * The store's normaliser, the panel and the SDK all ask here, so a hand-edited project file, a slider and a script agree
 * on the shutter's range and on the clips the blur belongs to.
 */

import type { TimelineItem } from '@/types/timeline'
import type { FlowDetail, FlowEdges, MotionBlurSettings, ShutterDegrees, SmoothSlowMotion } from './types'

/** The largest shutter, in degrees: the whole interval between two output frames (RSMB's Blur Amount 1). */
export const MAX_SHUTTER_DEGREES = 360

/**
 * The shutter a new switch starts at and an unknown stored value falls back to: 180 degrees, RSMB's 0.5 (Matteo, 20 Nov
 * 2026, design 9.2 section 0).
 */
export const DEFAULT_SHUTTER_DEGREES: ShutterDegrees = 180

/** The panel's amount slider, in RSMB's units (degrees / 360): its step; it runs from 0 to 1. */
export const AMOUNT_STEP = 0.05

/**
 * Whether a value is a shutter the clip takes: a finite number in [0, 360]. 0 is no blur at all, for a clip that wants
 * smooth slow motion alone (Matteo, 20 Nov 2026: Twixtor without a smear); every pixel is then drawn as it is.
 */
export function isShutterDegrees(value: unknown): value is ShutterDegrees {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_SHUTTER_DEGREES
}

/** A shutter as RSMB's Blur Amount: degrees / 360. */
export function amountOfShutter(degrees: ShutterDegrees): number {
  return degrees / MAX_SHUTTER_DEGREES
}

/**
 * The shutter of a slider's amount: the amount snapped to the slider's step, kept in [0, 1], times 360. Snapping keeps
 * the stored degrees a whole multiple of 18 for any value the slider can give; 0 is no blur.
 */
export function shutterOfAmount(amount: number): ShutterDegrees {
  const stepsInOne = Math.round(1 / AMOUNT_STEP)
  const steps = Math.min(Math.max(Math.round(amount * stepsInOne), 0), stepsInOne)
  return (steps * MAX_SHUTTER_DEGREES) / stepsInOne
}

/** The ways smooth slow motion can make a frame, in the order the panel's select lists them after "Off". */
export const SMOOTH_SLOW_MOTION: readonly SmoothSlowMotion[] = ['blend', 'optical-flow']

/** Whether a value is one of the smooth slow motion modes. */
export function isSmoothSlowMotion(value: unknown): value is SmoothSlowMotion {
  return SMOOTH_SLOW_MOTION.some((mode) => mode === value)
}

/** The optical flow's motion detail, the default first (design 11.24): the order the panel's select lists them. */
export const FLOW_DETAILS: readonly FlowDetail[] = ['normal', 'high']

/** The optical flow's hard edges, the default first (design 11.24): the order the panel's select lists them. */
export const FLOW_EDGES: readonly FlowEdges[] = ['mix', 'nearest']

/** Whether a value is one of the optical flow's motion details. */
export function isFlowDetail(value: unknown): value is FlowDetail {
  return FLOW_DETAILS.some((detail) => detail === value)
}

/** Whether a value is one of the optical flow's hard edges choices. */
export function isFlowEdges(value: unknown): value is FlowEdges {
  return FLOW_EDGES.some((edges) => edges === value)
}

/**
 * The optical flow's two settings as a clip keeps them: only with smooth slow motion by optical flow, and only a value
 * that is not the default (`'normal'`, `'mix'`), so a clip that never touched them stores and renders as before.
 */
export function flowSettingsOf(
  smoothSlowMotion: SmoothSlowMotion | undefined,
  value: { flowDetail?: unknown; flowEdges?: unknown },
): Pick<MotionBlurSettings, 'flowDetail' | 'flowEdges'> {
  if (smoothSlowMotion !== 'optical-flow') return {}
  return {
    ...(isFlowDetail(value.flowDetail) && value.flowDetail !== FLOW_DETAILS[0] ? { flowDetail: value.flowDetail } : {}),
    ...(isFlowEdges(value.flowEdges) && value.flowEdges !== FLOW_EDGES[0] ? { flowEdges: value.flowEdges } : {}),
  }
}

/**
 * The stored smooth slow motion mode: a known `smoothSlowMotion`, else the field it replaced, `blendSlowMotion: true`
 * (projects saved on 19 Nov 2026, before the optical-flow mode), as `'blend'`, so an old project keeps its mode. The old
 * field is never written back.
 */
function storedSmoothSlowMotion(value: { smoothSlowMotion?: unknown; blendSlowMotion?: unknown }): SmoothSlowMotion | undefined {
  if (isSmoothSlowMotion(value.smoothSlowMotion)) return value.smoothSlowMotion
  return value.blendSlowMotion === true ? 'blend' : undefined
}

/**
 * A stored `motionBlur` value made safe for the renderer: an object with a missing shutter, or one outside (0, 360],
 * falls to 180 (design 9.2, section 0), an unknown smooth slow motion mode is none, an optical-flow setting that is
 * unknown, the default or without optical flow is dropped, anything that is not an object is no blur. A hand-edited
 * file can therefore never put a broken number in front of a shader.
 */
function normalizeMotionBlur(value: unknown): MotionBlurSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const stored = value as {
    shutterDegrees?: unknown
    smoothSlowMotion?: unknown
    blendSlowMotion?: unknown
    flowDetail?: unknown
    flowEdges?: unknown
  }
  const smoothSlowMotion = storedSmoothSlowMotion(stored)
  return {
    shutterDegrees: isShutterDegrees(stored.shutterDegrees) ? stored.shutterDegrees : DEFAULT_SHUTTER_DEGREES,
    // Only a known mode turns smooth slow motion on; anything else is the hold, and is not written back.
    ...(smoothSlowMotion !== undefined ? { smoothSlowMotion } : {}),
    // The optical flow's settings: known, not the default, and only with optical flow (design 11.24)
    ...flowSettingsOf(smoothSlowMotion, stored),
  }
}

/**
 * Whether a clip can carry motion blur: a video clip that is not reversed and not a composition
 * wrapper (design 7.2, section 4.8). The panel hides the controls and the SDK answers
 * `UNSUPPORTED` for any other clip.
 */
export function canHoldMotionBlur(item: TimelineItem): boolean {
  return item.type === 'video' && item.isReversed !== true && item.compositionId === undefined
}

/**
 * A clip's motion blur made safe on every store write: a shutter outside (0, 360] falls to 180, and a value that is not
 * an object, or the undefined a switch-off leaves, is removed. It lives here so the store's normaliser reads no clip
 * field itself (`predicates.guard.test.ts`).
 */
export function normalizeMotionBlurField(item: TimelineItem): void {
  const carrier = item as { motionBlur?: unknown }
  if (!('motionBlur' in carrier)) return
  const normalized = normalizeMotionBlur(carrier.motionBlur)
  if (normalized === undefined) {
    delete carrier.motionBlur
  } else {
    carrier.motionBlur = normalized
  }
}
