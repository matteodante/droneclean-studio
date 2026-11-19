// @vitest-environment node

/**
 * The SDK's "done when" (task 2.1, design §4.10): a ten-clip project with
 * effects and transitions built through the SDK alone equals the same project
 * made by hand with the editor's own actions.
 *
 * The test opens the seeded project through the load path
 * (`hydrateTimelineStoresFromProject`) and seeds its media through
 * `seedMediaLibrary` once per build, so both sides start from exactly the same
 * stores. The hand-built side is `buildTenClipProjectByHand()` (the plan's
 * actions, in the UI's order); the SDK side drives `createStudio()` over the
 * same plan, one call at a time.
 *
 * Three assertions, as the design asks:
 *
 * 1. the two serialised timelines are deeply equal once ids are rewritten by
 *    creation order and the view fields are dropped;
 * 2. both undo histories end with the same number of entries, one per call;
 * 3. the ids the next call uses come out of the previous call's `changes`
 *    wherever the diff names them (a clip's add feeding its split, the split's
 *    new half feeding a trim, an effect's add feeding its update, a keyframe's
 *    add feeding its update, the range entity of `setIn` feeding `setOut`).
 *
 * The plan itself lives in `fixtures/ten-clip-by-hand.ts`, which both sides
 * read, so the two builds cannot disagree about what they were asked to do.
 */

import { describe, expect, it } from 'vite-plus/test'
import type { ProjectTimeline } from '@/types/project'
import { resetTimelineCompositionTestState } from '@/features/timeline/test-helpers'
import {
  buildTimelineFromStores,
  hydrateTimelineStoresFromProject,
} from '@/features/timeline/stores/timeline-persistence'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { seedMediaLibrary } from '@/headless/seed-media'
import { createStudio } from '../index'
import type { Changes, KeyframeProperty, Studio, TransactionResult } from '../types'
import {
  SEED_MEDIA,
  SEED_PROJECT,
  TEN_CLIP_CLIPS,
  TEN_CLIP_EFFECTS,
  TEN_CLIP_EFFECT_UPDATES,
  TEN_CLIP_KEYFRAMES,
  TEN_CLIP_KEYFRAME_UPDATE,
  TEN_CLIP_MARKERS,
  TEN_CLIP_RANGE,
  TEN_CLIP_SPEED,
  TEN_CLIP_SPLITS,
  TEN_CLIP_STEPS,
  TEN_CLIP_TITLE,
  TEN_CLIP_TRANSITIONS,
  TEN_CLIP_TRIMS,
  buildTenClipProjectByHand,
  effectKeyOf,
  keyframeProperty,
  type TenClipTrack,
} from './fixtures/ten-clip-by-hand'

// ---------------------------------------------------------------------------
// The starting point, twice
// ---------------------------------------------------------------------------

/**
 * Put the editor in the state of "the seeded project is open": the timeline
 * loaded through the load path, its media in the library, the project in the
 * project store (the drop and the text tool read its canvas), a history long
 * enough to hold the whole build, and no selection or playback left over from
 * the other build.
 */
async function seedEnvironment(): Promise<void> {
  resetTimelineCompositionTestState()
  useProjectStore.setState({ currentProject: SEED_PROJECT })
  useMediaLibraryStore.setState({ mediaItems: [], mediaById: {} })
  seedMediaLibrary(SEED_MEDIA.map((metadata) => ({ metadata })))
  // The build makes 66 edits; the app's default history holds 50, so a capped
  // history would make "both histories are the same length" prove nothing.
  useSettingsStore.getState().setSetting('maxUndoHistory', 200)
  useSelectionStore.getState().clearSelection()
  usePlaybackStore.getState().pause()
  usePlaybackStore.getState().setCurrentFrame(0)
  await hydrateTimelineStoresFromProject(SEED_PROJECT)
}

/** A clip as the serialised timeline holds it, with the `effects` its type omits. */
type PlannedItem = { id: string; effects?: Array<{ id: string }> }

