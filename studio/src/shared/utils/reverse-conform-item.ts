import type { TimelineItem, VideoItem } from '@/types/timeline'

type ReverseConformMode = 'preview' | 'export'

function hasReadyReverseConform(
  item: TimelineItem,
): item is TimelineItem & { reverseConformSrc: string } {
  return (
    (item.type === 'video' || item.type === 'audio') &&
    item.isReversed === true &&
    item.reverseConformStatus === 'ready' &&
    typeof item.reverseConformSrc === 'string' &&
    item.reverseConformSrc.length > 0
  )
}

function hasReadyReversePreviewConform(
  item: TimelineItem,
): item is TimelineItem & { reverseConformPreviewSrc: string } {
  return (
    item.type === 'video' &&
    item.isReversed === true &&
    item.reverseConformStatus === 'ready' &&
    typeof item.reverseConformPreviewSrc === 'string' &&
    item.reverseConformPreviewSrc.length > 0
  )
}

/**
 * Whether a clip has cleaned shadow pieces. They are stretches of the source's own frames, and a
 * reverse conform is a different file in the opposite order, so such a clip is never reversed and
 * never mapped into a conform: reversing would silently drop the paid cleaning (review finding C5).
 * The reverse actions refuse it; the cleaning is removed first, from the shadow section.
 */
export function hasCleanedShadowPieces(item: TimelineItem): boolean {
  return item.type === 'video' && (item.shadowRemoval?.pieces.length ?? 0) > 0
}

type ReverseConformOptions = { mode?: ReverseConformMode; useProxy?: boolean }

function canUsePreviewConformFor(item: VideoItem, options: ReverseConformOptions): boolean {
  if (options.mode === 'export' || !hasReadyReversePreviewConform(item)) return false
  return (
    options.useProxy === true ||
    item.reverseConformPreviewUsesProxy !== true ||
    !hasReadyReverseConform(item)
  )
}

function pickConformSrc(item: VideoItem, canUsePreviewConform: boolean): string | null {
  if (canUsePreviewConform) return item.reverseConformPreviewSrc ?? null
  return hasReadyReverseConform(item) ? item.reverseConformSrc : null
}

function sourceLevelRates(item: VideoItem, timelineFps: number) {
  const sourceFps = Math.max(0.001, item.sourceFps ?? timelineFps)
  const conformFps = Math.max(0.001, item.reverseConformPreviewFps ?? sourceFps)
  return { sourceFps, conformFps }
}

function sourceLevelRange(item: VideoItem, sourceFps: number, timelineFps: number) {
  const sourceDuration = Math.max(
    1,
    item.reverseConformPreviewSourceDuration ?? item.sourceDuration ?? item.durationInFrames,
  )
  const sourceStart = item.sourceStart ?? item.trimStart ?? item.offset ?? 0
  const sourceFramesNeeded = (item.durationInFrames * (item.speed ?? 1) * sourceFps) / timelineFps
  const sourceEnd = Math.min(sourceDuration, item.sourceEnd ?? sourceStart + sourceFramesNeeded)
  return { sourceDuration, sourceStart, sourceEnd }
}

function mapSourceLevelConform<TItem extends VideoItem>(
  item: TItem,
  conformSrc: string,
  timelineFps: number,
): TItem {
  const { sourceFps, conformFps } = sourceLevelRates(item, timelineFps)
  const { sourceDuration, sourceStart, sourceEnd } = sourceLevelRange(item, sourceFps, timelineFps)
  const conformStart = ((sourceDuration - sourceEnd) * conformFps) / sourceFps
  const conformEnd = ((sourceDuration - sourceStart) * conformFps) / sourceFps

  return {
    ...item,
    src: conformSrc,
    audioSrc: conformSrc,
    isReversed: undefined,
    sourceStart: conformStart,
    trimStart: conformStart,
    offset: conformStart,
    sourceEnd: conformEnd,
    sourceDuration: (sourceDuration * conformFps) / sourceFps,
    sourceFps: conformFps,
  }
}

function mapLegacyConform<TItem extends VideoItem>(
  item: TItem,
  conformSrc: string,
  timelineFps: number,
): TItem {
  // Legacy per-clip conforms use a timeline-frame offset into the rendered clip.
  // Split halves share the conform reference but read different ranges from it.
  const conformLocalStart = item.reverseConformLocalStart ?? 0
  const conformLocalEnd = conformLocalStart + item.durationInFrames

  return {
    ...item,
    src: conformSrc,
    audioSrc: conformSrc,
    isReversed: undefined,
    speed: 1,
    sourceStart: conformLocalStart,
    trimStart: conformLocalStart,
    offset: conformLocalStart,
    sourceEnd: conformLocalEnd,
    sourceDuration: conformLocalEnd,
    sourceFps: timelineFps,
  }
}

export function resolveReverseConformedVideoItem<TItem extends VideoItem>(
  item: TItem,
  timelineFps: number,
  options: ReverseConformOptions = {},
): TItem {
  // Never map a cleaned clip into a conform: its pieces would stop resolving to their frames.
  if (hasCleanedShadowPieces(item)) return item

  const canUsePreviewConform = canUsePreviewConformFor(item, options)
  const conformSrc = pickConformSrc(item, canUsePreviewConform)
  if (!conformSrc) return item

  if (item.reverseConformPreviewIsSourceLevel === true && canUsePreviewConform) {
    return mapSourceLevelConform(item, conformSrc, timelineFps)
  }
  return mapLegacyConform(item, conformSrc, timelineFps)
}
