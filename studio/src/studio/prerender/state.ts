// The editor's state as the pre-render reads it (design `docs/designs/prerender-preview.md` §0.2, §0.5): the composition
// the preview draws, built from the stores with the preview's own builder (`buildPreviewCompositionData`), and the
// hashes of its frames. The job renders from the same object it hashes, so a frame is never stored under a hash it
// was not drawn from. Every store whose change can redraw a frame marks the cache dirty: the next frame the player
// is asked for checks the hashes first.

import { buildPreviewCompositionData } from '@/features/preview/hooks/use-preview-composition-model'
import { resolveProxyUrl } from '@/features/preview/utils/media-resolver'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { resolveEffectiveTrackStates } from '@/features/timeline/utils/group-utils'
import { usePlaybackStore } from '@/shared/state/playback'
import type { CompositionInputProps } from '@/types/export'
import type { TimelineItem } from '@/types/timeline'
import { prerenderCache } from './cache'
import { frameHashes, type FingerprintInput } from './fingerprint'
import { getPrerenderHost, type PrerenderHostInputs } from './host'
import type { FrameRange } from './ranges'

/** The composition the preview draws now, with the host's resolved media URLs */
export function collectRenderInput(host: PrerenderHostInputs): CompositionInputProps {
  const { tracks, itemsByTrackId, items } = useItemsStore.getState()
  const combinedTracks = resolveEffectiveTrackStates(tracks)
    .toSorted((a, b) => b.order - a.order)
    .map((track) => ({ ...track, items: itemsByTrackId[track.id] ?? [] }))
  return buildPreviewCompositionData({
    combinedTracks,
    fps: useTimelineSettingsStore.getState().fps,
    items,
    keyframes: useKeyframesStore.getState().keyframes,
    transitions: useTransitionsStore.getState().transitions,
    resolvedUrls: host.resolvedUrls,
    useProxy: usePlaybackStore.getState().useProxy,
    blobUrlVersion: 0,
    project: host.project,
    previewRenderSize: host.renderSize,
  }).fastScrubInputProps
}

/** The identity of the file a media clip reads: proxy or original, and the file itself */
function sourceKeyOf(item: TimelineItem, useProxy: boolean): string {
  const mediaId = item.mediaId ?? ''
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  const kind = useProxy && item.type === 'video' && resolveProxyUrl(mediaId) ? 'proxy' : 'original'
  const file =
    media === undefined
      ? 'unknown'
      : [
          media.fileName,
          media.fileSize,
          media.fileLastModified ?? '',
          media.filePath ?? '',
          `${media.width}x${media.height}`,
          media.fps,
          media.duration,
        ].join('|')
  return `${kind}|${file}`
}

/** What `frameHashes` reads for `input` */
export function fingerprintInputFor(
  input: CompositionInputProps,
  host: PrerenderHostInputs,
): FingerprintInput {
  const { useProxy, previewQuality } = usePlaybackStore.getState()
  const metadata = useProjectStore.getState().currentProject?.metadata
  return {
    global: {
      fps: input.fps,
      width: input.width,
      height: input.height,
      backgroundColor: input.backgroundColor ?? null,
      previewQuality,
      // The size the frames are drawn at follows the player's size for a large project (preview-render-size.ts):
      // frames drawn at another size are stale, or they play back soft after the window is resized
      renderSize: [host.renderSize.width, host.renderSize.height],
      useProxy,
      renderText: host.renderText,
      project: metadata
        ? [metadata.width, metadata.height, metadata.fps, metadata.backgroundColor ?? null]
        : null,
    },
    tracks: input.tracks,
    transitions: input.transitions ?? [],
    keyframes: input.keyframes ?? [],
    compositionsById: new Map(
      useCompositionsStore
        .getState()
        .compositions.map((composition) => [composition.id, composition]),
    ),
    sourceKey: (item) => sourceKeyOf(item, useProxy),
  }
}

/** The hashes of a range as the editor draws it now; with no preview mounted no frame matches */
export function currentFrameHashes(range: FrameRange): Float64Array {
  const host = getPrerenderHost()
  if (host === null) return new Float64Array(Math.max(0, range.end - range.start)).fill(Number.NaN)
  return frameHashes(fingerprintInputFor(collectRenderInput(host), host), range)
}

let watching = false

/**
 * Point the cache at the editor's state and mark it dirty on every change that can redraw a frame. Idempotent: the
 * subscriptions live as long as the page, as the stores do.
 */
export function watchPrerenderState(): void {
  if (watching) return
  watching = true
  prerenderCache.setHashSource(currentFrameHashes)
  prerenderCache.useProject(useProjectStore.getState().currentProject?.id ?? null)
  const dirty = () => prerenderCache.markDirty()
  useItemsStore.subscribe((state, previous) => {
    if (state.tracks !== previous.tracks || state.itemsByTrackId !== previous.itemsByTrackId)
      dirty()
  })
  useKeyframesStore.subscribe((state, previous) => {
    if (state.keyframes !== previous.keyframes) dirty()
  })
  useTransitionsStore.subscribe((state, previous) => {
    if (state.transitions !== previous.transitions) dirty()
  })
  useCompositionsStore.subscribe((state, previous) => {
    if (state.compositions !== previous.compositions) dirty()
  })
  useTimelineSettingsStore.subscribe((state, previous) => {
    if (state.fps !== previous.fps) dirty()
  })
  usePlaybackStore.subscribe((state, previous) => {
    if (state.useProxy !== previous.useProxy || state.previewQuality !== previous.previewQuality) {
      dirty()
    }
  })
  useMediaLibraryStore.subscribe((state, previous) => {
    if (state.mediaById !== previous.mediaById || state.proxyStatus !== previous.proxyStatus)
      dirty()
  })
  useProjectStore.subscribe((state, previous) => {
    const id = state.currentProject?.id ?? null
    if (id !== (previous.currentProject?.id ?? null)) prerenderCache.useProject(id)
    else if (state.currentProject?.metadata !== previous.currentProject?.metadata) dirty()
  })
}
