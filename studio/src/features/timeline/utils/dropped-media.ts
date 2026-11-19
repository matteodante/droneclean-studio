import type { TimelineItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import { secondsToFrame, timelineFramesForSource, toRate } from '@/studio/time'
import { getRangeError } from '@/studio/subclips'
import {
  buildMediaTimelineItem,
  buildMediaTimelineItems,
  type LinkedMediaTimelinePlacement,
  type MediaTimelineItemType,
  type MediaTimelinePlacement,
} from './media-timeline-item-builder'

export type DroppableMediaType = MediaTimelineItemType

export interface TimelineMediaPlacement extends Required<MediaTimelinePlacement> {}

export interface TimelineLinkedMediaPlacement {
  primary: TimelineMediaPlacement
  linkedAudio?: TimelineMediaPlacement
}

/**
 * A range of source frames `[sourceStart, sourceEnd)` of the dropped media, at the media's own
 * frame rate (design 1.6, D4). Only video and audio carry one.
 */
export interface DroppedSourceRange {
  sourceStart: number
  sourceEnd: number
  /** The subclip the range comes from, when it comes from one. */
  subclipId?: string
}

/**
 * Reads the optional range of a drag payload (a `media-item`, or one entry of `media-items`).
 * No range fields: `{ range: undefined }`. Both fields as whole frames with `0 <= start < end`:
 * the range (`undefined` for a media type that cannot have one). Anything else, such as one
 * field without the other or fractional frames: `{ invalid: true }`, so the caller refuses the
 * drop and never plays other frames than the ones marked.
 */
export function readDroppedSourceRange(
  payload: { sourceStart?: unknown; sourceEnd?: unknown; subclipId?: unknown },
  mediaType: unknown,
): { range?: DroppedSourceRange; invalid?: true } {
  const { sourceStart, sourceEnd, subclipId } = payload
  if (sourceStart === undefined && sourceEnd === undefined) return {}
  if (typeof sourceStart !== 'number' || typeof sourceEnd !== 'number') return { invalid: true }
  if (getRangeError(sourceStart, sourceEnd) !== null) return { invalid: true }
  if (mediaType !== 'video' && mediaType !== 'audio') return {}
  return {
    range: {
      sourceStart,
      sourceEnd,
      ...(typeof subclipId === 'string' && subclipId !== '' ? { subclipId } : {}),
    },
  }
}

export function getDroppedMediaDurationInFrames(
  media: Pick<MediaMetadata, 'duration'> & Partial<Pick<MediaMetadata, 'fps'>>,
  mediaType: DroppableMediaType,
  timelineFps: number,
  sourceRange?: Pick<DroppedSourceRange, 'sourceStart' | 'sourceEnd'>,
): number {
  if (mediaType === 'lottie') {
    const lottieFrames = Math.round(media.duration * (media.fps || timelineFps))
    // Guard against missing/invalid metadata producing a zero-length clip.
    return lottieFrames > 0 ? lottieFrames : timelineFps
  }

  const projectFps = Number.isFinite(timelineFps) && timelineFps > 0 ? timelineFps : 30
  const projectRate = toRate(projectFps)
  const sourceFps =
    media.fps !== undefined && Number.isFinite(media.fps) && media.fps > 0 ? media.fps : projectFps
  const sourceRate = toRate(sourceFps)
  // One conversion from the media's seconds to source frames, then the clip length from those
  // source frames: the source span and the timeline length cannot round against each other
  // (design 1.5, 4.2).
  const sourceFrames =
    sourceRange && (mediaType === 'video' || mediaType === 'audio')
      ? Math.max(0, sourceRange.sourceEnd - sourceRange.sourceStart)
      : Math.max(0, secondsToFrame(sourceRate, media.duration))
  const durationInFrames = timelineFramesForSource(sourceFrames, sourceRate, projectRate, 1)
  if (durationInFrames > 0) {
    return durationInFrames
  }

  // A missing duration falls back to whole frames of the project rate: three seconds for an
  // image, one second otherwise.
  return mediaType === 'image'
    ? Math.max(1, secondsToFrame(projectRate, 3))
    : Math.max(1, secondsToFrame(projectRate, 1))
}

export function buildDroppedMediaTimelineItem(params: {
  media: MediaMetadata
  mediaId: string
  mediaType: DroppableMediaType
  label: string
  timelineFps: number
  blobUrl: string
  thumbnailUrl?: string | null
  canvasWidth: number
  canvasHeight: number
  placement: TimelineMediaPlacement
  originId?: string
  linkedGroupId?: string
  sourceRange?: DroppedSourceRange
}): TimelineItem {
  return buildMediaTimelineItem({
    media: params.media,
    mediaId: params.mediaId,
    mediaType: params.mediaType,
    label: params.label,
    projectFps: params.timelineFps,
    blobUrl: params.blobUrl,
    thumbnailUrl: params.thumbnailUrl,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
    placement: params.placement,
    originId: params.originId ?? crypto.randomUUID(),
    linkedGroupId: params.linkedGroupId,
    sourceStart: params.sourceRange?.sourceStart,
    sourceEnd: params.sourceRange?.sourceEnd,
  })
}

export function buildDroppedMediaTimelineItems(params: {
  media: MediaMetadata
  mediaId: string
  mediaType: DroppableMediaType
  label: string
  timelineFps: number
  blobUrl: string
  thumbnailUrl?: string | null
  canvasWidth: number
  canvasHeight: number
  placement: TimelineLinkedMediaPlacement
  linkVideoAudio?: boolean
  sourceRange?: DroppedSourceRange
}): TimelineItem[] {
  return buildMediaTimelineItems({
    media: params.media,
    mediaId: params.mediaId,
    mediaType: params.mediaType,
    label: params.label,
    projectFps: params.timelineFps,
    blobUrl: params.blobUrl,
    thumbnailUrl: params.thumbnailUrl,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
    placements: params.placement satisfies LinkedMediaTimelinePlacement,
    linkVideoAudio: params.linkVideoAudio,
    sourceStart: params.sourceRange?.sourceStart,
    sourceEnd: params.sourceRange?.sourceEnd,
  })
}
