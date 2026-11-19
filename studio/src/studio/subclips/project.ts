// How subclips and the remembered in/out marks live in a project file (design 1.6, D1 and D5).
//
// Both are optional fields of `ProjectTimeline` (`subclips`, `sourceMarks`): a project saved
// before them has neither and opens unchanged, so there is no schema bump. They are written
// only when there is something to write.

import type { ProjectTimeline } from '@/types/project'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import type { SourceMarkPair } from '@/shared/state/source-player'
import type { SubclipParentInfo } from './model'
import { useSubclipsStore } from './store'
import { getParentFrameCount } from './validate'

type SubclipTimelineFields = Pick<ProjectTimeline, 'subclips' | 'sourceMarks'>

function isFrame(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function readMarkPair(value: unknown): SourceMarkPair | null {
  if (typeof value !== 'object' || value === null) return null
  const { in: markIn, out: markOut } = value as Record<string, unknown>
  const pair = {
    in: isFrame(markIn) ? markIn : null,
    out: isFrame(markOut) ? markOut : null,
  }
  return pair.in === null && pair.out === null ? null : pair
}

/** The fields the timeline writer spreads into the saved timeline: empty when there is nothing. */
export function buildSubclipTimelineFields(): SubclipTimelineFields {
  const { subclips } = useSubclipsStore.getState()
  const { marksByKey } = useSourcePlayerStore.getState()
  const sourceMarks: NonNullable<ProjectTimeline['sourceMarks']> = {}
  for (const [key, marks] of Object.entries(marksByKey)) {
    if (marks.in !== null || marks.out !== null) sourceMarks[key] = { in: marks.in, out: marks.out }
  }
  return {
    ...(subclips.length > 0 && { subclips: subclips.map((subclip) => ({ ...subclip })) }),
    ...(Object.keys(sourceMarks).length > 0 && { sourceMarks }),
  }
}

/** Loads a project's subclips and marks into the stores; a project without them clears both. */
export function restoreSubclipTimelineFields(timeline: SubclipTimelineFields | undefined): void {
  useSubclipsStore.getState().setSubclips(timeline?.subclips ?? [])
  const marksByKey: Record<string, SourceMarkPair> = {}
  for (const [key, value] of Object.entries(timeline?.sourceMarks ?? {})) {
    const pair = readMarkPair(value)
    if (pair) marksByKey[key] = pair
  }
  useSourcePlayerStore.getState().setMarksByKey(marksByKey)
}

/**
 * After a project opens, with the files its library really holds: drops the subclips whose
 * parent is gone, and the marks of a file that is gone, of a subclip that is gone, or that lie
 * beyond the file's last frame. A subclip whose parent merely got shorter or changed rate is
 * kept: it is shown as invalid, never clamped or removed (D6).
 */
export function reconcileSubclipsWithMedia(
  media: ReadonlyArray<SubclipParentInfo & { id: string }>,
): void {
  const parents = new Map(media.map((item) => [item.id, item]))
  const subclipsStore = useSubclipsStore.getState()
  const survivors = subclipsStore.subclips.filter((subclip) => parents.has(subclip.mediaId))
  if (survivors.length !== subclipsStore.subclips.length) {
    subclipsStore.setSubclips(survivors)
  }

  const subclipParent = new Map(survivors.map((subclip) => [subclip.id, subclip.mediaId]))
  const source = useSourcePlayerStore.getState()
  const kept: Record<string, SourceMarkPair> = {}
  for (const [key, marks] of Object.entries(source.marksByKey)) {
    const parent = parents.get(subclipParent.get(key) ?? key)
    if (!parent) continue
    const frames = getParentFrameCount(parent)
    if ((marks.in !== null && marks.in >= frames) || (marks.out !== null && marks.out > frames)) {
      continue
    }
    kept[key] = marks
  }
  if (Object.keys(kept).length !== Object.keys(source.marksByKey).length) {
    source.setMarksByKey(kept)
  }
}
