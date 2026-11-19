import type { ShapeItem, SubtitleSegmentItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { MaskVertex } from '@/types/masks'
import {
  constantSpeed,
  normalizeSourceRemainder,
  normalizeSpeedCurve,
  speedOfCurve,
} from '@/studio/speed'
import { normalizeMotionBlurField } from '@/studio/motion-blur'
import { normalizeAudioEqSettings } from '@/shared/utils/audio-eq'
import { resolveCornerPinTargetRect } from '@/features/timeline/deps/composition-runtime'
import {
  applyOptionalClamps,
  roundDuration,
  roundFrame,
  roundOptionalFrame,
  normalizeOptionalFps,
} from '@/shared/timeline/item-clamps'

export { roundFrame, roundDuration, roundOptionalFrame, normalizeOptionalFps }

const MIN_ENABLED_STROKE_WIDTH = 1

function clampShapePercent(value: number | undefined, max = 100): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.min(max, value))
}

function resolveCornerPinReferenceDimension(
  existing: number | undefined,
  measured: number,
): number | undefined {
  if (existing !== undefined) return existing
  return measured > 0 ? measured : undefined
}

function normalizeCornerPinReference(item: TimelineItem): void {
  if (!item.cornerPin) return
  const targetRect = resolveCornerPinTargetRect(
    item.transform?.width ?? 0,
    item.transform?.height ?? 0,
    item.type === 'video' || item.type === 'image'
      ? {
          sourceWidth: item.sourceWidth,
          sourceHeight: item.sourceHeight,
          crop: item.crop,
        }
      : undefined,
  )
  item.cornerPin = {
    ...item.cornerPin,
    referenceWidth: resolveCornerPinReferenceDimension(
      item.cornerPin.referenceWidth,
      targetRect.width,
    ),
    referenceHeight: resolveCornerPinReferenceDimension(
      item.cornerPin.referenceHeight,
      targetRect.height,
    ),
  }
}

function resolvePathTangentMode(vertex: MaskVertex): MaskVertex['tangentMode'] {
  if (vertex.tangentMode) return vertex.tangentMode
  const hasNoHandles =
    vertex.inHandle[0] === 0 &&
    vertex.inHandle[1] === 0 &&
    vertex.outHandle[0] === 0 &&
    vertex.outHandle[1] === 0
  return hasNoHandles ? 'corner' : 'smooth'
}

function applyPathStrokeDefaults(item: ShapeItem): void {
  item.strokeEnabled ??= true
  item.strokeLineCap ??= 'butt'
  item.strokeLineJoin ??= 'miter'
  item.strokeMiterLimit ??= 4
}

function normalizePathShapeFields(item: ShapeItem): void {
  if (item.shapeType !== 'path') return
  item.pathClosed = item.isMask ? true : (item.pathClosed ?? true)
  if (item.pathClosed === false) item.fillEnabled = false
  else item.fillEnabled ??= true
  applyPathStrokeDefaults(item)
  item.pathVertices = item.pathVertices?.map((vertex) => ({
    ...vertex,
    tangentMode: resolvePathTangentMode(vertex),
  }))
}

function normalizeShapeFields(item: ShapeItem): void {
  item.taperStartWidth = clampShapePercent(item.taperStartWidth, 200)
  item.taperEndWidth = clampShapePercent(item.taperEndWidth, 200)
  item.taperStartLength = clampShapePercent(item.taperStartLength)
  item.taperEndLength = clampShapePercent(item.taperEndLength)
  normalizePathShapeFields(item)
  if (item.strokeEnabled === true && (item.strokeWidth ?? 0) < MIN_ENABLED_STROKE_WIDTH) {
    item.strokeWidth = MIN_ENABLED_STROKE_WIDTH
  }
  if (item.isMask) item.blendMode = 'normal'
}

function normalizeLegacySourceStart(item: TimelineItem): void {
  if (
    (item.type === 'video' || item.type === 'audio') &&
    item.sourceEnd !== undefined &&
    item.sourceStart === undefined
  ) {
    item.sourceStart = 0
  }
}

/**
 * The speed curve's invariants on every write (design 7.1, 4.1): the keys are pinned to the
 * clip's duration and the clip's `speed` becomes the curve's average, so every length
 * calculation (`timelineToSourceFrames`, trims, ripples, the schema) returns the curve's
 * source span without knowing about curves. A curve the normaliser cannot repair is dropped
 * and `speed` is left as it was.
 *
 * A curve that holds one speed is that speed (review finding T6): it is stored as no curve and
 * that speed, so the preview and the export both play it as the clip of one speed, pitch kept.
 *
 * A reversed clip's curve is dropped here, not repaired: v1 hides a curve on a reversed clip
 * (its source mapping runs backwards, design 7.1, section 4.6) and the render path ignores the
 * field there, so the clip keeps its constant `speed` — the average the curve last wrote.
 */
function normalizeSpeedCurveFields(item: TimelineItem): void {
  const curve = item.speedCurve
  if (curve === undefined) {
    delete item.speedCurve
    return
  }
  const normalized =
    item.isReversed === true ? undefined : normalizeSpeedCurve(curve, item.durationInFrames)
  if (normalized === undefined || constantSpeed(normalized) !== undefined) {
    delete item.speedCurve
    if (normalized !== undefined) item.speed = speedOfCurve(normalized)
    return
  }
  item.speedCurve = normalized
  item.speed = speedOfCurve(normalized)
}

