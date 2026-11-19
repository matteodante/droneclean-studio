// Cleaning the seconds a tracking pass found: one full job over the ranges, on the upload the pass
// already made, the poll, the download, the file kept in the project beside the source, and the
// record written on the clip in one undo step (design 4.1, sections 5.2, 5.3, 5.4 and 5.6; slice
// E6; review findings C1–C4 and C7, fixed in task 4.6).
//
// One press is one job and one piece. The job's `segments` are the ranges it cleans, in the uploaded
// piece's seconds, anchored on the tracking pass's points and reusing its job (`trackJobIds`), so
// the cloud follows a shadow it has already followed instead of tracking it again, and one piece
// pays the cloud's minimum once however many ranges it covers (design 4.1, decision 3). Nothing is
// cut or uploaded a second time: the job runs on the pass's upload, which the cloud keeps seven
// days. The result is the whole piece with those ranges repainted: the record keeps one file for
// the piece's frames and the renderer reads it frame-exactly (`source-map.ts`).
//
// A paid job is never lost to the editor's own life. Before the job is asked for, the press is
// written on the clip's record as a pending clean (`model.ts`, saved with the project) with its
// `attemptId`, and the API makes one job per account and attempt: a lost answer is asked again with
// the same id and gets the same job, and a restart picks the job up again (`resumeClean`). A lost
// answer is retried with backoff; a job that succeeded is always downloaded and recorded, whether
// or not anybody still watches the section; and the pending clean leaves the record only with a
// known outcome. A new clean never deletes an older piece: pieces may overlap, and the resolver
// chooses per frame.
//
// The price the section showed is the API's quote on the same upload and ranges; the job's
// reservation is compared with it and a different one is canceled (the cloud refunds it) instead
// of charging a price nobody saw (design 4.1, decision 2). A cancel that does not go through is
// retried, and stays on the record as `repriced` until it does. A failed job gives its credits back
// on the cloud's side; nothing is recorded then.
//
// Everything the flow needs from its shell is passed in (`ShadowCleanDeps`), so the whole run is
// exercised against a fake cloud in a jsdom test with no network.

import { registerObjectUrl } from '@/infrastructure/browser/object-url-registry'
import { requireWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { writeBlob } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { mediaDir } from '@/infrastructure/storage/workspace-fs/paths'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { updateItem } from '@/features/timeline/stores/timeline-actions'
import { frameToSeconds, rateValue, type Rate } from '@/studio/time'
import type { MediaMetadata } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import type { DroneCleanClient } from './api/client'
import { shadowSegment, type SourceFrameRange, type SourceTrackPoint } from './api/jobs'
import {
  DroneCleanApiError,
  abortError,
  type CreateJobRequest,
  type Job,
  type JobOptions,
  type Segment,
  type VideoMeta,
} from './api/types'
import type { ShadowCutWindow } from './cut/interface'
import {
  validateShadowRemoval,
  type ShadowPendingClean,
  type ShadowPiece,
  type ShadowRange,
  type ShadowRemoval,
} from './model'

/** The options every full job of the editor sends, and its quote prices: the source's own rate, the standard quality. */
export const FULL_JOB_OPTIONS: JobOptions = { quality: 'standard', outputStep: 1 }

/** How often a job is read: every two seconds, every four after half a minute without an answer. */
const POLL_INTERVAL_MS = 2_000
const SLOW_POLL_INTERVAL_MS = 4_000
const SLOW_POLL_AFTER_MS = 30_000

/**
 * How long a request whose answer was lost waits before it is sent again, try after try: about a
 * minute in all, then the clean is kept on the record for the next open.
 */
const RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]

/** What a clean whose job the service does not know says (404: it may be another account's). */
const MISSING_MESSAGE =
  'DroneClean does not know this job: it may belong to another account. The paid clean is kept.'

/** What a clean that could not reach the service says: nothing is lost, it will be picked up again. */
const UNREACHABLE_MESSAGE =
  'Could not reach DroneClean. The paid clean is kept and will be picked up again.'

