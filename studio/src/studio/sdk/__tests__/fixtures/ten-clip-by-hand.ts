/**
 * The ten-clip project, made by hand (design 2.1 §4.10).
 *
 * This module is the reference build the SDK test compares against. It makes the
 * same edits, in the same order, that the test drives through `studio`, but with
 * the store actions the editor's UI itself calls: the drop path for media, the
 * razor for splits, the trim handles, the rate-stretch handle, the effects
 * panel, the dopesheet, the transition edge, the marker button, the text tool
 * and the in/out range. Each step names the component or hook whose call it
 * copies.
 *
 * The plan below (`TEN_CLIP_*`) is the single source of truth for the inputs:
 * the test's SDK build reads the same arrays, so the two builds cannot drift on
 * what they ask for. Nothing here reaches into a store with `setState`; the
 * project is built out of the same actions the UI uses, which is what makes the
 * comparison mean something.
 */

import { getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects/registry'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import {
  addEffect,
  addItem,
  addKeyframe,
  addMarker,
  addTransition,
  rateStretchItem,
  setInPoint,
  setOutPoint,
  setTracks,
  splitItem,
  trimItemEnd,
  trimItemStart,
  updateEffect,
  updateKeyframe,
} from '@/features/timeline/stores/timeline-actions'
import { resolveDurationAndSpeed } from '@/features/timeline/hooks/use-rate-stretch'
import { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
import { buildDroppedMediaTimelineItem } from '@/features/timeline/utils/dropped-media'
import { createDefaultTextItem } from '@/features/timeline/utils/generated-layer-items'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { CURRENT_SCHEMA_VERSION } from '@/shared/projects/migrations/types'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import type { ItemEffect, VisualEffect } from '@/types/effects'
import type { AnimatableProperty, EasingType } from '@/types/keyframe'
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import type { KeyframeProperty } from '../../types'

// ---------------------------------------------------------------------------
// The project both builds start from
// ---------------------------------------------------------------------------

/** A track as a stored timeline holds it: `TimelineTrack` without its items. */
type StoredTrack = NonNullable<Project['timeline']>['tracks'][number]

/** The one video track the seeded project was saved with. */
const SEEDED_TRACK: StoredTrack = {
  id: 'track-v1',
  name: 'V1',
  kind: 'video',
  height: 64,
  locked: false,
  syncLock: true,
  visible: true,
  muted: false,
  solo: false,
  volume: 0,
  order: 0,
}

/**
 * The stored project the test opens through the load path
 * (`hydrateTimelineStoresFromProject`): 1920×1080 at 30 fps, with the one video
 * track a user saved. The load path installs V1 and A1 only for a project file
 * with no tracks at all, and the SDK can neither delete nor replace a track
 * stack, so the seeded file carries V1 and the build adds the second video
 * track on top of it — two video tracks, which is what a ten-clip project with
 * transitions at the cuts of both tracks needs.
 */
export const SEED_PROJECT: Project = {
  id: 'ten-clip-project',
  name: 'Ten clip project',
  description: '',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  duration: 0,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  metadata: { width: 1920, height: 1080, fps: 30 },
  timeline: {
    tracks: [SEEDED_TRACK],
    items: [],
    masterBusDb: 0,
  },
}

/** One 4K and one 1080p clip from a drone flight; no bytes, the library metadata only. */
export const SEED_MEDIA: readonly MediaMetadata[] = [
  {
    id: 'media-ridge',
    storageType: 'workspace',
    fileName: 'ridge.mp4',
    fileSize: 96_000_000,
    mimeType: 'video/mp4',
    duration: 10,
    width: 3840,
    height: 2160,
    fps: 30,
    codec: 'hevc',
    bitrate: 76_800_000,
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  },
  {
    id: 'media-valley',
    storageType: 'workspace',
    fileName: 'valley.mp4',
    fileSize: 42_000_000,
    mimeType: 'video/mp4',
    duration: 12,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 28_000_000,
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  },
]

// ---------------------------------------------------------------------------
// The plan: what the project is made of
// ---------------------------------------------------------------------------

/** The two tracks as the plan names them: the one added on top, the seeded one. */
export type TenClipTrack = 'top' | 'bottom'

/** One media drop: a clip of the media's kind, placed at `from`. */
export interface ClipPlacement {
  /** Name later steps use to point at this clip. */
  key: string
  mediaId: string
  track: TenClipTrack
  from: number
  durationInFrames: number
}

/**
 * Ten clips over the two video tracks: five 120-frame clips from `valley.mp4`
 * on the track added on top, five 150-frame clips from `ridge.mp4` on the
 * seeded one. Every clip was dropped at the end of the one before it, so each
 * track is a chain and its cuts can take a crossfade.
 */
export const TEN_CLIP_CLIPS: readonly ClipPlacement[] = [
  { key: 'valley-a', mediaId: 'media-valley', track: 'top', from: 0, durationInFrames: 120 },
  { key: 'valley-b', mediaId: 'media-valley', track: 'top', from: 120, durationInFrames: 120 },
  { key: 'valley-c', mediaId: 'media-valley', track: 'top', from: 240, durationInFrames: 120 },
  { key: 'valley-d', mediaId: 'media-valley', track: 'top', from: 360, durationInFrames: 120 },
  { key: 'valley-e', mediaId: 'media-valley', track: 'top', from: 480, durationInFrames: 120 },
  { key: 'ridge-a', mediaId: 'media-ridge', track: 'bottom', from: 0, durationInFrames: 150 },
  { key: 'ridge-b', mediaId: 'media-ridge', track: 'bottom', from: 150, durationInFrames: 150 },
  { key: 'ridge-c', mediaId: 'media-ridge', track: 'bottom', from: 300, durationInFrames: 150 },
  { key: 'ridge-d', mediaId: 'media-ridge', track: 'bottom', from: 450, durationInFrames: 150 },
  { key: 'ridge-e', mediaId: 'media-ridge', track: 'bottom', from: 600, durationInFrames: 150 },
]

/** One razor cut; `rightKey` names the half that keeps going on the right. */
export interface SplitStep {
  clip: string
  frame: number
  rightKey: string
}

/** Two splits: one on each track, both leaving handles on both halves. */
export const TEN_CLIP_SPLITS: readonly SplitStep[] = [
  { clip: 'ridge-b', frame: 240, rightKey: 'ridge-b2' },
  { clip: 'valley-c', frame: 300, rightKey: 'valley-c2' },
]

/**
 * One trim-handle drag, with the sign the handles use (`trim-utils.ts:41-42`):
 * a positive amount shrinks the start and extends the end.
 */
export interface TrimStep {
  clip: string
  handle: 'start' | 'end'
  frames: number
}

/**
 * Four trims: two shorten a clip, and the pair on `ridge-c`/`ridge-b2` moves
 * the cut by trimming the start and extending the clip before it, which gives
 * that cut a head handle and lets its crossfade sit centred.
 */
export const TEN_CLIP_TRIMS: readonly TrimStep[] = [
  { clip: 'ridge-a', handle: 'start', frames: 30 },
  { clip: 'valley-e', handle: 'end', frames: -24 },
  { clip: 'ridge-c', handle: 'start', frames: 15 },
  { clip: 'ridge-b2', handle: 'end', frames: 15 },
]

/** The one speed change: the last clip of the top track, slowed to half speed. */
export const TEN_CLIP_SPEED = { clip: 'valley-e', speed: 0.5 } as const

/** One effect instance the effects panel adds to a clip. */
export interface EffectStep {
  /** Name the effect update steps use to point at this instance. */
  key: string
  clip: string
  type: string
  params: Record<string, number>
}

/**
 * Ten effects over eight clips: a drone grade of brightness, contrast,
 * saturation, temperature, vignette, sharpen, grain, blur, exposure and
 * grayscale, with two clips carrying two effects.
 */
export const TEN_CLIP_EFFECTS: readonly EffectStep[] = [
  { key: 'ridge-a-brightness', clip: 'ridge-a', type: 'gpu-brightness', params: { amount: 0.05 } },
  {
    key: 'ridge-a-vignette',
    clip: 'ridge-a',
    type: 'gpu-vignette',
    params: { amount: 0.3, size: 0.45 },
  },
  { key: 'ridge-b-contrast', clip: 'ridge-b', type: 'gpu-contrast', params: { amount: 1.15 } },
  {
    key: 'ridge-b2-saturation', // gitleaks:allow: the effect's name, not a secret
    clip: 'ridge-b2',
    type: 'gpu-saturation',
    params: { amount: 1.2 },
  },
  {
    key: 'ridge-c-temperature',
    clip: 'ridge-c',
    type: 'gpu-temperature',
    params: { temperature: 0.15, tint: -0.05 },
  },
  {
    key: 'ridge-d-sharpen',
    clip: 'ridge-d',
    type: 'gpu-sharpen',
    params: { amount: 1.4, radius: 1.2 },
  },
  { key: 'valley-a-grain', clip: 'valley-a', type: 'gpu-grain', params: { amount: 0.06 } },
  {
    key: 'valley-a-blur',
    clip: 'valley-a',
    type: 'gpu-gaussian-blur',
    params: { radius: 4 },
  },
  { key: 'valley-b-exposure', clip: 'valley-b', type: 'gpu-exposure', params: { exposure: 0.2 } },
  { key: 'valley-c-grayscale', clip: 'valley-c', type: 'gpu-grayscale', params: { amount: 0.2 } },
]

/** One effect-panel edit: new parameter values, or the enabled switch. */
export interface EffectUpdateStep {
  effect: string
  params?: Record<string, number>
  enabled?: boolean
}

/** Two effect edits: a slider moved and an effect switched off. */
export const TEN_CLIP_EFFECT_UPDATES: readonly EffectUpdateStep[] = [
  { effect: 'ridge-b2-saturation', params: { amount: 1.35 } },
  { effect: 'ridge-a-vignette', enabled: false },
]

/** One keyframe the dopesheet adds, on a built-in property or an effect parameter. */
export interface KeyframeStep {
  /** Name the keyframe update step uses to point at this keyframe. */
  key: string
  clip: string
  /** A property of the clip, or `effect:<effect key>` + `param` for an effect lane. */
  property: AnimatableProperty | { effect: string; param: string }
  frame: number
  value: number
  easing?: EasingType
}

/**
 * Eighteen keyframes over five clips: fades and moves on the visual properties,
 * plus one effect-parameter lane whose property string carries the effect id.
 */
export const TEN_CLIP_KEYFRAMES: readonly KeyframeStep[] = [
  {
    key: 'ridge-a-opacity-in',
    clip: 'ridge-a',
    property: 'opacity',
    frame: 0,
    value: 0.4,
    easing: 'ease-in-out',
  },
  {
    key: 'ridge-a-opacity-mid',
    clip: 'ridge-a',
    property: 'opacity',
    frame: 60,
    value: 1,
    easing: 'ease-out',
  },
  {
    key: 'ridge-a-opacity-out',
    clip: 'ridge-a',
    property: 'opacity',
    frame: 119,
    value: 0.4,
    easing: 'linear',
  },
  {
    key: 'ridge-a-brightness-in',
    clip: 'ridge-a',
    property: { effect: 'ridge-a-brightness', param: 'amount' },
    frame: 20,
    value: 0.02,
    easing: 'linear',
  },
  {
    key: 'ridge-a-brightness-mid',
    clip: 'ridge-a',
    property: { effect: 'ridge-a-brightness', param: 'amount' },
    frame: 70,
    value: 0.08,
    easing: 'ease-in',
  },
  {
    key: 'ridge-a-brightness-out',
    clip: 'ridge-a',
    property: { effect: 'ridge-a-brightness', param: 'amount' },
    frame: 110,
    value: 0.02,
    easing: 'linear',
  },
  {
    key: 'ridge-b-x-in',
    clip: 'ridge-b',
    property: 'x',
    frame: 24,
    value: -60,
    easing: 'ease-out',
  },
  { key: 'ridge-b-x-mid', clip: 'ridge-b', property: 'x', frame: 45, value: 0, easing: 'linear' },
  { key: 'ridge-b-x-out', clip: 'ridge-b', property: 'x', frame: 89, value: 60, easing: 'ease-in' },
  {
    key: 'valley-b-y-in',
    clip: 'valley-b',
    property: 'y',
    frame: 30,
    value: -40,
    easing: 'ease-out',
  },
  { key: 'valley-b-y-mid', clip: 'valley-b', property: 'y', frame: 60, value: 0, easing: 'linear' },
  {
    key: 'valley-b-y-out',
    clip: 'valley-b',
    property: 'y',
    frame: 89,
    value: 40,
    easing: 'ease-in',
  },
  {
    key: 'valley-c2-opacity-in', // gitleaks:allow: the keyframe's name, not a secret
    clip: 'valley-c2',
    property: 'opacity',
    frame: 12,
    value: 0.5,
    easing: 'ease-in-out',
  },
  {
    key: 'valley-c2-opacity-mid', // gitleaks:allow: the keyframe's name, not a secret
    clip: 'valley-c2',
    property: 'opacity',
    frame: 30,
    value: 1,
    easing: 'ease-out',
  },
  {
    key: 'valley-c2-opacity-out', // gitleaks:allow: the keyframe's name, not a secret
    clip: 'valley-c2',
    property: 'opacity',
    frame: 48,
    value: 0.5,
    easing: 'linear',
  },
  {
    key: 'valley-e-x-in',
    clip: 'valley-e',
    property: 'x',
    frame: 24,
    value: -40,
    easing: 'ease-out',
  },
  { key: 'valley-e-x-mid', clip: 'valley-e', property: 'x', frame: 96, value: 0, easing: 'linear' },
  {
    key: 'valley-e-x-out',
    clip: 'valley-e',
    property: 'x',
    frame: 170,
    value: 40,
    easing: 'ease-in',
  },
]

/** The dopesheet edit: the middle `x` keyframe of `ridge-b` moves a little. */
export const TEN_CLIP_KEYFRAME_UPDATE = { keyframe: 'ridge-b-x-mid', value: 12 } as const

/** One transition dropped on the cut between two adjacent clips. */
export interface TransitionStep {
  left: string
  right: string
  durationInFrames: number
  presentation: 'fade'
  /** 0 puts the crossfade to the right of the cut, 0.5 centres it. */
  alignment: number
}

/**
 * Nine crossfades on nine of the ten cuts. The two centred ones sit on the cuts
 * the trims gave a head handle; the rest start at the cut and consume the
 * outgoing clip's tail, which every clip has because it was dropped shorter
 * than its source.
 */
export const TEN_CLIP_TRANSITIONS: readonly TransitionStep[] = [
  { left: 'ridge-a', right: 'ridge-b', durationInFrames: 24, presentation: 'fade', alignment: 0 },
  { left: 'ridge-b', right: 'ridge-b2', durationInFrames: 18, presentation: 'fade', alignment: 0 },
  {
    left: 'ridge-b2',
    right: 'ridge-c',
    durationInFrames: 30,
    presentation: 'fade',
    alignment: 0.5,
  },
  { left: 'ridge-c', right: 'ridge-d', durationInFrames: 24, presentation: 'fade', alignment: 0 },
  { left: 'ridge-d', right: 'ridge-e', durationInFrames: 30, presentation: 'fade', alignment: 0 },
  { left: 'valley-a', right: 'valley-b', durationInFrames: 24, presentation: 'fade', alignment: 0 },
  { left: 'valley-b', right: 'valley-c', durationInFrames: 30, presentation: 'fade', alignment: 0 },
  {
    left: 'valley-c',
    right: 'valley-c2',
    durationInFrames: 24,
    presentation: 'fade',
    alignment: 0.5,
  },
  {
    left: 'valley-c2',
    right: 'valley-d',
    durationInFrames: 20,
    presentation: 'fade',
    alignment: 0,
  },
]

/** Five markers, one on every other cut of the flight. */
export const TEN_CLIP_MARKERS: readonly number[] = [0, 150, 300, 450, 600]

/** The end card: a text clip after the last clip of the seeded track. */
export const TEN_CLIP_TITLE = {
  track: 'bottom',
  from: 750,
  durationInFrames: 90,
  text: 'Sunset Ridge',
} as const satisfies { track: TenClipTrack; from: number; durationInFrames: number; text: string }

/** The playback range the export and the timeline ruler show. */
export const TEN_CLIP_RANGE = { in: 60, out: 600 } as const

/**
 * Undo entries the plan makes: one per store action. The track, the clips, the
 * splits, the trims, the speed, the effects and their edits, the keyframes and
 * the keyframe edit, the transitions, the markers, the title and the two range
 * points.
 */
export const TEN_CLIP_STEPS =
  1 +
  TEN_CLIP_CLIPS.length +
  TEN_CLIP_SPLITS.length +
  TEN_CLIP_TRIMS.length +
  1 +
  TEN_CLIP_EFFECTS.length +
  TEN_CLIP_EFFECT_UPDATES.length +
  TEN_CLIP_KEYFRAMES.length +
  1 +
  TEN_CLIP_TRANSITIONS.length +
  TEN_CLIP_MARKERS.length +
  1 +
  2

/**
 * The keyframe's property string: a built-in property as it is, or an effect
 * parameter lane in the form `@/types/keyframe`'s `buildEffectAnimatableProperty`
 * writes it, `effect:<gpu effect type>:<effect id>:<parameter>`.
 */
export function keyframeProperty(
  step: KeyframeStep,
  effect: { id: string; type: string } | undefined,
): KeyframeProperty {
  if (typeof step.property === 'string') return step.property
  if (!effect) {
    throw new Error(
      `the keyframe plan names the effect ${step.property.effect}, which was not added`,
    )
  }
  return `effect:${effect.type}:${effect.id}:${step.property.param}` as KeyframeProperty
}

// ---------------------------------------------------------------------------
// The by-hand build
// ---------------------------------------------------------------------------

/** What a build produced: how many store actions it ran. */
export interface TenClipBuild {
  /** Store actions run, each of which is one undo entry. */
  steps: number
}

/** The ids a running build keeps, under the plan's names. */
interface BuildContext {
  canvas: { width: number; height: number }
  timelineFps: number
  trackIds: Record<TenClipTrack, string>
  clipIds: Map<string, string>
  effectIds: Map<string, { id: string; type: string }>
  keyframeIds: Map<string, { clip: string; property: KeyframeProperty; id: string }>
}

/** The canvas the drop and the text tool read (`timeline-track.tsx:325-331`). */
function currentCanvasSize(): { width: number; height: number } {
  const project = useProjectStore.getState().currentProject
  return {
    width: project?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
    height: project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
  }
}

/** A build's context, before anything is placed. */
function createBuildContext(): BuildContext {
  return {
    canvas: currentCanvasSize(),
    timelineFps: useTimelineSettingsStore.getState().fps,
    trackIds: { top: '', bottom: '' },
    clipIds: new Map(),
    effectIds: new Map(),
    keyframeIds: new Map(),
  }
}

/** The clip with this id, or a failure that names the plan's clip. */
function requireItem(id: string): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`the by-hand build has no clip ${JSON.stringify(id)}`)
  return item
}

