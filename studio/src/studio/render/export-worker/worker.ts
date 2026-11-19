// The worker's half of the export worker (design 3.6 section 2.15, task 8.3). FreeCut's export worker
// (`runtime/renderer/workers/export-render.worker.ts`) calls `beginWorkerExport` with what the page prepared, before
// it renders, and `end` on every way out:
//
//   rate      the export's project rate goes into this realm's timeline settings and the stage predicates: the worker
//             has no timeline, and the predicates (a blurred clip's span: whether it is staged, how many source frames
//             it blends) would otherwise read the settings' default of 30 fps, which the session module reads on load;
//   sizes     the page's derived sizes go into this realm's store, so the layout has a staged clip's size from the
//             first frame on; the stages' own `prepare` (run by the renderer before frame 0) confirms them;
//   media     the page's media records go into this realm's media library, which is otherwise empty here;
//   files     the files behind the composition's `blob:` URLs go into this realm's object-URL registry, where
//             FreeCut's decoders look for them (a `blob:` URL it does not hold is refused in a worker);
//   engines   the page's stabilization host, through its port, becomes this realm's host: the export reads the engines
//             the page opened (S7);
//   timings   the page's stage-timings flag, and the marks recorded here to send back;
//   native    for a native 10-bit export, the page's decode IPC through its port, and the export's own render loop
//             (`native-render.ts`) instead of FreeCut's WebCodecs one.
//
// The worker renders a snapshot and ends with the export: the page terminates it after its last answer, and its GPU
// device, the stage pipeline's textures and arena (already destroyed by the renderer's `dispose`) and the media
// library's copy go with it.

import { registerObjectUrl } from '@/infrastructure/browser/object-url-registry'
import { MARK_PREFIX, STAGE_TIMINGS_FLAG } from '@/studio/render/timings'
import type { MediaMetadata } from '@/types/storage'
import { createRelayedStabilizationHost } from './engine-relay'
import type { ClientRenderResult } from '@/runtime/renderer/client-renderer'
import { createRelayedNativeMedia } from './native-relay'
import type { NativeExportPlan } from './native-export'
import type { NativeRenderOptions } from './native-render'
import type { WorkerExportStart, WorkerTimingMark, WorkerTimings } from './protocol'

/** What the worker holds for one export */
export interface WorkerExportScope {
  /**
   * Whether a video clip of this media may carry sound. Only a record that names no audio codec says no; a media the
   * page sent no record for may (FreeCut's refusal of sound in a worker then stands).
   */
  mediaMayCarryAudio(mediaId: string | undefined): boolean
  /** The stage marks recorded here, when the page asked for them */
  timings(): WorkerTimings | undefined
  /**
   * The render of a native 10-bit export, or `null` for any other export (FreeCut's own render runs then). Its frames
   * come from the files on disk through the page's decode IPC, and leave for the encoder the page started.
   */
  readonly renderNative:
    | ((options: Omit<NativeRenderOptions, 'plan' | 'bridge'>) => Promise<ClientRenderResult>)
    | null
  /** Lets go of the page's host and switches the timings off */
  end(): void
}

async function seedMediaLibrary(records: readonly MediaMetadata[]): Promise<void> {
  if (records.length === 0) return
  const { useMediaLibraryStore } = await import(
    '@/features/media-library/stores/media-library-store'
  )
  const mediaById = { ...useMediaLibraryStore.getState().mediaById }
  for (const record of records) mediaById[record.id] = record
  useMediaLibraryStore.setState({ mediaItems: Object.values(mediaById), mediaById })
}

/** The export's rate, where the stage predicates and the session module read the project's: before either is asked */
async function seedProjectRate(fps: number): Promise<void> {
  const [{ useTimelineSettingsStore }, { setProjectRate }] = await Promise.all([
    import('@/features/timeline/stores/timeline-settings-store'),
    import('@/studio/render/stages/predicates'),
  ])
  useTimelineSettingsStore.setState({ fps })
  setProjectRate(fps)
}

/** The project's frame, which every stabilized clip's key carries: the page's, so the keys are the page's */
async function seedProjectFrame(frame: WorkerExportStart['projectFrame']): Promise<void> {
  const { setStabilizationProjectFrame } = await import('@/studio/stabilization/engine-key')
  setStabilizationProjectFrame(frame ?? undefined)
}

async function seedDerivedSizes(entries: WorkerExportStart['derivedSizes']): Promise<void> {
  if (entries.length === 0) return
  const { derivedSizes } = await import('@/studio/render/stages/staged-size')
  for (const [key, size] of entries) derivedSizes.set(key, size)
}

function setTimingsFlag(on: boolean): void {
  ;(globalThis as Record<string, unknown>)[STAGE_TIMINGS_FLAG] = on
}

function stageMarks(): WorkerTimingMark[] {
  return performance
    .getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith(MARK_PREFIX))
    .map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
      detail: ((entry as PerformanceMeasure).detail as { frame?: number } | null) ?? null,
    }))
}

/** A native export's render in this realm, over the page's decode IPC through the plan's port; `null` for any other */
function nativeRender(plan: NativeExportPlan | undefined): {
  readonly render: WorkerExportScope['renderNative']
  destroy(): void
} {
  if (plan?.media == null) return { render: null, destroy() {} }
  const bridge = createRelayedNativeMedia(plan.media)
  return {
    render: async (options) => {
      const { renderNativeComposition } = await import('./native-render')
      return renderNativeComposition({ ...options, plan, bridge })
    },
    destroy: () => bridge.destroy(),
  }
}

/** Puts what the page prepared in place for one export; `undefined` (a start without it) changes nothing */
export async function beginWorkerExport(
  start: WorkerExportStart | undefined,
): Promise<WorkerExportScope> {
  const media = new Map((start?.media ?? []).map((record) => [record.id, record]))
  for (const { url, blob, metadata } of start?.objectUrls ?? []) registerObjectUrl(url, blob, metadata)
  await Promise.all([
    seedMediaLibrary(start?.media ?? []),
    seedDerivedSizes(start?.derivedSizes ?? []),
    start === undefined ? undefined : seedProjectRate(start.projectFps),
    start === undefined ? undefined : seedProjectFrame(start.projectFrame),
  ])
  const host = start?.engines ? createRelayedStabilizationHost(start.engines) : null
  if (host !== null) {
    const { installStabilizationSeat } = await import('@/studio/stabilization/seat')
    installStabilizationSeat(host)
  }
  const native = nativeRender(start?.native)
  const timings = start?.timings === true
  if (timings) {
    performance.clearMeasures()
    setTimingsFlag(true)
  }
  let ended = false

  return {
    mediaMayCarryAudio(mediaId) {
      if (start === undefined || mediaId === undefined) return true
      const record = media.get(mediaId)
      if (record === undefined) return true
      return typeof record.audioCodec === 'string' && record.audioCodec.length > 0
    },
    timings() {
      return timings ? { timeOrigin: performance.timeOrigin, marks: stageMarks() } : undefined
    },
    renderNative: native.render,
    end() {
      if (ended) return
      ended = true
      if (timings) setTimingsFlag(false)
      host?.destroy()
      native.destroy()
    },
  }
}
