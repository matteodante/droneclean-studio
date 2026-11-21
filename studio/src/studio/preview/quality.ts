// The preview quality (the program monitor's "Playback resolution", as in Premiere: Full, 1/2, 1/4). The setting is
// FreeCut's own (`usePlaybackStore.previewQuality`, kept in the browser's storage for the whole app); here it scales
// the size the preview renders at, so a lower quality draws fewer pixels: the composite, the effects and the
// pre-render all run at the smaller size, and so do the stages that work on the source frame (stabilization, optical
// flow, motion blur), which the preview draws at the size each clip is shown (design 8.10, `render/stages/preview-size.ts`).

/** The qualities the menu offers, in its order */
export const PREVIEW_QUALITY_LEVELS = [1, 0.5, 0.25] as const

export type QualityLevel = (typeof PREVIEW_QUALITY_LEVELS)[number]

export function isPreviewQualityLevel(value: unknown): value is QualityLevel {
  return PREVIEW_QUALITY_LEVELS.includes(value as QualityLevel)
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded + 1
}

/**
 * The render size at a quality: `size` (the preview's own size at full quality) scaled by `quality`, even in both
 * dimensions (as the encoders need) and with the same shape.
 */
export function scalePreviewRenderSize(
  size: { width: number; height: number },
  quality: number,
): { width: number; height: number } {
  if (!(quality > 0 && quality < 1)) return size
  const width = even(size.width * quality)
  return { width, height: even((width / size.width) * size.height) }
}
