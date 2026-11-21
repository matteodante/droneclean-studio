/**
 * The smooth edit of the whole timeline, in one action: the video clips are laid end to end from the song's
 * first downbeat, each cut to a number of bars, each given the smooth-edit look, with a short crossfade at
 * each cut.
 *
 * It is what an agent did clip by clip through the SDK (beat markers, shots one bar long, `applySmoothEdit`,
 * crossfades), minus the choice of which part of each clip to use: a clip keeps the in-point it has. The
 * panel's dialog and `studio.clips.smoothEditTimeline` both call it, so a click and a script lay out the
 * same timeline.
 *
 * The beats are found first, off the main thread (`findBeatFrames`, which writes nothing); everything after
 * is one synchronous transaction, so the whole edit is one undo step and a failure puts the project back.
 * Nothing is deleted: a clip that cannot take a shot (too little footage, a reversed clip) is left as it is,
 * with the clips that would start after the song's end, and goes after the last shot.
 */

import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import {
  moveItems,
  removeTransition,
  trimItemEnd,
} from '@/features/timeline/stores/timeline-actions'
import { resetSpeedWithRipple } from '@/features/timeline/stores/actions/edit/rate-stretch-actions'
import { getSynchronizedLinkedItemsForEdit } from '@/features/timeline/stores/actions/linked-edit'
import {
  sourceToTimelineFrames,
  timelineToSourceFrames,
} from '@/features/timeline/utils/source-calculations'
import { addBeatMarkers, findBeatFrames } from '@/studio/beats/mark'
import { applySpeedCurve } from '@/studio/speed/actions'
import { averageSpeed } from '@/studio/speed/curve'
import { createTransitionsApi } from '@/studio/sdk/namespaces/transitions'
import { requireClip } from '@/studio/sdk/context'
import { studioError, type StudioError } from '@/studio/sdk/errors'
import { transaction } from '@/studio/sdk/transaction'
import type { Frame, SmoothEditTimelineOptions, SmoothEditTimelineResult } from '@/studio/sdk/types'
import { canHoldSmoothEdit, smoothEditClip, smoothEditLength } from './action'
import { smoothEditCurve, SMOOTH_EDIT_DEFAULTS } from './curve'
import { planSmoothEdit, SMOOTH_SHOT_BARS, type PlanClip, type SmoothPlan } from './plan'

const METHOD = 'clips.smoothEditTimeline'

/** The crossfade's length, in seconds: short enough to read as a cut with a soft edge. */
const SMOOTH_CROSSFADE_SECONDS = 0.25

/** One candidate song: an audio clip that is not the sound of a video clip. */
export interface SongInfo {
  id: string
  label: string
  from: Frame
  durationInFrames: number
}

/** What the dialog shows before anything is applied. */
export interface SmoothEditPreview {
  plan: SmoothPlan
  /** The video clips the edit looked at, in the order they play. */
  clipCount: number
  /** The clips that cannot take the smooth edit at all (reversed, or no speed curve), left as they are. */
  unsupported: string[]
}

function timelineFps(): number {
  return useTimelineSettingsStore.getState().fps
}

/** The audio clips that are songs: not the sound a video clip carries, longest first. */
export function listSongs(): SongInfo[] {
  const items = useItemsStore.getState().items
  const videoGroups = new Set(
    items.filter((item) => item.type === 'video' && item.linkedGroupId).map((item) => item.linkedGroupId),
  )
  return items
    .filter(
      (item) =>
        item.type === 'audio' &&
        item.mediaId !== undefined &&
        !(item.linkedGroupId !== undefined && videoGroups.has(item.linkedGroupId)),
    )
    .toSorted((a, b) => b.durationInFrames - a.durationInFrames || a.from - b.from)
    .map((item) => ({ id: item.id, label: item.label, from: item.from, durationInFrames: item.durationInFrames }))
}

