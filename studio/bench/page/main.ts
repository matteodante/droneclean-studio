/**
 * Benchmark page. Drives the app's own export path (the same calls `use-client-render.ts` makes after it has read
 * the stores): `mapRequestedClientSettings`, the smart-copy check, `resolveClientSettings` (codec probe and
 * fallback), `convertTimelineToComposition`, `resolveMediaUrls`, then `runRender`, which tries the export
 * worker and falls back to the main thread exactly as the app does (every record says which one ran). Nothing here changes how the editor renders or exports; it only times and records it.
 *
 * The page is loaded by Playwright from `bench/lib/browser.mjs` and called through `window.bench`.
 */
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import type { ExtendedExportSettings } from '@/types/export'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type { ClientRenderResult, RenderProgress } from '@/runtime/renderer/client-renderer'

import { CURRENT_SCHEMA_VERSION } from '@/shared/projects/migrations'
import { validateProject } from '@/features/project-bundle/schemas/project-schema'
import { mediaProcessorService } from '@/features/media-library/services/media-processor-service'
import { getMimeType, validateMediaFileContent } from '@/features/media-library/utils/validation'
import { resolveMediaUrls } from '@/features/media-library/utils/media-resolver'
import { convertTimelineToComposition } from '@/features/export/utils/timeline-to-composition'
import { assessSmartCopyEligibility } from '@/features/export/utils/smart-copy'
import { renderSingleFrame } from '@/runtime/renderer/canvas-render-orchestrator'
import { createCompositionRenderer } from '@/runtime/renderer/client-render-engine'
import { MARK_PREFIX, STAGE_TIMINGS_FLAG, timedStageAsync } from '@/studio/render/timings'
import {
  getItemRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
} from '@/runtime/renderer/render-span'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { releaseTemporaryExportOutput } from '@/runtime/renderer/export-output-target'
import { getPacketRemuxPlan } from '@/runtime/renderer/packet-remux-plan'
import { sourceFrameAt, sourceFramesAt, type SpeedCurve } from '@/studio/speed'
import { timelineFramesForSource, toRate } from '@/studio/time'
import { setFeatureOverride } from '@/studio/feature-switches'
import { planMotionBlur, type MotionBlurSettings } from '@/studio/motion-blur'
import type { StabilizationSettings } from '@/studio/stabilization/settings'
import { setStabilizationProjectFrame, stabilizationEngineKey } from '@/studio/stabilization/engine-key'
import {
  createStabilizationSeat,
  installStabilizationSeat,
  stabilizationSeat,
  watchTimelineItems,
} from '@/studio/stabilization/seat'
import { createTestSink, type FloatFrame } from '@/studio/render/test-sink'
import { setPreciseOutputSink } from '@/studio/render/precise/contract'
import {
  LinearMean,
  comparePictures,
  compareToLinearMean,
  startDecodeCounter,
  summariseFrameTimes,
} from './blur'
// The speed-ramp proof's stabilization log (sets window.benchRamp)
import './ramp'
import {
  mapRequestedClientSettings,
  resolveClientSettings,
  runRender,
} from '@/runtime/renderer/render-pipeline'
import { editProject } from '@/headless/edit'
import { seedMediaLibrary } from '@/headless/seed-media'
import { sourceFieldsFor } from '@/headless/edit-op-support'

interface LutEffect {
  lutName: string
  lutSize: string
  lutData: string
}

interface PrepareInput {
  mediaId: string
  mediaUrl: string
  fileName: string
  project: { width: number; height: number; fps: number }
  /** A 3D LUT to add to the clip as the editor's `gpu-lut` effect. */
  lut?: LutEffect
  /**
   * Keep the packet-copy shortcut from taking over. An untouched clip in the source's own codec and size would be
   * copied packet by packet (no render at all); that is not what the engine work changes, so the benchmark nudges
   * the clip's audio gain by 0.01 dB. The clip has no audio: nothing in the picture changes.
   */
  forceRender: boolean
  /**
   * A speed curve to give the clip after placing it (design 7.1, section 4.1): keys are clip-relative, the last
   * one's frame is the clip's timeline length, and the clip keeps the source frames its curve integrates to. The
   * store's normaliser pins the keys and writes the average speed.
   */
  speedCurve?: SpeedCurve
  /** An input colour profile for the clip (the clip then goes through the stage pipeline's input colour stage). */
  inputColor?: 'dlog-m' | 'dlog'
  /** A constant speed for the clip (the clip's length follows, as the editor's speed edit does). Off by default. */
  speed?: number
  /**
   * With `speed`: cut the clip's source end down to a whole number of output frames' worth (a multiple of the speed), so
   * that no blurred output frame asks for a source frame past the file's last. Found on 19 Nov 2026: at 4x a 1,199 frame
   * file makes output frame 299 ask for source frame 1199, which does not exist (`StageError: has no frame 1199`).
   */
  wholeSpans?: boolean
  /**
   * Motion blur on the clip (design 7.2), with its smooth slow motion when given (task 11.12): the field is set and the
   * hidden `motionBlur` switch is turned on for this page, as the golden kit does. Off by default.
   */
  motionBlur?: MotionBlurSettings
  /**
   * Stabilization on the clip, a later slice's proof of a stabilized export: these fields over the engine's defaults
   * (method Default, smoothness 0.5, fov 1, no horizon lock, 4 s adaptive zoom), with `enabled` true. Off by default.
   */
  stabilization?: Partial<StabilizationSettings>
  /**
   * The modification time the clip's file is given inside the page (the original file's own, from the driver). The copy
   * in the page's storage is stamped when it is written, and the motion cache keys a file by name, size and
   * modification time (`motionCacheKey`): without this a second run of the page never finds the first run's cache.
   */
  fileLastModified?: number
  /**
   * Show only these source frames of the clip (speed 1): the clip's source range and length are set to them. For a
   * whole file too long to export in one measurement (the 3.76 GB clip 0020 is 231 s; the proof exports 60 s).
   */
  sourceWindow?: { startFrame: number; frames: number }
}

