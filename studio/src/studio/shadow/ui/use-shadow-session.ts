// The shadow section's session: the free tracking pass for one clip, the paid clean of the ranges
// it found, and everything the section needs to show them (design 4.1, section 7, slices E5 and E6).
//
// The free pass costs nothing: the part of the source the clip shows (the piece the pilot chose by
// trimming or splitting the clip: decided 19 Nov 2026) is cut with the encoded samples copied
// (`../cut/cut.ts`), uploaded, and followed by a free `track` job from the mark; its keyframes and
// the ranges where the shadow was found come back in source frames, kept inside the clip's part
// (the cut reaches the keyframes around it, which are not the pilot's), and `POST /v1/jobs/quote`
// prices the seconds a full job would clean on that same upload (the server's price, never the
// client's). A press on "Clean" pays for exactly those ranges: one full job on the pass's upload
// cleans them with the pass's tracking reused (`../run.ts`; nothing is cut or uploaded again), and
// the cleaned file is kept in the project and recorded on the clip. The press is written on the
// clip's record first and the project saved as Cmd+S saves it, so a clean goes on when the section
// closes or the pilot moves to another clip, one the record still carries after a restart is picked
// up again (`resumePendingCleans`), and each running clean can be canceled from its own line
// (`cancelPendingClean`). After credits are bought in the browser, the price is asked again when
// the window regains focus, so the press works without reopening anything.
//
// The module is a zustand store because the section and the preview are separate trees: the panel
// arms the mark and shows the results, the preview draws the mark and the tracker and takes the
// click. The client, the cutter, the source reader, the poll's clock, the attempt id, the file
// writer and the browser opener are injected through `configureShadowSession`, so a jsdom test runs
// the whole flow against the recorded server with no network and no mediabunny, and E7 swaps only
// the session (the token in the desktop main process) and the ways a browser is opened.

import { create } from 'zustand'
import { secondsToFrame, toRate, type Rate } from '@/studio/time'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { updateItem } from '@/features/timeline/stores/timeline-actions'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { saveOpenProject } from '../project-saver'
import { getMediaSourceFps } from '@/features/timeline/utils/media-item-frames'
import type { MediaMetadata } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import { createDroneCleanClient, type DroneCleanClient } from '../api/client'
import { shadowClick, trackPointsInSourceFrames, trackRangesInSourceFrames } from '../api/jobs'
import type { SourceFrameRange, SourceTrackPoint } from '../api/jobs'
import type { DroneCleanSession } from '../api/session'
import {
  DroneCleanApiError,
  SignInRequiredError,
  type Account,
  type Job,
  type JobQuote,
  type Segment,
  type ServiceConfig,
  type TrackData,
  type Upload,
} from '../api/types'
import { mediabunnyShadowCutter } from '../cut/cut'
import type { ShadowCutter, ShadowCutRange, ShadowCutWindow, ShadowSource } from '../cut/interface'
import {
  FULL_JOB_OPTIONS,
  anchoredSegments,
  cleanShadow,
  dropForgottenClean,
  messageOf,
  pendingCleansOver,
  pieceVideoMeta,
  resumeClean,
  savePieceInWorkspace,
  stopJob,
  waitForJob,
  type ShadowCleanDeps,
  type ShadowCleanRequest,
  type ShadowCleanStage,
} from '../run'
import { shadowAvailability } from './availability'
import { validateShadowRemoval, type ShadowMark } from '../model'

/** The API's origin: the website, which passes `/v1/*` and `/api/auth/*` on to the API (design 4.1, 5.1). */
const DEFAULT_API_BASE_URL = 'https://droneclean.app'

/** Where the web editor keeps the bearer token: per tab, gone when the tab closes (design 4.1, 5.1). */
const TOKEN_STORAGE_KEY = 'droneclean-token'

/** Where the website sells credits; the same page is where the free beta takes credit requests. */
const CREDITS_URL = 'https://droneclean.app/profile?buy=1'
const CREDITS_REQUEST_URL = 'https://droneclean.app/profile'

/**
 * How long the clean may run on the pass's upload: the cloud keeps an input seven days
 * (`INPUT_RETENTION_DAYS`), less an hour so a press is never sent on an upload about to go.
 */
const UPLOAD_KEPT_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000

/** Where a tracking pass is: the API's job kinds and the free pass's own stages. */
export type ShadowStage =
  | 'idle'
  | 'signing-in'
  | 'cutting'
  | 'uploading'
  | 'tracking'
  | 'cleaning'
  | 'downloading'
  | 'saving'
  | 'ready'

/** The stages where an action would start a second run: every other control is disabled. */
const SHADOW_BUSY_STAGES: readonly ShadowStage[] = [
  'signing-in',
  'cutting',
  'uploading',
  'tracking',
  'cleaning',
  'downloading',
  'saving',
]

/** Whether the section is working: the actions that would start another run are off, Cancel is on. */
export function isShadowBusy(stage: ShadowStage): boolean {
  return SHADOW_BUSY_STAGES.includes(stage)
}

