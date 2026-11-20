/**
 * "What changed": the structural diff a call returns (design §4.6).
 *
 * The diff is built from `buildTimelineFromStores()` — the same serialised form
 * `saveTimeline` writes — plus the open project's metadata, and compares the
 * collections one entry at a time by JSON. It names the entities, not their
 * contents, so an agent can say "clip `c1` changed its `volume`" without
 * reading the whole project.
 *
 * Keyframes are flattened to one entry per keyframe (scalar and vector lanes),
 * because `studio.keyframes.add` hands out the keyframe's own id. Effects are
 * flattened out of the clips that carry them: `clips.split` copies a clip's
 * effects and both halves keep the same effect ids, so an effect is identified
 * by its clip and its id together, and the two halves' effects are two entries.
 * A change to an effect also changes its clip's `effects` field, so the clip is
 * reported too. The in/out points are one entity of kind `range`, whose id
 * names the context (`main` on the Main timeline, the composition id inside a
 * composition): it appears when its first point is set, disappears when its
 * last point is cleared, and reports the `inPoint` / `outPoint` field that
 * moved. Project metadata is one entity of kind `project`. A call that opens another project (or the first one)
 * names only the project that closed and the one that opened, never their contents.
 */

import type { ItemEffect } from '@/types/effects'
import type { ItemKeyframes } from '@/types/keyframe'
import type { Project, ProjectTimeline } from '@/types/project'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { buildTimelineFromStores } from '@/features/timeline/stores/timeline-persistence'
import { getTimelineContext } from './context'
import type { Changes, EntityKind, EntityRef } from './types'

/**
 * Project metadata as the diff compares it.
 * @internal
 */
export interface ProjectMetadataSnapshot {
  /** Id of the project. */
  id: string
  /** Canvas width in pixels. */
  width: number
  /** Canvas height in pixels. */
  height: number
  /** Frame rate as a plain number (the stored form). */
  fps: number
  /** Canvas background colour, `#000000` when unset. */
  backgroundColor: string
}

/** One collection entry: anything with an id. */
interface CollectionEntry {
  id: string
}

/**
 * The in/out range of the active context: its entity id and its two points.
 * @internal
 */
export interface RangeSnapshot {
  /** `main` on the Main timeline, the composition id inside a composition. */
  id: string
  /** In point, or null when unset. */
  in: number | null
  /** Out point, or null when unset. */
  out: number | null
}

/**
 * The state the diff compares. Captured before and after a transaction.
 * @internal
 */
export interface ChangeBaseline {
  /** Tracks of the active context. */
  tracks: readonly CollectionEntry[]
  /** Clips of the active context. */
  items: readonly CollectionEntry[]
  /** Transitions of the active context. */
  transitions: readonly CollectionEntry[]
  /** Keyframes of the active context, flattened to one entry per keyframe. */
  keyframes: readonly CollectionEntry[]
  /** Effects of the active context's clips, flattened to one entry per effect. */
  effects: readonly FlatEffect[]
  /** Markers of the active context. */
  markers: readonly CollectionEntry[]
  /** The in/out range of the active context. */
  range: RangeSnapshot
  /** Project metadata, or null when no project is open. */
  project: ProjectMetadataSnapshot | null
}

/** The slice of a built timeline that belongs to the active editing context. */
interface TimelineCollections {
  tracks: CollectionEntry[]
  items: CollectionEntry[]
  transitions: CollectionEntry[]
  keyframes: CollectionEntry[]
  effects: FlatEffect[]
  markers: CollectionEntry[]
  /** `main` on the Main timeline, the composition id inside a composition. */
  rangeId: string
  /** In point of the context, or null when unset. */
  inPoint: number | null
  /** Out point of the context, or null when unset. */
  outPoint: number | null
}

/** One keyframe of an item, flattened out of its property lane. */
type FlatKeyframe = CollectionEntry

/** One entry per keyframe, scalar and vector lanes alike. */
function flattenKeyframes(groups: readonly ItemKeyframes[]): FlatKeyframe[] {
  const keyframes: FlatKeyframe[] = []
  for (const group of groups) {
    for (const property of group.properties) {
      keyframes.push(...property.keyframes)
    }
    for (const property of group.vectorProperties ?? []) {
      keyframes.push(...property.keyframes)
    }
  }
  return keyframes
}

/**
 * One effect of a clip: the stored record, and the id of the clip that carries
 * it. The diff compares `record`; the clip is part of the identity (see
 * {@link effectIdentity}), because `clips.split` copies a clip's effects and
 * both halves keep the same effect ids.
 */
interface FlatEffect extends CollectionEntry {
  /** Id of the clip that carries the effect. */
  clipId: string
  /** The stored effect: the fields a change reports. */
  record: ItemEffect
}

/**
 * The part of a serialised item the effects diff reads: `ProjectTimeline`'s
 * item type omits `effects` although the serialised items carry them.
 */
