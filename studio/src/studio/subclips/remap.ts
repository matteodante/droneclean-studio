import type { ProjectTimeline } from '@/types/project'

type SubclipTimelineFields = Pick<ProjectTimeline, 'subclips' | 'sourceMarks'>

/**
 * The subclips and marks of a project that is imported into another library, whose files got new
 * ids (`mediaIdMap`: old id to new id). A subclip follows its parent; a subclip whose parent is not
 * in the map is dropped, as it would be on the first load. A mark keyed by a media id follows the
 * file, one keyed by a subclip id stays, any other is dropped. Nothing but ids changes.
 */
export function remapSubclipFields(
  fields: SubclipTimelineFields,
  mediaIdMap: ReadonlyMap<string, string>,
): SubclipTimelineFields {
  const subclips = (fields.subclips ?? []).flatMap((subclip) => {
    const mediaId = mediaIdMap.get(subclip.mediaId)
    return mediaId === undefined ? [] : [{ ...subclip, mediaId }]
  })
  const subclipIds = new Set(subclips.map((subclip) => subclip.id))
  const sourceMarks: NonNullable<ProjectTimeline['sourceMarks']> = {}
  for (const [key, marks] of Object.entries(fields.sourceMarks ?? {})) {
    const target = mediaIdMap.get(key) ?? (subclipIds.has(key) ? key : undefined)
    if (target !== undefined) sourceMarks[target] = marks
  }
  return {
    ...(subclips.length > 0 && { subclips }),
    ...(Object.keys(sourceMarks).length > 0 && { sourceMarks }),
  }
}