/** The open project is the one the plan describes, not two empty timelines. */
function expectThePlannedProject(timeline: ProjectTimeline): void {
  // Ten dropped clips, two halves the splits added, and the title.
  expect(timeline.items).toHaveLength(TEN_CLIP_CLIPS.length + TEN_CLIP_SPLITS.length + 1)
  expect(timeline.transitions).toHaveLength(TEN_CLIP_TRANSITIONS.length)
  expect(timeline.markers).toHaveLength(TEN_CLIP_MARKERS.length)
  // Ten effects over eight clips.
  const items = timeline.items as PlannedItem[]
  expect(items.flatMap((item) => item.effects ?? [])).toHaveLength(TEN_CLIP_EFFECTS.length)
  expect(items.filter((item) => (item.effects ?? []).length > 0)).toHaveLength(
    new Set(TEN_CLIP_EFFECTS.map((effect) => effect.clip)).size,
  )
  const keyframes = (timeline.keyframes ?? []).flatMap((group) =>
    group.properties.flatMap((lane) => lane.keyframes),
  )
  expect(keyframes).toHaveLength(TEN_CLIP_KEYFRAMES.length)
  expect(timeline.inPoint).toBe(TEN_CLIP_RANGE.in)
  expect(timeline.outPoint).toBe(TEN_CLIP_RANGE.out)
}

// ---------------------------------------------------------------------------
// The SDK build
// ---------------------------------------------------------------------------

/**
 * The plan, through `createStudio()`. Each call is wrapped in
 * `studio.transaction` so the test can read its `changes`; the ids the next
 * call uses are read back out of those changes wherever the diff names the
 * entity, which is the third assertion of the design.
 */