/** What the shell must give the flow; each piece is a default in the web shell (slice E7 swaps some). */
export interface ShadowCleanDeps {
  /** The cloud client, over the shell's fetch and token store. */
  client: DroneCleanClient
  /** How a poll and a retry wait; the tests make it immediate. */
  sleep: (ms: number) => Promise<void>
  /** The time now: when a press is written on the record. */
  now: () => Date
  /** Writes the downloaded file into the project folder and gives the URL the renderer reads. */
  savePiece: (segments: string[], blob: Blob) => Promise<string>
  /**
   * Saves the project once a press is on the record and before its job is asked for, so a close
   * without saving cannot lose a paid job. A save that fails does not stop the press: the shell
   * says the project was not saved.
   */
  savePress: () => Promise<void>
  /** The job on the server, so the section's Cancel can stop it; null once it is over. */
  onJob: (jobId: string | null) => void
  /** The step the run is on, for the section's progress line. */
  onStage: (stage: ShadowCleanStage) => void
  /** How far the current step has got, 0 to 1. */
  onProgress: (fraction: number) => void
  /**
   * Whether the pilot pressed Cancel on this clean. Leaving the clip or closing the section is not
   * a cancel: the clean goes on, and its result is recorded when it comes.
   */
  isCancelled: () => boolean
}

/** The steps one clean goes through, in order. */
export type ShadowCleanStage = 'cleaning' | 'downloading' | 'saving'

/** Everything one clean needs, all of it in source frames measured from the source's first. */
export interface ShadowCleanRequest {
  /** The clip whose record the piece is written to. */
  item: VideoItem
  /** The clip's exact source rate, `num / den`. */
  rate: Rate
  /** The tracking pass the job reuses: its job, the upload it ran on, its window and its points. */
  pass: { jobId: string; uploadId: string; window: ShadowCutWindow; points: SourceTrackPoint[] }
  /** The stretches to clean, in source frames inside the pass's window. */
  ranges: SourceFrameRange[]
  /** The credits the section showed for exactly these ranges: a different reservation cancels. */
  credits: number
  /** The press's own id: the API makes one job per account and attempt, never a second. */
  attemptId: string
}

/** What a finished clean leaves behind. */
export interface ShadowCleanOutcome {
  /** The full job, as its last read answered. */
  job: Job
  /** The cleaned file, as the clip's record now keeps it. */
  piece: ShadowPiece
  /** The ranges this job paid for, with their share of its credits. */
  ranges: ShadowRange[]
}

/** The message a failure shows as it is: the API's own words, a lost network's, or anything else's. */
export function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong.'
}

/**
 * Whether a call's outcome is unknown: no answer came, or the server failed while answering. The
 * request may have been carried out, so only a request that is safe to repeat is sent again.
 */
function isLostAnswer(error: unknown): boolean {
  return error instanceof DroneCleanApiError && (error.status === 0 || error.status >= 500)
}

/** Whether the API does not know the job (404): signed in with another account, or gone. */
function isMissingJob(error: unknown): boolean {
  return error instanceof DroneCleanApiError && error.status === 404
}

/** `call`, sent again after each lost answer with the backoff above; the last failure is thrown. */
async function retryLostAnswers<T>(
  call: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt]
      if (!isLostAnswer(error) || delay === undefined) throw error
      await sleep(delay)
    }
  }
}

/** Whether a job is still queued or running. */
function isActive(job: Job): boolean {
  return job.status === 'queued' || job.status === 'running'
}

/**
 * Stops a job nobody will read any more, which gives back what it reserved; a job that already
 * ended, or one the API no longer has, is left alone. For the free tracking pass only: a paid job
 * is canceled through `cancelForGood`, which reads how it ended.
 */
export async function stopJob(client: DroneCleanClient, jobId: string): Promise<void> {
  try {
    await client.cancelJob(jobId)
  } catch {
    // Too late to stop it, or already gone: there is nothing left to stop.
  }
}

/**
 * Cancels a paid job, retrying a lost answer, and gives the job as it ended: canceled (refunded),
 * or, when it had already ended on its own (the API refuses the cancel with 409), as a read of it
 * says — failed (refunded) or succeeded (charged). Null when the cancel did not go through: the job
 * may still be queued or running.
 */
