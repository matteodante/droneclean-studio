/**
 * `studio.export`: the SDK's export settings and the render queue (design §0.3,
 * §0.5, §4.7).
 *
 * `start` maps to `buildRenderJob` (which may await the browser's codec probe)
 * and then `enqueueJobs`; the queued job is drained by the
 * `RenderQueueRunner` (mounted at the app root, `src/routes/__root.tsx`), so it
 * renders whichever route is open, as long as a project is open.
 * `status` and `wait` read the job's progress from the queue store —
 * polling, not callbacks — and the frozen timeline snapshot stays in the store:
 * every value returned here is a plain JSON copy.
 *
 * Nothing in this namespace is an undo step: the queue is not part of the
 * timeline snapshot, and the settings are editor state like the selection.
 */

import type { ExtendedExportSettings } from '@/types/export'
import type {
  ExportApi,
  ExportCodec,
  ExportJobInfo,
  ExportPresetInfo,
  ExportSettingsPatch,
  ExportStartInput,
  ExportWaitOptions,
  Frame,
} from '../types'
import type { RenderJob } from '@/features/export/stores/render-queue-store'
import {
  formatValidValues,
  formatValue,
  invalidArgumentError,
  studioError,
  StudioError,
} from '../errors'
import { requireFrame } from '../context'
import {
  findActivePilotPresetId,
  getPilotPresets,
  resolvePilotPreset,
  WEB_PRESET_CAPABILITIES,
  type PresetContext,
} from '@/studio/export/presets'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { readExportSettings, resolveExportSettings, writeExportSettings } from './export-settings'
import { buildRenderJob } from '@/features/export/utils/build-render-job'
import { useRenderQueueStore } from '@/features/export/stores/render-queue-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'

/** How often `wait` reads the queue (design §4.7). */
const POLL_INTERVAL_MS = 250

/** Resolve after `milliseconds`; `wait` polls the queue with it. */
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

/** The object without the entries whose value is `undefined` — JSON's own rule. */
function withoutUndefined<T extends object>(value: T): T {
  const defined = Object.entries(value).filter(([, entry]) => entry !== undefined)
  return Object.fromEntries(defined) as T
}

/** The error an unknown job id raises, with the ids the queue does hold. */
function requireJob(id: string, method: string): RenderJob {
  const job = useRenderQueueStore.getState().jobs.find((candidate) => candidate.id === id)
  if (job) return job
  const valid = useRenderQueueStore.getState().jobs.map((candidate) => candidate.id)
  throw studioError({
    code: 'NOT_FOUND',
    method,
    argument: 'id',
    valid,
    message: `"id" must be an existing export job id (got ${formatValue(id)})${
      valid.length > 0 ? `; valid: ${formatValidValues(valid)}` : '; the queue is empty'
    }`,
    hint: 'studio.export.jobs() lists the queue.',
  })
}

/** The job as the SDK returns it: plain JSON, without the frozen snapshot. */
function toJobInfo(job: RenderJob): ExportJobInfo {
  return withoutUndefined<ExportJobInfo>({
    id: job.id,
    name: job.name,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    progressMessage: job.progressMessage,
    renderedFrames: job.renderedFrames,
    totalFrames: job.totalFrames,
    inPoint: job.inPoint,
    outPoint: job.outPoint,
    durationFrames: job.durationFrames,
    exportMode: job.exportMode,
    fileName: job.fileName,
    savedPath: job.savedPath,
    fileSize: job.fileSize,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  })
}

/** The `EXPORT_FAILED` a job that ended without a file raises. */
function exportFailed(job: RenderJob): StudioError {
  const reason =
    job.status === 'cancelled' ? 'was cancelled' : `failed: ${job.error ?? 'no error was reported'}`
  return studioError({
    code: 'EXPORT_FAILED',
    method: 'export.wait',
    message: `job ${JSON.stringify(job.id)} ${reason}`,
    hint: 'studio.export.status() reports the job; studio.export.start() queues another.',
  })
}

/** Throw `INVALID_ARGUMENT` unless `options` is an object; `undefined` is allowed. */
function requireOptions(options: unknown, argument: string, method: string): void {
  if (options === undefined) return
  if (typeof options === 'object' && options !== null && !Array.isArray(options)) return
  throw invalidArgumentError({
    method,
    argument,
    expectation: 'an object of options',
    value: options,
  })
}

/** The display name of a job, or `undefined` when the caller gave none. */
function requireName(name: unknown): string | undefined {
  if (name === undefined) return undefined
  if (typeof name === 'string' && name.trim() !== '') return name
  throw invalidArgumentError({
    method: 'export.start',
    argument: 'name',
    expectation: 'a non-empty string',
    value: name,
  })
}

