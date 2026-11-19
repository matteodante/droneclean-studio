import type { TimelineItem } from '@/types/timeline'
import { createLogger } from '@/shared/logging/logger'
import { getCompositeOperation } from '@/types/blend-mode-css'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { hasCornerPin, type FrameRenderTask } from '@/runtime/renderer/deps/composition-runtime-contract'
import { DEFAULT_LAYER_PARAMS, type CompositeLayer } from '@/infrastructure/gpu-compositor'
import {
  PRECISE_RENDER_FORMAT,
  preciseOutputActive,
  preciseRenderFormat,
} from '@/studio/render/precise/contract'
import { applyMasks, type MaskCanvasSettings, type PreparedMask } from './canvas-masks'
import type { ActiveTransition } from './canvas-transitions'
import type { CanvasPool } from './canvas-pool'
import type { CanvasSettings, ItemRenderContext } from './canvas-item-renderer'
import type { GpuPipelineManager } from './gpu-pipeline-manager'
import type { RenderedTaskResult } from './frame-mask-helpers'

function getLog() {
  return createLogger('ClientRenderEngine')
}

export interface FrameCompositingDeps {
  useGpuCompositor: boolean
  gpu: GpuPipelineManager
  gpuCompositeOutput: { canvas: OffscreenCanvas; ctx: GPUCanvasContext } | null
  canvasSettings: CanvasSettings
  /** The project's background colour (`#rrggbb`), which a precise export's frame composites over. */
  backgroundColor: string
  maskSettings: MaskCanvasSettings
  renderTasks: FrameRenderTask<ActiveTransition>[]
  results: Array<RenderedTaskResult | null>
  activeMasks: PreparedMask[]
  contentCanvas: OffscreenCanvas
  contentCtx: OffscreenCanvasRenderingContext2D
  itemRenderContext: ItemRenderContext
  canvasPool: CanvasPool
  getCurrentItem: <TItem extends TimelineItem>(item: TItem) => TItem
  getEffectiveBlendMode: (item: TimelineItem) => TimelineItem['blendMode']
  applyTrackScopedMasks: (
    result: RenderedTaskResult | null,
    trackOrder: number,
    skipMasks: boolean,
  ) => RenderedTaskResult | null
  renderMasksToGpuTexture: (
    masks: PreparedMask[],
  ) => { texture: GPUTexture; view: GPUTextureView } | null
  renderTransitionFallbackCanvas: (
    task: Extract<FrameRenderTask<ActiveTransition>, { type: 'transition' }>,
  ) => Promise<RenderedTaskResult>
  renderItemWithEffects: (
    baseItem: TimelineItem,
    trackOrder: number,
    deferred: boolean,
    targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    bakeMasks?: boolean,
    preferGpuTextureOutput?: boolean,
    allowDirectGpu?: boolean,
  ) => Promise<RenderedTaskResult | null>
}

type CompositeTask = FrameRenderTask<ActiveTransition>

interface CompositedTaskResult {
  task: CompositeTask
  result: RenderedTaskResult
  fallbackMasks: PreparedMask[]
}

interface CompositeLayerBuildTargets {
  layers: CompositeLayer[]
  layerTextures: GPUTexture[]
  layerMaskTextures: GPUTexture[]
  compositedResults: CompositedTaskResult[]
}

function hasCompositeTaskCornerPin(
  task: CompositeTask,
  getCurrentItem: FrameCompositingDeps['getCurrentItem'],
): boolean {
  return task.type === 'item'
    ? hasCornerPin(getCurrentItem(task.item).cornerPin)
    : hasCornerPin(getCurrentItem(task.transition.leftClip).cornerPin) ||
        hasCornerPin(getCurrentItem(task.transition.rightClip).cornerPin)
}