/** One stage mark the editor recorded with the timings flag on (src/studio/render/timings.ts). */
interface TimingEntry {
  name: string
  startTime: number
  duration: number
  detail?: { frame?: number } | null
}

/** Turns the timings flag on for one run and reads the marks it produced. */
function startTimings() {
  performance.clearMeasures()
  ;(globalThis as Record<string, unknown>)[STAGE_TIMINGS_FLAG] = true
  return {
    stop(): TimingEntry[] {
      ;(globalThis as Record<string, unknown>)[STAGE_TIMINGS_FLAG] = false
      const entries = performance
        .getEntriesByType('measure')
        .filter((e) => e.name.startsWith(MARK_PREFIX))
        .map((e) => ({
          name: e.name,
          startTime: e.startTime,
          duration: e.duration,
          detail: (e as PerformanceMeasure).detail as { frame?: number } | null,
        }))
      performance.clearMeasures()
      return entries
    },
  }
}

/** What a curved clip's export is checked against: the app's own prediction for every output frame. */
interface SpeedCurveFacts {
  keys: Array<{ frame: number; speed: number }>
  averageSpeed: number
  from: number
  durationInFrames: number
  sourceStart: number
  sourceEnd: number | null
  /** `sourceFrameAt` for each output frame of the composition — the mapping the design asks for. */
  predictedSourceFrames: number[]
  /** The frame the render path resolves for the same output frame, from its start time. */
  renderPathSourceFrames: number[]
  /** Output frames where the render path and the mapping disagree; 0 expected. */
  renderPathDisagreements: number
}

interface ExportRecord {
  requested: Record<string, unknown>
  effective: Record<string, unknown>
  smartCopy: { eligible: boolean; reason: string }
  /** With smart copy switched on, when this run switched it off; null when the run left it on. */
  smartCopyIfEnabled: { eligible: boolean; reason: string } | null
  packetRemuxPlanned: boolean
  renderPath: string
  workerFallbackReason: string | null
  wallMs: number
  prepMs: number
  firstFrameMs: number | null
  frames: number
  fps: number
  steadyFps: number | null
  fileSize: number
  durationSeconds: number
  mimeType: string
  /** The stage marks, when the run asked for timings. */
  timingMarks?: TimingEntry[]
}

interface Session {
  metadata: MediaMetadata
  project: Project
  tracks: TimelineTrack[]
  items: TimelineItem[]
  lastResult: ClientRenderResult | null
  lastStill: Blob | null
}

// The import measurement has its own page (bench/page/import.html). Its code
// lives in a separate module so the export measurements do not load the media
// library; this page module is shared so the bundler has one configured entry.
if (document.body?.dataset.page === 'import') {
  await import('./import')
}
// The import side-work measurement drives the same import, then the work an import leads to (side-work.ts).
if (document.body?.dataset.page === 'side-work') {
  await import('./side-work')
}
// The long-export measurement's page (bench/page/long-export.html) loads its module the same way; it sets
// `window.longExport`, and this module's `window.bench` (ready, gpuInfo) serves the driver's start-up checks.
if (document.body?.dataset.page === 'long-export') {
  await import('./long-export')
}

let session: Session | null = null
/** The file `importMedia` handed the renderer: the stabilization host of a stabilized run reads the engine's file from it */
let importedFile: File | null = null

