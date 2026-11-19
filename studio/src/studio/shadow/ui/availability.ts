// Whether the clip panel may offer shadow removal for a clip.
//
// The section works on one video clip at a time, and only when its source can be read: the free
// tracking cuts a piece around the mark from that file (design 4.1, section 5.2), so a clip whose
// media record is gone, broken or unreadable has nothing to send. Reversed clips are hidden
// outright: v1 does not offer shadow removal on them (a coordinator decision, 18 Nov 2026), and the
// mark, the ranges and the pieces are all in the source's own frames, which a reversed clip plays
// backwards. Pure: the caller passes the clip and its media-library record, so this needs no store
// and no I/O; a file that looked readable but is not fails when the piece is cut, with the API's or
// the reader's own message.
//
// The paid clean is behind the DroneClean feature switch `shadowRemovalClean`
// (`src/studio/feature-switches.ts`): the slice that builds it (E6) turns it on once the whole flow
// runs against the API's recorded answers, so a build that cannot pay for seconds still shows the
// free tracking and hides the press that spends credits (design 4.1, decision 3: never charge
// without an explicit press the pilot can see).

import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import { isFeatureShown } from '@/studio/feature-switches'

/** What the clip panel should do with a clip: hide, say why it cannot send, or offer the section. */
export type ShadowAvailability =
  | { state: 'hidden'; reason: 'not-a-video' | 'reversed' }
  | { state: 'no-source' }
  | { state: 'ready'; canClean: boolean }

/**
 * Whether the media record still points at bytes the editor can open: a handle, an OPFS path, the workspace, or a
 * file the desktop shell serves by path (the originals a pilot links).
 */
function hasStoredSource(media: MediaMetadata): boolean {
  if (media.storageType === 'handle') return media.fileHandle !== undefined
  if (media.storageType === 'path') return Boolean(media.filePath)
  if (media.storageType === 'opfs') return Boolean(media.opfsPath)
  return media.storageType === 'workspace'
}

/** The picture and frame rate the piece will be cut at, all of which must be known before it can be. */
function hasMeasuredSource(media: MediaMetadata): boolean {
  return (
    media.width > 0 && media.height > 0 && media.fps > 0 && media.duration > 0 && media.fileSize > 0
  )
}

/**
 * Decides from the clip and its media record whether the shadow section can work: a video clip,
 * not reversed, whose stored source is readable and measured. A clip with no record, or with one
 * whose file is gone (`broken`, the media library's own report), is `no-source`: the section says
 * so in plain words instead of offering a button that would fail. `canClean` is the feature
 * switch: while it is off the section shows the free pass and its price, and no press that spends.
 */
export function shadowAvailability(
  item: TimelineItem | null | undefined,
  media: MediaMetadata | undefined,
  options: { broken?: boolean } = {},
): ShadowAvailability {
  if (!item || item.type !== 'video') return { state: 'hidden', reason: 'not-a-video' }
  if (item.isReversed) return { state: 'hidden', reason: 'reversed' }
  if (!media || options.broken === true) return { state: 'no-source' }
  if (!hasStoredSource(media) || !hasMeasuredSource(media)) return { state: 'no-source' }
  const sourceFps = item.sourceFps ?? media.fps
  if (!(sourceFps > 0)) return { state: 'no-source' }
  return { state: 'ready', canClean: isFeatureShown('shadowRemovalClean') }
}