function resolveCompositeTaskInput(options: {
  task: CompositeTask
  stagedResult: RenderedTaskResult | null
  activeMasks: PreparedMask[]
  getCurrentItem: FrameCompositingDeps['getCurrentItem']
  applyTrackScopedMasks: FrameCompositingDeps['applyTrackScopedMasks']
  renderMasksToGpuTexture: FrameCompositingDeps['renderMasksToGpuTexture']
  layerMaskTextures: GPUTexture[]
}): {
  result: RenderedTaskResult
  maskInfo: { texture: GPUTexture; view: GPUTextureView } | null
  fallbackMasks: PreparedMask[]
} | null {
  const {
    task,
    stagedResult,
    activeMasks,
    getCurrentItem,
    applyTrackScopedMasks,
    renderMasksToGpuTexture,
    layerMaskTextures,
  } = options
  const taskHasCornerPin = hasCompositeTaskCornerPin(task, getCurrentItem)
  const applicableMasks = activeMasks.filter((mask) =>
    doesMaskAffectTrack(mask.trackOrder, task.trackOrder),
  )
  const shouldUseSeparateMask = task.type === 'item' && !taskHasCornerPin
  let result: RenderedTaskResult | null = shouldUseSeparateMask
    ? stagedResult
    : applyTrackScopedMasks(stagedResult, task.trackOrder, taskHasCornerPin)
  if (!result) return null

  const maskInfo =
    shouldUseSeparateMask && applicableMasks.length > 0
      ? renderMasksToGpuTexture(applicableMasks)
      : null
  if (maskInfo) layerMaskTextures.push(maskInfo.texture)
  let fallbackMasks = shouldUseSeparateMask ? applicableMasks : []
  if (shouldUseSeparateMask && applicableMasks.length > 0 && !maskInfo) {
    const maskedResult = applyTrackScopedMasks(result, task.trackOrder, false)
    if (!maskedResult) return null
    result = maskedResult
    fallbackMasks = []
  }
  return { result, maskInfo, fallbackMasks }
}

function uploadCompositeLayerTexture(options: {
  result: RenderedTaskResult
  w: number
  h: number
  device: GPUDevice
  texturePool: GpuPipelineManager['texturePool']
  layerTextures: GPUTexture[]
  renderMode: 'export' | 'preview'
}): GPUTexture | null {
  const { result, w, h, device, texturePool, layerTextures, renderMode } = options
  // Upload item canvas to GPU texture (pooled — no per-frame alloc)
  const tex = result.gpuTexture
  if (tex) {
    layerTextures.push(tex)
    return tex
  }
  if (!result.source) return null
  // Float layers during a precise export, 8-bit ones otherwise; both are sampled as float by the
  // compositor, and only the accumulator's format decides the pipeline it runs.
  const acquired = texturePool!.acquire(w, h, preciseRenderFormat(renderMode))
  layerTextures.push(acquired)
  device.queue.copyExternalImageToTexture(
    { source: result.source, flipY: false },
    { texture: acquired },
    { width: w, height: h },
  )
  return acquired
}