/** A finished free tracking pass, in source frames. */
interface ShadowTrackPass {
  /** The `track` job the API ran. */
  jobId: string
  /** The upload it ran on: the quote prices it and the clean runs on it, so nothing is uploaded twice. */
  uploadId: string
  /** When the cloud stored that upload (it keeps it seven days); absent when it did not say. */
  uploadCreatedAt?: string
  /** The mark it was made for: an unchanged mark lets a second press reuse it. */
  mark: ShadowMark
  /** The window of source frames that was uploaded: its frame `j` is source frame `startFrame + j`. */
  window: ShadowCutWindow
  /** Every frame where the shadow was followed, in source frames. */
  points: SourceTrackPoint[]
  /** The stretches the tracker found, in source frames, each with a tracked point inside it. */
  ranges: SourceFrameRange[]
}

/** What the section and the preview read, and what the preview's click writes. */
interface ShadowSessionState {
  /** The clip the open section works on; null until a section opens. */
  clipId: string | null
  /** Whether a section is open: the preview draws this clip's mark and tracker only while it is. */
  isOpen: boolean
  /** Whether the preview takes the next click on the picture as the mark. */
  marking: boolean
  /** The device sign-in waiting for approval: the short code and the page the browser opened. */
  signIn: { userCode: string; verificationUrl: string } | null
  /** Who signed in during this session (null until the first sign-in completes). */
  account: Account | null
  stage: ShadowStage
  /** Upload, job or download progress, 0 to 1. */
  progress: number
  /** The finished free pass, once there is one. */
  pass: ShadowTrackPass | null
  /** The price of cleaning the proposed ranges, from the API's quote: no job is created. */
  quote: JobQuote | null
  /** The server's settings, read after the pass so the section can say whether the beta is free. */
  config: ServiceConfig | null
  /** The last failure, ready to show: the API's or the network's own message. */
  error: string | null
  /** Whether the last failure was the API refusing the session: the panel offers a new sign-in. */
  needsSignIn: boolean
  /** The job running on the server, so Cancel can stop it (a full job's credits come back). */
  activeJobId: string | null
  /** The project could not be saved after the last press: the panel asks the pilot to save it. */
  projectNotSaved: boolean
  /** Bumped whenever the work on screen changes: an answer for an older run is dropped. */
  run: number
}

/** The empty session: the store's initial state, and what a new clip's section starts from. */
export const SHADOW_SESSION_IDLE: ShadowSessionState = {
  clipId: null,
  isOpen: false,
  marking: false,
  signIn: null,
  account: null,
  stage: 'idle',
  progress: 0,
  pass: null,
  quote: null,
  config: null,
  error: null,
  needsSignIn: false,
  activeJobId: null,
  projectNotSaved: false,
  run: 0,
}

interface ShadowSessionActions {
  /** The section for `clipId` is open: keeps its results when it is the same clip, starts fresh otherwise. */
  open(clipId: string): void
  /** The section closed (another tab, another clip, no selection): the preview stops drawing. */
  close(): void
  /** The preview takes the next click on the picture as the mark. */
  startMarking(): void
  /** The click never came, or the pilot changed their mind. */
  cancelMarking(): void
  /** Writes a mark in source pixels and frames, in one undo step, and forgets a pass made for another one. */
  setMark(item: VideoItem, mark: ShadowMark): void
  /** The free flow for the clip's mark: sign in if needed, cut, upload, track, price. Reuses a finished pass. */
  track(item: VideoItem): Promise<void>
  /** The paid flow: one full job over the pass's ranges, its file kept in the project and recorded. */
  clean(item: VideoItem): Promise<void>
  /** Stops the running flow: abandons its answers and cancels its job on the server. */
  cancel(): Promise<void>
  /** Signs in again with the device flow, without starting a pass or a clean. */
  signInAgain(): Promise<void>
  /** Opens the website's credit page: the shop, or the request form during the free beta. */
  getCredits(): Promise<void>
  /**
   * Asks the price of the pass's ranges again on its upload, which also reads the balance again:
   * after credits are bought in the browser, the press works without following the shadow again.
   */
  refreshQuote(item: VideoItem): Promise<void>
}

/** The store's whole shape: the session's data and the actions the section and the preview call. */
export type ShadowSessionStore = ShadowSessionState & ShadowSessionActions

/** What the flow needs from the shell it runs in; every field has a working default. */
interface ShadowSessionDeps {
  /** The cloud client, over the shell's fetch and token store. */
  client: DroneCleanClient
  /** The same token store the client was built with: consulted to decide whether to sign in. */
  session: DroneCleanSession
  /** The shell's cutter: mediabunny in the browser, FFmpeg on the desktop (slice E7). */
  cutter: ShadowCutter
  /** Opens the clip's source: a `File` for a linked clip, the workspace copy, or a path-linked file's media URL. */
  getSourceBlob: (mediaId: string) => Promise<ShadowSource | null>
  /** Writes a cleaned file into the project folder and gives the URL the renderer reads. */
  savePiece: (segments: string[], blob: Blob) => Promise<string>
  /** Opens a page in the system browser: the sign-in's approval, a credit purchase (slice E7's bridge). */
  openUrl: (url: string) => void | Promise<void>
  /** How a poll waits between reads; the tests make it immediate. */
  sleep: (ms: number) => Promise<void>
  /** A fresh id for one job attempt, so a lost answer never makes a second job (`attemptId`). */
  newAttemptId: () => string
  /** The time now: when a press is written, and whether the pass's upload is still kept. */
  now: () => Date
  /** Saves the open project the way Cmd+S does, once a press is on the record. */
  saveProject: () => Promise<void>
}