/** The id of a clip the build made or split. */
function requireClipId(context: BuildContext, key: string): string {
  const id = context.clipIds.get(key)
  if (!id) throw new Error(`the by-hand build placed no clip ${JSON.stringify(key)}`)
  return id
}

/** The effect the build added, by its plan name. */
function requireEffect(context: BuildContext, key: string): { id: string; type: string } {
  const effect = context.effectIds.get(key)
  if (!effect) throw new Error(`the by-hand build added no effect ${JSON.stringify(key)}`)
  return effect
}

/**
 * A second video track on top: the timeline's "Add video track" button builds
 * it with `createClassicTrack` (`timeline.tsx:678-680`) and `addTrack` gives it
 * an order above the stack and puts it first (`use-timeline-tracks.ts:36-45`).
 */
function addVideoTrackOnTop(context: BuildContext): void {
  const tracks = useItemsStore.getState().tracks
  const seededTrack = tracks[0]
  if (!seededTrack) throw new Error('the seeded project has no video track')
  const minOrder = Math.min(...tracks.map((track) => track.order ?? 0))
  const newTrack = {
    ...createClassicTrack({ tracks, kind: 'video', order: 0 }),
    order: minOrder - 1,
  }
  setTracks([newTrack, ...tracks])
  context.trackIds.top = newTrack.id
  context.trackIds.bottom = seededTrack.id
}