async function cancelForGood(deps: ShadowCleanDeps, jobId: string): Promise<Job | null> {
  try {
    const canceled = await retryLostAnswers(() => deps.client.cancelJob(jobId), deps.sleep)
    return isActive(canceled) ? null : canceled
  } catch (error) {
    if (!(error instanceof DroneCleanApiError) || error.status !== 409) return null
  }
  try {
    const ended = await retryLostAnswers(() => deps.client.getJob(jobId), deps.sleep)
    return isActive(ended) ? null : ended
  } catch {
    return null
  }
}

/**
 * The uploaded piece, described the way the API's `VideoMeta` asks (design 4.1, section 5.2): its
 * own duration and size, and where it starts on the original, which stays on the device.
 */
export function pieceVideoMeta(
  media: MediaMetadata,
  rate: Rate,
  window: ShadowCutWindow,
  piece: Blob,
): VideoMeta {
  return {
    fileName: media.fileName,
    contentType: piece.type || 'video/mp4',
    sizeBytes: piece.size,
    durationSeconds: frameToSeconds(rate, window.endFrame - window.startFrame),
    width: media.width,
    height: media.height,
    frameRate: rateValue(rate),
    source: {
      fileName: media.fileName,
      startSeconds: window.startSeconds,
      durationSeconds: media.duration,
      sizeBytes: media.fileSize,
    },
  }
}

/**
 * The API's segments for a set of source ranges, in the uploaded piece's seconds.
 *
 * A range with no tracked point inside it has no anchor to start the tracker from, so it is left
 * out of both lists rather than sent at a price it does not cover. The quote the section showed and
 * the job the press creates are built by this one function, so their seconds are the same numbers.
 */
export function anchoredSegments(
  rate: Rate,
  pieceStartFrame: number,
  ranges: SourceFrameRange[],
  points: SourceTrackPoint[],
  passJobId: string,
): { ranges: SourceFrameRange[]; segments: Segment[] } {
  const kept: SourceFrameRange[] = []
  const segments: Segment[] = []
  for (const range of ranges) {
    const anchor = points.find(
      (point) => point.frame >= range.startFrame && point.frame < range.endFrame,
    )
    if (!anchor) continue
    kept.push(range)
    segments.push(
      shadowSegment(rate, pieceStartFrame, { ...range, anchor, trackJobIds: [passJobId] }),
    )
  }
  return { ranges: kept, segments }
}

/**
 * `credits` spread over the ranges one job cleaned, by their lengths, whole credits each, the
 * rounding remainder on the first. The shares always add up to what the job reserved.
 */
export function splitRangeCredits(credits: number, ranges: SourceFrameRange[]): number[] {
  const lengths = ranges.map((range) => range.endFrame - range.startFrame)
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (total <= 0) return ranges.map((_, index) => (index === 0 ? credits : 0))
  const shares = lengths.map((length) => Math.floor((credits * length) / total))
  const assigned = shares.reduce((sum, share) => sum + share, 0)
  shares[0] = (shares[0] ?? 0) + (credits - assigned)
  return shares
}

/** Each cleaning attempt keeps its own file, including when it covers the same source frames. */
function shadowPieceSegments(
  mediaId: string,
  startFrame: number,
  frames: number,
  attemptId: string,
): string[] {
  return [
    ...mediaDir(mediaId),
    'shadow',
    `${startFrame}_${frames}_${encodeURIComponent(attemptId)}.mp4`,
  ]
}

/** What a poll waits for before reading the job again. */
export interface WaitForJobOptions {
  sleep: (ms: number) => Promise<void>
  /** Whether the run was abandoned while waiting. */
  abandoned: () => boolean
  /** Called with the job's own progress after every read. */
  onProgress?: (fraction: number) => void
  /** What a job that ended without a result says when the API has no message of its own. */
  failureMessage: string
}

/** One read of a job, retried with backoff when its answer is lost. */
function readJobOnce(client: DroneCleanClient, jobId: string, sleep: WaitForJobOptions['sleep']) {
  return retryLostAnswers(() => client.getJob(jobId), sleep)
}

