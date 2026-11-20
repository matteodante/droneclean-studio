/**
 * `studio.clips`: the clips of the active editing context (design §4.2, §4.3).
 *
 * Reads return plain `ClipInfo` copies built field by field, never a store
 * object. Writes call the same store actions the editor's timeline calls, all
 * inside `transaction('CLIPS_<METHOD>')`, so a call that changes the timeline
 * is one undo entry and a rejected argument leaves the project untouched.
 *
 * Placement follows the editor's drop path: `clips.add` builds the item with
 * `buildDroppedMediaTimelineItem` and `addItem` places it. A drop that overlaps a clip
 * of its track is moved to the first free frame (`actions/item-placement.ts:28`); `clips.add`
 * does that only when asked (`onOverlap: 'move'`, and then it answers the frame it chose) and
 * otherwise throws CONFLICT, so a clip never lands somewhere the caller did not say.
 */

import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { TransformProperties } from '@/types/transform'
import {
  averageSpeed,
  isSpeedEase,
  SPEED_EASES,
  SPEED_PRESET_NAMES,
  speedAt as speedAtOnCurve,
  speedPresetCurve,
  type SpeedEase,
  type SpeedPresetName,
} from '@/studio/speed'
import { canHoldMotionBlur, isShutterDegrees, isSmoothSlowMotion, SHUTTER_DEGREES } from '@/studio/motion-blur'
import { setMotionBlur as setMotionBlurAction } from '@/studio/motion-blur/ui/actions'
import { canHoldSpeedCurve, setSpeedCurve as setSpeedCurveAction } from '@/studio/speed/actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import * as grade from './clips-grade'
import { applySmoothEdit } from './clips-smooth'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import {
  addItem,
  duplicateItems,
  moveItem,
  rateStretchItem,
  removeItems,
  rippleDeleteItems,
  splitItem,
  trimItemEnd,
  trimItemStart,
  updateItem,
} from '@/features/timeline/stores/timeline-actions'
import { isInTransitionOverlap } from '@/features/timeline/stores/actions/edit/shared'
import { placeItemsWithoutTimelineOverlap } from '@/features/timeline/stores/actions/item-placement'
import {
  getDroppedMediaDurationInFrames,
  type DroppableMediaType,
} from '@/features/timeline/utils/dropped-media'
import { buildMediaTimelineItem } from '@/features/timeline/utils/media-timeline-item-builder'
import {
  isRateStretchableItem,
  resolveDurationAndSpeed,
} from '@/features/timeline/hooks/use-rate-stretch'
import { isTrackCompatibleWithItemType } from '@/features/timeline/utils/track-item-compatibility'
import {
  sourceToTimelineFrames,
  timelineToSourceFrames,
} from '@/features/timeline/utils/source-calculations'
import { getMediaType } from '@/features/media-library/utils/validation'
import {
  DEFAULT_PROJECT_FPS,
  DEFAULT_PROJECT_HEIGHT,
  DEFAULT_PROJECT_WIDTH,
} from '@/shared/projects/defaults'
import { getParentFrameCount } from '@/studio/subclips'
import {
  requireClip,
  requireFrame,
  requireMedia,
  requireSourceRange,
  requireTrack,
} from '../context'
import { formatValue, invalidArgumentError, studioError, type StudioError } from '../errors'
import { transaction } from '../transaction'
import type {
  ClipAddInput,
  ClipDuplicateOptions,
  ClipFilter,
  ClipId,
  ClipInfo,
  ClipPatch,
  ClipPlacement,
  ClipRemoveOptions,
  ClipSpeedCurve,
  ClipTransform,
  ClipsApi,
  Frame,
  MotionBlurSettings,
  SpeedKey,
  SpeedPreset,
  SpeedPresetOptions,
  TrackId,
} from '../types'

/** Speed range `ClipsApi.setSpeed` accepts; the store itself allows up to 16. */
const SPEED_MIN = 0.1
const SPEED_MAX = 10

/**
 * The store fields `clips.update` writes: `Partial<TimelineItem>`, plus the
 * video-only flag `muted` maps to (only `VideoItem` declares it).
 */
type ClipUpdate = Partial<TimelineItem> & { embeddedAudioMuted?: boolean }

/** Gain range the clip and track panels offer, in dB. */
const VOLUME_MIN_DB = -60
const VOLUME_MAX_DB = 12

/** Kinds of media `clips.add` can place on a track. */
const PLACEABLE_MEDIA_TYPES: readonly DroppableMediaType[] = ['video', 'audio', 'image', 'lottie']

// ---------------------------------------------------------------------------
// Reads: store objects to plain copies
// ---------------------------------------------------------------------------

/** Optional store fields `ClipInfo` publishes under the same name. */
const CLIP_INFO_FIELDS = [
  'mediaId',
  'compositionId',
  'trimStart',
  'trimEnd',
  'sourceStart',
  'sourceEnd',
  'sourceDuration',
  'sourceFps',
  'speed',
  'isReversed',
  'volume',
  'audioFadeIn',
  'audioFadeOut',
  'fadeIn',
  'fadeOut',
] as const satisfies ReadonlyArray<keyof TimelineItem & keyof ClipInfo>

/** Transform fields `ClipInfo.transform` publishes under the same name. */
const CLIP_TRANSFORM_FIELDS = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'flipHorizontal',
  'flipVertical',
  'opacity',
  'cornerRadius',
] as const satisfies ReadonlyArray<keyof TransformProperties & keyof ClipTransform>