/** One endpoint of the render range: the explicit point, else the editor's. */
function startPoint(
  explicit: Frame | null | undefined,
  stored: Frame | null,
  argument: string,
): Frame | null {
  if (explicit === undefined) return stored
  if (explicit === null) return null
  return requireFrame(explicit, argument, 'export.start')
}

/** The range of a whole-project render: no in point, no out point. */
function wholeProjectRange(): { inPoint: null; outPoint: null } {
  return { inPoint: null, outPoint: null }
}

/**
 * The range `start` renders. Explicit points win; otherwise the editor's in/out
 * range (`markers.range()`) is used, unless `renderWholeProject` ignores it.
 * A half range or a range that ends before it starts renders the whole project,
 * as the dialog's `getQueueRange` does (`export-range.ts:81`).
 * @throws INVALID_ARGUMENT when an explicit point is not a frame or the range is backwards
 */
function resolveStartRange(
  input: ExportStartInput,
  renderWholeProject: boolean,
): { inPoint: Frame | null; outPoint: Frame | null } {
  const explicit = input.inPoint !== undefined || input.outPoint !== undefined
  if (!explicit && renderWholeProject) return wholeProjectRange()

  const markers = useMarkersStore.getState()
  const inPoint = startPoint(input.inPoint, markers.inPoint, 'inPoint')
  const outPoint = startPoint(input.outPoint, markers.outPoint, 'outPoint')
  if (inPoint === null || outPoint === null) return wholeProjectRange()
  if (outPoint > inPoint) return { inPoint, outPoint }
  if (!explicit) return wholeProjectRange()
  throw invalidArgumentError({
    method: 'export.start',
    argument: 'outPoint',
    expectation: `an integer frame greater than "inPoint" (${inPoint})`,
    value: outPoint,
  })
}

/** The message of an unknown thrown value, for the `INTERNAL` wrapper. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The dialog's English names of the presets `export.presets` can offer. */
const PRESET_LABELS: Record<string, string> = {
  'same-as-source': 'Same as source',
  'youtube-4k': 'YouTube 4K',
  'instagram-reel': 'Instagram Reel',
  'small-file': 'Small file (sharing)',
}

/** The source the dialog's "Same as source" reads: the first placed video clip's file, when there is one. */
function presetSource(): { width: number; height: number; fps: number; bitrate: number } | undefined {
  const video = useItemsStore.getState().items.find((item) => item.type === 'video')
  if (!video || video.type !== 'video') return undefined
  const { sourceWidth, sourceHeight, sourceFps } = video as { sourceWidth?: number; sourceHeight?: number; sourceFps?: number }
  if (!sourceWidth || !sourceHeight || !sourceFps) return undefined
  return { width: sourceWidth, height: sourceHeight, fps: sourceFps, bitrate: 0 }
}

/** The context the dialog resolves its presets in, for the open project (`undefined` with none open). */
function presetContext(): PresetContext | undefined {
  const project = useProjectStore.getState().currentProject
  if (!project) return undefined
  const { width, height, fps } = project.metadata
  return { project: { width, height, fps }, source: presetSource(), capabilities: WEB_PRESET_CAPABILITIES }
}

/**
 * The audio bitrate (`'128k'`) of the preset these settings still stand for exactly, as the dialog applies it
 * with the preset (Meta's Reel asks for 128 kbps AAC). `setSettings` refuses `audioBitrate`, so a job gets it
 * only this way. Undefined when no preset states one.
 */
function presetAudioBitrate(settings: ExtendedExportSettings, container: string): string | undefined {
  const context = presetContext()
  if (!context) return undefined
  const id = findActivePilotPresetId(container, settings, context)
  return id === null ? undefined : resolvePilotPreset(id, context)?.settings.audioBitrate
}