interface EffectCarrier {
  id: string
  effects?: readonly ItemEffect[]
}

/** One entry per effect, with the id of the clip it belongs to. */
function flattenEffects(items: readonly EffectCarrier[]): FlatEffect[] {
  const effects: FlatEffect[] = []
  for (const item of items) {
    for (const effect of item.effects ?? []) {
      effects.push({ id: effect.id, clipId: item.id, record: effect })
    }
  }
  return effects
}

/**
 * Identity of one effect: its clip and its own id together. Ids are UUIDs and
 * contain no NUL, so the separator cannot make two pairs collide.
 */
function effectIdentity(effect: FlatEffect): string {
  return `${effect.clipId}\u0000${effect.id}`
}

/**
 * The reference `changes` reports for one effect: the SDK addresses an effect
 * as `(clip, effect)`, so the clip is part of it.
 */
function effectRef(effect: FlatEffect): EntityRef {
  return { kind: 'effect', id: effect.id, clip: effect.clipId }
}

/** The Main timeline's own collections. */
function mainCollections(timeline: ProjectTimeline): TimelineCollections {
  return {
    tracks: timeline.tracks,
    items: timeline.items,
    transitions: timeline.transitions ?? [],
    keyframes: flattenKeyframes(timeline.keyframes ?? []),
    effects: flattenEffects(timeline.items),
    markers: timeline.markers ?? [],
    rangeId: 'main',
    inPoint: timeline.inPoint ?? null,
    outPoint: timeline.outPoint ?? null,
  }
}

/** The collections of one open composition. */
function compositionCollections(
  timeline: ProjectTimeline,
  compositionId: string,
): TimelineCollections {
  // A composition that is open for editing replaces the stored content with
  // the live stores inside `buildTimelineFromStores` (`getEffectiveCompositions`).
  const composition = timeline.compositions?.find((candidate) => candidate.id === compositionId)
  if (!composition) {
    return {
      tracks: [],
      items: [],
      transitions: [],
      keyframes: [],
      effects: [],
      markers: [],
      rangeId: compositionId,
      inPoint: null,
      outPoint: null,
    }
  }
  return {
    tracks: composition.tracks,
    items: composition.items,
    transitions: composition.transitions ?? [],
    keyframes: flattenKeyframes(composition.keyframes ?? []),
    effects: flattenEffects(composition.items),
    markers: composition.markers ?? [],
    rangeId: compositionId,
    inPoint: composition.inPoint ?? null,
    outPoint: composition.outPoint ?? null,
  }
}

/** The collections the active context reads and writes. */
function activeCollections(timeline: ProjectTimeline): TimelineCollections {
  const context = getTimelineContext()
  if (context.kind === 'main') return mainCollections(timeline)
  return compositionCollections(timeline, context.id)
}

/** Project metadata from the open project, or null. */
function projectMetadata(project: Project | null): ProjectMetadataSnapshot | null {
  if (!project) return null
  return {
    id: project.id,
    width: project.metadata.width,
    height: project.metadata.height,
    fps: project.metadata.fps,
    backgroundColor: project.metadata.backgroundColor ?? '#000000',
  }
}

/**
 * Snapshot what the next call can change: the active context's timeline and the
 * open project. Two baselines are compared with {@link diffChangeBaselines}.
 * @internal
 */
export function captureChangeBaseline(): ChangeBaseline {
  const collections = activeCollections(buildTimelineFromStores())
  const project = useProjectStore.getState().currentProject
  return {
    tracks: collections.tracks,
    items: collections.items,
    transitions: collections.transitions,
    keyframes: collections.keyframes,
    effects: collections.effects,
    markers: collections.markers,
    range: {
      id: collections.rangeId,
      in: collections.inPoint,
      out: collections.outPoint,
    },
    project: projectMetadata(project),
  }
}

/** Names of the top-level fields whose value differs between two entries. */
function changedFields(previous: object, next: object): string[] {
  const keys = new Set<string>([...Object.keys(next), ...Object.keys(previous)])
  const fields: string[] = []
  for (const key of keys) {
    const beforeValue = (previous as Record<string, unknown>)[key]
    const afterValue = (next as Record<string, unknown>)[key]
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      fields.push(key)
    }
  }
  return fields
}

/** How `diffCollection` names and compares the entries of one collection. */
interface CollectionDiff<Entry extends CollectionEntry> {
  /** Key two entries are the same entity by; the id itself when absent. */
  identity?: (entry: Entry) => string
  /** Reference a change reports for an entry; `{kind, id}` when absent. */
  refOf?: (entry: Entry) => EntityRef
  /** Part of the entry the diff compares; the whole entry when absent. */
  recordOf?: (entry: Entry) => object
}

/**
 * Compare one collection and append its added, removed and updated entries.
 * `options` says how the collection's entries are matched, compared and named.
 */