let injected: Partial<ShadowSessionDeps> | null = null
let defaults: ShadowSessionDeps | null = null

/** The web editor's token store: `sessionStorage`, or nothing at all when the browser refuses it. */
function createBrowserSession(): DroneCleanSession {
  const read = (): string | null => {
    try {
      return window.sessionStorage.getItem(TOKEN_STORAGE_KEY)
    } catch {
      return null
    }
  }
  return {
    getToken: async () => read(),
    setToken: async (token) => {
      try {
        if (token === null) window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
        else window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
      } catch {
        // A browser that refuses storage cannot keep a session: the next call signs in again.
      }
    },
  }
}

/** Opens a page in the system browser, as the web shell does (the desktop uses its bridge). */
function openInBrowser(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * The clip's own file, read through the media library the way the preview reads it: a Blob, or for a file the desktop
 * shell serves by path (the way a pilot links the originals) its media URL, which the cutter reads in ranges.
 */
async function readSource(mediaId: string): Promise<ShadowSource | null> {
  const { mediaLibraryService } =
    await import('@/features/media-library/services/media-library-service')
  const media = await mediaLibraryService.getMedia(mediaId)
  if (media?.storageType === 'path') {
    const { resolveMediaUrl } = await import('@/features/media-library/utils/media-resolver')
    return { url: await resolveMediaUrl(mediaId) }
  }
  return mediaLibraryService.getMediaFile(mediaId)
}

/** The shell's defaults, built once: the browser client, the browser cutter, the media library's reader. */
function defaultDeps(): ShadowSessionDeps {
  const session = createBrowserSession()
  return {
    session,
    client: createDroneCleanClient({
      baseUrl: DEFAULT_API_BASE_URL,
      fetch: (url, init) => fetch(url, init),
      session,
      openUrl: openInBrowser,
    }),
    cutter: mediabunnyShadowCutter,
    getSourceBlob: readSource,
    savePiece: savePieceInWorkspace,
    openUrl: openInBrowser,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newAttemptId: () => crypto.randomUUID(),
    now: () => new Date(),
    saveProject: saveOpenProject,
  }
}

/**
 * Replaces the flow's dependencies (the tests inject the recorded client, a fake cutter and an
 * immediate clock; E7 injects the desktop session and browser opener). Pass null to go back to the
 * web shell's defaults. The client and the session must be the same pair: the flow asks the
 * session for the token and the client for everything else.
 */
export function configureShadowSession(overrides: Partial<ShadowSessionDeps> | null): void {
  injected = overrides
  defaults = null
}

function sessionDeps(): ShadowSessionDeps {
  defaults ??= defaultDeps()
  return injected ? { ...defaults, ...injected } : defaults
}

/** The source's frame count, from its measured length; at least one frame. */
function sourceFrameCount(media: MediaMetadata, rate: Rate): number {
  return Math.max(1, secondsToFrame(rate, media.duration))
}

/**
 * The part of the source the clip shows, in source frames: the piece the pilot chose by trimming or
 * splitting the clip (decided 19 Nov 2026). The shadow is looked for, priced and cleaned only inside
 * it; the window the cutter plans around it starts on a keyframe at or before it, so the piece
 * uploaded is at most one GOP longer on either side (design 4.1, section 5.2).
 */
function clipSourceRange(item: VideoItem, frames: number): ShadowCutRange {
  const startFrame = Math.max(0, Math.min(frames - 1, Math.round(item.sourceStart ?? 0)))
  const endFrame = Math.max(startFrame + 1, Math.min(frames, Math.round(item.sourceEnd ?? frames)))
  return { startFrame, endFrame }
}

/** The found ranges kept inside the clip's part: the GOPs the cut adds around it are not the pilot's */
function insideClipRange(ranges: SourceFrameRange[], range: ShadowCutRange): SourceFrameRange[] {
  return ranges.flatMap((found) => {
    const startFrame = Math.max(found.startFrame, range.startFrame)
    const endFrame = Math.min(found.endFrame, range.endFrame)
    return endFrame > startFrame ? [{ startFrame, endFrame }] : []
  })
}

/** Whether two marks are the same click: the same point, the same source frame, the same circle. */
function sameMark(a: ShadowMark, b: ShadowMark): boolean {
  return a.x === b.x && a.y === b.y && a.sourceFrame === b.sourceFrame && a.radius === b.radius
}

/** The free tracking job: a `track` kind from the mark's point inside the uploaded piece. */
function createTrackingJob(
  client: DroneCleanClient,
  deps: ShadowSessionDeps,
  upload: Upload,
  rate: Rate,
  window: ShadowCutWindow,
  mark: ShadowMark,
): Promise<Job> {
  return client.createJob({
    uploadId: upload.id,
    kind: 'track',
    click: shadowClick(rate, window.startFrame, {
      x: mark.x,
      y: mark.y,
      frame: mark.sourceFrame,
      radius: mark.radius,
    }),
    attemptId: deps.newAttemptId(),
  })
}

/** The part of the store the steps below write: the session's data, never its actions. */
type SessionUpdate = (partial: Partial<ShadowSessionState>) => void

/** Signs in when the session has no token; false when the run was abandoned while waiting. */
async function signInIfNeeded(
  deps: ShadowSessionDeps,
  set: SessionUpdate,
  abandoned: () => boolean,
): Promise<boolean> {
  if (await deps.session.getToken()) return true
  set({ stage: 'signing-in' })
  const started = await deps.client.startSignIn()
  if (abandoned()) return false
  set({ signIn: { userCode: started.userCode, verificationUrl: started.verificationUriComplete } })
  await started.waitForToken()
  if (abandoned()) return false
  const account = await deps.client.getAccount()
  if (abandoned()) return false
  set({ signIn: null, account })
  return true
}

/** Plans and cuts the clip's part of the source; null when the run was abandoned. */
async function cutClipPart(
  deps: ShadowSessionDeps,
  media: MediaMetadata,
  range: ShadowCutRange,
  rate: Rate,
  set: SessionUpdate,
  abandoned: () => boolean,
): Promise<{ window: ShadowCutWindow; piece: Blob } | null> {
  set({ stage: 'cutting' })
  const source = await deps.getSourceBlob(media.id)
  if (!source) throw new Error("The clip's file could not be read.")
  if (abandoned()) return null
  const window = await deps.cutter.plan(source, range, rate)
  const piece = await deps.cutter.cut(source, window)
  return abandoned() ? null : { window, piece }
}

/** Uploads the piece, reporting its progress; null when the run was abandoned. */
async function uploadPiece(
  deps: ShadowSessionDeps,
  media: MediaMetadata,
  rate: Rate,
  cut: { window: ShadowCutWindow; piece: Blob },
  set: SessionUpdate,
  abandoned: () => boolean,
): Promise<Upload | null> {
  set({ stage: 'uploading' })
  const upload = await deps.client.uploadPiece(
    cut.piece,
    pieceVideoMeta(media, rate, cut.window, cut.piece),
    {
      onProgress: (fraction) => {
        if (!abandoned()) set({ progress: fraction })
      },
    },
  )
  return abandoned() ? null : upload
}

/** Creates and follows the free tracking job, then reads its keyframes; null when abandoned. */
async function trackPiece(
  deps: ShadowSessionDeps,
  upload: Upload,
  rate: Rate,
  window: ShadowCutWindow,
  mark: ShadowMark,
  set: SessionUpdate,
  abandoned: () => boolean,
): Promise<{ job: Job; track: TrackData } | null> {
  set({ stage: 'tracking' })
  const started = await createTrackingJob(deps.client, deps, upload, rate, window, mark)
  if (!abandoned()) set({ activeJobId: started.id })
  const job = await waitForJob(deps.client, started, {
    sleep: deps.sleep,
    abandoned,
    failureMessage: 'The tracking pass did not finish. Please try again.',
  })
  set({ activeJobId: null })
  if (!job) {
    // Nobody waits for this pass any more: stop it on the server (free, but it holds a slot).
    await stopJob(deps.client, started.id)
    return null
  }
  const track = await deps.client.getTrack(job.id)
  return abandoned() ? null : { job, track }
}

interface PricedPass {
  points: SourceTrackPoint[]
  proposal: { ranges: SourceFrameRange[]; segments: Segment[] }
  quote: JobQuote | null
  config: ServiceConfig
}

/**
 * The pass in source frames, the ranges it proposes and their price; null when abandoned. The
 * price is the server's quote on the uploaded piece itself, so it is priced by the frame rate the
 * server measured, exactly as the job on that upload will be.
 */
async function pricePass(
  deps: ShadowSessionDeps,
  rate: Rate,
  cut: { window: ShadowCutWindow; range: ShadowCutRange },
  upload: Upload,
  job: Job,
  track: TrackData,
  abandoned: () => boolean,
): Promise<PricedPass | null> {
  const { window, range } = cut
  const points = trackPointsInSourceFrames(window.startFrame, track)
  const found = insideClipRange(
    trackRangesInSourceFrames(rate, window.startFrame, job.track ?? { ranges: [] }),
    range,
  )
  const proposal = anchoredSegments(rate, window.startFrame, found, points, job.id)
  const quote = proposal.segments.length
    ? await deps.client.quoteJob({
        uploadId: upload.id,
        segments: proposal.segments,
        options: FULL_JOB_OPTIONS,
      })
    : null
  const config = await deps.client.getConfig()
  return abandoned() ? null : { points, proposal, quote, config }
}

/**
 * The free pass, step by step: sign in if needed, cut, upload, follow, price. Every step returns
 * null when the section was closed or the clip changed under it; a failure stops the pass and is
 * shown by the caller.
 */
async function runPass(
  deps: ShadowSessionDeps,
  item: VideoItem,
  media: MediaMetadata,
  mark: ShadowMark,
  update: SessionUpdate,
  abandoned: () => boolean,
): Promise<void> {
  if (!(await signInIfNeeded(deps, update, abandoned))) return
  const rate = sourceRateOf(item)
  const range = clipSourceRange(item, sourceFrameCount(media, rate))
  const cut = await cutClipPart(deps, media, range, rate, update, abandoned)
  if (!cut) return
  const upload = await uploadPiece(deps, media, rate, cut, update, abandoned)
  if (!upload) return
  const tracked = await trackPiece(deps, upload, rate, cut.window, mark, update, abandoned)
  if (!tracked) return
  const priced = await pricePass(
    deps,
    rate,
    { window: cut.window, range },
    upload,
    tracked.job,
    tracked.track,
    abandoned,
  )
  if (!priced) return
  update({
    stage: 'ready',
    progress: 1,
    pass: {
      jobId: tracked.job.id,
      uploadId: upload.id,
      uploadCreatedAt: upload.createdAt,
      mark,
      window: cut.window,
      points: priced.points,
      ranges: priced.proposal.ranges,
    },
    quote: priced.quote,
    config: priced.config,
  })
}

/** Whether the last failure was the API refusing the session, so the panel offers a new sign-in. */
function isSignInRequired(error: unknown): boolean {
  return error instanceof SignInRequiredError
}

/**
 * Whether a run ended because it was stopped, which is no failure to show. By name: an
 * `AbortError` is a `DOMException`, which is not an `Error` everywhere.
 */
function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}

