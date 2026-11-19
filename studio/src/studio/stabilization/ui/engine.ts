// What the clip panel's section asks of the stabilization engine, as one small interface so the tests give it
// their own (task 6.4).
//
// The engine host (`seat.ts`) is the page's one client. It answers the smoothing methods and the result of a clip's
// open (ready, no motion data, no lens profile, or failed with the typed error of `client.ts`), so the panel asks it
// for both and no longer opens the clip a second time with a client of its own: the engine the probe opens is the one
// the renderer's preparer finds already open when the clip is switched on.

import type { StabilizationLens, StabilizationProgress } from '../client'
import type { SmoothingMethod, StabilizationSettings } from '../settings'
import { stabilizationSeat } from '../seat'
import type { VideoItem } from '@/types/timeline'

/** The engine as the section uses it */
export interface StabilizationEngine {
  /** The smoothing methods and their limits, as the engine describes them */
  smoothingMethods(): Promise<SmoothingMethod[]>
  /**
   * Opens the clip with the settings, on the engine the renderer draws with, and reads its lens profile. Resolves with
   * the profile; rejects with `NoMotionDataError` when the file carries no motion data, `NoLensProfileError` when it has
   * no lens profile, or another `StabilizationError` with the engine's own words. A failed earlier open is tried again.
   */
  probe(
    item: VideoItem,
    settings: StabilizationSettings,
    frameRate: number,
    onProgress: (progress: StabilizationProgress) => void,
  ): Promise<StabilizationLens>
  /** Puts the clip's settings on the engine the renderer draws with (`seat.setSettings`) */
  applySettings(item: VideoItem, settings: StabilizationSettings): Promise<void>
}

/** The engine the clip panel uses */
export const pageEngine: StabilizationEngine = {
  smoothingMethods: () => stabilizationSeat().smoothingMethods(),
  async probe(item, settings, frameRate, onProgress) {
    const result = await stabilizationSeat().open(
      { ...item, stabilization: settings },
      { fps: frameRate, onProgress, retry: true },
    )
    if (result.kind === 'ready') return result.lens
    throw result.error
  },
  applySettings: (item, settings) => stabilizationSeat().setSettings(item, settings),
}