async function copyToOpfs(url: string, fileName: string): Promise<File> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Media fetch failed: HTTP ${response.status}`)
  const root = await navigator.storage.getDirectory()
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-160)
  const handle = await root.getFileHandle(`bench-${crypto.randomUUID()}-${safe}`, { create: true })
  const writable = await handle.createWritable()
  await response.body.pipeTo(writable)
  return handle.getFile()
}

async function importMedia(input: PrepareInput): Promise<MediaMetadata> {
  const stored = await copyToOpfs(input.mediaUrl, input.fileName)
  const file =
    input.fileLastModified === undefined
      ? stored
      : new File([stored], input.fileName, {
          type: stored.type,
          lastModified: input.fileLastModified,
        })
  importedFile = file
  const validation = await validateMediaFileContent(file)
  if (!validation.valid) throw new Error(validation.error ?? 'Media validation failed')
  const mimeType = getMimeType(file)
  const { metadata } = await mediaProcessorService.processMedia(file, mimeType, {
    generateThumbnail: false,
    fastMetadata: true,
  })
  const now = Date.now()
  const full = {
    ...metadata,
    id: input.mediaId,
    storageType: 'workspace',
    fileName: input.fileName,
    fileSize: file.size,
    fileLastModified: file.lastModified,
    mimeType,
    tags: [],
    createdAt: now,
    updatedAt: now,
  } as MediaMetadata
  // The app keeps the file in the workspace and hands the renderer a blob URL; do the same.
  blobUrlManager.acquire(input.mediaId, file)
  seedMediaLibrary([{ metadata: full }])
  return full
}

function newProject(width: number, height: number, fps: number): Project {
  const now = Date.now()
  const raw = {
    id: crypto.randomUUID(),
    name: 'bench',
    description: '',
    createdAt: now,
    updatedAt: now,
    duration: 0,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: { width, height, fps },
  }
  const validated = validateProject(raw)
  if (!validated.success || !validated.data) throw new Error('bench project failed validation')
  return validated.data as Project
}

/** The composition the export dialog would build from the timeline, with the media resolved to blob URLs. */
async function buildComposition(itemsOverride?: TimelineItem[]) {
  if (!session) throw new Error('call prepare() first')
  const { project, tracks } = session
  const items = itemsOverride ?? session.items
  const composition = convertTimelineToComposition(
    tracks,
    items,
    [],
    project.metadata.fps,
    project.metadata.width,
    project.metadata.height,
    null,
    null,
    [],
    project.metadata.backgroundColor,
    undefined,
    undefined,
  )
  composition.tracks = await resolveMediaUrls(composition.tracks, { useProxy: false })
  return composition
}

async function prepare(input: PrepareInput) {
  const metadata = await importMedia(input)
  const ops: Array<Record<string, unknown>> = [
    { op: 'addClip', callerId: 'clip', mediaId: input.mediaId, from: 0 },
  ]
  if (input.forceRender) {
    ops.push({
      op: 'updateItem',
      id: { $ref: 'clip#/detail/created/0/id' },
      updates: { volume: 0.01 },
    })
  }
  if (input.lut) {
    ops.push({
      op: 'addEffect',
      itemId: { $ref: 'clip#/detail/created/0/id' },
      gpuEffectType: 'gpu-lut',
      params: { intensity: 1, ...input.lut },
    })
  }
  if (input.inputColor) {
    ops.push({
      op: 'updateItem',
      id: { $ref: 'clip#/detail/created/0/id' },
      updates: { inputColor: input.inputColor },
    })
  }
  if (input.speed !== undefined) {
    if (input.speedCurve) throw new Error('give the clip a speed or a speed curve, not both')
    const fields = sourceFieldsFor(metadata, input.project.fps)
    const sourceEnd = input.wholeSpans
      ? Math.floor(fields.sourceEnd / input.speed) * input.speed
      : fields.sourceEnd
    ops.push({
      op: 'updateItem',
      id: { $ref: 'clip#/detail/created/0/id' },
      updates: {
        speed: input.speed,
        ...(input.wholeSpans ? { sourceEnd } : {}),
        durationInFrames: timelineFramesForSource(
          sourceEnd,
          toRate(fields.sourceFps),
          toRate(input.project.fps),
          input.speed,
        ),
      },
    })
  }
  if (input.motionBlur) {
    ops.push({
      op: 'updateItem',
      id: { $ref: 'clip#/detail/created/0/id' },
      updates: { motionBlur: input.motionBlur },
    })
  }
  if (input.sourceWindow) {
    if (input.speed !== undefined || input.speedCurve)
      throw new Error('a source window is for a clip at speed 1')
    const fields = sourceFieldsFor(metadata, input.project.fps)
    const { startFrame, frames } = input.sourceWindow
    if (startFrame < 0 || frames < 1 || startFrame + frames > fields.sourceEnd)
      throw new Error(
        `source window ${startFrame}+${frames} is outside the ${fields.sourceEnd} frames of the file`,
      )
    ops.push({
      op: 'updateItem',
      id: { $ref: 'clip#/detail/created/0/id' },
      updates: {
        sourceStart: startFrame,
        sourceEnd: startFrame + frames,
        durationInFrames: timelineFramesForSource(
          frames,
          toRate(fields.sourceFps),
          toRate(input.project.fps),
          1,
        ),
      },
    })
  }
  if (input.stabilization) {
    installBenchSeat()
    ops.push({
      op: 'updateItem',
      id: { $ref: 'clip#/detail/created/0/id' },
      updates: {
        stabilization: {
          enabled: true,
          method: 'Default',
          params: { smoothness: 0.5 },
          fov: 1,
          horizonLockPercent: 0,
          horizonLockRoll: 0,
          adaptiveZoomSeconds: 4,
          ...input.stabilization,
        },
      },
    })
  }
  setFeatureOverride('motionBlur', input.motionBlur ? true : undefined)
  if (input.motionBlur) keepExportOnThisPage()
  if (input.speedCurve) {
    // The clip keeps the source frames the curve integrates to over its own length, so the
    // source end is the curve at the first frame past the clip, not `duration x speed`.
    const durationInFrames = input.speedCurve.keys[input.speedCurve.keys.length - 1]!.frame
    const sourceEnd = Math.floor(
      sourceFramesAt(
        input.speedCurve,
        durationInFrames,
        toRate(metadata.fps),
        toRate(input.project.fps),
      ),
    )
    ops.push({
      op: 'updateItem',
      id: { $ref: 'clip#/detail/created/0/id' },
      updates: { durationInFrames, sourceEnd, speedCurve: input.speedCurve },
    })
  }
  // A file with sound is placed as the app places it: the picture and a linked audio companion, which share the
  // clip's timing. What changes the timing (speed, curve, trim, length) is done to both, as the app's own edits do,
  // or the companion would play the whole file at speed 1 beside the curved picture.
  if (metadata.audioCodec) {
    const timing = ['speed', 'speedCurve', 'sourceStart', 'sourceEnd', 'durationInFrames']
    for (const op of [...ops]) {
      const updates = op.updates as Record<string, unknown> | undefined
      if (op.op !== 'updateItem' || !updates || !timing.some((key) => key in updates)) continue
      ops.push({
        op: 'updateItem',
        id: { $ref: 'clip#/detail/created/1/id' },
        updates: Object.fromEntries(timing.filter((key) => key in updates).map((key) => [key, updates[key]])),
      })
    }
  }
  // As the app does, so a stabilized export follows the project's frame (4:3 stays 4:3)
  setStabilizationProjectFrame(input.project)
  const edited = await editProject({
    project: newProject(input.project.width, input.project.height, input.project.fps),
    ops: ops as never,
    media: [{ mediaId: input.mediaId, metadata }],
  })
  const timeline = edited.project.timeline
  if (!timeline) throw new Error('edit produced no timeline')
  session = {
    metadata,
    project: edited.project,
    tracks: (timeline.tracks ?? []) as unknown as TimelineTrack[],
    items: (timeline.items ?? []) as unknown as TimelineItem[],
    lastResult: null,
    lastStill: null,
  }
  const clip = session.items.find((item) => item.type === 'video') as VideoItem | undefined
  return {
    metadata: {
      duration: metadata.duration,
      fps: metadata.fps,
      width: metadata.width,
      height: metadata.height,
      codec: metadata.codec,
      bitrate: metadata.bitrate,
      fileSize: metadata.fileSize,
    },
    clip: clip && {
      from: clip.from,
      durationInFrames: clip.durationInFrames,
      effects: clip.effects?.length ?? 0,
      speed: clip.speed ?? 1,
      sourceStart: clip.sourceStart ?? 0,
      sourceEnd: clip.sourceEnd ?? null,
      motionBlur: clip.motionBlur ?? null,
      stabilized: clip.stabilization?.enabled === true,
    },
    speedCurve: clip ? describeSpeedCurve(clip) : undefined,
  }
}

/**
 * The prediction a curved clip's export is checked against (design 7.1, section 4.2): for each
 * output frame of the composition, the source frame `sourceFrameAt` asks for, and the frame the
 * render path itself resolves from that output frame — the two must be the same frame.
 */
function describeSpeedCurve(clip: VideoItem): SpeedCurveFacts | undefined {
  const curve = clip.speedCurve
  if (!curve) return undefined
  const projectFps = session!.project.metadata.fps
  const sourceRate = toRate(clip.sourceFps ?? projectFps)
  const span = getItemRenderTimelineSpan(clip)
  const sourceStart = Math.floor(span.sourceStart ?? 0)
  const predictedSourceFrames: number[] = []
  const renderPathSourceFrames: number[] = []
  let renderPathDisagreements = 0
  for (let frame = clip.from; frame < clip.from + clip.durationInFrames; frame++) {
    const predicted = sourceFrameAt(
      curve,
      frame - clip.from,
      sourceStart,
      sourceRate,
      toRate(projectFps),
    )
    const resolved =
      resolveVideoRenderSourceTimeSeconds(clip, span, frame, projectFps) *
      (sourceRate.num / sourceRate.den)
    const renderPath = Math.round(resolved)
    if (renderPath !== predicted) renderPathDisagreements++
    predictedSourceFrames.push(predicted)
    renderPathSourceFrames.push(renderPath)
  }
  return {
    keys: curve.keys.map((key) => ({ frame: key.frame, speed: key.speed })),
    averageSpeed: clip.speed ?? 0,
    from: clip.from,
    durationInFrames: clip.durationInFrames,
    sourceStart,
    sourceEnd: clip.sourceEnd ?? null,
    predictedSourceFrames,
    renderPathSourceFrames,
    renderPathDisagreements,
  }
}

function steadyRate(samples: Array<{ t: number; frame: number }>, total: number): number | null {
  const lo = samples.find((s) => s.frame >= total * 0.2)
  const hi = [...samples].reverse().find((s) => s.frame <= total * 0.9)
  if (!lo || !hi || hi.t <= lo.t || hi.frame <= lo.frame) return null
  return ((hi.frame - lo.frame) / (hi.t - lo.t)) * 1000
}

/** One export through the app's path. `settings` is what the export dialog hands to `startExport`. */
async function runExport(
  settings: ExtendedExportSettings,
  options: { timings?: boolean } = {},
): Promise<ExportRecord> {
  if (!session) throw new Error('call prepare() first')
  const { metadata, project, tracks, items } = session
  const fps = project.metadata.fps
  const width = project.metadata.width
  const height = project.metadata.height
  const media = { bitrate: metadata.bitrate, fps: metadata.fps, codec: metadata.codec }
  const withSource: ExtendedExportSettings = {
    ...settings,
    sourceVideo: metadata.bitrate > 0 ? media : undefined,
  }

  const started = performance.now()
  const requested = mapRequestedClientSettings(withSource, fps)
  const smartCopyContext = {
    settings: requested.clientSettings,
    tracks,
    items,
    transitions: [],
    keyframes: [],
    fps,
    width,
    height,
    inPoint: null,
    outPoint: null,
    source: metadata,
  }
  const smartCopy = assessSmartCopyEligibility(smartCopyContext)
  if (smartCopy.eligible) {
    throw new Error('smart copy would take this export; the benchmark needs the render path')
  }
  // What the untouched clip would get with smart copy switched on, when this run switched it off:
  // a 59.94 project of a 59.94 clip is eligible, and smart copy returns the original bytes
  // (design 1.5, decision 4).
  const smartCopyIfEnabled =
    settings.smartCopy === false
      ? assessSmartCopyEligibility({
          ...smartCopyContext,
          settings: { ...requested.clientSettings, smartCopy: true },
        })
      : null
  const { clientSettings, codecFallback } = await resolveClientSettings(withSource, fps)
  const composition = await buildComposition()
  const packetRemuxPlanned = getPacketRemuxPlan(clientSettings, composition) !== null

  const samples: Array<{ t: number; frame: number }> = []
  let firstFrameAt: number | null = null
  const onProgress = (p: RenderProgress) => {
    if (p.currentFrame === undefined || p.phase === 'preparing') return
    const now = performance.now()
    if (firstFrameAt === null && p.currentFrame > 0) firstFrameAt = now
    samples.push({ t: now, frame: p.currentFrame })
  }

  const controller = new AbortController()
  const timings = options.timings ? startTimings() : null
  const renderStart = performance.now()
  let outcome: Awaited<ReturnType<typeof runRender>>
  let timingMarks: TimingEntry[] | undefined
  try {
    outcome = await runRender({
      clientSettings,
      exportMode: 'video',
      composition,
      signal: controller.signal,
      onProgress,
    })
  } finally {
    timingMarks = timings?.stop()
  }
  const renderEnd = performance.now()
  session.lastResult = outcome.result
  const frames = composition.durationInFrames ?? 0
  const wallMs = renderEnd - renderStart

  return {
    requested: { ...requested.clientSettings },
    effective: { ...clientSettings, codecFallback: codecFallback ?? null },
    smartCopy: { eligible: smartCopy.eligible, reason: smartCopy.reason },
    smartCopyIfEnabled: smartCopyIfEnabled && {
      eligible: smartCopyIfEnabled.eligible,
      reason: smartCopyIfEnabled.reason,
    },
    packetRemuxPlanned,
    renderPath: outcome.renderPath,
    workerFallbackReason: outcome.fallbackReason ?? null,
    wallMs,
    prepMs: renderStart - started,
    firstFrameMs: firstFrameAt === null ? null : firstFrameAt - renderStart,
    frames,
    fps: frames / (wallMs / 1000),
    steadyFps: steadyRate(samples, frames),
    fileSize: outcome.result.fileSize,
    durationSeconds: outcome.result.duration,
    mimeType: outcome.result.mimeType,
    ...(timingMarks ? { timingMarks } : {}),
  }
}

function handToDriver(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click()
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
}

/** Hand the last export to the driver as a download (the same way the headless page does), then free it. */
async function download(fileName: string): Promise<number> {
  const result = session?.lastResult
  if (!result) throw new Error('no export to download')
  handToDriver(result.blob, fileName)
  setTimeout(() => void releaseTemporaryExportOutput(result), 120_000)
  return result.fileSize
}

/**
 * One frame straight from the render path as a PNG, with no video encoder after it: what the headless frame grab
 * produces. Used to tell the colour error of the picture from the colour error of the encoded file.
 */
async function renderStill(
  frame: number,
  fileName: string,
  options: { stabilized?: boolean } = {},
): Promise<number> {
  if (!session) throw new Error('call prepare() first')
  // `stabilized: false` draws the same frame with the clip's stabilization switched off, to look at the two together
  const items =
    options.stabilized === false
      ? session.items.map((item) =>
          item.type === 'video' && item.stabilization
            ? { ...item, stabilization: { ...item.stabilization, enabled: false } }
            : item,
        )
      : undefined
  const composition = await buildComposition(items)
  const blob = await renderSingleFrame({
    composition,
    frame,
    width: session.project.metadata.width,
    height: session.project.metadata.height,
    format: 'image/png',
    quality: 1,
  })
  session.lastStill = blob
  handToDriver(blob, fileName)
  return blob.size
}

/**
 * Preview playback, as far as a page without the editor's interface can play it: the preview-mode renderer
 * (`createCompositionRenderer` with `mode: 'preview'`, what the preview pump creates) asked for `frames` consecutive
 * frames from the start, one after the other, as fast as it answers. Each frame is a `frame.render` mark; decode,
 * upload and source stages mark themselves. What the screen does with the canvas afterwards (presenting it) is not
 * included, and neither is the pump's scheduling.
 */
async function runPreview(
  frames: number,
  options: { timings?: boolean; scale?: number } = {},
): Promise<{
  frames: number
  wallMs: number
  firstFrameMs: number
  steadyFps: number
  size: { width: number; height: number }
  timingMarks: TimingEntry[]
}> {
  if (!session) throw new Error('call prepare() first')
  const composition = await buildComposition()
  const scale = options.scale ?? 1
  const width = Math.round(session.project.metadata.width * scale)
  const height = Math.round(session.project.metadata.height * scale)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const renderer = await createCompositionRenderer(composition, canvas, ctx, { mode: 'preview' })
  const timings = options.timings ? startTimings() : null
  const times: number[] = []
  const started = performance.now()
  try {
    await renderer.preload()
    const first = performance.now()
    for (let frame = 0; frame < frames; frame++) {
      const t = performance.now()
      await timedStageAsync('frame.render', () => renderer.renderFrame(frame), frame)
      times.push(performance.now() - t)
    }
    const end = performance.now()
    const steady = times.slice(Math.floor(frames * 0.2))
    const timingMarks = timings?.stop() ?? []
    return {
      frames,
      wallMs: end - first,
      firstFrameMs: first - started + times[0]!,
      steadyFps: 1000 / (steady.reduce((a, b) => a + b, 0) / Math.max(1, steady.length)),
      size: { width, height },
      timingMarks,
    }
  } finally {
    if (timings) (globalThis as Record<string, unknown>)[STAGE_TIMINGS_FLAG] = false
    renderer.dispose()
  }
}

/** Counts the chunks the decoders are given between `startDecodeCount` and `stopDecodeCount`. */
let decodeCounter: ReturnType<typeof startDecodeCounter> | null = null
function startDecodeCount(): void {
  decodeCounter?.stop()
  decodeCounter = startDecodeCounter()
}
function stopDecodeCount() {
  if (!decodeCounter) throw new Error('no decode count is running')
  const count = decodeCounter.stop()
  decodeCounter = null
  return count
}

/**
 * The video clip of the session, and a builder of the same clip showing one source frame per output frame, bare: a
 * 90 degree shutter at an integer speed is one sample of weight 1, which the pipeline passes through its source stages
 * without the gather (design 7.2 section 4.1), and the clip still takes the staged float path that a plain clip does
 * not (a plain clip's float frame is not delivered to the sink). With `sourceStart + offset`, output frame n shows
 * source frame `sourceStart + offset + speed * n`.
 */
function blurProofItems(): {
  clip: VideoItem
  speed: number
  referenceAt: (offset: number) => VideoItem
} {
  const clip = session?.items.find((item) => item.type === 'video') as VideoItem | undefined
  if (!clip || !session) throw new Error('call prepare() first')
  if (!clip.motionBlur) throw new Error('the clip has no motion blur: prepare() with `motionBlur`')
  const speed = clip.speed ?? 1
  if (!Number.isInteger(speed) || speed < 2) {
    throw new Error(`the proof needs an integer speed of 2 or more, the clip has ${speed}`)
  }
  const sourceStart = clip.sourceStart ?? 0
  return {
    clip,
    speed,
    referenceAt: (offset) => ({
      ...clip,
      motionBlur: { shutterDegrees: 90 },
      sourceStart: sourceStart + offset,
    }),
  }
}

/**
 * The hidden `motionBlur` switch is turned on by an override that lives in this page; the export worker is another
 * realm and would render the clip without the blur, in silence (an export of 4x with the blur on ran as fast as one
 * with it off). While the switch is hidden, a blurred clip is exported on the page: the export worker's constructor
 * refuses, and `runRender` falls back to the main thread exactly as it does for a composition the worker cannot take.
 */
function keepExportOnThisPage(): void {
  const original = globalThis.Worker
  if ((original as { keepsExportOnPage?: boolean }).keepsExportOnPage) return
  class PageOnlyExport extends original {
    static keepsExportOnPage = true
    constructor(url: string | URL, options?: WorkerOptions) {
      if (String(url).includes('export-render.worker')) {
        throw new Error('WORKER_UNAVAILABLE: the hidden motion-blur switch is not visible to the export worker')
      }
      super(url, options)
    }
  }
  globalThis.Worker = PageOnlyExport
}

interface BlurProofFrame {
  outputFrame: number
  samples: Array<{ sourceFrame: number; weight: number }>
  maxDiffLevels: number
  meanDiffLevels: number
  p9999DiffLevels: number
  over1Level: number
  overHalfLevel: number
  channels: number
  maxAt: ReturnType<typeof compareToLinearMean>['maxAt']
  histogram: number[]
  weightSum: number
  outOfRange: number
}

/**
 * Design 7.2 slice E: each of `outputFrames` is rendered with the blur on through the export renderer, and its float
 * accumulator is read through the test sink. The reference is the same renderer's own frames of the source (the clip with a
 * 90 degree shutter, one bare source frame per output frame, read the same way) averaged in linear light on the CPU with the plan's weights. Both sides come from the
 * one decoder and the one source path, so the comparison isolates the gather; it says nothing about how the source
 * path's colour differs from FFmpeg's.
 */
async function proveBlur(outputFrames: number[]): Promise<BlurProofFrame[]> {
  if (!session) throw new Error('call prepare() first')
  const { clip, speed, referenceAt } = blurProofItems()
  const width = session.project.metadata.width
  const height = session.project.metadata.height
  const fps = session.project.metadata.fps
  const blurred = await buildComposition()
  const sink = createTestSink()
  const delivered = sink.frames as FloatFrame[]
  const take = (): FloatFrame => {
    const frame = delivered.pop()
    delivered.length = 0
    if (!frame) throw new Error('the render delivered no float frame to the sink')
    return frame
  }
  const open = async (composition: Awaited<ReturnType<typeof buildComposition>>) => {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    const renderer = await createCompositionRenderer(composition, canvas, ctx, { mode: 'export' })
    await renderer.preload()
    return renderer
  }
  const results: BlurProofFrame[] = []
  setPreciseOutputSink(sink)
  const blurRenderer = await open(blurred)
  const referenceRenderers = new Map<number, Awaited<ReturnType<typeof open>>>()
  const referenceRenderer = async (offset: number) => {
    let renderer = referenceRenderers.get(offset)
    if (!renderer) {
      renderer = await open(await buildComposition([referenceAt(offset)]))
      referenceRenderers.set(offset, renderer)
    }
    return renderer
  }
  try {
    for (const n of outputFrames) {
      const plan = planMotionBlur({
        clip,
        timelineFrame: n,
        projectRate: toRate(fps),
        shutterDegrees: clip.motionBlur!.shutterDegrees,
      })
      await blurRenderer.renderFrame(n)
      const blurredFrame = take()
      const mean = new LinearMean(width * height)
      for (const sample of plan.samples) {
        const offset = sample.sourceFrame - (clip.sourceStart ?? 0) - speed * n
        if (offset < 0 || offset >= speed)
          throw new Error(`source frame ${sample.sourceFrame} is outside output frame ${n}'s span`)
        const reference = await referenceRenderer(offset)
        await reference.renderFrame(n)
        mean.add(take().rgba16, sample.weight)
        // A reference renderer holds a frame cache, a decoder and its own pictures at the project's size: only one
        // is alive besides the blurred one, which keeps the run inside the memory a heavy run may use (four runs were
        // stopped at 3-12 % free memory with four alive)
        reference.dispose()
        referenceRenderers.delete(offset)
      }
      const comparison = compareToLinearMean(blurredFrame.rgba16, mean, width)
      results.push({
        outputFrame: n,
        samples: plan.samples.map((s) => ({ sourceFrame: s.sourceFrame, weight: s.weight })),
        maxDiffLevels: comparison.maxDiffLevels,
        meanDiffLevels: comparison.meanDiffLevels,
        p9999DiffLevels: comparison.p9999DiffLevels,
        over1Level: comparison.over1Level,
        overHalfLevel: comparison.overHalfLevel,
        channels: comparison.channels,
        maxAt: comparison.maxAt,
        histogram: comparison.histogram,
        weightSum: comparison.weightSum,
        outOfRange: blurredFrame.outOfRange,
      })
    }
  } finally {
    setPreciseOutputSink(null)
    blurRenderer.dispose()
    for (const renderer of referenceRenderers.values()) renderer.dispose()
  }
  return results
}