/** The wait before the next read, given how long the poll has waited so far. */
function pollWaitMs(waitedMs: number): number {
  return waitedMs >= SLOW_POLL_AFTER_MS ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS
}

/**
 * Polls the job until it is no longer queued or running; null when the run was abandoned mid-wait.
 * A read whose answer is lost is sent again with backoff. A job that failed, or was canceled on the
 * server, throws with the API's message so the section can show it.
 */
export async function waitForJob(
  client: DroneCleanClient,
  job: Job,
  options: WaitForJobOptions,
): Promise<Job | null> {
  let current = job
  let waitedMs = 0
  while (isActive(current)) {
    if (options.abandoned()) return null
    const waitMs = pollWaitMs(waitedMs)
    await options.sleep(waitMs)
    waitedMs += waitMs
    if (options.abandoned()) return null
    current = await readJobOnce(client, current.id, options.sleep)
    options.onProgress?.(current.progress)
  }
  if (current.status !== 'succeeded') {
    throw new Error(current.error?.message ?? options.failureMessage)
  }
  return current
}

/**
 * The downloaded file into the project folder, as `writeBlob` writes it (the workspace root is the
 * project's real folder on the desktop), and the blob URL the renderer reads registered with it.
 * The write throws when it cannot happen, so a paid file is never recorded as kept when it is not.
 */
export async function savePieceInWorkspace(path: string[], blob: Blob): Promise<string> {
  await writeBlob(requireWorkspaceRoot(), path, blob)
  const file = new Blob([blob], { type: blob.type || 'video/mp4' })
  const url = URL.createObjectURL(file)
  registerObjectUrl(url, file)
  return url
}

/**
 * Detach the cleaned pieces in one undo step. Keep the files: undo and other clips (such as
 * a split or duplicate) can still reference them. This action is not workspace garbage collection.
 * A clean still on its way stays: its result is recorded when it comes.
 */
export function removeCleanedPieces(item: VideoItem): void {
  const live = useItemsStore.getState().itemById[item.id]
  if (!live || live.type !== 'video') return
  const record = live.shadowRemoval
  const pieces = record?.pieces ?? []
  if (!record || pieces.length === 0) return
  updateItem(item.id, { shadowRemoval: validateShadowRemoval({ ...record, pieces: [] }) })
}

// ---------------------------------------------------------------------------
// The pending clean on the clip's record

/** The paid cleans a record still waits for. */
function pendingOf(record: ShadowRemoval | undefined): ShadowPendingClean[] {
  return record?.pending ?? []
}

/**
 * The pending cleans of a record whose window shares a source frame with `[startFrame, endFrame)`:
 * while one is on its way, a second press on the same frames would pay for them twice.
 */
export function pendingCleansOver(
  record: ShadowRemoval | undefined,
  startFrame: number,
  endFrame: number,
): ShadowPendingClean[] {
  return pendingOf(record).filter(
    (pending) => pending.startFrame < endFrame && startFrame < pending.startFrame + pending.frames,
  )
}

/** The record with these pending cleans: the field is left out when there are none. */
function withPending(record: ShadowRemoval, pending: ShadowPendingClean[]): ShadowRemoval {
  const next: ShadowRemoval = { ...record }
  if (pending.length > 0) next.pending = pending
  else delete next.pending
  return next
}

/** The clip as the store has it now, when it is still a video on the timeline. */
function liveVideoOrNull(itemId: string): VideoItem | null {
  const live = useItemsStore.getState().itemById[itemId]
  return live?.type === 'video' ? live : null
}

/** The clip as the store has it now: a run whose clip was deleted while it ran has nowhere to write. */
function liveVideo(itemId: string): VideoItem {
  const live = liveVideoOrNull(itemId)
  if (!live) throw abortError()
  return live
}

/**
 * Writes a record outside the undo history and marks the project unsaved, so it is saved with it.
 * Only the pending cleans are written this way: they are not an edit. Undoing the clip back to
 * before the press must not forget a job being paid for (its run writes it again), and undoing a
 * recorded clean must not bring back a finished job to resume.
 */