/**
 * Copy the named fields of `source` that are set onto `target`: a field the
 * store leaves unset stays absent from the JSON copy instead of appearing as
 * `undefined`. The field lists above keep the names type-checked.
 */
function copyDefinedFields(source: object, target: object, fields: readonly string[]): void {
  for (const field of fields) {
    const value = (source as Record<string, unknown>)[field]
    if (value !== undefined) Object.assign(target, { [field]: value })
  }
}

/** A fresh `ClipTransform` copy of a store transform. */
function toClipTransform(transform: TransformProperties): ClipTransform {
  const copy: ClipTransform = {}
  copyDefinedFields(transform, copy, CLIP_TRANSFORM_FIELDS)
  return copy
}

/** A fresh `ClipInfo` copy of a store item; mutating it never touches the store. */
function toClipInfo(item: TimelineItem): ClipInfo {
  const copy: ClipInfo = {
    id: item.id,
    trackId: item.trackId,
    type: item.type,
    from: item.from,
    durationInFrames: item.durationInFrames,
    label: item.label,
  }
  copyDefinedFields(item, copy, CLIP_INFO_FIELDS)
  if (item.transform !== undefined) copy.transform = toClipTransform(item.transform)
  if (item.type === 'text') copy.text = item.text
  if (item.type === 'text' || item.type === 'subtitle') copy.color = item.color
  return copy
}

// ---------------------------------------------------------------------------
// Argument checks
// ---------------------------------------------------------------------------

/** A number of frames that may also be negative: positive shortens, negative extends. */
function requireIntegerFrames(value: unknown, argument: string, method: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  throw invalidArgumentError({
    method,
    argument,
    expectation: 'an integer number of frames',
    value,
  })
}

/** A gain in dB, `-60` (silence) to `12`. */
function requireVolume(value: unknown, argument: string, method: string): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= VOLUME_MIN_DB &&
    value <= VOLUME_MAX_DB
  ) {
    return value
  }
  throw invalidArgumentError({
    method,
    argument,
    expectation: `a number of dB from ${VOLUME_MIN_DB} to ${VOLUME_MAX_DB}`,
    value,
  })
}

/** A playback speed multiplier, `0.1` to `10`. */
function requireSpeed(value: unknown, method: string): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= SPEED_MIN &&
    value <= SPEED_MAX
  ) {
    return value
  }
  throw invalidArgumentError({
    method,
    argument: 'speed',
    expectation: `a number from ${SPEED_MIN} to ${SPEED_MAX}`,
    value,
  })
}

// ---------------------------------------------------------------------------
// Speed curves: the clip, the keys and the preset options
// ---------------------------------------------------------------------------

/**
 * The clip a speed-curve method works on, required to be one whose curve the
 * renderer maps: video and audio, not reversed, not a composition wrapper
 * (design 7.1, section 4.6). `clips.setSpeed` keeps its wider rule — it also
 * stretches compositions and GIFs — but a curve there would be a control that
 * does nothing.
 * @throws NOT_FOUND when no clip has that id
 * @throws UNSUPPORTED when the clip cannot carry a speed curve
 */
function requireSpeedCurveClip(id: ClipId, method: string): TimelineItem {
  const item = requireClip(id, method, 'id')
  if (canHoldSpeedCurve(item)) return item
  throw studioError({
    code: 'UNSUPPORTED',
    method,
    message:
      item.isReversed === true
        ? 'a reversed clip cannot have a speed curve'
        : `a clip of kind "${item.type}" cannot have a speed curve`,
    entity: { kind: 'clip', id },
    hint: 'Speed curves are for video and audio clips that are not reversed.',
  })
}

/**
 * The clip a motion-blur method works on: a video clip that is not reversed and not a
 * composition wrapper (design 7.2, section 4.8).
 * @throws NOT_FOUND when no clip has that id
 * @throws UNSUPPORTED when the clip cannot carry motion blur
 */
function requireMotionBlurClip(id: ClipId, method: string): TimelineItem {
  const item = requireClip(id, method, 'id')
  if (canHoldMotionBlur(item)) return item
  throw studioError({
    code: 'UNSUPPORTED',
    method,
    message:
      item.isReversed === true
        ? 'a reversed clip cannot have motion blur'
        : item.compositionId !== undefined
          ? 'a composition wrapper cannot have motion blur'
          : `a clip of kind "${item.type}" cannot have motion blur`,
    entity: { kind: 'clip', id },
    hint: 'Motion blur is for video clips that are not reversed.',
  })
}

/** A field of a settings object, or undefined for anything that is not an object. */
function fieldOf(value: unknown, field: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[field]
    : undefined
}

/**
 * The smooth slow motion a settings object asks for: its `smoothSlowMotion`, or the deprecated `blendSlowMotion`
 * (`true` is `'blend'`, `false` is off) when only that is given; `null` when the one given is not valid.
 */
function requestedSmoothSlowMotion(value: unknown): { mode: MotionBlurSettings['smoothSlowMotion'] } | null {
  const smooth = fieldOf(value, 'smoothSlowMotion')
  const legacy = fieldOf(value, 'blendSlowMotion')
  if (legacy === undefined) return smooth === undefined || isSmoothSlowMotion(smooth) ? { mode: smooth } : null
  if (typeof legacy !== 'boolean') return null
  return { mode: legacy ? 'blend' : undefined }
}