/** The hidden motion-blur switch, for the measurements that compare a frame with it on and off. */
function setBlurSwitch(on: boolean): void {
  setFeatureOverride('motionBlur', on)
}

/**
 * Preview-mode frame times for design 7.2 slice D, at `scale` of the project's size: `playFrames` consecutive frames
 * from `startFrame` back to back after `warmFrames` (what a pump asks for while playing, without presenting), then
 * for each of `pausedFrames` a jump to it (a paused frame after a seek: the first draw) and three more draws of the
 * same frame (a paused frame redrawn).
 */
async function runPreviewProbe(options: {
  scale: number
  playFrames: number
  warmFrames: number
  startFrame: number
  pausedFrames: number[]
}) {
  if (!session) throw new Error('call prepare() first')
  const composition = await buildComposition()
  const width = Math.round(session.project.metadata.width * options.scale)
  const height = Math.round(session.project.metadata.height * options.scale)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const renderer = await createCompositionRenderer(composition, canvas, ctx, { mode: 'preview' })
  try {
    await renderer.preload()
    const timed = async (frame: number) => {
      const t = performance.now()
      await renderer.renderFrame(frame)
      return performance.now() - t
    }
    const firstFrameMs = await timed(options.startFrame)
    for (let i = 1; i < options.warmFrames; i++) await timed(options.startFrame + i)
    const playing: number[] = []
    for (let i = 0; i < options.playFrames; i++) {
      playing.push(await timed(options.startFrame + options.warmFrames + i))
    }
    const paused: Array<{ frame: number; seekMs: number; redrawMs: number[] }> = []
    for (const frame of options.pausedFrames) {
      const seekMs = await timed(frame)
      const redrawMs = [await timed(frame), await timed(frame), await timed(frame)]
      paused.push({ frame, seekMs, redrawMs })
    }
    return {
      size: { width, height },
      firstFrameMs,
      playing: summariseFrameTimes(playing),
      paused,
    }
  } finally {
    renderer.dispose()
  }
}