/** The media-library record of the clip a flow works on, when it still has one. */
function mediaOf(item: VideoItem): MediaMetadata | undefined {
  return item.mediaId ? useMediaLibraryStore.getState().mediaById[item.mediaId] : undefined
}

/** Whether the finished pass answered exactly this mark: a second press then reuses it. */
function passAnswersMark(pass: ShadowTrackPass | null, mark: ShadowMark | undefined): boolean {
  return pass !== null && mark !== undefined && sameMark(pass.mark, mark)
}

/** The patch a failed flow shows, or null when its run was abandoned (nothing to show then). */
function failurePatch(
  error: unknown,
  abandoned: () => boolean,
  stage: ShadowStage,
): Partial<ShadowSessionState> | null {
  if (abandoned()) return null
  return {
    stage,
    progress: 0,
    activeJobId: null,
    signIn: null,
    error: messageOf(error),
    needsSignIn: isSignInRequired(error),
  }
}

/** What the free pass needs from the section, or the reason it cannot start. */
type TrackStart = { error: string } | { mark: ShadowMark; media: MediaMetadata }

/** The clip's mark and source for the free pass, or the sentence that says what is missing. */
function trackStart(
  item: VideoItem,
  mark: ShadowMark | undefined,
  media: MediaMetadata | undefined,
): TrackStart {
  if (!mark) return { error: 'Mark the shadow first.' }
  if (!media || shadowAvailability(item, media).state !== 'ready') {
    return { error: "The clip's file cannot be read." }
  }
  return { mark, media }
}

