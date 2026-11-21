/**
 * Mark the beats of a clip: one timeline marker on each strong low-frequency
 * hit of the clip's audio, at the project frame where the hit plays.
 *
 * Shared by the clip's context menu and `studio.markers.addBeats`. The audio
 * is analysed over the clip's source span (its trim), and each hit is placed
 * with the timeline's own source-to-frame mapping, so speed, reversal and the
 * clip's position are respected exactly as the playhead plays them.
 */

import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { addMarker } from '@/features/timeline/stores/actions/marker-actions'
import {
  getItemSourceSpanSeconds,
  sourceSecondsToTimelineFrame,
} from '@/features/timeline/utils/media-item-frames'
import { requireClip } from '@/studio/sdk/context'
import { studioError } from '@/studio/sdk/errors'
import { transaction } from '@/studio/sdk/transaction'
import { analyzeMediaBeats } from './analyze'
import { normalizeBeatStrength } from './detect'

export interface MarkBeatsOptions {
  /** `0..1`; higher keeps fewer, stronger hits. Default 0.5. */
  strength?: number
}

/**
 * The project frames where hits at `sourceSeconds` (seconds of the media) play
 * on `item`: inside the clip, in order, each frame once.
 * @example beatFramesOnClip(clip, [1, 2], 30) // [30, 60] for an untrimmed clip at 0
 */
export function beatFramesOnClip(
  item: TimelineItem,
  sourceSeconds: readonly number[],
  timelineFps: number,
): number[] {
  const first = item.from
  const last = item.from + item.durationInFrames - 1
  const frames = new Set<number>()
  for (const seconds of sourceSeconds) {
    const frame = sourceSecondsToTimelineFrame(item, seconds, timelineFps)
    if (frame >= first && frame <= last) frames.add(frame)
  }
  return [...frames].toSorted((a, b) => a - b)
}

/**
 * Analyse the audio of a video or audio clip and answer the project frames of its beats, in order,
 * without writing anything. `markBeats` and the smooth edit of the whole timeline both start here;
 * the smooth edit adds the markers itself, inside its own undo step.
 * @throws StudioError NOT_FOUND when `clipId` is not a clip of the active context
 * @throws StudioError UNSUPPORTED when the clip has no audio source (a title, an image, a shape)
 * @throws StudioError MEDIA_UNAVAILABLE when the clip's audio cannot be loaded or decoded
 */
export async function findBeatFrames(
  clipId: string,
  options: MarkBeatsOptions = {},
  method = 'markers.addBeats',
): Promise<number[]> {
  const item = requireClip(clipId, method, 'clipId')
  if ((item.type !== 'video' && item.type !== 'audio') || !item.mediaId) {
    throw studioError({
      code: 'UNSUPPORTED',
      method,
      message: `clip ${clipId} is a ${item.type} clip; only video and audio clips carry audio to analyse`,
      hint: 'Pass the id of a video or audio clip.',
    })
  }
  const fps = useTimelineSettingsStore.getState().fps
  const span = getItemSourceSpanSeconds(item, fps)
  if (!span) return []

  let times: number[]
  try {
    times = await analyzeMediaBeats(item.mediaId, span, {
      strength: normalizeBeatStrength(options.strength),
    })
  } catch (error) {
    throw studioError({
      code: 'MEDIA_UNAVAILABLE',
      method,
      message: `the audio of clip ${clipId} could not be analysed: ${error instanceof Error ? error.message : String(error)}`,
      hint: 'Check that the clip has an audio track and that its file is available.',
    })
  }

  // The clip may have been edited or removed while the audio was decoding.
  const current = useItemsStore.getState().itemById[clipId]
  if (!current) {
    throw studioError({
      code: 'NOT_FOUND',
      method,
      message: `clip ${clipId} was removed while its audio was analysed`,
    })
  }
  return beatFramesOnClip(current, times, fps)
}

/**
 * Add one marker for each of `frames` that has none yet, with no undo entry of its own: the caller
 * owns the transaction. Answers the frames that got a marker.
 */
export function addBeatMarkers(frames: readonly number[]): number[] {
  const taken = new Set(useMarkersStore.getState().markers.map((marker) => marker.frame))
  const fresh = frames.filter((frame) => !taken.has(frame))
  for (const frame of fresh) addMarker(frame)
  return fresh
}

/**
 * Analyse the audio of a video or audio clip and add one marker per beat, as
 * one undo step. Resolves with the frames marked, in order; a frame that
 * already has a marker keeps it and is still listed.
 * @throws StudioError NOT_FOUND when `clipId` is not a clip of the active context
 * @throws StudioError UNSUPPORTED when the clip has no audio source (a title, an image, a shape)
 * @throws StudioError MEDIA_UNAVAILABLE when the clip's audio cannot be loaded or decoded
 */
export async function markBeats(clipId: string, options: MarkBeatsOptions = {}): Promise<number[]> {
  const frames = await findBeatFrames(clipId, options)
  const taken = new Set(useMarkersStore.getState().markers.map((marker) => marker.frame))
  if (frames.some((frame) => !taken.has(frame))) {
    transaction('MARKERS_ADD_BEATS', () => addBeatMarkers(frames))
  }
  return frames
}