/**
 * The settings `clips.setMotionBlur` accepts: null, or an object with one of the four angles and an optional smooth slow
 * motion mode, given as `smoothSlowMotion` or as the deprecated `blendSlowMotion`, never both.
 */
function requireMotionBlurSettings(value: unknown, method: string): MotionBlurSettings | null {
  if (value === null) return null
  if (fieldOf(value, 'smoothSlowMotion') !== undefined && fieldOf(value, 'blendSlowMotion') !== undefined) {
    throw invalidArgumentError({
      method,
      argument: 'settings',
      expectation: 'either "smoothSlowMotion" or the deprecated "blendSlowMotion", not both',
      value,
      hint: 'Pass only smoothSlowMotion: "blend" or "optical-flow", or leave it out for off.',
    })
  }
  const degrees = fieldOf(value, 'shutterDegrees')
  const requested = requestedSmoothSlowMotion(value)
  if (isShutterDegrees(degrees) && requested !== null) {
    return requested.mode === undefined
      ? { shutterDegrees: degrees }
      : { shutterDegrees: degrees, smoothSlowMotion: requested.mode }
  }
  throw invalidArgumentError({
    method,
    argument: 'settings',
    expectation:
      'null, or an object whose "shutterDegrees" is 90, 180, 270 or 360 and whose optional "smoothSlowMotion" is "blend" or "optical-flow" (or the deprecated "blendSlowMotion" a boolean)',
    value,
    valid: SHUTTER_DEGREES.map(String),
    hint: 'Pass null to switch the blur off.',
  })
}

/** A key's speed, `0.1` to `10`, with the argument path in the message. */
function requireKeySpeed(value: unknown, index: number, method: string): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= SPEED_MIN &&
    value <= SPEED_MAX
  ) {
    return value
  }
  throw invalidArgumentError({
    method,
    argument: `keys[${index}].speed`,
    expectation: `a number from ${SPEED_MIN} to ${SPEED_MAX}`,
    value,
  })
}

/** One key's frame as the SDK accepts it: an integer >= 0. */
function requireKeyFrameValue(value: unknown, index: number, method: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidArgumentError({
      method,
      argument: `keys[${index}].frame`,
      expectation: 'an integer frame >= 0',
      value,
    })
  }
  return value
}

/** The first key sits at frame 0 and each later one strictly after the previous. */
function requireKeyFrameOrder(
  frame: number,
  index: number,
  previousFrame: number,
  method: string,
): void {
  if (index === 0 && frame !== 0) {
    throw invalidArgumentError({
      method,
      argument: 'keys[0].frame',
      expectation: "0, the clip's first frame",
      value: frame,
    })
  }
  if (index > 0 && frame <= previousFrame) {
    throw invalidArgumentError({
      method,
      argument: `keys[${index}].frame`,
      expectation: `a frame greater than keys[${index - 1}].frame (${previousFrame})`,
      value: frame,
    })
  }
}

/** The last key sits on the clip's last frame, so the curve covers the whole clip. */
function requireKeyEndFrame(
  frame: number,
  index: number,
  lastIndex: number,
  duration: number,
  method: string,
): void {
  if (index === lastIndex && frame !== duration) {
    throw invalidArgumentError({
      method,
      argument: `keys[${index}].frame`,
      expectation: `the clip's last frame (${duration})`,
      value: frame,
    })
  }
}

/** A key's ease: absent (linear) or one of the names of `SPEED_EASES`. */
function requireKeyEase(value: unknown, index: number, method: string): SpeedEase {
  if (value === undefined) return 'linear'
  if (isSpeedEase(value)) return value
  throw invalidArgumentError({
    method,
    argument: `keys[${index}].ease`,
    expectation: `one of ${SPEED_EASES.join(', ')}`,
    value,
  })
}

/**
 * A speed curve's keys as the SDK accepts them: at least two, the first at frame
 * 0, the last at the clip's last frame, strictly increasing frames between them,
 * speeds in `0.1..10` (design 7.1, section 4.9). The normaliser repairs a stored
 * project's curve; a call is refused instead, so an agent's mistake cannot land
 * as a silently different curve.
 */
function requireSpeedKeys(value: unknown, item: TimelineItem, method: string): SpeedKey[] {
  if (!Array.isArray(value)) {
    throw invalidArgumentError({
      method,
      argument: 'keys',
      expectation:
        "an array of speed keys, the first at frame 0 and the last at the clip's last frame",
      value,
    })
  }
  if (value.length < 2) {
    throw invalidArgumentError({
      method,
      argument: 'keys',
      expectation: `at least two keys: frame 0 and the clip's last frame (${Math.round(item.durationInFrames)})`,
      value: `an array of ${value.length}`,
    })
  }
  const duration = Math.round(item.durationInFrames)
  const keys: SpeedKey[] = []
  let previousFrame = -1
  for (const [index, raw] of value.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      throw invalidArgumentError({
        method,
        argument: `keys[${index}]`,
        expectation: 'an object with a frame and a speed',
        value: raw,
      })
    }
    const { frame, speed, ease } = raw as { frame?: unknown; speed?: unknown; ease?: unknown }
    const checkedFrame = requireKeyFrameValue(frame, index, method)
    requireKeyFrameOrder(checkedFrame, index, previousFrame, method)
    requireKeyEndFrame(checkedFrame, index, value.length - 1, duration, method)
    const checkedSpeed = requireKeySpeed(speed, index, method)
    const checkedEase = requireKeyEase(ease, index, method)
    keys.push(
      checkedEase === 'linear'
        ? { frame: checkedFrame, speed: checkedSpeed }
        : { frame: checkedFrame, speed: checkedSpeed, ease: checkedEase },
    )
    previousFrame = checkedFrame
  }
  return keys
}

