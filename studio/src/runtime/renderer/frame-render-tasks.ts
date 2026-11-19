import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import type { ResolvedTransform } from '@/types/transform'
import { createLogger } from '@/shared/logging/logger'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { getAnimatedTransform } from './canvas-keyframes'
import { resolveAnimatedColorEffects } from '@/runtime/renderer/deps/keyframes-contract'
import {
  combineEffects,
  getAdjustmentLayerEffects,
  renderEffectsFromMaskedSource,
  type AdjustmentLayerWithTrackOrder,
} from './canvas-effects'
import { hasCornerPin } from '@/runtime/renderer/deps/composition-runtime-contract'
import {
  preciseOutputActive,
  preciseRenderFormat,
} from '@/studio/render/precise/contract'
import { needsSourceStages } from '@/studio/render/stages/predicates'
import type { CanvasPool } from './canvas-pool'
import type { MaskCanvasSettings, PreparedMask } from './canvas-masks'
import type { ActiveTransition } from './canvas-transitions'
import {
  renderItem,
  renderItemGpuEffectsToTexture,
  renderPreviewVideoGpuEffectsToCanvas,
  renderTransitionToCanvas,
  type CanvasSettings,
  type ItemRenderContext,
} from './canvas-item-renderer'
import type { GpuPipelineManager } from './gpu-pipeline-manager'
import type { RenderedTaskResult } from './frame-mask-helpers'

function getLog() {
  return createLogger('ClientRenderEngine')
}

/**
 * Whether any item this frame draws needs the render seat (design 6.3 §4.6, 5.1 §4.6). A seated
 * item renders to a GPU texture, so the frame must composite on the GPU — the Canvas2D compositor
 * has no texture to draw — and the effects device, the media pipeline and the texture pool must
 * exist before the first task runs. `frame-render-pass.ts` reads this beside
 * `detectFrameGpuEffects(frame)`.
 */
export function frameNeedsRenderSeat(
  tracks: ReadonlyArray<TimelineTrack>,
  visibleTrackIds: ReadonlySet<string>,
  frame: number,
  getCurrentItem: <TItem extends TimelineItem>(item: TItem) => TItem,
): boolean {
  for (const track of tracks) {
    if (!visibleTrackIds.has(track.id)) continue
    for (const baseItem of track.items ?? []) {
      const item = getCurrentItem(baseItem)
      if (frame < item.from || frame >= item.from + item.durationInFrames) continue
      if (needsSourceStages(item)) return true
    }
  }
  return false
}

/**
 * Renders a transition to a pooled Canvas2D surface (the non-GPU fallback path),
 * applying the masks scoped to the transition's track. Extracted verbatim from
 * `renderFrame`.
 */
export async function renderTransitionFallbackCanvas(
  task: { transition: ActiveTransition; trackOrder: number },
  deps: {
    frame: number
    activeMasks: PreparedMask[]
    itemRenderContext: ItemRenderContext
    canvasPool: CanvasPool
  },
): Promise<RenderedTaskResult> {
  const { frame, activeMasks, itemRenderContext, canvasPool } = deps
  const transitionMasks = activeMasks.filter((mask) =>
    doesMaskAffectTrack(mask.trackOrder, task.trackOrder),
  )
  const { canvas: trCanvas, ctx: trCtx } = canvasPool.acquire()
  await renderTransitionToCanvas(
    trCtx,
    task.transition,
    frame,
    itemRenderContext,
    task.trackOrder,
    transitionMasks,
  )
  return { source: trCanvas, poolCanvases: [trCanvas] }
}

export interface FrameItemRenderDeps {
  frame: number
  canvasSettings: CanvasSettings
  maskSettings: MaskCanvasSettings
  renderMode: 'export' | 'preview'
  activeMasks: PreparedMask[]
  adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  gpu: GpuPipelineManager
  itemRenderContext: ItemRenderContext
  canvasPool: CanvasPool
  getCurrentItem: <TItem extends TimelineItem>(item: TItem) => TItem
  getCurrentKeyframes: (itemId: string) => ItemKeyframes | undefined
  getPreviewTransformOverride?: (itemId: string) => Partial<ResolvedTransform> | undefined
  getPreviewCornerPinOverride?: (itemId: string) => TimelineItem['cornerPin'] | undefined
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined
  getLiveItemSnapshot?: (itemId: string) => TimelineItem | undefined
}