function buildCompositeLayers(options: {
  renderTasks: CompositeTask[]
  results: Array<RenderedTaskResult | null>
  activeMasks: PreparedMask[]
  canvasSettings: CanvasSettings
  renderMode: 'export' | 'preview'
  getCurrentItem: FrameCompositingDeps['getCurrentItem']
  getEffectiveBlendMode: FrameCompositingDeps['getEffectiveBlendMode']
  applyTrackScopedMasks: FrameCompositingDeps['applyTrackScopedMasks']
  renderMasksToGpuTexture: FrameCompositingDeps['renderMasksToGpuTexture']
  device: GPUDevice
  texturePool: GpuPipelineManager['texturePool']
  maskManager: NonNullable<GpuPipelineManager['maskManager']>
  targets: CompositeLayerBuildTargets
}): void {
  const {
    renderTasks,
    results,
    activeMasks,
    canvasSettings,
    renderMode,
    getCurrentItem,
    getEffectiveBlendMode,
    applyTrackScopedMasks,
    renderMasksToGpuTexture,
    device,
    texturePool,
    maskManager,
    targets,
  } = options
  const w = canvasSettings.width
  const h = canvasSettings.height
  for (let i = 0; i < results.length; i++) {
    const task = renderTasks[i]!
    const input = resolveCompositeTaskInput({
      task,
      stagedResult: results[i] ?? null,
      activeMasks,
      getCurrentItem,
      applyTrackScopedMasks,
      renderMasksToGpuTexture,
      layerMaskTextures: targets.layerMaskTextures,
    })
    if (!input) continue
    const { result, maskInfo, fallbackMasks } = input

    const blendMode =
      task.type === 'item'
        ? (getEffectiveBlendMode(getCurrentItem(task.item)) ?? 'normal')
        : 'normal'

    const tex = uploadCompositeLayerTexture({
      result,
      w,
      h,
      device,
      texturePool,
      layerTextures: targets.layerTextures,
      renderMode,
    })
    if (!tex) continue

    targets.compositedResults.push({
      task,
      result,
      fallbackMasks,
    })

    targets.layers.push({
      params: {
        ...DEFAULT_LAYER_PARAMS,
        blendMode,
        sourceAspect: w / h,
        outputAspect: w / h,
        hasMask: Boolean(maskInfo),
      },
      textureView: tex.createView(),
      maskView: maskInfo?.view ?? maskManager.getFallbackView(),
    })
  }
}

/** The project colour as the 0–1 components a precise frame composites over. */
function resolveBackgroundRgb(backgroundColor: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(backgroundColor)
  if (!match) return { r: 0, g: 0, b: 0 }
  const value = Number.parseInt(match[1]!, 16)
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  }
}

async function compositeLayersToOutput(options: {
  compositor: NonNullable<GpuPipelineManager['compositor']>
  layers: CompositeLayer[]
  w: number
  h: number
  outputCtx: GPUCanvasContext
  backgroundColor: string
  renderMode: 'export' | 'preview'
}): Promise<{ texture: GPUTexture | null } | null> {
  const { compositor, layers, w, h, outputCtx, backgroundColor, renderMode } = options
  const precise = preciseOutputActive(renderMode)
  if (layers.length === 0 && !precise) return null
  try {
    if (precise) {
      // The frame is the float accumulator over the project background, alpha 1: the sink receives
      // it before the blit's one conversion to 8 bits, and the canvas keeps the preview's copy.
      const frame = compositor.compositeToCanvasAndTexture(layers, w, h, outputCtx, {
        pixelFormat: PRECISE_RENDER_FORMAT,
        background: resolveBackgroundRgb(backgroundColor),
      })
      return frame ? { texture: frame.texture } : null
    }
    return compositor.compositeToCanvas(layers, w, h, outputCtx) ? { texture: null } : null
  } catch (error) {
    getLog().warn('GPU compositor failed', { error })
    return null
  }
}

async function resolveFallbackRenderSource(options: {
  task: CompositeTask
  result: RenderedTaskResult
  contentCtx: OffscreenCanvasRenderingContext2D
  renderTransitionFallbackCanvas: FrameCompositingDeps['renderTransitionFallbackCanvas']
  renderItemWithEffects: FrameCompositingDeps['renderItemWithEffects']
}): Promise<RenderedTaskResult | null> {
  const { task, result, contentCtx, renderTransitionFallbackCanvas, renderItemWithEffects } =
    options
  let fallbackResult = result
  if (!fallbackResult.source && task.type === 'transition') {
    fallbackResult = await renderTransitionFallbackCanvas(task)
  }
  if (!fallbackResult.source && task.type === 'item') {
    const rerenderedFallback = await renderItemWithEffects(
      task.item,
      task.trackOrder,
      true,
      contentCtx,
      true,
      false,
      false,
    )
    if (!rerenderedFallback) return null
    fallbackResult = rerenderedFallback
  }
  if (!fallbackResult.source) return null
  return fallbackResult
}

