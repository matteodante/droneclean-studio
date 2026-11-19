/**
 * The editor SDK's entry point (design §4.2, §4.8): one object over the
 * editor's command store and domain stores.
 *
 * Each namespace is a plain object whose methods are documented in `types.ts`
 * and implemented in `namespaces/`; this file only composes them. Every call
 * that changes the timeline is one undo step, and a failed call leaves the
 * project exactly as it was (see `transaction.ts`). The object carries the
 * format version, the transaction helper and the generated reference, so an
 * agent has one thing to reach for: `studio`.
 */

import sdkReferenceJson from './reference/sdk-reference.json'
import { createClipsApi } from './namespaces/clips'
import { createEffectsApi } from './namespaces/effects'
import { createExportApi } from './namespaces/export'
import { createHistoryApi } from './namespaces/history'
import { createWorkspaceApi } from './namespaces/workspace'
import { createKeyframesApi } from './namespaces/keyframes'
import { createLooksApi } from './namespaces/looks'
import { createShadowApi } from './namespaces/shadow'
import { createMarkersApi } from './namespaces/markers'
import { createMediaApi } from './namespaces/media'
import { createSubclipsApi } from './namespaces/subclips'
import { createPlaybackApi } from './namespaces/playback'
import { createProjectApi } from './namespaces/project'
import { createSelectionApi } from './namespaces/selection'
import { createTitlesApi } from './namespaces/titles'
import { createTracksApi } from './namespaces/tracks'
import { createTransitionsApi } from './namespaces/transitions'
import { transaction } from './transaction'
import type { SdkReference, Studio } from './types'

/**
 * The committed reference, typed by the contract it documents. Its content is
 * checked against `types.ts` and the live namespaces by
 * `reference/reference.test.ts`, so a stale file fails the test run.
 */
const SDK_REFERENCE = sdkReferenceJson as SdkReference

/**
 * Create the editor SDK: the seventeen namespaces over the editor's stores, the
 * format version, the transaction helper and the generated reference.
 * @example const studio = createStudio(); studio.clips.list()
 */
export function createStudio(): Studio {
  const studio: Studio = {
    version: 1,
    project: createProjectApi(),
    media: createMediaApi(),
    subclips: createSubclipsApi(),
    tracks: createTracksApi(),
    clips: createClipsApi(),
    titles: createTitlesApi(),
    effects: createEffectsApi(),
    keyframes: createKeyframesApi(),
    transitions: createTransitionsApi(),
    markers: createMarkersApi(),
    selection: createSelectionApi(),
    playback: createPlaybackApi(),
    export: createExportApi(),
    history: createHistoryApi(),
    workspace: createWorkspaceApi(),
    looks: createLooksApi(),
    shadow: createShadowApi(),
    transaction(label, fn) {
      return transaction(label, () => fn(studio))
    },
    reference() {
      // A copy: a caller that rewrites the reference cannot corrupt the module.
      return structuredClone(SDK_REFERENCE)
    },
  }
  return studio
}