/**
 * A media drop: the drop zone builds the item with
 * `buildDroppedMediaTimelineItem` (`timeline-media-drop-zone.tsx:307-317`) and
 * commits it with `addItem` (`drop-execution.ts:247-251`). There are no media
 * bytes in Node, so the source is empty and preview/export refill it from
 * `mediaId` (design §4.10).
 */
function dropMediaClip(context: BuildContext, placement: ClipPlacement): void {
  const media = SEED_MEDIA.find((candidate) => candidate.id === placement.mediaId)
  if (!media) throw new Error(`the seeded media has no ${placement.mediaId}`)
  const item = buildDroppedMediaTimelineItem({
    media,
    mediaId: media.id,
    mediaType: 'video',
    label: media.fileName,
    timelineFps: context.timelineFps,
    blobUrl: '',
    thumbnailUrl: null,
    canvasWidth: context.canvas.width,
    canvasHeight: context.canvas.height,
    placement: {
      trackId: context.trackIds[placement.track],
      from: placement.from,
      durationInFrames: placement.durationInFrames,
    },
  })
  addItem(item)
  context.clipIds.set(placement.key, item.id)
}

/** A razor cut (`use-timeline-item-pointer-handlers.ts:149`). */
function splitClip(context: BuildContext, split: SplitStep): void {
  const result = splitItem(requireClipId(context, split.clip), split.frame)
  if (!result) throw new Error(`the razor could not cut ${split.clip} at ${split.frame}`)
  context.clipIds.set(split.rightKey, result.rightItem.id)
}