/** The video clips of the timeline in the order they play. */
function videoClips(): TimelineItem[] {
  return useItemsStore
    .getState()
    .items.filter((item) => item.type === 'video')
    .toSorted((a, b) => a.from - b.from || a.trackId.localeCompare(b.trackId))
}

/** The source rate of a clip: its file's, else the project's. */
function sourceRateOf(item: TimelineItem): number {
  return item.sourceFps ?? timelineFps()
}

/** The frames a clip's footage plays at normal speed from its in-point to the end of its file. */
function availableFrames(item: TimelineItem): number {
  const start = item.sourceStart ?? 0
  const end = item.sourceDuration ?? item.sourceEnd
  if (end === undefined) return item.durationInFrames
  return sourceToTimelineFrames(Math.max(0, end - start), 1, sourceRateOf(item), timelineFps())
}

/** The source frames a clip plays now: its trim window. */
function sourceSpanOf(item: TimelineItem): number {
  const start = item.sourceStart ?? 0
  if (item.sourceEnd !== undefined) return Math.max(1, item.sourceEnd - start)
  return Math.max(
    1,
    timelineToSourceFrames(item.durationInFrames, item.speed ?? 1, timelineFps(), sourceRateOf(item)),
  )
}

/**
 * The length, at normal speed, a clip must have before the recipe so that the recipe leaves it `shotFrames`
 * long: the shot's length times the curve's average speed, then the nearest whole frame that the recipe's own
 * arithmetic turns into exactly `shotFrames`.
 */
export function startLengthFor(shotFrames: number, sourceFps: number, projectFps: number): number {
  const { peak, slow } = SMOOTH_EDIT_DEFAULTS
  const shape = smoothEditCurve(shotFrames, peak, slow)
  const guess = Math.max(4, Math.round(shotFrames * averageSpeed(shape)))
  const lengthAt = (start: number): number =>
    smoothEditLength(start, timelineToSourceFrames(start, 1, projectFps, sourceFps), sourceFps, projectFps)
  for (const offset of [0, 1, -1, 2, -2, 3, -3]) {
    const start = guess + offset
    if (start >= 4 && lengthAt(start) === shotFrames) return start
  }
  return guess
}

/** The plan for a song's beats over the clips now on the timeline. */
export function previewSmoothEdit(songId: string, beats: readonly number[], bars: number): SmoothEditPreview {
  const song = useItemsStore.getState().itemById[songId]
  const fps = timelineFps()
  const clips = videoClips()
  const unsupported = clips.filter((clip) => !canHoldSmoothEdit(clip)).map((clip) => clip.id)
  const planClips: PlanClip[] = clips
    .filter((clip) => canHoldSmoothEdit(clip))
    .map((clip) => ({ id: clip.id, availableFrames: availableFrames(clip) }))
  const byId = new Map(clips.map((clip) => [clip.id, clip]))
  const plan = planSmoothEdit({
    beats,
    songEnd: song === undefined ? 0 : song.from + song.durationInFrames,
    bars,
    clips: planClips,
    footageFor: (shotFrames, clipId) => startLengthFor(shotFrames, sourceRateOf(byId.get(clipId)!), fps),
  })
  return { plan, clipCount: clips.length, unsupported }
}

/** Move a clip and the clips linked to it (its sound) so that the clip starts at `to`. */
function moveGroup(id: string, to: number, trackId?: string): void {
  const items = useItemsStore.getState().items
  const anchor = items.find((item) => item.id === id)
  if (anchor === undefined) return
  const delta = to - anchor.from
  moveItems(
    getSynchronizedLinkedItemsForEdit(items, id, true).map((item) => ({
      id: item.id,
      from: item.from + delta,
      ...(item.id === id && trackId !== undefined ? { trackId } : {}),
    })),
  )
}

function stored(id: string): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  if (item === undefined) throw studioError({ code: 'NOT_FOUND', method: METHOD, message: `clip ${id} is gone` })
  return item
}

/**
 * Cut a clip so that the recipe leaves it `shotFrames` long: normal speed, then the footage the recipe's own
 * arithmetic needs, nudged a frame at a time if the file's rate made the first guess miss. The in-point stays.
 */
