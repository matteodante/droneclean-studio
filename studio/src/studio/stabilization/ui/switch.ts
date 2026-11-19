// Switching a clip's stabilization on and storing its settings: the steps the clip panel's hook and the SDK's
// `clips.setStabilization` share, so one path runs from a mouse to a script (plan decision D7).

import { updateItem } from '@/features/timeline/stores/actions/item-actions'
import type { VideoItem } from '@/types/timeline'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { getSourceDimensions } from '@/runtime/composition-runtime/utils/transform-resolver'
import type { StabilizationLens, StabilizationProgress } from '../client'
import {
  stabilizationDefaults,
  type SmoothingMethod,
  type StabilizationSettings,
} from '../settings'
import type { StabilizationEngine } from './engine'
import { boxForStabilization } from './frame-box'

/** The box the clip takes when its stabilization is switched `on` or off (`frame-box.ts`), or `null` to keep it */
function switchedBox(item: VideoItem, on: boolean) {
  const frame = useProjectStore.getState().currentProject?.metadata
  return boxForStabilization(
    item.transform,
    on,
    getSourceDimensions({ ...item, stabilization: undefined }),
    frame,
  )
}

/** What opening a clip for stabilization found: the settings to store, the engine's methods and the lens profile */
export interface OpenedStabilization {
  methods: SmoothingMethod[]
  next: StabilizationSettings
  lens: StabilizationLens
}

/**
 * Builds the settings a switch-on stores (the clip's own, or the engine's defaults, with the switch on) and opens the
 * clip with them on the engine. `adjust` may change the settings before the clip is opened (the SDK's patch). Rejects
 * with `NoMotionDataError` or `NoLensProfileError` when the clip cannot be stabilized.
 */
export async function openStabilization(
  engine: StabilizationEngine,
  current: VideoItem,
  frameRate: number,
  onProgress: (progress: StabilizationProgress) => void,
  adjust?: (settings: StabilizationSettings, methods: SmoothingMethod[]) => StabilizationSettings,
): Promise<OpenedStabilization> {
  const methods = await engine.smoothingMethods()
  const base = current.stabilization ?? stabilizationDefaults(methods)
  const enabled: StabilizationSettings = { ...base, enabled: true }
  const next = adjust ? adjust(enabled, methods) : enabled
  const lens = await engine.probe(current, next, frameRate, onProgress)
  return { methods, next, lens }
}

/**
 * Stores the settings on the clip with one `updateItem` (switching on or off also moves an untouched box to the
 * picture's new shape, in the same undo step) and tells the engine the renderer draws with. Resolves when the engine
 * has them.
 */
export function storeStabilization(
  engine: StabilizationEngine,
  current: VideoItem,
  settings: StabilizationSettings,
  switched: boolean,
): Promise<void> {
  const box = switched ? switchedBox(current, settings.enabled) : null
  updateItem(
    current.id,
    box ? { stabilization: settings, transform: box } : { stabilization: settings },
  )
  return engine.applySettings({ ...current, stabilization: settings }, settings)
}