/** A trim-handle drag with the handle's own sign (`use-timeline-trim.ts:954-960`). */
function trimClip(context: BuildContext, trim: TrimStep): void {
  const clipId = requireClipId(context, trim.clip)
  if (trim.handle === 'start') {
    trimItemStart(clipId, trim.frames)
  } else {
    trimItemEnd(clipId, trim.frames)
  }
}

/**
 * The rate-stretch end handle (`use-rate-stretch.ts:564-578`): the drag
 * proposes the longer duration and the solver returns the speed that keeps the
 * clip inside its source span.
 */
function stretchToSpeed(context: BuildContext): void {
  const item = requireItem(requireClipId(context, TEN_CLIP_SPEED.clip))
  const sourceFps = item.sourceFps ?? context.timelineFps
  const sourceStart = item.sourceStart ?? 0
  const sourceSpan = Math.max(
    1,
    (item.sourceEnd ?? item.sourceDuration ?? item.durationInFrames) - sourceStart,
  )
  const proposedDuration = Math.round(item.durationInFrames / TEN_CLIP_SPEED.speed)
  const resolved = resolveDurationAndSpeed(
    sourceSpan,
    proposedDuration,
    sourceFps,
    context.timelineFps,
  )
  rateStretchItem(item.id, item.from, resolved.duration, resolved.speed)
}