function prepareClip(id: string, shotFrames: number): void {
  if (stored(id).speedCurve !== undefined) applySpeedCurve(id, null)
  if (Math.abs((stored(id).speed ?? 1) - 1) > 1e-9) resetSpeedWithRipple([id])
  const fps = timelineFps()
  let start = startLengthFor(shotFrames, sourceRateOf(stored(id)), fps)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const delta = start - stored(id).durationInFrames
    // The store's end handle reads a positive amount as "extend".
    if (delta !== 0) trimItemEnd(id, delta)
    const item = stored(id)
    const got = smoothEditLength(item.durationInFrames, sourceSpanOf(item), sourceRateOf(item), fps)
    if (got === shotFrames) return
    start += got < shotFrames ? 1 : -1
  }
}

/** A crossfade at the cut between two shots; false when the clips have no footage to fade with. */
function crossfade(left: string, right: string, frames: number): boolean {
  const transitions = createTransitionsApi()
  const tries: Array<{ durationInFrames: number; alignment?: number }> = []
  for (const durationInFrames of [frames, Math.floor(frames / 2)]) {
    if (durationInFrames < 1) continue
    tries.push({ durationInFrames }, { durationInFrames, alignment: 0 }, { durationInFrames, alignment: 1 })
  }
  for (const attempt of tries) {
    try {
      transitions.add({ left, right, presentation: 'fade', ...attempt })
      return true
    } catch {
      // No handle for this alignment or length: try the next.
    }
  }
  return false
}

/** Remove the transitions of the old layout that touch a clip about to move: they would break at the first move. */
function removeTransitionsOf(touched: ReadonlySet<string>): void {
  for (const transition of useTransitionsStore.getState().transitions) {
    if (touched.has(transition.leftClipId) || touched.has(transition.rightClipId)) {
      removeTransition(transition.id)
    }
  }
}

/** Park every clip far apart, past everything, so cutting one never meets another and a move never overlaps. */
function parkClips(ids: readonly string[], songEnd: number): void {
  const items = useItemsStore.getState().items
  const farthest = Math.max(songEnd, ...items.map((item) => item.from + item.durationInFrames))
  const room =
    Math.max(...ids.map((id) => availableFrames(stored(id)) + stored(id).durationInFrames)) + 100
  ids.forEach((id, index) => {
    moveGroup(id, farthest + 1000 + index * room)
  })
}

/** Cut each planned clip to its shot, give it the look and put it on its beat, on one track. */
function layShots(shots: SmoothPlan['shots'], track: string): void {
  for (const shot of shots) {
    prepareClip(shot.clipId, shot.durationInFrames)
    smoothEditClip(shot.clipId)
    const over = stored(shot.clipId).durationInFrames - shot.durationInFrames
    if (over > 0) trimItemEnd(shot.clipId, -over)
    moveGroup(shot.clipId, shot.from, track)
  }
}

/** Put the clips that were not cut one after the other from `start`, as they were. */
function layLeftovers(ids: readonly string[], start: number): void {
  let next = start
  for (const id of ids) {
    moveGroup(id, next)
    next += stored(id).durationInFrames
  }
}

/** A crossfade at each cut between shots that meet; answers how many cuts got one. */
function crossfadeCuts(shots: SmoothPlan['shots'], frames: number): number {
  let added = 0
  for (let index = 1; index < shots.length; index += 1) {
    const left = stored(shots[index - 1]!.clipId)
    const right = stored(shots[index]!.clipId)
    if (left.from + left.durationInFrames === right.from && crossfade(left.id, right.id, frames)) {
      added += 1
    }
  }
  return added
}

/** The plan with a reason it has no shot, as the error says it. */
function emptyPlanError(plan: SmoothPlan, songId: string): StudioError {
  return studioError({
    code: 'CONFLICT',
    method: METHOD,
    message:
      plan.beatFrames <= 0
        ? `no beats were found in clip ${JSON.stringify(songId)}, so there is nothing to cut to`
        : 'no video clip fits a shot before the end of the song',
    hint: 'Pick a song with a clear beat, put video clips with enough footage on the timeline, or choose shorter shots.',
  })
}

