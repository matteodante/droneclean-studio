// The key a clip's stabilization engine, its open result and its derived size are stored under (design 3.6 sections
// 2.2 and 2.9, finding S4): the clip's media and its settings' fingerprint, never the clip itself, so clips of one file
// with the same settings share an engine and a settings change is a new key. Its own module, with nothing but the
// settings' fingerprint behind it, because the layout reads the derived size through it.
//
// The fingerprint includes the aspect of the project's frame: a stabilized clip is made at the project's aspect (a 4:3
// clip in a 4:3 project comes out 4:3, in a 16:9 project 16:9), so the same clip in a project of another frame is other
// frames and another size. The project's frame is session state, like the predicates' project rate: the page's session
// follows the project (`render/stages/session.ts`), the export worker is told it by the page (`export-worker`).

import type { VideoItem } from '@/types/timeline'
import { aspectOf, engineSettingsKey, type EngineSettings, type OutputAspect } from './settings'

let projectAspect: OutputAspect | undefined

/**
 * Tells the stabilization the project's frame (its pixel size; only the aspect is kept), or forgets it with `undefined`,
 * after which a clip's engine keeps the output its lens profile names.
 */
export function setStabilizationProjectFrame(frame: { width: number; height: number } | undefined): void {
  projectAspect = frame === undefined ? undefined : aspectOf(frame.width, frame.height)
}

/** The project's aspect as the stabilization knows it, or `undefined` while the frame is not known */
export function stabilizationProjectAspect(): OutputAspect | undefined {
  return projectAspect
}

/**
 * What a clip's engine is asked for: its stored settings and the project's aspect. A `outputAspect` a stored field might
 * carry is replaced, never trusted: the aspect is the project's.
 */
export function engineSettingsOf(item: VideoItem): EngineSettings | undefined {
  const settings = item.stabilization
  if (!settings) return undefined
  return { ...settings, outputAspect: projectAspect }
}

/** The key a clip's engine, its open result and its derived size are stored under; `null` for a clip with no file or settings */
export function stabilizationEngineKey(item: VideoItem): string | null {
  const settings = engineSettingsOf(item)
  if (!settings || !item.mediaId) return null
  return `${JSON.stringify(item.mediaId)}:${engineSettingsKey(settings)}`
}