/**
 * One effect from the effects panel (`effects-section.tsx:151-166`): the panel
 * builds the type's definition and hands the whole `VisualEffect` to
 * `addEffect`, reading the instance back out of the clip afterwards. The plan's
 * parameter values travel in that same object: `effects.add` takes them at
 * creation, so they are set here rather than one slider update at a time.
 */
function addPlannedEffect(context: BuildContext, effect: EffectStep): void {
  const clipId = requireClipId(context, effect.clip)
  const visualEffect: VisualEffect = {
    type: 'gpu-effect',
    gpuEffectType: effect.type,
    params: { ...getGpuEffectDefaultParams(effect.type), ...effect.params },
  }
  addEffect(clipId, visualEffect)
  // The panel reads the instance it just added back out of the clip.
  const added = requireItem(clipId).effects?.at(-1)
  if (!added) throw new Error(`the effects panel added no ${effect.type} to ${effect.clip}`)
  context.effectIds.set(effect.key, { id: added.id, type: effect.type })
}

/** The clip and the effect instance an effect-panel edit touches. */
function effectInstance(
  context: BuildContext,
  effectKey: string,
): { clipId: string; entry: ItemEffect } {
  const plan = TEN_CLIP_EFFECTS.find((effect) => effect.key === effectKey)
  if (!plan) throw new Error(`the plan has no effect ${effectKey}`)
  const clipId = requireClipId(context, plan.clip)
  const effectId = requireEffect(context, effectKey).id
  const entry = requireItem(clipId).effects?.find((candidate) => candidate.id === effectId)
  if (!entry) throw new Error(`no clip carries the effect ${effectKey}`)
  return { clipId, entry }
}