function buildTenClipProjectThroughSdk(studio: Studio): number {
  let steps = 0
  const call = <T>(label: string, run: (sdk: Studio) => T): TransactionResult<T> => {
    steps += 1
    const result = studio.transaction(label, run)
    // Every SDK call that edits the timeline is one undo step (design §4.4).
    expect(result.changes.undoSteps).toBe(1)
    return result
  }

  const clipIds = new Map<string, string>()
  const clipAdds = new Map<string, Changes>()
  const splitAdds = new Map<string, Changes>()
  const effectIds = new Map<string, { id: string; type: string }>()
  const keyframeIds = new Map<string, { clip: string; property: KeyframeProperty; id: string }>()

  const clipIdOf = (key: string): string => {
    const id = clipIds.get(key)
    if (!id) throw new Error(`the SDK build placed no clip ${JSON.stringify(key)}`)
    return id
  }

  /** The clip `clips.add` reported in its `changes`, which the next call uses. */
  const addedClipId = (key: string): string => {
    const added = clipAdds.get(key)?.added.find((entity) => entity.kind === 'clip')
    if (!added) throw new Error(`the diff of clips.add named no clip for ${JSON.stringify(key)}`)
    expect(added.id).toBe(clipIdOf(key))
    return added.id
  }

  /** The half `clips.split` reported in its `changes`, which the next call uses. */
  const splitClipId = (key: string): string => {
    const added = splitAdds.get(key)?.added.find((entity) => entity.kind === 'clip')
    if (!added) throw new Error(`the diff of clips.split named no clip for ${JSON.stringify(key)}`)
    expect(added.id).toBe(clipIdOf(key))
    return added.id
  }

  const trackIds: Record<TenClipTrack, string> = {
    top: '',
    bottom: studio.tracks.list()[0]?.id ?? '',
  }
  if (!trackIds.bottom) throw new Error('the loaded project has no video track')
  const trackIdOf = (track: TenClipTrack): string => trackIds[track]

  // 1. A second video track at the top, exactly where the timeline's "Add
  //    video track" button puts it (position 0, order below the stack).
  const trackResult = call('TRACKS_ADD', (sdk) => sdk.tracks.add({ kind: 'video', position: 0 }))
  const addedTrack = trackResult.changes.added.find((entity) => entity.kind === 'track')
  expect(addedTrack).toEqual({ kind: 'track', id: trackResult.value })
  trackIds.top = addedTrack?.id as string

  // 2. The ten drops. `clips.add` builds the item like a media drop; there are
  //    no bytes in Node, so the clip carries `mediaId` and an empty source.
  for (const placement of TEN_CLIP_CLIPS) {
    const result = call('CLIPS_ADD', (sdk) =>
      sdk.clips.add({
        mediaId: placement.mediaId,
        trackId: trackIdOf(placement.track),
        from: placement.from,
        durationInFrames: placement.durationInFrames,
      }),
    )
    clipIds.set(placement.key, result.value)
    clipAdds.set(placement.key, result.changes)
    expect(result.changes.added).toEqual([{ kind: 'clip', id: result.value }])
  }

  // 3. Two splits, each taking its clip id from that clip's add `changes`.
  for (const split of TEN_CLIP_SPLITS) {
    const result = call('CLIPS_SPLIT', (sdk) =>
      sdk.clips.split(addedClipId(split.clip), split.frame),
    )
    const [left, right] = result.value
    const created = result.changes.added.find((entity) => entity.kind === 'clip')
    expect(created).toEqual({ kind: 'clip', id: right })
    expect(result.changes.updated.map((entity) => entity.id)).toContain(left)
    clipIds.set(split.rightKey, right)
    splitAdds.set(split.rightKey, result.changes)
  }

  // 4. Four trims. The SDK's `trimEnd` counts a positive amount as "shortens",
  //    the store's end handle as "extends", so the hands' sign flips here.
  for (const trim of TEN_CLIP_TRIMS) {
    const clipId = splitAdds.has(trim.clip) ? splitClipId(trim.clip) : addedClipId(trim.clip)
    if (trim.handle === 'start') {
      call('CLIPS_TRIM_START', (sdk) => sdk.clips.trimStart(clipId, trim.frames))
    } else {
      call('CLIPS_TRIM_END', (sdk) => sdk.clips.trimEnd(clipId, -trim.frames))
    }
  }

  // 5. One speed change.
  call('CLIPS_SET_SPEED', (sdk) =>
    sdk.clips.setSpeed(addedClipId(TEN_CLIP_SPEED.clip), TEN_CLIP_SPEED.speed),
  )

  // 6. Ten effects over eight clips. Each add names the effect as its own
  //    entity, and the clip whose `effects` field changed; the effect id the
  //    diff names is the one `effects.update` below uses.
  for (const effect of TEN_CLIP_EFFECTS) {
    const clipId = clipIdOf(effect.clip)
    const result = call('EFFECTS_ADD', (sdk) => sdk.effects.add(clipId, effect.type, effect.params))
    const created = result.changes.added.find((entity) => entity.kind === 'effect')
    expect(created).toEqual({ kind: 'effect', id: result.value, clip: clipId })
    effectIds.set(effect.key, { id: created?.id as string, type: effect.type })
    expect(result.changes.updated).toContainEqual({
      kind: 'clip',
      id: clipId,
      fields: ['effects'],
    })
  }

  // 7. Two effect edits: a parameter value and the enabled switch. Each names
  //    the effect and the field of its record that moved, and the clip too.
  const effectPlan = new Map(TEN_CLIP_EFFECTS.map((effect) => [effect.key, effect]))
  for (const update of TEN_CLIP_EFFECT_UPDATES) {
    const clipId = clipIdOf(effectPlan.get(update.effect)?.clip as string)
    const effectId = effectIds.get(update.effect)?.id as string
    const patch =
      update.params !== undefined ? { params: update.params } : { enabled: update.enabled }
    const result = call('EFFECTS_UPDATE', (sdk) => sdk.effects.update(clipId, effectId, patch))
    expect(result.changes.updated).toContainEqual({
      kind: 'effect',
      id: effectId,
      clip: clipId,
      fields: update.params !== undefined ? ['effect'] : ['enabled'],
    })
    expect(result.changes.updated).toContainEqual({
      kind: 'clip',
      id: clipId,
      fields: ['effects'],
    })
  }

  // 8. Eighteen keyframes; each add `changes` names the keyframe, which the
  //    dopesheet edit below uses.
  for (const keyframe of TEN_CLIP_KEYFRAMES) {
    const clipId = clipIdOf(keyframe.clip)
    const effectKey = effectKeyOf(keyframe)
    const property = keyframeProperty(
      keyframe,
      effectKey === undefined ? undefined : effectIds.get(effectKey),
    )
    const result = call('KEYFRAMES_ADD', (sdk) =>
      sdk.keyframes.add(clipId, property, keyframe.frame, keyframe.value, keyframe.easing),
    )
    const created = result.changes.added.find((entity) => entity.kind === 'keyframe')
    expect(created).toEqual({ kind: 'keyframe', id: result.value })
    keyframeIds.set(keyframe.key, {
      clip: clipId,
      property,
      id: created?.id as string,
    })
  }

  // 9. One keyframe edit, on the keyframe id the add reported.
  {
    const target = keyframeIds.get(TEN_CLIP_KEYFRAME_UPDATE.keyframe)
    if (!target) throw new Error('the dopesheet edit names a keyframe that was not added')
    const result = call('KEYFRAMES_UPDATE', (sdk) =>
      sdk.keyframes.update(target.clip, target.id, { value: TEN_CLIP_KEYFRAME_UPDATE.value }),
    )
    expect(result.changes.updated).toContainEqual({
      kind: 'keyframe',
      id: target.id,
      fields: ['value'],
    })
  }

  // 10. Nine crossfades on nine cuts.
  for (const transition of TEN_CLIP_TRANSITIONS) {
    const result = call('TRANSITIONS_ADD', (sdk) =>
      sdk.transitions.add({
        left: clipIdOf(transition.left),
        right: clipIdOf(transition.right),
        presentation: transition.presentation,
        durationInFrames: transition.durationInFrames,
        alignment: transition.alignment,
      }),
    )
    expect(result.changes.added).toEqual([{ kind: 'transition', id: result.value }])
  }

  // 11. Five markers.
  for (const frame of TEN_CLIP_MARKERS) {
    const result = call('MARKERS_ADD', (sdk) => sdk.markers.add({ frame }))
    expect(result.changes.added).toEqual([{ kind: 'marker', id: result.value }])
  }

  // 12. The end card.
  const titleResult = call('TITLES_ADD', (sdk) =>
    sdk.titles.add({
      trackId: trackIdOf(TEN_CLIP_TITLE.track),
      from: TEN_CLIP_TITLE.from,
      durationInFrames: TEN_CLIP_TITLE.durationInFrames,
      text: TEN_CLIP_TITLE.text,
    }),
  )
  expect(titleResult.changes.added).toEqual([{ kind: 'clip', id: titleResult.value }])

  // 13. The in/out range: the first point adds the range entity, and the second
  //     call's diff names that same entity.
  const inResult = call('MARKERS_SET_IN', (sdk) => sdk.markers.setIn(TEN_CLIP_RANGE.in))
  const range = inResult.changes.added.find((entity) => entity.kind === 'range')
  expect(range).toEqual({ kind: 'range', id: 'main' })
  const outResult = call('MARKERS_SET_OUT', (sdk) => sdk.markers.setOut(TEN_CLIP_RANGE.out))
  expect(outResult.changes.updated).toContainEqual({
    kind: 'range',
    id: range?.id,
    fields: ['outPoint'],
  })

  return steps
}