function writeQuietly(itemId: string, record: ShadowRemoval): void {
  useItemsStore.getState()._updateItem(itemId, { shadowRemoval: validateShadowRemoval(record) })
  useTimelineSettingsStore.getState().markDirty()
}

/**
 * Puts `pending` on the clip's record, in place of the entry with the same attempt, unless it is
 * there already as it is. Nothing is written when the clip is gone or has no shadow record.
 */
function keepPending(itemId: string, pending: ShadowPendingClean): void {
  const record = liveVideoOrNull(itemId)?.shadowRemoval
  if (!record) return
  const current = pendingOf(record)
  const index = current.findIndex((entry) => entry.attemptId === pending.attemptId)
  if (index >= 0 && JSON.stringify(current[index]) === JSON.stringify(pending)) return
  const next =
    index >= 0
      ? current.map((entry, at) => (at === index ? pending : entry))
      : [...current, pending]
  writeQuietly(itemId, withPending(record, next))
}

/** Takes a pending clean off the clip's record once its outcome is known. */
function dropPending(itemId: string, attemptId: string): void {
  const record = liveVideoOrNull(itemId)?.shadowRemoval
  if (!record) return
  const current = pendingOf(record)
  const rest = current.filter((entry) => entry.attemptId !== attemptId)
  if (rest.length !== current.length) writeQuietly(itemId, withPending(record, rest))
}

/** The pending clean with a state set, keeping a `repriced` one as it is. */
function markUnreachable(pending: ShadowPendingClean): ShadowPendingClean {
  return pending.state === 'repriced' ? pending : { ...pending, state: 'unreachable' }
}

/** The service could not be reached: the clean stays on the record and the pilot is told so. */
function keptUnreachable(itemId: string, pending: ShadowPendingClean): Error {
  keepPending(itemId, markUnreachable(pending))
  return new Error(UNREACHABLE_MESSAGE)
}

/**
 * What a failed read of a pending clean's job leaves: a lost answer keeps it as unreachable, a job
 * the API does not know keeps it as missing (the panel then offers to forget it), and anything else
 * keeps it as it is. The error to throw.
 */
function keptAfterRead(itemId: string, pending: ShadowPendingClean, error: unknown): unknown {
  if (isLostAnswer(error)) return keptUnreachable(itemId, pending)
  if (isMissingJob(error)) {
    keepPending(itemId, { ...pending, state: 'missing' })
    return new Error(MISSING_MESSAGE)
  }
  return error
}

/**
 * Takes a pending clean off the clip's record at the pilot's word, when the service does not know
 * its job and the press would otherwise stay blocked for those frames. Its paid result, if the job
 * was made, can still be downloaded from the pilot's profile on the website.
 */
export function dropForgottenClean(itemId: string, attemptId: string): void {
  dropPending(itemId, attemptId)
}

/**
 * Whether a refusal of the job's creation proves that its attempt made no job. The API looks an
 * attempt up before any limit or check of the job (`askedBefore` in the cloud's `app.ts`), so a
 * refusal past that point means the attempt made nothing. Sign-in, the client's version and a
 * paused account are checked before it, though: once an earlier answer was lost, the job may exist
 * and those refusals prove nothing.
 */
function refusalMadeNothing(error: unknown, earlierAnswerLost: boolean): boolean {
  if (!(error instanceof DroneCleanApiError) || isLostAnswer(error)) return false
  if (!earlierAnswerLost) return true
  return error.status !== 401 && error.status !== 403 && error.code !== 'client_outdated'
}

/** The job's creation exactly as the press asked for it, so it can be sent again unchanged. */
function createRequestOf(pending: ShadowPendingClean): CreateJobRequest {
  return {
    uploadId: pending.uploadId,
    kind: 'full',
    segments: pending.segments,
    options: FULL_JOB_OPTIONS,
    attemptId: pending.attemptId,
  }
}

// ---------------------------------------------------------------------------
// The paid clean, step by step

/**
 * Asks for the pending clean's job with its `attemptId`, again after each lost answer (the API
 * answers an attempt it has seen with the job it made, so this never makes a second one). A refusal
 * that proves nothing was made takes the pending clean off the record; any other stays.
 */