function diffCollection<Entry extends CollectionEntry>(
  kind: EntityKind,
  before: readonly Entry[],
  after: readonly Entry[],
  changes: Pick<Changes, 'added' | 'removed' | 'updated'>,
  options: CollectionDiff<Entry> = {},
): void {
  const identity = options.identity ?? ((entry: Entry) => entry.id)
  const refOf = options.refOf ?? ((entry: Entry): EntityRef => ({ kind, id: entry.id }))
  const recordOf = options.recordOf ?? ((entry: Entry) => entry)
  const beforeByKey = new Map(before.map((entry) => [identity(entry), entry]))
  const afterByKey = new Map(after.map((entry) => [identity(entry), entry]))
  for (const entry of after) {
    const previous = beforeByKey.get(identity(entry))
    if (!previous) {
      changes.added.push(refOf(entry))
      continue
    }
    const fields = changedFields(recordOf(previous), recordOf(entry))
    if (fields.length > 0) {
      changes.updated.push({ ...refOf(entry), fields })
    }
  }
  for (const entry of before) {
    if (!afterByKey.has(identity(entry))) {
      changes.removed.push(refOf(entry))
    }
  }
}

/** Whether the range entity exists: at least one of its points is set. */
function hasPoints(range: RangeSnapshot): boolean {
  return range.in !== null || range.out !== null
}

/** The points that differ between two ranges, as `Changes` field names. */
function changedRangeFields(before: RangeSnapshot, after: RangeSnapshot): string[] {
  const fields: string[] = []
  if (before.in !== after.in) fields.push('inPoint')
  if (before.out !== after.out) fields.push('outPoint')
  return fields
}

/**
 * Compare the in/out range. Its entity exists while either point is set, so a
 * first point is `added` and a last cleared point is `removed`; a point that
 * moves is `updated` with `inPoint` or `outPoint`.
 */
function diffRange(
  before: RangeSnapshot,
  after: RangeSnapshot,
  changes: Pick<Changes, 'added' | 'removed' | 'updated'>,
): void {
  const existedBefore = hasPoints(before)
  const existsAfter = hasPoints(after)
  if (!existedBefore && !existsAfter) return
  if (!existedBefore) {
    changes.added.push({ kind: 'range', id: after.id })
    return
  }
  if (!existsAfter) {
    changes.removed.push({ kind: 'range', id: before.id })
    return
  }
  const fields = changedRangeFields(before, after)
  if (fields.length > 0) {
    changes.updated.push({ kind: 'range', id: after.id, fields })
  }
}

/** Fields of the project the diff reports. */
const PROJECT_METADATA_FIELDS = ['width', 'height', 'fps', 'backgroundColor'] as const

/** Compare the open project's metadata. */
function diffProject(
  before: ProjectMetadataSnapshot | null,
  after: ProjectMetadataSnapshot | null,
  changes: Pick<Changes, 'added' | 'removed' | 'updated'>,
): void {
  if (!before && !after) return
  if (!before) {
    if (after) changes.added.push({ kind: 'project', id: after.id })
    return
  }
  if (!after) {
    changes.removed.push({ kind: 'project', id: before.id })
    return
  }
  if (before.id !== after.id) {
    changes.removed.push({ kind: 'project', id: before.id })
    changes.added.push({ kind: 'project', id: after.id })
    return
  }
  const fields = PROJECT_METADATA_FIELDS.filter((field) => before[field] !== after[field])
  if (fields.length > 0) {
    changes.updated.push({ kind: 'project', id: after.id, fields })
  }
}

/**
 * What changed between two baselines: added, removed and updated entities with
 * the fields that changed. `commands` and `undoSteps` come from the caller.
 * @internal
 */
export function diffChangeBaselines(
  before: ChangeBaseline,
  after: ChangeBaseline,
): Pick<Changes, 'added' | 'removed' | 'updated'> {
  const changes: Pick<Changes, 'added' | 'removed' | 'updated'> = {
    added: [],
    removed: [],
    updated: [],
  }
  // Another project opened (or the first one): its timeline is a different project, not an edit of the one before.
  // Only the two projects are named; listing both timelines entry by entry ran to hundreds of lines in an agent's
  // result (20 Nov 2026: opening the 12-clip reel listed 150 entries, and leaving it listed them again as removed).
  if ((before.project?.id ?? null) !== (after.project?.id ?? null)) {
    diffProject(before.project, after.project, changes)
    return changes
  }
  diffCollection('track', before.tracks, after.tracks, changes)
  diffCollection('clip', before.items, after.items, changes)
  diffCollection('effect', before.effects, after.effects, changes, {
    identity: effectIdentity,
    refOf: effectRef,
    recordOf: (effect) => effect.record,
  })
  diffCollection('transition', before.transitions, after.transitions, changes)
  diffCollection('keyframe', before.keyframes, after.keyframes, changes)
  diffCollection('marker', before.markers, after.markers, changes)
  diffRange(before.range, after.range, changes)
  diffProject(before.project, after.project, changes)
  return changes
}