/**
 * An effects-panel edit: a slider (`effects-section.tsx:239-245`) or the
 * enabled switch (`effects-section.tsx:395-400`), one of the two per step.
 */
function updatePlannedEffect(context: BuildContext, update: EffectUpdateStep): void {
  if ((update.params === undefined) === (update.enabled === undefined)) {
    throw new Error('an effect edit changes exactly one of its parameters or its switch')
  }
  const { clipId, entry } = effectInstance(context, update.effect)
  if (update.params !== undefined) {
    updateEffect(clipId, entry.id, {
      effect: { ...entry.effect, params: { ...entry.effect.params, ...update.params } },
    })
  } else {
    updateEffect(clipId, entry.id, { enabled: update.enabled })
  }
}

/** A keyframe from the dopesheet (`motion-dopesheet-content.tsx:1737`). */
function addPlannedKeyframe(context: BuildContext, keyframe: KeyframeStep): void {
  const clipId = requireClipId(context, keyframe.clip)
  const effectKey = effectKeyOf(keyframe)
  const property = keyframeProperty(
    keyframe,
    effectKey === undefined ? undefined : context.effectIds.get(effectKey),
  )
  addKeyframe(clipId, property, keyframe.frame, keyframe.value, keyframe.easing)
  const lane = useKeyframesStore
    .getState()
    .keyframesByItemId[clipId]?.properties.find((entry) => entry.property === property)
  const added = lane?.keyframes.find((entry) => entry.frame === keyframe.frame)
  if (!added) throw new Error(`the dopesheet added no keyframe ${keyframe.key}`)
  context.keyframeIds.set(keyframe.key, { clip: clipId, property, id: added.id })
}