/** `studio.export.presets`: the dialog's presets, resolved for the open project. */
function presets(): ExportPresetInfo[] {
  const project = useProjectStore.getState().currentProject
  if (!project) {
    throw studioError({
      code: 'UNSUPPORTED',
      method: 'export.presets',
      message: 'no project is open, so there is no frame to resolve the presets for',
      hint: 'Open a project with studio.project.open(id) first.',
    })
  }
  const { width, height, fps } = project.metadata
  const context = { project: { width, height, fps }, source: presetSource(), capabilities: WEB_PRESET_CAPABILITIES }
  return getPilotPresets(context).flatMap(({ id }) => {
    const resolved = resolvePilotPreset(id, context)
    if (!resolved || resolved.settings.codec === 'prores') return []
    const codec = resolved.settings.codec as ExportCodec
    return [
      {
        id,
        label: PRESET_LABELS[id] ?? id,
        settings: {
          codec,
          quality: resolved.settings.quality,
          resolution: { ...resolved.settings.resolution },
          rateControl: resolved.settings.rateControl,
          videoBitrate: resolved.settings.videoBitrate,
          smartCopy: resolved.settings.smartCopy,
          videoContainer: resolved.container,
        },
        ...(resolved.settings.audioBitrate !== undefined && { audioBitrate: resolved.settings.audioBitrate }),
        numbers: { ...resolved.numbers, codec },
      },
    ]
  })
}

/** Queue an export and return its job; the editor's runner renders it. */
async function start(options: ExportStartInput = {}): Promise<ExportJobInfo> {
  requireOptions(options, 'options', 'export.start')
  if (!useProjectStore.getState().currentProject) {
    throw studioError({
      code: 'UNSUPPORTED',
      method: 'export.start',
      message: 'no project is open, so there is no editor to render the job',
      hint: 'The render queue runs in the open editor (editor.tsx:848); open a project first.',
    })
  }
  // Validation runs before the await so a bad call queues nothing.
  const settings = resolveExportSettings(options.settings, 'export.start', 'settings')
  const name = requireName(options.name)
  const range = resolveStartRange(options, settings.renderWholeProject === true)
  // `ExportSettingsInfo` is exactly the plain-JSON half of `ExtendedExportSettings`;
  // this annotation makes a drift between the two fail the type check.
  const baseSettings: ExtendedExportSettings = settings
  const audioBitrate = presetAudioBitrate(baseSettings, baseSettings.videoContainer ?? 'mp4')
  const exportSettings: ExtendedExportSettings =
    audioBitrate === undefined ? baseSettings : { ...baseSettings, audioBitrate }

  let job: RenderJob
  try {
    job = await buildRenderJob({
      settings: exportSettings,
      inPoint: range.inPoint,
      outPoint: range.outPoint,
      ...(name !== undefined && { name, fileStem: name }),
    })
  } catch (error) {
    if (error instanceof StudioError) throw error
    throw studioError({
      code: 'INTERNAL',
      method: 'export.start',
      message: `the job could not be built: ${messageOf(error)}`,
    })
  }
  useRenderQueueStore.getState().enqueueJobs([job])
  return toJobInfo(job)
}

/** The timeout of `wait` in milliseconds, or `undefined` to wait indefinitely. */
function requireTimeout(options: ExportWaitOptions): number | undefined {
  const timeoutMs = options.timeoutMs
  if (timeoutMs === undefined) return undefined
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs >= 0) {
    return timeoutMs
  }
  throw invalidArgumentError({
    method: 'export.wait',
    argument: 'timeoutMs',
    expectation: 'a non-negative number of milliseconds',
    value: timeoutMs,
  })
}

/** Whether `wait` has used up its timeout. */
function timedOut(startedAt: number, timeoutMs: number | undefined): boolean {
  return timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs
}

/** Wait for a job to finish, polling the queue every 250 ms. */
async function wait(id: string, options: ExportWaitOptions = {}): Promise<ExportJobInfo> {
  requireOptions(options, 'options', 'export.wait')
  const timeoutMs = requireTimeout(options)
  const startedAt = Date.now()
  for (;;) {
    const job = requireJob(id, 'export.wait')
    if (job.status === 'failed' || job.status === 'cancelled') throw exportFailed(job)
    if (job.status === 'completed') return toJobInfo(job)
    if (timedOut(startedAt, timeoutMs)) return toJobInfo(job)
    await sleep(POLL_INTERVAL_MS)
  }
}

/** Queue operations and the SDK's export settings. */
export function createExportApi(): ExportApi {
  return {
    settings: () => readExportSettings(),
    setSettings: (patch: ExportSettingsPatch) => {
      writeExportSettings(patch, 'export.setSettings')
    },
    presets,
    start,
    jobs: () => useRenderQueueStore.getState().jobs.map(toJobInfo),
    status: (id: string) => {
      const job = useRenderQueueStore.getState().jobs.find((candidate) => candidate.id === id)
      return job ? toJobInfo(job) : null
    },
    wait,
    cancel: (id: string) => {
      requireJob(id, 'export.cancel')
      useRenderQueueStore.getState().cancelJob(id)
    },
  }
}