/** One of the three presets (design 7.1, section 4.8). */
function requireSpeedPreset(value: unknown, method: string): SpeedPresetName {
  if (typeof value === 'string' && SPEED_PRESET_NAMES.includes(value as SpeedPresetName)) {
    return value as SpeedPresetName
  }
  throw invalidArgumentError({
    method,
    argument: 'preset',
    expectation: 'one of the speed presets',
    value,
    valid: [...SPEED_PRESET_NAMES],
    hint: 'studio.clips.setSpeedPreset names the presets it accepts.',
  })
}

/** The preset's peak, when named: a finite speed in `0.1..10`. */
function requirePresetPeak(value: unknown, method: string): void {
  if (value === undefined) return
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < SPEED_MIN ||
    value > SPEED_MAX
  ) {
    throw invalidArgumentError({
      method,
      argument: 'options.peak',
      expectation: `a number from ${SPEED_MIN} to ${SPEED_MAX}`,
      value,
    })
  }
}

/** The preset's ramp length, when named: an integer of at least one frame. */
function requirePresetRampFrames(value: unknown, method: string): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalidArgumentError({
      method,
      argument: 'options.rampFrames',
      expectation: 'an integer of at least 1 frame',
      value,
    })
  }
}

/** The preset's peak and ramp length, each checked only when the caller names it. */
function speedPresetOptions(
  options: SpeedPresetOptions | undefined,
  method: string,
): { peak?: number; rampFrames?: number } {
  requirePresetPeak(options?.peak, method)
  requirePresetRampFrames(options?.rampFrames, method)
  return { peak: options?.peak, rampFrames: options?.rampFrames }
}

/** The items of an id list, each id required to exist, in the given order. */
function requireClipItems(ids: ClipId[], method: string): TimelineItem[] {
  if (!Array.isArray(ids)) {
    throw invalidArgumentError({
      method,
      argument: 'ids',
      expectation: 'an array of clip ids',
      value: ids,
    })
  }
  return ids.map((id) => requireClip(id, method, 'ids'))
}

/** The ids of the tracks that accept a clip of `itemType`, in stack order. */
function compatibleTrackIds(itemType: TimelineItem['type']): string[] {
  const { tracks, items } = useItemsStore.getState()
  return tracks
    .filter((track) => isTrackCompatibleWithItemType(track, items, itemType))
    .map((track) => track.id)
}

/**
 * The track with this id, required to accept a clip of `itemType` by the
 * editor's own rule (`isTrackCompatibleWithItemType`): an audio clip needs an
 * audio track, every other kind needs a video track (or one that has no kind
 * and no clips yet).
 * @throws NOT_FOUND when no track has that id
 * @throws INVALID_ARGUMENT when the track cannot hold a clip of `itemType`
 */
function requireCompatibleTrack(
  id: string,
  itemType: TimelineItem['type'],
  method: string,
): TimelineTrack {
  const track = requireTrack(id, method, 'trackId')
  if (isTrackCompatibleWithItemType(track, useItemsStore.getState().items, itemType)) {
    return track
  }
  throw invalidArgumentError({
    method,
    argument: 'trackId',
    expectation: `a track that fits a clip of type ${itemType}`,
    value: id,
    valid: compatibleTrackIds(itemType),
    validSource: 'studio.tracks.list()',
    hint: 'An audio clip needs an audio track; every other kind needs a video track.',
  })
}

// ---------------------------------------------------------------------------
// Building a clip from the media library
// ---------------------------------------------------------------------------

/** The placeable kind of a media item, or `UNSUPPORTED` when it cannot sit on a track. */
function placeableMediaType(media: MediaMetadata, method: string): DroppableMediaType {
  const type = getMediaType(media.mimeType)
  if (type === 'unknown') {
    throw studioError({
      code: 'UNSUPPORTED',
      method,
      message:
        `"mediaId" must name a video, audio, image or lottie item ` +
        `(got ${formatValue(media.id)} of type "unknown")`,
      argument: 'mediaId',
      entity: { kind: 'media', id: media.id },
      hint: `studio.media.list() lists the library; placeable types: ${PLACEABLE_MEDIA_TYPES.join(', ')}.`,
    })
  }
  return type
}

/** The canvas the project renders on, with the editor's defaults when no project is open. */
function canvasSize(): { width: number; height: number } {
  const project = useProjectStore.getState().currentProject
  return {
    width: project?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
    height: project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
  }
}

/**
 * The timeline item `clips.add` places, built like a media drop and validated
 * before any store is written: the media and track must exist, `from` and
 * `durationInFrames` are integer frames, and the media must be placeable.
 *
 * The item carries `mediaId` with `src: ''`, exactly as the headless harness
 * builds it (`src/headless/edit-ops.ts:272-316`): preview and export refill the
 * source from `mediaId`, which keeps clip creation synchronous.
 */