// ---------------------------------------------------------------------------
// Normalising the two projects for comparison
// ---------------------------------------------------------------------------

/** Fields of the serialised timeline that describe the view, not the project. */
const VIEW_FIELDS = new Set([
  'currentFrame',
  'zoomLevel',
  'scrollPosition',
  'createdAt',
  'lastModifiedAt',
  'src',
  'thumbnailUrl',
])

type JsonObject = Record<string, unknown>

interface PlainEntry extends JsonObject {
  id: string
}

interface PlainItem extends PlainEntry {
  trackId?: string
  originId?: string
  effects?: PlainEntry[]
}

interface PlainTransition extends PlainEntry {
  leftClipId?: string
  rightClipId?: string
  trackId?: string
}

interface PlainKeyframes extends JsonObject {
  itemId: string
  properties: Array<{ property: string; keyframes: PlainEntry[] }>
}

interface PlainTimeline extends JsonObject {
  items: PlainItem[]
  tracks: PlainEntry[]
  transitions?: PlainTransition[]
  keyframes?: PlainKeyframes[]
  markers?: PlainEntry[]
}

/** Remove the view fields from every object of the tree. */
function dropViewFields(value: unknown): void {
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      stack.push(...current)
      continue
    }
    if (current === null || typeof current !== 'object') continue
    const record = current as JsonObject
    for (const [key, entry] of Object.entries(record)) {
      if (VIEW_FIELDS.has(key)) {
        delete record[key]
        continue
      }
      stack.push(entry)
    }
  }
}

/**
 * The project as a comparison value: every id rewritten as
 * `<kind>:<creationOrder>` and the view fields dropped (design §4.10).
 *
 * The stores append, so an array's order is creation order. Effects keep their
 * order inside each clip; `originId`, the lineage a split shares with its
 * siblings, is renamed on first appearance so the sharing still compares; a
 * keyframe's effect-parameter lane (`effect:<type>:<effect id>:<param>`)
 * carries its effect id in the string and gets it rewritten too.
 */