async function createPendingJob(
  itemId: string,
  pending: ShadowPendingClean,
  deps: ShadowCleanDeps,
): Promise<Job> {
  // A creation kept as unreachable lost an answer before: its job may exist.
  let answerLost = pending.state === 'unreachable'
  const ask = async () => {
    try {
      return await deps.client.createJob(createRequestOf(pending))
    } catch (error) {
      answerLost ||= isLostAnswer(error)
      throw error
    }
  }
  try {
    return await retryLostAnswers(ask, deps.sleep)
  } catch (error) {
    if (refusalMadeNothing(error, answerLost)) dropPending(itemId, pending.attemptId)
    throw error
  }
}

/**
 * The pending clean's job: read again when its creation was answered before, asked for again with
 * the same `attemptId` otherwise. An answer that does not come after the retries leaves the clean
 * on the record as unreachable.
 */
async function confirmJob(
  itemId: string,
  pending: ShadowPendingClean,
  deps: ShadowCleanDeps,
): Promise<{ job: Job; pending: ShadowPendingClean }> {
  const jobId = pending.jobId
  let job: Job
  if (jobId === undefined) {
    try {
      job = await createPendingJob(itemId, pending, deps)
    } catch (error) {
      if (isLostAnswer(error)) throw keptUnreachable(itemId, pending)
      throw error
    }
  } else {
    job = await readPendingJob(itemId, pending, jobId, deps)
  }
  // Confirmed: it runs again, unless its price still has to be canceled.
  const confirmed: ShadowPendingClean = { ...pending, jobId: job.id }
  if (confirmed.state !== 'repriced') delete confirmed.state
  keepPending(itemId, confirmed)
  return { job, pending: confirmed }
}

/**
 * A job whose reservation is not the price shown: it is canceled, which refunds it, instead of
 * charging a price nobody saw. Until the cancel goes through the pending clean stays on the record
 * as `repriced` and the pilot is told so. A job that ended on its own meanwhile is settled by how
 * it ended: failed or canceled gave the credits back, and one that succeeded was charged, so its
 * result is brought in like any other (a paid result is never thrown away).
 */
async function settleRepriced(
  itemId: string,
  pending: ShadowPendingClean,
  job: Job,
  deps: ShadowCleanDeps,
): Promise<{ job: Job; pending: ShadowPendingClean }> {
  const reserved = pending.reservedCredits ?? job.cost.reservedCredits
  const repriced: ShadowPendingClean = { ...pending, state: 'repriced', reservedCredits: reserved }
  keepPending(itemId, repriced)
  const ended = await cancelForGood(deps, job.id)
  if (ended?.status === 'succeeded') return { job: ended, pending: repriced }
  if (ended) {
    dropPending(itemId, pending.attemptId)
    throw new Error(
      `The job would take ${reserved} credits, not the ${pending.credits} shown, so it was cancelled and nothing was charged.`,
    )
  }
  throw new Error(
    `The service reserved ${reserved} credits, not the ${pending.credits} shown, so the job was not started. The cancel did not go through yet; it will be tried again.`,
  )
}

/** One read of the job; a failure keeps the clean as `keptAfterRead` says. */
async function readPendingJob(
  itemId: string,
  pending: ShadowPendingClean,
  jobId: string,
  deps: ShadowCleanDeps,
): Promise<Job> {
  try {
    return await readJobOnce(deps.client, jobId, deps.sleep)
  } catch (error) {
    throw keptAfterRead(itemId, pending, error)
  }
}

/**
 * Polls the job until it is no longer queued or running, writing the pending clean back on the
 * record if an undo took it away. The pilot's Cancel stops it on the server; one whose cancel did
 * not go through goes on, and one that ended before the cancel reached it ends as it ended.
 */
async function pollUntilEnded(
  itemId: string,
  pending: ShadowPendingClean,
  job: Job,
  deps: ShadowCleanDeps,
): Promise<{ job: Job; cancelTried: boolean }> {
  let current = job
  let waitedMs = 0
  let cancelTried = false
  while (isActive(current)) {
    if (!cancelTried && deps.isCancelled()) {
      cancelTried = true
      const ended = await cancelForGood(deps, current.id)
      if (ended) return { job: ended, cancelTried }
    }
    const waitMs = pollWaitMs(waitedMs)
    await deps.sleep(waitMs)
    waitedMs += waitMs
    if (!cancelTried && deps.isCancelled()) continue
    current = await readPendingJob(itemId, pending, current.id, deps)
    keepPending(itemId, pending)
    deps.onProgress(current.progress)
  }
  return { job: current, cancelTried }
}