/** What the paid clean needs from the section, or the reason it cannot start. */
type CleanStart =
  | { error: string; passGone?: true }
  | { pass: ShadowTrackPass; quote: JobQuote; media: MediaMetadata }

/** Whether the cloud still keeps the pass's upload, so the job can run on it. */
function uploadStillKept(pass: ShadowTrackPass, now: Date): boolean {
  const created = pass.uploadCreatedAt === undefined ? Number.NaN : Date.parse(pass.uploadCreatedAt)
  return !Number.isFinite(created) || now.getTime() - created < UPLOAD_KEPT_MS
}

/**
 * Why the priced pass cannot be paid for now, or null: the cloud no longer keeps its upload (the
 * pass is dropped, so following the shadow again uploads afresh), or a clean of the same frames is
 * still on its way (a second press would pay for them twice).
 */
function passRefusal(
  item: VideoItem,
  pass: ShadowTrackPass,
  now: Date,
): { error: string; passGone?: true } | null {
  if (!uploadStillKept(pass, now)) {
    return {
      error: 'DroneClean no longer keeps the uploaded seconds. Follow the shadow again.',
      passGone: true,
    }
  }
  const live = useItemsStore.getState().itemById[item.id]
  const record = live?.type === 'video' ? live.shadowRemoval : item.shadowRemoval
  if (pendingCleansOver(record, pass.window.startFrame, pass.window.endFrame).length > 0) {
    return { error: 'A paid clean of these frames is already on its way.' }
  }
  return null
}

/** The priced pass and source the clean pays for, or the sentence that says what is missing. */
function cleanStart(
  item: VideoItem,
  mark: ShadowMark | undefined,
  media: MediaMetadata | undefined,
  pass: ShadowTrackPass | null,
  quote: JobQuote | null,
  now: Date,
): CleanStart {
  if (!mark) return { error: 'Mark the shadow first.' }
  if (!media || shadowAvailability(item, media).state !== 'ready') {
    return { error: "The clip's file cannot be read." }
  }
  if (!pass || pass.ranges.length === 0) return { error: 'Follow the shadow first.' }
  if (!quote) return { error: 'The seconds to clean have no price yet. Follow the shadow again.' }
  return passRefusal(item, pass, now) ?? { pass, quote, media }
}

