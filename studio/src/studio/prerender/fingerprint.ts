// A pre-rendered frame's identity (design `docs/designs/prerender-preview.md` §0.4): a hash of everything that draws
// the frame. A cached frame is shown only while the hash the editor computes for it now equals the hash it was
// rendered under, so an edit that changes a frame makes it stale at once, and an undo that brings the drawing back
// makes it valid again.
//
// What draws frame `f`: the clips on visible tracks whose span holds `f` (every field of the clip, its track's fields,
// its keyframes, which file it reads, the sub-composition a compound clip opens, recursively), the transitions whose
// window holds `f` and both of their clips, and the global inputs (project size, rate and background, the preview
// quality, the proxy switch, the text path). Between two consecutive boundaries (a clip's start or end, a
// transition window's start or end) that set does not change, so the frames are hashed per segment. A clip that
// reads another clip's values (a transform parent, a property link, an expression) can depend on a clip outside its
// segment: such a segment hashes the whole timeline. Audio clips draw nothing and are left out.

import { resolveTransitionWindows } from '@/shared/timeline/transitions/transition-planner'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { FrameRange } from './ranges'

/** A sub-composition as the hash reads it: its id, its items and whatever else it carries (all of it is hashed) */
export interface FingerprintComposition {
  readonly id: string
  readonly items: readonly TimelineItem[]
}

export interface FingerprintInput {
  /** The inputs outside the timeline that change every frame (project size, quality, proxies, text path) */
  readonly global: Readonly<Record<string, unknown>>
  /** The tracks the preview draws, with their items (the preview's composition input) */
  readonly tracks: readonly TimelineTrack[]
  readonly transitions: readonly Transition[]
  readonly keyframes: readonly ItemKeyframes[]
  readonly compositionsById: ReadonlyMap<string, FingerprintComposition>
  /** Which file a media clip's frames come from, beyond its `mediaId` (proxy or original, the file's identity) */
  readonly sourceKey: (item: TimelineItem) => string
}

/** Fields of a sub-composition that draw nothing */
const COMPOSITION_FIELDS_NOT_DRAWN = new Set(['name', 'markers', 'inPoint', 'outPoint'])
/** Fields of a clip the hash replaces with `sourceKey`: session blob URLs, not what the clip shows */
const ITEM_URL_FIELDS = new Set(['src', 'audioSrc'])

/**
 * cyrb53: a fast 53-bit string hash (public domain, bryc). Collisions between the few thousand segments of a
 * session are negligible at 53 bits.
 */
function hashString(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

interface Candidate {
  readonly item: TimelineItem
  readonly start: number
  readonly end: number
  /** Whether the clip reads another clip's values (it may depend on a clip outside its span) */
  readonly reachesOutside: boolean
}

interface Window {
  readonly start: number
  readonly end: number
  readonly key: string
  readonly clipIds: readonly string[]
}

/** What one hashing pass knows about the timeline */
interface Timeline {
  readonly candidates: readonly Candidate[]
  readonly itemKeys: ReadonlyMap<string, string>
  readonly windows: readonly Window[]
  readonly anyReachesOutside: boolean
}

function withoutFields(value: object, fields: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.has(key)))
}

/** The key of a sub-composition and of the sub-compositions it opens, memoised per pass */
function compositionKeyer(compositionsById: FingerprintInput['compositionsById']) {
  const keys = new Map<string, string>()
  const keyOf = (id: string, visiting: Set<string>): string => {
    const known = keys.get(id)
    if (known !== undefined) return known
    const composition = compositionsById.get(id)
    if (composition === undefined || visiting.has(id)) return `missing:${id}`
    visiting.add(id)
    const nested = composition.items
      .filter((item) => item.type === 'composition' && item.compositionId !== undefined)
      .map((item) => keyOf(item.compositionId!, visiting))
    visiting.delete(id)
    const key = JSON.stringify([withoutFields(composition, COMPOSITION_FIELDS_NOT_DRAWN), nested])
    keys.set(id, key)
    return key
  }
  return (id: string) => keyOf(id, new Set())
}

function readsAnotherClip(item: TimelineItem, keyframes: ItemKeyframes | undefined): boolean {
  if (item.transformParent !== undefined) return true
  return (keyframes?.propertyLinks?.length ?? 0) > 0 || (keyframes?.expressions?.length ?? 0) > 0
}