/**
 * Renders one timeline item with its transform, preview overrides, masks, and
 * effects (direct-GPU, preview-GPU, or pooled Canvas2D paths). When `deferred`
 * is true the rendered surface/texture is returned for later compositing;
 * otherwise it is drawn straight to `targetCtx`. Extracted verbatim from
 * `renderFrame`; mutates `deps.itemRenderContext.gpuPipeline` lazily.
 */
export async function renderItemWithEffects(
  baseItem: TimelineItem,
  trackOrder: number,
  deferred: boolean,
  targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  deps: FrameItemRenderDeps,
  bakeMasks = true,
  preferGpuTextureOutput = false,
  allowDirectGpu = true,
): Promise<RenderedTaskResult | null> {
  const {
    frame,
    canvasSettings,
    maskSettings,
    renderMode,
    activeMasks,
    adjustmentLayers,
    gpu,
    itemRenderContext,
    canvasPool,
    getCurrentItem,
    getCurrentKeyframes,
    getPreviewCornerPinOverride,
    getPreviewEffectsOverride,
    getLiveItemSnapshot,
  } = deps

  const item = getCurrentItem(baseItem)
  // Get animated transform
  const itemKeyframes = getCurrentKeyframes(item.id)
  const transform = getAnimatedTransform(item, itemKeyframes, frame, canvasSettings)

  // Apply corner pin preview override during interactive drag
  let effectiveItem = item
  if (renderMode === 'preview') {
    const cornerPinOverride = getPreviewCornerPinOverride?.(item.id)
    if (cornerPinOverride !== undefined) {
      effectiveItem = { ...item, cornerPin: cornerPinOverride }
    }
  }

  // Get effects (preview override → item effects + adjustment layer effects)
  const baseItemEffects =
    (renderMode === 'preview' ? getPreviewEffectsOverride?.(item.id) : undefined) ??
    effectiveItem.effects
  const itemEffects = resolveAnimatedColorEffects(
    baseItemEffects,
    getCurrentKeyframes(effectiveItem.id),
    frame - effectiveItem.from,
  )
  const adjEffects = getAdjustmentLayerEffects(
    trackOrder,
    adjustmentLayers,
    frame,
    renderMode === 'preview' ? getPreviewEffectsOverride : undefined,
    renderMode === 'preview' ? getLiveItemSnapshot : undefined,
    getCurrentKeyframes,
  )
  const combinedEffects = combineEffects(itemEffects, adjEffects)
  const applicableMasks = activeMasks.filter((mask) =>
    doesMaskAffectTrack(mask.trackOrder, trackOrder),
  )
  const renderMasks = bakeMasks ? applicableMasks : []

  // NOTE: The HTMLVideoElement importExternalTexture path stays disabled because
  // textureSampleBaseClampToEdge produces subtly different edge pixel values
  // compared to canvas 2D's drawImage (different YUV→RGB conversion at
  // chroma subsampling boundaries). Spatial effects like halftone amplify
  // this into a visible bright edge. The standard canvas 2D → GPU path
  // below handles video correctly with negligible extra cost (~1-2ms).

  // DOM-video GPU-effect fast path FIRST. It self-gates to null unless we're in
  // preview mode with a DOM video provider installed (i.e. playback), the clip
  // is a simple video (no crop/rotation/opacity/cornerRadius/flip/cornerPin) and
  // has only gpu-effects. In that case it applies the effects directly to the
  // Player's live <video> element — the same zero-copy source the on-screen
  // preview uses. The direct-to-texture path below sources frames via mediabunny
  // decode, which can't track a playing video, so during playback it must not
  // win for video: scopes (and any capture re-rendering through this path) would
  // otherwise freeze on effect clips while non-effect clips kept updating.
  // Outside playback (no provider) this returns null and the mediabunny path runs
  // exactly as before, and export (renderMode !== 'preview') is unaffected.
  if (renderMasks.length === 0 && combinedEffects.length > 0) {
    const directGpuCanvas = renderPreviewVideoGpuEffectsToCanvas(
      effectiveItem,
      transform,
      combinedEffects,
      frame,
      itemRenderContext,
    )
    if (directGpuCanvas) {
      if (deferred) {
        return { source: directGpuCanvas, poolCanvases: [] }
      }
      targetCtx.drawImage(directGpuCanvas, 0, 0)
      return null
    }
  }

  // A precise export composites every frame, so a plain clip must reach the GPU participant path
  // too: that is where a published source texture is sampled and where the output is a float
  // texture the accumulator can take. `preferGpuTextureOutput` is false on every call in the
  // engine today; without a sink or a seat the condition is the one it has always been, so a clip
  // with no effects keeps the 8-bit path it had.
  const preciseActive = preciseOutputActive(renderMode)
  // A stabilized or colour-transformed clip draws through the GPU participant seat (design 6.3
  // §4.6, 5.1 §4.6): its source frame must reach the warp and the input colour pass before the
  // effects, which only that path does.
  const seatActive = needsSourceStages(effectiveItem)
  const canRenderDirectGpu =
    allowDirectGpu &&
    (preferGpuTextureOutput || preciseActive || seatActive) &&
    gpu.texturePool &&
    itemRenderContext.gpuPipeline &&
    itemRenderContext.gpuMediaPipeline &&
    renderMasks.length === 0 &&
    combinedEffects.every((effect) => effect.enabled && effect.effect.type === 'gpu-effect') &&
    (effectiveItem.type === 'video' || effectiveItem.type === 'image') &&
    (preciseActive || combinedEffects.length > 0 || seatActive)
  if (canRenderDirectGpu && gpu.texturePool) {
    const outputTexture = gpu.texturePool.acquire(
      canvasSettings.width,
      canvasSettings.height,
      preciseRenderFormat(renderMode),
    )
    let renderedDirect = false
    try {
      renderedDirect = await renderItemGpuEffectsToTexture(
        effectiveItem,
        transform,
        combinedEffects,
        frame,
        itemRenderContext,
        outputTexture,
        gpu.texturePool,
        undefined,
        preciseActive || seatActive,
      )
      if (renderedDirect) {
        return { gpuTexture: outputTexture, poolCanvases: [] }
      }
    } finally {
      if (!renderedDirect) {
        gpu.texturePool.release(outputTexture)
      }
    }
  }

  // === PERFORMANCE: Use pooled canvas instead of creating new one ===
  const { canvas: itemCanvas, ctx: itemCtx } = canvasPool.acquire()

  // Render based on item type
  await renderItem(
    itemCtx,
    effectiveItem,
    transform,
    frame,
    itemRenderContext,
    0,
    undefined,
    renderMasks,
  )

  // Apply effects (per-item — GPU effects applied here for both preview and export)
  if (combinedEffects.length > 0) {
    const hasGpu = combinedEffects.some((e) => e.enabled && e.effect.type === 'gpu-effect')
    if (hasGpu && !itemRenderContext.gpuPipeline) {
      itemRenderContext.gpuPipeline = await gpu.ensureEffects()
      if (!itemRenderContext.gpuPipeline) {
        getLog().warn('GPU pipeline init failed — GPU effects will be skipped')
      }
    }
    const { source, poolCanvases } = await renderEffectsFromMaskedSource(
      canvasPool,
      itemCanvas,
      combinedEffects,
      hasCornerPin(effectiveItem.cornerPin) ? [] : renderMasks,
      frame,
      maskSettings,
      itemRenderContext.gpuPipeline,
    )
    canvasPool.release(itemCanvas)

    if (deferred) {
      return { source, poolCanvases }
    }
    targetCtx.drawImage(source, 0, 0)
    for (const effectCanvas of poolCanvases) canvasPool.release(effectCanvas)
    return null
  }

  if (deferred) {
    return { source: itemCanvas, poolCanvases: [itemCanvas] }
  }
  targetCtx.drawImage(itemCanvas, 0, 0)
  canvasPool.release(itemCanvas)
  return null
}