async function drawSingleFallbackResult(options: {
  task: CompositeTask
  result: RenderedTaskResult
  fallbackMasks: PreparedMask[]
  contentCtx: OffscreenCanvasRenderingContext2D
  canvasPool: CanvasPool
  maskSettings: MaskCanvasSettings
  getCurrentItem: FrameCompositingDeps['getCurrentItem']
  getEffectiveBlendMode: FrameCompositingDeps['getEffectiveBlendMode']
  renderTransitionFallbackCanvas: FrameCompositingDeps['renderTransitionFallbackCanvas']
  renderItemWithEffects: FrameCompositingDeps['renderItemWithEffects']
}): Promise<void> {
  const {
    task,
    result,
    fallbackMasks,
    contentCtx,
    canvasPool,
    maskSettings,
    getCurrentItem,
    getEffectiveBlendMode,
    renderTransitionFallbackCanvas,
    renderItemWithEffects,
  } = options
  let fallbackResult = await resolveFallbackRenderSource({
    task,
    result,
    contentCtx,
    renderTransitionFallbackCanvas,
    renderItemWithEffects,
  })
  if (!fallbackResult) return
  let fallbackSource = fallbackResult.source
  if (!fallbackSource) return
  if (fallbackMasks.length > 0) {
    const { canvas: fallbackMaskedCanvas, ctx: fallbackMaskedCtx } = canvasPool.acquire()
    applyMasks(fallbackMaskedCtx, fallbackSource, fallbackMasks, maskSettings)
    // Carry prior pool canvases forward only when `fallbackResult` is a
    // re-render (≠ `result`): those canvases are invisible to the outer
    // cleanup loop. When it's still the original `result`, the outer loop
    // already releases `result.poolCanvases`, so spreading them here would
    // double-release the same backing buffer.
    const carriedPoolCanvases = fallbackResult === result ? [] : fallbackResult.poolCanvases
    fallbackResult = {
      source: fallbackMaskedCanvas,
      poolCanvases: [...carriedPoolCanvases, fallbackMaskedCanvas],
    }
    fallbackSource = fallbackMaskedCanvas
  }
  const blendMode =
    task.type === 'item' ? getEffectiveBlendMode(getCurrentItem(task.item)) : undefined
  if (blendMode && blendMode !== 'normal') {
    contentCtx.globalCompositeOperation = getCompositeOperation(blendMode)
  }

  contentCtx.drawImage(fallbackSource, 0, 0)

  if (blendMode && blendMode !== 'normal') {
    contentCtx.globalCompositeOperation = 'source-over'
  }
  if (fallbackResult !== result) {
    for (const c of fallbackResult.poolCanvases) canvasPool.release(c)
  }
}

async function drawCompositeFallbackLoop(options: {
  compositedResults: CompositedTaskResult[]
  contentCtx: OffscreenCanvasRenderingContext2D
  canvasPool: CanvasPool
  maskSettings: MaskCanvasSettings
  getCurrentItem: FrameCompositingDeps['getCurrentItem']
  getEffectiveBlendMode: FrameCompositingDeps['getEffectiveBlendMode']
  renderTransitionFallbackCanvas: FrameCompositingDeps['renderTransitionFallbackCanvas']
  renderItemWithEffects: FrameCompositingDeps['renderItemWithEffects']
}): Promise<void> {
  // Fall back to the established Canvas2D compositor if the GPU target
  // isn't available for this frame. This preserves feature parity and
  // avoids dropping content when WebGPU canvas presentation fails.
  const {
    compositedResults,
    contentCtx,
    canvasPool,
    maskSettings,
    getCurrentItem,
    getEffectiveBlendMode,
    renderTransitionFallbackCanvas,
    renderItemWithEffects,
  } = options
  for (const { task, result, fallbackMasks } of compositedResults) {
    await drawSingleFallbackResult({
      task,
      result,
      fallbackMasks,
      contentCtx,
      canvasPool,
      maskSettings,
      getCurrentItem,
      getEffectiveBlendMode,
      renderTransitionFallbackCanvas,
      renderItemWithEffects,
    })
  }
}