/** The key of one drawing clip: its track's fields, its own, its keyframes, its file and its sub-composition */
function clipKey(
  input: FingerprintInput,
  trackKey: Record<string, unknown>,
  item: TimelineItem,
  keyframes: ItemKeyframes | undefined,
  compositionKey: (id: string) => string,
): string {
  const opensComposition = item.type === 'composition' && item.compositionId !== undefined
  return JSON.stringify({
    track: trackKey,
    item: withoutFields(item, ITEM_URL_FIELDS),
    keyframes: keyframes ?? null,
    source: item.mediaId === undefined ? null : input.sourceKey(item),
    composition: opensComposition ? compositionKey(item.compositionId!) : null,
  })
}

/** The drawing clips of the visible tracks, their keys, and the transition windows */
function readTimeline(input: FingerprintInput): Timeline {
  const keyframesById = new Map(input.keyframes.map((entry) => [entry.itemId, entry]))
  const compositionKey = compositionKeyer(input.compositionsById)
  const candidates: Candidate[] = []
  const itemKeys = new Map<string, string>()
  const clipsById = new Map<string, TimelineItem>()
  for (const track of input.tracks.filter((candidate) => candidate.visible !== false)) {
    const trackKey = withoutFields(track, new Set(['items']))
    for (const item of track.items) {
      clipsById.set(item.id, item)
      if (item.type === 'audio' || item.durationInFrames <= 0) continue
      const keyframes = keyframesById.get(item.id)
      const end = item.from + item.durationInFrames
      candidates.push({
        item,
        start: item.from,
        end,
        reachesOutside: readsAnotherClip(item, keyframes),
      })
      itemKeys.set(item.id, clipKey(input, trackKey, item, keyframes, compositionKey))
    }
  }
  const windows = resolveTransitionWindows([...input.transitions], clipsById).map((window) => ({
    start: window.startFrame,
    end: window.endFrame,
    key: JSON.stringify(window.transition),
    clipIds: [window.leftClip.id, window.rightClip.id],
  }))
  return {
    candidates,
    itemKeys,
    windows,
    anyReachesOutside: candidates.some((candidate) => candidate.reachesOutside),
  }
}

/** The frames inside `range` where the set of drawing clips or windows changes, with both ends */
function segmentCuts(timeline: Timeline, range: FrameRange): number[] {
  const boundaries = new Set<number>([range.start, range.end])
  for (const span of [...timeline.candidates, ...timeline.windows]) {
    for (const edge of [span.start, span.end]) {
      if (edge > range.start && edge < range.end) boundaries.add(edge)
    }
  }
  return [...boundaries].sort((a, b) => a - b)
}

/** The text a segment's hash is taken of: the global key, its clips' keys and its windows' keys */
function segmentText(timeline: Timeline, globalKey: string, start: number, end: number): string {
  const overlaps = (span: { start: number; end: number }) => span.start < end && span.end > start
  const drawing = timeline.candidates.filter(overlaps)
  const windows = timeline.windows.filter(overlaps)
  const ids = new Set(drawing.map((candidate) => candidate.item.id))
  for (const window of windows) {
    for (const id of window.clipIds) if (timeline.itemKeys.has(id)) ids.add(id)
  }
  const reaches =
    timeline.anyReachesOutside && drawing.some((candidate) => candidate.reachesOutside)
  const segmentIds = reaches ? [...timeline.itemKeys.keys()].sort() : [...ids].sort()
  return [
    globalKey,
    ...segmentIds.map((id) => timeline.itemKeys.get(id)!),
    ...windows.map((window) => window.key).sort(),
  ].join('\n')
}

/**
 * The per-frame hashes of `range`: `hashes[i]` identifies the drawing of frame `range.start + i`. Two calls on inputs
 * that draw a frame the same way give it the same hash; a change to anything that draws it changes the hash.
 */
export function frameHashes(input: FingerprintInput, range: FrameRange): Float64Array {
  const hashes = new Float64Array(Math.max(0, range.end - range.start))
  if (hashes.length === 0) return hashes
  const timeline = readTimeline(input)
  const cuts = segmentCuts(timeline, range)
  const globalKey = JSON.stringify(input.global)
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const start = cuts[index]!
    const end = cuts[index + 1]!
    hashes.fill(
      hashString(segmentText(timeline, globalKey, start, end)),
      start - range.start,
      end - range.start,
    )
  }
  return hashes
}
