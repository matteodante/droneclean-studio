// What the library does with subclips (design 1.6, D2 and D6): make one from a file's remembered
// marks, rename, delete, and describe a drag. Subclips are library state like media records: these
// are not timeline undo steps (D7), but each one marks the project as changed so it is saved.

import { useEditorStore } from '@/shared/state/editor'
import { useSourcePlayerStore, type SourceMarkPair } from '@/shared/state/source-player'
import { formatTimecode } from '@/shared/utils/time-utils'
import {
  getParentFrameCount,
  getRangeError,
  getSubclipValidity,
  useSubclipsStore,
  type Subclip,
} from '@/studio/subclips'
import { subclipPosters } from '@/studio/subclips/poster'
import { frameToSeconds, toRate } from '@/studio/time'
import type { MediaMetadata } from '@/types/storage'
import { useTimelineSettingsStore } from '@/features/media-library/deps/timeline-stores'
import type { DragData } from '@/features/media-library/utils/drag-data-cache'
import { forgetSourceMarks, onSubclipsRemoved } from './cleanup'

const FALLBACK_FPS = 30

// Deleting a file removes its subclips (D6): the project then has to be saved again.
onSubclipsRemoved(() => useTimelineSettingsStore.getState().markDirty())

/** The frame rate a subclip of this file is made at: the probe's, or 30 when it has none. */
function getMediaSourceFps(media: Pick<MediaMetadata, 'fps'>): number {
  return media.fps !== undefined && Number.isFinite(media.fps) && media.fps > 0
    ? media.fps
    : FALLBACK_FPS
}

export interface MarkedRange {
  startFrame: number
  /** Exclusive. */
  endFrame: number
}

/**
 * The range the file's remembered marks give: a missing side is the file's edge. Null when there
 * is no mark at all, or the marks do not make a range of at least one frame inside the file.
 */
export function getMarkedRange(
  media: Pick<MediaMetadata, 'id' | 'duration' | 'fps'>,
  marks: SourceMarkPair | undefined = useSourcePlayerStore.getState().marksByKey[media.id],
): MarkedRange | null {
  if (!marks || (marks.in === null && marks.out === null)) return null
  const frameCount = getParentFrameCount(media)
  const startFrame = marks.in ?? 0
  const endFrame = marks.out ?? frameCount
  return getRangeError(startFrame, endFrame, frameCount) === null ? { startFrame, endFrame } : null
}

function fileStem(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/** Makes a subclip from the file's remembered marks; null when they give no range. */
export function createSubclipFromMarks(media: MediaMetadata): Subclip | null {
  const range = getMarkedRange(media)
  if (!range) return null
  const fps = getMediaSourceFps(media)
  const subclip = useSubclipsStore.getState().create({
    mediaId: media.id,
    name: `${fileStem(media.fileName)} ${formatTimecode(range.startFrame, fps)}`,
    startFrame: range.startFrame,
    endFrame: range.endFrame,
    sourceFps: fps,
    parentFrameCount: getParentFrameCount(media),
  })
  useTimelineSettingsStore.getState().markDirty()
  return subclip
}

export function renameSubclip(id: string, name: string): boolean {
  const renamed = useSubclipsStore.getState().rename(id, name)
  if (renamed) useTimelineSettingsStore.getState().markDirty()
  return renamed
}

/**
 * Opens a subclip in the source monitor the way a media card opens its file (the monitor mounts the
 * parent), with the subclip's range as the window (D2, D3). Without `withWindow` it opens the
 * original file whole ("Show original"). Does nothing for a subclip that is not valid (a window
 * that no longer fits the file), or, for the original, when the file is not in the library.
 */
export function openSubclipInSourceMonitor(
  subclip: Subclip,
  media: Pick<MediaMetadata, 'duration' | 'fps'> | undefined,
  { withWindow = true }: { withWindow?: boolean } = {},
): boolean {
  const validity = getSubclipValidity(subclip, media)
  // The original opens whole whenever it is in the library; the range needs to still fit it.
  if (withWindow ? !validity.valid : !media) return false
  const source = useSourcePlayerStore.getState()
  source.setCurrentMediaId(subclip.mediaId)
  if (withWindow) {
    source.setActiveSubclip(subclip.id, { start: subclip.startFrame, end: subclip.endFrame })
    source.setPendingSeekFrame(subclip.startFrame)
  } else {
    // setCurrentMediaId keeps the window when the file is already open.
    source.setActiveSubclip(null, null)
  }
  useEditorStore.getState().setSourcePreviewMediaId(subclip.mediaId)
  return true
}

/** Deletes subclip records and their posters. Clips already on the timeline are clips of the parent and stay. */
export function deleteSubclips(ids: readonly string[]): number {
  const removed = useSubclipsStore.getState().remove(ids)
  for (const id of ids) subclipPosters.release(id)
  forgetSourceMarks(ids)
  if (removed > 0) useTimelineSettingsStore.getState().markDirty()
  return removed
}

/**
 * The drag a subclip row starts: a `media-item` of the parent with the range (D4). `fileName` is
 * the clip's label, so the clip dropped on the timeline carries the subclip's name; `duration` is
 * the range's seconds, the length of the ghost.
 */
export function buildSubclipDragData(subclip: Subclip): DragData {
  const rate = toRate(subclip.sourceFps)
  return {
    type: 'media-item',
    mediaId: subclip.mediaId,
    mediaType: 'video',
    fileName: subclip.name,
    duration: frameToSeconds(rate, subclip.endFrame - subclip.startFrame),
    sourceStart: subclip.startFrame,
    sourceEnd: subclip.endFrame,
    subclipId: subclip.id,
  }
}