/**
 * Lay the plan on the timeline: one undo step, the beats marked, the shots placed and given the look.
 * @throws StudioError CONFLICT when the plan has no shot
 */
export function applySmoothPlan(
  songId: string,
  beats: readonly number[],
  bars: number,
  options: { crossfade: boolean },
): SmoothEditTimelineResult {
  const song = requireClip(songId, METHOD, 'songId')
  const preview = previewSmoothEdit(songId, beats, bars)
  const { plan } = preview
  if (plan.shots.length === 0) throw emptyPlanError(plan, songId)
  const crossfadeFrames = Math.max(1, Math.round(timelineFps() * SMOOTH_CROSSFADE_SECONDS))
  const songEnd = song.from + song.durationInFrames
  const baseTrack = stored(plan.shots[0]!.clipId).trackId

  const { value: crossfades } = transaction('CLIPS_SMOOTH_EDIT_TIMELINE', () => {
    addBeatMarkers(beats)
    const shotIds = plan.shots.map((shot) => shot.clipId)
    const leftoverIds = videoClips()
      .map((clip) => clip.id)
      .filter((id) => !shotIds.includes(id))
    removeTransitionsOf(new Set([...shotIds, ...leftoverIds]))
    parkClips([...shotIds, ...leftoverIds], songEnd)
    layShots(plan.shots, baseTrack)
    layLeftovers(
      leftoverIds,
      Math.max(songEnd, ...plan.shots.map((shot) => shot.from + shot.durationInFrames)),
    )
    return options.crossfade ? crossfadeCuts(plan.shots, crossfadeFrames) : 0
  })

  return {
    songId,
    bars,
    beats: beats.length,
    firstDownbeat: plan.firstDownbeat,
    shots: plan.shots.map((shot) => {
      const item = stored(shot.clipId)
      return { clipId: shot.clipId, from: item.from, durationInFrames: item.durationInFrames }
    }),
    crossfades,
    tooShort: plan.tooShort,
    unsupported: preview.unsupported,
    afterSong: plan.afterSong,
  }
}

/** The song `songId` names, or the longest song on the timeline. */
function resolveSong(songId: string | undefined): SongInfo {
  const songs = listSongs()
  const found = songId === undefined ? songs[0] : songs.find((song) => song.id === songId)
  if (found !== undefined) return found
  if (songId !== undefined) {
    requireClip(songId, METHOD, 'songId')
    throw studioError({
      code: 'UNSUPPORTED',
      method: METHOD,
      argument: 'songId',
      message: `clip ${JSON.stringify(songId)} is not an audio clip of a song`,
      hint: 'Pass the id of an audio clip, or leave songId out to use the longest one.',
    })
  }
  throw studioError({
    code: 'CONFLICT',
    method: METHOD,
    message: 'there is no song on the timeline: no audio clip to cut to',
    hint: 'Add a song to the timeline first.',
  })
}

/** Whether a number of bars is one the edit offers. */
export function isShotBars(value: unknown): value is (typeof SMOOTH_SHOT_BARS)[number] {
  return SMOOTH_SHOT_BARS.some((bars) => bars === value)
}

/**
 * Find the song's beats, then lay out the timeline: what `studio.clips.smoothEditTimeline` and the dialog's
 * Apply run. Resolves with what was laid out.
 */
export async function smoothEditTimeline(
  options: SmoothEditTimelineOptions = {},
): Promise<SmoothEditTimelineResult> {
  const bars = options.bars ?? 1
  const crossfadeOn = options.crossfade ?? true
  const song = resolveSong(options.songId)
  const beats = await findBeatFrames(song.id, {}, METHOD)
  return applySmoothPlan(song.id, beats, bars, { crossfade: crossfadeOn })
}