/**
 * The preview picture of each frame with the motion-blur switch off and then on (a fresh renderer for each, so no
 * frame cache answers for the other), at `scale`; how the two canvases differ, byte for byte.
 */
async function compareBlurSwitch(options: { scale: number; frames: number[] }) {
  if (!session) throw new Error('call prepare() first')
  const width = Math.round(session.project.metadata.width * options.scale)
  const height = Math.round(session.project.metadata.height * options.scale)
  const draw = async (frame: number, on: boolean) => {
    setFeatureOverride('motionBlur', on)
    const composition = await buildComposition()
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d context')
    const renderer = await createCompositionRenderer(composition, canvas, ctx, { mode: 'preview' })
    try {
      await renderer.preload()
      await renderer.renderFrame(frame)
      return ctx.getImageData(0, 0, width, height).data
    } finally {
      renderer.dispose()
    }
  }
  const out: Array<{ frame: number } & ReturnType<typeof comparePictures>> = []
  try {
    for (const frame of options.frames) {
      const off = await draw(frame, false)
      const on = await draw(frame, true)
      out.push({ frame, ...comparePictures(off, on) })
    }
  } finally {
    setFeatureOverride(
      'motionBlur',
      session.items.some((i) => i.type === 'video' && i.motionBlur) ? true : undefined,
    )
  }
  return out
}