function releaseCompositeResources(options: {
  results: Array<RenderedTaskResult | null>
  layerTextures: GPUTexture[]
  layerMaskTextures: GPUTexture[]
  canvasPool: CanvasPool
  texturePool: GpuPipelineManager['texturePool']
}): void {
  const { results, layerTextures, layerMaskTextures, canvasPool, texturePool } = options
  const releasedCanvases = new Set<OffscreenCanvas>()
  for (const result of results) {
    if (!result) continue
    for (const canvas of result.poolCanvases) {
      if (releasedCanvases.has(canvas)) continue
      releasedCanvases.add(canvas)
      canvasPool.release(canvas)
    }
  }
  // Always return pooled resources, including when upload, compositing, or
  // fallback rendering throws. Otherwise the pool permanently treats them
  // as in-use and allocates replacements on every later frame.
  for (const texture of new Set(layerTextures)) texturePool!.release(texture)
  for (const texture of new Set(layerMaskTextures)) texturePool!.release(texture)
}

function drawCanvas2dCompositeLoop(options: {
  renderTasks: CompositeTask[]
  results: Array<RenderedTaskResult | null>
  getCurrentItem: FrameCompositingDeps['getCurrentItem']
  getEffectiveBlendMode: FrameCompositingDeps['getEffectiveBlendMode']
  applyTrackScopedMasks: FrameCompositingDeps['applyTrackScopedMasks']
  contentCtx: OffscreenCanvasRenderingContext2D
  canvasPool: CanvasPool
  texturePool: GpuPipelineManager['texturePool']
}): void {
  const {
    renderTasks,
    results,
    getCurrentItem,
    getEffectiveBlendMode,
    applyTrackScopedMasks,
    contentCtx,
    canvasPool,
    texturePool,
  } = options
  // Canvas2D compositing fallback
  for (let i = 0; i < results.length; i++) {
    const task = renderTasks[i]!
    const result = applyTrackScopedMasks(
      results[i] ?? null,
      task.trackOrder,
      hasCompositeTaskCornerPin(task, getCurrentItem),
    )
    if (!result) continue
    drawCanvas2dTaskResult({
      task,
      result,
      getCurrentItem,
      getEffectiveBlendMode,
      contentCtx,
      canvasPool,
      texturePool,
    })
  }
}

function drawCanvas2dTaskResult(options: {
  task: CompositeTask
  result: RenderedTaskResult
  getCurrentItem: FrameCompositingDeps['getCurrentItem']
  getEffectiveBlendMode: FrameCompositingDeps['getEffectiveBlendMode']
  contentCtx: OffscreenCanvasRenderingContext2D
  canvasPool: CanvasPool
  texturePool: GpuPipelineManager['texturePool']
}): void {
  const {
    task,
    result,
    getCurrentItem,
    getEffectiveBlendMode,
    contentCtx,
    canvasPool,
    texturePool,
  } = options
  if (!result.source) {
    if (result.gpuTexture) texturePool?.release(result.gpuTexture)
    return
  }

  const blendMode =
    task.type === 'item' ? getEffectiveBlendMode(getCurrentItem(task.item)) : undefined
  if (blendMode && blendMode !== 'normal') {
    contentCtx.globalCompositeOperation = getCompositeOperation(blendMode)
  }

  contentCtx.drawImage(result.source, 0, 0)

  if (blendMode && blendMode !== 'normal') {
    contentCtx.globalCompositeOperation = 'source-over'
  }

  for (const c of result.poolCanvases) canvasPool.release(c)
}

/**
 * Composites all per-task render results in z-order and returns the canvas to
 * blit to the output. Uses the WebGPU blend-mode compositor when available
 * (pixel-perfect blend modes), falling back to Canvas2D `globalCompositeOperation`
 * when the GPU target isn't usable for the frame. Manages pooled GPU-texture and
 * canvas lifetimes. Extracted verbatim from `renderFrame`.
 *
 * NOTE: the WebGPU path is not exercised by the jsdom test suite — verify export
 * and preview output visually after changing this function.
 */