/** A dopesheet edit of an existing keyframe (`motion-dopesheet-content.tsx:1734-1735`). */
function updatePlannedKeyframe(context: BuildContext): void {
  const target = context.keyframeIds.get(TEN_CLIP_KEYFRAME_UPDATE.keyframe)
  if (!target) throw new Error('the dopesheet edit names a keyframe that was not added')
  updateKeyframe(target.clip, target.property, target.id, {
    value: TEN_CLIP_KEYFRAME_UPDATE.value,
  })
}

/** A crossfade dropped on a cut (`use-timeline-item-drop-handlers.ts:181-190`). */
function addPlannedTransition(context: BuildContext, transition: TransitionStep): void {
  const added = addTransition(
    requireClipId(context, transition.left),
    requireClipId(context, transition.right),
    'crossfade',
    transition.durationInFrames,
    transition.presentation,
    undefined,
    transition.alignment,
  )
  if (!added) {
    throw new Error(`the transitions panel could not add a crossfade at ${transition.left}`)
  }
}

/** The end card: the text tool's default text item (`generated-layer-items.ts:99`), added. */
function addTitle(context: BuildContext): void {
  const title = createDefaultTextItem({
    trackId: context.trackIds[TEN_CLIP_TITLE.track],
    from: TEN_CLIP_TITLE.from,
    durationInFrames: TEN_CLIP_TITLE.durationInFrames,
    canvasWidth: context.canvas.width,
    canvasHeight: context.canvas.height,
    text: TEN_CLIP_TITLE.text,
  })
  addItem(title)
}

/**
 * Build the ten-clip project with the UI's own actions, in the UI's order: the
 * track, the drops, the splits, the trims, the speed, the effects, the
 * keyframes, the transitions, the markers, the title and the in/out range.
 */
export function buildTenClipProjectByHand(): TenClipBuild {
  const context = createBuildContext()
  let steps = 0

  addVideoTrackOnTop(context)
  steps += 1
  for (const placement of TEN_CLIP_CLIPS) {
    dropMediaClip(context, placement)
    steps += 1
  }
  for (const split of TEN_CLIP_SPLITS) {
    splitClip(context, split)
    steps += 1
  }
  for (const trim of TEN_CLIP_TRIMS) {
    trimClip(context, trim)
    steps += 1
  }
  stretchToSpeed(context)
  steps += 1
  for (const effect of TEN_CLIP_EFFECTS) {
    addPlannedEffect(context, effect)
    steps += 1
  }
  for (const update of TEN_CLIP_EFFECT_UPDATES) {
    updatePlannedEffect(context, update)
    steps += 1
  }
  for (const keyframe of TEN_CLIP_KEYFRAMES) {
    addPlannedKeyframe(context, keyframe)
    steps += 1
  }
  updatePlannedKeyframe(context)
  steps += 1
  for (const transition of TEN_CLIP_TRANSITIONS) {
    addPlannedTransition(context, transition)
    steps += 1
  }
  for (const frame of TEN_CLIP_MARKERS) {
    addMarker(frame)
    steps += 1
  }
  addTitle(context)
  steps += 1
  setInPoint(TEN_CLIP_RANGE.in)
  steps += 1
  setOutPoint(TEN_CLIP_RANGE.out)
  steps += 1

  return { steps }
}

/** The effect key a keyframe's effect lane points at, if it has one. */
export function effectKeyOf(keyframe: KeyframeStep): string | undefined {
  return typeof keyframe.property === 'string' ? undefined : keyframe.property.effect
}