/**
 * Follows the job until it ends. A job that succeeded, even one the pilot canceled too late, was
 * charged, so it is followed to its result like any other. A job that failed or was canceled leaves
 * the record (its credits came back on the cloud's side) and throws the API's message, or
 * `AbortError` for the pilot's own cancel.
 */
async function followJob(
  itemId: string,
  pending: ShadowPendingClean,
  job: Job,
  deps: ShadowCleanDeps,
): Promise<Job> {
  const ended = await pollUntilEnded(itemId, pending, job, deps)
  if (ended.job.status === 'succeeded') return ended.job
  dropPending(itemId, pending.attemptId)
  if (ended.cancelTried && ended.job.status === 'canceled') throw abortError()
  throw new Error(ended.job.error?.message ?? 'The cleaning job did not finish. Please try again.')
}

/**
 * The succeeded job's file. A download that fails is tried again on a fresh URL (every read of the
 * job signs a new one), with the backoff above; after the last try the clean stays on the record
 * as unreachable, to be brought in when it is picked up again.
 */
async function downloadPaid(
  itemId: string,
  pending: ShadowPendingClean,
  job: Job,
  deps: ShadowCleanDeps,
): Promise<{ blob: Blob; job: Job }> {
  let current = job
  for (let attempt = 0; ; attempt++) {
    const url = current.result?.url
    if (!url) {
      // The cloud no longer has the file (results are kept 30 days): there is nothing to bring in.
      dropPending(itemId, pending.attemptId)
      throw new Error('The cleaning job finished without a file.')
    }
    try {
      const blob = await deps.client.downloadResult(url, { onProgress: deps.onProgress })
      return { blob, job: current }
    } catch {
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined) throw keptUnreachable(itemId, pending)
      await deps.sleep(delay)
      current = await readPendingJob(itemId, pending, current.id, deps)
    }
  }
}

/**
 * Writes the piece and the ranges on the clip through the item store, in one `updateItem` and so
 * in one undo step (design 4.1, section 5.4). The pending clean goes first, outside the history,
 * so undoing the clean removes it whole instead of bringing back a job to resume. The pieces the
 * clip had stay, overlapping or not: they were paid for, and the resolver draws the newest per
 * frame. A job already recorded (by another run of the same pending clean) is not recorded twice.
 */
function recordClean(
  itemId: string,
  pending: ShadowPendingClean,
  job: Job,
  path: string[],
  src: string,
): ShadowCleanOutcome {
  const record = liveVideo(itemId).shadowRemoval
  if (!record) throw new Error('Mark the shadow first.')
  const settled = withPending(
    record,
    pendingOf(record).filter((entry) => entry.attemptId !== pending.attemptId),
  )
  if (pendingOf(settled).length !== pendingOf(record).length) writeQuietly(itemId, settled)
  const recorded = settled.pieces.find((piece) => piece.jobId === job.id)
  if (recorded) {
    return {
      job,
      piece: recorded,
      ranges: settled.ranges.filter((range) => range.jobId === job.id),
    }
  }

  const piece: ShadowPiece = {
    jobId: job.id,
    path: path.join('/'),
    src,
    startFrame: pending.startFrame,
    frames: pending.frames,
  }
  const availableUntil = job.result?.availableUntil
  if (availableUntil) piece.availableUntil = availableUntil
  const shares = splitRangeCredits(job.cost.reservedCredits, pending.ranges)
  const paid: ShadowRange[] = pending.ranges.map((range, index) => ({
    startFrame: range.startFrame,
    endFrame: range.endFrame,
    credits: shares[index] ?? 0,
    jobId: job.id,
    passJobId: pending.passJobId,
  }))
  updateItem(itemId, {
    shadowRemoval: validateShadowRemoval({
      ...settled,
      ranges: [...settled.ranges, ...paid],
      pieces: [...settled.pieces, piece],
    }),
  })
  return { job, piece, ranges: paid }
}

