// The layout's read of a staged clip's size (design 3.6 section 2.9, condition 9; findings S5, R4): the session's
// derived-size store and the one question FreeCut's layout asks of it. A light module on purpose: the layout
// (`transform-resolver.ts`) is imported by most of the editor, so this file reaches no engine, no store and no stage.
//
// The store is filled only by a stage's `prepare` (the stabilization stage's, through the session's registry), outside
// the render, and keyed by (stage, media, settings fingerprint): a settings change is a new key, nothing the render
// computes enters the project or its undo history. Only the stabilization changes a clip's size; a stage that does too
// adds its key here.

import { stabilizationEngineKey } from '@/studio/stabilization/engine-key'
import type { TimelineItem } from '@/types/timeline'
import { createDerivedSizeStore, derivedSizeKey } from './derived-sizes'
import { isStabilized } from './predicates'
import type { Size } from './types'

/** The session's size store: the stages' `prepare` is its only writer */
export const derivedSizes = createDerivedSizeStore()

/**
 * The size a clip's staged picture has, for the layout, read from the store and nothing else (no engine is asked,
 * nothing waits). `undefined` for a clip no stage changes the size of, and for one whose size is not known yet (its
 * engine is still opening, or failed): the layout then uses the file's size, and the preview says why the clip is not
 * drawn staged.
 */
export function stagedSourceDimensions(item: TimelineItem): Size | undefined {
  if (item.type !== 'video' || !isStabilized(item)) return undefined
  const key = stabilizationEngineKey(item)
  return key === null ? undefined : derivedSizes.get(derivedSizeKey('stabilize', key))
}
