// What following the shadow costs, as the DroneClean cloud charges it (Matteo, 20 Nov 2026: every job on its GPUs
// spends credits, the tracking pass and the preview as the clean). The rule is the cloud's `TRACK_CREDITS` and
// `trackCredits` (`cloud/packages/shared/src/pricing.ts`), mirrored here so the follow button shows its price
// before the press, with no request the pilot did not ask for; `pricing.test.ts` holds it to the cloud's values as
// the contract snapshot recorded them (`api/contract-snapshot.json`, `prices`). The cloud charges the piece it
// receives, which is the clip's part widened to the keyframes around it (`clipSourceRange`): the session prices that
// piece exactly before it is cut and again once uploaded, asks before charging more than the button said, and sends
// the agreed price as the job's `maxCredits`. A pass that finds no shadow where it was marked gives its credits back.

import type { VideoItem } from '@/types/timeline'
import { frameToSeconds, type Rate } from '@/studio/time'

/**
 * `perSecond` credits for each second of the piece, counted as at 30 fps (twice at 60 fps, 4 times at 120), rounded
 * up once, at least `minimum` (a short piece still starts a GPU worker).
 */
export const TRACK_CREDITS = { perSecond: 1, minimum: 5 } as const

/** How much GPU work a second at `fps` is, in seconds at 30 fps: 1 up to 30 fps, 4 at 120 (the cloud's `frameWork`). */
function frameWork(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? Math.max(1, fps / 30) : 1
}

/** The credits a tracking pass over `pieceSeconds` of a source at `fps` costs. */
export function trackCredits(pieceSeconds: number, fps: number): number {
  const seconds = Number.isFinite(pieceSeconds) ? Math.max(0, pieceSeconds) : 0
  return Math.max(
    TRACK_CREDITS.minimum,
    Math.ceil(seconds * frameWork(fps) * TRACK_CREDITS.perSecond - 1e-6),
  )
}

/**
 * What a tracking pass on an uploaded piece costs, exactly as the API prices it: `trackCredits` of the length and
 * frame rate our servers measured (`upload.video`), which the job is charged by.
 */
export function pieceCredits(video: { durationSeconds: number; frameRate?: number }): number {
  return trackCredits(video.durationSeconds, video.frameRate ?? Number.NaN)
}

/**
 * What following the shadow in a clip costs, as its button and `studio.shadow` say it: the clip's part of its source
 * (its trim or split, the whole source when it has none) at the source's rate. `mediaSeconds` is the source's length
 * from the media library, for a clip that records neither its end nor its source's length.
 */
export function clipFollowCredits(
  item: Pick<VideoItem, 'sourceStart' | 'sourceEnd' | 'sourceDuration'>,
  rate: Rate,
  mediaSeconds: number | undefined,
): number {
  const start = item.sourceStart ?? 0
  const end =
    item.sourceEnd ??
    item.sourceDuration ??
    (mediaSeconds === undefined ? start : start + mediaSeconds * (rate.num / rate.den))
  return trackCredits(frameToSeconds(rate, Math.max(0, end - start)), rate.num / rate.den)
}