/** The succeeded job's file downloaded, kept in the project and recorded on the clip. */
async function bringIn(
  itemId: string,
  pending: ShadowPendingClean,
  job: Job,
  deps: ShadowCleanDeps,
): Promise<ShadowCleanOutcome> {
  deps.onStage('downloading')
  const downloaded = await downloadPaid(itemId, pending, job, deps)
  const mediaId = liveVideo(itemId).mediaId
  if (!mediaId) throw new Error("The clip's file could not be read.")
  const path = shadowPieceSegments(mediaId, pending.startFrame, pending.frames, pending.attemptId)
  deps.onStage('saving')
  const src = await deps.savePiece(path, downloaded.blob)
  return recordClean(itemId, pending, downloaded.job, path, src)
}

/** A pending clean carried to its end: the job confirmed, its price checked, followed and brought in. */
async function finishClean(
  itemId: string,
  start: ShadowPendingClean,
  deps: ShadowCleanDeps,
): Promise<ShadowCleanOutcome> {
  deps.onStage('cleaning')
  let { job, pending } = await confirmJob(itemId, start, deps)
  deps.onJob(job.id)
  try {
    if (pending.state === 'repriced' || job.cost.reservedCredits !== pending.credits) {
      ;({ job, pending } = await settleRepriced(itemId, pending, job, deps))
    }
    job = await followJob(itemId, pending, job, deps)
  } finally {
    deps.onJob(null)
  }
  return bringIn(itemId, pending, job, deps)
}

/**
 * Cleans `request.ranges` in one full job on the pass's upload and keeps its result beside the
 * source. The press is written on the clip's record before the job is asked for, so nothing that
 * happens to the editor afterwards can lose the job or pay for it twice.
 *
 * Throws the API's own error when the job could not be made (the section shows it and keeps the
 * ranges so the press can be tried again), `AbortError` when the pilot canceled it, a plain error
 * naming both prices when its reservation is not the one shown, and a plain error saying the clean
 * is kept when the service could not be reached; the record says which cleans are still pending.
 */
export async function cleanShadow(
  request: ShadowCleanRequest,
  deps: ShadowCleanDeps,
): Promise<ShadowCleanOutcome> {
  const { item, rate, pass, ranges } = request
  if (!item.shadowRemoval?.mark || !liveVideo(item.id).shadowRemoval) {
    throw new Error('Mark the shadow first.')
  }
  const proposed = anchoredSegments(rate, pass.window.startFrame, ranges, pass.points, pass.jobId)
  if (proposed.ranges.length === 0) throw new Error('There is no range to clean.')
  const pending: ShadowPendingClean = {
    attemptId: request.attemptId,
    uploadId: pass.uploadId,
    startFrame: pass.window.startFrame,
    frames: pass.window.endFrame - pass.window.startFrame,
    ranges: proposed.ranges.map((range) => ({
      startFrame: range.startFrame,
      endFrame: range.endFrame,
    })),
    passJobId: pass.jobId,
    credits: request.credits,
    segments: proposed.segments,
    startedAt: deps.now().toISOString(),
  }
  keepPending(item.id, pending)
  try {
    await deps.savePress()
  } catch {
    // The shell says the project was not saved; the press goes on, it is on the record.
  }
  return finishClean(item.id, pending, deps)
}

/**
 * Picks up a pending clean the clip's record still carries (after a restart, a lost network, or a
 * cancel that did not go through): the same job, read again or asked for again with its attempt's
 * id, followed, downloaded and recorded once. Null when the clip no longer carries it.
 */
export async function resumeClean(
  itemId: string,
  attemptId: string,
  deps: ShadowCleanDeps,
): Promise<ShadowCleanOutcome | null> {
  const pending = pendingOf(liveVideoOrNull(itemId)?.shadowRemoval).find(
    (entry) => entry.attemptId === attemptId,
  )
  if (!pending) return null
  return finishClean(itemId, pending, deps)
}
