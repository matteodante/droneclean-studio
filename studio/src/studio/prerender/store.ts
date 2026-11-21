// What the interface shows of the pre-render: the ranges the ruler draws green, the cache's size, the job in
// progress and how the last one ended. Written only by `cache.ts` and `job.ts`.

import { create } from 'zustand'
import type { FrameRange } from './ranges'

/** How a pre-render ended; `reason` is set when it stopped before the end of its range */
export interface PrerenderOutcome {
  readonly status: 'done' | 'cancelled' | 'stopped'
  readonly reason?: PrerenderStopReason
  /** The error's own words, for `reason: 'error'` */
  readonly detail?: string
  readonly startFrame: number
  readonly endFrame: number
  /** Frames rendered by this job (frames already in the cache are not rendered again) */
  readonly renderedFrames: number
  readonly seconds: number
}

/**
 * Why a pre-render stopped early: `changed` the project changed under it, `full` the cache reached its memory limit,
 * `unsupported` this machine cannot encode or decode the preview size with WebCodecs, `error` the render or the
 * encoder failed.
 */
export type PrerenderStopReason = 'changed' | 'full' | 'unsupported' | 'error'

interface PrerenderJobProgress {
  readonly startFrame: number
  readonly endFrame: number
  readonly done: number
  readonly total: number
}

interface PrerenderUiState {
  /** The frames that play from the cache now, merged */
  ranges: FrameRange[]
  /** Encoded bytes the cache holds */
  bytes: number
  job: PrerenderJobProgress | null
  lastOutcome: PrerenderOutcome | null
}

export const usePrerenderStore = create<PrerenderUiState>()(() => ({
  ranges: [],
  bytes: 0,
  job: null,
  lastOutcome: null,
}))