function buildClipItem(input: ClipAddInput, method: string): TimelineItem {
  const media = requireMedia(input.mediaId, method, 'mediaId')
  const mediaType = placeableMediaType(media, method)
  const from = requireFrame(input.from, 'from', method)
  const track = requireCompatibleTrack(input.trackId, mediaType, method)
  const timelineFps = useTimelineSettingsStore.getState().fps || DEFAULT_PROJECT_FPS
  const { width, height } = canvasSize()
  const range = optionalSourceRange(input, media, mediaType, method)
  const item = buildMediaTimelineItem({
    media,
    mediaId: media.id,
    mediaType,
    label: input.label ?? media.fileName,
    projectFps: timelineFps,
    blobUrl: '',
    thumbnailUrl: null,
    canvasWidth: width,
    canvasHeight: height,
    originId: crypto.randomUUID(),
    ...(range && { sourceStart: range.start, sourceEnd: range.end }),
    placement: {
      trackId: track.id,
      from,
      // With a range the clip is as long as the range plays; without one, the
      // caller's length or the file's own.
      durationInFrames: range
        ? undefined
        : input.durationInFrames === undefined
          ? getDroppedMediaDurationInFrames(media, mediaType, timelineFps)
          : requireFrame(input.durationInFrames, 'durationInFrames', method),
    },
  })
  if (range && input.durationInFrames !== undefined) {
    const given = requireFrame(input.durationInFrames, 'durationInFrames', method)
    if (given !== item.durationInFrames) {
      throw invalidArgumentError({
        method,
        argument: 'durationInFrames',
        expectation: `left out, or ${item.durationInFrames} frames, the length of source frames ${range.start}..${range.end}`,
        value: given,
        hint: 'With sourceStart and sourceEnd the range sets the length; trim or rate-stretch the clip afterwards.',
      })
    }
  }
  return item
}

/** What `clips.add` does with a clip that overlaps another: `fail` unless the input says `move`. */
function requireOnOverlap(input: ClipAddInput, method: string): 'move' | 'fail' {
  const { onOverlap } = input
  if (onOverlap === undefined) return 'fail'
  if (onOverlap === 'move' || onOverlap === 'fail') return onOverlap
  throw invalidArgumentError({
    method,
    argument: 'onOverlap',
    expectation: '"fail" (the default) or "move"',
    value: onOverlap,
  })
}

/**
 * The CONFLICT of a clip that would overlap another on its track: it names the clip in the way
 * and the first free frame where this one fits.
 */
function overlapError(
  item: TimelineItem,
  firstFree: number,
  method: string,
  index?: number,
): StudioError {
  const end = item.from + item.durationInFrames
  const blocker = useItemsStore
    .getState()
    .items.find(
      (other) =>
        other.trackId === item.trackId &&
        other.from < end &&
        other.from + other.durationInFrames > item.from,
    )
  const where = blocker
    ? `clip "${blocker.id}" (frames ${blocker.from}..${blocker.from + blocker.durationInFrames})`
    : 'another clip'
  return studioError({
    code: 'CONFLICT',
    method,
    argument: index === undefined ? 'from' : `inputs[${index}].from`,
    message: `${index === undefined ? '' : `inputs[${index}]: `}a clip of ${item.durationInFrames} frames at frame ${item.from} overlaps ${where} on track "${item.trackId}"; the first free frame where it fits is ${firstFree}`,
    ...(blocker && { entity: { kind: 'clip' as const, id: blocker.id } }),
    hint: `Use from: ${firstFree}, or pass onOverlap: 'move' to let the clip be placed there and read its frame in the result.`,
  })
}

/**
 * The source range a `clips.add` input names, or undefined when it names none.
 * The two bounds come as a pair, only for video and audio, and lie inside the
 * file's frames.
 */
function optionalSourceRange(
  input: ClipAddInput,
  media: MediaMetadata,
  mediaType: DroppableMediaType,
  method: string,
): { start: number; end: number } | undefined {
  const { sourceStart, sourceEnd } = input
  if (sourceStart === undefined && sourceEnd === undefined) return undefined
  const missing =
    sourceStart === undefined ? 'sourceStart' : sourceEnd === undefined ? 'sourceEnd' : null
  if (missing !== null) {
    throw invalidArgumentError({
      method,
      argument: missing,
      expectation: 'given together with the other end of the source range',
      value: undefined,
    })
  }
  if (mediaType !== 'video' && mediaType !== 'audio') {
    throw invalidArgumentError({
      method,
      argument: 'sourceStart',
      expectation: `left out: only video and audio have a source range, and this media is ${mediaType}`,
      value: sourceStart,
    })
  }
  return requireSourceRange(
    sourceStart,
    sourceEnd,
    getParentFrameCount(media),
    method,
    'sourceStart',
    'sourceEnd',
  )
}

// ---------------------------------------------------------------------------
// Update: a patch to the store fields it writes
// ---------------------------------------------------------------------------

/** `ClipPatch` fields the store item also calls by that name. */
const DIRECT_UPDATE_FIELDS = [
  'label',
  'volume',
  'audioFadeIn',
  'audioFadeOut',
  'fadeIn',
  'fadeOut',
] as const satisfies ReadonlyArray<keyof ClipPatch & keyof TimelineItem>

