// The session's stage pipeline pieces (design 3.6 sections 2.2 and 2.9): the registry of the three stages over the
// session's derived-size store (`staged-size.ts`), and the page's preparer, which follows the timeline's items. This is
// the only file of the stages that reaches a store (through `watchTimelineItems`); the stages and the preparer take what
// they need as data.
//
// The preparer prepares on a device it is given: each preview renderer's stages (`renderer.ts`) call
// `setPreparerDevice` with the renderer's own, because a pipeline built for another device is of no use to it
// (`perDevice`). Until then `sync` finds no device and prepares nothing.

import { useItemsStore } from '@/features/timeline/stores/items-store'
import {
  setStabilizationProjectFrame,
  stabilizationProjectAspect,
} from '@/studio/stabilization/engine-key'
import { sameAspect } from '@/studio/stabilization/settings'
import { stabilizationSeat, watchTimelineItems } from '@/studio/stabilization/seat'
import { createInputColourStage } from './input-colour'
import { createLookStage } from './look'
import { createPreparer, type Preparer } from './preparer'
import { createStageRegistry, type StageRegistry } from './registry'
import { createStabilizeStage } from './stabilize'
import { isStabilized } from './predicates'
import { derivedSizes } from './staged-size'
import type { VideoItem } from '@/types/timeline'

// A stabilized clip is made at the project's aspect, so the stabilization follows the project's frame: the clip's key, and with it its engine's frame size and its derived size, change with the frame. When the aspect
// changes, the engines and the preparer are told at once (they otherwise look at the keys only when the items change).
function followProjectFrame(metadata: { width: number; height: number } | undefined): void {
  setStabilizationProjectFrame(metadata)
}

/** Tells the engines and the preparer, when the project's aspect changed, to look at their keys again */
function resyncStabilization(): void {
  const { items } = useItemsStore.getState()
  if (!items.some(isStabilized)) return
  stabilizationSeat().sync(items)
  void pagePreparer().sync(items)
}

// Only the page has a project store: the export worker is told the page's frame with its start message
// (`export-worker/worker.ts`), and loads no store of the project's.
if (typeof document !== 'undefined') {
  void import('@/features/projects/stores/project-store').then(({ useProjectStore }) => {
    followProjectFrame(useProjectStore.getState().currentProject?.metadata)
    useProjectStore.subscribe((state) => {
      const before = stabilizationProjectAspect()
      followProjectFrame(state.currentProject?.metadata)
      if (!sameAspect(before, stabilizationProjectAspect())) resyncStabilization()
    })
  })
}

/** The video clip that starts where `item` ends on its track, for the stabilization's frames after a cut */
function nextClipOnTrack(item: VideoItem): VideoItem | null {
  const end = item.from + item.durationInFrames
  for (const other of useItemsStore.getState().items) {
    if (other.type === 'video' && other.id !== item.id && other.trackId === item.trackId && other.from === end) {
      return other
    }
  }
  return null
}

let registry: StageRegistry | null = null

/** The registry, built the first time it is asked: importing this module reads nothing of the stages' modules */
function sessionRegistry(): StageRegistry {
  registry ??= createStageRegistry([
    createStabilizeStage({ sizes: derivedSizes, nextClip: nextClipOnTrack }),
    createInputColourStage(),
    createLookStage(),
  ])
  return registry
}

/**
 * The stages in the pipeline's order, over the session's store. They are created on first use, not while the modules
 * load: the look stage reads the looks library, whose modules reach the timeline's store, which reaches this one.
 */
export const SOURCE_STAGES: StageRegistry = {
  get stages() {
    return sessionRegistry().stages
  },
  activeStages: (item) => sessionRegistry().activeStages(item),
  activeStagesOf: (item, scope) => sessionRegistry().activeStagesOf(item, scope),
}

let deviceSource: () => Promise<GPUDevice | undefined> = () => Promise.resolve(undefined)

/** Tells the page's preparer which device to prepare on (the renderer's) */
export function setPreparerDevice(source: () => Promise<GPUDevice | undefined>): void {
  deviceSource = source
}

let pagePreparerInstance: Preparer | null = null

/** The page's preparer; `start()` it once to have it follow the timeline */
export function pagePreparer(): Preparer {
  pagePreparerInstance ??= createPreparer({
    registry: SOURCE_STAGES,
    sizes: derivedSizes,
    getDevice: () => deviceSource(),
    watchItems: watchTimelineItems,
  })
  return pagePreparerInstance
}