/** One call of the stabilization host's `open`, as the page saw it (a stabilized run) */
interface OpenCall {
  /** Milliseconds from the page's origin to the call */
  atMs: number
  /** How long the call took to settle */
  ms: number
  kind: string
  /** What the engine read through the file during the open; 0 when the motion cache answered */
  bytesRead: number | null
  frames: number | null
}
let openCalls: OpenCall[] = []

/**
 * The stabilization host of a stabilized run. The app's host finds the engine's file through the media library's
 * workspace; the benchmark's media is not in a workspace, so the host is built with the file the page imported (same
 * `createStabilizationSeat` the app uses, same client, same motion cache in the page's OPFS) and its `open` is
 * recorded: `bytes_read` of each open is the proof of a motion-cache hit (0), and the time is the open's.
 */
function installBenchSeat(): void {
  const file = importedFile
  if (!file) throw new Error('import the media before the stabilization host is installed')
  const seat = createStabilizationSeat({ loadFile: async () => file })
  const open = seat.open.bind(seat)
  seat.open = async (item, options) => {
    const atMs = performance.now()
    const result = await open(item, options)
    const info = result.kind === 'ready' || result.kind === 'no-lens-profile' ? result.info : null
    if (openCalls.length < 100) {
      openCalls.push({
        atMs,
        ms: performance.now() - atMs,
        kind: result.kind,
        bytesRead: info ? info.bytes_read : null,
        frames: info ? info.frames : null,
      })
    }
    return result
  }
  installStabilizationSeat(seat)
}