/** What a press on Clean pays for, from the session as it is: the pass is only its own clip's. */
function cleanStartOf(state: ShadowSessionState, item: VideoItem, now: Date): CleanStart {
  const open = state.clipId === item.id
  return cleanStart(
    item,
    item.shadowRemoval?.mark,
    mediaOf(item),
    open ? state.pass : null,
    open ? state.quote : null,
    now,
  )
}

/** The clip's exact source rate, as the pass and the clean count its frames. */
function sourceRateOf(item: VideoItem): Rate {
  return toRate(getMediaSourceFps(item, useTimelineSettingsStore.getState().fps))
}

/** The pending cleans a run is working on now, as `itemId:attemptId`: one run each, never two. */
interface RunningCleans {
  running: readonly string[]
  /** The running cleans whose job succeeded: paid for, past any cancel, being brought in. */
  paid: readonly string[]
  /** The last failure of a clean that runs with nobody watching, by the same key, ready to show. */
  errors: Readonly<Record<string, string>>
}

const useRunningCleansStore = create<RunningCleans>()(() => ({ running: [], paid: [], errors: {} }))

/** What stops each running clean's job, by the same key: the pilot's Cancel on its line. */
const cancelOfClean = new Map<string, () => void>()

/** The key of one pending clean of one clip (a split clip's halves each carry their own). */
export function cleanKey(itemId: string, attemptId: string): string {
  return `${itemId}:${attemptId}`
}

/** Takes a pending clean for one run, with what stops its job; false when a run already has it. */
function claimClean(key: string, cancel: () => void): boolean {
  const { running, errors } = useRunningCleansStore.getState()
  if (running.includes(key)) return false
  const rest = { ...errors }
  delete rest[key]
  cancelOfClean.set(key, cancel)
  useRunningCleansStore.setState({ running: [...running, key], errors: rest })
  return true
}

/** The run is over; its failure, if any, stays to be shown (a stop is no failure). */
function releaseClean(key: string, error?: unknown): void {
  const { running, paid, errors } = useRunningCleansStore.getState()
  const failed = error !== undefined && !isAbort(error)
  cancelOfClean.delete(key)
  useRunningCleansStore.setState({
    running: running.filter((entry) => entry !== key),
    paid: paid.filter((entry) => entry !== key),
    errors: failed ? { ...errors, [key]: messageOf(error) } : errors,
  })
}

/** A running clean moved on: once its job succeeded (downloading, saving) it is past any cancel. */
function noteCleanStage(key: string, stage: ShadowCleanStage): void {
  const { paid } = useRunningCleansStore.getState()
  if (stage !== 'cleaning' && !paid.includes(key)) {
    useRunningCleansStore.setState({ paid: [...paid, key] })
  }
}

/**
 * The pilot's Cancel on one pending clean's line: its run stops the job, which gives the credits
 * back, under the same rules as the section's Cancel. A job that already succeeded was paid for and
 * is still recorded.
 */
export function cancelPendingClean(itemId: string, attemptId: string): void {
  cancelOfClean.get(cleanKey(itemId, attemptId))?.()
}

/**
 * Forgets a pending clean the service does not know (`state: 'missing'`), at the pilot's word, so
 * the press on its frames is not blocked forever. Nothing is forgotten while a run works on it.
 */
export function forgetPendingClean(itemId: string, attemptId: string): void {
  if (useRunningCleansStore.getState().running.includes(cleanKey(itemId, attemptId))) return
  dropForgottenClean(itemId, attemptId)
}

/**
 * The pending cleans being worked on now, those past any cancel, and the last failure of each that
 * ran with nobody watching: a hook for the panel, and `getState()` outside React.
 */
export const useRunningCleans = useRunningCleansStore

/**
 * The flow's dependencies for a clean nobody watches: no progress to show; its stage tells the
 * panel when it is past any cancel, and its line's Cancel stops it. It is on the record already,
 * so there is no press to save.
 */
function backgroundCleanDeps(
  deps: ShadowSessionDeps,
  key: string,
  isCancelled: () => boolean,
): ShadowCleanDeps {
  return {
    client: deps.client,
    sleep: deps.sleep,
    now: deps.now,
    savePiece: deps.savePiece,
    savePress: async () => undefined,
    onJob: () => undefined,
    onStage: (stage) => noteCleanStage(key, stage),
    onProgress: () => undefined,
    isCancelled,
  }
}

/**
 * Picks up every paid clean the open timeline's clips still carry (`shadowRemoval.pending`) and
 * that no run is working on: its job is read again, or its creation asked for again with the same
 * attempt, followed, and its result downloaded and recorded, with nobody watching (`resumeClean`).
 * Meant for when a project opens; a section opening calls it too, and so does the panel's "Try
 * again". A clean already running is left to its run, so calling it twice starts nothing twice.
 * Resolves when every clean it started has ended.
 */