/**
 * The cut's remainder (design 7.1, section 4.6; review finding T4): kept on a forward video or
 * audio clip of a media source as a reduced fraction in `[0, 1)` — an old project's double read
 * as the nearest fraction up to 1,000,000 — and dropped everywhere else: a reversed clip's
 * mapping runs backwards, and a composition's time is not source frames.
 */
function normalizeSourceFrameOffsetField(item: TimelineItem): void {
  if (item.sourceFrameOffset === undefined) {
    delete item.sourceFrameOffset
    return
  }
  const mapped =
    (item.type === 'video' || item.type === 'audio') &&
    item.isReversed !== true &&
    item.compositionId === undefined
  const remainder = mapped ? normalizeSourceRemainder(item.sourceFrameOffset) : undefined
  if (remainder === undefined) {
    delete item.sourceFrameOffset
  } else {
    item.sourceFrameOffset = remainder
  }
}

export function normalizeFrameFields<T extends TimelineItem>(item: T): T {
  // Start from a shallow copy so the optional-clamp loop can rewrite fields
  // in place without mutating the caller's object.
  const normalized = { ...item } as Record<string, unknown>
  normalized.from = roundFrame(item.from)
  normalized.durationInFrames = roundDuration(item.durationInFrames)
  applyOptionalClamps(normalized)

  const result = normalized as TimelineItem
  normalizeSpeedCurveFields(result)
  normalizeMotionBlurField(result)
  normalizeSourceFrameOffsetField(result)
  normalizeCornerPinReference(result)
  if (result.type === 'shape') normalizeShapeFields(result)
  normalizeLegacySourceStart(result)
  return result as T
}

export function normalizeItemUpdates(updates: Partial<TimelineItem>): Partial<TimelineItem> {
  const normalized = { ...updates } as Record<string, unknown>

  if (normalized.from !== undefined) normalized.from = roundFrame(normalized.from as number)
  if (normalized.durationInFrames !== undefined) {
    normalized.durationInFrames = roundDuration(normalized.durationInFrames as number)
  }

  applyOptionalClamps(normalized)

  if (
    normalized.strokeEnabled === true &&
    typeof normalized.strokeWidth === 'number' &&
    normalized.strokeWidth < MIN_ENABLED_STROKE_WIDTH
  ) {
    normalized.strokeWidth = MIN_ENABLED_STROKE_WIDTH
  }

  // DroneClean: no `sourceStart = 0` back-fill here. A patch that sets only `sourceEnd` (a speed
  // curve edit does) leaves the clip's own start alone; a legacy end-only item still gets 0 from
  // `normalizeLegacySourceStart` once the patch is merged (`normalizeFrameFields`). In a patch the
  // back-fill moved every trimmed clip given a curve to the file's first frame (19 Nov 2026).

  return normalized as Partial<TimelineItem>
}

export function normalizeTrack(track: TimelineTrack): TimelineTrack {
  return {
    ...track,
    volume: track.volume === undefined ? undefined : Math.max(-60, Math.min(12, track.volume)),
    audioEq: normalizeAudioEqSettings(track.audioEq),
  }
}

/**
 * Trim a subtitle segment from its start: re-anchor every cue's time so the
 * new `from` becomes 0, dropping cues entirely before the new boundary and
 * clamping cues that straddle it.
 *
 * `clampedAmount` is in timeline frames — positive means trimming inward.
 */
export function trimSubtitleCuesAtStart(
  item: SubtitleSegmentItem,
  clampedAmount: number,
  timelineFps: number,
): { cues: SubtitleSegmentItem['cues'] } | null {
  if (clampedAmount === 0) return null
  const offsetSeconds = clampedAmount / timelineFps
  const nextCues: SubtitleSegmentItem['cues'] = []
  for (const cue of item.cues) {
    if (cue.endSeconds <= offsetSeconds) continue // entirely outside new window
    const startSeconds = Math.max(0, cue.startSeconds - offsetSeconds)
    const endSeconds = cue.endSeconds - offsetSeconds
    if (endSeconds <= startSeconds) continue
    nextCues.push({ ...cue, startSeconds, endSeconds })
  }
  return { cues: nextCues }
}

/**
 * Trim a subtitle segment from its end: drop cues past the new duration and
 * clamp cues that straddle the boundary.
 */
export function trimSubtitleCuesAtEnd(
  item: SubtitleSegmentItem,
  newDurationFrames: number,
  timelineFps: number,
): { cues: SubtitleSegmentItem['cues'] } | null {
  const newEndSeconds = newDurationFrames / timelineFps
  const nextCues: SubtitleSegmentItem['cues'] = []
  for (const cue of item.cues) {
    if (cue.startSeconds >= newEndSeconds) continue
    const endSeconds = Math.min(cue.endSeconds, newEndSeconds)
    if (endSeconds <= cue.startSeconds) continue
    nextCues.push({ ...cue, endSeconds })
  }
  return { cues: nextCues }
}
