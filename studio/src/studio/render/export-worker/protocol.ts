// The export worker's messages beyond FreeCut's own (design 3.6 section 2.15, task 8.3). FreeCut's export worker
// (`runtime/renderer/workers/export-render.worker.ts`) is started by `render-pipeline.ts` with the settings and the
// composition; the stage pipeline needs more from the page than that, and the page needs more back:
//
//   start     + `studio`: for a native 10-bit export its plan (each clip's file on disk, the started encode job, the
//               port to the page's decode IPC: `native-export.ts`); the project's rate (the stage predicates' and the
//               timeline settings' in the worker, so a
//               blurred clip covers the same source frames there), the derived sizes the page knows, the media the
//               composition uses (the worker's media library is empty), the files behind the composition's `blob:` URLs (the worker's object-URL registry is empty,
//               and FreeCut's decoders refuse a `blob:` URL it does not hold), the port to the page's stabilization
//               host (the engines stay where they were opened: S7), and whether the stage timings are on;
//   error     + `failure`: the error's name and, for a `StageError` or a `SourceError`, its fields, so the page rejects
//               with the same named error and the same message the worker raised;
//   complete  + `timings`: the stage marks the worker recorded, for the page's timeline (task 8.2's bench reads them).
//
// FreeCut's types are left as they are; these extend them. Nothing here touches a GPU, a store or the DOM.

import type { Size, StageErrorStage } from '@/studio/render/stages/types'
import { StageError } from '@/studio/render/stages/types'
import { SourceError } from '@/studio/render/source-error'
import type { ObjectUrlSourceMetadata } from '@/infrastructure/browser/object-url-registry'
import type { MediaMetadata } from '@/types/storage'
import type { NativeExportPlan } from './native-export'
import type {
  ExportRenderCancelRequest,
  ExportRenderCancelledResponse,
  ExportRenderCompleteResponse,
  ExportRenderErrorResponse,
  ExportRenderProgressResponse,
  ExportRenderStartRequest,
} from '@/runtime/renderer/workers/export-render-worker.types'

/** One `blob:` URL of the composition, with the file behind it as the page's object-URL registry holds it */
export interface WorkerObjectUrl {
  readonly url: string
  readonly blob: Blob
  readonly metadata?: ObjectUrlSourceMetadata
}

/** What the page prepares for the worker before its first frame */
export interface WorkerExportStart {
  /**
   * The export's project rate (`composition.fps`): the worker has no timeline, and its stage predicates would otherwise
   * read the timeline settings' default, so a blurred clip's span (and whether it is staged at all) would differ
   */
  readonly projectFps: number
  /**
   * The aspect of the project's frame as the page's stabilization has it (`null` while it is not known): part of every
   * stabilized clip's key, so the worker computes the keys the page's derived sizes and engines are stored under. It is
   * the project's, not the export's: a stabilized clip is made at the project's aspect and then fitted to the export.
   */
  readonly projectFrame?: { readonly width: number; readonly height: number } | null
  /** The derived-size store's entries for the composition's staged clips: `[derivedSizeKey, size]` */
  readonly derivedSizes: ReadonlyArray<readonly [string, Size]>
  /** The media library's records of the media the composition reaches */
  readonly media: readonly MediaMetadata[]
  /** The composition's `blob:` URLs the page's object-URL registry holds (sources, shadow pieces) */
  readonly objectUrls: readonly WorkerObjectUrl[]
  /** The page's stabilization host, served over this port; `null` when no clip is stabilized */
  readonly engines: MessagePort | null
  /** Whether the page records the stage timings (task 8.2): the worker records them too and sends them back */
  readonly timings: boolean
  /** A native 10-bit export's plan; absent for every other export */
  readonly native?: NativeExportPlan
}

/** One stage mark, as `performance.getEntriesByType('measure')` gives it, on the worker's clock */
export interface WorkerTimingMark {
  readonly name: string
  readonly startTime: number
  readonly duration: number
  readonly detail: { frame?: number } | null
}

/** The worker's marks and the clock they are on (`performance.timeOrigin` of the worker) */
export interface WorkerTimings {
  readonly timeOrigin: number
  readonly marks: readonly WorkerTimingMark[]
}

/** An error, as it crosses: its name, its message, and a `StageError`'s fields */
export interface SerializedFailure {
  readonly name: string
  readonly message: string
  readonly stage?: {
    readonly clip: string
    /** A stage, or the motion-blur gather, which a StageError can name too */
    readonly stage: StageErrorStage
    readonly sourceIndex: number | undefined
  }
  /** A `SourceError`'s fields: a clip whose file the export could not open or decode */
  readonly source?: {
    readonly clip: string
    readonly mediaId: string | undefined
    readonly reason: string
    readonly frame: number | undefined
  }
}

export type StudioStartRequest = ExportRenderStartRequest & { readonly studio?: WorkerExportStart }
export type StudioErrorResponse = ExportRenderErrorResponse & {
  readonly failure?: SerializedFailure
}
export type StudioCompleteResponse = ExportRenderCompleteResponse & {
  readonly timings?: WorkerTimings
}

/** What the page sends the export worker */
export type StudioWorkerRequest = StudioStartRequest | ExportRenderCancelRequest

/** What the export worker sends the page */
export type StudioWorkerResponse =
  | ExportRenderProgressResponse
  | StudioCompleteResponse
  | ExportRenderCancelledResponse
  | StudioErrorResponse

/** An error as it crosses to the page: never throws, whatever was thrown */
export function serializeFailure(error: unknown): SerializedFailure {
  if (error instanceof StageError) {
    return {
      name: error.name,
      message: error.message,
      stage: { clip: error.clip, stage: error.stage, sourceIndex: error.sourceIndex },
    }
  }
  if (error instanceof SourceError) {
    return {
      name: error.name,
      message: error.message,
      source: {
        clip: error.clip,
        mediaId: error.mediaId,
        reason: error.reason,
        frame: error.frame,
      },
    }
  }
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}

/**
 * The error the page rejects with, from the worker's answer. A `StageError` comes back as a `StageError` with the
 * same fields and the very same message; any other error as an `Error` with the worker's message and name (FreeCut's
 * fallback reads the message: `WORKER_REQUIRES_MAIN_THREAD:...`).
 */
export function failureFromWorker(failure: SerializedFailure | undefined, message: string): Error {
  if (failure?.source !== undefined) return new SourceError(failure.source)
  if (failure?.stage !== undefined) {
    const { clip, stage, sourceIndex } = failure.stage
    // The message is the class's own `Clip '<clip>', <stage>[, source frame <n>]: <reason>`: the reason is what
    // follows the prefix the same fields give
    const prefix = new StageError({ clip, stage, sourceIndex, reason: '' }).message
    const reason = failure.message.startsWith(prefix)
      ? failure.message.slice(prefix.length)
      : failure.message
    const error = new StageError({ clip, stage, sourceIndex, reason })
    if (error.message !== failure.message) error.message = failure.message
    return error
  }
  const error = new Error(message)
  if (failure !== undefined && failure.name !== 'Error') error.name = failure.name
  return error
}