export async function resumePendingCleans(): Promise<void> {
  const items = useItemsStore.getState().items
  if (!items.some((item) => item.type === 'video' && item.shadowRemoval?.pending?.length)) return
  const deps = sessionDeps()
  const runs: Promise<void>[] = []
  for (const item of items) {
    if (item.type !== 'video') continue
    for (const pending of item.shadowRemoval?.pending ?? []) {
      const key = cleanKey(item.id, pending.attemptId)
      let cancelled = false
      if (!claimClean(key, () => (cancelled = true))) continue
      runs.push(
        resumeClean(
          item.id,
          pending.attemptId,
          backgroundCleanDeps(deps, key, () => cancelled),
        ).then(
          () => releaseClean(key),
          (error: unknown) => {
            releaseClean(key, error)
            // The session is the whole window's: a token the API refused is asked for again there.
            if (isSignInRequired(error)) {
              useShadowSessionStore.setState({ needsSignIn: true, error: messageOf(error) })
            }
          },
        ),
      )
    }
  }
  await Promise.all(runs)
}

/** The clean one press pays for: the priced pass's ranges, on its upload, at the price shown. */
function cleanRequestOf(
  item: VideoItem,
  start: { pass: ShadowTrackPass; quote: JobQuote },
  attemptId: string,
): ShadowCleanRequest {
  return {
    item,
    rate: sourceRateOf(item),
    pass: {
      jobId: start.pass.jobId,
      uploadId: start.pass.uploadId,
      window: start.pass.window,
      points: start.pass.points,
    },
    ranges: start.pass.ranges,
    credits: start.quote.costCredits,
    attemptId,
  }
}

/**
 * The flow's dependencies for the clean the section watches: its stage, progress and job go to
 * the run's writer, which drops them once the pilot has moved on. Only the pilot's Cancel stops
 * the job: leaving the clip or closing the section does not, and the result is recorded when it
 * comes.
 */
function foregroundCleanDeps(
  deps: ShadowSessionDeps,
  run: ShadowRun,
  key: string,
  isCancelled: () => boolean,
): ShadowCleanDeps {
  return {
    client: deps.client,
    sleep: deps.sleep,
    now: deps.now,
    savePiece: deps.savePiece,
    // Saved the way Cmd+S saves; a failed save leaves the press going and the panel says so.
    savePress: async () => {
      try {
        await deps.saveProject()
      } catch {
        run.update({ projectNotSaved: true })
      }
    },
    onJob: (jobId) => run.update({ activeJobId: jobId }),
    onStage: (stage) => {
      noteCleanStage(key, stage)
      run.update({ stage })
    },
    onProgress: (progress) => run.update({ progress }),
    isCancelled,
  }
}

/**
 * What a failed clean shows, or null when nobody watches it any more. A job the API refused on
 * the pass's upload (409: no longer stored) drops the pass, so following the shadow again uploads
 * a fresh piece.
 */
function cleanFailurePatch(
  error: unknown,
  abandoned: () => boolean,
): Partial<ShadowSessionState> | null {
  const patch = failurePatch(error, abandoned, 'ready')
  if (!patch) return null
  const uploadRefused = error instanceof DroneCleanApiError && error.status === 409
  return uploadRefused ? { ...patch, stage: 'idle', pass: null, quote: null } : patch
}

/** The press of each run that is a paid clean: what the section's Cancel calls. */
const cancelCleanOfRun = new Map<number, () => void>()

/** One run of the section: its number, and the writes that still belong to it. */
interface ShadowRun {
  number: number
  abandoned: () => boolean
  update: SessionUpdate
}