function normaliseTimeline(source: ProjectTimeline): PlainTimeline {
  const timeline = JSON.parse(JSON.stringify(source)) as PlainTimeline

  const clipIds = new Map(timeline.items.map((item, index) => [item.id, `clip:${index}`]))
  const trackIds = new Map(timeline.tracks.map((track, index) => [track.id, `track:${index}`]))
  const transitionIds = new Map(
    (timeline.transitions ?? []).map((transition, index) => [transition.id, `transition:${index}`]),
  )
  const keyframeIds = new Map<string, string>()
  let keyframeIndex = 0
  for (const group of timeline.keyframes ?? []) {
    for (const lane of group.properties) {
      for (const keyframe of lane.keyframes) {
        keyframeIds.set(keyframe.id, `keyframe:${keyframeIndex++}`)
      }
    }
  }
  const markerIds = new Map(
    (timeline.markers ?? []).map((marker, index) => [marker.id, `marker:${index}`]),
  )
  const effectIds = new Map<string, string>()
  let effectIndex = 0
  for (const item of timeline.items) {
    for (const effect of item.effects ?? []) {
      effectIds.set(effect.id, `effect:${effectIndex++}`)
    }
  }
  const originIds = new Map<string, string>()
  for (const item of timeline.items) {
    if (item.originId !== undefined && !originIds.has(item.originId)) {
      originIds.set(item.originId, `origin:${originIds.size}`)
    }
  }

  const rename = (map: Map<string, string>, value: string | undefined): string | undefined =>
    value === undefined ? undefined : (map.get(value) ?? value)

  /** `effect:<gpu effect type>:<effect id>:<parameter>` carries the effect id. */
  const renameProperty = (property: string): string => {
    const [head, type, effect, ...rest] = property.split(':')
    if (head !== 'effect' || type === undefined || effect === undefined) return property
    return ['effect', type, rename(effectIds, effect), ...rest].join(':')
  }

  // References first, then the ids themselves.
  for (const item of timeline.items) {
    if (item.trackId !== undefined) item.trackId = rename(trackIds, item.trackId)
    if (item.originId !== undefined) item.originId = rename(originIds, item.originId)
    for (const effect of item.effects ?? []) effect.id = rename(effectIds, effect.id) as string
  }
  for (const transition of timeline.transitions ?? []) {
    if (transition.leftClipId !== undefined) {
      transition.leftClipId = rename(clipIds, transition.leftClipId)
    }
    if (transition.rightClipId !== undefined) {
      transition.rightClipId = rename(clipIds, transition.rightClipId)
    }
    if (transition.trackId !== undefined) transition.trackId = rename(trackIds, transition.trackId)
  }
  for (const group of timeline.keyframes ?? []) {
    group.itemId = rename(clipIds, group.itemId) as string
    for (const lane of group.properties) {
      lane.property = renameProperty(lane.property)
      for (const keyframe of lane.keyframes) {
        keyframe.id = rename(keyframeIds, keyframe.id) as string
      }
    }
  }
  for (const track of timeline.tracks) track.id = rename(trackIds, track.id) as string
  for (const transition of timeline.transitions ?? []) {
    transition.id = rename(transitionIds, transition.id) as string
  }
  for (const marker of timeline.markers ?? []) marker.id = rename(markerIds, marker.id) as string
  for (const item of timeline.items) item.id = rename(clipIds, item.id) as string

  dropViewFields(timeline)
  return timeline
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe('the ten-clip project', () => {
  it('built through the SDK equals the same project made by hand', async () => {
    // The hands: the plan's actions, in the UI's order.
    await seedEnvironment()
    const byHand = buildTenClipProjectByHand()
    const byHandTimeline = buildTimelineFromStores()
    const byHandHistory = useTimelineCommandStore.getState().undoStack.length

    // The SDK: the same plan, through `createStudio()`.
    await seedEnvironment()
    const studio = createStudio()
    const sdkSteps = buildTenClipProjectThroughSdk(studio)
    const sdkTimeline = buildTimelineFromStores()
    const sdkHistory = useTimelineCommandStore.getState().undoStack.length

    // Both projects are the planned one: 13 clips (ten dropped, two split
    // halves and the title), 9 transitions, 18 keyframes, 5 markers and one
    // in/out range.
    expectThePlannedProject(byHandTimeline)
    expectThePlannedProject(sdkTimeline)

    // No store object leaked into either project: both survive JSON as they are.
    expect(() => JSON.parse(JSON.stringify(byHandTimeline))).not.toThrow()
    expect(() => JSON.parse(JSON.stringify(sdkTimeline))).not.toThrow()

    // The two projects are the same project, once ids and view state are
    // rewritten (design §4.10).
    expect(normaliseTimeline(sdkTimeline)).toEqual(normaliseTimeline(byHandTimeline))

    // Both histories end with the same number of entries: one per edit, none
    // swallowed by a nested transaction and none added twice.
    expect(byHand.steps).toBe(TEN_CLIP_STEPS)
    expect(sdkSteps).toBe(TEN_CLIP_STEPS)
    expect(byHandHistory).toBe(TEN_CLIP_STEPS)
    expect(sdkHistory).toBe(TEN_CLIP_STEPS)
    expect(studio.history.depth()).toBe(TEN_CLIP_STEPS)
  })
})