/** The mute a patch asks for, or undefined when it asks nothing or changes nothing. */
function mutedUpdate(item: TimelineItem, muted: boolean | undefined): boolean | undefined {
  if (muted === undefined) return undefined
  if (item.type !== 'video') {
    throw invalidArgumentError({
      method: 'clips.update',
      argument: 'muted',
      expectation: 'used only on a video clip, whose embedded audio it mutes',
      value: muted,
      hint: `Mute an audio clip with "volume": ${VOLUME_MIN_DB}.`,
    })
  }
  return muted === item.embeddedAudioMuted ? undefined : muted
}

/** The transform a patch merges into the clip's own, or undefined when nothing changes. */
function transformUpdate(
  item: TimelineItem,
  patch: ClipPatch['transform'],
): TransformProperties | undefined {
  if (patch === undefined) return undefined
  const transform = { ...item.transform, ...patch }
  const unchanged = JSON.stringify(transform) === JSON.stringify(item.transform ?? {})
  return unchanged ? undefined : transform
}

/**
 * The store updates a `ClipPatch` asks for, field by field: a field left out,
 * or already at the value asked for, is not written, so a patch that changes
 * nothing can skip the store and add no undo entry.
 */
function clipUpdates(item: TimelineItem, patch: ClipPatch): ClipUpdate {
  const updates: ClipUpdate = {}
  // Validate the gain even when it equals the current one: a bad value always throws.
  if (patch.volume !== undefined) requireVolume(patch.volume, 'volume', 'clips.update')
  for (const field of DIRECT_UPDATE_FIELDS) {
    const value = patch[field]
    if (value !== undefined && value !== item[field]) {
      Object.assign(updates, { [field]: value })
    }
  }
  const muted = mutedUpdate(item, patch.muted)
  if (muted !== undefined) updates.embeddedAudioMuted = muted
  const transform = transformUpdate(item, patch.transform)
  if (transform !== undefined) updates.transform = transform
  return updates
}

// ---------------------------------------------------------------------------
// Duplicate: the copy count and where each copy goes
// ---------------------------------------------------------------------------

/** One copy `duplicateItems` makes, and where it lands. */
interface DuplicatePlacement {
  itemId: ClipId
  position: { from: Frame; trackId: TrackId }
}

/** The validated copy count and offset of `clips.duplicate`. */
function duplicateOptions(options: ClipDuplicateOptions | undefined): {
  count: number
  offsetFrames: Frame | undefined
} {
  const count = options?.count ?? 1
  if (!Number.isInteger(count) || count < 1) {
    throw invalidArgumentError({
      method: 'clips.duplicate',
      argument: 'count',
      expectation: 'a positive integer',
      value: count,
      hint: 'Omit "count" to make one copy of each clip.',
    })
  }
  const offsetFrames =
    options?.offsetFrames === undefined
      ? undefined
      : requireFrame(options.offsetFrames, 'offsetFrames', 'clips.duplicate')
  return { count, offsetFrames }
}

/**
 * One placement per copy: copy `n` of a clip sits `n` offsets after it, where
 * the offset is the clip's own length unless `offsetFrames` says otherwise.
 */
function duplicatePlacements(
  items: TimelineItem[],
  count: number,
  offsetFrames: Frame | undefined,
): DuplicatePlacement[] {
  const placements: DuplicatePlacement[] = []
  for (const item of items) {
    const offset = offsetFrames ?? item.durationInFrames
    for (let copy = 1; copy <= count; copy += 1) {
      placements.push({
        itemId: item.id,
        position: { from: item.from + offset * copy, trackId: item.trackId },
      })
    }
  }
  return placements
}

// ---------------------------------------------------------------------------
// The namespace
// ---------------------------------------------------------------------------

