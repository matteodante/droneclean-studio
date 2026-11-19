/**
 * Install the editor SDK on the page (design §4.8).
 *
 * `src/main.tsx` and `src/headless/main.ts` each import this module and call
 * `installStudio()` once, so the app page and the headless page both carry
 * `window.studio` beside FreeCut's `window.freecut`. Everything the SDK returns
 * survives `JSON.stringify` except `media.import`'s handles; task 2.2's `run`
 * tool evaluates a script in this page and reports the JSON.
 */

import { createStudio } from './index'
import type { Studio } from './types'

declare global {
  // The global the page's scripts see, installed by `installStudio()` below.
  var studio: Studio
}

/**
 * Create the SDK and expose it as `globalThis.studio`; returns the same object.
 * @example installStudio(); window.studio.version // 1
 */
export function installStudio(): Studio {
  const studio = createStudio()
  globalThis.studio = studio
  return studio
}