export async function compositeFrameResults(
  deps: FrameCompositingDeps,
): Promise<FrameCompositeResult> {
  const {
    useGpuCompositor,
    gpu,
    gpuCompositeOutput,
    canvasSettings,
    backgroundColor,
    maskSettings,
    renderTasks,
    results,
    activeMasks,
    contentCanvas,
    contentCtx,
    itemRenderContext,
    canvasPool,
    getCurrentItem,
    getEffectiveBlendMode,
    applyTrackScopedMasks,
    renderMasksToGpuTexture,
    renderTransitionFallbackCanvas,
    renderItemWithEffects,
  } = deps
  const precise = preciseOutputActive(itemRenderContext.renderMode)

  let finalCompositeSource: OffscreenCanvas = contentCanvas
  let frameTexture: GPUTexture | null = null

  // Composite all results in z-order (preserved by renderTasks ordering)
  if (useGpuCompositor && gpu.compositor && gpu.maskManager && gpuCompositeOutput) {
    // GPU compositing path — pixel-perfect blend modes via WebGPU
    const device = gpu.effects!.getDevice()
    const w = canvasSettings.width
    const h = canvasSettings.height
    const targets: CompositeLayerBuildTargets = {
      layers: [],
      layerTextures: [],
      layerMaskTextures: [],
      compositedResults: [],
    }

    try {
      buildCompositeLayers({
        renderTasks,
        results,
        activeMasks,
        canvasSettings,
        renderMode: itemRenderContext.renderMode,
        getCurrentItem,
        getEffectiveBlendMode,
        applyTrackScopedMasks,
        renderMasksToGpuTexture,
        device,
        texturePool: gpu.texturePool,
        maskManager: gpu.maskManager,
        targets,
      })
      const compositedToGpuCanvas = await compositeLayersToOutput({
        compositor: gpu.compositor,
        layers: targets.layers,
        w,
        h,
        outputCtx: gpuCompositeOutput.ctx,
        backgroundColor,
        renderMode: itemRenderContext.renderMode,
      })

      if (compositedToGpuCanvas) {
        await itemRenderContext.gpuPipeline?.waitForSubmittedWork()
        finalCompositeSource = gpuCompositeOutput.canvas
        frameTexture = compositedToGpuCanvas.texture
      } else if (precise) {
        // A precise export cannot lose a frame quietly: a short file would be the symptom, far from
        // its cause. The caller's setup guarantees the compositor on this path.
        throw new Error('The precise export needs the GPU compositor, which did not produce this frame')
      } else {
        await drawCompositeFallbackLoop({
          compositedResults: targets.compositedResults,
          contentCtx,
          canvasPool,
          maskSettings,
          getCurrentItem,
          getEffectiveBlendMode,
          renderTransitionFallbackCanvas,
          renderItemWithEffects,
        })
      }
    } finally {
      releaseCompositeResources({
        results,
        layerTextures: targets.layerTextures,
        layerMaskTextures: targets.layerMaskTextures,
        canvasPool,
        texturePool: gpu.texturePool,
      })
    }
  } else if (precise) {
    throw new Error('The precise export needs the GPU compositor, which is not available')
  } else {
    drawCanvas2dCompositeLoop({
      renderTasks,
      results,
      getCurrentItem,
      getEffectiveBlendMode,
      applyTrackScopedMasks,
      contentCtx,
      canvasPool,
      texturePool: gpu.texturePool,
    })
  }

  return { canvas: finalCompositeSource, texture: frameTexture }
}

/** What one frame's composite produced: the canvas to show or capture, and the float export frame. */
export interface FrameCompositeResult {
  /** The 8-bit canvas the pass blits to its output (the preview, the golden kit, the web export). */
  canvas: OffscreenCanvas
  /**
   * The `rgba16float` frame for the precise sink, present only during a precise export: the
   * project-size composite over the background, alpha 1, before the canvas's one 8-bit conversion.
   */
  texture: GPUTexture | null
}