/** `ClipsApi` over the items store and the timeline actions (design §4.2). */
export function createClipsApi(): ClipsApi {
  return {
    list(filter?: ClipFilter): ClipInfo[] {
      const trackId = filter?.trackId
      const type = filter?.type
      return useItemsStore
        .getState()
        .items.filter(
          (item) =>
            (trackId === undefined || item.trackId === trackId) &&
            (type === undefined || item.type === type),
        )
        .map(toClipInfo)
    },

    get(id: ClipId): ClipInfo | null {
      const item = useItemsStore.getState().itemById[id]
      return item ? toClipInfo(item) : null
    },

    add: ((input: ClipAddInput): ClipId | ClipPlacement => {
      const method = 'clips.add'
      const onOverlap = requireOnOverlap(input, method)
      const item = buildClipItem(input, method)
      const firstFree = placeItemsWithoutTimelineOverlap([item])[0]?.from ?? item.from
      if (firstFree !== item.from && onOverlap === 'fail') {
        throw overlapError(item, firstFree, method)
      }
      transaction('CLIPS_ADD', () => {
        addItem(item)
      })
      if (onOverlap === 'fail') return item.id
      return { id: item.id, from: firstFree, requestedFrom: item.from, moved: firstFree !== item.from }
    }) as ClipsApi['add'],

    addMany: ((inputs: ClipAddInput[]): Array<ClipId | ClipPlacement> => {
      const method = 'clips.addMany'
      if (!Array.isArray(inputs)) {
        throw invalidArgumentError({
          method,
          argument: 'inputs',
          expectation: 'an array of clip inputs',
          value: inputs,
        })
      }
      // Validate and build every item first: a rejected input must leave the
      // project untouched. Placement still runs per item, in order, so each
      // clip is checked against the ones added before it — as two `add` calls would.
      const modes = inputs.map((input) => requireOnOverlap(input, method))
      const items = inputs.map((input) => buildClipItem(input, method))
      // An overlap with `fail` throws inside the transaction, which restores the project and
      // adds no undo entry: the call changes nothing.
      const { value: results } = transaction('CLIPS_ADD_MANY', () =>
        items.map((item, index): ClipId | ClipPlacement => {
          const firstFree = placeItemsWithoutTimelineOverlap([item])[0]?.from ?? item.from
          const mode = modes[index]!
          if (firstFree !== item.from && mode === 'fail') {
            throw overlapError(item, firstFree, method, index)
          }
          addItem(item)
          if (mode === 'fail') return item.id
          return {
            id: item.id,
            from: firstFree,
            requestedFrom: item.from,
            moved: firstFree !== item.from,
          }
        }),
      )
      return results
    }) as ClipsApi['addMany'],

    update(id: ClipId, patch: ClipPatch): void {
      const item = requireClip(id, 'clips.update', 'id')
      const updates = clipUpdates(item, patch)
      if (Object.keys(updates).length === 0) return
      transaction('CLIPS_UPDATE', () => {
        updateItem(id, updates)
      })
    },

    move(id: ClipId, to: Frame, trackId?: TrackId): void {
      const item = requireClip(id, 'clips.move', 'id')
      const frame = requireFrame(to, 'to', 'clips.move')
      if (trackId !== undefined) requireCompatibleTrack(trackId, item.type, 'clips.move')
      if (frame === item.from && (trackId === undefined || trackId === item.trackId)) return
      transaction('CLIPS_MOVE', () => {
        moveItem(id, frame, trackId)
      })
    },

    remove(ids: ClipId[], options?: ClipRemoveOptions): void {
      const items = requireClipItems(ids, 'clips.remove')
      if (items.length === 0) return
      const ripple = options?.ripple === true
      transaction('CLIPS_REMOVE', () => {
        if (ripple) {
          rippleDeleteItems(ids)
        } else {
          removeItems(ids)
        }
      })
    },

    duplicate(ids: ClipId[], options?: ClipDuplicateOptions): ClipId[] {
      const items = requireClipItems(ids, 'clips.duplicate')
      const { count, offsetFrames } = duplicateOptions(options)
      if (items.length === 0) return []
      const placements = duplicatePlacements(items, count, offsetFrames)
      const { value: copies } = transaction('CLIPS_DUPLICATE', () =>
        duplicateItems(
          placements.map((placement) => placement.itemId),
          placements.map((placement) => placement.position),
        ),
      )
      return copies.map((copy) => copy.id)
    },

    split(id: ClipId, frame: Frame): [ClipId, ClipId] {
      const item = requireClip(id, 'clips.split', 'id')
      const at = requireFrame(frame, 'frame', 'clips.split')
      const end = item.from + item.durationInFrames
      if (at <= item.from || at >= end) {
        throw studioError({
          code: 'CONFLICT',
          method: 'clips.split',
          message:
            `"frame" must fall inside the clip, which spans frames ${item.from}..${end - 1} ` +
            `(got ${formatValue(at)})`,
          argument: 'frame',
          entity: { kind: 'clip', id },
        })
      }
      if (isInTransitionOverlap(item.id, at - item.from, item.durationInFrames)) {
        throw studioError({
          code: 'CONFLICT',
          method: 'clips.split',
          message: `the frame is inside a transition zone of the clip (got ${formatValue(at)})`,
          argument: 'frame',
          entity: { kind: 'clip', id },
          hint: 'Move the split outside the frames the transition consumes, or remove the transition.',
        })
      }

      return transaction('CLIPS_SPLIT', () => {
        // The action returns null when it cannot split; throwing here rolls the
        // transaction back, so a failed split leaves the project unchanged.
        const result = splitItem(id, at)
        if (!result) {
          throw studioError({
            code: 'CONFLICT',
            method: 'clips.split',
            message: `the clip cannot be split at ${formatValue(at)}`,
            argument: 'frame',
            entity: { kind: 'clip', id },
            hint: 'A linked clip on another track may be too short to split at this frame.',
          })
        }
        return [result.leftItem.id, result.rightItem.id] as [ClipId, ClipId]
      }).value
    },

    trimStart(id: ClipId, frames: number): void {
      requireClip(id, 'clips.trimStart', 'id')
      const amount = requireIntegerFrames(frames, 'frames', 'clips.trimStart')
      if (amount === 0) return
      transaction('CLIPS_TRIM_START', () => {
        trimItemStart(id, amount)
      })
    },

    trimEnd(id: ClipId, frames: number): void {
      requireClip(id, 'clips.trimEnd', 'id')
      const amount = requireIntegerFrames(frames, 'frames', 'clips.trimEnd')
      if (amount === 0) return
      transaction('CLIPS_TRIM_END', () => {
        // The store's end handle reads a positive amount as "extend right"
        // (trim-utils.ts:35), while `ClipsApi.trimEnd` documents positive as
        // "shortens"; the sign flips here.
        trimItemEnd(id, -amount)
      })
    },

    setSpeed(id: ClipId, speed: number): void {
      const item = requireClip(id, 'clips.setSpeed', 'id')
      const target = requireSpeed(speed, 'clips.setSpeed')
      if (!isRateStretchableItem(item)) {
        throw studioError({
          code: 'UNSUPPORTED',
          method: 'clips.setSpeed',
          message: `a clip of kind "${item.type}" has no playback speed`,
          entity: { kind: 'clip', id },
          hint:
            'setSpeed changes video, audio, composition and GIF clips; ' +
            'the store ignores every other kind.',
        })
      }
      const currentSpeed = item.speed ?? 1
      if (Math.abs(currentSpeed - target) < 1e-9) {
        // The clip already plays at the target, but a curve is the second half of a speed:
        // setting one clears it, and the average being the target cannot exempt it
        // (design 7.1, section 4.1).
        if (item.speedCurve !== undefined) {
          transaction('CLIPS_SET_SPEED', () =>
            updateItem(id, { speedCurve: undefined, sourceFrameOffset: undefined }),
          )
        }
        return
      }

      const timelineFps = useTimelineSettingsStore.getState().fps || DEFAULT_PROJECT_FPS
      const sourceFps = item.sourceFps ?? timelineFps
      // The source range the clip plays: the trim window when the item has one,
      // otherwise the span its current duration covers at the current speed.
      const sourceSpan =
        item.sourceStart !== undefined && item.sourceEnd !== undefined
          ? item.sourceEnd - item.sourceStart
          : timelineToSourceFrames(item.durationInFrames, currentSpeed, timelineFps, sourceFps)
      // The UI's solver (use-rate-stretch.ts:211) keeps the whole source range
      // covered after frame rounding and clamps the speed to 0.1..16.
      const proposedDuration = Math.max(
        1,
        sourceToTimelineFrames(sourceSpan, target, sourceFps, timelineFps),
      )
      const resolved = resolveDurationAndSpeed(sourceSpan, proposedDuration, sourceFps, timelineFps)

      transaction('CLIPS_SET_SPEED', () => {
        rateStretchItem(id, item.from, resolved.duration, resolved.speed, {
          rippleOverlapOnly: true,
        })
      })
    },

    getSpeedCurve(id: ClipId): ClipSpeedCurve | null {
      const item = requireSpeedCurveClip(id, 'clips.getSpeedCurve')
      const curve = item.speedCurve
      if (curve === undefined) return null
      return {
        keys: curve.keys.map((key) =>
          key.ease === undefined || key.ease === 'linear'
            ? { frame: key.frame, speed: key.speed }
            : { frame: key.frame, speed: key.speed, ease: key.ease },
        ),
        averageSpeed: averageSpeed(curve),
      }
    },

    setSpeedCurve(id: ClipId, keys: SpeedKey[] | null): void {
      const item = requireSpeedCurveClip(id, 'clips.setSpeedCurve')
      const curve =
        keys === null ? null : { keys: requireSpeedKeys(keys, item, 'clips.setSpeedCurve') }
      transaction('CLIPS_SET_SPEED_CURVE', () => setSpeedCurveAction(id, curve))
    },

    getMotionBlur(id: ClipId): MotionBlurSettings | null {
      const item = requireMotionBlurClip(id, 'clips.getMotionBlur')
      const settings = item.type === 'video' ? item.motionBlur : undefined
      if (settings === undefined) return null
      return settings.smoothSlowMotion === undefined
        ? { shutterDegrees: settings.shutterDegrees }
        : { shutterDegrees: settings.shutterDegrees, smoothSlowMotion: settings.smoothSlowMotion }
    },

    setMotionBlur(id: ClipId, settings: MotionBlurSettings | null): void {
      requireMotionBlurClip(id, 'clips.setMotionBlur')
      const next = requireMotionBlurSettings(settings, 'clips.setMotionBlur')
      transaction('CLIPS_SET_MOTION_BLUR', () => setMotionBlurAction([id], next))
    },

    setSpeedPreset(id: ClipId, preset: SpeedPreset, options?: SpeedPresetOptions): void {
      const item = requireSpeedCurveClip(id, 'clips.setSpeedPreset')
      const name = requireSpeedPreset(preset, 'clips.setSpeedPreset')
      const { peak, rampFrames } = speedPresetOptions(options, 'clips.setSpeedPreset')
      const curve = speedPresetCurve(name, item.durationInFrames, peak, rampFrames)
      transaction('CLIPS_SET_SPEED_PRESET', () => setSpeedCurveAction(id, curve))
    },

    applySmoothEdit,

    getColorProfile: grade.getColorProfile,
    setColorProfile: grade.setColorProfile,
    getLook: grade.getLook,
    setLook: grade.setLook,
    getStabilization: grade.getStabilization,
    setStabilization: grade.setStabilization,

    speedAt(id: ClipId, frame: Frame): number {
      const item = requireSpeedCurveClip(id, 'clips.speedAt')
      const at = requireFrame(frame, 'frame', 'clips.speedAt')
      const end = item.from + item.durationInFrames
      if (at < item.from || at >= end) {
        throw invalidArgumentError({
          method: 'clips.speedAt',
          argument: 'frame',
          expectation: `a timeline frame inside the clip, which spans ${item.from}..${end - 1}`,
          value: at,
        })
      }
      const relative = at - item.from
      return item.speedCurve === undefined
        ? (item.speed ?? 1)
        : speedAtOnCurve(item.speedCurve, relative)
    },
  }
}
