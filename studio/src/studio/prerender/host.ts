// What the mounted preview tells the pre-render (design `docs/designs/prerender-preview.md` §0.2): the media URLs it
// resolved, the size it renders at (the preview quality included), whether its canvas draws text, and the project
// size it shows. Written by `use-prerender-preview.ts` on every preview render; `null` while no preview is mounted,
// when a pre-render cannot start.

import { prerenderCache } from './cache'

export interface PrerenderHostInputs {
  readonly resolvedUrls: ReadonlyMap<string, string>
  /** The live preview's render size: the cache renders at the same size */
  readonly renderSize: { readonly width: number; readonly height: number }
  /** Whether the preview's canvas draws text (it does not when a DOM overlay draws it on top) */
  readonly renderText: boolean
  readonly project: {
    readonly width: number
    readonly height: number
    readonly backgroundColor?: string
  }
}

let host: PrerenderHostInputs | null = null

function sameHost(a: PrerenderHostInputs | null, b: PrerenderHostInputs | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.resolvedUrls === b.resolvedUrls &&
    a.renderSize.width === b.renderSize.width &&
    a.renderSize.height === b.renderSize.height &&
    a.renderText === b.renderText &&
    a.project.width === b.project.width &&
    a.project.height === b.project.height &&
    a.project.backgroundColor === b.project.backgroundColor
  )
}

export function setPrerenderHost(next: PrerenderHostInputs | null): void {
  if (sameHost(host, next)) return
  const drawsDifferently =
    host === null ||
    next === null ||
    host.renderText !== next.renderText ||
    host.project.width !== next.project.width ||
    host.project.height !== next.project.height ||
    host.project.backgroundColor !== next.project.backgroundColor
  host = next
  if (drawsDifferently) prerenderCache.markDirty()
}

export function getPrerenderHost(): PrerenderHostInputs | null {
  return host
}