/** The opens the host has seen since the last call */
function takeOpens(): OpenCall[] {
  const taken = openCalls
  openCalls = []
  return taken
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** What Gyroflow's reference recorded for a frame (`gyroflow/wasm/test/reference/clip-0020.json`) */
interface ReferenceFrame {
  frame: number
  matrices_sha256: string
  kernel_params_bytes: number
  kernel_params_sha256: string
}

/**
 * The page path's stabilization data for the reference's frames: the clip's engine (opened through the host, as the
 * renderer opens it) answers each source frame, and the hashes of the matrices and of the kernel parameters are
 * compared with the reference's. The clip's own settings are the engine's defaults, which the reference was recorded with.
 */
async function proveKernelParameters(reference: ReferenceFrame[]) {
  if (!session) throw new Error('call prepare() first')
  const clip = session.items.find((item) => item.type === 'video') as VideoItem | undefined
  const key = clip ? stabilizationEngineKey(clip) : null
  if (!clip || !key) throw new Error('the bench clip has no stabilization')
  const seat = stabilizationSeat()
  const opened = await seat.open(clip, { retry: true, fps: session.project.metadata.fps })
  if (opened.kind !== 'ready') throw new Error(`the engine did not open: ${opened.kind}`)
  const frames = []
  for (const expected of reference) {
    await seat.requestFrame(key, expected.frame)
    const data = seat.frame(key, expected.frame)
    if (!data) {
      const failure = seat.takeFrameFailure(key, expected.frame)
      throw new Error(`no data for source frame ${expected.frame}: ${failure?.message ?? 'unknown'}`)
    }
    const matrices = await sha256Hex(
      new Uint8Array(data.matrices.buffer, data.matrices.byteOffset, data.matrices.byteLength),
    )
    const params = await sha256Hex(data.params)
    frames.push({
      frame: expected.frame,
      matricesSha256: matrices,
      matricesMatch: matrices === expected.matrices_sha256,
      kernelParamsBytes: data.params.byteLength,
      kernelParamsBytesMatch: data.params.byteLength === expected.kernel_params_bytes,
      kernelParamsSha256: params,
      kernelParamsMatch: params === expected.kernel_params_sha256,
    })
  }
  return { info: opened.info, frames }
}

/** Whether a canvas holds a picture: the mean of an 8x8 copy of it is not black (a preview that could not draw leaves it empty) */
function canvasHoldsPicture(canvas: OffscreenCanvas): boolean {
  const small = new OffscreenCanvas(8, 8)
  const ctx = small.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(canvas, 0, 0, 8, 8)
  const data = ctx.getImageData(0, 0, 8, 8).data
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!
  return sum / (64 * 3) > 4
}

/**
 * Preview playback of a stabilized clip, counted honestly. The preview renderer leaves a clip whose stabilization is not
 * ready undrawn and answers at once (`stagesFromProvider`, the held frame), so a loop that only times `renderFrame`
 * measures nothing while the engine opens. Here the engine is opened first (`openMs`, which is the file read on a cold
 * motion cache), the first frame is drawn until the canvas holds the picture (`firstFrameMs`: the renderer's creation,
 * preload and the stage's pipeline, the engine already open), and then `frames` consecutive frames are timed; a frame
 * whose stabilization data the host does not yet hold waits for it inside its own time (`late` counts them), as the
 * pump's held frame does, so the rate includes the waiting.
 */
async function runStabilizedPreview(frames: number, options: { scale?: number } = {}) {
  if (!session) throw new Error('call prepare() first')
  const clip = session.items.find((item) => item.type === 'video') as VideoItem | undefined
  const key = clip ? stabilizationEngineKey(clip) : null
  if (!clip || !key) throw new Error('the bench clip has no stabilization')
  const seat = stabilizationSeat()
  const scale = options.scale ?? 1
  const width = Math.round(session.project.metadata.width * scale)
  const height = Math.round(session.project.metadata.height * scale)
  const sourceStart = clip.sourceStart ?? 0

  const openStarted = performance.now()
  const opened = await seat.open(clip, { retry: true, fps: session.project.metadata.fps })
  const openMs = performance.now() - openStarted
  if (opened.kind !== 'ready') throw new Error(`the engine did not open: ${opened.kind}`)

  const composition = await buildComposition()
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const renderer = await createCompositionRenderer(composition, canvas, ctx, { mode: 'preview' })
  try {
    const firstStarted = performance.now()
    await renderer.preload()
    let attempts = 0
    for (;;) {
      await seat.requestFrame(key, sourceStart)
      await renderer.renderFrame(0)
      attempts++
      if (canvasHoldsPicture(canvas)) break
      if (performance.now() - firstStarted > 60_000) throw new Error('the first frame was never drawn')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const firstFrameMs = performance.now() - firstStarted

    const times: number[] = []
    let late = 0
    const started = performance.now()
    for (let frame = 1; frame <= frames; frame++) {
      const t = performance.now()
      if (!seat.frame(key, sourceStart + frame)) {
        late++
        await seat.requestFrame(key, sourceStart + frame)
      }
      await renderer.renderFrame(frame)
      times.push(performance.now() - t)
    }
    const wallMs = performance.now() - started
    const steady = times.slice(Math.floor(frames * 0.2))
    return {
      size: { width, height },
      openMs,
      firstFrameMs,
      firstFrameAttempts: attempts,
      frames,
      late,
      wholeRunFps: frames / (wallMs / 1000),
      steadyFps: 1000 / (steady.reduce((a, b) => a + b, 0) / Math.max(1, steady.length)),
      worstFrameMs: Math.max(...times),
      drawnAtEnd: canvasHoldsPicture(canvas),
    }
  } finally {
    renderer.dispose()
  }
}

/** Removes the copies of media this page put in its storage (the motion cache's own folder stays), so a reload does not keep two */
async function clearBenchFiles(): Promise<number> {
  const root = await navigator.storage.getDirectory()
  const names: string[] = []
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (name.startsWith('bench-')) names.push(name)
  }
  for (const name of names) await root.removeEntry(name)
  return names.length
}

/**
 * The controls proof's page side: the clip panel's stabilization section mounted over the session's clip, which is
 * drawn from whatever the section stores (`bench/page/controls.ts`).
 */
async function mountControls(): Promise<void> {
  if (!session) throw new Error('call prepare() first')
  const clip = session.items.find((item) => item.type === 'video') as VideoItem | undefined
  if (!clip) throw new Error('the session has no video clip')
  installBenchSeat()
  // The app's wiring, which a bare page lacks: the host follows the timeline's items (an undo moves its engine), and a
  // preview renderer keeps the page's preparer following them too (it releases the keys no clip wants, so a setting
  // that is changed and changed back is prepared again). The preview stays alive until the page closes.
  const seat = stabilizationSeat()
  await watchTimelineItems((items) => seat.sync(items))
  const previewCanvas = new OffscreenCanvas(64, 48)
  const previewCtx = previewCanvas.getContext('2d')
  if (!previewCtx) throw new Error('no 2d context')
  await createCompositionRenderer(await buildComposition(), previewCanvas, previewCtx, {
    mode: 'preview',
  })
  const { mountStabilizationControls } = await import('./controls')
  const { stabilization: _off, ...plain } = clip
  mountStabilizationControls(plain as VideoItem, session.project.metadata.fps, (next) => {
    if (!session) return
    session.items = session.items.map((item) => (item.id === next.id ? next : item))
  })
}

/** SHA-256 of the PNG of an output frame as the render path draws the clip now (what the controls have stored) */
async function stillHash(frame: number): Promise<string> {
  if (!session) throw new Error('call prepare() first')
  const clip = session.items.find((item) => item.type === 'video') as VideoItem | undefined
  if (clip?.stabilization?.enabled) {
    // Let the engine finish moving to the stored settings before the frame is drawn
    await stabilizationSeat().open(clip, { retry: true, fps: session.project.metadata.fps })
  }
  const composition = await buildComposition()
  const blob = await renderSingleFrame({
    composition,
    frame,
    width: session.project.metadata.width,
    height: session.project.metadata.height,
    format: 'image/png',
    quality: 1,
  })
  return sha256Hex(new Uint8Array(await blob.arrayBuffer()))
}

async function controlsState() {
  const { storedClip, undoDepth } = await import('./controls')
  const clip = session?.items.find((item) => item.type === 'video') as VideoItem | undefined
  return { stabilization: clip ? (storedClip(clip.id)?.stabilization ?? null) : null, undoDepth: undoDepth() }
}

async function undoControl(): Promise<void> {
  const { undoLast } = await import('./controls')
  undoLast()
}

async function gpuInfo() {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
  if (!gpu) return { available: false as const }
  const adapter = await gpu.requestAdapter()
  if (!adapter) return { available: false as const }
  const info = adapter.info
  const raw = adapter as GPUAdapter & { isFallbackAdapter?: boolean }
  return {
    available: true as const,
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
    isFallbackAdapter: raw.isFallbackAdapter ?? false,
  }
}

const api = {
  ready: true as const,
  prepare,
  runExport,
  runPreview,
  runPreviewProbe,
  compareBlurSwitch,
  setBlurSwitch,
  proveBlur,
  startDecodeCount,
  stopDecodeCount,
  download,
  renderStill,
  takeOpens,
  proveKernelParameters,
  clearBenchFiles,
  runStabilizedPreview,
  mountControls,
  stillHash,
  controlsState,
  undoControl,
  gpuInfo,
}
export type BenchPageApi = typeof api
;(window as unknown as { bench: BenchPageApi }).bench = api