export const useShadowSessionStore = create<ShadowSessionStore>()((set, get) => {
  /**
   * Starts one run of the section: a new run number (every answer for an older run is dropped),
   * the state a run begins from, and the writer that ignores an answer the run has lost.
   */
  const beginRun = (reset: Partial<ShadowSessionState> = {}): ShadowRun => {
    const run = get().run + 1
    set({
      run,
      stage: 'idle',
      error: null,
      needsSignIn: false,
      progress: 0,
      activeJobId: null,
      projectNotSaved: false,
      ...reset,
    })
    return {
      number: run,
      abandoned: () => get().run !== run,
      update: (partial) => {
        if (get().run === run) set(partial)
      },
    }
  }

  return {
    ...SHADOW_SESSION_IDLE,

    open: (clipId) => {
      const current = get()
      if (current.clipId === clipId) {
        set({ isOpen: true })
      } else {
        set({ ...SHADOW_SESSION_IDLE, clipId, isOpen: true, run: current.run + 1 })
      }
      // A clean paid for earlier and not recorded yet (the app closed, the network dropped) is
      // picked up again; one already running is left to its run.
      void resumePendingCleans()
    },

    close: () => set({ isOpen: false, marking: false }),

    startMarking: () => set({ marking: true }),

    cancelMarking: () => set({ marking: false }),

    setMark: (item, mark) => {
      // Everything else the record holds stays: the ranges and pieces paid for, the cleans still
      // on their way, and the fields a newer version wrote.
      const existing = item.shadowRemoval
      const record = validateShadowRemoval({
        ...existing,
        mark,
        ranges: existing?.ranges ?? [],
        pieces: existing?.pieces ?? [],
      })
      updateItem(item.id, { shadowRemoval: record })
      set({
        ...SHADOW_SESSION_IDLE,
        clipId: item.id,
        isOpen: true,
        run: get().run + 1,
      })
    },

    track: async (item) => {
      const mark = item.shadowRemoval?.mark
      if (get().clipId === item.id && passAnswersMark(get().pass, mark)) {
        // The finished pass is still the answer for this mark. Each pass counts against the cloud's
        // limits, so pressing again reuses it instead of following the shadow a second time; a
        // price the balance did not cover is asked again, since credits may have been bought since.
        if (get().quote?.enough !== true) await get().refreshQuote(item)
        return
      }
      const run = beginRun({ pass: null, quote: null, config: null })
      const start = trackStart(item, mark, mediaOf(item))
      if ('error' in start) {
        set({ error: start.error })
        return
      }
      try {
        await runPass(sessionDeps(), item, start.media, start.mark, run.update, run.abandoned)
      } catch (error) {
        const patch = failurePatch(error, run.abandoned, 'idle')
        if (patch) set(patch)
      }
    },

    clean: async (item) => {
      const deps = sessionDeps()
      const start = cleanStartOf(get(), item, deps.now())
      if ('error' in start) {
        set(
          start.passGone ? { error: start.error, pass: null, quote: null } : { error: start.error },
        )
        return
      }
      const run = beginRun()
      const attemptId = deps.newAttemptId()
      const key = cleanKey(item.id, attemptId)
      let cancelled = false
      const cancel = () => {
        cancelled = true
      }
      // The section's Cancel while it watches; the clean's own line's Cancel once it no longer does.
      cancelCleanOfRun.set(run.number, cancel)
      claimClean(key, cancel)
      let failure: unknown
      try {
        if (!(await signInIfNeeded(deps, run.update, run.abandoned))) return
        await cleanShadow(
          cleanRequestOf(item, start, attemptId),
          foregroundCleanDeps(deps, run, key, () => cancelled),
        )
        run.update({ stage: 'ready', progress: 1, activeJobId: null })
      } catch (error) {
        failure = error
        const patch = cleanFailurePatch(error, run.abandoned)
        if (patch) set(patch)
      } finally {
        cancelCleanOfRun.delete(run.number)
        // The section shows the failure of the run it watches; one nobody watched any more is
        // kept for the panel's line about that clean.
        releaseClean(key, run.abandoned() ? failure : undefined)
      }
    },

    cancel: async () => {
      // A paid clean is told to stop its job, which gives the credits back (one that already
      // succeeded is still recorded: it was paid for). Every answer of the run in flight is then
      // dropped; a tracking pass stops its free job as soon as it sees that it was abandoned.
      cancelCleanOfRun.get(get().run)?.()
      set({
        run: get().run + 1,
        stage: 'idle',
        progress: 0,
        signIn: null,
        marking: false,
        error: null,
        needsSignIn: false,
        activeJobId: null,
      })
    },

    signInAgain: async () => {
      const run = beginRun({ stage: 'signing-in' })
      try {
        if (await signInIfNeeded(sessionDeps(), run.update, run.abandoned)) {
          run.update({ stage: 'idle' })
        }
      } catch (error) {
        const patch = failurePatch(error, run.abandoned, 'idle')
        if (patch) set(patch)
      }
    },

    getCredits: async () => {
      // The free beta sells nothing: its profile page is where credits are asked for instead.
      const freeBeta = get().config?.freeBeta === true
      await sessionDeps().openUrl(freeBeta ? CREDITS_REQUEST_URL : CREDITS_URL)
    },

    refreshQuote: async (item) => {
      const { clipId, pass, run } = get()
      if (clipId !== item.id || !pass) return
      const proposal = anchoredSegments(
        sourceRateOf(item),
        pass.window.startFrame,
        pass.ranges,
        pass.points,
        pass.jobId,
      )
      if (proposal.segments.length === 0) return
      // Only an answer for the pass still on screen is shown.
      const current = () => get().run === run && get().pass === pass
      try {
        const quote = await sessionDeps().client.quoteJob({
          uploadId: pass.uploadId,
          segments: proposal.segments,
          options: FULL_JOB_OPTIONS,
        })
        if (current()) set({ quote, error: null, needsSignIn: false })
      } catch (error) {
        if (current()) set({ error: messageOf(error), needsSignIn: isSignInRequired(error) })
      }
    },
  }
})

/**
 * The open shadow section's session: what the section renders and what the preview's overlays read.
 * One store for the whole window, because the preview and the clip panel are separate trees; the
 * clip it belongs to is `clipId`, and `open` says whether a section is showing it.
 */
export function useShadowSession(): ShadowSessionStore {
  return useShadowSessionStore()
}

/** The clip's live item from the store, so a mark written by the preview reaches the section at once. */
export function useShadowSessionItem(clipId: string | null): VideoItem | undefined {
  return useItemsStore((state) => {
    const item = clipId ? state.itemById[clipId] : undefined
    return item?.type === 'video' ? item : undefined
  })
}
