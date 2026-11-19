// The warp stages built so far, per device (design 3.6 section 2.8): a stage compiles once (1.5-2.0 s cold) and serves
// every frame of every clip whose profile names the same lens model (the client hands those clips one assets object),
// and a clip that moves to a profile of another model gets that model's stage. A device owns its pipelines, so the
// cache is `perDevice`: the export worker's device gets its own, never the page's.
//
// `stabilizationStageFor` is the asynchronous build (a failed build is forgotten, so the next ask retries);
// `builtStabilizationStage` is the synchronous read the stage adapter's `encode` makes after `prepare` awaited the build.

import { perDevice } from '@/studio/render/device-cache'
import {
  createStabilizationStage,
  type StabilizationAssets,
  type StabilizationFormats,
  type StabilizationStage,
} from './stage'

/** One stage's build: the promise, and the stage once it resolved */
interface Holder {
  readonly promise: Promise<StabilizationStage>
  stage: StabilizationStage | undefined
}

type StageMap = WeakMap<StabilizationAssets, Map<string, Holder>>

function formatKey(formats: StabilizationFormats): string {
  return `${formats.input}>${formats.output}`
}

function stagesOf(device: GPUDevice): StageMap {
  return perDevice(device, 'stabilization-stages', () => new WeakMap() as StageMap)
}

/** The stage for this device, lens assets and format pair, built once; a build that fails is built again by the next ask */
export function stabilizationStageFor(
  device: GPUDevice,
  assets: StabilizationAssets,
  formats: StabilizationFormats,
): Promise<StabilizationStage> {
  const stages = stagesOf(device)
  let byFormat = stages.get(assets)
  if (!byFormat) {
    byFormat = new Map()
    stages.set(assets, byFormat)
  }
  const key = formatKey(formats)
  const known = byFormat.get(key)
  if (known) return known.promise
  const holder: Holder = {
    promise: createStabilizationStage(device, assets, formats).then((stage) => {
      holder.stage = stage
      return stage
    }),
    stage: undefined,
  }
  const owner = byFormat
  holder.promise.catch(() => {
    if (owner.get(key) === holder) owner.delete(key)
  })
  byFormat.set(key, holder)
  return holder.promise
}

/** The stage if its build has finished, else `undefined` (never starts one) */
export function builtStabilizationStage(
  device: GPUDevice,
  assets: StabilizationAssets,
  formats: StabilizationFormats,
): StabilizationStage | undefined {
  return stagesOf(device).get(assets)?.get(formatKey(formats))?.stage
}
